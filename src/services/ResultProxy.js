import * as types from '../common/common-types.js';
import * as srvTypes from './services-types-internal.js';
import * as ERROR_CODES from "../common/error-codes.js";
import path from 'path';
import assert from 'assert';
import { parseEnvVars as utilsParseEnvVars } from '../common/utils.js';
import { Wallet } from 'ethers';
import { MongoService } from './MongoService.js';
import { installServiceClassPackage, pidToSpringConstructorArgs, inplaceResolveSpringServicePlaceholders, SpringMongoServerService } from './spring-serverservice.js';
import { parseApplicationYmlFile } from './application-dot-yml.js';
import { getLatestVersion } from '../git/git-api.js';
import { IpfsService } from '../ipfs/IpfsService.js';
import { toPackage, toPackageDirectory } from '../pkgmgr/pkg.js';
import { PoCoHubRef } from '../common/contractref.js';
import { resolveAbsolutePath, throwIfDirDoesNotExist, throwIfNotAbsolutePath } from '../common/fs.js';
import { isNullishOrEmptyString, stringIsAlphanum, stringToHostnamePort, throwIfNullishOrEmptyString } from '../common/string.js';
import { CodeError } from '../common/error.js';
import { throwIfNotStrictlyPositiveInteger } from '../common/number.js';
import { GanachePoCoService } from '../poco/GanachePoCoService.js';
import { httpPOST } from '../common/http.js';
import { envVarName } from '../common/consts.js';

/**
 * @typedef {import('./spring-serverservice.js').SpringMongoServerServiceConstructorArgs & 
 * {
 *      ipfsHost: string
 * }} ResultProxyServiceConstructorArgs
 */

/* ---------------------- ResultProxyService Class -------------------------- */

export class ResultProxyService extends SpringMongoServerService {

    /** 
     * @override
     * @returns {typeof ResultProxyService} 
     */
    theClass() { return ResultProxyService; }

    static typename() { return 'resultproxy'; }
    static CLASSNAME() { return 'com.iexec.resultproxy.' + ResultProxyService.ENTRY(); }
    static ENTRY() { return 'Application'; }

    CLASSNAME() { return ResultProxyService.CLASSNAME(); }
    ENTRY() { return ResultProxyService.ENTRY(); }

    /** @type {boolean} */
    static #guardConstructing = false;

    /** @type {string=} */
    #ipfsHost;

    /** @override */
    static get defaultGitUrl() {
        return 'https://github.com/iExecBlockchainComputing/iexec-result-proxy.git';
    }
    /** @override */
    static get gitHubRepoName() { return 'iexec-result-proxy'; }

    /** @type {string} */
    static #latestVersion;

    /** @override */
    static async latestVersion() {
        if (!ResultProxyService.#latestVersion) {
            ResultProxyService.#latestVersion = await getLatestVersion(this.defaultGitUrl);
        }
        return ResultProxyService.#latestVersion;
    }

    /**
     * @param {ResultProxyServiceConstructorArgs} args
     */
    constructor(args) {
        if (!ResultProxyService.#guardConstructing) {
            throw new TypeError('class constructor is not accessible');
        }

        super(args);

        this.#ipfsHost = args.ipfsHost;
    }

    /** @param {ResultProxyServiceConstructorArgs} args */
    static #newResultProxyService(args) {
        try {
            ResultProxyService.#guardConstructing = true;
            const o = new ResultProxyService(args);
            ResultProxyService.#guardConstructing = false;
            return o;
        } catch (err) {
            ResultProxyService.#guardConstructing = false;
            throw err;
        }
    }

    get ipfsHost() { return this.#ipfsHost; }

    /** @override */
    static runDependencies() {
        const s = super.runDependencies();
        s.add(IpfsService.typename());
        return s;
    }

    /** 
     * @param {srvTypes.ResultProxyConfig} config 
     * @param {boolean} resolvePlaceholders
     * @param {string=} relativeToDirectory
     */
    static async deepCopyConfig(config, resolvePlaceholders, relativeToDirectory) {
        const configCopy = await super.deepCopyConfig(config, resolvePlaceholders, relativeToDirectory);
        assert(configCopy.type === 'resultproxy');

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
            ipfsHost: this.#ipfsHost
        };
    }

    /* -------------------------- Private ENV Vars -------------------------- */

    /**
     * @override
     * @param {string} str 
     */
    parseEnvVars(str) {
        return ResultProxyService.parseEnvVars(str);
    }

    /**
     * @override
     * @param {string} str 
    * @returns {ResultProxyServiceConstructorArgs}
     */
    static parseEnvVars(str) {
        const env = super.parseEnvVars(str);
        const varNames = [
            envVarName('IPFSHOST')
        ];
        const o = utilsParseEnvVars(varNames, str);
        return {
            ...env,
            ipfsHost: o[envVarName('IPFSHOST')],
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

        return env;
    }

    /* ------------------------------ Install ------------------------------- */

    /**
     * Throws an exception if failed.
     * @param {{
     *      repository: (string | types.Package),
     *      version?: string
     * }} params
     */
    static async install({
        repository,
        version
    }) {
        await installServiceClassPackage(this, { repository, version });
    }

    /* ---------------------------- newInstance ----------------------------- */

    /**
     * Throws an exception if failed
     * @param {types.ServerServiceArgs & {
     *      repository: (string | types.Package),
     *      hub: (string | types.PoCoHubRefLike | PoCoHubRef),
     *      springConfigLocation: string
     *      ymlConfig: any
     *      mongoHost: string
     *      mongoDBName: string
     *      ipfsHost?: string
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
        ipfsHost,
        ...options
    }, inventory) {
        assert(repository);

        // Does not resolve anything
        let repoDir = toPackageDirectory(repository);
        throwIfNotAbsolutePath(repoDir);

        throwIfNullishOrEmptyString(springConfigLocation);
        throwIfNotAbsolutePath(springConfigLocation);

        // cleanup paths
        repoDir = resolveAbsolutePath(repoDir);
        springConfigLocation = resolveAbsolutePath(springConfigLocation);
        
        throwIfDirDoesNotExist(repoDir);

        if (!mongoDBName) {
            mongoDBName = 'iexecResultProxy';
        }
        assert(stringIsAlphanum(mongoDBName));

        if (!ipfsHost) {
            if (inventory) {
                const h = inventory.getIpfsApiHost();
                if (!h) {
                    throw new CodeError('No Ipfs service is configured.', ERROR_CODES.IPFS_ERROR);
                }
                ipfsHost = h.hostname + ":" + h.port.toString();
            } else {
                // Auto-detect ipfs
                const ipfsServices = await IpfsService.running();
                if (!ipfsServices || ipfsServices.length === 0) {
                    throw new CodeError('No Ipfs service is running.', ERROR_CODES.IPFS_ERROR);
                }
                if (ipfsServices.length > 1) {
                    throw new CodeError('Multiple Ipfs services are running.', ERROR_CODES.IPFS_ERROR);
                }
                assert(ipfsServices[0].service);
                ipfsHost = ipfsServices[0].service.hostname + ":" + ipfsServices[0].service.apiPort;
            }
        }

        const { hostname: ipfsHostname, port: ipfsAPIPort } = stringToHostnamePort(ipfsHost);
        throwIfNullishOrEmptyString(ipfsHostname);
        throwIfNotStrictlyPositiveInteger(ipfsAPIPort);
        assert(ipfsHostname);
        assert(ipfsAPIPort);

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

        /* -------------------- Compute Final Yml Config -------------------- */

        const ymlFileLocation = path.join(repoDir, 'src/main/resources');
        const ymlFullConfig = await parseApplicationYmlFile(ymlFileLocation, { merge: ymlConfig });

        ymlFullConfig.server.port = options.port;

        ymlFullConfig.chain.id = resolvedHubRef.chainid;
        ymlFullConfig.chain['publicAddress'] = resolvedHubRef.httpHost;
        ymlFullConfig.chain['privateAddress'] = resolvedHubRef.httpHost;
        ymlFullConfig.chain['hubAddress'] = resolvedHubRef.address;
        ymlFullConfig.chain['sidechain'] = resolvedHubRef.isNative ?? false;

        ymlFullConfig.ipfs['host'] = ipfsHostname;
        ymlFullConfig.ipfs['port'] = ipfsAPIPort;

        ymlFullConfig.spring.data.mongodb['database'] = mongoDBName;
        ymlFullConfig.spring.data.mongodb['host'] = mongoHostname;
        ymlFullConfig.spring.data.mongodb['port'] = mongoPort;

        // v8.x.x
        if (ymlFullConfig.jwt) {
            ymlFullConfig.jwt['key-path'] = path.join(springConfigLocation, 'jwt-sign.key');
        }

        /* ------------------------ Compute Signature ----------------------- */

        // Compute result proxy data signature
        // Postulate, signature mismatch if:
        // - ganache DB has changed
        // - result proxy is started on different hub 
        const sigArg = ResultProxyService.#computeDBSignature({
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
        assert(mongoService instanceof MongoService);

        if (!mongoService) {
            throw new CodeError(
                `${this.typename()} mongo service is not resolved (host=${mongoHost})`,
                ERROR_CODES.MONGO_ERROR);
        }
        if (mongoService.addSig(sigArg) === false) {
            throw new CodeError(`${this.typename()} mongo db signature conflict.`,
                ERROR_CODES.SIGNATURE_CONFLICT_ERROR);
        }

        return ResultProxyService.#newResultProxyService({
            ...options,
            ymlConfig: ymlFullConfig,
            repoDir,
            hub: resolvedHubRef,
            springConfigLocation,
            DBUUID: mongoService.DBUUID,
            ipfsHost: ipfsHostname + ':' + ipfsAPIPort.toString(),
            mongo: mongoService,
            mongoHost: mongoHostname + ':' + mongoPort.toString(),
            mongoDBName: mongoDBName,
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
        if (!args.ipfsHost) {
            return null;
        }

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

            const _ipfsHost = ymlConfig.ipfs.host + ":" + ymlConfig.ipfs.port.toString();

            const _mongoHost =
                ymlConfig.spring.data.mongodb['host'] + ":" +
                ymlConfig.spring.data.mongodb['port'].toString();
            const _mongoDBName = ymlConfig.spring.data.mongodb['database'];

            assert(args.ipfsHost === _ipfsHost);
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

        return ResultProxyService.#newResultProxyService(args);
    }

    /**
     * @param {Wallet} signer 
     */
    async login(signer) {
        if (!(signer instanceof Wallet)) {
            throw new TypeError('Invalid signer');
        }

        const chainid = this.hub?.chainid;
        if (!chainid) {
            throw new CodeError('Invalid chainid');
        }

        const authorization = await this.getAuthorization(
            '/results/challenge',
            chainid,
            signer);

        if (!authorization) {
            throw new CodeError(`${this.typename()}: Challenge computation failed.`);
        }

        try {
            const response = await httpPOST(
                this.url,
                `/results/login?chainId=${chainid}`,
                null,
                authorization
            );
            assert(!isNullishOrEmptyString(response));
            return response; //the token
        } catch (err) { }

        throw new CodeError(`${this.typename()}: login failed.`);
    }
}
