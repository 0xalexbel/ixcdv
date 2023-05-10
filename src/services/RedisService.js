import * as types from '../common/common-types.js';
import * as srvTypes from './services-types-internal.js';
import * as ERROR_CODES from "../common/error-codes.js";
import { DBDirectory } from '../common/db-directory.js';
import path from 'path';
import assert from 'assert';
import { ServerService } from '../common/service.js';
import { assertIsStrictlyPositiveInteger, isStrictlyPositiveInteger, throwIfNotStrictlyPositiveInteger } from '../common/number.js';
import { isNullishOrEmptyString, stringToHostnamePort, stringToPositiveInteger, throwIfNullishOrEmptyString } from '../common/string.js';
import { dirExists, errorDirDoesNotExist, fileExists, generateTmpPathname, mkDirP, resolveAbsolutePath, rmFile, rmrfDir, saveToFile, throwIfDirDoesNotExist, toRelativePath } from '../common/fs.js';
import { CodeError, fail, falseOrThrow } from '../common/error.js';
import { repeatCallUntil } from '../common/repeat-call-until.js';
import { killPIDAndWaitUntilFullyStopped, psGetArgs, psGetEnv, psGrepPID } from '../common/ps.js';
import { genSetMBashScript } from '../common/bash.js';
import { childProcessSpawn } from '../common/process.js';
import { envVarName } from '../common/consts.js';

/**
 * @typedef {types.ServerServiceArgs &
 * {
 *     dbDir?: DBDirectory
 *     redisConfFile?: string
 * }} RedisServiceConstructorArgs
 */

/* -------------------- RedisService Class ----------------------- */

export class RedisService extends ServerService {

    static typename() { return 'redis'; }

    /** @type {boolean} */
    static #guardConstructing = false;

    /** @type {DBDirectory=} */
    #dbDir;
    /** @type {string=} */
    #redisConfFile;
    /** @type {boolean=} */
    #redisConfFileIsTemporary;

    /**
     * @param {RedisServiceConstructorArgs} args
     */
    constructor(args) {
        if (!RedisService.#guardConstructing) {
            throw new TypeError('class constructor is not accessible');
        }

        // port is required with RedisService
        if (!isStrictlyPositiveInteger(args.port)) {
            throw new TypeError("RedisService: Missing 'port' value");
        }

        super(args);

        if (args.redisConfFile) {
            throwIfNullishOrEmptyString(args.redisConfFile);
            this.#redisConfFile = resolveAbsolutePath(args.redisConfFile);
        }

        this.#dbDir = args.dbDir;
    }

    /** @param {RedisServiceConstructorArgs} args */
    static #newRedisService(args) {
        try {
            RedisService.#guardConstructing = true;
            const o = new RedisService(args);
            RedisService.#guardConstructing = false;
            return o;
        } catch (err) {
            RedisService.#guardConstructing = false;
            throw err;
        }
    }

    get directory() {
        return this.#dbDir?.directory;
    }
    get signature() {
        return this.#dbDir?.signatureDict;
    }
    get DBUUID() {
        return this.#dbDir?.DBUUID;
    }

    /** 
     * @param {srvTypes.RedisConfig} config 
     * @param {boolean} resolvePlaceholders
     * @param {string=} relativeToDirectory
     */
    static async deepCopyConfig(config, resolvePlaceholders, relativeToDirectory) {
        const configCopy = { ...config };
        assert(configCopy.type === 'redis');
        if (relativeToDirectory) {
            if (configCopy.directory) {
                configCopy.directory = toRelativePath(relativeToDirectory, configCopy.directory);
            }
            if (configCopy.logFile) {
                configCopy.logFile = toRelativePath(relativeToDirectory, configCopy.logFile);
            }
        }
        return configCopy;
    }

    /**
     * @param {types.DBSignatureArg | null | undefined} sigArg 
     */
    isSigCompatible(sigArg) {
        return this.#dbDir?.isSigCompatible(sigArg);
    }

    toJSON() {
        const json = {
            ... super.toJSON(),
            ... this.#dbDir?.toJSON(),
        };
        if (this.#redisConfFile) { json['redisConfFile'] = this.#redisConfFile; }
        return json;
    }

    /** @override */
    get canStart() {
        if (!this.isLocal()) {
            return false;
        }
        if (isNullishOrEmptyString(this.directory)) {
            return false;
        }
        return true;
    }

    /**
     * @param {{
     *      logFile?: string     
     *      pidFile?: string     
     *      env?: {[envName: string]: string};
     * }} options
     */
    #genRedisConf({logFile, pidFile, env}) {
        const h = this.hostname;
        const p = this.port;
        if (!p) {
            throw new CodeError('Missing redis port', ERROR_CODES.REDIS_ERROR);
        }

        let e = '';
        if (env) {
            Object.entries(env).forEach(([envName, value]) => {
                e += envVarName(envName) + '=' + value.toString() + ' ';
            });
        }

        let s = ""
        if (h === 'localhost' || h === '127.0.0.1') {
            s += "bind 127.0.0.1 ::1\n";
        } else {
            s += "bind " + h + "\n";
        }
        if (p) {
            s += `port ${p.toString()}\n`;
        }
        s += "appendonly yes\n";
        s += "appenddirname appenddir\n";
        if (pidFile) {
            s += `pidfile ${pidFile}\n`;
        }
        if (logFile) {
            s += `logfile ${logFile}\n`;
        }
        s += `dir ./\n`;

        if (!isNullishOrEmptyString(e)) {
            s += `proc-title-template "{title} {listen-addr} {server-mode} ${e}"\n`;
        }
        return s;
    }

    /** @override */
    async isReady() {
        try {
            assert(this.port);
            await ping(this.hostname, this.port, { strict: true });
            return true;
        } catch (err) {
            return false;
        }
    }

    /** 
     * @protected 
     * @param {number} pid 
     * @param {{
     *      abortSignal?: AbortSignal
     *      progressCb?: types.progressCallback
     * }=} options
     */
    async waitUntilReadyOverride(pid, options) {
        // here 'await' is mendatory !
        await this.#waitUntilPingSucceeded(pid, options);
    }

    /**
     * @param {number} pid 
     * @param {{
     *      abortSignal?: AbortSignal
     *      progressCb?: types.progressCallback
     * }=} options
     */
    async #waitUntilPingSucceeded(
        pid,
        options
    ) {
        const repeat = await repeatCallUntil(
            ping,
            [this.hostname, this.port, { strict: true }],
            {
                waitBeforeFirstCall: 200,
                waitBetweenCallsMS: 400,
                maxCalls: 200,
                progressMessage: this._msgFmt("waiting for redis to be ready ...", pid),
                ... (options?.abortSignal && { abortSignal: options?.abortSignal }),
                ... (options?.progressCb && { progressCb: options?.progressCb }),
            });

        if (!repeat.ok) {
            assert(repeat.error);
            throw repeat.error;
        }
    }

    /** @override */
    async getPID() {
        try {
            if (!this.canStart) {
                return; /* undefined */
            }
            const h = (this.hostname === 'localhost') ? '127.0.0.1' : this.hostname;
            const grepPattern = "redis-server " + h + ":" + this.port;
            const pids = await psGrepPID(grepPattern);
            if (!pids) {
                return; /* undefined */
            }
            assert(pids.length === 1);
            return pids[0];
        } catch { }
        return; /* undefined */
    }

    /** 
     * @protected
     * @override 
     */
    async isBusyOverride() {
        /** @todo not yet implemented */
        await super.isBusyOverride();
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
            return null;
        }

        const redisDir = this.#dbDir?.DBDir;
        throwIfDirDoesNotExist(redisDir);
        assert(redisDir);

        // Setup a temporary redis.conf file
        if (!this.#redisConfFile) {
            this.#redisConfFileIsTemporary = true;
            this.#redisConfFile = await generateTmpPathname('redis/') + '.conf';
            assert(!fileExists(this.#redisConfFile));
        }

        if (!fileExists(this.#redisConfFile)) {
            if (!this.#redisConfFileIsTemporary) {
                return null;
            }

            // generate the temporary conf file
            mkDirP(path.dirname(this.#redisConfFile));
            const ok = await saveToFile(
                this.#genRedisConf(options ?? {}),
                path.dirname(this.#redisConfFile),
                path.basename(this.#redisConfFile));

            if (!ok) {
                return null;
            }
        }

        /** @type {any} */
        const o = {
            dir: redisDir,
            args: [this.#redisConfFile],
            env: {},
            version: 4
        }

        if (options?.env) {
            const xnames = Object.keys(options.env);
            for (let i = 0; i < xnames.length; ++i) {
                o.env[envVarName(xnames[i])] = options.env[xnames[i]];
            }
        }

        return genSetMBashScript('redis-server', o);
    }

    /** 
     * @override
     * @protected 
     * @param {CodeError} startError 
     */
    async onStartFailedOverride(startError) {
        this.#deleteTmpRedisConfFile();
    }

    /** 
     * @override
     * @protected 
     * @param {number} pid 
     * @param {boolean} alreadyStarted
     */
    async onReadyOverride(pid, alreadyStarted) {
        this.#deleteTmpRedisConfFile();
    }

    async #deleteTmpRedisConfFile() {
        if (this.#redisConfFile) {
            if (this.#redisConfFileIsTemporary) {
                await rmFile(this.#redisConfFile);
                this.#redisConfFile = undefined;
            }
        }
    }

    /** 
     * Throws an exception if failed.
     * @override 
     * @protected 
     * @param {number} pid
     * @param {types.StopOptions=} options
     */
    async stopOverride(pid, options) {
        // compiler warning
        assert(this.port);

        // Execute shutdown command
        // 'shutdown' command may fail is some situations.
        // For example: 
        // - start redis with a given storage directory.
        // - call rm -rf <redis storage dir>
        // - internaly, redis will reset the storage directory to 'null'
        // - when the 'shutdown' command is called, since there is no more
        //   storage dir, the operation will fail.
        // - it's worth noting that 'shutdown' and 'kill SIGINT' are equivalent
        const out = await shutdown(
            this.hostname,
            this.port,
            { strict: false });

        if (!out.ok) {
            // shutdown failed. Use kill -6 instead (SIGABRT)
            // using standard kill would be equivalent to 'shutdown'
            await killPIDAndWaitUntilFullyStopped(pid,
                {
                    killSignal: 6, //SIGABRT
                    ... (options?.quiet && {
                        progressMessage: this._msgFmt(
                            "waiting for service to be stopped ...", pid)
                    }),
                    ... (options?.abortSignal && {
                        abortSignal: options.abortSignal
                    }),
                });
            return;
        }

        if (!options?.quiet) {
            //console.log(this._msgFmt("shutdown succeeded.", pid));
        }

        const __is_stopped = async () => {
            const pid = await this.getPID();
            return (pid == null) ? true : false;
        }

        const repeat = await repeatCallUntil(
            __is_stopped.bind(this),
            null,
            {
                waitBeforeFirstCall: 0,
                waitBetweenCallsMS: 200,
                maxCalls: 100,
                progressMessage: this._msgFmt("waiting for redis to be stopped ...", pid),
                ... (options?.abortSignal && { abortSignal: options.abortSignal })
            });

        if (!repeat.ok) {
            throw repeat.error;
        }
    }

    /**
      * @override
      * @param {number | undefined} pid 
      * @param {types.StopOptionsWithContext=} options
      */
    async onStoppedOverride(pid, options) {
        if (options?.reset === true) {
            if (this.#dbDir) {
                await RedisService.resetDB({ directory: this.#dbDir.directory });
            }
        }
    }

    /**
     * Throws an exception if failed.
     * @param {{
     *     directory: string
     * }} params
     */
    static async resetDB({ directory }) {
        throwIfNullishOrEmptyString(directory);

        directory = resolveAbsolutePath(directory);

        await rmrfDir(directory, { strict: true });
        await DBDirectory.install({ type: 'redis', directory });
    }

    /**
     * Throws an exception if failed.
     * @param {{
     *     directory:string
     * }} params
     */
    static async install({ directory }) {
        throwIfNullishOrEmptyString(directory);

        directory = resolveAbsolutePath(directory);

        const exists = dirExists(directory);

        // Throws an exception if failed.
        const dbDir = (exists) ?
            await DBDirectory.load({ type: 'redis', directory }) :
            await DBDirectory.install({ type: 'redis', directory });
    }

    /**
     * - Does not require any running service
     * - Throws an exception if failed
     * @param {types.ServerServiceArgs & {
     *      directory:string
     *      signature?: types.DBSignatureArg
     * }} params
     */
    static async newInstance({ directory, signature, ...options }) {
        throwIfNullishOrEmptyString(directory);

        directory = resolveAbsolutePath(directory);
        throwIfDirDoesNotExist(directory);

        const hostname = options.hostname ?? 'localhost';

        // Only one instance can run on a given directory.
        // If one instance is already running, check if it is
        // compatible.
        const m = await RedisService.fromDirectory(directory);
        if (m) {
            if (m.port !== options.port) {
                throw new CodeError(
                    `Another redis instance is already running on port=${m.port}`,
                    ERROR_CODES.REDIS_ERROR);
            }

            if (hostname === 'localhost') {
                if (m.hostname !== 'localhost' && m.hostname !== '127.0.0.1') {
                    throw new CodeError(
                        `Another redis instance is already running on hostname=${m.hostname}`,
                        ERROR_CODES.REDIS_ERROR);
                }
            } else if (hostname != m.hostname) {
                throw new CodeError(
                    `Another redis instance is already running on hostname=${m.hostname}`,
                    ERROR_CODES.REDIS_ERROR);
            }

            if (!isNullishOrEmptyString(m.logFile) &&
                !isNullishOrEmptyString(options.logFile) &&
                m.logFile !== options.logFile) {
                throw new CodeError(
                    `Another redis instance is already running using a conflicting logFile='${m.logFile}'`,
                    ERROR_CODES.REDIS_ERROR);
            }
            if (!isNullishOrEmptyString(m.pidFile) &&
                !isNullishOrEmptyString(options.pidFile) &&
                m.pidFile !== options.pidFile) {
                throw new CodeError(
                    `Another redis instance is already running using a conflicting pidFile='${m.pidFile}'`,
                    ERROR_CODES.REDIS_ERROR);
            }

            if (!m.isSigCompatible(signature)) {
                throw new CodeError(
                    `Another redis instance is already running with a conflicting signature`,
                    ERROR_CODES.REDIS_ERROR);
            }

            return m;
        }

        // Throws an exception if failed
        const dbDir = await DBDirectory.load({
            type: 'redis',
            directory: directory,
            requestedDBSignature: signature
        });

        return RedisService.#newRedisService({
            ...options,
            dbDir
        });
    }

    /**
     * @param {string} serviceType 
     */
    usedByServiceType(serviceType) {
        if (!this.#dbDir) {
            return false;
        }
        return this.#dbDir.usedByServiceType(serviceType);
    }

    /**
     * @param {string} serviceType 
     */
    static async fromServiceType(serviceType) {
        const redis = await RedisService.running();
        if (!redis) {
            return null;
        }
        const services = [];
        for (let i = 0; i < redis.length; i++) {
            const r = redis[i].service;
            if (r && r.usedByServiceType(serviceType)) {
                services.push(r);
            }
        }
        return (services.length === 0) ? null : services;
    }

    /**
     * @param {!number} pid 
     */
    static async fromPID(pid) {
        if (!isStrictlyPositiveInteger(pid)) {
            return null;
        }
        assert(pid);

        const hp = await findRedisHostPort(pid);
        if (!hp) {
            return null;
        }

        let infos;
        try {
            const out = await getRedisConfigInfo(
                hp.host,
                hp.port,
                { strict: true });

            if (out.ok) {
                infos = out.result;
            }
        } catch { }

        if (!infos) {
            return null;
        }

        /** @type {DBDirectory=} */
        let dbDir;
        try {
            dbDir = await DBDirectory.loadDBDir({ type: 'redis', dbDir: infos.dir });
        } catch (err) {
            // if (err instanceof Error) {
            //     console.error(err.message);
            // }
            return null;
        }

        return RedisService.#newRedisService({
            hostname: hp.host,
            port: hp.port,
            ... (infos.logfile && { logFile: infos.logfile }),
            ... (infos.pidfile && { pidFile: infos.pidfile }),
            dbDir
        });
    }

    /**
     * @param {!string} host
     */
    static async fromHost(host) {
        const { hostname, port } = stringToHostnamePort(host);
        if (!hostname || !port) {
            return null;
        }
        return RedisService.fromHostnamePort(hostname, port);
    }

    /**
     * @param {!number} port
     */
    static async fromPort(port) {
        return RedisService.fromHostnamePort('localhost', port);
    }

    /**
     * @param {!string} hostname 
     * @param {!number} port 
     */
    static async fromHostnamePort(hostname, port) {
        const pid = await findRedisPID(hostname, port);
        if (!pid) {
            return null;
        }

        try {
            const out = await getRedisConfigInfo(hostname, port, { strict: true });
            if (out.ok) {
                const infos = out.result;
                if (isNullishOrEmptyString(infos.dir)) {
                    console.error(`Unable to retrieve redis-server directory (${hostname}:${port})`);
                    return null;
                }

                /** @type {DBDirectory=} */
                let dbDir;
                try {
                    dbDir = await DBDirectory.loadDBDir({ type: 'redis', dbDir: infos.dir });
                } catch (err) {
                    if (err instanceof Error) {
                        console.error(err.message);
                    }
                    return null;
                }

                let o = null;
                RedisService.#guardConstructing = true;
                try {
                    o = new RedisService({
                        hostname,
                        port,
                        ... (infos.logfile && { logFile: infos.logfile }),
                        ... (infos.pidfile && { pidFile: infos.pidfile }),
                    });
                    o.#dbDir = dbDir;
                } catch { }
                RedisService.#guardConstructing = false;
                return o;
            }
        } catch { }

        return null;
    }

    /**
     * @param {!string} dir 
     */
    static async fromDirectory(dir) {
        throwIfNullishOrEmptyString(dir);
        if (!dirExists(dir)) {
            return null;
        }

        const pidServices = await RedisService.running();
        if (!pidServices || pidServices.length === 0) {
            return null;
        }

        dir = resolveAbsolutePath(dir);
        const result = [];
        for (let i = 0; i < pidServices.length; ++i) {
            const ps = pidServices[i].service;
            if (ps && ps.directory === dir) {
                result.push(ps);
            }
        }
        assert(result.length <= 1);
        if (result.length === 0) {
            return null;
        }

        return result[0];
    }

    /**
     * @override
     * @param {any=} filters 
     * @returns {Promise<{pid: number, configFile: string, service:(RedisService | null)}[] | null>} 
     */
    static async running(filters) {
        const grepPattern = "redis-server ";
        const pids = await psGrepPID(grepPattern);
        if (!pids) {
            return null;
        }

        /** @param {number} pid */
        async function __fromPID(pid) {
            const configFile = (await psGetEnv(pid, envVarName('MARKER'))) ?? '';
            try {
                const s = await RedisService.fromPID(pid);
                return { pid, configFile, service: s }
            } catch {
                return { pid, configFile, service: null }
            }
        }
        return Promise.all(pids.map(pid => __fromPID(pid)));
    }

    /** @param {*} params */
    static async stop({ hostname, port, pid, directory }) {
        if (!hostname) {
            hostname = 'localhost';
        }
        let rs;
        if (typeof port === 'number') {
            assertIsStrictlyPositiveInteger(port);
            rs = await RedisService.fromHostnamePort(hostname, port);
        } else if (typeof pid === 'number') {
            assertIsStrictlyPositiveInteger(pid);
            rs = await RedisService.fromPID(pid);
        } else if (!isNullishOrEmptyString(directory)) {
            rs = await RedisService.fromDirectory(directory);
        }
        if (!rs) {
            return { ok: true };
        }
        return rs.stop();
    }

}

/**
 * @param {!number} pid 
 * @returns {Promise<{host:string, port:number} | undefined>}
 */
async function findRedisHostPort(pid) {
    throwIfNotStrictlyPositiveInteger(pid);

    try {
        const argsArray = await psGetArgs(pid);
        if (!argsArray || argsArray.length === 0) {
            return; /* undefined */
        }
        assert(argsArray.length === 1);
        const args = argsArray[0];

        // not a redis-server ??
        const prefix = 'redis-server ';
        if (!args.startsWith(prefix)) {
            return; /* undefined */
        }
        const i = args.lastIndexOf(':');
        if (i < 0) {
            return; /* undefined */
        }
        let i1 = args.indexOf(' ', i);
        if (i1 < 0) {
            i1 = args.length;
        }
        const port = stringToPositiveInteger(args.substring(i + 1, i1));
        if (!port) {
            return; /* undefined */
        }
        const host = args.substring(prefix.length, i);
        if (isNullishOrEmptyString(host)) {
            return; /* undefined */
        }
        return { host, port };
    } catch { }
    return; /* undefined */
}

/**
 * @param {string} hostname 
 * @param {number} port 
 */
async function findRedisPID(hostname, port) {
    try {
        const h = (hostname === 'localhost') ? '127.0.0.1' : hostname;
        if (isNullishOrEmptyString(h) || !isStrictlyPositiveInteger(port)) {
            return; /* undefined */
        }
        const grepPattern = "redis-server " + h + ":" + port.toString();
        const pids = await psGrepPID(grepPattern);
        if (!pids) {
            return; /* undefined */
        }
        assert(pids.length === 1);
        return pids[0];
    } catch { }
    return; /* undefined */
}

/** 
 * @param {!string} host 
 * @param {!number} port 
 * @param {types.Strict=} strict 
 * @returns {types.PromiseResultOrCodeError<Object.<string?, string>>}
 */
async function getRedisConfigInfo(host, port, strict) {
    throwIfNullishOrEmptyString(host);
    throwIfNotStrictlyPositiveInteger(port);

    const out = await configGet(host, port, ["bind", "dir", "logfile", "pidfile"], strict);
    if (!out.ok) {
        return out;
    }

    /** @type {Object.<string,string>} */
    const config = {};
    assert(out.result);
    const lines = out.result.split('\n');
    for (let i = 0; i < lines.length / 2; ++i) {
        const k = lines[2 * i];
        const v = lines[2 * i + 1];
        config[k] = v;
    }
    return { ok: true, result: config };
}


/**
 * Executes redis-cli shutdown
 * - `redis-cli -h <host> -p <port> shutdown`
 * @param {!string} host 
 * @param {!number} port
 * @param {types.Strict=} options
 * @returns {types.PromiseOkOrCodeError}
 */
export async function shutdown(host, port, options) {
    const out = await redisCliGet(process.cwd(), ["-h", host, "-p", port.toString(), "shutdown"], null, options);
    if (!out.ok) {
        return fail(out.error, options);
    }
    if (out.result.startsWith('ERR ')) {
        return fail(new CodeError(out.result.trim(), ERROR_CODES.REDIS_ERROR), options);
    }
    return { ok: true };
}

/**
 * Executes redis-cli ping
 * - `redis-cli -h <host> -p <port> ping`
 * @param {!string} host 
 * @param {!number} port
 * @param {types.Strict=} options
 * @returns {Promise<boolean>}
 */
export async function ping(host, port, options) {
    const out = await redisCliGet(process.cwd(), ["-h", host, "-p", port.toString(), "ping"], null, options);
    if (!out.ok) {
        assert(out.error);
        return falseOrThrow(out.error, options);
    }
    assert(out.result);
    return (out.result.trim() === 'PONG');
}

/**
 * Executes redis-cli config get ...args
 * - `redis-cli -h <host> -p <port> config get dir`
 * @param {!string} host 
 * @param {!number} port
 * @param {!string[]} args
 * @param {types.Strict=} options
 */
export async function configGet(host, port, args, options) {
    return redisCliGet(process.cwd(), ["-h", host, "-p", port.toString(), "config", "get", ...args], null, options);
}

/**
 * @param {!string} dir 
 * @param {!string[]} args 
 * @param {?Object.<string,string>} env 
 * @param {types.Strict=} options
 * @returns {types.PromiseResultOrCodeError<string>}
 */
export async function redisCliGet(dir, args, env, options = { strict: true }) {
    if (!dirExists(dir)) {
        return fail(errorDirDoesNotExist(dir), options);
    }

    /** @type {any} */
    const opts = {
        mergeProcessEnv: true,
        stdout: {
            trim: false,
            return: true
        },
        stderr: {
            return: true
        },
        spawnOptions: {
            cwd: dir
        }
    };
    if (env) {
        opts.spawnOptions.env = env;
    }

    const redisResult = await childProcessSpawn('redis-cli', args, opts);

    if (redisResult.code === 0) {
        return { ok: true, result: redisResult.stdout.out ?? '' }
    }

    const err = new CodeError((redisResult.stderr.out ?? ''), ERROR_CODES.REDIS_ERROR);

    if (options?.strict) {
        throw err;
    }
    return { ok: false, error: err };
}
