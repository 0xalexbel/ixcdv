import * as pocoTypes from './poco-types.js';
import * as types from '../common/common-types.js';
import * as ERROR_CODES from "../common/error-codes.js";
import assert from 'assert';
import path from 'path';
import { PoCoChainDeployConfig } from './PoCoChainDeployConfig.js';
import { genTruffleConfigJs, minifyContracts, trufflePoCo, isTruffleInstalled } from '../truffle/truffle-api.js';
import { Wallet, Contract, BigNumber } from 'ethers';
import { JsonRpcProvider } from '@ethersproject/providers';
import { dirExists, generateTmpPathname, mkDirP, moveDirSync, parentDirExists, resolveAbsolutePath, rmrf, throwIfDirAlreadyExists, throwIfDirDoesNotExist, toRelativePath } from '../common/fs.js';
import { installPackage, isPackageOrDirectory } from '../pkgmgr/pkg.js';
import { CodeError } from '../common/error.js';
import { placeholdersReplace, throwIfNullishOrEmptyString } from '../common/string.js';
import { GanacheService, isGanacheInstalled } from '../common/ganache.js';
import { ERC721TokenIdToAddress, toChecksumAddress } from '../common/ethers.js';
import { importJsonModule } from '../common/import.cjs';
import { keysAtIndex } from '../common/wallet.js';
import { PROD_NAME } from '../common/consts.js';
import { PoCoContractRef } from '../common/contractref.js';
import { ENSRegistry } from '../common/contracts/ENSRegistry.js';
import { deepCopyPackage } from '../pkgmgr/pkgmgr-deepcopy.js';

export const CONTRACTS_MIN_BASENAME = 'contracts-min';
export const WALLETS_BASENAME = 'wallets';
export const WALLETS_DEFAULT_PASSWORD = 'whatever';

/* ------------------------- Default Configs -------------------------------- */

/** @type {pocoTypes.PoCoDeployConfig} */
export const STANDARD_CONFIG = {
    name: 'standard',
    asset: 'Token',
    WorkerpoolAccountIndex: 1,
    WorkerpoolDescription: `default ${PROD_NAME} standard workerpool`
};
Object.freeze(STANDARD_CONFIG);

/** @type {pocoTypes.PoCoDeployConfig} */
export const UNISWAP_CONFIG = {
    name: 'uniswap',
    asset: 'Token',
    uniswap: true,
    WorkerpoolAccountIndex: 1,
    WorkerpoolDescription: `default ${PROD_NAME} uniswap workerpool`
};
Object.freeze(UNISWAP_CONFIG);

/** @type {pocoTypes.PoCoDeployConfig} */
export const ENTERPRISE_CONFIG = {
    name: 'enterprise',
    asset: 'Token',
    kyc: true,
    WorkerpoolAccountIndex: 1,
    WorkerpoolDescription: `default ${PROD_NAME} enterprise workerpool`
};
Object.freeze(ENTERPRISE_CONFIG);

/** @type {pocoTypes.PoCoDeployConfig} */
export const NATIVE_CONFIG = {
    name: 'native',
    asset: 'Native',
    WorkerpoolAccountIndex: 1,
    WorkerpoolDescription: `default ${PROD_NAME} native workerpool`
};
Object.freeze(NATIVE_CONFIG);

/* ----------------------------- Constants ---------------------------------- */

const DEFAULT_DEPLOY_PORT = 9889;
const TMP_DIR_PREFIX = 'poco-';

/* ------------------------- PoCoDeployer Class ----------------------------- */

export class PoCoDeployer {

    /** @type {types.Package=} */
    #PoCoPkg;

    /** @type {PoCoChainDeployConfig=} */
    #chainDeployConfig;

    /** 
     * @example
     * const deployer = new PoCoDeployer();
     * const deployedAddresses = await deployer.deploy( 
     *      {
     *          PoCo: '/path/to/git/repo/PoCo'
     *          mnemonic: 'space hospital shell omit lady never agree wagon occur sadness usage brick',
     *          chainid: 1337,
     *          deploySequence: [
     *              {
     *                  name:'standard',
     *                  asset: 'Token'
     *              }
     *          ]
     *      });
     */
    constructor() {
    }

    get #PoCoDir() {
        assert(this.#PoCoPkg);
        return this.#PoCoPkg.directory;
    }

    /**
     * Installs the `PoCo` git repository in the `PoCoDir` directory.
     * - Does nothing if `PoCo` is alredy installed
     * - Downloads and runs `npm install` if `PoCo` is missing
     * - Throws an error if failed.
     */
    async #installPoCo() {
        // will throw an error if failed
        if (!parentDirExists(this.#PoCoDir, { strict: false })) {
            mkDirP(path.dirname(this.#PoCoDir));
            // throw new CodeError(
            //     `PoCo parent directory does not exist (PoCo dir=${this.#PoCoDir}).`,
            //     ERROR_CODES.POCO_ERROR);
        }
        assert(this.#PoCoPkg);
        await installPackage(this.#PoCoPkg);
    }

    /**
     * @param {string | types.Package} PoCo 
     * @param {string=} relativeToDirectory
     */
    static toPackage(PoCo, relativeToDirectory) {
        /** @type {types.Package} */
        let PoCoPkg;
        // PoCoChainConfig.PoCo refers to a directory
        if (typeof PoCo === 'string') {
            const version = "v5.3.0";
            let PoCoDir = placeholdersReplace(PoCo, {
                "${repoName}": 'PoCo',
                "${version}": version
            });
            PoCoDir = resolveAbsolutePath(PoCoDir);
            PoCoDir = (relativeToDirectory) ? toRelativePath(relativeToDirectory, PoCoDir) : PoCoDir;
            PoCoPkg = {
                cloneRepo: `https://github.com/iExecBlockchainComputing/PoCo.git`,
                directory: PoCoDir,
                clone: "ifmissing",
                commitish: version,
                branch: undefined,
                gitHubRepoName: 'PoCo'
            };
        } else {
            /** @type {!Object.<string,string>} */
            let placeholders = {
                "${repoName}": PoCo.gitHubRepoName ?? 'PoCo'
            };
            if (PoCo.commitish) {
                placeholders["${version}"] = PoCo.commitish;
            }
            const PoCoDir = placeholdersReplace(PoCo.directory, placeholders);
            // Help compiler
            const PoCoPkgCopy = deepCopyPackage(PoCo, relativeToDirectory);
            assert(PoCoPkgCopy);
            assert(typeof PoCoPkgCopy === 'object');
            PoCoPkg = PoCoPkgCopy;
            PoCoPkg.directory = resolveAbsolutePath(PoCoDir);
        }

        return PoCoPkg;
    }

    /**
     * Generates a new ganache db initialized with the PoCo contracts
     * specified in the `PoCoChainConfig` argument.
     * - If succeeded :
     *   - returns the deployed addresses as a `PoCoChainConfig` structure
     * - If failed :
     *   - always throws an error
     * 
     * NOTE: Both 'truffle' and 'ganache' must be installed on the machine.
     * @param {pocoTypes.PoCoChainConfig} PoCoChainConfig 
     * @param {object} options
     * @param {string=} options.dbDirname
     * @param {string=} options.dbBasename
     * @param {string=} options.contractsMinDirname
     * @param {string=} options.contractsMinBasename
     */
    async deploy(PoCoChainConfig, options) {

        if (!isPackageOrDirectory(PoCoChainConfig.PoCo)) {
            throw new CodeError('Missing PoCo package or directory', ERROR_CODES.POCO_ERROR);
        }
        assert(PoCoChainConfig.PoCo);
        this.#PoCoPkg = PoCoDeployer.toPackage(PoCoChainConfig.PoCo);

        // - starts a temporary ganache server on a dummy port
        // - the ganache server points to a fresh new empty DB 
        //   located in a temporary directory ('<tmpDir>/poco-<UUID>')
        // - installs the PoCo contracts repository if needed (v5.3) 
        // - deploys the requested PoCo contracts according to 
        //   config passed as argument
        // - once done, stops the ganache server
        // - if needed : move the DB containing the newly deployed
        //   contracts at the given location ('dbDirname' & 'dbBasename')
        // - if needed : minify the PoCo contracts and copy
        //   then to the given location ('contractsMinDirname' &
        //   'contractsMinBasename')
        // - stops the tempororary ganache server
        // - deletes all the temporary resources

        let dbDir;
        if (options.dbDirname) {
            throwIfDirDoesNotExist(path.dirname(options.dbDirname));
            const dbBasename = options.dbBasename ?? 'db';
            throwIfNullishOrEmptyString(dbBasename);
            assert(dbBasename);
            dbDir = path.join(options.dbDirname, dbBasename);
            dbDir = resolveAbsolutePath(dbDir);
            throwIfDirAlreadyExists(dbDir);
        }

        let contractsMinDir;
        if (options.contractsMinDirname) {
            throwIfDirDoesNotExist(path.dirname(options.contractsMinDirname));
            const contractsMinBasename =
                options.contractsMinBasename ??
                CONTRACTS_MIN_BASENAME;
            throwIfNullishOrEmptyString(contractsMinBasename);
            assert(contractsMinBasename);
            contractsMinDir = path.join(
                options.contractsMinDirname,
                contractsMinBasename);
            contractsMinDir = resolveAbsolutePath(contractsMinDir);
            throwIfDirAlreadyExists(contractsMinDir);
        }

        this.#chainDeployConfig = new PoCoChainDeployConfig(PoCoChainConfig);

        if (this.#chainDeployConfig.length === 0) {
            console.log("Nothing to deploy");
            return this.#chainDeployConfig.toPoCoChainConfig(
                true /* onlyDeployed */);
        }
        if (this.#chainDeployConfig.isFullyDeployed) {
            console.log("Already deployed");
            return this.#chainDeployConfig.toPoCoChainConfig(
                true /* onlyDeployed */);
        }

        // Make sure 'Ganache' is installed locally
        if (! await isGanacheInstalled()) {
            throw new CodeError(
                `${PROD_NAME} requires Ganache to be installed.`,
                ERROR_CODES.POCO_ERROR);
        }
        // Make sure 'Truffle' is installed locally
        if (! await isTruffleInstalled()) {
            throw new CodeError(
                `${PROD_NAME} requires Truffle to be installed.`,
                ERROR_CODES.POCO_ERROR);
        }

        // installs the PoCo git repository if missing.
        await this.#installPoCo();

        const tmpDir = await generateTmpPathname(TMP_DIR_PREFIX);
        if (dirExists(tmpDir)) {
            throw new CodeError('Internal error', ERROR_CODES.POCO_ERROR);
        }

        const tmpDBPath = path.join(tmpDir, 'db');

        mkDirP(tmpDBPath, { strict: true });

        try {
            await this.#deploy(tmpDir, tmpDBPath);

            if (dbDir) {
                moveDirSync(tmpDBPath, dbDir, { strict: true });
            }
            if (contractsMinDir) {
                await minifyContracts(
                    path.join(this.#PoCoDir, "build", "contracts"),
                    contractsMinDir,
                    { strict: true });
            }

            await rmrf(tmpDir);

            return this.#chainDeployConfig.toPoCoChainConfig(
                true /* onlyDeployed */);
        } catch (err) {
            await rmrf(tmpDir);
            throw err;
        }
    }

    /**
     * @param {string} tmpDir 
     * @param {string} tmpDBPath 
     */
    async #deploy(tmpDir, tmpDBPath) {
        const port = DEFAULT_DEPLOY_PORT;
        const host = 'localhost';

        // In 'tmpDir', generates a custom 'truffle-config.js' file
        // based on 'host' and 'port' values.
        // This config file is required by truffle
        // to identify the server where the future contracts will be deployed. 
        const truffleConfigFile = await genTruffleConfigJs(
            host,
            port,
            tmpDir,
            { strict: true });
        assert(truffleConfigFile);

        assert(this.#chainDeployConfig);
        const g = new GanacheService({
            hostname: host,
            port: port,
            chainid: this.#chainDeployConfig.chainid,
            mnemonic: this.#chainDeployConfig.mnemonic,
            dbPath: tmpDBPath
        });

        // is there any ganache service running on our port ?
        let runningGanacheServices = await GanacheService.running({ port });
        if (runningGanacheServices) {
            assert(runningGanacheServices.length === 1);
            if (!runningGanacheServices[0].service) {
                throw new CodeError(`Another instane of ganache is already running on port ${port}`)
            }
            await runningGanacheServices[0].service.stop({ strict: true });
        } else {
            await g.stop({ strict: true });
        }

        // starts the temporary ganache service
        await g.start({
            env: { marker: 'PoCoDeployer' },
            killIfFailed: true,
            strict: true
        });

        let deployError;
        try {
            await this.#deployCore(g, truffleConfigFile);
        } catch (err) {
            deployError = err;
        }

        // Secured stop (catch any exception)
        try { await g.stop({ strict: false }); } catch { }

        if (deployError) {
            throw deployError;
        }
    }

    /**
     * @param {GanacheService} ganacheService
     * @param {string} truffleConfigFile 
     */
    async #deployCore(ganacheService, truffleConfigFile) {
        assert(this.#chainDeployConfig);

        const len = this.#chainDeployConfig.length;
        for (let i = 0; i < len; i++) {
            const PoCoConfig = this.#chainDeployConfig.getPoCoConfigAt(i);
            if (!PoCoConfig) {
                continue;
            }

            const PoCoConfigName = this.#chainDeployConfig.configNameAt(i);
            assert(PoCoConfigName);

            // clean=true   : rm -rf <PoCoDir>/build
            // compile=true : truffle compile 
            // migrate=true : truffle migrate 
            const out = await trufflePoCo(
                this.#chainDeployConfig.chainid,
                truffleConfigFile,
                this.#PoCoDir,
                PoCoConfig,
                {
                    clean: true,
                    compile: true,
                    migrate: true
                }
            );
            if (!out.ok) {
                assert(out.error);
                throw out.error;
            }

            this.#chainDeployConfig.setConfigDeployedAddresses(
                PoCoConfigName,
                out.result);

            const wpArgs = this.#chainDeployConfig.workerpoolAt(i);
            assert(wpArgs);
            const workerpoolRegistryAddr = wpArgs?.registry;
            let ensAddress = this.#chainDeployConfig.address(PoCoConfigName, 'ENSRegistry');
            assert(ensAddress);
            let publicResolverAddress = this.#chainDeployConfig.address(PoCoConfigName, 'PublicResolver');
            assert(publicResolverAddress);

            ensAddress = toChecksumAddress(ensAddress);
            publicResolverAddress = toChecksumAddress(publicResolverAddress);

            const ensRef = new PoCoContractRef({
                chainid: ganacheService.chainid,
                url: ganacheService.urlString,
                address: ensAddress,
                contractName: 'ENSRegistry',
                deployConfigName: PoCoConfigName,
            });

            const provider = new JsonRpcProvider(ganacheService.urlString, {
                ensAddress,
                chainId: ganacheService.chainid,
                name: 'unknown'
            });

            const contractDir = path.join(this.#PoCoDir, 'build/contracts');
            const adminAccountIndex = 0;
            const adminKeys = keysAtIndex(ganacheService.mnemonic, adminAccountIndex);
            const adminWallet = new Wallet(adminKeys.privateKey, provider);
            const wpKeys = keysAtIndex(ganacheService.mnemonic, wpArgs.accountIndex);
            const wpWallet = new Wallet(wpKeys.privateKey, provider);

            const ensRegistryContract = ENSRegistry.sharedReadOnly(
                ensRef,
                contractDir,
                {
                    ensAddress,
                    networkName: 'unknown'
                });

            let newFIFSReg;
            newFIFSReg = await ensRegistryContract.addFIFSRegistrar('pools', 'iexec.eth', publicResolverAddress, adminWallet);
            console.log(`new FIFSRegistrar : domain=${newFIFSReg.domain} addr=${newFIFSReg.address}`);
            newFIFSReg = await ensRegistryContract.addFIFSRegistrar('apps', 'iexec.eth', publicResolverAddress, adminWallet);
            console.log(`new FIFSRegistrar : domain=${newFIFSReg.domain} addr=${newFIFSReg.address}`);
            newFIFSReg = await ensRegistryContract.addFIFSRegistrar('datasets', 'iexec.eth', publicResolverAddress, adminWallet);
            console.log(`new FIFSRegistrar : domain=${newFIFSReg.domain} addr=${newFIFSReg.address}`);

            if (workerpoolRegistryAddr) {
                const { address, txHash } = await this.#addWorkerpool(
                    ganacheService,
                    provider,
                    workerpoolRegistryAddr,
                    contractDir,
                    wpArgs.accountIndex,
                    wpArgs.description
                );
                console.log('workerpool=' + address);
                console.log('txHash=' + txHash);
                this.#chainDeployConfig.setConfigDeployedExtraAddresses(PoCoConfigName,
                    {
                        "Workerpool": address
                    });
                    
                await ensRegistryContract.registerAddress(
                    'default',
                    'pools.iexec.eth',
                    address,
                    wpWallet);
            }
        }
    }

    /**
     * @param {GanacheService} ganacheService 
     * @param {JsonRpcProvider} provider
     * @param {string} workerpoolRegistryAddr 
     * @param {string} contractsDir 
     * @param {number} accountIndex 
     * @param {string} description 
     */
    async #addWorkerpool(
        ganacheService,
        provider,
        workerpoolRegistryAddr,
        contractsDir,
        accountIndex,
        description) {

        workerpoolRegistryAddr = toChecksumAddress(workerpoolRegistryAddr);

        const modulePath = path.join(contractsDir, 'WorkerpoolRegistry.json');
        const contractModule = importJsonModule(modulePath);

        const keys = keysAtIndex(ganacheService.mnemonic, accountIndex);
        const wallet = new Wallet(keys.privateKey, provider);

        const sc = new Contract(workerpoolRegistryAddr, contractModule.abi, wallet);

        /*
        function createWorkerpool(
            address          _workerpoolOwner,
            string  calldata _workerpoolDescription)
        */
        /** @type {any} */
        const tx = await sc.createWorkerpool(
            wallet.address,
            description);

        // wait for tx
        const txReceipt = await tx.wait(1);
        const evtTransfer = txReceipt.events.find(/** @param {any} event */(event) => event.event === 'Transfer');
        if (!evtTransfer) {
            throw new Error(`Unknown event 'Transfer'`);
        }

        /*
            From ERC721.sol
            _mint(...)
            emit Transfer(address(0), to, tokenId);
            event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
         */
        /** @type {{ tokenId: BigNumber }} */
        const { tokenId } = evtTransfer.args;
        assert(tokenId instanceof BigNumber);

        const address = ERC721TokenIdToAddress(tokenId);
        return {
            address: address,
            txHash: txReceipt.transactionHash
        };
    }
}