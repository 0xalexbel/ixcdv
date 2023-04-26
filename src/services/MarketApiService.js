import * as types from '../common/common-types.js';
import * as ERROR_CODES from "../common/error-codes.js";
import path from 'path';
import assert from 'assert';
import { MongoService } from './MongoService.js';
import { marketEqSigItem, MARKET_SIGNAME, MARKET_TYPENAME } from './Market.js';
import { PoCoHubRef } from '../common/contractref.js';
import { ServerService } from '../common/service.js';
import { hostnamePortToString, isNullishOrEmptyString, stringToPositiveInteger, throwIfNullishOrEmptyString } from '../common/string.js';
import { resolveAbsolutePath, saveToFile, throwIfDirDoesNotExist, throwIfParentDirDoesNotExist } from '../common/fs.js';
import { repeatCallUntil } from '../common/repeat-call-until.js';
import { getPIDCWD, psGrepPIDAndEnv, pspWithArgsAndEnv } from '../common/ps.js';
import { CodeError } from '../common/error.js';
import { genSetMBashScript } from '../common/bash.js';
import { httpGET } from '../common/http.js';
import { isBytes32String } from '../common/ethers.js';
import { isStrictlyPositiveInteger } from '../common/number.js';
import { envVarName } from '../common/consts.js';

const ENTRY = "./src/server.js";
const CHAIN_PREFIX = envVarName('MARKET_API');

/**
 * @typedef {types.ServerServiceArgs & 
 * {
 *      repository?: string
 *      mongoHost: string
 *      redisHost: string
 *      chains: PoCoHubRef[]
 * }} MarketApiServiceConstructorArgs
 */

/* -------------------- Protected Constructor ------------------------ */

const MarketApiServiceConstructorGuard = { value: false };

/** @param {MarketApiServiceConstructorArgs} args */
export function newMarketApiService(args) {
    let apiService;

    MarketApiServiceConstructorGuard.value = true;
    try {
        apiService = new MarketApiService(args);
    } catch (err) {
        MarketApiServiceConstructorGuard.value = false;
        throw err;
    }
    MarketApiServiceConstructorGuard.value = false;

    return apiService;
}

/* -------------------- MarketApiService Class ----------------------- */

export class MarketApiService extends ServerService {

    /** 
     * @override
     * @returns {typeof MarketApiService} 
     */
    theClass() { return MarketApiService; }

    static typename() { return 'marketapi'; }

    /** @type {string=} */
    #repository;

    /** @type {string} */
    #mongoHost;

    /** @type {string} */
    #redisHost;

    /** @type {PoCoHubRef[]} */
    #chains;

    /**
     * @param {MarketApiServiceConstructorArgs} args
     */
    constructor(args) {
        if (!MarketApiServiceConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }

        super(args);

        throwIfNullishOrEmptyString(args.redisHost);
        throwIfNullishOrEmptyString(args.mongoHost);

        if (!isNullishOrEmptyString(args.repository)) {
            assert(args.repository);
            this.#repository = resolveAbsolutePath(args.repository);
        }

        this.#redisHost = args.redisHost;
        this.#mongoHost = args.mongoHost;
        this.#chains = args.chains;
    }

    get mongoHost() { return this.#mongoHost; }
    get redisHost() { return this.#redisHost; }

    /**
     * @param {PoCoHubRef | string} hub 
     */
    hasHub(hub) {
        if (hub === null || hub === undefined) {
            return false;
        }
        if (typeof hub === 'string') {
            for (let i = 0; i < this.#chains.length; ++i) {
                if (this.#chains[i].hubAlias() === hub) {
                    return true;
                }
            }
        } else {
            for (let i = 0; i < this.#chains.length; ++i) {
                if (this.#chains[i].eq(hub)) {
                    return true;
                }
            }
        }
        return false;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            chains: this.#chains
        }
    }

    /** @override */
    async isReady() {
        return this.#getVersionSucceeded();
    }

    /** 
     * @protected
     * @override 
     */
    async isBusyOverride() {
        /** @todo not yet implemented */
        await super.isBusyOverride();
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

    // /** 
    //  * @protected 
    //  * @param {number} pid 
    //  * @param {AbortSignal=} abortSignal 
    //  */
    // async waitUntilReadyOverride(pid, abortSignal) {
    //     // here 'await' is mendatory !
    //     await this.#waitUntilGetVersionSucceeded(pid, abortSignal);
    // }

    /**
     * @param {number} pid 
     * @param {{
     *      abortSignal?: AbortSignal
     *      progressCb?: types.progressCallback
     * }=} options
     */
    async #waitUntilGetVersionSucceeded(
        pid,
        options
    ) {
        const repeat = await repeatCallUntil(
            this.#getVersionSucceeded.bind(this),
            null,
            {
                waitBeforeFirstCall: 200,
                waitBetweenCallsMS: 400,
                maxCalls: 200,
                progressMessage: this._msgFmt("waiting for market api to be ready ...", pid),
                ... (options?.abortSignal && { abortSignal: options?.abortSignal }),
                ... (options?.progressCb && { progressCb: options?.progressCb })
            });

        if (!repeat.ok) {
            assert(repeat.error);
            throw repeat.error;
        }
    }

    /* --------------------------- Bash script --------------------------- */

    /**
     * @returns {Object.<string,string>}
     */
    #getEnv() {
        /*
        PORT,
        MONGO_HOST,
        REDIS_HOST,
      
        CHAINS,
        FLAVOUR, //standard | enterprise
      
        MAX_OPEN_ORDERS_PER_WALLET,
        RATE_LIMIT_MAX,
        RATE_LIMIT_PERIOD,
      
        GOERLI_ETH_RPC_HOST,
        GOERLI_IEXEC_ADDRESS,
        VIVIANI_ETH_RPC_HOST,
        VIVIANI_IEXEC_ADDRESS,
        MAINNET_ETH_RPC_HOST,
        MAINNET_IEXEC_ADDRESS,
        BELLECOUR_ETH_RPC_HOST,
        BELLECOUR_IEXEC_ADDRESS,
      
        INFURA_PROJECT_ID,
        GOERLI_ALCHEMY_API_KEY,
        MAINNET_ALCHEMY_API_KEY,
      
        CREATE_INDEX,

          id: getEnv(name, 'CHAIN_ID'),
          isNative: stringToBoolean(getEnv(name, 'IS_NATIVE', { strict: false })),
          flavour: getEnv(name, 'FLAVOUR', { strict: false }) || 'standard',
          host: getEnv(name, 'ETH_RPC_HOST'),
          hubAddress: getEnv(name, 'IEXEC_ADDRESS'),

        */

        assert(this.port);

        /** @type {Object.<string,string>} */
        const env = {};
        env['MONGO_HOST'] = this.#mongoHost;
        env['REDIS_HOST'] = this.#redisHost;
        env['PORT'] = this.port.toString();

        let chains = '';
        for (let i = 0; i < this.#chains.length; ++i) {
            const prefix = CHAIN_PREFIX + '_' + (i + 1);
            if (i > 0) {
                chains = chains + ',' + prefix;
            } else {
                chains = prefix;
            }
            const chain = this.#chains[i];
            assert(chain.address);
            assert(chain.httpHost);

            env[prefix + '_' + 'CHAIN_ID'] = chain.chainid.toString();
            env[prefix + '_' + 'IS_NATIVE'] = chain.isNative.toString();
            env[prefix + '_' + 'FLAVOUR'] = chain.isEnterprise ? 'enterprise' : 'standard';
            env[prefix + '_' + 'ETH_RPC_HOST'] = chain.httpHost;
            env[prefix + '_' + 'IEXEC_ADDRESS'] = chain.address;
        }
        env['CHAINS'] = chains;
        //env['DEBUG'] = 'iexec-market-api:config';
        env['DEBUG'] = 'iexec-market-api:*';
        //env['DEBUG'] = '*';
        return env;
    }

    /**
     * @param {string} destFilename 
     */
    async saveEnvFile(destFilename) {
        assert(!isNullishOrEmptyString(destFilename));
        assert(destFilename);
        assert(path.isAbsolute(destFilename));

        const destDir = path.dirname(destFilename);
        throwIfDirDoesNotExist(destDir);

        const envs = this.#getEnv();
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
        return [['iexec-market-api Server listening on port ' + this.port?.toString()]];
    }

    /**
     * @override
     * @protected
     * @param {number} pid 
     */
    getFailureORANDPatterns(pid) {
        return [['throw Error'], ['Error:']];
    }

    /** @override */
    async getPID() {
        try {
            if (!this.isLocal()) {
                return; /* undefined */
            }
            const grepPattern =
                "node " + ENTRY + ".*PORT=" + this.port.toString() + ".*CHAINS=" + CHAIN_PREFIX + "_1|" +
                "node " + ENTRY + ".*CHAINS=" + CHAIN_PREFIX + "_1.*PORT=" + this.port.toString();
            const pids = await psGrepPIDAndEnv(grepPattern);
            if (!pids) {
                return; /* undefined */
            }
            assert(pids.length === 1);
            return pids[0].pid;
        } catch { }
        return; /* undefined */
    }

    /** @override */
    async getStartBashScript() {
        if (!this.canStart) {
            throw new CodeError(`Cannot start market api service.`);
        }

        const apiRepoDir = this.#repository;
        assert(apiRepoDir);

        const logFilePath = this.logFile;
        if (logFilePath) {
            throwIfParentDirDoesNotExist(logFilePath);
        }
        const pidFilePath = this.pidFile;
        if (pidFilePath) {
            throwIfParentDirDoesNotExist(pidFilePath);
        }

        // return genNohupBashScript('node', {
        //     dir: apiRepoDir,
        //     env: this.#getEnv(),
        //     args: [ENTRY],
        //     logFile: logFilePath,
        //     pidFile: pidFilePath
        // });

        return genSetMBashScript('node', {
            dir: apiRepoDir,
            env: this.#getEnv(),
            args: [ENTRY],
            logFile: logFilePath,
            pidFile: pidFilePath,
            version: 1
        });

    }

    async #getVersionSucceeded() {
        try {
            const version = await this.getVersion();
            return !isNullishOrEmptyString(version);
        } catch (err) {
            return false;
        }
    }

    /**
     * @param {object} params
     * @param {(string | number)=} params.redis
     * @param {(string | number)=} params.mongo
     */
    static async stop({ redis, mongo }) {
        const _redis = hostnamePortToString(redis);
        const _mongo = hostnamePortToString(mongo);

        const pids = await MarketApiService.pidsFromHosts({ redis: _redis, mongo: _mongo });
        if (!pids) {
            return;
        }

        for (let i = 0; i < pids.length; ++i) {
            const pid = pids[i];
            const cwd = await getPIDCWD(pid.pid);

            const apiService = newMarketApiService({
                port: pid.port,
                repository: cwd,
                mongoHost: pid.mongoHost,
                redisHost: pid.redisHost,
                chains: pid.chains ?? []
            });
            await apiService.stop({ strict: true });
        }
    }

    static async running() {
        const pids = await MarketApiService.allPIDsWithEnvs();
        if (!pids) {
            return null;
        }

        const services = [];
        for (let i = 0; i < pids.length; ++i) {
            const pid = pids[i];
            const cwd = await getPIDCWD(pid.pid);

            const apiService = newMarketApiService({
                port: pid.port,
                repository: cwd,
                mongoHost: pid.mongoHost,
                redisHost: pid.redisHost,
                chains: pid.chains ?? []
            });
            services.push({ pid: pid.pid, service: apiService });
        }
        return (services.length === 0) ? null : services;
    }

    /**
     * @param {object} params
     * @param {(string | number)=} params.redis
     * @param {(string | number)=} params.mongo
     */
    static async fromHosts({ redis, mongo }) {
        const _redis = hostnamePortToString(redis);
        const _mongo = hostnamePortToString(mongo);

        const pids = await MarketApiService.pidsFromHosts({ redis: _redis, mongo: _mongo });
        if (!pids) {
            return null;
        }

        const services = [];
        for (let i = 0; i < pids.length; ++i) {
            const pid = pids[i];
            const cwd = await getPIDCWD(pid.pid);
            const apiService = newMarketApiService({
                port: pid.port,
                repository: cwd,
                mongoHost: pid.mongoHost,
                redisHost: pid.redisHost,
                chains: pid.chains ?? []
            });
            services.push(apiService);
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
        const o = MarketApiService.parseEnvVars(cmd);
        const cwd = await getPIDCWD(pid);
        return newMarketApiService({
            port: o.port,
            repository: cwd,
            mongoHost: o.mongoHost,
            redisHost: o.redisHost,
            chains: o.chains ?? []
        });
    }

    /**
     * @param {string} repository 
     */
    static async fromRepository(repository) {
        if (isNullishOrEmptyString(repository)) {
            return null;
        }

        const pids = await MarketApiService.allPIDsWithEnvs();
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
                const s = newMarketApiService({
                    port: pid.port,
                    repository: cwd,
                    mongoHost: pid.mongoHost,
                    redisHost: pid.redisHost,
                    chains: pid.chains ?? []
                });
                services.push(s);
            }
        }

        return services;
    }

    /**
     * @param {PoCoHubRef} hubRef 
     * @param {string=} ganacheDBUUID 
     */
    static async fromPoCoHubRef(hubRef, ganacheDBUUID) {
        if (!hubRef) {
            return null;
        }
        assert(hubRef.hasAddress);

        const pids = await MarketApiService.allPIDsWithEnvs();
        if (!pids || pids.length === 0) {
            return null;
        }

        const services = [];
        for (let i = 0; i < pids.length; ++i) {
            const pid = pids[i];

            const chains = pid.chains;
            if (!chains || chains.length === 0) {
                continue;
            }

            let found = false;
            for (let j = 0; j < chains.length; ++j) {
                if (hubRef.eq(chains[j])) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                continue;
            }

            const mongoService = await MongoService.fromHost(pid.mongoHost);
            if (!mongoService) {
                continue;
            }

            const sig = mongoService.getSig(MARKET_SIGNAME);
            if (sig) {
                assert(sig.serviceType === MARKET_TYPENAME);
                if (!marketEqSigItem(sig, hubRef, ganacheDBUUID)) {
                    continue;
                }
            }

            const cwd = await getPIDCWD(pid.pid);
            if (!cwd) {
                continue;
            }

            const dir = resolveAbsolutePath(cwd);
            const s = newMarketApiService({
                port: pid.port,
                repository: dir,
                mongoHost: pid.mongoHost,
                redisHost: pid.redisHost,
                chains: pid.chains ?? []
            });
            services.push(s);
        }

        return services;
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
                    "node " + ENTRY + ".*REDIS_HOST=" + redis + ".*CHAINS=" + CHAIN_PREFIX + "_1|" +
                    "node " + ENTRY + ".*CHAINS=" + CHAIN_PREFIX + "_1.*REDIS_HOST=" + redis;
            } else if (shouldGrepMongo) {
                shouldGrepMongo = false;
                grepPattern =
                    "node " + ENTRY + ".*MONGO_HOST=" + mongo + ".*CHAINS=" + CHAIN_PREFIX + "_1|" +
                    "node " + ENTRY + ".*CHAINS=" + CHAIN_PREFIX + "_1.*MONGO_HOST=" + mongo;
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
                const o = MarketApiService.parseEnvVars(cmd);
                const pid = pids[i].pid;
                if (!pid) {
                    continue;
                }
                array.push({ ...o, pid: pid });
            }
            if (array.length === 0) {
                return null;
            }
            return array;
        } catch (err) {
            if (err instanceof Error) {
                console.log(err.stack);
            }
        }
        return null;
    }

    static async allPIDsWithEnvs() {
        try {
            let grepPattern;
            grepPattern = "node " + ENTRY + ".*CHAINS=" + CHAIN_PREFIX + "_1";
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
                const o = MarketApiService.parseEnvVars(cmd);
                array.push({ ...o, pid: pids[i].pid });
            }
            if (array.length === 0) {
                return; /* undefined */
            }
            return array;
        } catch (err) {
            if (err instanceof Error) {
                console.log(err.stack);
            }
        }
        return; /* undefined */
    }

    /** @returns {Promise<number>} */
    async getVersion() {
        try {
            const response = await httpGET(this.url + 'version');
            const responseObj = JSON.parse(response);
            if (responseObj &&
                responseObj.ok &&
                responseObj.version) {
                return responseObj.version;
            }
        } catch (err) { }

        throw new CodeError(
            'Market API query failed',
            ERROR_CODES.MARKET_API_ERROR);
    }

    /**
     * @param {types.iExecObjectType} typename 
     * @param {number} chainid 
     * @param {string} orderhash 
     */
    async getOrderFromOrderhash(typename, chainid, orderhash) {
        if (!isBytes32String(orderhash)) {
            throw Error('Invalid orderhash');
        }
        if (!isStrictlyPositiveInteger(chainid)) {
            throw Error('Invalid chainid');
        }
        // if (!this.acceptChainid(chainid)) {
        //     throw Error('Chainid not managed by the Market API service');
        // }

        const endpoint = typename + "orders/" + orderhash;
        const query = "chainId=" + chainid;

        const api_url = this.url;
        try {
            // <marketUrl>/<typename>/orders/<orderhash>?chainId=<chainid>
            const orderResponse = await httpGET(api_url + "/" + endpoint + "?" + query);
            const o = JSON.parse(orderResponse);
            return o;
        } catch (err) {
            return { ok: false, error: err };
        }
    }

    /**
     * @param {string} str 
     */
    static parseEnvVars(str) {
        const varNames = ['PORT', 'MONGO_HOST', 'REDIS_HOST'];
        /** @type {Object.<string, string>} */
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
        let mongoHost = o['MONGO_HOST'];
        if (o['MONGO_HOST']) {
            // Add missing default Mongo port
            if (o['MONGO_HOST'].indexOf(':') < 0) {
                mongoHost = o['MONGO_HOST'] + ':27017';
            }
        }
        const port = stringToPositiveInteger(o['PORT']);
        assert(port);
        return {
            port: port,
            mongoHost: mongoHost,
            redisHost: o['REDIS_HOST'],
            chains: MarketApiService.envVarsToChains(str)
        }
    }

    /**
     * @param {string} str 
     */
    static envVarsToChains(str) {
        let i0 = str.indexOf('CHAINS=');
        if (i0 < 0) {
            return;
        }
        let i1 = str.indexOf(' ', i0);
        const CHAINS = str.substring(i0 + 7, i1).split(',');
        const chains = [];

        const varNames = ['ETH_RPC_HOST', 'IS_NATIVE', 'IEXEC_ADDRESS', 'FLAVOUR', 'CHAIN_ID'];
        for (let i = 0; i < CHAINS.length; ++i) {
            const chain = CHAINS[i];
            /** @type {Object.<string,string>} */
            const o = {};
            for (let k = 0; k < varNames.length; ++k) {
                const varName = varNames[k];
                const s = chain + '_' + varName + '=';
                const j0 = str.indexOf(s);
                if (j0 < 0) {
                    continue;
                }
                const j1 = str.indexOf(' ', j0);
                const varValue = (j1 < 0) ?
                    str.substring(j0 + s.length) :
                    str.substring(j0 + s.length, j1);
                o[varName] = varValue;
                //console.log(varName + '=' + varValue);
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
            chains.push(ref);
        }
        if (chains.length === 0) {
            return;
        }
        return chains;
    }
}