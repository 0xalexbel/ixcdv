import * as types from '../common/common-types.js';
import * as srvTypes from './services-types-internal.js';
import path from 'path';
import assert from 'assert';
import { parseEnvVars as utilsParseEnvVars } from '../common/utils.js';
import { MongoService } from './MongoService.js';
import { GanachePoCoService } from '../poco/GanachePoCoService.js';
import { computeApplicationYmlHash, parseApplicationYmlFile, saveApplicationYml } from './application-dot-yml.js';
import { ENV_FILE_BASENAME } from './base-internal.js';
import { AbstractService, ServerService } from '../common/service.js';
import { CodeError, throwPureVirtual } from '../common/error.js';
import { isNullishOrEmptyString, placeholdersPropertyReplace, stringToHostnamePort } from '../common/string.js';
import { mkDir, saveToFile, throwIfDirDoesNotExist, throwIfParentDirDoesNotExist, toRelativePath } from '../common/fs.js';
import { deepCopyPackage } from '../pkgmgr/pkgmgr-deepcopy.js';
import { psGetEnv, psGrepPIDAndEnv, pspWithArgsAndEnv } from '../common/ps.js';
import { genNohupBashScript } from '../common/bash.js';
import { PoCoHubRef } from '../common/contractref.js';
import { springArgsParseSpringConfigLocation, springClassPathParseRepoDir } from '../common/spring.js';
import { installPackage, toPackage } from '../pkgmgr/pkg.js';
import { envVarName } from '../common/consts.js';

/* -------------------------- SpringServerService Class ------------------------------ */

export class SpringServerService extends ServerService {

    /** @type {string=} */
    #applicationYmlHash;

    /** @type {string=} */
    #repoDir;

    /** @type {string=} */
    #springConfigLocation;

    /** @type {any=} */
    #ymlConfig;

    /** 
     * @override
     * @returns {typeof SpringServerService} 
     */
    theClass() { return SpringServerService; }

    /** @returns {string} */
    static CLASSNAME() {
        throwPureVirtual('SpringServerService.CLASSNAME()');
        return '';
    }
    /** @returns {string} */
    static ENTRY() {
        throwPureVirtual('SpringServerService.ENTRY()');
        return '';
    }
    /** @returns {string} */
    CLASSNAME() {
        throwPureVirtual('CLASSNAME()');
        return '';
    }
    /** @returns {string} */
    ENTRY() {
        throwPureVirtual('ENTRY()');
        return '';
    }

    /**
     * @param {srvTypes.SpringServerServiceConstructorArgs} args 
     */
    constructor(args) {
        super(args);

        this.#repoDir = args.repoDir;
        this.#springConfigLocation = args.springConfigLocation;
        this.#applicationYmlHash = args.applicationYmlHash;
        this.#ymlConfig = args.ymlConfig;
    }

    /** @returns {string=} */
    get springConfigLocation() {
        return this.#springConfigLocation;
    }

    /** @returns {string=} */
    get repoDir() {
        return this.#repoDir;
    }

    /** @returns {any=} */
    get ymlConfig() {
        return this.#ymlConfig;
    }

    /** 
     * @param {srvTypes.SpringServiceConfig} config 
     * @param {boolean} resolvePlaceholders
     * @param {string=} relativeToDirectory
     */
    static async deepCopyConfig(config, resolvePlaceholders, relativeToDirectory) {
        const configCopy = { ...config };
        if (config.ymlConfig) {
            configCopy.ymlConfig = { ...config.ymlConfig };
        }
        configCopy.repository = deepCopyPackage(config.repository, relativeToDirectory);
        if (relativeToDirectory) {
            configCopy.springConfigLocation = toRelativePath(relativeToDirectory, configCopy.springConfigLocation);
            if (configCopy.logFile) {
                configCopy.logFile = toRelativePath(relativeToDirectory, configCopy.logFile);
            }
            if (configCopy.pidFile) {
                configCopy.pidFile = toRelativePath(relativeToDirectory, configCopy.pidFile);
            }
        }

        return configCopy;
    }

    /** @override */
    get canStart() {
        if (!this.isLocal()) {
            return false;
        }
        if (isNullishOrEmptyString(this.#repoDir)) {
            return false;
        }
        if (!this.ymlConfig) {
            return false;
        }
        if (isNullishOrEmptyString(this.#springConfigLocation)) {
            return false;
        }
        return true;
    }

    /** @virtual */
    get canStop() {
        if (!this.isLocal()) {
            return false;
        }
        if (isNullishOrEmptyString(this.#springConfigLocation)) {
            return false;
        }
        return true;
    }

    async getApplicationYmlHash() {
        if (this.#applicationYmlHash === undefined) {
            this.#applicationYmlHash =
                await computeApplicationYmlHash(this.springConfigLocation);
        }
        return this.#applicationYmlHash;
    }

    /**
     * @virtual
     * @param {{[envName:string] : string}} extras
     * @returns {Promise<{[envName:string] : string}>}
     */
    async getEnvVars(extras) {
        const appYmlHash = await this.getApplicationYmlHash();

        assert(!isNullishOrEmptyString(appYmlHash));
        assert(!isNullishOrEmptyString(this.#repoDir));
        assert(!isNullishOrEmptyString(this.#springConfigLocation));
        assert(this.#springConfigLocation);
        assert(this.#repoDir);

        /** @type {{[envName:string] : string}} */
        let env = {};

        const xnames = Object.keys(extras);
        for (let i= 0 ; i < xnames.length; ++i) {
            env[envVarName(xnames[i])] = extras[xnames[i]];
        }
        env[envVarName('HOST')] = this.hostname + ":" + this.port.toString();
        env[envVarName('APPLICATION_YML')] = appYmlHash;
        env[envVarName('SPRING_CONFIG_LOC')] = this.#springConfigLocation;
        env[envVarName('REPODIR')] = this.#repoDir;

        return env;
    }

    /**
     * @virtual
     * @param {string} str 
     */
    parseEnvVars(str) {
        return SpringServerService.parseEnvVars(str);
    }

    /**
     * @virtual
     * @param {string} str 
     * @returns {srvTypes.SpringServerServiceConstructorArgs}
     */
    static parseEnvVars(str) {
        const varNames = [
            envVarName('HOST'),
            envVarName('APPLICATION_YML'),
            envVarName('SPRING_CONFIG_LOC'),
            envVarName('REPODIR'),
            envVarName('MARKER'),
        ];
        const o = utilsParseEnvVars(varNames, str);
        const { hostname, port } = stringToHostnamePort(o[envVarName('HOST')]);
        assert(port);

        return {
            hostname,
            port,
            applicationYmlHash: o[envVarName('APPLICATION_YML')],
            springConfigLocation: o[envVarName('SPRING_CONFIG_LOC')],
            repoDir: o[envVarName('REPODIR')],
            marker: o[envVarName('MARKER')]
        }
    }

    /**
     * @override
     */
    async getPID() {
        if (!this.isLocal) {
            return; /* undefined */
        }

        const springConfigLocation = this.springConfigLocation;
        assert(springConfigLocation != null);

        const pids = await this.theClass().runningPIDs({ springConfigLocation });
        if (!pids) {
            return; /* undefined */
        }
        const ymlHash = await this.getApplicationYmlHash();
        for (let i = 0; i < pids.length; ++i) {
            const envs = this.parseEnvVars(pids[i].command);
            if (envs.applicationYmlHash !== ymlHash) {
                return; /* undefined */
            }
        }
        assert(pids.length === 1);
        return pids[0].pid;
    }

    /**
     * @override
     * @protected
     * @param {number} pid 
     */
    getSuccessORANDPatterns(pid) {
        return [[`Started ${this.ENTRY()} in`, this.CLASSNAME()]];
    }

    /**
     * @override
     * @protected
     * @param {number} pid 
     */
    getFailureORANDPatterns(pid) {
        return [['Task :bootRun FAILED'], [`ERROR ${pid.toString()}`]];
    }

    /**
     * @override
     * @param {any=} filters 
     * @returns {Promise<{pid: number, configFile: string, service:(SpringServerService | null)}[] | null>} 
     */
    static async running(filters) {
        const pidsAndCmds = await this.runningPIDs(filters);
        if (!pidsAndCmds) {
            return null;
        }

        /** 
         * @param {typeof SpringServerService} theClass 
         * @param {number} pid 
         * @returns {Promise<{pid:number, configFile: string, service:SpringServerService | null}>}
         */
        async function __fromPID(theClass, pid) {
            const configFile = (await psGetEnv(pid, envVarName('MARKER'))) ?? '';
            try {
                const s = await theClass.fromPID(pid);
                assert(s instanceof SpringServerService);
                assert(s instanceof theClass);
                return { pid, configFile, service: s }
            } catch {
                return { pid, configFile, service: null }
            }
        }
        return Promise.all(pidsAndCmds.map(pc => __fromPID(this, pc.pid)));
    }

    /**
     * @param {object} args 
     * @param {string=} args.hostname 
     * @param {number=} args.port 
     * @param {string=} args.springConfigLocation 
     */
    static async runningPIDs({ hostname, port, springConfigLocation } = {}) {
        // let grepPattern;
        // if (!isNullishOrEmptyString(springConfigLocation)) {
        //     assert(springConfigLocation);
        //     springConfigLocation = ensureSuffix('/', springConfigLocation);
        //     grepPattern = `${this.CLASSNAME()}.* --spring.config.location=${springConfigLocation}`;
        // } else {
        //     grepPattern = `${this.CLASSNAME()}.* --spring.config.location=`;
        // }
        const grepPattern = `java .* ${this.CLASSNAME()} `;

        const pids = await psGrepPIDAndEnv(grepPattern);
        if (!pids || pids.length === 0) {
            return null;
        }

        // Apply filters
        /** @type {{ pid: number, command: string, envs:any }[]} */
        const filteredPids = [];
        pids.forEach(pidAndCmd => {
            // ignore processes we have not launched
            if (pidAndCmd.command.indexOf(envVarName('SPRING_CONFIG_LOC')) < 0) {
                return;
            }

            const envs = this.parseEnvVars(pidAndCmd.command);

            if (springConfigLocation) {
                if (springConfigLocation !== envs.springConfigLocation) {
                    return;
                }
            }

            if (hostname) {
                if (hostname !== envs.hostname) {
                    return;
                }
            }

            if (port !== null && port !== undefined) {
                if (port !== envs.port) {
                    return;
                }
            }

            filteredPids.push({ ...pidAndCmd, envs });
        });

        return (filteredPids.length === 0) ? null : filteredPids;
    }

    /**
     * @param {object} args 
     * @param {string=} args.springConfigLocation 
     */
    static async runningUrls({ springConfigLocation } = {}) {
        const pids = await this.runningPIDs({ springConfigLocation });
        if (!pids) {
            return null;
        }

        const urls = [];
        for (let i = 0; i < pids.length; ++i) {
            const envs = this.parseEnvVars(pids[i].command);
            const url = "http://" + ((envs.hostname) ?? 'localhost') + ':' + envs.port;
            urls.push(url);
        }
        return (urls.length === 0) ? null : urls;
    }

    /**
     * @param {string=} destDir 
     */
    async saveApplicationYml(destDir) {
        if (isNullishOrEmptyString(destDir)) {
            destDir = this.springConfigLocation;
        }
        throwIfDirDoesNotExist(destDir);
        assert(destDir);

        const conf = this.ymlConfig;
        assert(conf);

        const savedAppYmlHash = await saveApplicationYml(destDir, conf);
        assert(!isNullishOrEmptyString(savedAppYmlHash));
    }

    /**
     * @param {{
     *      filename?: string
     *      env: {[envName:string] : string}
     * }} options
     */
    async saveEnvFile({ filename, env }) {
        let destFilename = filename;
        if (isNullishOrEmptyString(destFilename)) {
            if (!this.springConfigLocation) {
                throw new CodeError('Missing destination filename');
            }
            destFilename = path.join(this.springConfigLocation, ENV_FILE_BASENAME);
        }
        assert(destFilename);
        const destDir = path.dirname(destFilename);
        throwIfDirDoesNotExist(destDir);

        const envs = await this.getEnvVars(env);
        assert(envs);

        let str = '';
        Object.entries(envs).forEach(([key, value]) => {
            str += key + '=' + value + '\n';
        });

        await saveToFile(str, destDir, path.basename(destFilename), { strict: true });
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
            throw new CodeError(`Cannot start ${this.typename()} service.`);
        }

        if (options?.logFile) {
            assert(path.isAbsolute(options?.logFile));
            throwIfParentDirDoesNotExist(options?.logFile);
        }

        /* ----------------- Save application.yml --------------------------- */

        const springConfigLocation = this.springConfigLocation;
        assert(springConfigLocation);
        assert(!springConfigLocation.endsWith('/'));

        const conf = this.ymlConfig;
        assert(conf);

        // not mkdir -p!
        mkDir(springConfigLocation);

        const savedAppYmlHash = await saveApplicationYml(springConfigLocation, conf);
        if (this.#applicationYmlHash === undefined) {
            this.#applicationYmlHash = savedAppYmlHash;
        }

        /* ----------------- Compute application.yml hash ------------------- */

        const envs = await this.getEnvVars(options?.env ?? {});

        assert(envs[envVarName('APPLICATION_YML')] === savedAppYmlHash);
        assert(envs[envVarName('SPRING_CONFIG_LOC')] === springConfigLocation);

        const jdk = '/Library/Java/JavaVirtualMachines/temurin-11.jdk/Contents/Home';
        if (jdk) {
            envs['JAVA_HOME'] = jdk;
        }

        //const sep = "\\\'";
        const sep = "";
        const args = ["bootRun"];
        args.push("--args=\\\'--spring.config.location=" + sep + springConfigLocation + '/' + sep + "\\\'");
        if (jdk) {
            args.push('-Dorg.gradle.java.home=' + jdk);
        }

        return genNohupBashScript('./gradlew', {
            dir: this.#repoDir,
            env: envs,
            args: args,
            logFile: options?.logFile,
        });
    }

    /**
     * @param {number} pid 
     * @returns {Promise<SpringServerService | null>}
     */
    static async fromPID(pid) {
        throwPureVirtual('SpringServerService.fromPID(pid)');
        return null;
    }

    toJSON() {
        const json = {
            ... super.toJSON(),
            repository: this.#repoDir,
            springConfigLocation: this.#springConfigLocation,
            ymlConfig: this.#ymlConfig
        };
        return json;
    }
}

export class SpringHubServerService extends SpringServerService {

    /** @type {string=} */
    #DBUUID;

    /** @type {PoCoHubRef=} */
    #hub;

    /** 
     * @override
     * @returns {typeof SpringHubServerService} 
     */
    theClass() { return SpringHubServerService; }

    /**
     * @param {srvTypes.SpringHubServerServiceConstructorArgs} args 
     */
    constructor(args) {
        super(args);

        this.#DBUUID = args.DBUUID;
        this.#hub = args.hub;
    }

    /** @returns {string=} */
    get DBUUID() {
        return this.#DBUUID;
    }

    /** @returns {PoCoHubRef=} */
    get hub() {
        return this.#hub;
    }

    /** @override */
    static runDependencies() {
        const s = super.runDependencies();
        s.add(GanachePoCoService.typename());
        return s;
    }

    /** @override */
    get canStart() {
        if (!super.canStart) {
            return false;
        }
        if (isNullishOrEmptyString(this.DBUUID)) {
            return false;
        }
        return true;
    }

    /**
     * @override
     * @param {{[envName:string] : string}} extras
     * @returns {Promise<{[envName:string] : string}>}
     */
    async getEnvVars(extras) {
        const env = await super.getEnvVars(extras);

        const hubKey = this.hub?.key;

        assert(hubKey);
        assert(!isNullishOrEmptyString(hubKey));
        assert(this.DBUUID);

        env[envVarName('HUBKEY')] = hubKey;
        env[envVarName('DBUUID')] = this.DBUUID;

        return env;
    }

    /**
     * @virtual
     * @param {string} str 
     */
    parseEnvVars(str) {
        return SpringHubServerService.parseEnvVars(str);
    }

    /**
     * @virtual
     * @param {string} str 
     * @returns {srvTypes.SpringHubServerServiceConstructorArgs}
     */
    static parseEnvVars(str) {
        const env = super.parseEnvVars(str);
        const varNames = [
            envVarName('HUBKEY'),
            envVarName('DBUUID'),
        ];
        const o = utilsParseEnvVars(varNames, str);
        const ref = (o[envVarName('HUBKEY')]) ?
            PoCoHubRef.fromKey(o[envVarName('HUBKEY')]) :
            undefined;

        assert(ref);

        return {
            ...env,
            DBUUID: o[envVarName('DBUUID')],
            hub: ref
        }
    }

    /**
     * @override
     */
    async getPID() {
        if (!this.isLocal) {
            return; /* undefined */
        }

        const springConfigLocation = this.springConfigLocation;
        assert(springConfigLocation != null);

        const pids = await this.theClass().runningPIDs({ springConfigLocation });
        if (!pids) {
            return; /* undefined */
        }
        const ymlHash = await this.getApplicationYmlHash();
        for (let i = 0; i < pids.length; ++i) {
            const envs = this.parseEnvVars(pids[i].command);
            if (envs.DBUUID !== this.DBUUID) {
                return; /* undefined */
            }
            if (envs.applicationYmlHash !== ymlHash) {
                return; /* undefined */
            }
        }
        assert(pids.length === 1, 'may be a pid has been found but it does not belong to us ??');
        return pids[0].pid;
    }

    /**
     * @param {object} args 
     * @param {string=} args.DBUUID 
     * @param {PoCoHubRef=} args.hubRef 
     * @param {string=} args.hostname 
     * @param {number=} args.port 
     * @param {string=} args.springConfigLocation 
     */
    static async runningPIDs({ DBUUID, hubRef, ...others } = {}) {
        const pids = await super.runningPIDs(others);
        if (!pids) {
            return null;
        }

        // Apply filters
        /** @type {{ pid: number, command: string, envs:any }[]} */
        const filteredPids = [];
        pids.forEach(pidStruct => {
            const envs = pidStruct.envs;

            if (DBUUID) {
                if (DBUUID !== envs.DBUUID) {
                    return;
                }
            }

            if (hubRef) {
                if (!hubRef.eq(envs.hub)) {
                    return;
                }
            }

            filteredPids.push(pidStruct);
        });

        return filteredPids;
    }

    /**
     * @param {object} args 
     * @param {string=} args.DBUUID 
     * @param {string=} args.springConfigLocation 
     * @param {PoCoHubRef=} args.hubRef 
     */
    static async runningUrls({ DBUUID, springConfigLocation, hubRef } = {}) {
        const pids = await this.runningPIDs({ DBUUID, springConfigLocation, hubRef });
        if (!pids || pids.length === 0) {
            return null;
        }

        const urls = [];
        for (let i = 0; i < pids.length; ++i) {
            const envs = pids[i].envs;
            const url = "http://" + ((envs.hostname) ?? 'localhost') + ':' + envs.port;
            urls.push(url);
        }
        return (urls.length === 0) ? null : urls;
    }

    toJSON() {
        const json = {
            ... super.toJSON(),
            hub: this.#hub,
        };
        return json;
    }
}

/**
 * @typedef {srvTypes.SpringHubServerServiceConstructorArgs & 
 * {
 *      mongo?:MongoService,
 *      mongoHost?:string,
 *      mongoDBName?:string,
 * }} SpringMongoServerServiceConstructorArgs
 */

export class SpringMongoServerService extends SpringHubServerService {

    /** @type {MongoService=} */
    #mongo;
    /** @type {string=} */
    #mongoHost;
    /** @type {string=} */
    #mongoDBName;

    /** 
     * @override
     * @returns {typeof SpringMongoServerService} 
     */
    theClass() { return SpringMongoServerService; }

    /**
     * @param {SpringMongoServerServiceConstructorArgs} args 
     */
    constructor(args) {
        super(args);

        this.#mongo = args.mongo;
        this.#mongoHost = args.mongoHost;
        this.#mongoDBName = args.mongoDBName;
    }

    get mongo() { return this.#mongo; }
    get mongoHost() { return this.#mongoHost; }
    get mongoDBName() { return this.#mongoDBName; }

    /** @override */
    static runDependencies() {
        const s = super.runDependencies();
        s.add(MongoService.typename());
        return s;
    }

    /**
     * @override
     * @param {{[envName:string] : string}} extras
     * @returns {Promise<{[envName:string] : string}>}
     */
    async getEnvVars(extras) {
        const env = await super.getEnvVars(extras);

        if (this.#mongoDBName) {
            env[envVarName('MONGODBNAME')] = this.#mongoDBName;
        }
        if (this.#mongoHost) {
            env[envVarName('MONGOHOST')] = this.#mongoHost;
        }

        return env;
    }

    /**
     * @override
     * @param {string} str 
     */
    parseEnvVars(str) {
        return SpringMongoServerService.parseEnvVars(str);
    }

    /**
     * @override
     * @param {string} str 
     * @returns {SpringMongoServerServiceConstructorArgs}
     */
    static parseEnvVars(str) {
        const env = super.parseEnvVars(str);
        const varNames = [
            envVarName('MONGOHOST'),
            envVarName('MONGODBNAME'),
        ];
        const o = utilsParseEnvVars(varNames, str);
        return {
            ...env,
            mongoDBName: o[envVarName('MONGODBNAME')],
            mongoHost: o[envVarName('MONGOHOST')],
        }
    }

    /**
     * @param {object} args 
     * @param {string=} args.DBUUID 
     * @param {PoCoHubRef=} args.hubRef 
     * @param {string=} args.hostname 
     * @param {number=} args.port 
     * @param {string=} args.springConfigLocation 
     * @param {string=} args.mongoHost 
     */
    static async runningPIDs({ mongoHost, ...others } = {}) {
        const pids = await super.runningPIDs(others);
        if (!pids) {
            return null;
        }

        // Apply filters
        /** @type {{ pid: number, command: string, envs:any }[]} */
        const filteredPids = [];
        pids.forEach(pidStruct => {
            const envs = pidStruct.envs;

            if (mongoHost) {
                if (mongoHost !== envs.mongoHost) {
                    return;
                }
            }

            filteredPids.push(pidStruct);
        });

        return filteredPids;
    }

    toJSON() {
        const json = {
            ... super.toJSON(),
            mongoHost: this.#mongoHost,
            mongoDBName: this.#mongoDBName,
        };
        return json;
    }
}

/**
 * @template T
 * @param {number} pid 
 * @param {(cmd:string) => (srvTypes.SpringServerServiceConstructorArgs & T) } parseEnvVarsFunc 
 * @returns {Promise<(srvTypes.SpringServerServiceConstructorArgs & T) | null>}
 */
export async function pidToSpringConstructorArgs(pid, parseEnvVarsFunc) {
    const cmd = await pspWithArgsAndEnv(pid);
    if (!cmd) {
        return null;
    }

    // Extract our private data from process env vars
    // set at launch time
    const envVars = parseEnvVarsFunc(cmd);
    if (!envVars) {
        // process is invalid
        return null;
    }

    assert(envVars.hostname);
    assert(envVars.port);

    const applicationYmlHash = envVars.applicationYmlHash;

    // Extract 'directory' dir from process arguments
    let springConfigLocation = springArgsParseSpringConfigLocation(cmd);
    if (isNullishOrEmptyString(springConfigLocation)) {
        springConfigLocation = envVars.springConfigLocation;
    } else {
        if (envVars.springConfigLocation) {
            assert(springConfigLocation === envVars.springConfigLocation);
        }
    }
    if (isNullishOrEmptyString(springConfigLocation)) {
        return null;
    }
    assert(springConfigLocation);

    // Extract 'repoDir' dir from process arguments
    let repoDir = springClassPathParseRepoDir(cmd);
    if (isNullishOrEmptyString(repoDir)) {
        repoDir = envVars.repoDir;
    } else {
        if (envVars.repoDir) {
            assert(repoDir === envVars.repoDir);
        }
    }
    if (isNullishOrEmptyString(repoDir)) {
        return null;
    }
    assert(repoDir);

    let ymlConfig;
    if (applicationYmlHash) {
        // Compute 'application.yml' shasum
        const appYmlHash = await computeApplicationYmlHash(springConfigLocation);

        ymlConfig = (appYmlHash === applicationYmlHash) ?
            await parseApplicationYmlFile(springConfigLocation, { keepEnv: false }) :
            undefined;
    }

    return {
        ...envVars,
        repoDir,
        springConfigLocation,
        applicationYmlHash,
        ymlConfig,
    };
}

/**
 * - Function defined out-of-class to keep it private
 * - Directory paths must be absolute
 * - Retrieves github latest version if needed
 * - Fills missing `Package.cloneRepo`
 * - Fills missing `Package.gitHubRepoName`
 * - Fills missing `Package.commitish`
 * - Fills missing `Package.branch`
 * - Does not resolve placeholders
 * - Throws an exception if failed.
 * @param {typeof AbstractService} abstractServiceClass
 * @param {{
 *      repository: (string | types.Package),
 *      version?: string
 *      branch?: string
 * }} params
 */
export async function helperAbstractServiceToPackage(abstractServiceClass, {
    repository,
    version,
    branch
}) {
    let pkgCopy;
    if (typeof repository === 'string') {
        pkgCopy = toPackage(repository);
    } else {
        pkgCopy = deepCopyPackage(repository);
        assert(typeof pkgCopy !== 'string');
    }
    if (!path.isAbsolute(pkgCopy.directory)) {
        throw new CodeError(`Service package directory is not a valid absolute path, dir='${pkgCopy.directory}'`);
    }
    /** @todo investigate, version+branch overrides should not be placed here ? */
    // Override commitish if needed
    if (version) {
        pkgCopy.commitish = version;
    }
    // Override branch if needed
    if (branch) {
        pkgCopy.branch = branch;
    }
    // compute the final github repo infos
    const gitRepo = await abstractServiceClass.getGitHubRepo(pkgCopy);

    pkgCopy.cloneRepo = gitRepo.cloneRepo;
    pkgCopy.commitish = gitRepo.commitish;
    pkgCopy.gitHubRepoName = gitRepo.gitHubRepoName;

    return pkgCopy;
}

/**
 * - Fills-up & validates service package (repo, version etc.)
 * - Installs the resolved service package
 * - Throws an exception if failed.
 * @param { typeof AbstractService } abstractServiceClass
 * @param {{
 *      repository: (string | types.Package),
 *      version?: string
 *      branch?: string
 * }} params
 */
export async function installServiceClassPackage(abstractServiceClass, {
    repository,
    version,
    branch
}) {
    const pkg = await helperAbstractServiceToPackage(abstractServiceClass, { repository, version, branch });
    // If package is not installed : install it otherwise do nothing.
    // Nothing will happen if commitish is changed after a previous install
    await installPackage(pkg);
}

/**
 * - Out of class definition to keep the method private
 * - only used by `<springServiceClass>.deepCopyConfig(config, resolvePlaceholders)`
 * @param {srvTypes.SpringServiceConfig} config
 * @param {string[]} additionnalProperties
 * @param {{[varname:string]: string}} placeholders
 */
export function inplaceResolveSpringServicePlaceholders(config, additionnalProperties, placeholders) {
    ["logFile", "pidFile", "springConfigLocation"].forEach((v) => {
        placeholdersPropertyReplace(config, v, placeholders);
    });
    additionnalProperties.forEach((v) => {
        placeholdersPropertyReplace(config, v, placeholders);
    });
    if (typeof config.repository === 'string') {
        placeholdersPropertyReplace(config, 'repository', placeholders);
    } else {
        placeholdersPropertyReplace(config.repository, 'directory', placeholders);
    }
}
