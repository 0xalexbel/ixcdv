import * as types from '../common/common-types.js';
import * as srvTypes from './services-types-internal.js';
import * as ERROR_CODES from "../common/error-codes.js";
import path from 'path';
import assert from 'assert';
import { GanachePoCoService } from '../poco/GanachePoCoService.js';
import { MongoService } from './MongoService.js';
import { RedisService } from './RedisService.js';
import { MarketApiService, newMarketApiService } from './MarketApiService.js';
import { MarketWatcherService, newMarketWatcherService } from './MarketWatcherService.js';
import { installServiceClassPackage } from './spring-serverservice.js';
import { ENV_FILE_BASENAME } from './base-internal.js';
import { AbstractService, Service } from '../common/service.js';
import { ContractRef, ContratRefFromString, PoCoHubRef } from '../common/contractref.js';
import { deepCopyPackage } from '../pkgmgr/pkgmgr-deepcopy.js';
import { dirExists, mkDirP, resolveAbsolutePath, throwIfNotAbsolutePath, toRelativePath } from '../common/fs.js';
import { isPackageOrDirectory, toPackage } from '../pkgmgr/pkg.js';
import { hostnamePortToString, isNullishOrEmptyString, placeholdersPropertyReplace, throwIfNullishOrEmptyString } from '../common/string.js';
import { GanacheService } from '../common/ganache.js';
import { CodeError } from '../common/error.js';
import { getLatestVersion } from '../git/git-api.js';
import { getPIDCWD, psGetEnv } from '../common/ps.js';
import { envVarName } from '../common/consts.js';

export const MARKET_SIGNAME = 'market';
export const MARKET_TYPENAME = 'market';

/**
 * @param {types.DBSignatureItem} sigItem 
 * @param {*} hubRef 
 * @param {*} ganacheDBUUID 
 */
export function marketEqSigItem(sigItem, hubRef, ganacheDBUUID) {
    return (sigItem.serviceType === MARKET_TYPENAME &&
        sigItem.signature?.[hubRef.chainid.toString()] === ganacheDBUUID);
}

/* -------------------- Market Class ----------------------- */

export class Market extends AbstractService {

    /** 
     * @override
     * @returns {typeof Market} 
     */
    theClass() { return Market; }

    /** @type {boolean} */
    static #guardConstructing = false;

    static typename() { return 'market'; }
    typename() { return Market.typename(); }

    /** @type {string=} */
    #repository;

    /** @type {MongoService=} */
    #mongo;
    /** @type {RedisService=} */
    #redis;

    /** @type {MarketApiService=} */
    #api;

    /** @type {MarketWatcherService[]} */
    #watchers = [];

    /** @type {Map<string,PoCoHubRef>} */
    #apiHubRefs;

    constructor() {
        if (!Market.#guardConstructing) {
            throw new TypeError('class constructor is not accessible');
        }
        super(undefined); //compiler
        this.#apiHubRefs = new Map();
    }

    get #apiRepoDir() {
        assert(this.#repository);
        return path.join(this.#repository, 'api');
    }
    get #watcherRepoDir() {
        assert(this.#repository);
        return path.join(this.#repository, 'watcher');
    }
    get #countApis() {
        return (this.#api) ? 1 : 0;
    }
    get #countWatchers() {
        return (this.#watchers) ? this.#watchers.length : 0;
    }

    get api() {
        return this.#api;
    }
    get mongo() {
        assert(this.#mongo);
        return this.#mongo;
    }
    get redis() {
        assert(this.#redis);
        return this.#redis;
    }

    /**
     * @param {PoCoHubRef} hub 
     */
    getWatcherFromHub(hub) {
        for (let i = 0; i < this.#watchers.length; ++i) {
            if (hub.eq(this.#watchers[i].hub)) {
                return this.#watchers[i];
            }
        }
        return undefined;
    }

    /** 
     * @override
     * @returns {Set<string>} 
     */
    static runDependencies() {
        const s = new Set();
        s.add(GanachePoCoService.typename());
        s.add(MongoService.typename());
        s.add(RedisService.typename());
        return s;
    }

    /** 
     * - if `resolvePlaceholders === true` : may retrieve repo latest version from github 
     * @param {srvTypes.MarketConfig} config 
     * @param {boolean} resolvePlaceholders
     * @param {string=} relativeToDirectory
     */
    static async deepCopyConfig(config, resolvePlaceholders, relativeToDirectory) {
        const configCopy = { ...config };
        configCopy.mongo = { ...config.mongo };
        configCopy.redis = { ...config.redis };
        assert(configCopy.type === 'market');

        if (configCopy.repository) {
            configCopy.repository = deepCopyPackage(configCopy.repository, relativeToDirectory);
        }

        if (relativeToDirectory) {
            if (configCopy.directory) {
                configCopy.directory = toRelativePath(relativeToDirectory, configCopy.directory);
            }
            if (configCopy.mongo.directory) {
                configCopy.mongo.directory = toRelativePath(relativeToDirectory, configCopy.mongo.directory);
            }
            if (configCopy.redis.directory) {
                configCopy.redis.directory = toRelativePath(relativeToDirectory, configCopy.redis.directory);
            }
        }
        if (config.api) {
            configCopy.api.chains = [...config.api.chains];
        }
        if (Array.isArray(config.watchers)) {
            configCopy.watchers = [...config.api.chains];
        }

        if (resolvePlaceholders) {
            // if needed, retrieves latest version on github
            const gitHubRepo = await this.getGitHubRepo(toPackage(configCopy.repository));
            const placeholders = {
                "${version}": gitHubRepo.commitish,
                "${repoName}": gitHubRepo.gitHubRepoName
            };
            placeholdersPropertyReplace(configCopy, 'directory', placeholders);
            placeholdersPropertyReplace(configCopy.mongo, 'directory', placeholders);
            placeholdersPropertyReplace(configCopy.redis, 'directory', placeholders);
            if (typeof configCopy.repository === 'string') {
                placeholdersPropertyReplace(configCopy, 'repository', placeholders);
            } else {
                placeholdersPropertyReplace(configCopy.repository, 'directory', placeholders);
            }
        }

        return configCopy;
    }

    /**
     * @param {(string | types.PoCoHubRefLike | { logFile?: string, hub: types.PoCoHubRefLike })} watcherArg
     * @returns {{ hubRef?: types.DevContractRefLike, logFile?: string}}
     */
    static #watcherArgToDevLike(watcherArg) {
        if (!watcherArg) {
            return { hubRef: undefined, logFile: undefined };
        }

        let logFile;
        let hubRef;
        if (typeof watcherArg === 'string') {
            // {PoCoHubRef | DevContractRef | ContractRef | null}
            hubRef = ContratRefFromString(watcherArg, 'ERC1538Proxy');
        } else if (watcherArg instanceof ContractRef) {
            // {ContractRef}
            hubRef = watcherArg;
        } else if (typeof watcherArg === 'object') {
            /** @type {any} compiler */
            const a = watcherArg;
            if (a.hub) {
                hubRef = a.hub;
                logFile = a.logFile;
            } else {
                // types.PoCoHubRefLike
                hubRef = a;
            }
        }

        return { hubRef, logFile };
    }


    /**
     * @param {{
     *      api: { hostname?: string, port: number, chains:(string | PoCoHubRef)[] }
     *      watchers?: (string | (string | types.PoCoHubRefLike | { logFile?: string, hub: types.PoCoHubRefLike })[]) 
     * }} config
     */
    static watcherHubs(config) {
        /** @type {string[]} */
        let hubs = [];
        const watchers = config.watchers;
        if (!watchers) {
            return hubs;
        }
        if (typeof watchers === 'string') {
            assert(watchers === 'all');
            hubs = config.api.chains.map((v) => {
                if (typeof v === 'string') {
                    return v;
                } else {
                    assert(v.hasDeployConfigName);
                    return v.chainid.toString() + "." + v.deployConfigName;
                }
            });
        } else {
            hubs = watchers.map((v) => {
                if (typeof v === 'string') {
                    return v;
                } else if (v instanceof PoCoHubRef) {
                    assert(v.hasDeployConfigName);
                    return v.hubAlias();
                } else {
                    /** @type {any} */
                    const vAny = v;
                    if (vAny.hub) {
                        return vAny.hub.chainid.toString() + "." + vAny.hub.deployConfigName;
                    } else {
                        return vAny.chainid.toString() + "." + vAny.deployConfigName;
                    }
                }
            });
        }
        return hubs
    }

    /**
     * - Api server : 1 unique hub per chainid
     * - By construction : 2 Api servers cannot share the same hub
     * @param {Map<number, GanacheService>} chainidToGanacheService
     * @param {{
     *      directory?: string,
     *      mongoHost: string,
     *      redisHost: string,
     *      apiArgs?: types.ServerServiceArgs & {
     *          chains?: (string | types.PoCoHubRefLike)[]
     *      } | null,
     *      watcherArgs?: 'all' | 
     *                    (string | types.PoCoHubRefLike | { logFile?: string, hub: types.PoCoHubRefLike })[] | 
     *                    null
     * }} args
     * @returns {Promise<types.DBSignatureArg>}
     */
    async #initApisAndWatchers(chainidToGanacheService, {
        directory,
        mongoHost,
        redisHost,
        apiArgs,
        watcherArgs
    }) {
        assert(chainidToGanacheService);
        if (isNullishOrEmptyString(directory)) {
            directory = undefined;
        }

        /** @type {{[chainid:string]: string}} */
        const chainsDBUUID = {};
        /** @type {types.DBSignatureArg} */
        const dbSigArg = {
            name: MARKET_SIGNAME,
            serviceType: MARKET_TYPENAME,
            signature: chainsDBUUID
        };
        const addToWatchers = (watcherArgs === 'all');

        /** @type {Map<string,{ hub: PoCoHubRef, logFile?: string }>} */
        const watcherHubRefs = new Map();

        if (apiArgs) {
            const uniqueMap = new Map();
            uniqueMap.clear();
            const apiServiceArgs = apiArgs;
            const apiChains = apiServiceArgs.chains;
            assert(apiChains);

            /** @type {PoCoHubRef[]} */
            const resolvedApiChains = [];
            for (let i = 0; i < apiChains.length; i++) {
                const api = apiChains[i];

                const ref = (typeof api === 'string') ?
                    ContratRefFromString(api, 'ERC1538Proxy') :
                    api;
                if (!ref) {
                    continue;
                }

                if (uniqueMap.has(ref.chainid)) {
                    throw new CodeError(
                        `Multiple hubs on chainid='${ref.chainid}'`,
                        ERROR_CODES.MARKET_API_ERROR);
                }

                assert(chainidToGanacheService);
                const g = chainidToGanacheService.get(ref.chainid);
                if (!g) {
                    continue;
                }
                assert(g instanceof GanachePoCoService);
                assert(g.DBUUID);
                const resolvedHubRef = g.resolve(ref);
                if (!resolvedHubRef || !(resolvedHubRef instanceof PoCoHubRef)) {
                    continue;
                }

                if (!this.#apiHubRefs.has(resolvedHubRef.key)) {
                    this.#apiHubRefs.set(resolvedHubRef.key, resolvedHubRef);
                } else {
                    throw new CodeError(
                        `Duplicate api hub ref (hub=${resolvedHubRef.toHRString()})`,
                        ERROR_CODES.MARKET_ERROR);
                }

                uniqueMap.set(resolvedHubRef.chainid, resolvedHubRef);
                resolvedApiChains.push(resolvedHubRef);

                const chainidStr = resolvedHubRef.chainid.toString();
                assert(!chainsDBUUID[chainidStr] || (chainsDBUUID[chainidStr] === g.DBUUID));
                chainsDBUUID[chainidStr] = g.DBUUID;

                if (addToWatchers) {
                    if (!watcherHubRefs.has(resolvedHubRef.key)) {
                        let watcherLogFile;
                        if (directory) {
                            const logsDir = Market.#resolveSubDir('logs', '', directory);
                            watcherLogFile = path.join(logsDir, 'watcher.' + resolvedHubRef.toHRString() + '.log');
                        }
                        watcherHubRefs.set(resolvedHubRef.key, {
                            hub: resolvedHubRef,
                            logFile: watcherLogFile
                        });
                    }
                }
            }

            apiServiceArgs.chains = resolvedApiChains;
            if (resolvedApiChains.length > 0) {
                if (isNullishOrEmptyString(apiServiceArgs.logFile)) {
                    if (directory) {
                        const logsDir = Market.#resolveSubDir('logs', '', directory);
                        apiServiceArgs.logFile = path.join(logsDir, 'api.' + apiServiceArgs.port + '.log');
                    }
                }

                const apiService = newMarketApiService({
                    ...apiServiceArgs,
                    repository: this.#apiRepoDir,
                    mongoHost: mongoHost,
                    redisHost: redisHost,
                    chains: resolvedApiChains /* compiler */
                });

                this.#api = apiService;
            }
        }

        if (Array.isArray(watcherArgs)) {
            assert(!addToWatchers);
            for (let i = 0; i < watcherArgs.length; ++i) {
                const w = watcherArgs[i];

                let { hubRef, logFile } = Market.#watcherArgToDevLike(w);
                if (!hubRef) {
                    continue;
                }
                const g = chainidToGanacheService.get(hubRef.chainid);
                if (!g) {
                    continue;
                }
                assert(g instanceof GanachePoCoService);
                assert(g.DBUUID);
                const resolvedHubRef = g.resolve(hubRef);
                if (!resolvedHubRef || !(resolvedHubRef instanceof PoCoHubRef)) {
                    continue;
                }

                if (isNullishOrEmptyString(logFile)) {
                    if (directory) {
                        const logsDir = Market.#resolveSubDir('logs', '', directory);
                        logFile = path.join(logsDir, 'watcher.' + resolvedHubRef.toHRString() + '.log');
                    }
                }

                if (!watcherHubRefs.has(resolvedHubRef.key)) {
                    watcherHubRefs.set(resolvedHubRef.key, { hub: resolvedHubRef, logFile });
                } else {
                    const v = watcherHubRefs.get(resolvedHubRef.key);
                    assert(v);
                    v.logFile = logFile;
                }

                const chainidStr = resolvedHubRef.chainid.toString();
                assert(!chainsDBUUID[chainidStr] || (chainsDBUUID[chainidStr] === g.DBUUID));
                chainsDBUUID[chainidStr] = g.DBUUID;
            }
        }

        watcherHubRefs.forEach((ref, key) => {
            const watcherService = newMarketWatcherService({
                repository: this.#watcherRepoDir,
                mongoHost: mongoHost,
                redisHost: redisHost,
                logFile: ref.logFile,
                hub: ref.hub
            });

            if (!this.#watchers) {
                this.#watchers = [];
            }
            this.#watchers.push(watcherService);
        });

        return dbSigArg;
    }

    /** @override */
    static get defaultGitUrl() {
        return 'https://github.com/iExecBlockchainComputing/iexec-market-api.git';
    }
    /** @override */
    static get gitHubRepoName() { return 'iexec-market-api'; }

    /** @type {string} */
    static #latestVersion;

    /** @override */
    static async latestVersion() {
        if (!Market.#latestVersion) {
            Market.#latestVersion = await getLatestVersion(this.defaultGitUrl);
        }
        return Market.#latestVersion;
    }

    /**
     * @param {string} basename 
     * @param {string} dir 
     * @param {string=} marketDir 
     */
    static #resolveSubDir(basename, dir, marketDir) {
        if (!isNullishOrEmptyString(dir)) {
            assert(dir);
            return resolveAbsolutePath(dir);
        }
        throwIfNullishOrEmptyString(marketDir);
        assert(marketDir);
        assert(basename);
        return path.join(marketDir, basename);
    }

    /**
     * @param {{
     *      repository?: (string | types.Package),
     *      version?: string, 
     *      directory?: string, 
     *      mongo?: { directory?: string },
     *      redis?: { directory?: string },
     * }} params
     */
    static async install({
        repository,
        version,
        directory,
        mongo,
        redis
    }) {

        if (!isNullishOrEmptyString(directory)) {
            assert(directory);
            throwIfNotAbsolutePath(directory);
            // cleanup
            directory = resolveAbsolutePath(directory);
        } else {
            directory = undefined;
        }

        if (!isPackageOrDirectory(repository)) {
            if (!directory) {
                throw new CodeError('Missing Market package or directory', ERROR_CODES.MARKET_ERROR);
            } else {
                repository = path.join(directory, 'src');
            }
        }
        assert(repository);

        const mongoDirectory = Market.#resolveSubDir('mongo', mongo?.directory ?? '', directory);
        const redisDirectory = Market.#resolveSubDir('redis', redis?.directory ?? '', directory);

        assert(mongoDirectory);
        assert(redisDirectory);

        // Throws exception if failed
        await installServiceClassPackage(this, { repository, version });

        // Throws an exception if failed
        await MongoService.install({ directory: mongoDirectory });

        // Throws an exception if failed
        await RedisService.install({ directory: redisDirectory });

        if (directory) {
            mkDirP(Market.#resolveSubDir('logs', '', directory));
        }
    }

    /**
     * @param {{
     *      directory?: string, 
     *      mongo?: { directory?: string },
     *      redis?: { directory?: string },
     * }} params
     */
    static async resetDB({
        directory,
        mongo,
        redis
    }) {

        if (!isNullishOrEmptyString(directory)) {
            assert(directory);
            directory = resolveAbsolutePath(directory);
        } else {
            directory = undefined;
        }

        const mongoDirectory = Market.#resolveSubDir('mongo', mongo?.directory ?? '', directory);
        const redisDirectory = Market.#resolveSubDir('redis', redis?.directory ?? '', directory);

        assert(mongoDirectory);
        assert(redisDirectory);

        // Throws an exception if failed
        await MongoService.resetDB({ directory: mongoDirectory });

        // Throws an exception if failed
        await RedisService.resetDB({ directory: redisDirectory });
    }

    /**
     * - If `chainids` is defined, does not require any running service
     * @param {{
     *      repository?: (string | types.Package),
     *      directory?: string, 
     *      mongo: { hostname?: string, port: number, directory?: string }
     *      redis: { hostname?: string, port: number, directory?: string }
     *      api: { hostname?: string, port: number, chains:(string | PoCoHubRef)[] }
     *      watchers?: (string | (string | types.PoCoHubRefLike | { logFile?: string, hub: types.PoCoHubRefLike })[]) 
     * }} params
     * @param {srvTypes.InventoryLike=} inventory
     */
    static async newInstance({ repository, directory, mongo, redis, api, watchers }, inventory) {

        if (!isNullishOrEmptyString(directory)) {
            assert(directory);
            directory = resolveAbsolutePath(directory);
        } else {
            directory = undefined;
        }

        if (!isPackageOrDirectory(repository)) {
            if (!directory) {
                throw new CodeError('Missing Market package or directory', ERROR_CODES.MARKET_ERROR);
            } else {
                repository = path.join(directory, 'src');
            }
        }
        assert(repository);

        let hasApis = true;
        if (api === null || api === undefined) {
            hasApis = false;
        }

        let hasWatchers = true;
        if (watchers === null || watchers === undefined) {
            hasWatchers = false;
        } else if (typeof watchers === 'string') {
            assert(watchers === 'all');
            hasWatchers = hasApis;
        }

        if (!hasApis && !hasWatchers) {
            throw new CodeError('Empty Market service', ERROR_CODES.MARKET_ERROR);
        }

        /** @type {string} */
        let marketRepoDir;
        if (typeof repository === 'string') {
            marketRepoDir = repository;
        } else {
            marketRepoDir = repository.directory;
        }
        marketRepoDir = resolveAbsolutePath(marketRepoDir);

        let market;
        Market.#guardConstructing = true;
        try {
            market = new Market();
            market.#repository = marketRepoDir;
        } catch (err) {
            Market.#guardConstructing = false;
            throw err;
        }
        Market.#guardConstructing = false;

        const mongoHost = hostnamePortToString(mongo);
        const redisHost = hostnamePortToString(redis);
        const chainids = (inventory) ? await inventory.getChainids() : undefined;

        // Throws an exception if multiple ganache instances 
        // with the same chainid are running
        const chainidToGanacheService = chainids ?? await GanachePoCoService.runningGroupedByUniqueChainid();
        // Ganache is not running ? 
        // External eth nodes not yet supported
        assert(chainidToGanacheService instanceof Map);

        const sigArg = await market.#initApisAndWatchers(chainidToGanacheService,
            {
                directory,
                mongoHost,
                redisHost,
                apiArgs: api,
                watcherArgs: watchers
            });

        if (market.#countApis === 0 && market.#countWatchers === 0) {
            throw new CodeError('Empty Market service', ERROR_CODES.MARKET_ERROR);
        }

        let mongoDirectory;
        if (!isNullishOrEmptyString(mongo.directory)) {
            assert(mongo.directory);
            mongoDirectory = resolveAbsolutePath(mongo.directory);
        } else {
            throwIfNullishOrEmptyString(directory);
            assert(directory);
            mongoDirectory = path.join(directory, 'mongo');;
        }

        let redisDirectory;
        if (!isNullishOrEmptyString(redis.directory)) {
            assert(redis.directory);
            redisDirectory = resolveAbsolutePath(redis.directory);
        } else {
            throwIfNullishOrEmptyString(directory);
            assert(directory);
            redisDirectory = path.join(directory, 'redis');
        }

        assert(mongoDirectory);
        assert(redisDirectory);

        // Throws an exception if failed
        market.#mongo = await MongoService.newInstance({
            ...mongo,
            signature: sigArg,
            directory: mongoDirectory
        });

        // Throws an exception if failed
        market.#redis = await RedisService.newInstance({
            ...redis,
            signature: sigArg,
            directory: redisDirectory
        });

        return market;
    }

    /**
     * @param {PoCoHubRef} hubRef 
     * @param {string=} ganacheDBUUID 
     */
    static async apiUrl(hubRef, ganacheDBUUID) {
        const apis = await MarketApiService.fromPoCoHubRef(hubRef, ganacheDBUUID);
        if (!apis) {
            return null;
        }
        const urls = [];
        for (let i = 0; i < apis.length; ++i) {
            urls.push(apis[i].urlString);
        }
        return urls;
    }

    /**
     * @param {(string | types.Package)} repository 
     */
    static async fromRepository(repository) {
        const pkg = toPackage(repository, Market.defaultGitUrl);
        if (!pkg.commitish) {
            // Throws exception if failed
            const latestVersion = await this.latestVersion();
            pkg.commitish = latestVersion;
        }

        // Must resolve Symlinks! (realpath:true)
        const repoDir = resolveAbsolutePath(pkg.directory, { realpath: true });

        /** @type {Map.<string, {redis:string, mongo:string}>} */
        const map = new Map();

        const apiDir = path.join(repoDir, 'api');
        if (dirExists(apiDir)) {
            const apis = await MarketApiService.fromRepository(apiDir);
            if (apis) {
                for (let i = 0; i < apis.length; ++i) {
                    const key = `{ "redis": "${apis[i].redisHost}", "mongo": "${apis[i].mongoHost}" }`;
                    if (map.has(key)) {
                        continue;
                    }
                    map.set(key, { redis: apis[i].redisHost, mongo: apis[i].mongoHost });
                }
            }
        }

        const watcherDir = path.join(repoDir, 'watcher');
        if (dirExists(watcherDir)) {
            const watchers = await MarketWatcherService.fromRepository(watcherDir);
            if (watchers) {
                for (let i = 0; i < watchers.length; ++i) {
                    const key = `{ "redis": "${watchers[i].redisHost}", "mongo": "${watchers[i].mongoHost}" }`;
                    if (map.has(key)) {
                        continue;
                    }
                    map.set(key, { redis: watchers[i].redisHost, mongo: watchers[i].mongoHost });
                }
            }
        }

        const services = [];
        for (const [key, value] of map) {
            const m = await Market.fromHosts(value);
            if (m) {
                services.push(m);
            }
        }

        if (services.length === 0) {
            return null;
        }

        return services;
    }

    /**
     *  @param {{ 
     *          pid: number, 
     *          configFile: string, 
     *          service: ?AbstractService
     *  }} pidInfo
     */
    static toMarketPidInfo(pidInfo) {
        /** @type {any} */
        const anyInfo = pidInfo;
        assert(anyInfo.api);
        assert(anyInfo.watchers);
        assert(anyInfo.service instanceof Market);
        /**
         *  @type {{ 
        *      pid: number, 
        *      configFile: string, 
        *      service: Market,  
        *      api: { pid: number | null }, 
        *      watchers:{ pid: number, hub:PoCoHubRef }[]         
        * }}
        */
       const mpidInfo = anyInfo;
       return mpidInfo;
    }

    /**
     * @param {{
     *      mongoHost?: string
     *      hub?: PoCoHubRef
     * } & any } args 
     * @returns {Promise<{
     *      pid: number, 
     *      service: Market, 
     *      configFile: string,
     *      api: { pid: number | null }, 
     *      watchers:{ pid: number, hub:PoCoHubRef }[] }[] | null>}
     */
    static async running({ mongoHost, hub, ...others } = {}) {
        if (!others || Object.keys(others).length > 0) {
            return null;
        }

        /** 
         * @type {Map<string, {
         *      pid: number, 
         *      service: Market, 
         *      configFile: string,
         *      api: { pid: number | null }, 
         *      watchers:{ pid: number, hub:PoCoHubRef }[] 
         * }>} 
         */
        const markets = new Map();
        const array = [];
        /** @type {string=} */
        let configFile = undefined;

        const apiPIDs = await MarketApiService.allPIDsWithEnvs();
        if (apiPIDs && apiPIDs.length > 0) {
            for (let i = 0; i < apiPIDs.length; ++i) {
                assert(!isNullishOrEmptyString(apiPIDs[i].redisHost));
                assert(!isNullishOrEmptyString(apiPIDs[i].mongoHost));
                if (!configFile) {
                    configFile = (await psGetEnv(apiPIDs[i].pid, envVarName('MARKER'))) ?? '';
                }
                if (mongoHost) {
                    if (apiPIDs[i].mongoHost !== mongoHost) {
                        continue;
                    }
                }
                const key = {
                    redis: apiPIDs[i].redisHost,
                    mongo: apiPIDs[i].mongoHost
                };
                const keyStr = JSON.stringify(key);
                if (!markets.has(keyStr)) {
                    const m = await Market.fromHosts(key);
                    if (m) {
                        const o = {
                            pid: 0,
                            service: m,
                            configFile,
                            api: { pid: apiPIDs[i].pid },
                            watchers: []
                        };
                        markets.set(keyStr, o);
                        array.push(o);
                    }
                } else {
                    assert(false, "Multiple api services ?????");
                }
            }
        }

        const watchersPIDs = await MarketWatcherService.allPIDsWithEnvs();
        if (watchersPIDs && watchersPIDs.length > 0) {
            for (let i = 0; i < watchersPIDs.length; ++i) {
                if (!configFile) {
                    configFile = (await psGetEnv(watchersPIDs[i].pid, envVarName('MARKER'))) ?? '';
                }
                assert(!isNullishOrEmptyString(watchersPIDs[i].redisHost));
                assert(!isNullishOrEmptyString(watchersPIDs[i].mongoHost));
                if (mongoHost) {
                    if (watchersPIDs[i].mongoHost !== mongoHost) {
                        continue;
                    }
                }
                const key = {
                    redis: watchersPIDs[i].redisHost,
                    mongo: watchersPIDs[i].mongoHost
                };
                const keyStr = JSON.stringify(key);
                if (!markets.has(keyStr)) {
                    const m = await Market.fromHosts(key);
                    if (m) {
                        const o = {
                            pid: 0,
                            service: m,
                            api: { pid: null },
                            configFile: '',
                            watchers: [
                                { pid: watchersPIDs[i].pid, hub: watchersPIDs[i].hub }
                            ]
                        };
                        markets.set(keyStr, o);
                        array.push(o);
                    }
                } else {
                    const o = markets.get(keyStr);
                    assert(o);
                    o.watchers.push({ pid: watchersPIDs[i].pid, hub: watchersPIDs[i].hub });
                }
            }
        }

        if (array.length === 0) {
            return null;
        }

        const filtered = [];
        for (let i = 0; i < array.length; ++i) {
            if (hub) {
                if (!array[i].service.hasHub(hub)) {
                    continue;
                }
            }
            filtered.push(array[i]);
        }

        return (filtered.length === 0) ? null : filtered;
    }

    /**
     * @param {PoCoHubRef | string} hub 
     */
    hasHub(hub) {
        if (!hub) {
            return false;
        }
        if (!this.#api) {
            return false;
        }
        return this.#api.hasHub(hub);
    }

    /**
     * @param {object} args
     * @param {string=} args.redis
     * @param {string=} args.mongo
     */
    static async fromHosts({ redis, mongo }) {
        let redisService = redis && await RedisService.fromHost(redis);
        let mongoService = mongo && await MongoService.fromHost(mongo);

        if (!redisService && !mongoService) {
            return null;
        }

        let apis = await MarketApiService.pidsFromHosts({ redis, mongo });
        if (apis && apis.length > 1) {
            throw new CodeError(
                'Multiple Market Api services are sharing the same redis & mongo servers',
                ERROR_CODES.MARKET_ERROR);
        }
        let watchers = await MarketWatcherService.pidsFromHosts({ redis, mongo });

        let repoDir;
        let mongoHost;
        let redisHost;
        if (apis && apis.length > 0) {
            const cwd = await getPIDCWD(apis[0].pid);
            if (!cwd) {
                return null;
            }
            assert(path.basename(cwd) === 'api');
            repoDir = path.dirname(cwd);
            mongoHost = apis[0].mongoHost;
            redisHost = apis[0].redisHost;
        } else if (watchers && watchers.length > 0) {
            const cwd = await getPIDCWD(watchers[0].pid);
            if (!cwd) {
                return null;
            }
            assert(path.basename(cwd) === 'watcher');
            repoDir = path.dirname(cwd);
            mongoHost = watchers[0].mongoHost;
            redisHost = watchers[0].redisHost;
        }

        if (!repoDir) {
            return null;
        }
        repoDir = resolveAbsolutePath(repoDir);

        if (!mongoService) {
            mongoService = await MongoService.fromHost(mongoHost);
        }
        if (!redisService) {
            redisService = await RedisService.fromHost(redisHost);
        }

        let market;
        Market.#guardConstructing = true;
        try {
            market = new Market();
            market.#repository = repoDir;
        } catch (err) {
            Market.#guardConstructing = false;
            throw err;
        }
        Market.#guardConstructing = false;

        // Throws an exception if multiple ganache instances 
        // running with the same chainid are running
        const chainidToGanacheService = await GanachePoCoService.runningGroupedByUniqueChainid();
        if (!chainidToGanacheService || chainidToGanacheService.size === 0) {
            return null;
        }
        // Ganache is not running ? 
        // External eth nodes not yet supported
        assert(chainidToGanacheService instanceof Map);

        const sigArg = await market.#initApisAndWatchers(chainidToGanacheService,
            {
                mongoHost,
                redisHost,
                apiArgs: apis?.[0],
                watcherArgs: watchers
            });

        if (mongoService) {
            if (!mongoService.isSigCompatible(sigArg)) {
                throw new CodeError('Market mongo db signature conflict.',
                    ERROR_CODES.SIGNATURE_CONFLICT_ERROR);
            }
            market.#mongo = mongoService;
        }

        if (redisService) {
            if (!redisService.isSigCompatible(sigArg)) {
                throw new CodeError('Market redis db signature conflict.',
                    ERROR_CODES.SIGNATURE_CONFLICT_ERROR);
            }
            market.#redis = redisService;
        }

        return market;
    }

    /**
     * @param {types.StartOptionsWithContext & {
     *      onlyDB?: boolean
     * }=} options 
     */
    async start(options) {
        if (!this.#repository) {
            throw new CodeError(
                'Market service cannot be started.',
                ERROR_CODES.CANNOT_START);
        }

        assert(this.#mongo);
        assert(this.#redis);

        const out1 = await Promise.all([
            this.#mongo.start({
                context: {
                    name: 'mongo.' + (options?.context?.name ?? 'market')
                },
                env: options?.env,
                progressCb: options?.progressCb,
                strict: false
            }),
            this.#redis.start({
                context: {
                    name: 'redis.' + (options?.context?.name ?? 'market')
                },
                env: options?.env,
                progressCb: options?.progressCb,
                strict: false
            }),
        ]);

        let succeeded = true;
        for (let i = 0; i < out1.length; ++i) {
            const out = out1[i];
            if (!out.ok) {
                console.log(out.error.toString());
                succeeded = false;
            }
        }

        if (!succeeded) {
            return false;
        }

        if (options?.onlyDB === true) {
            return true;
        }

        const promises = [];
        if (this.#api) {
            promises.push(this.#api.start({
                context: {
                    name: 'api.' + (options?.context?.name ?? 'market')
                },
                env: options?.env,
                progressCb: options?.progressCb,
                strict: false
            }));
        }
        if (this.#watchers) {
            for (let i = 0; i < this.#watchers.length; ++i) {
                promises.push(this.#watchers[i].start({
                    context: {
                        name: `watcher.market.` + this.#watchers[i].hub.hubAlias()
                    },
                    env: options?.env,
                    progressCb: options?.progressCb,
                    strict: false
                }));
            }
        }

        const out2 = await Promise.all(promises);

        for (let i = 0; i < out2.length; ++i) {
            const out = out2[i];
            if (!out.ok) {
                console.log(out.error.toString());
                succeeded = false;
            }
        }

        return succeeded;
    }

    /**
     * Not abortable.
     * @param {types.StopOptionsWithContext=} options
     * @returns {Promise<types.StopReturn>}
     */
    async stop(options) {
        const args = {
            ...options,
            abortSignal: undefined, // disable abort
            strict: false
        };
        Object.freeze(args);

        /** @type {types.StopReturn} */
        const succeeded = {
            ok: true,
            context: args.context
        };

        /** @type {types.StopReturn} */
        const failed = {
            ok: false,
            error: new CodeError('Market stop failed.', ERROR_CODES.MARKET_ERROR)
        };

        if (this.#countApis + this.#countWatchers === 0) {
            return succeeded;
        }

        const promises = [];
        if (this.#api) {
            promises.push(this.#api.stop(args));
        }
        if (this.#watchers) {
            for (let i = 0; i < this.#watchers.length; ++i) {
                promises.push(this.#watchers[i].stop(args));
            }
        }

        const out1 = await Promise.all(promises);

        // if (options?.abortSignal?.aborted) {
        //     return {
        //         ok: false,
        //         error: new CodeError('Market service stop cancelled.', ERROR_CODES.CANCELLED, context)
        //     };
        // }

        let ok = true;
        for (let i = 0; i < out1.length; ++i) {
            const out = out1[i];
            if (!out.ok) {
                console.log(out.error.toString());
                ok = false;
            }
        }

        assert(this.#mongo);
        assert(this.#redis);

        const out2 = await Promise.all([
            this.#mongo.stop(args),
            this.#redis.stop(args)
        ]);

        for (let i = 0; i < out2.length; ++i) {
            const out = out2[i];
            if (!out.ok) {
                console.log(out.error.toString());
                ok = false;
            }
        }

        if (options?.strict) {
            if (!ok) {
                throw failed.error;
            }
        }

        return (ok) ? succeeded : failed;
    }

    /**
     * @param {object} args 
     * @param {string=} args.repository 
     */
    static async stop({ repository }) {
        if (!repository) {
            return true;
        }
        const markets = await Market.fromRepository(repository);
        if (!markets || markets.length === 0) {
            return true;
        }

        return Service.groupStop({
            services: markets,
            options: { reset: false }
        });
    }

    /** 
     * @param {any} filters 
     * @param {types.StopOptionsWithContext} options 
     */
    static async stopAll(filters, options) {
        this.#stopAll(false, filters, options);
    }

    /** 
     * @param {any} filters 
     * @param {types.StopOptionsWithContext} options 
     */
    static async killAll(filters, options) {
        this.#stopAll(true, filters, options);
    }

    /** 
     * @param {boolean} kill
     * @param {any} filters 
     * @param {types.StopOptionsWithContext} options 
     */
    static async #stopAll(kill, filters, options) {

        // filters are not yet used
        // keep the same method signature as service.js 
        const [mongos, redis, apis, watchers] = await Promise.all([
            MongoService.fromServiceType(MARKET_TYPENAME),
            RedisService.fromServiceType(MARKET_TYPENAME),
            MarketApiService.running(),
            MarketWatcherService.running()
        ]);

        /** @type {Service[]} */
        let apiAndWatchersGp = [];
        /** @type {number[]} */
        let apiPids = [];
        /** @type {number[]} */
        let watcherPids = [];
        if (apis) {
            for (let i = 0; i < apis.length; ++i) {
                const api = apis[i].service;
                if (api) {
                    apiAndWatchersGp.push(api);
                }
                apiPids.push(apis[i].pid);
            }
        }
        if (watchers) {
            for (let i = 0; i < watchers.length; ++i) {
                const watcher = watchers[i].service;
                if (watcher) {
                    apiAndWatchersGp.push(watcher);
                }
                watcherPids.push(watchers[i].pid);
            }
        }

        /** @type {Service[]} */
        let dbGp = [];
        /** @type {number[]} */
        let mongoPids = [];
        /** @type {number[]} */
        let redisPids = [];
        if (mongos) {
            dbGp = dbGp.concat(mongos);
            const pids = await Promise.all(mongos.map(m => m.getPID()));
            for (let i = 0; i < pids.length; ++i) {
                const pid = pids[i];
                if (pid === undefined) {
                    continue;
                }
                mongoPids.push(pid);
            }
        }
        if (redis) {
            dbGp = dbGp.concat(redis);
            const pids = await Promise.all(redis.map(m => m.getPID()));
            for (let i = 0; i < pids.length; ++i) {
                const pid = pids[i];
                if (pid === undefined) {
                    continue;
                }
                redisPids.push(pid);
            }
        }

        if (apiAndWatchersGp.length > 0) {
            if (kill) {
                await MarketApiService.groupKill({
                    pids: apiPids,
                    options
                });
                await MarketWatcherService.groupKill({
                    pids: watcherPids,
                    options
                });
            } else {
                await Service.groupStop({
                    services: apiAndWatchersGp,
                    options
                });
            }
        }
        if (dbGp.length > 0) {
            if (kill) {
                await MongoService.groupKill({
                    pids: mongoPids,
                    options
                });
                await RedisService.groupKill({
                    pids: redisPids,
                    options
                });
            } else {
                await Service.groupStop({
                    services: dbGp,
                    options
                });
            }
        }
    }

    /**
     * @param {string} directory 
     */
    static #computeApiRunDir(directory) {
        assert(path.isAbsolute(directory));
        return path.join(directory, 'run', 'api');
    }
    /**
     * @param {string} directory 
     * @param {MarketWatcherService} watcher 
     */
    static #computeWatcherRunDir(directory, watcher) {
        assert(path.isAbsolute(directory));
        const hub = watcher.hub;
        assert(hub.hasDeployConfigName);
        const hubStr = hub.chainid.toString() + "." + hub.deployConfigName;
        return path.join(directory, 'run', 'watcher.' + hubStr);
    }

    /**
     * @param {{
     *      directory?: string, 
     *      env: {[envName:string] : string}
     * }} options
     */
    async saveEnvFile({ directory, env }) {
        // <root>/shared/markets/market.standard/run/api/api.log
        // <root>/shared/markets/market.standard/run/api/env.txt
        throwIfNullishOrEmptyString(directory);
        throwIfNotAbsolutePath(directory);
        assert(directory);
        assert(this.#api);

        const apiRunDir = Market.#computeApiRunDir(directory);
        mkDirP(apiRunDir, { strict: true });

        await this.#api.saveEnvFile({
            filename: path.join(apiRunDir, ENV_FILE_BASENAME),
            env
        });
        for (let i = 0; i < this.#watchers.length; ++i) {
            const w = this.#watchers[i];
            const watcherRunDir = Market.#computeWatcherRunDir(directory, w);
            mkDirP(watcherRunDir, { strict: true });
            await w.saveEnvFile({
                filename: path.join(watcherRunDir, ENV_FILE_BASENAME),
                env
            });
        }
    }

    toJSON() {
        return {
            repository: this.#repository,
            mongo: this.#mongo,
            redis: this.#redis,
            api: this.#api,
            watchers: this.#watchers
        }
    }

}
