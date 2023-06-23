import * as types from '../common/common-types.js';
import path from 'path';
import assert from 'assert';
import { PoCoHubRef } from '../common/contractref.js';
import { Service } from '../common/service.js';
import { hostnamePortToString, isNullishOrEmptyString, stringToPositiveInteger, throwIfNullishOrEmptyString } from '../common/string.js';
import { getPIDCWD, psGetEnv, psGrepPIDAndEnv, pspWithArgsAndEnv } from '../common/ps.js';
import { CodeError } from '../common/error.js';
import { resolveAbsolutePath, saveToFile, throwIfDirDoesNotExist, throwIfParentDirDoesNotExist } from '../common/fs.js';
import { genSetMBashScript } from '../common/bash.js';
import { envVarName } from '../common/consts.js';

const ENTRY = "./src/index.js";
const CHAIN = envVarName('MARKET_API');

/**
 * @typedef {types.ServiceArgs & 
 * {
 *      repository?: string
 *      mongoHost: string
 *      redisHost: string
 *      hub: PoCoHubRef
 * }} MarketWatcherServiceConstructorArgs
 */

/* -------------------- Protected Constructor ------------------------ */

const MarketWatcherServiceConstructorGuard = { value: false };

/** @param {MarketWatcherServiceConstructorArgs} args */
export function newMarketWatcherService(args) {
    let watcherService;

    MarketWatcherServiceConstructorGuard.value = true;
    try {
        watcherService = new MarketWatcherService(args);
    } catch (err) {
        MarketWatcherServiceConstructorGuard.value = false;
        throw err;
    }
    MarketWatcherServiceConstructorGuard.value = false;

    return watcherService;
}

/* -------------------- MarketWatcherService Class ----------------------- */

export class MarketWatcherService extends Service {

    /** 
     * @override
     * @returns {typeof MarketWatcherService} 
     */
    theClass() { return MarketWatcherService; }

    static typename() { return 'marketwatcher'; }

    /** @type {string=} */
    #repository;

    /** @type {string} */
    #mongoHost;

    /** @type {string} */
    #redisHost;

    /** @type {PoCoHubRef} */
    #hub;

    /**
     * @param {MarketWatcherServiceConstructorArgs} args
     */
    constructor(args) {
        if (!MarketWatcherServiceConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }

        super(args);

        throwIfNullishOrEmptyString(args.redisHost);
        throwIfNullishOrEmptyString(args.mongoHost);

        this.#repository = args.repository;
        this.#redisHost = args.redisHost;
        this.#mongoHost = args.mongoHost;
        this.#hub = args.hub;
    }

    get mongoHost() { return this.#mongoHost; }
    get redisHost() { return this.#redisHost; }
    get hub() { return this.#hub; }

    /** 
     * @protected
     * @override 
     */
    async isBusyOverride() {
        /** @todo not yet implemented */
        // do not call super 
    }

    async isReady() {
        try {
            const pid = await this.getPID();
            if (!pid) {
                return false;
            }
            // // result.ok == false : the service status is not determined (start underway).
            // const result = this.parseLogsAndGetStatus(
            //     this.getOrSuccessPatterns(pid),
            //     this.getOrFailurePatterns(pid));
            // return (result.ok && (result.status === 'succeeded'));
            return true;
        } catch (err) { }
        return false;
    }

    /** @override */
    get canStart() {
        if (!this.isLocal()) {
            return false;
        }
        return !!(this.#repository);
    }

    /** @override */
    get canStop() {
        if (!this.isLocal()) {
            return false;
        }
        return true;
    }

    toJSON() {
        return {
            ...super.toJSON(),
            hubRef: this.#hub
        }
    }

    /** @override */
    async getPID() {
        try {
            if (!this.isLocal()) {
                return; /* undefined */
            }
            const grepPattern =
                "node " + ENTRY + ".*CHAIN=" + CHAIN + ".*IEXEC_ADDRESS=" + this.#hub.address + '|' +
                "node " + ENTRY + ".*IEXEC_ADDRESS=" + this.#hub.address + ".*CHAIN=" + CHAIN;
            const pids = await psGrepPIDAndEnv(grepPattern);
            if (!pids) {
                return; /* undefined */
            }
            for (let i = 0; i < pids.length; ++i) {
                if (pids[i].command.indexOf(' ETH_RPC_HOST=' + this.#hub.httpHost + ' ') < 0) {
                    continue;
                }
                if (pids[i].command.indexOf(' CHAIN_ID=' + this.#hub.chainid.toString() + ' ') < 0) {
                    continue;
                }
                return pids[i].pid;
            }
        } catch { }
        return; /* undefined */
    }

    /**
     * @param {object} params
     * @param {(string | number)=} params.redis
     * @param {(string | number)=} params.mongo
     */
    static async stop({ redis, mongo }) {
        // should be resolved
        const _redis = hostnamePortToString(redis, undefined);
        // should be resolved
        const _mongo = hostnamePortToString(mongo, undefined);

        const pids = await MarketWatcherService.pidsFromHosts({ redis: _redis, mongo: _mongo });
        if (!pids) {
            return;
        }

        for (let i = 0; i < pids.length; ++i) {
            const pid = pids[i];
            const cwd = await getPIDCWD(pid.pid);
            const watcherService = newMarketWatcherService({
                repository: cwd,
                mongoHost: pid.mongoHost,
                redisHost: pid.redisHost,
                hub: pid.hub
            });
            await watcherService.stop({ strict: true });
        }
    }

    /**
     * @override
     * @param {any=} filters 
     * @returns {Promise<{pid: number, configFile: string, service:(MarketWatcherService | null)}[] | null>} 
     */
    static async running(filters) {
        const pids = await MarketWatcherService.allPIDsWithEnvs();
        if (!pids) {
            return null;
        }
        const services = [];
        for (let i = 0; i < pids.length; ++i) {
            const pidInfo = pids[i];
            const cwd = await getPIDCWD(pidInfo.pid);
            const configFile = (await psGetEnv(pidInfo.pid, envVarName('MARKER'))) ?? '';

            const watcherService = newMarketWatcherService({
                repository: cwd,
                mongoHost: pidInfo.mongoHost,
                redisHost: pidInfo.redisHost,
                hub: pidInfo.hub,
                hostname: pidInfo.hostname
            });
            services.push({ pid: pidInfo.pid, configFile, service: watcherService });
        }
        return (services.length === 0) ? null : services;
    }

    /**
     * @override
     * @param {{
     *      logFile?: string
     *      pidFile?: string
     *      env?: {[envName:string] : string}
     * }=} options
     */
    async getStartBashScript(options) {
        if (!this.canStart) {
            throw new CodeError(`Cannot start market watcher service.`);
        }

        const watcherRepoDir = this.#repository;
        assert(watcherRepoDir);

        const logFilePath = this.logFile;
        if (logFilePath) {
            throwIfParentDirDoesNotExist(logFilePath);
        }
        const pidFilePath = this.pidFile;
        if (pidFilePath) {
            throwIfParentDirDoesNotExist(pidFilePath);
        }

        /**
         * @todo use options.logFile & options.pidFile instead
         */
        assert(logFilePath === options?.logFile);
        assert(pidFilePath === options?.pidFile);

        // return genNohupBashScript('node', {
        //     dir: watcherRepoDir,
        //     env: this.#getEnv(),
        //     args: [ENTRY],
        //     logFile: logFilePath,
        //     pidFile: pidFilePath
        // });

        /** @type {any} */
        const o = {
            dir: watcherRepoDir,
            env: this.#getEnv(options?.env ?? {}),
            args: [ENTRY],
            logFile: logFilePath,
            pidFile: pidFilePath
        }

        return genSetMBashScript('node', o);

    }

    /**
     * @param {{[envName:string] : string}} extras
     * @returns {Object.<string,string>}
     */
    #getEnv(extras) {
        /*
        MONGO_HOST,
        REDIS_HOST,
        FLAVOUR,
        INFURA_PROJECT_ID,
        ALCHEMY_API_KEY,
        ETH_WS_HOST,
        ETH_RPC_HOST,
        CHAIN,
        CHAIN_ID,
        IEXEC_ADDRESS,
        IS_NATIVE,
        START_BLOCK,
        SYNC_CHECK_INTERVAL,
        OUT_OF_SYNC_LIMIT,
        REPLAY_INTERVAL,
        BLOCKS_BATCH_SIZE,
        RETRY_DELAY,
        CREATE_INDEX,
        */

        assert(this.#hub.httpHost);
        assert(this.#hub.wsHost);
        assert(this.#hub.address);

        /** @type {Object.<string,string>} */
        const env = {};
        env['MONGO_HOST'] = this.#mongoHost;
        env['REDIS_HOST'] = this.#redisHost;
        env['IXCDV_HOSTNAME'] = this.hostname;

        env['CHAIN'] = CHAIN;
        env['CHAIN_ID'] = this.#hub.chainid.toString();
        env['IS_NATIVE'] = this.#hub.isNative.toString();
        env['FLAVOUR'] = this.#hub.isEnterprise ? 'enterprise' : 'standard';
        env['ETH_RPC_HOST'] = this.#hub.httpHost;
        env['ETH_WS_HOST'] = this.#hub.httpHost;
        env['IEXEC_ADDRESS'] = this.#hub.address;

        //env['DEBUG'] = 'iexec-market-api:config';
        env['DEBUG'] = 'iexec-watcher:*';
        //env['DEBUG'] = '*';

        const xnames = Object.keys(extras);
        for (let i= 0 ; i < xnames.length; ++i) {
            env[envVarName(xnames[i])] = extras[xnames[i]];
        }

        return env;
    }

    /**
     * @param {{
     *      filename?: string
     *      env: {[envName:string] : string}
     * }} options
     */
    async saveEnvFile({ filename, env }) {
        const destFilename = filename;
        assert(!isNullishOrEmptyString(destFilename));
        assert(destFilename);
        assert(path.isAbsolute(destFilename));

        const destDir = path.dirname(destFilename);
        throwIfDirDoesNotExist(destDir);

        const envs = this.#getEnv(env);
        assert(envs);

        let str = '';
        Object.entries(envs).forEach(([key, value]) => {
            str += key + '=' + value + '\n';
        });

        await saveToFile(str, destDir, path.basename(destFilename), { strict: true });
    }

    /**
     * @override
     * @protected
     * @param {number} pid 
     */
    getSuccessORANDPatterns(pid) {
        return [['WATCHER SUCCESSFULLY STARTED']];
    }

    /**
     * @override
     * @protected
     * @param {number} pid 
     */
    getFailureORANDPatterns(pid) {
        return [['iexec-watcher:error'], ['A critical error has occured'], ['throw Error'], ['Error:']];
    }

    /**
     * @param {object} params
     * @param {(string | number)=} params.redis
     * @param {(string | number)=} params.mongo
     */
    static async fromHosts({ redis, mongo }) {
        // should be resolved
        const _redis = hostnamePortToString(redis, undefined);
        // should be resolved
        const _mongo = hostnamePortToString(mongo, undefined);

        const pids = await MarketWatcherService.pidsFromHosts({ redis: _redis, mongo: _mongo });
        if (!pids) {
            return null;
        }

        const services = [];
        for (let i = 0; i < pids.length; ++i) {
            const pid = pids[i];
            const cwd = await getPIDCWD(pid.pid);
            const apiService = newMarketWatcherService({
                repository: cwd,
                mongoHost: pid.mongoHost,
                redisHost: pid.redisHost,
                hub: pid.hub
            });
            services.push(apiService);
        }
        if (services.length === 0) {
            return null;
        }

        return services;
    }

    /**
     * @param {string} repository 
     */
    static async fromRepository(repository) {
        if (isNullishOrEmptyString(repository)) {
            return null;
        }

        const pids = await MarketWatcherService.allPIDsWithEnvs();
        if (!pids || pids.length === 0) {
            return null;
        }

        repository = resolveAbsolutePath(repository, { realpath: true });

        const services = [];
        for (let i = 0; i < pids.length; ++i) {
            const pid = pids[i];
            const cwd = await getPIDCWD(pid.pid);
            if (!cwd) {
                continue;
            }
            const dir = resolveAbsolutePath(cwd);
            if (dir === repository) {
                const s = newMarketWatcherService({
                    repository: cwd,
                    mongoHost: pid.mongoHost,
                    redisHost: pid.redisHost,
                    hub: pid.hub,
                    hostname: pid.hostname
                });
                services.push(s);
            }
        }
        if (services.length === 0) {
            return null;
        }

        return services;
    }

    /**
     * @param {number} pid 
     */
    static async fromPID(pid) {
        const cmd = await pspWithArgsAndEnv(pid);
        if (!cmd) {
            return null;
        }
        const o = MarketWatcherService.parseEnvVars(cmd);
        const cwd = await getPIDCWD(pid);
        return newMarketWatcherService({
            repository: cwd,
            mongoHost: o.mongoHost,
            redisHost: o.redisHost,
            hub: o.hub
        });
    }

    /**
     * @param {object} params
     * @param {string=} params.redis
     * @param {string=} params.mongo
     */
    static async pidsFromHosts({ redis, mongo }) {
        try {
            let grepPattern;

            let shouldGrepRedis = !isNullishOrEmptyString(redis);
            let shouldGrepMongo = !isNullishOrEmptyString(mongo);

            if (shouldGrepRedis) {
                shouldGrepRedis = false;
                grepPattern =
                    "node " + ENTRY + ".*REDIS_HOST=" + redis + ".*CHAIN=" + CHAIN + "|" +
                    "node " + ENTRY + ".*CHAIN=" + CHAIN + ".*REDIS_HOST=" + redis;
            } else if (shouldGrepMongo) {
                shouldGrepMongo = false;
                grepPattern =
                    "node " + ENTRY + ".*MONGO_HOST=" + mongo + ".*CHAIN=" + CHAIN + "|" +
                    "node " + ENTRY + ".*CHAIN=" + CHAIN + ".*MONGO_HOST=" + mongo;
            }

            if (!grepPattern) {
                return null;
            }

            const pids = await psGrepPIDAndEnv(grepPattern);
            if (!pids) {
                return null;
            }
            const array = [];
            for (let i = 0; i < pids.length; ++i) {
                const cmd = pids[i].command;
                if (shouldGrepMongo) {
                    if (cmd.indexOf('MONGO_HOST=' + mongo + ' ') < 0) {
                        continue;
                    }
                }
                const o = MarketWatcherService.parseEnvVars(cmd);
                array.push({ ...o, pid: pids[i].pid });
            }
            if (array.length === 0) {
                return null;
            }
            return array;
        } catch { }
        return null;
    }

    /**
     * @param {string} str 
     */
    static parseEnvVars(str) {
        const varNames = [
            'IXCDV_HOSTNAME',
            'MONGO_HOST',
            'REDIS_HOST',
            'CHAIN',
            'CHAIN_ID',
            'FLAVOUR',
            'IS_NATIVE',
            'ETH_RPC_HOST',
            'ETH_WS_HOST',
            'IEXEC_ADDRESS',
            'DEBUG'];

        /** @type {any} */
        const o = {};
        for (let k = 0; k < varNames.length; ++k) {
            const varName = varNames[k];
            const s = varName + '=';
            const j0 = str.indexOf(s);
            if (j0 < 0) {
                continue;
            }
            const j1 = str.indexOf(' ', j0);
            const varValue = (j1 < 0) ?
                str.substring(j0 + s.length) :
                str.substring(j0 + s.length, j1);
            o[varName] = varValue;
        }
        const chainid = stringToPositiveInteger(o['CHAIN_ID']);
        assert(chainid);

        assert(o['ETH_RPC_HOST'].startsWith('http://'));

        const ref = new PoCoHubRef({
            chainid: chainid,
            contractName: 'ERC1538Proxy',
            asset: (o['IS_NATIVE'] === 'true') ? "Native" : "Token",
            kyc: (o['FLAVOUR'] === 'enterprise'),
            address: o['IEXEC_ADDRESS'],
            url: o['ETH_RPC_HOST']
        });

        return {
            hostname: o['IXCDV_HOSTNAME'],
            mongoHost: o['MONGO_HOST'],
            redisHost: o['REDIS_HOST'],
            hub: ref,
        }
    }

    static async allPIDsWithEnvs() {
        try {
            let grepPattern;
            grepPattern = "node " + ENTRY + ".*CHAIN=" + CHAIN + " ";
            if (!grepPattern) {
                return; /* undefined */
            }
            const pids = await psGrepPIDAndEnv(grepPattern);
            if (!pids) {
                return; /* undefined */
            }
            const array = [];
            for (let i = 0; i < pids.length; ++i) {
                const cmd = pids[i].command;
                const o = MarketWatcherService.parseEnvVars(cmd);
                array.push({ ...o, pid: pids[i].pid });
            }
            if (array.length === 0) {
                return; /* undefined */
            }
            return array;
        } catch (err) {
            assert(err instanceof Error);
            console.log(err.stack);
        }
        return; /* undefined */
    }
}