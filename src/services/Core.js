import * as srvTypes from './services-types-internal.js';
import * as types from '../common/common-types.js';
import path from 'path';
import assert from 'assert';
import * as ERROR_CODES from "../common/error-codes.js";
import { parseEnvVars as utilsParseEnvVars } from '../common/utils.js';
import { MongoService } from './MongoService.js';
import { inplaceResolveSpringServicePlaceholders, installServiceClassPackage, pidToSpringConstructorArgs, SpringMongoServerService } from './spring-serverservice.js';
import { parseApplicationYmlFile } from './application-dot-yml.js';
import { SmsService } from './Sms.js';
import { ResultProxyService } from './ResultProxy.js';
import { BlockchainAdapterService } from './BlockchainAdapter.js';
import { getLatestVersion } from '../git/git-api.js';
import { toPackage } from '../pkgmgr/pkg.js';
import { removeSuffix, stringIsAlphanum, stringToHostnamePort, stringToPositiveInteger, throwIfNullishOrEmptyString } from '../common/string.js';
import { CodeError } from '../common/error.js';
import { IpfsService } from '../ipfs/IpfsService.js';
import { PoCoHubRef } from '../common/contractref.js';
import { resolveAbsolutePath, throwIfDirDoesNotExist } from '../common/fs.js';
import { throwIfNotPositiveInteger, throwIfNotStrictlyPositiveInteger } from '../common/number.js';
import { GanachePoCoService } from '../poco/GanachePoCoService.js';
import { toChecksumAddress } from '../common/ethers.js';
import { envVarName } from '../common/consts.js';

/**
 * @typedef {import('./spring-serverservice.js').SpringMongoServerServiceConstructorArgs & 
* {
 *      ipfsHost?: string,
 *      smsUrl?: string,
 *      resultProxyUrl?: string,
 *      blockchainAdapterUrl?: string,
 *      walletIndex?: number
 *      workerpoolAddress?: string
 * }} CoreServiceConstructorArgs
 */

/* ---------------------- BlockchainAdapterService Class -------------------------- */

export class CoreService extends SpringMongoServerService {

    /** 
     * @override
     * @returns {typeof CoreService} 
     */
    theClass() { return CoreService; }

    static typename() { return 'core'; }
    static CLASSNAME() { return 'com.iexec.core.' + CoreService.ENTRY(); }
    static ENTRY() { return 'Application'; }

    CLASSNAME() { return CoreService.CLASSNAME(); }
    ENTRY() { return CoreService.ENTRY(); }

    /** @type {boolean} */
    static #guardConstructing = false;

    /** @type {string=} */
    #ipfsHost;

    /** @type {URL=} */
    #smsURL;

    /** @type {URL=} */
    #blockchainAdapterURL;

    /** @type {URL=} */
    #resultProxyURL;

    /** @type {number=} */
    #walletIndex;

    /** @type {string=} */
    #workerpoolAddress;

    /** @override */
    static get defaultGitUrl() {
        return 'https://github.com/iExecBlockchainComputing/iexec-core.git';
    }
    /** @override */
    static get gitHubRepoName() { return 'iexec-core'; }

    /** @type {string} */
    static #latestVersion;

    /** @override */
    static async latestVersion() {
        if (!CoreService.#latestVersion) {
            CoreService.#latestVersion = await getLatestVersion(this.defaultGitUrl);
        }
        return CoreService.#latestVersion;
    }

    /**
     * @param {CoreServiceConstructorArgs} args
     */
    constructor(args) {
        if (!CoreService.#guardConstructing) {
            throw new TypeError('class constructor is not accessible');
        }

        super(args);

        assert(args.ipfsHost);
        assert(args.smsUrl);
        assert(args.resultProxyUrl);
        assert(args.blockchainAdapterUrl);
        assert(args.walletIndex);
        assert(args.workerpoolAddress);

        this.#ipfsHost = args.ipfsHost;
        this.#smsURL = new URL(args.smsUrl);
        this.#resultProxyURL = new URL(args.resultProxyUrl);
        this.#blockchainAdapterURL = new URL(args.blockchainAdapterUrl);
        this.#walletIndex = args.walletIndex;
        this.#workerpoolAddress = args.workerpoolAddress;
    }

    /** @param {CoreServiceConstructorArgs} args */
    static #newCoreService(args) {
        try {
            CoreService.#guardConstructing = true;
            const o = new CoreService(args);
            CoreService.#guardConstructing = false;
            return o;
        } catch (err) {
            CoreService.#guardConstructing = false;
            throw err;
        }
    }

    get walletIndex() { return this.#walletIndex; }

    /** @override */
    static runDependencies() {
        const s = super.runDependencies();
        s.add(ResultProxyService.typename());
        s.add(SmsService.typename());
        s.add(BlockchainAdapterService.typename());
        return s;
    }

    /** 
     * @param {srvTypes.CoreConfig} config 
     * @param {boolean} resolvePlaceholders
     * @param {string=} relativeToDirectory
     */
    static async deepCopyConfig(config, resolvePlaceholders, relativeToDirectory) {
        const configCopy = await super.deepCopyConfig(config, resolvePlaceholders, relativeToDirectory);
        assert(configCopy.type === 'core');

        if (resolvePlaceholders) {
            // if needed, retrieves latest version on github
            const gitHubRepo = await this.getGitHubRepo(toPackage(configCopy.repository));
            inplaceResolveSpringServicePlaceholders(
                configCopy, [],
                {
                    "${version}": gitHubRepo.commitish,
                    "${repoName}": gitHubRepo.gitHubRepoName
                });
        }

        return configCopy;
    }

    toJSON() {
        return {
            ... super.toJSON(),
            ipfsHost: this.#ipfsHost,
            blockchainAdapterUrl: this.#blockchainAdapterURL?.toString(),
            smsUrl: this.#smsURL?.toString(),
            resultProxyUrl: this.#resultProxyURL?.toString(),
            walletIndex: this.#walletIndex,
            workerpoolAddress: this.#workerpoolAddress
        };
    }

    /* -------------------------- Private ENV Vars -------------------------- */

    /**
     * @override
     * @param {string} str 
     */
    parseEnvVars(str) {
        return CoreService.parseEnvVars(str);
    }

    /**
     * @override
     * @param {string} str 
    * @returns {CoreServiceConstructorArgs}
     */
    static parseEnvVars(str) {
        const env = super.parseEnvVars(str);
        const varNames = [
            `${envVarName('IPFSHOST')}`,
            `${envVarName('SMSURL')}`,
            `${envVarName('RESULTPROXYURL')}`,
            `${envVarName('BLOCKCHAINADAPTERURL')}`,
            `${envVarName('WALLETINDEX')}`,
            `${envVarName('WORKERPOOLADDRESS')}`,
        ];
        const o = utilsParseEnvVars(varNames, str);
        const idx = stringToPositiveInteger(o[envVarName('WALLETINDEX')]);
        assert(idx);
        return {
            ...env,
            ipfsHost: o[envVarName('IPFSHOST')],
            resultProxyUrl: o[envVarName('RESULTPROXYURL')],
            blockchainAdapterUrl: o[envVarName('BLOCKCHAINADAPTERURL')],
            smsUrl: o[envVarName('SMSURL')],
            walletIndex: idx,
            workerpoolAddress: o[envVarName('WORKERPOOLADDRESS')]
        }
    }

    /**
     * @override
     * @param {{[envName:string] : string}} extras
     * @returns {Promise<{[envName:string] : string}>}
     */
    async getEnvVars(extras) {
        const env = await super.getEnvVars(extras);

        if (this.#ipfsHost) {
            env[envVarName('IPFSHOST')] = this.#ipfsHost;
        }
        if (this.#resultProxyURL) {
            env[envVarName('RESULTPROXYURL')] = this.#resultProxyURL.toString();
        }
        if (this.#smsURL) {
            env[envVarName('SMSURL')] = this.#smsURL.toString();
        }
        if (this.#blockchainAdapterURL) {
            env[envVarName('BLOCKCHAINADAPTERURL')] = this.#blockchainAdapterURL.toString();
        }
        if (this.#walletIndex) {
            env[envVarName('WALLETINDEX')] = this.#walletIndex.toString();
        }
        if (this.#workerpoolAddress) {
            env[envVarName('WORKERPOOLADDRESS')] = this.#workerpoolAddress;
        }

        // // logstash : network address resolution is super slow on MacOS
        // // ============================================================
        // // - Super slow on Mac (at least on BigSur). 
        // // - By default, resolution order is = "network, localhost" (1 minute at least)
        // // - Change it to = "localhost, network" (ms only)
        //env["logstash-gelf.resolutionOrder"] = "localhost,network";

        return env;
    }

    /**
     * @param {srvTypes.InventoryLike | undefined} inventory
     * @param {*} searchArgs
     * @param {?string=} urlStr 
     */
    static async #SmsURL(inventory, searchArgs, urlStr) {
        if (urlStr) {
            new URL(urlStr);
        }
        if (inventory) {
            return inventory.getHubServiceURL('sms', searchArgs.hubRef);
        }
        const urls = await SmsService.runningUrls(searchArgs);
        if (!urls) {
            throw new CodeError('Missing Sms url');
        }
        if (urls.length > 1) {
            throw new CodeError('Ambiguous Sms url. Multiple instances of Sms are running.');
        }
        urlStr = urls[0];

        return new URL(urlStr);
    }

    /**
     * @param {srvTypes.InventoryLike | undefined} inventory
     * @param {*} searchArgs
     * @param {?string=} urlStr 
     */
    static async #ResultProxyURL(inventory, searchArgs, urlStr) {
        if (urlStr) {
            new URL(urlStr);
        }
        if (inventory) {
            return inventory.getHubServiceURL('resultproxy', searchArgs.hubRef);
        }
        const urls = await ResultProxyService.runningUrls(searchArgs);
        if (!urls) {
            throw new CodeError('Missing Result Proxy url');
        }
        if (urls.length > 1) {
            throw new CodeError('Ambiguous Result Proxy url. Multiple instances of Result Proxy are running.');
        }
        urlStr = urls[0];
        return new URL(urlStr);
    }

    /**
     * @param {srvTypes.InventoryLike | undefined} inventory
     * @param {*} searchArgs
     * @param {?string=} urlStr 
     */
    static async #BlockchainAdapterURL(inventory, searchArgs, urlStr) {
        if (urlStr) {
            new URL(urlStr);
        }
        if (inventory) {
            return inventory.getHubServiceURL('blockchainadapter', searchArgs.hubRef);
        }
        const urls = await BlockchainAdapterService.runningUrls(searchArgs);
        if (!urls) {
            throw new CodeError('Missing Blockchain Adapter url');
        }
        if (urls.length > 1) {
            throw new CodeError('Ambiguous Blockchain Adapter url. Multiple instances of Blockchain Adapter are running.');
        }
        urlStr = urls[0];
        return new URL(urlStr);
    }

    /**
     * @param {srvTypes.InventoryLike | undefined} inventory
     * @param {*} searchArgs
     * @param {?string=} host
     */
    static async #IpfsHost(inventory, searchArgs, host) {
        if (host) {
            return stringToHostnamePort(host);
        }
        if (inventory) {
            return inventory.getIpfsApiHost();
        }
        const ipfsServices = await IpfsService.running();
        if (!ipfsServices) {
            throw new CodeError('Missing Ipfs host');
        }
        if (ipfsServices.length > 1) {
            throw new CodeError('Ambiguous Ipfs host. Multiple instances of Ipfs are running.');
        }
        if (!ipfsServices[0].service) {
            throw new CodeError('Ambiguous Ipfs host. Multiple instances of Ipfs are running.');
        }
        return { hostname: ipfsServices[0].service.hostname, port: ipfsServices[0].service.port };
    }

    /* ------------------------------ Install ------------------------------- */

    /**
     * Throws an exception if failed.
     * @param {{
     *      repository: (string | types.Package),
     *      version?: string
     *      branch?: string
     * }} params
     */
    static async install({
        repository,
        version,
        branch
    }) {
        await installServiceClassPackage(this, { repository, version, branch });
    }


    /* ---------------------------- newInstance ----------------------------- */

    /**
     * Throws an exception if failed
     * @param {types.ServerServiceArgs & {
     *      repository: (string | types.Package),
     *      hub: (string | types.PoCoHubRefLike | PoCoHubRef),
     *      springConfigLocation: string,
     *      ymlConfig: any,
     *      mongoHost: string,
     *      mongoDBName: string,
     *      walletIndex?: number,
     *      workerpoolAddress?: string,
     *      ipfsHost?: string,
     *      resultProxyUrl?: string,
     *      smsUrl?: string,
     *      blockchainAdapterUrl?: string,
     * }} params
     * @param {srvTypes.InventoryLike=} inventory
     */
    static async newInstance({
        repository,
        springConfigLocation,
        hub,
        ymlConfig,
        mongoHost,
        mongoDBName,
        walletIndex,
        workerpoolAddress,
        ipfsHost,
        resultProxyUrl,
        smsUrl,
        blockchainAdapterUrl,
        ...options
    }, inventory) {
        assert(repository);

        const pkg = toPackage(repository, this.defaultGitUrl);
        const repoDir = resolveAbsolutePath(pkg.directory);

        throwIfNullishOrEmptyString(repoDir);
        throwIfNullishOrEmptyString(springConfigLocation);
        throwIfDirDoesNotExist(repoDir);

        springConfigLocation = resolveAbsolutePath(springConfigLocation);

        if (!mongoDBName) {
            mongoDBName = 'iexecCore';
        }
        assert(stringIsAlphanum(mongoDBName));

        const { hostname: mongoHostname, port: mongoPort } = stringToHostnamePort(mongoHost);
        throwIfNullishOrEmptyString(mongoHostname);
        throwIfNotStrictlyPositiveInteger(mongoPort);
        assert(mongoHostname);
        assert(mongoPort);

        /** 
         * @type {{
        *      service: GanachePoCoService
        *      PoCoHubRef: PoCoHubRef
        *   }}
        */
        let resolved;
        if (inventory) {
            // Throws an exception if failed.
            resolved = await inventory.resolve(hub);
        } else {
            // Resolve by fetching a running ganache server
            // Throws an exception if failed.
            resolved = await GanachePoCoService.resolveHub(hub);
        }

        const resolvedHubRef = resolved.PoCoHubRef;
        const resolvedGanache = resolved.service;
        assert(resolvedGanache.DBUUID);
        assert(resolvedHubRef.hasDeployConfigName);
        assert(resolvedHubRef.deployConfigName);

        const workerpool = resolvedGanache.workerpool(resolvedHubRef.deployConfigName);
        assert(workerpool);

        if (walletIndex === null || walletIndex === undefined) {
            walletIndex = workerpool.accountIndex;
        }
        throwIfNotPositiveInteger(walletIndex);

        const walletPath = await resolvedGanache.walletFileAtIndex(walletIndex);

        if (workerpoolAddress === null || workerpoolAddress === undefined) {
            workerpoolAddress = workerpool.address;
            assert(walletIndex === workerpool.accountIndex);
        }
        workerpoolAddress = toChecksumAddress(workerpoolAddress);

        const searchArgs = { hubRef: resolvedHubRef, DBUUID: resolvedGanache.DBUUID };

        const res = await Promise.all([
            CoreService.#IpfsHost(inventory, searchArgs, ipfsHost),
            CoreService.#SmsURL(inventory, searchArgs, smsUrl),
            CoreService.#ResultProxyURL(inventory, searchArgs, resultProxyUrl),
            CoreService.#BlockchainAdapterURL(inventory, searchArgs, blockchainAdapterUrl)
        ]);

        const ipfs = res[0];
        const smsURL = res[1];
        const resultProxyURL = res[2];
        const blockchainAdapterURL = res[3];

        let mongoService;
        if (inventory) {
            mongoService = await inventory.newInstanceFromHost(mongoHost);
        } else {
            // Resolve by fetching a running mongo server
            mongoService = await MongoService.fromHost(mongoHost);
        }

        if (!ipfs) {
            throw new CodeError(`${this.typename()}: Missing Ipfs host`,
                ERROR_CODES.CORE_ERROR);
        }
        if (!smsURL) {
            throw new CodeError(
                `${this.typename()}: Missing Sms url`,
                ERROR_CODES.CORE_ERROR);
        }
        if (!resultProxyURL) {
            throw new CodeError(
                `${this.typename()}: Missing Result Proxy url`,
                ERROR_CODES.CORE_ERROR);
        }
        if (!blockchainAdapterURL) {
            throw new CodeError(
                `${this.typename()}: Missing Blockchain Adapter url`,
                ERROR_CODES.CORE_ERROR);
        }
        if (!mongoService) {
            throw new CodeError(
                `${this.typename()} mongo service is not resolved (host=${mongoHost})`,
                ERROR_CODES.MONGO_ERROR);
        }
        assert(mongoService instanceof MongoService);

        /* -------------------- Compute Final Yml Config -------------------- */

        const ymlFileLocation = path.join(repoDir, 'src/main/resources');
        const ymlFullConfig = await parseApplicationYmlFile(ymlFileLocation, { merge: ymlConfig });

        ymlFullConfig.server.port = options.port;

        ymlFullConfig.chain.id = resolvedHubRef.chainid;
        ymlFullConfig.chain['privateAddress'] = resolvedHubRef.httpHost;
        ymlFullConfig.chain['publicAddress'] = resolvedHubRef.httpHost;
        ymlFullConfig.chain['hubAddress'] = resolvedHubRef.address;
        ymlFullConfig.chain['poolAddress'] = workerpoolAddress;
        ymlFullConfig.chain['sidechain'] = resolvedHubRef.isNative ?? false;

        // v7.x.x and earlier
        if (ymlFullConfig.ipfs) {
            ymlFullConfig.ipfs['host'] = ipfs.hostname;
            ymlFullConfig.ipfs['port'] = ipfs.port;
        }

        // v7.x.x and earlier
        if (ymlFullConfig.sms) {
            ymlFullConfig.sms['protocol'] = removeSuffix(':', smsURL.protocol);
            ymlFullConfig.sms['host'] = smsURL.hostname;
            ymlFullConfig.sms['port'] = smsURL.port;
        } else {
            // v8.x.x no more includes 'sms' property
            assert(!ymlFullConfig.sms)
            ymlFullConfig.sms = {
                scone: smsURL.toString(),
                gramine: smsURL.toString(),
            };
        }

        //////////////////////////////
        // v8.x.x and above
        if (ymlFullConfig.spring?.['config.import']) {
            delete ymlFullConfig.spring['config.import'];
        }
        // v8.x.x and above
        if (ymlFullConfig.spring?.['cloud.config']) {
            delete ymlFullConfig.spring['cloud.config'];
            //ymlFullConfig.spring[cloud.config].enabled=false
            ymlFullConfig.spring['cloud.config'] = { enabled: false };
        }
        delete ymlFullConfig.graylog;
        // hostname = Alexandres-MacBook-Pro
        // myFQDNHostName = "Alexandres-MacBook-Pro.local"
        // myAddress = '127.0.0.1'
        //////////////////////////////
        
        ymlFullConfig.resultRepository['protocol'] = removeSuffix(':', resultProxyURL.protocol);
        ymlFullConfig.resultRepository['host'] = resultProxyURL.hostname;
        ymlFullConfig.resultRepository['port'] = resultProxyURL.port;

        ymlFullConfig['blockchain-adapter']['protocol'] = removeSuffix(':', blockchainAdapterURL.protocol);
        ymlFullConfig['blockchain-adapter']['host'] = blockchainAdapterURL.hostname;
        ymlFullConfig['blockchain-adapter']['port'] = blockchainAdapterURL.port;

        ymlFullConfig.spring.data.mongodb['database'] = mongoDBName;
        ymlFullConfig.spring.data.mongodb['host'] = mongoHostname;
        ymlFullConfig.spring.data.mongodb['port'] = mongoPort;

        ymlFullConfig.wallet['encryptedFilePath'] = walletPath;
        ymlFullConfig.wallet['password'] = resolvedGanache.walletsPassword;

        /* ------------------------ Compute Signature ----------------------- */

        // Compute result proxy data signature
        // Postulate, signature mismatch if:
        // - ganache DB has changed
        // - result proxy is started on different hub 
        const sigArg = CoreService.#computeDBSignature({
            mongoDBName,
            hubRef: resolvedHubRef,
            ganacheDBUUID: resolvedGanache.DBUUID,
            ymlConfig: ymlFullConfig
        });

        if (mongoService.addSig(sigArg) === false) {
            throw new CodeError(`${this.typename()} mongo db signature conflict.`,
                ERROR_CODES.SIGNATURE_CONFLICT_ERROR);
        }

        return CoreService.#newCoreService({
            ...options,
            ymlConfig: ymlFullConfig,
            repoDir,
            hub: resolvedHubRef,
            springConfigLocation,
            DBUUID: mongoService.DBUUID,
            mongo: mongoService,
            mongoHost: mongoHostname + ':' + mongoPort.toString(),
            mongoDBName: mongoDBName,
            ipfsHost: ipfs.hostname + ':' + ipfs.port?.toString(),
            smsUrl: smsURL.toString(),
            resultProxyUrl: resultProxyURL.toString(),
            blockchainAdapterUrl: blockchainAdapterURL.toString(),
            walletIndex: workerpool.accountIndex,
            workerpoolAddress: workerpoolAddress
        });
    }

    /**
     * Throws an exception if failed.
     * @param {{
    *      mongoDBName: string,
    *      hubRef: PoCoHubRef,
    *      ganacheDBUUID: string
    *      ymlConfig: any
    * }} params
    * @returns {types.DBSignatureArg}
    */
    static #computeDBSignature({
        mongoDBName,
        hubRef,
        ganacheDBUUID,
        ymlConfig
    }) {
        assert(mongoDBName);
        assert(ganacheDBUUID);
        assert(hubRef);
        assert(hubRef.resolved);
        assert(hubRef.address);
        assert(hubRef.asset);
        assert(hubRef.kyc != null);
        assert(hubRef.uniswap != null);

        /** @type {types.DBSignatureArg} */
        const sig = {
            name: mongoDBName,
            serviceType: this.typename(),
            /** @type {types.DBHubSignature} */
            signature: {
                ganacheDBUUID: ganacheDBUUID,
                hub: {
                    chainid: hubRef.chainid,
                    contractName: hubRef.contractName,
                    address: hubRef.address,
                    asset: hubRef.asset,
                    kyc: hubRef.kyc,
                    uniswap: hubRef.uniswap
                }
            }
        };
        return sig;
    }

    /* ------------------------------ fromPID ------------------------------- */

    /**
     * @override
     * @param {number} pid 
     */
    static async fromPID(pid) {
        const args = await pidToSpringConstructorArgs(pid, this.parseEnvVars);

        if (!args ||
            !args.mongoHost ||
            !args.mongoDBName ||
            !args.ipfsHost ||
            !args.blockchainAdapterUrl ||
            !args.resultProxyUrl ||
            !args.smsUrl ||
            !args.walletIndex) { return null; }

        assert(args.port);
        assert(args.hub);

        /* ---------------------- Verify Yml Config ------------------------- */

        if (args.ymlConfig) {
            const ymlConfig = args.ymlConfig;
            const hub = args.hub;

            const chainid = ymlConfig.chain.id;
            const ethURL = new URL(ymlConfig.chain['publicAddress']);
            const address = ymlConfig.chain['hubAddress'];
            const isNative = (ymlConfig.chain['sidechain'] === true);
            const asset = (isNative) ? 'Native' : 'Token';

            // No more available in v8.x.x
            // const _ipfsHost =
            //     ymlConfig.ipfs['host'] + ":" +
            //     ymlConfig.ipfs['port'].toString();
            // No more available in v8.x.x
            // const _smsUrl =
            //     ymlConfig.sms['protocol'] + "://" +
            //     ymlConfig.sms['host'] + ":" +
            //     ymlConfig.sms['port'].toString();
            const _resultProxyUrl =
                ymlConfig.resultRepository['protocol'] + "://" +
                ymlConfig.resultRepository['host'] + ":" +
                ymlConfig.resultRepository['port'].toString();
            const _blockchainAdapterUrl =
                ymlConfig['blockchain-adapter']['protocol'] + "://" +
                ymlConfig['blockchain-adapter']['host'] + ":" +
                ymlConfig['blockchain-adapter']['port'].toString();
            const _mongoHost =
                ymlConfig.spring.data.mongodb['host'] + ":" +
                ymlConfig.spring.data.mongodb['port'].toString();
            const _mongoDBName = ymlConfig.spring.data.mongodb['database'];

            assert(removeSuffix('/', args.resultProxyUrl) === _resultProxyUrl);
            //assert(removeSuffix('/', args.smsUrl) === _smsUrl);
            assert(removeSuffix('/', args.blockchainAdapterUrl) === _blockchainAdapterUrl);
            //assert(args.ipfsHost === _ipfsHost);
            assert(args.mongoHost === _mongoHost);
            assert(args.mongoDBName === _mongoDBName);
            assert(args.port === ymlConfig.server.port);
            assert(ymlConfig.chain['publicAddress'] === ymlConfig.chain['privateAddress']);
            assert(hub.chainid === chainid);
            assert(hub.address === address);
            assert(hub.asset === asset);
            assert(hub.url?.toString() === ethURL.toString());

            // A few asserts to make sure everything is consistant
            if (hub.isNative) {
                assert(ymlConfig.chain['sidechain'] === true);
            } else {
                assert(ymlConfig.chain['sidechain'] === false);
            }
        }

        /* ---------------------- Instanciate DB Object---------------------- */

        let mongo;
        try {
            mongo = await MongoService.fromHost(args.mongoHost);
        } catch { }

        if (mongo) {
            if (args.DBUUID !== mongo.DBUUID) {
                // - process was launched on an old db directory version
                // - process does not include the DBUUID env var
                mongo = undefined;
            }
        } else {
            mongo = undefined;
        }

        args.mongo = mongo;

        return CoreService.#newCoreService(args);
    }

    /**
     * @param {object} args 
     * @param {string=} args.DBUUID 
     * @param {PoCoHubRef=} args.hubRef 
     * @param {string=} args.springConfigLocation 
     * @param {string=} args.mongoHost 
     * @param {string=} args.resultProxyUrl 
     */
    static async runningPIDs({ resultProxyUrl, ...others } = {}) {
        const pids = await super.runningPIDs(others);
        if (!pids) {
            return null;
        }

        // Apply filters
        /** @type {{ pid: number, command: string, envs:any }[]} */
        const filteredPids = [];
        pids.forEach(pidStruct => {
            const envs = this.parseEnvVars(pidStruct.command);

            if (resultProxyUrl) {
                if (resultProxyUrl !== envs.resultProxyUrl) {
                    return;
                }
            }

            filteredPids.push(pidStruct);
        });

        return filteredPids;
    }

    /**
     * @override
     * @protected
     * @param {number} pid 
     */
    getFailureExcludePatterns(pid) {
        return [
            'com.iexec.core.chain.DealWatcherService  : Deal has expired',
        ];
    }
}
