import * as types from './types.js';
import assert from 'assert';
import { BigNumber } from 'ethers';
import { resolveAbsolutePath, throwIfDirDoesNotExist, throwIfParentDirDoesNotExist, which } from './fs.js';
import { genSetMBashScript } from './bash.js';
import { httpPOST } from './http.js';
import { isNullishOrEmptyString, stringToPositiveInteger } from './string.js';
import { isPositiveInteger, isStrictlyPositiveInteger } from './number.js';
import { ethersIsValidMnemonic } from './ethers.js';
import { CodeError } from './error.js';
import * as ERROR_CODES from './error-codes.js';
import { repeatCallUntil } from './repeat-call-until.js';
import { ServerService } from './service.js';
import { psGetArgs, psGetEnv, psGrepPID, psGrepPIDAndArgs } from './ps.js';
import { envVarName } from './consts.js';

/* ---------------------- Ganache defaults ------------------------ */

export const GANACHE_MINER_CALLGASLIMIT = "9007199254740991";
export const GANACHE_MINER_DEFAULTTRANSACTIONGASLIMIT = "5000000";
export const GANACHE_CHAIN_ASYNCREQUESTPROCESSING = "false";
export const GANACHE_CHAIN_HARDFORK = "london"; //Ganache v7
export const GANACHE_WALLET_TOTALACCOUNTS = 20;

/* ------------------------- Helpers ------------------------------- */

export async function isGanacheInstalled() {
    const path = which('ganache');
    return !!(path);
}

/* -------------------- GanacheService Class ----------------------- */

export class GanacheService extends ServerService {

    /** 
     * @override
     * @returns {typeof GanacheService} 
     */
    theClass() { return GanacheService; }

    static typename() { return 'ganache'; }

    /** @type {types.positiveInteger} */
    #chainid;
    /** @type {types.positiveInteger} */
    #networkid;

    /** @type {types.positiveInteger} */
    #totalAccounts;

    /** @type {string} */
    #mnemonic;

    /** @type {string} */
    #dbPath;

    /** @type {string} */
    #minerCallGasLimit;

    /** @type {string} */
    #minerDefaultTransactionGasLimit

    /** @type {string} */
    #chainAsyncRequestProcessing;

    /** @type {string} */
    #chainHardfork;

    /**
     * @param {types.GanacheServiceArgs} args
     */
    constructor(args) {
        assert(args);
        assert(!isNullishOrEmptyString(args.dbPath));
        assert(isPositiveInteger(args.chainid));
        assert(!isNullishOrEmptyString(args.mnemonic));
        assert(ethersIsValidMnemonic(args.mnemonic));

        super(args);

        // chainid is not optional
        this.#chainid = args.chainid;
        this.#networkid = args.chainid;
        // dbPath is not optional
        // dbPath may not yet exist
        this.#dbPath = resolveAbsolutePath(args.dbPath);
        // mnemonic is not optional
        this.#mnemonic = args.mnemonic;

        this.#minerCallGasLimit = GANACHE_MINER_CALLGASLIMIT;
        this.#minerDefaultTransactionGasLimit = GANACHE_MINER_DEFAULTTRANSACTIONGASLIMIT;
        this.#chainAsyncRequestProcessing = GANACHE_CHAIN_ASYNCREQUESTPROCESSING;
        this.#chainHardfork = GANACHE_CHAIN_HARDFORK;
        this.#totalAccounts = GANACHE_WALLET_TOTALACCOUNTS;
    }

    get chainid() { return this.#chainid; }
    get mnemonic() { return this.#mnemonic; }
    get dbPath() { return this.#dbPath; }

    toJSON() {
        const json = {
            ...super.toJSON(),
            chainid: this.#chainid,
            mnemonic: this.#mnemonic,
            dbPath: this.#dbPath,
        };
        return json;
    }

    /* ------------------------------ Load ------------------------------ */

    /**
     * Returns the full command line arguments as an array
     * - Required when executing `ps -ef | grep ...`
     * - Required to generate the bash start script
     */
    #getGanacheCliArgs() {
        assert(!isNullishOrEmptyString(this.#minerCallGasLimit));
        assert(!isNullishOrEmptyString(this.#minerDefaultTransactionGasLimit));
        assert(!isNullishOrEmptyString(this.#chainAsyncRequestProcessing));
        assert(!isNullishOrEmptyString(this.#dbPath));
        assert(!isNullishOrEmptyString(this.#mnemonic));
        assert(isStrictlyPositiveInteger(this.#chainid));
        assert(isStrictlyPositiveInteger(this.#networkid));

        const args = [
            "--miner.callGasLimit", this.#minerCallGasLimit,
            "--miner.defaultTransactionGasLimit", this.#minerDefaultTransactionGasLimit,
            "--chain.asyncRequestProcessing", this.#chainAsyncRequestProcessing,
            "--chain.hardfork", this.#chainHardfork,
            "--wallet.totalAccounts", this.#totalAccounts.toString(),
            "-m", this.#mnemonic,
            // Always specify '--chain.chainId' (grep getPID)
            "--chain.chainId", this.#chainid.toString(),
            "--chain.networkId", this.#networkid.toString(),
            // Always specify '--server.host' (grep getPID)
            "--server.host", this.hostname
        ];
        if (this.port) {
            args.push("--server.port");
            args.push(this.port.toString());
        }
        // MUST end with dbPath ! (egrep!)
        if (!isNullishOrEmptyString(this.#dbPath)) {
            args.push("--database.dbPath");
            args.push(this.#dbPath);
        }
        return args;
    }

    /** 
     * @protected 
     * @override 
     */
    async isBusyOverride() {
        await super.isBusyOverride();

        const grepPattern = "node.*ganache.*--database.dbPath " + this.dbPath + "$";
        const pids = await psGrepPID(grepPattern);
        if (!pids || pids.length === 0) {
            return;
        }

        throw new CodeError(
            this._msgFmt(`dbPath '${this.#dbPath}' already in use.`),
            ERROR_CODES.GANACHE_ERROR);
    }

    /**
     * @param {types.StartOptionsWithContext=} options
     * @returns {Promise<types.StartReturn>}
     */
    async start(options) {
        if (!options) {
            options = {};
        }
        // if (this.dbPath) {
        //     const lockFile = pathlib.join(this.dbPath, 'LOCK');
        //     if (fileExists(lockFile)) {
        //         return fail(
        //             new CodeError(`Ganache lock ${lockFile}: Resource temporarily unavailable`, ERROR_CODES.GANACHE_ERROR),
        //             options);
        //     }
        // }
        return super.start(options);
    }

    /**
     * @param {object} args 
     * @param {number=} args.chainid 
     * @param {number=} args.port 
     * @param {string=} args.mnemonic 
     * @param {string=} args.dbPath 
     */
    static async runningPIDs({ chainid, port, mnemonic, dbPath } = {}) {
        const grepPattern = "node.*ganache.*--chain.chainId.*--server.host ";
        const pids = await psGrepPIDAndArgs(grepPattern);
        if (!pids) {
            return null;
        }
        /** @type {{pid: number, options:{[name:string]: string | number | null}}[]} */
        const res = [];
        for (let i = 0; i < pids.length; ++i) {
            const args = pids[i].args;
            if (isNullishOrEmptyString(args)) {
                continue;
            }
            const options = GanacheService.#parseArgs(args);
            if (!options) {
                continue;
            }
            if (dbPath && options['--database.dbPath'] !== dbPath) {
                continue;
            }
            if (chainid !== null && chainid !== undefined && options['--chain.chainId'] !== chainid) {
                continue;
            }
            if (port !== null && port !== undefined && options['--server.port'] !== port) {
                continue;
            }
            if (mnemonic !== null && mnemonic !== undefined && options['-m'] !== mnemonic) {
                continue;
            }
            res.push({ pid: pids[i].pid, options });
        }
        return res;
    }

    /**
     * @override
     * @param {object=} filters 
     * @returns {Promise<{pid: number, configFile: string, service:(GanacheService | null)}[] | null>} 
     */
    static async running(filters) {
        const pids = await this.runningPIDs(filters);
        if (!pids || pids.length === 0) {
            return null;
        }

        const services = [];
        for (let i = 0; i < pids.length; ++i) {
            const pid = pids[i].pid;
            const configFile = (await psGetEnv(pid, envVarName('MARKER'))) ?? '';

            const opts = pids[i].options;
            const g = GanacheService.#fromOpts(opts);
            services.push({ pid, configFile, service: g });
        }
        if (services.length === 0) {
            return null;
        }
        return services;
    }

    static async runningGroupedByUniqueChainid() {
        const services = await this.running();
        if (!services || services.length === 0) {
            return null;
        }

        /** @type {Map<number, GanacheService>} */
        const chains = new Map();

        for (let i = 0; i < services.length; ++i) {
            const g = services[i].service;
            if (!g) {
                continue;
            }
            if (chains.has(g.chainid)) {
                throw new CodeError(
                    `Multiple ganache services with chainid=${g.chainid} are running.`,
                    ERROR_CODES.GANACHE_ERROR);
            }
            chains.set(g.chainid, g);
        }

        return chains;
    }

    /** @returns {Promise<Map<number, GanacheService[]> | null>} */
    static async runningGroupedByChainid() {
        const services = await this.running();
        if (!services || services.length === 0) {
            return null;
        }

        /** @type {Map<number, GanacheService[]>} */
        const chains = new Map();

        for (let i = 0; i < services.length; ++i) {
            const g = services[i].service;
            if (!g) {
                continue;
            }
            if (chains.has(g.chainid)) {
                chains.get(g.chainid)?.push(g);
            } else {
                chains.set(g.chainid, [g]);
            }
        }

        return chains;
    }

    /**
     * @param {types.positiveInteger} pid 
     */
    static async fromPID(pid) {
        if (!pid) {
            return null;
        }
        const argsArray = await psGetArgs(pid);
        if (!argsArray || argsArray.length === 0) {
            return null;
        }
        assert(argsArray.length === 1);
        const options = GanacheService.#parseArgs(argsArray[0]);
        if (!options) {
            return null;
        }
        const g = GanacheService.#fromOpts(options);
        if (!g) {
            return null;
        }
        const verifPID = await g.getPID();
        if (verifPID === pid) {
            return g;
        }
        return null;
    }

    /**
     * @param {string} args 
     */
    static #parseArgs(args) {
        const indexNode = args.indexOf('node');
        const indexGanache = args.indexOf('ganache');
        const indexFirstArg = args.indexOf(' --');
        if (indexNode < 0 || indexGanache < 0 || indexFirstArg < 0) {
            return null;
        }
        if (indexNode >= indexGanache || indexGanache >= indexFirstArg) {
            return null;
        }

        // Unsupported situations
        if (args.indexOf('"') >= 0 ||
            args.indexOf("'") >= 0 ||
            args.indexOf(" - ") >= 0) {
            return null;
        }

        /** @type {Object.<string, (string | number | null)>} */
        const opts = {
            '--miner.callGasLimit': null,
            '--miner.defaultTransactionGasLimit': null,
            '--chain.asyncRequestProcessing': null,
            '--wallet.totalAccounts': null,
            '-m': null,
            '--chain.chainId': null,
            '--chain.networkId': null,
            '--server.host': null,
            '--server.port': null,
            '--database.dbPath': null
        };

        const keys = Object.keys(opts);
        for (let i = 0; i < keys.length; ++i) {
            const dashOpt = keys[i];
            // ex: ' --server.port '
            const j = args.indexOf(" " + dashOpt + " ");
            if (j < 0) {
                continue;
            }
            // ex: ' --server.port [... find here ...] -XXXX'
            const k = args.indexOf(' -', j + dashOpt.length);
            const s = (k < 0) ?
                args.substring(j + dashOpt.length + 2) :
                args.substring(j + dashOpt.length + 2, k);
            //console.log(dashOpt + '=' + s);
            opts[dashOpt] = s;
        }

        if (isNullishOrEmptyString(opts['--server.host'])) { return null; }
        if (isNullishOrEmptyString(opts['-m'])) { return null; }
        if (isNullishOrEmptyString(opts['--database.dbPath'])) { return null; }

        const chainidStr = opts['--chain.chainId'];
        if (isNullishOrEmptyString(chainidStr)) { return null; }
        assert(typeof chainidStr === 'string');

        const networkidStr = opts['--chain.networkId'];
        if (isNullishOrEmptyString(networkidStr)) { return null; }
        assert(typeof networkidStr === 'string');

        const totalAccountsStr = opts['--wallet.totalAccounts'];
        if (isNullishOrEmptyString(totalAccountsStr)) { return null; }
        assert(typeof totalAccountsStr === 'string');

        const portStr = opts['--server.port'];
        if (isNullishOrEmptyString(portStr)) { return null; }
        assert(typeof portStr === 'string');

        const chainid = stringToPositiveInteger(chainidStr, { strict: false });
        if (chainid === null || chainid === undefined) {
            return null;
        }
        opts['--chain.chainId'] = chainid;

        const networkid = stringToPositiveInteger(networkidStr, { strict: false });
        if (networkid === null || networkid === undefined) {
            return null;
        }
        opts['--chain.networkId'] = networkid;

        const totalAccounts = stringToPositiveInteger(totalAccountsStr, { strict: false });
        if (totalAccounts === null || totalAccounts === undefined) {
            return null;
        }
        opts['--wallet.totalAccounts'] = totalAccounts;

        const port = stringToPositiveInteger(portStr, { strict: false });
        if (port === null || port === undefined) {
            return null;
        }
        opts['--server.port'] = port;
        return opts;
    }

    /**
     * @param {Object.<string, (string | number | null)>} opts 
     */
    static #fromOpts(opts) {
        assert(typeof opts['--server.port'] === 'number');
        assert(typeof opts['--server.host'] === 'string');
        assert(typeof opts['--chain.chainId'] === 'number');
        assert(typeof opts['-m'] === 'string');
        assert(typeof opts['--database.dbPath'] === 'string');
        const g = new GanacheService({
            port: opts['--server.port'],
            hostname: opts['--server.host'],
            chainid: opts['--chain.chainId'],
            mnemonic: opts['-m'],
            dbPath: opts['--database.dbPath']
        });

        if (opts['--miner.callGasLimit']) {
            assert(typeof opts['--miner.callGasLimit'] === 'string');
            g.#minerCallGasLimit = opts['--miner.callGasLimit'];
        }
        if (opts['--miner.defaultTransactionGasLimit']) {
            assert(typeof opts['--miner.defaultTransactionGasLimit'] === 'string');
            g.#minerDefaultTransactionGasLimit = opts['--miner.defaultTransactionGasLimit'];
        }
        if (opts['--chain.asyncRequestProcessing']) {
            assert(typeof opts['--chain.asyncRequestProcessing'] === 'string');
            g.#chainAsyncRequestProcessing = opts['--chain.asyncRequestProcessing'];
        }
        if (opts['--wallet.totalAccounts']) {
            assert(typeof opts['--wallet.totalAccounts'] === 'number');
            g.#totalAccounts = opts['--wallet.totalAccounts'];
        }

        return g;
    }

    /** @returns {Promise<number | undefined>} */
    async getPID() {
        const grepPattern = "node.*ganache.*" + this.#getGanacheCliArgs().join(' ');
        // call `ps -ef | grep ...`
        return this.getPIDUsingPsefPipeGrep(grepPattern);
    }

    /* ----------------------------- Ready ------------------------------- */

    async isReady() {
        try {
            const ethChainId = await this.getEthChainId();
            return (ethChainId === this.#chainid);
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
        await this.#waitUntilGetEthChainidSucceeded(pid, options);
    }

    /**
     * @param {number} pid 
     * @param {{
     *      abortSignal?: AbortSignal
     *      progressCb?: types.progressCallback
     * }=} options
     */
    async #waitUntilGetEthChainidSucceeded(
        pid,
        options
    ) {
        const repeat = await repeatCallUntil(
            this.getEthChainId.bind(this),
            null,
            {
                waitBeforeFirstCall: 200,
                waitBetweenCallsMS: 400,
                maxCalls: 200,
                progressMessage: this._msgFmt("waiting for ganache to be ready ...", pid),
                ... (options?.abortSignal && { abortSignal: options?.abortSignal }),
                ... (options?.progressCb && { progressCb: options?.progressCb }),
            });

        if (!repeat.ok) {
            assert(repeat.error);
            throw repeat.error;
        }
    }

    /* --------------------------- Bash script --------------------------- */

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
            throw new CodeError(`Cannot start ganache service.`);
        }

        // Must be checked here, since we are going to run ganache
        const dbPath = this.dbPath;
        throwIfDirDoesNotExist(dbPath);

        if (options?.logFile) {
            throwIfParentDirDoesNotExist(options?.logFile);
        }
        if (options?.pidFile) {
            throwIfParentDirDoesNotExist(options?.pidFile);
        }

        /** @type {any} */
        const o = {
            args: this.#getGanacheCliArgs(),
            logFile: options?.logFile,
            pidFile: options?.pidFile,
            version: 1,
            env: {}
        }

        if (options?.env) {
            const xnames = Object.keys(options.env);
            for (let i = 0; i < xnames.length; ++i) {
                o.env[envVarName(xnames[i])] = options.env[xnames[i]];
            }
        }

        return genSetMBashScript('ganache', o);
    }

    /* ------------------------------ Some RPC methods ------------------------------ */

    /* https://github.com/trufflesuite/ganache/blob/develop/src/chains/ethereum/ethereum/RPC-METHODS.md */

    /** @returns {Promise<types.checksumaddress[]>} */
    async getEthAccounts() {
        try {
            const queryObj = {
                jsonrpc: "2.0",
                method: "eth_accounts",
                id: this.#chainid
            };
            const response = await httpPOST(this.urlString, null, null, queryObj);
            if (response &&
                typeof response === 'object' &&
                response.id === this.#chainid) {
                return response.result;
            }
        } catch (err) { }
        throw new CodeError('ganache query failed');
    }

    /** 
     * - Returns filter ID in Hex format
     * @param {any} filter
     * @returns {Promise<string>}
     */
    async newEthFilter(filter) {
        try {
            const queryObj = {
                jsonrpc: "2.0",
                method: "eth_newFilter",
                id: this.#chainid,
                params: [filter]
            };
            const response = await httpPOST(this.urlString, null, null, queryObj);
            if (response &&
                typeof response === 'object' &&
                response.id === this.#chainid) {
                return response.result;
            }
        } catch (err) { }
        throw new CodeError('ganache query failed');
    }

    /** 
     * - Returns filter ID in Hex format
     * @param {string} filterID
     * @returns {Promise<boolean>}
     */
    async uninstallEthFilter(filterID) {
        try {
            const queryObj = {
                jsonrpc: "2.0",
                method: "eth_uninstallFilter",
                id: this.#chainid,
                params: [filterID]
            };
            const response = await httpPOST(this.urlString, null, null, queryObj);
            if (response &&
                typeof response === 'object' &&
                response.id === this.#chainid) {
                return response.result;
            }
        } catch (err) { }
        throw new CodeError('ganache query failed');
    }

    /** 
     * @param {any} filter
     */
    async fixFilterIDBug(filter) {
        let i = 0;
        while (i <= 16) {
            // FilterID must be > 0xf, 2 digits is Hex  (otherwise bug in java, js etc.!)
            const filterID = await this.newEthFilter(filter);
            const filterIDNum = parseInt(filterID, 16);
            await this.uninstallEthFilter(filterID);
            if (filterIDNum >= 16) {
                return;
            }
            i++;
        }
        throw new CodeError('Unable to Fix Ganache FilterID bug');
    }

    /** @returns {Promise<number>} */
    async getEthChainId() {
        try {
            const queryObj = {
                jsonrpc: "2.0",
                method: "eth_chainId",
                id: this.#chainid
            };
            // When connection is lost, :1 is broken
            const url = this.urlString;
            //const url = this.urlv4String;
            const response = await httpPOST(url, null, null, queryObj);
            if (response &&
                typeof response === 'object' &&
                response.id === this.#chainid) {
                return BigNumber.from(response.result).toNumber();
            }
        } catch (err) { }
        throw new CodeError('ganache query failed');
    }
}
