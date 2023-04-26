import * as types from '../common/common-types.js';
import * as srvTypes from './services-types-internal.js';
import * as ERROR_CODES from "../common/error-codes.js";
import path from 'path';
import assert from 'assert';
import { MongoClient } from 'mongodb';
import { ServerService } from '../common/service.js';
import { DBDirectory } from '../common/db-directory.js';
import { assertIsStrictlyPositiveInteger, isStrictlyPositiveInteger, throwIfNotStrictlyPositiveInteger } from '../common/number.js';
import { dirExists, readFile, resolveAbsolutePath, rmrfDir, throwIfDirDoesNotExist, throwIfParentDirDoesNotExist, toRelativePath } from '../common/fs.js';
import { isNullishOrEmptyString, stringToHostnamePort, stringToPositiveInteger, throwIfNullishOrEmptyString } from '../common/string.js';
import { CodeError } from '../common/error.js';
import { psGetArgs, psGetEnv, psGrepPID, psp } from '../common/ps.js';
import { genNohupBashScript } from '../common/bash.js';
import { repeatCallUntil } from '../common/repeat-call-until.js';
import { envVarName } from '../common/consts.js';

/**
 * @typedef {types.ServerServiceArgs &
 * {
 *      dbDir?: DBDirectory
 * }} MongoServiceConstructorArgs
 */

/* -------------------- MongoService Class ----------------------- */

export class MongoService extends ServerService {

    static typename() { return 'mongo'; }

    /** @type {boolean} */
    static #guardConstructing = false;

    /** @type {DBDirectory=} */
    #dbDir;

    /**
     * @param {MongoServiceConstructorArgs} args
     */
    constructor(args) {
        if (!MongoService.#guardConstructing) {
            throw new TypeError('class constructor is not accessible');
        }

        // port is required with MongoService
        if (!isStrictlyPositiveInteger(args.port)) {
            throw new TypeError("MongoService: Missing 'port' value");
        }

        super(args);

        this.#dbDir = args.dbDir;
    }

    /** @param {MongoServiceConstructorArgs} args */
    static #newMongoService(args) {
        try {
            MongoService.#guardConstructing = true;
            const o = new MongoService(args);
            MongoService.#guardConstructing = false;
            return o;
        } catch (err) {
            MongoService.#guardConstructing = false;
            throw err;
        }
    }

    get directory() {
        return this.#dbDir?.directory;
    }
    get DBUUID() {
        return this.#dbDir?.DBUUID;
    }

    /** 
     * @param {srvTypes.MongoConfig} config 
     * @param {boolean} resolvePlaceholders
     * @param {string=} relativeToDirectory
     */
    static async deepCopyConfig(config, resolvePlaceholders, relativeToDirectory) {
        const configCopy = { ...config };
        assert(configCopy.type === 'mongo');
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
    /**
     * - Returns `undefined` if db directory is undefined.
     * - Returns `true` if sig added successfully
     * - Returns `false` if sig is not compatible
     * - Throws an `exception` if save sig failed
     * @param {types.DBSignatureArg | null | undefined} sigArg 
     */
    addSig(sigArg) {
        return this.#dbDir?.addSig(sigArg);
    }

    /**
     * @param {string} sigName 
     */
    getSig(sigName) {
        return this.#dbDir?.getSig(sigName);
    }

    toJSON() {
        const json = {
            ... super.toJSON(),
            ... this.#dbDir?.toJSON(),
        };
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

    // --logappend
    // --pidfilepath
    // --logpath 
    // --port
    // --ipv6
    // --dbpath
    // --bind_ip
    /** 
     * @param {string=} logFile
     * @param {string=} pidFile
     */
    #getMongoCliArgs(logFile, pidFile) {
        const p = this.port;
        if (!p) {
            throw new CodeError('Missing mongo port', ERROR_CODES.MONGO_ERROR);
        }

        const mongoDir = this.#dbDir?.DBDir;
        throwIfDirDoesNotExist(mongoDir);
        assert(mongoDir);

        const args = [
            "--bind_ip", "localhost",
            "--port", p.toString(),
            "--ipv6",
            "--dbpath", mongoDir
        ];

        if (logFile) {
            args.push("--logappend");
            args.push("--logpath");
            args.push(logFile);
        }
        if (pidFile) {
            args.push("--pidfilepath");
            args.push(pidFile);
        }
        return args;
    }

    /** @override */
    async isReady() {
        try {
            assert(this.port);
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
        // One message displayed every `progressIntervalMS`
        // Message is displayed `progressCountMax` times
        // First message is displayed after `progressMessageDelay` iterations
        // Max total waiting time = progressIntervalMS * progressCountMax
        const ready = await this.#waitUntilPingSucceeded({
            progressIntervalMS: 1000,
            progressCountMax: 100,
            progressMessageDelay: 3,
            progressMessage: this._msgFmt("waiting for mongo to be ready ...", pid),
            progressCb: options?.progressCb
        });

        if (!ready) {
            throw new CodeError('start mongo failed', ERROR_CODES.MONGO_ERROR);
        }
    }

    /**
     * Write a progress message every `progressIntervalMS`, `progressCountMax` times.
     * - if the MongoClient command is completed. Progess stops.
     * - if Progress reaches 100% = `progressIntervalMS * progressCountMax`, the MongoClient is shutdown  
     * - starts display message when counter is >= `progressMessageDelay`
     * @param {object} options 
     * @param {number} options.progressIntervalMS 
     * @param {number} options.progressCountMax 
     * @param {number} options.progressMessageDelay 
     * @param {string=} options.progressMessage
     * @param {types.progressCallback=} options.progressCb
     * @returns {Promise<boolean>}
     */
    async #waitUntilPingSucceeded({
        progressIntervalMS = 700,
        progressCountMax = 100,
        progressMessageDelay = 0,
        progressMessage = undefined,
        progressCb = undefined }
    ) {
        try {
            progressIntervalMS = Math.floor(progressIntervalMS);
            progressCountMax = Math.floor(progressCountMax);
            if (progressIntervalMS < 100) { progressIntervalMS = 100; }

            const timeoutMongo = {
                client: new MongoClient(`mongodb://${this.hostname}:${this.port}`),
                clientClosed: false,
                countMax: progressCountMax,
                count: 0,
                intervalMS: progressIntervalMS,
                interval: setInterval(__intervalFunc, progressIntervalMS),
                message: progressMessage,
                messageDelay: progressMessageDelay
            };

            function __intervalFunc() {
                if (timeoutMongo.interval == null) {
                    return;
                }
                timeoutMongo.count++;
                if (timeoutMongo.messageDelay <= timeoutMongo.count) {
                    if (timeoutMongo.message) {
                        //console.log(timeoutMongo.message + Math.floor(100 * timeoutMongo.count / timeoutMongo.countMax).toString() + '%');
                    }
                    if (progressCb) {
                        progressCb({ count: timeoutMongo.count, total: timeoutMongo.countMax, value: null })
                    }
                }
                if (timeoutMongo.count >= timeoutMongo.countMax) {
                    __close(timeoutMongo, true);
                }
            }

            /**
             * @param {*} tom 
             * @param {*} keepClient 
             */
            function __close(tom, keepClient = true) {
                const interval = tom.interval; tom.interval = null;
                const client = tom.client; if (!keepClient) { tom.client = null; }

                if (client) {
                    if (!tom.clientClosed) {
                        tom.clientClosed = true;
                        client.close();
                    }
                }
                if (interval) { clearInterval(interval); }
            }

            return new Promise((resolve, reject) => {
                const admin = timeoutMongo.client.db().admin();
                admin.command({ ping: 1 }).then(
                    (doc) => { __close(timeoutMongo); resolve(true); },
                    (reason) => { __close(timeoutMongo); resolve(false); }
                );
            });
        } catch (err) { }

        return false;
    }

    /** 
     * @protected
     * @override 
     */
    async isBusyOverride() {
        await super.isBusyOverride();

        const mongoDir = this.#dbDir?.DBDir;
        assert(mongoDir);
        const s = await readFile(path.join(mongoDir, 'mongod.lock'));
        if (!isNullishOrEmptyString(s)) {
            assert(s);
            const pid = stringToPositiveInteger(s.trim());
            if (pid) {
                const running = await psp(pid);
                if (running) {
                    throw new CodeError(
                        `Another instance of mongo is already accessing storage directory '${mongoDir}'`,
                        ERROR_CODES.MONGO_ERROR);
                }
            }
        }
    }

    /** @override */
    async getPID() {
        if (!this.canStart) {
            return; /* undefined */
        }
        const mongoDir = this.#dbDir?.DBDir;
        assert(mongoDir);
        const grepPattern = `mongod.*--port ${this.port}.*--dbpath ${mongoDir}|mongod.*--dbpath ${mongoDir}.*--port ${this.port}`;
        const pids = await psGrepPID(grepPattern);
        if (!pids) {
            return; /* undefined */
        }
        assert(pids.length === 1);
        return pids[0];
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

        // We throw an exception if '#mongoDir' does not exist because
        // Mongo will automatically fail if the '--dbpath' directory
        // does not exist.
        const mongoDir = this.#dbDir?.DBDir;
        throwIfDirDoesNotExist(mongoDir);
        assert(mongoDir);

        if (options?.logFile) {
            throwIfParentDirDoesNotExist(options.logFile);
        }
        if (options?.pidFile) {
            throwIfParentDirDoesNotExist(options.pidFile);
        }

        const args = this.#getMongoCliArgs(options?.logFile, options?.pidFile);
        if (!args) {
            return null;
        }

        /** @type {any} */
        const o = {
            args,
            env: {}
        }
        if (options?.env) {
            const xnames = Object.keys(options.env);
            for (let i = 0; i < xnames.length; ++i) {
                o.env[envVarName(xnames[i])] = options.env[xnames[i]];
            }
        }

        return genNohupBashScript('mongod', o);
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

        try {
            const client = new MongoClient(`mongodb://${this.hostname}:${this.port}`);
            try {
                const admin = client.db().admin();
                await admin.command({ shutdown: 1 });
            } catch (e) { }
            // Always close client!
            try { client.close(); } catch { }
        } catch { }

        if (!options?.quiet) {
            //console.log(this._msgFmt("shutdown.", pid));
        }

        const thisSrv = this;
        async function __is_stopped() {
            const pid = await thisSrv.getPID();
            return (pid == null) ? true : false;
        }

        const repeat = await repeatCallUntil(
            __is_stopped,
            null,
            {
                waitBeforeFirstCall: 0,
                waitBetweenCallsMS: 200,
                maxCalls: 100,
                progressMessage: this._msgFmt("waiting for mongo to be stopped ...", pid),
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
                await MongoService.resetDB({ directory: this.#dbDir.directory });
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
        await DBDirectory.install({ type: 'mongo', directory });
    }

    /**
      * Throws an exception if failed.
      * @param {{
      *     directory: string
      * }} params
      */
    static async install({ directory }) {
        throwIfNullishOrEmptyString(directory);

        directory = resolveAbsolutePath(directory);

        const exists = dirExists(directory);

        const dbDir = (exists) ?
            await DBDirectory.load({ type: 'mongo', directory }) :
            await DBDirectory.install({ type: 'mongo', directory });
    }

    /**
     * - Does not require any running service
     * - Throws an exception if failed
     * @param {types.ServerServiceArgs & {
     *      directory: string
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
        const m = await MongoService.fromDirectory(directory);
        if (m) {
            if (m.port !== options.port) {
                throw new CodeError(
                    `Another mongo instance is already running on port=${m.port}`,
                    ERROR_CODES.MONGO_ERROR);
            }
            if (m.hostname !== hostname) {
                throw new CodeError(
                    `Another mongo instance is already running on hostname=${m.hostname}`,
                    ERROR_CODES.MONGO_ERROR);
            }
            if (!isNullishOrEmptyString(m.logFile) &&
                !isNullishOrEmptyString(options.logFile) &&
                m.logFile !== options.logFile) {
                throw new CodeError(
                    `Another mongo instance is already running using a conflicting logFile='${m.logFile}'`,
                    ERROR_CODES.MONGO_ERROR);
            }
            if (!isNullishOrEmptyString(m.pidFile) &&
                !isNullishOrEmptyString(options.pidFile) &&
                m.pidFile !== options.pidFile) {
                throw new CodeError(
                    `Another mongo instance is already running using a conflicting pidFile='${m.pidFile}'`,
                    ERROR_CODES.MONGO_ERROR);
            }

            if (!m.isSigCompatible(signature)) {
                throw new CodeError(
                    `Another mongo instance is already running with a conflicting signature`,
                    ERROR_CODES.MONGO_ERROR);
            }

            return m;
        }

        // Throws an exception if failed
        const dbDir = await DBDirectory.load({
            type: 'mongo',
            directory: directory,
            requestedDBSignature: signature
        });

        return this.#newMongoService({
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
        const mongos = await MongoService.running();
        if (!mongos) {
            return null;
        }
        const services = [];
        for (let i = 0; i < mongos.length; i++) {
            const mongo = mongos[i].service;
            if (mongo && mongo.usedByServiceType(serviceType)) {
                services.push(mongo);
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

        const args = await findMongoArgs(pid);
        if (!args || !args.bindIp || !args.port) {
            return null;
        }

        /** @type {DBDirectory=} */
        let dbDir;
        try {
            dbDir = await DBDirectory.loadDBDir({ type: 'mongo', dbDir: args.dbPath });
        } catch (err) {
            assert(err instanceof Error);
            console.log(err.stack);
            console.error(err.message);
            return null;
        }

        return this.#newMongoService({
            hostname: args.bindIp,
            port: stringToPositiveInteger(args.port),
            ... (args.logFile && { logFile: args.logFile }),
            ... (args.pidFile && { pidFile: args.pidFile }),
            dbDir
        });
    }

    /**
     * @param {!string} host
     */
    static async fromHost(host) {
        let { hostname, port } = stringToHostnamePort(host);
        if (!hostname || !port) {
            return null;
        }
        return MongoService.fromHostnamePort(hostname, port);
    }

    /**
     * @param {!number} port
     */
    static async fromPort(port) {
        return MongoService.fromHostnamePort('localhost', port);
    }

    /**
     * @param {!string} hostname 
     * @param {!number} port 
     */
    static async fromHostnamePort(hostname, port) {
        const pid = await mongoHostnamePortPID(hostname, port);
        if (!pid) {
            return null;
        }
        return MongoService.fromPID(pid);
    }

    /**
     * @param {!string} dir 
     */
    static async fromDirectory(dir) {
        dir = resolveAbsolutePath(dir);

        /** @type {DBDirectory=} */
        let dbDir;
        try {
            dbDir = await DBDirectory.load({ type: 'mongo', directory: dir });
        } catch { }

        if (!dbDir) {
            return null;
        }

        const pid = await mongoDirPID(dbDir.DBDir);
        if (!pid) {
            return null;
        }
        return MongoService.fromPID(pid);
    }

    /**
     * @override
     * @param {any=} filters 
     * @returns {Promise<{pid: number, configFile: string, service:(MongoService | null)}[] | null>} 
     */
    static async running(filters) {
        const grepPattern = "mongod -";
        const pids = await psGrepPID(grepPattern);
        if (!pids) {
            return null;
        }

        /** @param {number} pid */
        async function __fromPID(pid) {
            const configFile = (await psGetEnv(pid, envVarName('MARKER'))) ?? '';
            try {
                const s = await MongoService.fromPID(pid);
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
        let ms;
        if (typeof port === 'number') {
            assertIsStrictlyPositiveInteger(port);
            ms = await MongoService.fromHostnamePort(hostname, port);
        } else if (typeof pid === 'number') {
            assertIsStrictlyPositiveInteger(pid);
            ms = await MongoService.fromPID(pid);
        } else if (!isNullishOrEmptyString(directory)) {
            ms = await MongoService.fromDirectory(directory);
        }
        if (!ms) {
            return { ok: true };
        }
        return ms.stop();
    }
}

/**
 * @param {!number} pid 
 * @returns {Promise<any>}
 */
async function findMongoArgs(pid) {
    throwIfNotStrictlyPositiveInteger(pid);

    try {
        const argsArray = await psGetArgs(pid);
        if (!argsArray || argsArray.length === 0) {
            return; /* undefined */
        }
        assert(argsArray.length === 1);
        const args = argsArray[0];

        // not a redis-server ??
        const prefix = 'mongod -';
        if (!args.startsWith(prefix)) {
            return; /* undefined */
        }

        /**
         * @param {string} args 
         * @param {string} optName 
         */
        function __getOptValue(args, optName) {
            const i = args.indexOf(' ' + optName + ' ');
            if (i < 0) {
                return; /* undefined */
            }
            const j = args.indexOf('--', i + optName.length + 2);
            return (j < 0) ?
                args.substring(i + optName.length + 2).trim() :
                args.substring(i + optName.length + 2, j).trim();
        }

        const port = __getOptValue(args, '--port');
        const bindIp = __getOptValue(args, '--bind_ip');
        const dbPath = __getOptValue(args, '--dbpath');
        const ipv6 = (args.indexOf('--ipv6') >= 0);
        const logAppend = (args.indexOf('--logappend') >= 0);
        const logFile = __getOptValue(args, '--logpath');
        const pidFile = __getOptValue(args, '--pidfilepath');

        return {
            port,
            bindIp,
            dbPath,
            ipv6,
            logFile,
            logAppend,
            pidFile
        };
    } catch { }
    return; /* undefined */
}

/**
 * @param {string} absoluteDir 
 */
async function mongoDirPID(absoluteDir) {
    assert(path.isAbsolute(absoluteDir));
    try {
        if (isNullishOrEmptyString(absoluteDir)) {
            return; /* undefined */
        }
        const grepPattern = `mongod.*--dbpath ${absoluteDir} |mongod.*--dbpath ${absoluteDir}$`;
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
 * @param {string} hostname 
 * @param {number} port 
 */
async function mongoHostnamePortPID(hostname, port) {
    try {
        const h = (hostname === 'localhost') ? '127.0.0.1' : hostname;
        if (isNullishOrEmptyString(h) || !isStrictlyPositiveInteger(port)) {
            return; /* undefined */
        }
        const grepPattern = `mongod.*--port ${port}.*--bind_ip ${hostname} |mongod.*--bind_ip ${hostname}.*--port ${port} `;
        const pids = await psGrepPID(grepPattern);
        if (!pids) {
            return; /* undefined */
        }
        assert(pids.length === 1);
        return pids[0];
    } catch { }
    return; /* undefined */
}
