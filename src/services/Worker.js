import * as srvTypes from './services-types-internal.js';
import * as types from '../common/common-types.js';
import path from 'path';
import assert from 'assert';
import { parseEnvVars as utilsParseEnvVars } from '../common/utils.js';
import { GanachePoCoService } from '../poco/GanachePoCoService.js';
import { inplaceResolveSpringServicePlaceholders, installServiceClassPackage, pidToSpringConstructorArgs, SpringServerService } from './spring-serverservice.js';
import { parseApplicationYmlFile } from './application-dot-yml.js';
import { CoreService } from './Core.js';
import { DockerService } from './DockerService.js';
import { getLatestVersion } from '../git/git-api.js';
import { resolveAbsolutePath, throwIfDirDoesNotExist, throwIfNotAbsolutePath, toRelativePath } from '../common/fs.js';
import { toPackage, toPackageDirectory } from '../pkgmgr/pkg.js';
import { removeSuffix, stringIsPOSIXPortable, stringToHostnamePort, stringToPositiveInteger, throwIfNullishOrEmptyString } from '../common/string.js';
import { CodeError } from '../common/error.js';
import { throwIfNotPositiveInteger, throwIfNotStrictlyPositiveInteger } from '../common/number.js';
import { envVarName } from '../common/consts.js';

/**
 * @typedef {srvTypes.SpringServerServiceConstructorArgs & 
 * {
 *      name?: string,
 *      directory?: string,
 *      coreUrl?: string,
 *      dockerHost?: string,
 *      walletIndex?: number
 * }} WorkerServiceConstructorArgs
 */

/* ---------------------- WorkerService Class -------------------------- */

export class WorkerService extends SpringServerService {

    /** 
     * @override
     * @returns {typeof WorkerService} 
     */
    theClass() { return WorkerService; }

    static typename() { return 'worker'; }
    static CLASSNAME() { return 'com.iexec.worker.' + WorkerService.ENTRY(); }
    static ENTRY() { return 'Application'; }

    CLASSNAME() { return WorkerService.CLASSNAME(); }
    ENTRY() { return WorkerService.ENTRY(); }

    /** @type {boolean} */
    static #guardConstructing = false;

    /** @type {string=} */
    #name;

    /** @type {string=} */
    #directory;

    /** @type {URL=} */
    #coreURL;

    /** @type {string=} */
    #dockerHost;

    /** @type {number=} */
    #walletIndex;

    /** @override */
    static get defaultGitUrl() {
        return 'https://github.com/iExecBlockchainComputing/iexec-worker.git';
    }
    /** @override */
    static get gitHubRepoName() { return 'iexec-worker'; }

    /** @type {string} */
    static #latestVersion;

    /** @override */
    static async latestVersion() {
        if (!WorkerService.#latestVersion) {
            WorkerService.#latestVersion = await getLatestVersion(this.defaultGitUrl);
        }
        return WorkerService.#latestVersion;
    }

    /**
     * @param {WorkerServiceConstructorArgs} args
     */
    constructor(args) {
        if (!WorkerService.#guardConstructing) {
            throw new TypeError('class constructor is not accessible');
        }

        super(args);

        assert(args.name);
        assert(args.directory);
        assert(args.coreUrl);
        assert(args.dockerHost);
        assert(args.walletIndex);

        this.#name = args.name;
        this.#directory = args.directory;
        this.#coreURL = new URL(args.coreUrl);
        this.#dockerHost = args.dockerHost;
        this.#walletIndex = args.walletIndex;
    }

    /** @param {WorkerServiceConstructorArgs} args */
    static #newWorkerService(args) {
        try {
            WorkerService.#guardConstructing = true;
            const o = new WorkerService(args);
            WorkerService.#guardConstructing = false;
            return o;
        } catch (err) {
            WorkerService.#guardConstructing = false;
            throw err;
        }
    }

    get directory() { return this.#directory; }
    get name() { return this.#name; }
    get walletIndex() { return this.#walletIndex; }
    get coreUrl() { return this.#coreURL?.toString(); }

    /** @override */
    static runDependencies() {
        const s = super.runDependencies();
        s.add(DockerService.typename());
        s.add(CoreService.typename());
        return s;
    }

    /** 
     * - if `resolvePlaceholders === true` : may retrieve repo latest version from github 
     * @param {srvTypes.WorkerConfig} config 
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
        assert(configCopy.type === 'worker');

        if (relativeToDirectory) {
            configCopy.directory = toRelativePath(relativeToDirectory, config.directory);
        }

        if (resolvePlaceholders) {
            // Warning : 'configCopy.repository' is calculated in 'super.deepCopyConfig(...)'
            // if needed, retrieves latest version on github
            const gitHubRepo = await this.getGitHubRepo(toPackage(configCopy.repository));
            inplaceResolveSpringServicePlaceholders(
                configCopy, ["directory"],
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
            name: this.#name?.toString(),
            directory: this.#directory?.toString(),
            coreUrl: this.#coreURL?.toString(),
            dockerHost: this.#dockerHost?.toString(),
            walletIndex: this.#walletIndex,
        };
    }

    /* -------------------------- Private ENV Vars -------------------------- */

    /**
     * @override
     * @param {string} str 
     */
    parseEnvVars(str) {
        return WorkerService.parseEnvVars(str);
    }

    /**
     * @override
     * @param {string} str 
    * @returns {WorkerServiceConstructorArgs}
     */
    static parseEnvVars(str) {
        const env = super.parseEnvVars(str);
        const varNames = [
            envVarName('DOCKERHOST'),
            envVarName('WORKERDIR'),
            envVarName('WORKERNAME'),
            envVarName('COREURL'),
            envVarName('WALLETINDEX'),
        ];
        const o = utilsParseEnvVars(varNames, str);
        const idx = stringToPositiveInteger(o[envVarName('WALLETINDEX')]);
        assert(idx);
        return {
            ...env,
            name: o[envVarName('WORKERNAME')],
            directory: o[envVarName('WORKERDIR')],
            coreUrl: o[envVarName('COREURL')],
            dockerHost: o[envVarName('DOCKERHOST')],
            walletIndex: idx,
        }
    }

    /**
     * @override
     * @protected
     * @param {number} pid 
     */
    getSuccessORANDPatterns(pid) {
        return [[`Cool, your iexec-worker is all set!`, this.CLASSNAME()]];
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
     * @protected
     * @param {number} pid 
     */
    getFailureExcludePatterns(pid) {
        return [
            'Failed to check SGX device.',
            'SGX driver is installed but no SGX device was found (SGX not enabled?)'
        ];
    }

    /**
     * @override
     * @param {{[envName:string] : string}} extras
     * @returns {Promise<{[envName:string] : string}>}
     */
    async getEnvVars(extras) {
        const env = await super.getEnvVars(extras);

        if (this.#name) {
            env[envVarName('WORKERNAME')] = this.#name;
        }
        if (this.#directory) {
            env[envVarName('WORKERDIR')] = this.#directory;
        }
        if (this.#coreURL) {
            env[envVarName('COREURL')] = this.#coreURL.toString();
        }
        if (this.#dockerHost) {
            env[envVarName('DOCKERHOST')] = this.#dockerHost;
        }
        if (this.#walletIndex) {
            env[envVarName('WALLETINDEX')] = this.#walletIndex.toString();
        }

        // // logstash : network address resolution is super slow on MacOS
        // // ============================================================
        // // - Super slow on Mac (at least on BigSur). 
        // // - By default, resolution order is = "network, localhost" (1 minute at least)
        // // - Change it to = "localhost, network" (ms only)
        // env["logstash-gelf.resolutionOrder"] = "localhost,network";

        return env;
    }

    /**
     * @param {srvTypes.InventoryLike | undefined} inventory
     * @param {number} walletIndex 
     * @param {string | undefined} coreUrlStr 
     */
    static async #resolveWalletFileAndCoreURL(inventory, walletIndex, coreUrlStr) {

        if (inventory) {
            if (!coreUrlStr) {
                throw new CodeError(`Missing core url`);
            }
            const coreURL = new URL(coreUrlStr);
            const hub = inventory.getHubFromHost(coreURL);
            if (!hub) {
                throw new CodeError(`Unknown core url: ${coreUrlStr}`);
            }
            const g = await inventory.newInstanceFromHub('ganache', hub);
            if (!g) {
                throw new CodeError(`Invalid core hub: ${hub}`);
            }
            assert(g instanceof GanachePoCoService);
            const walletPath = await g.walletFileAtIndex(walletIndex)
            return {
                coreURL,
                walletPath,
                walletPassword: g.walletsPassword
            };
        }

        const cores = await CoreService.running();
        if (!cores) {
            throw new CodeError('Core service is not running');
        }
        if (cores.length > 1) {
            throw new CodeError('Multiple instances of Core are running.');
        }

        assert(cores[0] instanceof CoreService);
        const hub = cores[0].hub;
        assert(hub);

        const coreUrl = cores[0].urlString;
        assert(coreUrl);

        const pidsAndServices = await GanachePoCoService.running({ ref: hub });
        assert(pidsAndServices);
        assert(pidsAndServices.length === 1);
        const g = pidsAndServices[0].service;
        if (!(g instanceof GanachePoCoService)) {
            throw new CodeError('Unable to retrieve ganache instance');
        }

        const walletPath = await g.walletFileAtIndex(walletIndex)

        if (!coreUrlStr) {
            coreUrlStr = coreUrl;
        } else {
            if (coreUrlStr !== coreUrl) {
                throw new CodeError('An incompatible instance of Core is running.');
            }
        }

        return {
            coreURL: new URL(coreUrlStr),
            walletPath,
            walletPassword: g.walletsPassword
        };
    }

    /* ------------------------------ Install ------------------------------- */

    /**
     * Throws an exception if failed.
     * @param {{
     *      repository: (string | types.Package)
     *      version?: string
     *      branch?: string
     *      directory?: string,
     * }} params
     */
    static async install({
        repository,
        version,
        branch,
        directory
    }) {
        // Throws exception if failed
        await installServiceClassPackage(this, { repository, version, branch });
    }


    /* ---------------------------- newInstance ----------------------------- */

    /**
     * - Throws an exception if failed
     * @param {types.ServerServiceArgs & {
     *      repository: (string | types.Package),
     *      springConfigLocation: string,
     *      ymlConfig: any,
     *      walletIndex: number,
     *      name: string,
     *      directory: string,
     *      coreUrl?: string,
     *      dockerHost?: string,
     *      sgxDriverMode?: 'none' | 'native' | 'legacy'
     * }} params
     * @param {srvTypes.InventoryLike=} inventory
     */
    static async newInstance({
        repository,
        springConfigLocation,
        ymlConfig,
        walletIndex,
        name,
        directory,
        coreUrl,
        dockerHost,
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

        if (inventory) {
            // When using inventory, core url is needed
            if (!coreUrl) {
                throw new CodeError(`Missing core url`);
            }
        }

        directory = resolveAbsolutePath(directory);
        springConfigLocation = resolveAbsolutePath(springConfigLocation);

        assert(stringIsPOSIXPortable(name));

        if (inventory) {
            const h = inventory.getDockerHost();
            if (h) {
                dockerHost = h.hostname + ":" + h.port.toString();
            }
        }
        if (!dockerHost) {
            throw new CodeError('Missing docker host');
        }

        throwIfNotPositiveInteger(walletIndex);
        assert(walletIndex);

        const { hostname: dockerHostname, port: dockerPort } = stringToHostnamePort(dockerHost);
        throwIfNullishOrEmptyString(dockerHostname);
        throwIfNotStrictlyPositiveInteger(dockerPort);
        assert(dockerHostname);
        assert(dockerPort);

        const { walletPath, coreURL, walletPassword } =
            await WorkerService.#resolveWalletFileAndCoreURL(inventory, walletIndex, coreUrl);

        /* -------------------- Compute Final Yml Config -------------------- */

        const ymlFileLocation = path.join(repoDir, 'src/main/resources');
        const ymlFullConfig = await parseApplicationYmlFile(ymlFileLocation, { merge: ymlConfig });

        ymlFullConfig.server.port = options.port;

        ymlFullConfig.core['protocol'] = removeSuffix(':', coreURL.protocol);
        ymlFullConfig.core['host'] = coreURL.hostname;
        ymlFullConfig.core['port'] = coreURL.port;

        ymlFullConfig.worker['name'] = name;
        ymlFullConfig.worker['worker-base-dir'] = directory;

        ymlFullConfig.wallet['encrypted-file-path'] = walletPath;
        ymlFullConfig.wallet['password'] = walletPassword;

        ymlFullConfig.docker.registries[1] = {
            address: dockerHostname + ':' + dockerPort,
            username: "",
            password: ""
        }

        // driver-mode = NONE (default)
        // driver-mode = NATIVE
        // driver-mode = LEGACY
        // ymlFullConfig.tee.sgx['driver-mode'] = 'NATIVE';
        if (!options.sgxDriverMode) {
            ymlFullConfig.tee.sgx['driver-mode'] = 'NONE';
        } else {
            if (options.sgxDriverMode !== 'none' &&
                options.sgxDriverMode !== 'legacy' &&
                options.sgxDriverMode !== 'native') {
                throw new CodeError(`Invalid sgxDriverMode '${options.sgxDriverMode}', expecting 'none' | 'legacy' | 'native'`);
            }
            ymlFullConfig.tee.sgx['driver-mode'] = options.sgxDriverMode.toUpperCase();
        }

        return WorkerService.#newWorkerService({
            ...options,
            ymlConfig: ymlFullConfig,
            repoDir,
            springConfigLocation,
            name,
            directory,
            coreUrl: coreURL.toString(),
            dockerHost: dockerHostname + ':' + dockerPort.toString(),
            walletIndex,
        });
    }

    /* ------------------------------ fromPID ------------------------------- */

    /**
     * @override
     * @param {number} pid 
     */
    static async fromPID(pid) {
        const args = await pidToSpringConstructorArgs(pid, this.parseEnvVars);

        if (!args ||
            !args.coreUrl ||
            !args.dockerHost ||
            !args.name ||
            !args.directory ||
            !args.walletIndex) { return null; }

        assert(args.port);

        /* ---------------------- Verify Yml Config ------------------------- */

        if (args.ymlConfig) {
            const ymlConfig = args.ymlConfig;

            const _coreUrl =
                ymlConfig.core['protocol'] + "://" +
                ymlConfig.core['host'] + ":" +
                ymlConfig.core['port'].toString();

            assert(removeSuffix('/', args.coreUrl) === _coreUrl);
            assert(args.port === ymlConfig.server.port);
        }

        return WorkerService.#newWorkerService(args);
    }

    /**
     * @param {object} args 
     * @param {string=} args.springConfigLocation 
     * @param {string=} args.coreUrl 
     */
    static async runningPIDs({ coreUrl, ...others } = {}) {
        const pids = await super.runningPIDs(others);
        if (!pids) {
            return null;
        }

        // Apply filters
        /** @type {{ pid: number, command: string, envs:any }[]} */
        const filteredPids = [];
        pids.forEach(pidStruct => {
            const envs = this.parseEnvVars(pidStruct.command);

            if (coreUrl) {
                if (coreUrl !== envs.coreUrl) {
                    return;
                }
            }

            filteredPids.push(pidStruct);
        });

        return filteredPids;
    }
}
