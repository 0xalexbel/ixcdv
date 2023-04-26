import * as ERROR_CODES from "../common/error-codes.js";
import * as types from '../common/common-types.js';
import * as pathlib from 'path';
import assert from 'assert';
import { Multiaddr } from 'multiaddr';
import { ipfsInit, isValidIpfsDir, IPFS_LOCALHOST_IPV4, ipfsTestPublish, ipfsAddQ } from './ipfs-api.js';
import { ServerService } from "../common/service.js";
import { dirExists, readObjectFromJSONFile, resolveAbsolutePath, rmrfDir, throwIfDirDoesNotExist, throwIfFileDoesNotExist, throwIfNotAbsolutePath, throwIfParentDirDoesNotExist, toRelativePath } from "../common/fs.js";
import { psGetEnv, psGrepPID, psGrepPIDAndEnv } from "../common/ps.js";
import { CodeError } from "../common/error.js";
import { genSetMBashScript } from "../common/bash.js";
import { parseSingleEnvVar } from "../common/utils.js";
import { isNullishOrEmptyString, throwIfNullishOrEmptyString } from "../common/string.js";
import { isStrictlyPositiveInteger, throwIfNotStrictlyPositiveInteger } from "../common/number.js";

/**
 * @typedef {types.ServerServiceArgs & 
 * {
 *      gatewayPort?: number,
 *      apiPort?: number,
 * }} IpfsServiceConstructorArgs
 */

/* -------------------- IpfsService Class ----------------------- */

export class IpfsService extends ServerService {

    /** 
     * @override
     * @returns {typeof IpfsService} 
     */
    theClass() { return IpfsService; }

    /** @type {boolean} */
    static #guardConstructing = false;

    static typename() { return 'ipfs'; }

    /** @type {string=} */
    #ipfsDir;

    /** @type {number=} */
    #gatewayPort;
    /** @type {number=} */
    #apiPort;

    /**
     * @param {IpfsServiceConstructorArgs} args
     */
    constructor(args) {
        if (!IpfsService.#guardConstructing) {
            throw new TypeError('class constructor is not accessible');
        }

        super(args);
        this.#apiPort = args.apiPort;
        this.#gatewayPort = args.gatewayPort;
    }

    get ipfsDir() { return this.#ipfsDir; }
    get gatewayPort() { return this.#gatewayPort; }
    get apiPort() { return this.#apiPort; }
    get gatewayUrl() {
        if (this.#gatewayPort === undefined) {
            return "http://" + this.hostname;
        }
        return "http://" + this.hostname + ':' + this.#gatewayPort.toString();
    }

    /** 
     * @param {types.IpfsConfig} config 
     * @param {boolean} resolvePlaceholders
     * @param {string=} relativeToDirectory
     */
    static async deepCopyConfig(config, resolvePlaceholders, relativeToDirectory) {
        const configCopy = { ...config };
        assert(configCopy.type === 'ipfs');
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

    toJSON() {
        return {
            type: IpfsService.typename(),
            directory: this.#ipfsDir,
            gatewayPort: this.#gatewayPort,
            apiPort: this.#apiPort,
            logFile: this.logFile
        };
    }

    /** @override */
    get canStart() {
        // Must not call super, since test is made against pid file.
        if (!this.isLocal()) {
            return false;
        }
        return isValidIpfsDir(this.#ipfsDir);
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
     * @param {string} dir 
     */
    static async #getPIDAndEnv(dir) {
        assert(dir);
        assert(pathlib.isAbsolute(dir));

        const grepPattern = `ipfs daemon.* IPFS_PATH=${dir} `;
        const pids = await psGrepPIDAndEnv(grepPattern);
        if (!pids || pids.length === 0) {
            return; /* undefined */
        }
        assert(pids.length === 1);
        return pids[0];
    }

    /** @override */
    async getPID() {
        try {
            if (!this.canStart) {
                return; /* undefined */
            }
            // see 'canStart'
            assert(this.#ipfsDir);
            const p = await IpfsService.#getPIDAndEnv(this.#ipfsDir);
            return p?.pid;
        } catch { }
        return; /* undefined */
    }

    /** @override */
    async getStartBashScript() {
        if (!this.canStart) {
            throw new CodeError(`Cannot start ipfs service.`);
        }
        // Must be checked here, since we are going to run ganache
        throwIfDirDoesNotExist(this.#ipfsDir);

        const logFilePath = this.logFile;
        if (logFilePath) {
            throwIfParentDirDoesNotExist(logFilePath);
        }

        assert(this.#ipfsDir);
        assert(pathlib.isAbsolute(this.#ipfsDir));

        return genSetMBashScript('ipfs', {
            args: ['daemon'],
            env: {
                "LIBP2P_FORCE_PNET": "1",
                "IPFS_PATH": "'" + this.#ipfsDir + "'"
            },
            logFile: logFilePath,
            version: 1
        });
    }

    /**
     * @param {string} dir 
     */
    static async fromDirectory(dir) {
        assert(dir);
        dir = resolveAbsolutePath(dir);

        const p = await IpfsService.#getPIDAndEnv(dir);
        if (!p) {
            return null;
        }

        try {
            const directory = parseSingleEnvVar('IPFS_PATH', p.command);
            if (isNullishOrEmptyString(directory)) {
                return null;
            }
            if (directory !== dir) {
                return null;
            }
            return IpfsService.#newInstance({ directory });
        } catch { }

        return null;
    }

    static async running() {
        const grepPattern = "ipfs daemon";
        const pids = await psGrepPID(grepPattern);
        if (!pids) {
            return null;
        }

        /** @param {number} pid */
        async function __fromPID(pid) {
            try {
                const s = await IpfsService.fromPID(pid);
                return { pid, service: s }
            } catch {
                return { pid, service: null }
            }
        }
        return Promise.all(pids.map(pid => __fromPID(pid)));
    }

    /**
     * @param {number} pid 
     */
    static async fromPID(pid) {
        if (!isStrictlyPositiveInteger(pid)) {
            return null;
        }
        assert(pid);
        const directory = await psGetEnv(pid, 'IPFS_PATH');
        if (!directory) {
            return null;
        }
        try {
            const o = await IpfsService.#newInstance({ directory });
            return o;
        } catch { }
        return null;
    }

    /**
     * Throws an exception if failed.
     * @param {{
     *     directory:string
     *     gatewayPort: number
     *     apiPort: number,
     * }} params
     */
    static async reinstall({ directory, gatewayPort, apiPort }) {
        throwIfNullishOrEmptyString(directory);
        throwIfNotStrictlyPositiveInteger(gatewayPort);
        throwIfNotStrictlyPositiveInteger(apiPort);

        directory = resolveAbsolutePath(directory);

        await rmrfDir(directory, { strict: true });
        await IpfsService.install({ directory, gatewayPort, apiPort });
    }

    /**
     * Throws an exception if failed.
     * @param {{
     *     directory:string
     *     gatewayPort: number
     *     apiPort: number,
     * }} params
     */
    static async install({ directory, gatewayPort, apiPort }) {
        throwIfNullishOrEmptyString(directory);
        throwIfNotStrictlyPositiveInteger(gatewayPort);
        throwIfNotStrictlyPositiveInteger(apiPort);

        directory = resolveAbsolutePath(directory);

        const exists = dirExists(directory);
        if (!exists) {
            // will create directory
            // throws an exception if failed (directory is auto-deleted)
            await ipfsInit(directory, gatewayPort, apiPort);
        }

        if (!isValidIpfsDir(directory)) {
            throw new CodeError(
                `Invalid ipfs directory (dir='${directory}')`,
                ERROR_CODES.IPFS_ERROR);
        }

        const gatwayPortMultiAddrStr = `/ip4/${IPFS_LOCALHOST_IPV4}/tcp/${gatewayPort.toString()}`;
        const apiMultiAddrStr = `/ip4/${IPFS_LOCALHOST_IPV4}/tcp/${apiPort.toString()}`;

        const configFile = pathlib.join(directory, 'config');
        let config = await readObjectFromJSONFile(configFile);
        assert(config);
        assert(typeof config === 'object');

        if (!config.Addresses || typeof config.Addresses !== 'object') {
            throw new CodeError(
                'Invalid ipfs config file',
                ERROR_CODES.IPFS_ERROR);
        }

        if (gatwayPortMultiAddrStr !== config.Addresses['Gateway']) {
            throw new CodeError(
                'Another instance of ipfs is already installed',
                ERROR_CODES.IPFS_ERROR);
        }
        if (apiMultiAddrStr !== config.Addresses['API']) {
            throw new CodeError(
                'Another instance of ipfs is already installed',
                ERROR_CODES.IPFS_ERROR);
        }
    }

    /**
     * Throws an exception if failed
     * @param {{
     *      directory?: string
     *      logFile?: string
     * }} params
     */
    static async newInstance({ directory, ...options }) {
        return IpfsService.#newInstance({ directory, ...options });
    }

    /**
     * Throws an exception if failed
     * @param {{
     *      directory?:string
     *      logFile?: string
     * }} params
     */
    static async #newInstance({ directory, ...options }) {
        throwIfNullishOrEmptyString(directory);
        throwIfNotAbsolutePath(directory);
        assert(directory);

        directory = resolveAbsolutePath(directory);

        throwIfDirDoesNotExist(directory);
        if (!isValidIpfsDir(directory)) {
            throw new CodeError(
                `Invalid ipfs directory (dir='${directory}')`,
                ERROR_CODES.IPFS_ERROR);
        }

        const configFile = pathlib.join(directory, 'config');
        const config = await readObjectFromJSONFile(configFile);
        assert(config);
        assert(typeof config === 'object');

        const gatewayPortMultiAddr = new Multiaddr(config.Addresses['Gateway']);
        const APIMultiAddr = new Multiaddr(config.Addresses['API']);

        const gatewayPortOpts = gatewayPortMultiAddr.toOptions();
        const APIOpts = APIMultiAddr.toOptions();

        try {
            IpfsService.#guardConstructing = true;
            const o = new IpfsService({
                ...options,
                hostname: gatewayPortOpts.host,
                port: gatewayPortOpts.port,
                gatewayPort: gatewayPortOpts.port,
                apiPort: APIOpts.port
            });
            o.#ipfsDir = directory;
            IpfsService.#guardConstructing = false;
            return o;
        } catch (err) {
            IpfsService.#guardConstructing = false;
            throw err;
        }
    }

    async testPublish() {
        if (!this.#ipfsDir) {
            throw new CodeError('Missing ipfs directory');
        }
        const ok = await ipfsTestPublish(this.#ipfsDir, this.gatewayUrl);
        return ok;
    }

    /**
     * - Returns ipfs hash
     * @param {string} file 
     */
    async addFile(file) {
        if (!this.#ipfsDir) {
            throw new CodeError('Missing ipfs directory');
        }

        throwIfNotAbsolutePath(file);
        throwIfFileDoesNotExist(file);

        const out = await ipfsAddQ(
            this.#ipfsDir, file,
            { strict: true });

        assert(out.ok);
        const hash = out.result;

        // URL must contain '/ipfs/' instead of '/p2p/'
        return {
            hash,
            url: new URL('ipfs/' + hash, this.gatewayUrl)
        };
    }
}