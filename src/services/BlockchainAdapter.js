import * as types from '../common/common-types.js';
import * as srvTypes from './services-types-internal.js';
import path from 'path';
import assert from 'assert';
import * as ERROR_CODES from "../common/error-codes.js";
import { GanachePoCoService } from '../poco/GanachePoCoService.js';
import { Market } from './Market.js';
import { MongoService } from './MongoService.js';
import { inplaceResolveSpringServicePlaceholders, installServiceClassPackage, pidToSpringConstructorArgs, SpringMongoServerService } from './spring-serverservice.js';
import { parseApplicationYmlFile } from './application-dot-yml.js';
import { getLatestVersion } from '../git/git-api.js';
import { toPackage } from '../pkgmgr/pkg.js';
import { stringIsAlphanum, stringToHostnamePort, stringToPositiveInteger, throwIfNullishOrEmptyString } from '../common/string.js';
import { parseEnvVars as utilsParseEnvVars } from '../common/utils.js';
import { PoCoHubRef } from '../common/contractref.js';
import { resolveAbsolutePath, throwIfDirDoesNotExist } from '../common/fs.js';
import { throwIfNotPositiveInteger, throwIfNotStrictlyPositiveInteger } from '../common/number.js';
import { CodeError } from '../common/error.js';
import { envVarName } from '../common/consts.js';

/**
 * @typedef {import('./spring-serverservice.js').SpringMongoServerServiceConstructorArgs & 
 * {
 *      marketApiUrl?: string,
 *      walletIndex?: number
 * }} BlockchainAdapterServiceConstructorArgs
 */

/* ---------------------- BlockchainAdapterService Class -------------------------- */

export class BlockchainAdapterService extends SpringMongoServerService {

    /** 
     * @override
     * @returns {typeof BlockchainAdapterService} 
     */
    theClass() { return BlockchainAdapterService; }

    /** @override */
    static typename() { return 'blockchainadapter'; }
    /** @override */
    static CLASSNAME() { return 'com.iexec.blockchain.' + BlockchainAdapterService.ENTRY(); }
    /** @override */
    static ENTRY() { return 'Application'; }
    /** @override */
    static get defaultGitUrl() { return 'https://github.com/iExecBlockchainComputing/iexec-blockchain-adapter-api.git'; }
    /** @override */
    static get gitHubRepoName() { return 'iexec-blockchain-adapter-api'; }

    CLASSNAME() { return BlockchainAdapterService.CLASSNAME(); }
    ENTRY() { return BlockchainAdapterService.ENTRY(); }

    /** @type {string} */
    static #latestVersion;

    /** @type {boolean} */
    static #guardConstructing = false;

    /** @type {URL=} */
    #marketApiUrl;

    /** @type {number=} */
    #walletIndex;

    /** @override */
    static async latestVersion() {
        if (!BlockchainAdapterService.#latestVersion) {
            BlockchainAdapterService.#latestVersion = await getLatestVersion(this.defaultGitUrl);
        }
        return BlockchainAdapterService.#latestVersion;
    }

    /**
     * @param {BlockchainAdapterServiceConstructorArgs} args
     */
    constructor(args) {
        if (!BlockchainAdapterService.#guardConstructing) {
            throw new TypeError('class constructor is not accessible');
        }

        super(args);

        assert(args.marketApiUrl);
        this.#marketApiUrl = new URL(args.marketApiUrl);
        this.#walletIndex = args.walletIndex;
    }

    /** @param {BlockchainAdapterServiceConstructorArgs} args */
    static #newBlockchainAdapterService(args) {
        try {
            BlockchainAdapterService.#guardConstructing = true;
            const o = new BlockchainAdapterService(args);
            BlockchainAdapterService.#guardConstructing = false;
            return o;
        } catch (err) {
            BlockchainAdapterService.#guardConstructing = false;
            throw err;
        }
    }

    get marketApiURL() { return this.#marketApiUrl; }
    get walletIndex() { return this.#walletIndex; }

    /** @override */
    static runDependencies() {
        const s = super.runDependencies();
        s.add(Market.typename());
        return s;
    }

    /** 
     * @param {srvTypes.BlockchainAdapterConfig} config 
     * @param {boolean} resolvePlaceholders
     * @param {{[varname:string]: string}} placeholders
     * @param {string=} relativeToDirectory
     */
    static async deepCopyConfig(config, resolvePlaceholders, placeholders, relativeToDirectory) {
        const configCopy = await super.deepCopyConfig(
            config, 
            false, /* replace is performed below, because of extra properties */
            placeholders, 
            relativeToDirectory);
        assert(configCopy.type === 'blockchainadapter');

        if (resolvePlaceholders) {
            // Warning : 'configCopy.repository' is calculated in 'super.deepCopyConfig(...)'
            // if needed, retrieves latest version on github
            const gitHubRepo = await this.getGitHubRepo(toPackage(configCopy.repository));
            inplaceResolveSpringServicePlaceholders(
                configCopy, ["mongoHost", "marketApiUrl"],
                {
                    ...placeholders,
                    "${version}": gitHubRepo.commitish,
                    "${repoName}": gitHubRepo.gitHubRepoName,
                });
        }

        return configCopy;
    }

    toJSON() {
        return {
            ... super.toJSON(),
            marketApiUrl: this.#marketApiUrl,
            walletIndex: this.#walletIndex
        };
    }

    /* -------------------------- Private ENV Vars -------------------------- */

    /**
     * @override
     * @param {string} str 
     */
    parseEnvVars(str) {
        return BlockchainAdapterService.parseEnvVars(str);
    }

    /**
     * @override
     * @param {string} str 
    * @returns {BlockchainAdapterServiceConstructorArgs}
     */
    static parseEnvVars(str) {
        const env = super.parseEnvVars(str);
        const varNames = [
            envVarName('MARKETAPIURL'),
            envVarName('WALLETINDEX'),
        ];
        const o = utilsParseEnvVars(varNames, str);
        const idx = stringToPositiveInteger(o[envVarName('WALLETINDEX')]);
        assert(idx);
        return {
            ...env,
            marketApiUrl: o[envVarName('MARKETAPIURL')],
            walletIndex: idx
        }
    }

    /**
     * @override
     * @param {{[envName:string] : string}} extras
     * @returns {Promise<{[envName:string] : string}>}
     */
    async getEnvVars(extras) {
        const env = await super.getEnvVars(extras);

        if (this.#marketApiUrl) {
            env[envVarName('MARKETAPIURL')] = this.#marketApiUrl.toString();
        }
        if (this.#walletIndex) {
            env[envVarName('WALLETINDEX')] = this.#walletIndex.toString();
        }
        return env;
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
     *      marketApiUrl?: string,
     *      walletIndex?: number
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
        marketApiUrl,
        walletIndex,
        ...options
    }, inventory) {
        assert(repository);
        const pkg = toPackage(repository, this.defaultGitUrl);
        const repoDir = resolveAbsolutePath(pkg.directory);

        throwIfNullishOrEmptyString(repoDir);
        throwIfNullishOrEmptyString(springConfigLocation);
        throwIfNullishOrEmptyString(marketApiUrl);

        throwIfDirDoesNotExist(repoDir);

        springConfigLocation = resolveAbsolutePath(springConfigLocation);

        if (!mongoDBName) {
            mongoDBName = 'iexecBlockchainAdapterApi';
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

        if (walletIndex === null || walletIndex === undefined) {
            const workerpool = resolvedGanache.workerpool(resolvedHubRef.deployConfigName);
            assert(workerpool);
            walletIndex = workerpool.accountIndex;
        }
        throwIfNotPositiveInteger(walletIndex);

        const walletPath = await resolvedGanache.walletFileAtIndex(walletIndex);

        if (!marketApiUrl) {
            if (inventory) {
                /** @todo use inventory to retrieve marketApiUrl */
                assert(false, 'TODO: use inventory to retrieve marketApiUrl');
            } else {
                const apiUrls = await Market.apiUrl(resolvedHubRef, resolvedGanache.DBUUID);
                if (!apiUrls || apiUrls.length === 0) {
                    throw new CodeError('Missing api url');
                }
                marketApiUrl = apiUrls[0];
            }
        }
        const marketApiURL = new URL(marketApiUrl);
        const marketApiURLStr = marketApiURL.toString();

        /* -------------------- Compute Final Yml Config -------------------- */

        const ymlFileLocation = path.join(repoDir, 'src/main/resources');
        const ymlFullConfig = await parseApplicationYmlFile(ymlFileLocation, { merge: ymlConfig });

        ymlFullConfig.server.port = options.port;

        ymlFullConfig.chain.id = resolvedHubRef.chainid;
        ymlFullConfig.chain['node-address'] = resolvedHubRef.httpHost;
        ymlFullConfig.chain['hub-address'] = resolvedHubRef.address;
        ymlFullConfig.chain['is-sidechain'] = resolvedHubRef.isNative ?? false;
        ymlFullConfig.chain['broker-url'] = marketApiURLStr;

        ymlFullConfig.spring.data.mongodb['database'] = mongoDBName;
        ymlFullConfig.spring.data.mongodb['host'] = mongoHostname;
        ymlFullConfig.spring.data.mongodb['port'] = mongoPort;

        ymlFullConfig.wallet['path'] = walletPath;
        ymlFullConfig.wallet['password'] = resolvedGanache.walletsPassword;

        /* ------------------------ Compute Signature ----------------------- */

        // Compute result proxy data signature
        // Postulate, signature mismatch if:
        // - ganache DB has changed
        // - result proxy is started on different hub 
        const sigArg = BlockchainAdapterService.#computeDBSignature({
            mongoDBName,
            hubRef: resolvedHubRef,
            ganacheDBUUID: resolvedGanache.DBUUID,
            ymlConfig: ymlFullConfig
        });

        let mongoService;
        if (inventory) {
            mongoService = await inventory.newInstanceFromHost(mongoHost);
        } else {
            // Resolve by fetching a running mongo server
            mongoService = await MongoService.fromHost(mongoHost);
        }

        if (!mongoService) {
            throw new CodeError(
                `${this.typename()} mongo service is not resolved (host=${mongoHost})`,
                ERROR_CODES.MONGO_ERROR);
        }

        assert(mongoService instanceof MongoService);
        if (mongoService.addSig(sigArg) === false) {
            throw new CodeError(`${this.typename()} mongo db signature conflict.`,
                ERROR_CODES.SIGNATURE_CONFLICT_ERROR);
        }

        return BlockchainAdapterService.#newBlockchainAdapterService({
            ...options,
            ymlConfig: ymlFullConfig,
            repoDir,
            hub: resolvedHubRef,
            springConfigLocation,
            DBUUID: mongoService.DBUUID,
            mongo: mongoService,
            mongoHost: mongoHostname + ':' + mongoPort.toString(),
            mongoDBName: mongoDBName,
            marketApiUrl: marketApiURLStr,
            walletIndex
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

        if (!args) {
            return null;
        }
        if (!args.mongoHost) {
            return null;
        }
        if (!args.mongoDBName) {
            return null;
        }
        if (!args.marketApiUrl) {
            return null;
        }
        if (!args.walletIndex) {
            return null;
        }

        assert(args.port);
        assert(args.hub);

        /* ---------------------- Verify Yml Config ------------------------- */

        if (args.ymlConfig) {
            const ymlConfig = args.ymlConfig;
            const hub = args.hub;

            const chainid = ymlConfig.chain.id;
            const ethURL = new URL(ymlConfig.chain['node-address']);
            const address = ymlConfig.chain['hub-address'];
            const isNative = (ymlConfig.chain['is-sidechain'] === true);
            const asset = (isNative) ? 'Native' : 'Token';

            const _marketApiUrl = ymlConfig.chain['broker-url'];

            const _mongoHost =
                ymlConfig.spring.data.mongodb['host'] + ":" +
                ymlConfig.spring.data.mongodb['port'].toString();
            const _mongoDBName = ymlConfig.spring.data.mongodb['database'];

            assert(args.marketApiUrl === _marketApiUrl);
            assert(args.mongoHost === _mongoHost);
            assert(args.mongoDBName === _mongoDBName);
            assert(args.port === ymlConfig.server.port);
            assert(hub.chainid === chainid);
            assert(hub.address === address);
            assert(hub.asset === asset);
            assert(hub.url?.toString() === ethURL.toString());

            // A few asserts to make sure everything is consistant
            if (hub.isNative) {
                assert(ymlConfig.chain['is-sidechain'] === true);
            } else {
                assert(ymlConfig.chain['is-sidechain'] === false);
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

        return BlockchainAdapterService.#newBlockchainAdapterService(args);
    }
}
