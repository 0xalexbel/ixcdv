import * as types from '../common/common-types.js';
import * as pocoTypes from './poco-types.js';
import path, * as pathlib from 'path';
import assert from 'assert';
import * as ERROR_CODES from "../common/error-codes.js";
import { id as etherUtilsGetId, hexZeroPad as etherUtilsHexZeroPad } from 'ethers/lib/utils.js';
import { PoCoChainDeployConfig } from './PoCoChainDeployConfig.js';
import { CONTRACTS_MIN_BASENAME, PoCoDeployer, WALLETS_BASENAME, WALLETS_DEFAULT_PASSWORD } from './PoCoDeployer.js';
import { randomUUID } from 'crypto';
import { Wallet } from 'ethers';
import { GanacheService } from '../common/ganache.js';
import { assertNonEmptyString, isNullishOrEmptyString, placeholdersPropertyReplace, stringToPositiveInteger, throwIfNullishOrEmptyString } from '../common/string.js';
import { cprfDir, dirExists, fileExists, mkDirP, moveDir, readFileSync, readObjectFromJSONFile, resolveAbsolutePath, rmrf, rmrfDir, saveToFile, saveToFileSync, throwIfDirDoesNotExist, toRelativePath } from '../common/fs.js';
import { throwIfNotPositiveInteger } from '../common/number.js';
import { keysAtIndex, mnemonicToEncryptedJson } from '../common/wallet.js';
import { ContratRefFromString, DevContractRef, PoCoContractRef, PoCoHubRef } from '../common/contractref.js';
import { SharedJsonRpcProviders } from '../common/shared-json-rpc-providers.js';
import { CodeError } from '../common/error.js';
import { isPackageOrDirectory } from '../pkgmgr/pkg.js';
import { deepCopyPackage } from '../pkgmgr/pkgmgr-deepcopy.js';
import { PROD_FILE_PREFIX } from '../common/consts.js';
import { ENSRegistry } from '../common/contracts/ENSRegistry.js';

const CONFIG_FILE_BASENAME = `${PROD_FILE_PREFIX}-ganache-poco-config.json`;
const DBPATH_BASENAME = 'db';
const DBUUID_BASENAME = 'DBUUID';

/* -------------------- GanachePoCoService Class ----------------------- */

/**
    @example
    const g = new GanachePoCoService('localhost', {
        port: 8545,
        PoCoDir: "<tmpDir>/PoCo",
        storageDir: "<tmpDir>/myGanacheStorage",
        config: {
            chainid: 1337,
            mnemonic: 'tackle clump have cool idea ripple rally jump airport shed raven song',
            deploySequence: [
                {
                    name: "standard",
                    asset: "Token"
                },
            ],
        }
    });
    await g.install();
    await g.start();
    await g.stop();
 */

export class GanachePoCoService extends GanacheService {

    /** 
     * @override
     * @returns {typeof GanachePoCoService} 
     */
    theClass() { return GanachePoCoService; }

    /** @type {boolean} */
    static #guardConstructing = false;

    /** @type {string} */
    #storageDir;

    /** @type {string=} */
    #DBUUID;

    /** @type {PoCoChainDeployConfig=} */
    #PoCoChainDeployConfig;

    /**
     * @param {types.ServerServiceArgs & {
     *      mnemonic: string,
     *      chainid: number,
     *      storageDir?: string,
     * }} args
     */
    constructor(args) {
        if (!GanachePoCoService.#guardConstructing) {
            throw new TypeError('class constructor is not accessible');
        }
        // The compiler requires the 'storageDir' argument to be optionnal.
        // Limitation of the class features in js+ts
        if (!args.storageDir) {
            throw new TypeError('Missing storageDir argument');
        }

        assert(!isNullishOrEmptyString(args.storageDir));

        let { storageDir, ...opts } = args;

        storageDir = resolveAbsolutePath(storageDir);

        const dbPath = GanachePoCoService.dbPath(storageDir);

        super({
            ...opts,
            dbPath: dbPath,
        });

        this.#storageDir = storageDir;
    }

    get storageDir() { return this.#storageDir; }
    get contractsMinDir() { return path.join(this.#storageDir, CONTRACTS_MIN_BASENAME); }
    get walletsDir() { return path.join(this.#storageDir, WALLETS_BASENAME); }
    get walletsPassword() { return WALLETS_DEFAULT_PASSWORD; }

    get #configFile() { return path.join(this.#storageDir, CONFIG_FILE_BASENAME); }
    get #DBUUIDFile() { return path.join(this.#storageDir, DBUUID_BASENAME); }
    get DBUUID() {
        assert(!isNullishOrEmptyString(this.#DBUUID));
        return this.#DBUUID;
    }

    /**
     * @param {number} index 
     */
    async walletFileAtIndex(index) {
        throwIfNotPositiveInteger(index);
        const walletBasename = `wallet${index}.json`;
        const path = pathlib.join(this.walletsDir, walletBasename);
        if (fileExists(path)) {
            return path;
        }
        //console.log(`Generate missing wallet file : '${this.walletsDir}/${walletBasename}'`);
        const encJson = await mnemonicToEncryptedJson(this.mnemonic, index, WALLETS_DEFAULT_PASSWORD);
        mkDirP(this.walletsDir);
        saveToFileSync(encJson, this.walletsDir, walletBasename);
        return path;
    }

    /**
     * @param {number} index 
     */
    walletKeysAtIndex(index) {
        throwIfNotPositiveInteger(index);
        return keysAtIndex(this.mnemonic, index);
    }

    /**
     * @param {number} index 
     * @param {{
     *      ensAddress: string
     *      networkName: string
     * }} options 
     */
    newWalletAtIndex(index, { ensAddress, networkName }) {
        return new Wallet(
            this.walletKeysAtIndex(index).privateKey,
            SharedJsonRpcProviders.fromURL(this.url, this.chainid, { ensAddress, networkName }));
    }

    /**
     * @param {string} configName 
     */
    workerpool(configName) {
        throwIfNullishOrEmptyString(configName);
        if (!this.#PoCoChainDeployConfig) {
            return null;
        }
        const c = this.#PoCoChainDeployConfig.workerpool(configName);
        return (c) ? c : null;
    }

    hubs() {
        if (!this.#PoCoChainDeployConfig) {
            return [];
        }
        const hubs = [];
        const configs = this.#PoCoChainDeployConfig.configNames();
        for (let i = 0; i < configs.length; ++i) {
            const hubAlias = this.chainid.toString() + '.' + configs[i];

            const hub = this.#PoCoChainDeployConfig.resolve(
                hubAlias,
                { contractName: 'ERC1538Proxy', url: this.urlString });

            assert(hub);
            hubs.push(hub);
        }

        return hubs;
    }

    hubAliases() {
        if (!this.#PoCoChainDeployConfig) {
            return [];
        }
        const hubAliases = [];
        const configs = this.#PoCoChainDeployConfig.configNames();
        for (let i = 0; i < configs.length; ++i) {
            const hubAlias = this.chainid.toString() + '.' + configs[i];
            hubAliases.push({ hubAlias, deployConfigName: configs[i] });
        }
        return hubAliases;
    }

    /**
     * string value can be one of the following:
     * - `<chainid>.<address>` 
     * - `<chainid>.<deployConfigName>` (interpreted as a 'ERC1538Proxy' contract)
     * - any ContractRef key 
     * @param {string | types.DevContractRefLike} ref 
     * @param {(types.PoCoContractName | types.ExtraPoCoContractName)=} contractName 
     * @returns {PoCoHubRef | PoCoContractRef | DevContractRef | null}
     */
    resolve(ref, contractName = 'ERC1538Proxy') {
        if (!this.#PoCoChainDeployConfig) {
            return null;
        }
        const c = this.#PoCoChainDeployConfig.resolve(ref, { contractName, url: this.urlString });

        if (!c || (c instanceof PoCoHubRef)) { return c; }
        assert(c.contractName !== 'ERC1538Proxy');
        return c;
    }

    /**
     * @param {types.PoCoContractName} contractName 
     * @param {string} deployConfigName 
     */
    resolveContractName(contractName, deployConfigName) {
        return this.resolve({
            chainid: this.chainid,
            contractName,
            url: this.url,
            deployConfigName
        }, contractName);
    }

    /**
     * Given a 'hub' argument, try to fully resolve the hub undelying 
     * contract reference. Parse running Ganache instances to determine or 
     * validate the hub url. If no valid ganache service is running,
     * throws an exception. 
     * - Throw exception if failed (invalid arg or ganache not running)
     * @param {(string | types.DevContractRefLike)} hub 
     */
    static async resolveHub(hub) {
        const out = await GanachePoCoService.resolveContractRef(hub, 'ERC1538Proxy');
        if (out.PoCoContractRef.contractName !== 'ERC1538Proxy') {
            throw new CodeError(`Hub contract does not exist.`, ERROR_CODES.POCO_ERROR);
        }
        const hubRef = out.PoCoContractRef;
        assert(hubRef instanceof PoCoHubRef);
        return { service: out.service, PoCoHubRef: hubRef };
    }

    /**
     * Given a 'value' argument, try to fully resolve the undelying 
     * contract reference. Parse running Ganache instances to determine or 
     * validate the contract url. If no valid ganache service is running,
     * throws an exception. 
     * - `<chainid>.<deployConfigName>` are interpreted as `deployConfigContractName` contracts
     * - Throw exception if failed (invalid arg or ganache not running)
     * @param {(string | types.DevContractRefLike)} value 
     * @param {types.PoCoContractName} deployConfigContractName 
     */
    static async resolveContractRef(value, deployConfigContractName) {
        /** @type {DevContractRef=} */
        let devContractRef;
        if (typeof value === 'string') {
            const r = ContratRefFromString(value, deployConfigContractName);
            if (!(r instanceof DevContractRef)) {
                throw new CodeError(`Invalid ${this.typename()} contract reference.`, ERROR_CODES.POCO_ERROR);
            }
            devContractRef = r;
        } else {
            devContractRef = DevContractRef.from(value);
        }
        if (!devContractRef || !devContractRef.resolvable) {
            throw new CodeError(`Invalid ${this.typename()} contract reference.`, ERROR_CODES.POCO_ERROR);
        }

        // Multipurpose query :
        // - checks whether the ganache service is running or not
        // - enables the full hubRef resolve
        const pidsAndServices = await GanachePoCoService.running({ ref: devContractRef });
        if (!pidsAndServices || pidsAndServices.length === 0) {
            throw new CodeError('Ganache service is not running', ERROR_CODES.POCO_ERROR);
        }
        if (pidsAndServices.length > 1) {
            throw new CodeError('Ambiguous Ganache services. Multiple conflicting ganache services are running.', ERROR_CODES.POCO_ERROR);
        }
        const g = pidsAndServices[0].service;
        if (!g) {
            throw new CodeError('Ganache service is not running', ERROR_CODES.POCO_ERROR);
        }
        assert(g.DBUUID);

        // Must resolve against the ganache service to retrieve the url
        const resolvedRef = g.resolve(devContractRef);
        if (!resolvedRef) {
            throw new CodeError('contract reference is not deployed', ERROR_CODES.POCO_ERROR);
        }
        return { service: g, PoCoContractRef: resolvedRef };
    }

    /**
     * @param {string} deployConfigName 
     */
    ENSRegistryRef(deployConfigName) {
        const ref = this.resolveContractName('ENSRegistry', deployConfigName);
        if (!(ref instanceof PoCoContractRef)) {
            throw new CodeError('Unable to retrieve ENSRegistry');
        }
        assert(!(ref instanceof PoCoHubRef));
        assert(ref.contractName === 'ENSRegistry');
        return ref;
    }

    /**
     * @param {string} deployConfigName 
     * @param {string=} networkName 
     */
    getENSRegistry(deployConfigName, networkName) {
        const ensRef = this.ENSRegistryRef(deployConfigName);
        assert(ensRef.address);
        return ENSRegistry.sharedReadOnly(ensRef, this.contractsMinDir, {
            ensAddress: ensRef.address,
            networkName: networkName ?? 'unknown'
        });
    }

    /**
     * @param {pocoTypes.PoCoChainConfig} PoCoChainConfig
     */
    isCompatibleWith(PoCoChainConfig) {
        if (!this.#PoCoChainDeployConfig) {
            return false;
        }
        try {
            const c = new PoCoChainDeployConfig(PoCoChainConfig);
            return this.#PoCoChainDeployConfig.isCompatibleWith(c);
        } catch { }
        return false;
    }

    async installNeeded() {
        if (!fileExists(this.#configFile)) {
            return true;
        }
        if (!fileExists(this.#DBUUIDFile)) {
            return true;
        }
        if (!dirExists(this.contractsMinDir)) {
            return true;
        }
        if (!dirExists(this.dbPath)) {
            return true;
        }
        if (!dirExists(this.#storageDir)) {
            return true;
        }
        return false;
    }

    /**
     * Throws an exception if failed
     * @param {string} storageDir
     * @param {pocoTypes.PoCoChainConfig} PoCoChainConfig 
     */
    static async #install(storageDir, PoCoChainConfig) {
        if (!isPackageOrDirectory(PoCoChainConfig.PoCo)) {
            throw new CodeError(
                'Missing PoCo package or directory',
                ERROR_CODES.POCO_ERROR);
        }
        if (dirExists(storageDir)) {
            throw new CodeError(
                `storage directory already exists (dir='${storageDir}')`,
                ERROR_CODES.POCO_ERROR);
        }

        mkDirP(storageDir);

        try {
            return await GanachePoCoService.#installCore(
                storageDir,
                PoCoChainConfig);
        } catch (err) {
            await rmrf(storageDir, { strict: false });
            throw err;
        }
    }

    /**
     * Throws an exception if failed
     * @param {string} storageDir
     */
    static async #resetDB(storageDir) {
        const pidAndServices = await GanachePoCoService.running({ directory: storageDir });
        if (pidAndServices) {
            const out = await Promise.all(pidAndServices.map(ps => ps.service?.stop({ strict: true })));
        }

        // orig = <storageDir>/orig
        const orig = path.join(storageDir, 'orig');
        // dbPath = <storageDir>/db
        const dbPath = GanachePoCoService.dbPath(storageDir);
        const dbPathBak = dbPath + '.bak';
        assert(!dirExists(dbPathBak));
        assert(dirExists(dbPath));
        assert(dirExists(orig));

        await moveDir(dbPath, dbPath + '.bak', { strict: true });
        assert(!dirExists(dbPath));

        const ok = await cprfDir(orig, dbPath);
        assert(ok);
        assert(dirExists(dbPath));

        await rmrfDir(dbPathBak);

        const DBUUID = randomUUID({ disableEntropyCache: true }).replaceAll('-', '');
        // <storageDir>/DBUUID
        await saveToFile(DBUUID, storageDir, DBUUID_BASENAME, { strict: true });
    }

    /**
     * Throws an exception if failed
     * @param {string} storageDir
     * @param {pocoTypes.PoCoChainConfig} PoCoChainConfig 
     */
    static async #installCore(storageDir, PoCoChainConfig) {
        // <storagePath>/contracts-min/
        // <storagePath>/db/... (dbPath)

        const DBUUID = randomUUID({ disableEntropyCache: true }).replaceAll('-', '');
        saveToFileSync(DBUUID, storageDir, DBUUID_BASENAME, { strict: true });

        // Step 2 : instantiate a PoCo deployer
        // and deploy the requested configs
        assert(PoCoChainConfig.PoCo);
        const deployer = new PoCoDeployer();
        const deployedConfig = await deployer.deploy(
            PoCoChainConfig,
            {
                dbBasename: DBPATH_BASENAME,
                dbDirname: storageDir,
                contractsMinDirname: storageDir
            });

        const deployConfig = new PoCoChainDeployConfig(deployedConfig);
        assert(deployConfig.isFullyDeployed);

        const dbPath = GanachePoCoService.dbPath(storageDir);
        const contractsMinDir = path.join(storageDir, CONTRACTS_MIN_BASENAME);
        const configFile = path.join(storageDir, CONFIG_FILE_BASENAME);

        assert(dirExists(contractsMinDir));
        assert(dirExists(dbPath));

        await cprfDir(dbPath, path.join(storageDir, 'orig'));

        // Save the new config file that contains 
        // only the deployed data
        const json = JSON.stringify(
            deployConfig.toPoCoChainConfig(true /* onlyDeployed */),
            null,
            2);

        saveToFileSync(
            json,
            path.dirname(configFile),
            path.basename(configFile),
            { strict: true });

        assert(fileExists(configFile));

        return { DBUUID, deployConfig };
    }

    /** 
     * @param {pocoTypes.GanachePoCoServiceConfig} config 
     * @param {boolean} resolvePlaceholders
     * @param {{[varname:string]: string}} placeholders
     * @param {string=} relativeToDirectory
     */
    static async deepCopyConfig(config, resolvePlaceholders, placeholders, relativeToDirectory) {
        const configCopy = { ...config };
        configCopy.config = { ...config.config };
        assert(configCopy.type === 'ganache');

        if (!configCopy.hostname && placeholders) {
            configCopy.hostname = placeholders["${defaultHostname}"];
        }

        if (configCopy.config.PoCo) {
            configCopy.config.PoCo = deepCopyPackage(configCopy.config.PoCo, relativeToDirectory);
        }

        assert(configCopy.type === 'ganache');

        if (relativeToDirectory) {
            if (configCopy.directory) {
                configCopy.directory = toRelativePath(relativeToDirectory, configCopy.directory);
            }
            if (configCopy.logFile) {
                configCopy.logFile = toRelativePath(relativeToDirectory, configCopy.logFile);
            }
            if (configCopy.pidFile) {
                configCopy.pidFile = toRelativePath(relativeToDirectory, configCopy.pidFile);
            }
        }
        if (resolvePlaceholders) {
            if (configCopy.config.PoCo) {
                configCopy.config.PoCo = PoCoDeployer.toResolvedPackage(
                    configCopy.config.PoCo, 
                    placeholders,
                    relativeToDirectory);
            }
            ["hostname"].forEach((v) => {
                placeholdersPropertyReplace(configCopy, v, placeholders)
            });
        }

        const d = configCopy.config.deploySequence.map(s => { return { ...s }; });
        configCopy.config.deploySequence = d;
        return configCopy;
    }

    /**
     * Throws an exception if failed
     * @param {string} storageDir
     */
    static async loadConfig(storageDir) {
        return GanachePoCoService.#loadConfig(storageDir);
    }

    /**
     * Throws an exception if failed
     * @param {string} storageDir
     * @param {pocoTypes.PoCoChainConfig=} requestedConfig
     */
    static async #loadConfig(storageDir, requestedConfig) {
        const configFile = path.join(storageDir, CONFIG_FILE_BASENAME);
        const DBUUIDFile = path.join(storageDir, DBUUID_BASENAME);

        const requestedDeployConfig = (requestedConfig) ?
            new PoCoChainDeployConfig(requestedConfig) :
            null;

        let deployConfig;
        let DBUUID;

        if (!fileExists(configFile)) {
            throw new CodeError(`Missing config file ${configFile}`, ERROR_CODES.POCO_ERROR);
        }
        if (!fileExists(DBUUIDFile)) {
            throw new CodeError(`Missing DBUUID file ${DBUUIDFile}`, ERROR_CODES.POCO_ERROR);
        }

        const json = await readObjectFromJSONFile(
            configFile,
            { strict: true });

        deployConfig = new PoCoChainDeployConfig(json);
        DBUUID = readFileSync(DBUUIDFile, { strict: true })?.trim();
        if (isNullishOrEmptyString(DBUUID)) {
            throw new CodeError(`Create DBUUID file ${DBUUIDFile} failed.`, ERROR_CODES.POCO_ERROR);
        }
        assert(DBUUID);

        if (requestedDeployConfig) {
            if (!deployConfig.isCompatibleWith(requestedDeployConfig)) {
                throw new CodeError(
                    `Incompatible ganache storage directory '${storageDir}'`,
                    ERROR_CODES.POCO_ERROR);
            }
        }

        return { DBUUID, deployConfig };
    }

    /**
     * @param {number} index 
     */
    async #getSchedulerNoticeFilterAt(index) {
        if (!this.#PoCoChainDeployConfig) {
            return;
        }
        const configName = this.#PoCoChainDeployConfig.configNameAt(0);
        if (!configName) {
            return;
        }
        const hubAddr = this.#PoCoChainDeployConfig.address(configName, 'ERC1538Proxy');
        if (!hubAddr) {
            return;
        }
        const workerpool = this.#PoCoChainDeployConfig.workerpool(configName);
        if (!workerpool) {
            return;
        }
        const signature = etherUtilsGetId("SchedulerNotice(address,bytes32)");
        return {
            address: hubAddr,
            topics: [
                signature,
                etherUtilsHexZeroPad(workerpool.address, 32).toLowerCase()
            ]
        };
    }

    /** 
     * @override
     * @protected 
     * @param {number} pid 
     * @param {boolean} alreadyStarted 
     */
    async onReadyOverride(pid, alreadyStarted) {
        if (alreadyStarted) {
            // avoid multiple fix
            return;
        }
        // Build a dummy filter
        const filter = await this.#getSchedulerNoticeFilterAt(0);
        if (filter) {
            // Register / Unregister events to artificially increase the
            // filterID and avoid the 0xf bug in ganache
            await this.fixFilterIDBug(filter);
        }
    }

    /**
      * @override
      * @param {number | undefined} pid 
      * @param {types.StopOptionsWithContext=} options
      */
    async onStoppedOverride(pid, options) {
        if (options?.reset === true) {
            await GanachePoCoService.resetDB({ directory: this.#storageDir });
        }
    }

    /**
     * Throws an exception if failed.
     * @param {{
     *      directory:string
     * }} params
     */
    static async resetDB({ directory }) {
        throwIfNullishOrEmptyString(directory);

        directory = resolveAbsolutePath(directory);

        await GanachePoCoService.#resetDB(directory);
    }

    /**
     * Throws an exception if failed.
     * @param {{
     *      directory: string
     *      config: pocoTypes.PoCoChainConfig
     * }} params
     */
    static async install({ directory, config }) {
        throwIfNullishOrEmptyString(directory);

        directory = resolveAbsolutePath(directory);

        const exists = dirExists(directory);

        /** @type {string=} */
        let DBUUID;
        /** @type {PoCoChainDeployConfig=} */
        let deployConfig;

        let installNeeded = !exists;
        if (exists) {
            try {
                const o = await GanachePoCoService.#loadConfig(directory, config);
                DBUUID = o.DBUUID;
                deployConfig = o.deployConfig;
            } catch (err) {
                // a previous install was incomplete...
                installNeeded = true;
                await rmrfDir(directory);
            }
        }

        if (installNeeded) {
            const o = await GanachePoCoService.#install(directory, config);
            DBUUID = o.DBUUID;
            deployConfig = o.deployConfig;
        }

        assert(deployConfig, 'install failed');
        assert(DBUUID, 'install failed');
    }

    /**
      * Throws an exception if failed
      * @param {types.ServerServiceArgs & {
      *      directory:string
      * }} params
      */
    static async newInstance({ directory, ...options }) {
        throwIfNullishOrEmptyString(directory);

        directory = resolveAbsolutePath(directory);
        throwIfDirDoesNotExist(directory);

        const { DBUUID, deployConfig } =
            await GanachePoCoService.#loadConfig(directory);

        try {
            GanachePoCoService.#guardConstructing = true;
            const o = new GanachePoCoService({
                ...options,
                chainid: deployConfig.chainid,
                mnemonic: deployConfig.mnemonic,
                storageDir: directory
            });
            o.#DBUUID = DBUUID;
            o.#PoCoChainDeployConfig = deployConfig;
            GanachePoCoService.#guardConstructing = false;
            return o;
        } catch (err) {
            GanachePoCoService.#guardConstructing = false;
            throw err;
        }
    }

    /**
     * @param {string} directory
     */
    static dbPath(directory) {
        return path.join(directory, DBPATH_BASENAME);
    }

    /**
     * @param {object} args 
     * @param {types.DevContractRefLike=} args.ref 
     * @param {string=} args.directory 
     * @param {number=} args.chainid 
     * @param {number=} args.port 
     * @param {string=} args.mnemonic 
     * @param {string=} args.dbPath 
     */
    static async runningPIDs({ ref, directory, ...others } = {}) {
        if (directory) {
            others.dbPath = directory;
        }
        if (ref) {
            if (ref.url) {
                const u = (typeof ref.url === 'string') ? new URL(ref.url) : ref.url
                // Any Ganache service running at the specified url ?
                const port = stringToPositiveInteger(u.port, { strict: false });
                if (port) {
                    others.port = port;
                }
            } else {
                others.chainid = ref.chainid;
            }
        }
        const pids = await super.runningPIDs(others);
        if (!pids || pids.length === 0) {
            return null;
        }
        return pids;
    }

    /**
     * @param {number} pid
     */
    static async fromPID(pid) {
        const g = await GanacheService.fromPID(pid);
        return GanachePoCoService.#fromGanacheService(g);
    }

    /**
     * @param {object=} filters 
     * @returns {Promise<{pid: number, configFile: string, service:(GanachePoCoService | null)}[] | null>} 
     */
    static async running(filters) {
        const pidAndServices = await super.running(filters);
        if (!pidAndServices || pidAndServices.length === 0) {
            return null;
        }
        const PoCoServices = [];
        for (let i = 0; i < pidAndServices.length; ++i) {
            const pid = pidAndServices[i].pid;
            const configFile = pidAndServices[i].configFile;
            const g = pidAndServices[i].service;

            const service = await GanachePoCoService.#fromGanacheService(g);
            PoCoServices.push({ pid, configFile, service });
        }
        return (PoCoServices.length === 0) ? null : PoCoServices;
    }

    /**
     * @param {?GanacheService=} g 
     */
    static async #fromGanacheService(g) {
        if (!g) {
            return null;
        }

        const dbPath = g.dbPath;
        assertNonEmptyString(dbPath);
        if (path.basename(dbPath) !== DBPATH_BASENAME) {
            return null;
        }

        const storageDir = resolveAbsolutePath(path.dirname(dbPath));

        let DBUUID;
        let deployConfig;

        try {
            const loaded = await GanachePoCoService.#loadConfig(storageDir);
            if (loaded.deployConfig.chainid !== g.chainid ||
                loaded.deployConfig.mnemonic !== g.mnemonic) {
                // Not a PoCo service, just a plain ganache service
                return null;
            }
            DBUUID = loaded.DBUUID;
            deployConfig = loaded.deployConfig;
        } catch {
            return null;
        }

        let o = null;
        GanachePoCoService.#guardConstructing = true;
        try {
            o = new GanachePoCoService({
                ...g.toJSON(),
                storageDir: storageDir
            });
            o.#DBUUID = DBUUID;
            o.#PoCoChainDeployConfig = deployConfig;
        } catch { }
        GanachePoCoService.#guardConstructing = false;
        return o;
    }
}