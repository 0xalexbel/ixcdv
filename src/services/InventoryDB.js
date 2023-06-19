import * as types from '../common/common-types.js';
import * as srvTypes from './services-types-internal.js';
import * as pocoTypes from '../poco/poco-types.js';
import path from 'path';
import assert from 'assert';
import { Market } from './Market.js';
import { ORDERED_SERVICE_TYPES } from './base-internal.js';
import { Dependencies } from './Dependencies.js';
import { WorkerService } from './Worker.js';
import { DockerService } from './DockerService.js';
import { MongoService } from './MongoService.js';
import { RedisService } from './RedisService.js';
import { SmsService } from './Sms.js';
import { ResultProxyService } from './ResultProxy.js';
import { BlockchainAdapterService } from './BlockchainAdapter.js';
import { CoreService } from './Core.js';
import { DEFAULT_WALLET_INDEX } from './default-config.js';
import { IpfsService } from '../ipfs/IpfsService.js';
import { GanachePoCoService } from '../poco/GanachePoCoService.js';
import { isNullishOrEmptyString, placeholdersPropertyReplace, stringIsPOSIXPortable, stringToPositiveInteger, throwIfNullishOrEmptyString } from '../common/string.js';
import { CodeError } from '../common/error.js';
import { ContratRefFromString, DevContractRef, PoCoContractRef, PoCoHubRef } from '../common/contractref.js';
import { isPositiveInteger, throwIfNotStrictlyPositiveInteger } from '../common/number.js';
import { toPackage } from '../pkgmgr/pkg.js';
import { deepCopyPackage } from '../pkgmgr/pkgmgr-deepcopy.js';
import { getGitHubRepo, getLatestVersion } from '../git/git-api.js';
import { NULL_ADDRESS, toChecksumAddress } from '../common/ethers.js';

const FIRST_WORKER_WALLET_INDEX = DEFAULT_WALLET_INDEX['worker'];

export const fromServiceType = {
    'ipfs': IpfsService,
    'ganache': GanachePoCoService,
    'docker': DockerService,
    'mongo': MongoService,
    'redis': RedisService,
    'market': Market,
    'sms': SmsService,
    'resultproxy': ResultProxyService,
    'blockchainadapter': BlockchainAdapterService,
    'core': CoreService,
    'worker': WorkerService,
};
Object.freeze(fromServiceType);

/**
 * @param {srvTypes.NonWorkerServiceType} type 
 * @param {number} chainid 
 * @param {string} deployConfigName 
 */
function defaultHubServiceName(type, chainid, deployConfigName) {
    const hubAlias = chainid.toString() + '.' + deployConfigName;
    return type + '.' + hubAlias;
}

/**
 * @param {srvTypes.NonWorkerServiceType} type 
 * @param {number} chainid 
 */
function defaultChainServiceName(type, chainid) {
    return type + '.' + chainid.toString();
}

export class InventoryDB {

    /** @type {string} */
    #defaultChainName;

    /** 
     * @type { Map<string, srvTypes.InventoryNonWorkerConfig> }
     */
    #nameToConfig = new Map();

    /** 
     * @type {Map<string, srvTypes.InventoryNonWorkerConfig> }
     */
    #nameToSharedConfig = new Map();

    /** @type {Map<string,string>} */
    #hostToName = new Map();

    /** @type {Map<string,string[]>} */
    #typeToNames = new Map();

    /** @type {Map<string,{name:string, service:GanachePoCoService}>} */
    #chainidToGanache = new Map();

    /** 
     * @type {Map<string, {
     *     ganache: string,
     *     chainid: number,
     *     native: boolean,
     *     flavour: 'enterprise' | 'standard',
     *     sms?: string,
     *     resultproxy?: string,
     *     blockchainadapter?: string,
     *     core?: string,
     *     market?: string,
     *     workers?: {
     *          directory: string,
     *          portRange: {from:number, to:number, size:number}
     *     }
     * }>} 
     */
    #hubAliasToHubData = new Map();

    /** 
     * @typedef {{ 
     *       hubAlias: string, 
     *       bridgedChainName: string | null, 
     *       enterpriseSwapChainName: string | null 
     * }} Chain
     */

    /** 
     * @type { Map<string, Chain> } 
     */
    #allChains = new Map();

    /** @type {{ unsolved: types.Package, resolved: types.Package }} */
    // @ts-ignore
    #workersRepository;

    /** @type {string} */
    #rootDir

    /**
     * @param {string} dir 
     * @param {string} defaultChainName 
     */
    constructor(dir, defaultChainName) {
        assert(dir);
        assert(defaultChainName);
        assert(!isNullishOrEmptyString(dir));
        assert(!isNullishOrEmptyString(defaultChainName));
        assert(path.isAbsolute(dir));
        this.#rootDir = dir;
        this.#defaultChainName = defaultChainName;
    }

    get rootDir() { return this.#rootDir; }
    get defaultChainName() { return this.#defaultChainName; }
    get defaultHubAlias() {
        const defaultChain = this.#allChains.get(this.#defaultChainName);
        if (isNullishOrEmptyString(defaultChain?.hubAlias)) {
            throw new CodeError('Missing default chain');
        }
        assert(defaultChain);
        assert(defaultChain.hubAlias);
        return defaultChain.hubAlias;
    }

    /**
     * @param {string} name 
     * @param {string} host 
     * @param {srvTypes.NonWorkerServiceConfig} config 
     * @param {boolean} shared 
     */
    async #resolveAndAddConfig(name, host, config, shared) {
        if (!stringIsPOSIXPortable(name)) {
            throw new TypeError(`Invalid name='${name}', only POSIX portable characters are allowed`);
        }

        if (this.#nameToConfig.has(name)) {
            throw new CodeError(`Duplicate service config name=${name}`);
        }

        /** @type {any} */
        const anyConfig = config;
        const resolved = await fromServiceType[config.type].deepCopyConfig(anyConfig, true /* resolve placeholders */);
        assert(resolved.type === config.type);
        const ic = { name, type: config.type, unsolved: config, resolved };
        Object.freeze(ic);

        // @ts-ignore
        this.#nameToConfig.set(name, ic);
        if (shared) {
            //@ts-ignore
            this.#nameToSharedConfig.set(name, ic);
        }

        let tNames = this.#typeToNames.get(config.type);
        if (!tNames) {
            tNames = [];
            this.#typeToNames.set(config.type, tNames);
        }
        tNames.push(name);

        assert(!host.startsWith('http'));
        if (this.#hostToName.has(host)) {
            throw new CodeError(`Duplicate service host=${host}`);
        }
        this.#hostToName.set(host, name);

        return name;
    }

    /**
     * @param {string} hub 
     */
    static #toPoCoHubRef(hub) {
        const hubRef = ContratRefFromString(hub, 'ERC1538Proxy');
        if (!hubRef) {
            throw new TypeError('Invalid config hub parameter');
        }
        if (!(hubRef instanceof PoCoContractRef)) {
            throw new TypeError('Invalid config hub parameter');
        }
        if (!hubRef.hasDeployConfigName) {
            throw new TypeError('Invalid config hub parameter (missing deploy config name)');
        }
        return hubRef;
    }

    /**
     * @param {string | URL} host 
     */
    configNameFromHost(host) {
        if (!(host instanceof URL)) {
            if (isNullishOrEmptyString(host)) {
                return undefined;
            }
            if (host.startsWith('http://') || host.startsWith('https://')) {
                host = new URL(host);
            } else {
                host = new URL('http://' + host);
            }
        }
        return this.#hostToName.get(host.host);
    }

    /**
     * @param {string | URL} host 
     */
    configFromHost(host) {
        const name = this.configNameFromHost(host);
        if (name) {
            return this.#nameToConfig.get(name);
        }
        /** @todo find worker */
        return undefined;
    }

    /**
     * @param {string | URL} host 
     * @returns {string}
     */
    getHubFromHost(host) {
        const ic = this.configFromHost(host);
        if (!ic) {
            throw new CodeError(`Unknown host: ${host.toString}`);
        }
        const conf = ic.resolved;
        if (conf.type === 'core' ||
            conf.type === 'sms' ||
            conf.type === 'blockchainadapter' ||
            conf.type === 'resultproxy') {
            return conf.hub;
        }
        throw new CodeError(`Invalid config: ${ic.name}`);
    }

    /**
     * @param {number} port 
     */
    hasLocalhost(port) {
        return this.#hostToName.has('localhost:' + port.toString());
    }

    /**
     * @param {string} name 
     */
    isShared(name) {
        return this.#nameToSharedConfig.has(name);
    }

    getWorkersRepository() {
        return this.#workersRepository;
    }

    /**
     * @param {string | PoCoHubRef} hub 
     * @param {number} index
     * @returns {srvTypes.InventoryWorkerConfig}
     */
    getWorkerConfig(hub, index) {
        const hubStr = DevContractRef.toHubAlias(hub);
        if (!isPositiveInteger(index)) {
            throw new CodeError(`Invalid worker index ${index}`);
        }
        if (!this.#workersRepository.unsolved ||
            !this.#workersRepository.resolved) {
            throw new CodeError('Missing workers repository');
        }

        const hubData = this.#hubAliasToHubData.get(hubStr);
        if (!hubData) {
            throw new CodeError(`Unknown hub ${hubStr}`);
        }
        if (!hubData.core) {
            throw new CodeError(`Unable to determine hub core (hub=${hubStr})`);
        }
        if (!hubData.workers) {
            throw new CodeError(`Unable to determine hub workers (hub=${hubStr})`);
        }
        if (hubData.workers.portRange.from + index > hubData.workers.portRange.to) {
            throw new CodeError(`Too many workers, port out of bounds`);
        }

        const coreConf = this.getConfig(hubData.core).resolved;
        assert(coreConf);
        assert(coreConf.type === 'core');

        const dockerConf = this.getDockerConfig()?.resolved;
        assert(dockerConf);
        assert(dockerConf.type === 'docker');

        const workerName = InventoryDB.computeWorkerName(hub, index);
        const workersDir = hubData.workers.directory;

        const coreUrl = 'http://' + (coreConf.hostname ?? 'localhost') + ":" + coreConf.port.toString();
        const dockerHost = (dockerConf.hostname ?? 'localhost') + ":" + dockerConf.port.toString();

        // Admin : 0
        // Workerpool : 1
        // App: 2
        // Dataset: 3
        // Requester: 4
        // Worker: 5
        /** @type {srvTypes.WorkerConfig} */
        const workerCfg = {
            type: "worker",
            port: hubData.workers.portRange.from + index,
            hostname: 'localhost',
            logFile: path.join(workersDir, workerName, workerName + '.log'),
            pidFile: path.join(workersDir, workerName, workerName + '.pid'),
            directory: path.join(workersDir, workerName, 'exec'),
            coreUrl,
            dockerHost,
            name: workerName,
            springConfigLocation: path.join(workersDir, workerName),
            repository: '',
            walletIndex: FIRST_WORKER_WALLET_INDEX + index,
            ymlConfig: {}
        }
        return {
            type: 'worker',
            index,
            hub: hubStr,
            unsolved: {
                ...workerCfg,
                repository: this.#workersRepository.unsolved
                // type: "worker",
                // port: hubData.workers.portRange.from + index,
                // hostname: 'localhost',
                // logFile: path.join(workersDir, workerName, workerName + '.log'),
                // pidFile: path.join(workersDir, workerName, workerName + '.pid'),
                // directory: path.join(workersDir, workerName, 'exec'),
                // coreUrl,
                // dockerHost,
                // name: workerName,
                // springConfigLocation: path.join(workersDir, workerName),
                // repository: this.#workersRepository.unsolved,
                // walletIndex: FIRST_WORKER_WALLET_INDEX + index,
                // ymlConfig: {}
            },
            resolved: {
                ...workerCfg,
                repository: this.#workersRepository.resolved
                // type: "worker",
                // port: hubData.workers.portRange.from + index,
                // hostname: 'localhost',
                // logFile: path.join(workersDir, workerName, workerName + '.log'),
                // pidFile: path.join(workersDir, workerName, workerName + '.pid'),
                // directory: path.join(workersDir, workerName, 'exec'),
                // coreUrl,
                // dockerHost,
                // name: workerName,
                // springConfigLocation: path.join(workersDir, workerName),
                // repository: this.#workersRepository.resolved,
                // walletIndex: FIRST_WORKER_WALLET_INDEX + index,
                // ymlConfig: {}
            },
        };
    }

    /**
     * @returns {srvTypes.InventoryIpfsConfig}
     */
    getIpfsConfig() {
        const ics = this.getConfigsByType('ipfs');
        if (!ics || ics.length === 0) {
            throw new CodeError('Missing ipfs config');
        }
        assert(ics.length === 1);
        assert(ics[0].type === 'ipfs');
        assert(ics[0].unsolved.type === 'ipfs');
        assert(ics[0].resolved.type === 'ipfs');
        // @ts-ignore
        return ics[0];
    }

    getIpfsApiHost() {
        const ipfsConfig = this.getIpfsConfig()?.resolved;
        if (!ipfsConfig) {
            throw new CodeError('Missing Ipfs host');
        }
        return { hostname: ipfsConfig.hostname ?? 'localhost', port: ipfsConfig.apiPort };
    }

    /**
     * @returns {srvTypes.InventoryDockerConfig}
     */
    getDockerConfig() {
        const ics = this.getConfigsByType('docker');
        if (!ics || ics.length === 0) {
            throw new CodeError('Missing docker config');
        }
        assert(ics.length === 1);
        assert(ics[0].type === 'docker');
        assert(ics[0].unsolved.type === 'docker');
        assert(ics[0].resolved.type === 'docker');
        // @ts-ignore
        return ics[0];
    }

    getDockerHost() {
        const dockerConfig = this.getDockerConfig()?.resolved;
        if (!dockerConfig) {
            throw new CodeError('Missing docker host');
        }
        return { hostname: dockerConfig.hostname ?? 'localhost', port: dockerConfig.port };
    }
    getDockerUrl() {
        const host = this.getDockerHost();
        return 'http://' + host.hostname + ":" + host.port.toString();
    }

    /**
     * @param {string} name 
     * @returns {srvTypes.InventoryNonWorkerConfig}
     */
    getConfig(name) {
        const ic = this.#nameToConfig.get(name);
        if (!ic) {
            throw new CodeError(`Unknown config name '${name}'`);
        }
        return ic;
    }

    /**
     * @param {string} name 
     * @returns {srvTypes.InventoryGanacheConfig}
     */
    getGanacheConfig(name) {
        const ic = this.#nameToConfig.get(name);
        if (!ic || ic.type !== 'ganache') {
            throw new CodeError(`Unknown ganache config name '${name}'`);
        }
        assert(ic.unsolved.type === 'ganache');
        assert(ic.resolved.type === 'ganache');
        // @ts-ignore
        return ic;
    }

    /**
     * @param {string} name 
     * @returns {srvTypes.InventoryMarketConfig}
     */
    getMarketConfig(name) {
        const ic = this.#nameToConfig.get(name);
        if (!ic || ic.type !== 'market') {
            throw new CodeError(`Unknown market config name '${name}'`);
        }
        assert(ic.unsolved.type === 'market');
        assert(ic.resolved.type === 'market');
        // @ts-ignore
        return ic;
    }

    /**
     * @returns {srvTypes.InventoryMarketConfig[]=}
     */
    getMarketConfigs() {
        const names = this.#typeToNames.get('market');
        if (!names || names.length === 0) {
            return undefined;
        }

        return names.map(name => {
            const ic = this.#nameToConfig.get(name);
            assert(ic);
            assert(ic.type === 'market');
            assert(ic.resolved.type === 'market');
            assert(ic.unsolved.type === 'market');
            /** @type {srvTypes.InventoryMarketConfig} */
            //@ts-ignore
            const imc = ic;
            return imc;
        });
    }

    /**
     * @param {srvTypes.NonWorkerServiceType} type 
     */
    getConfigsByType(type) {
        const names = this.#typeToNames.get(type);
        if (!names || names.length === 0) {
            return undefined;
        }
        return names.map(name => {
            const ic = this.#nameToConfig.get(name);
            assert(ic);
            return ic;
        });
    }

    /**
     * @param {srvTypes.NonWorkerServiceType} type 
     * @returns {string[] | undefined}
     */
    getConfigNamesFromType(type) {
        const names = this.#typeToNames.get(type);
        if (!names || names.length === 0) {
            return undefined;
        }
        return names;
    }

    /**
     * @param {'ganache' | 'sms' | 'blockchainadapter' | 'resultproxy' | 'core' | 'market'} type 
     * @param {string | PoCoHubRef} hubAliasOrHubRef 
     */
    getConfigNameFromHub(type, hubAliasOrHubRef) {
        assert(hubAliasOrHubRef);
        let hubAlias;
        if (typeof hubAliasOrHubRef === 'string') {
            hubAlias = hubAliasOrHubRef;
        } else {
            assert(hubAliasOrHubRef.hasDeployConfigName);
            hubAlias = hubAliasOrHubRef.hubAlias();
        }
        const hubData = this.#hubAliasToHubData.get(hubAlias);
        if (!hubData) {
            return undefined;
        }
        if (!hubData[type]) {
            return undefined;
        }
        const name = hubData[type];
        assert(typeof name === 'string');

        return name;
    }

    /**
     * @param {'ganache' | 'sms' | 'blockchainadapter' | 'resultproxy' | 'core' | 'market'} type 
     * @param {string | PoCoHubRef} hubAliasOrHubRef 
     */
    getConfigFromHub(type, hubAliasOrHubRef) {
        const name = this.getConfigNameFromHub(type, hubAliasOrHubRef);
        if (!name) {
            return undefined;
        }
        return this.getConfig(name);
    }

    /**
     * - Returns the number of services of type `type`
     * @param {srvTypes.NonWorkerServiceType} type 
     */
    countByType(type) {
        const services = this.#typeToNames.get(type);
        return (services) ? services.length : 0;
    }

    get size() {
        return this.#nameToConfig.size;
    }

    /**
     * @param {srvTypes.InventoryConfig} ic 
     */
    async newInstanceFromInventoryConfig(ic) {
        // Must use resolved !
        // @ts-ignore
        const instance = await fromServiceType[ic.type].newInstance(ic.resolved, this);
        return instance;
    }
    /**
     * @param {srvTypes.InventoryNonWorkerConfig} ic 
     */
    async newInstanceFromInventoryNonWorkerConfig(ic) {
        // @ts-ignore
        assert(ic.type !== 'worker');
        // Must use resolved !
        // @ts-ignore
        const instance = await fromServiceType[ic.type].newInstance(ic.resolved, this);
        return instance;
    }

    allChainNames() {
        return [...this.#allChains.keys()];
    }

    /**
     * @param {string} name 
     */
    getChainHub(name) {
        if (!name) {
            return undefined;
        }
        return this.#allChains.get(name)?.hubAlias;
    }

    /**
     * @param {string} name 
     */
    hasChain(name) {
        if (!name) {
            return false;
        }
        return this.#allChains.has(name);
    }

    /**
     * @param {*} chainid 
     */
    hasChainId(chainid) {
        if (!chainid) {
            return false;
        }
        if (typeof chainid === 'string') {
            chainid = stringToPositiveInteger(chainid);
            if (chainid === undefined) {
                return false;
            }
        }
        if (!isPositiveInteger(chainid)) {
            return false;
        }

        const ics = this.getConfigsByType('ganache');
        if (!ics || ics.length === 0) {
            return false;
        }
        for (let i = 0; i < ics.length; ++i) {
            const ganacheConf = ics[i].resolved;
            assert(ganacheConf);
            assert(ganacheConf.type === 'ganache');
            if (ganacheConf.config.chainid === chainid) {
                return true;
            }
        }
        return false;
    }

    /**
     * @param {{
    *      name?: string,
    *      hub?: string,
    *      workerIndex?: number,
    *      type?: srvTypes.ServiceType,
    * }} options 
    */
    async newInstance(options) {
        const ic = this.guessConfig(options);
        if (!ic) {
            return null;
        }
        return this.newInstanceFromInventoryConfig(ic);
    }

    /**
     * @param {string} name 
     */
    async newInstanceFromName(name) {
        const ic = this.getConfig(name);
        return this.newInstanceFromInventoryNonWorkerConfig(ic);
    }

    /**
     * @param {string | PoCoHubRef} hub 
     * @param {number} index 
     */
    async newWorkerInstance(hub, index) {
        const conf = this.getWorkerConfig(hub, index).resolved;
        assert(conf);
        return WorkerService.newInstance(conf, this);
    }

    /** @returns {Promise<Map<number, GanachePoCoService> | undefined>} */
    async getChainids() {
        const ics = this.getConfigsByType('ganache');
        if (!ics || ics.length === 0) {
            return undefined;
        }

        const m = new Map();
        for (let i = 0; i < ics.length; ++i) {
            const conf = ics[i].resolved;
            assert(conf);
            assert(conf.type === 'ganache');
            const g = await GanachePoCoService.newInstance(conf);
            m.set(g.chainid, g);
        }
        return m;
    }

    /**
     * @param {number} chainid 
     */
    async #getGanacheInstanceFromChainid(chainid) {
        let ganacheInstance = this.#chainidToGanache.get(chainid.toString());
        if (!ganacheInstance) {
            const ic = this.getGanacheConfigFromChainid(chainid);
            assert(ic);
            const g = await GanachePoCoService.newInstance(ic.resolved);
            assert(g);
            ganacheInstance = { name: ic.name, service: g };
            this.#chainidToGanache.set(chainid.toString(), ganacheInstance);
        }
        return ganacheInstance;
    }

    /**
     * - Throws an error if failed.
     * @param {string | types.DevContractRefLike} refLike 
     */
    async resolve(refLike) {
        let chainid;
        if (typeof refLike === 'string') {
            const cref = ContratRefFromString(refLike);
            if (!cref) {
                throw new CodeError(`Invalid contract reference '${refLike}'`);
            }
            chainid = cref.chainid;

        } else {
            chainid = refLike.chainid;
        }

        const ganacheInstance = await this.#getGanacheInstanceFromChainid(chainid);
        const hubRef = ganacheInstance.service.resolve(refLike, 'ERC1538Proxy');
        assert(hubRef instanceof PoCoHubRef);

        return {
            PoCoHubRef: hubRef,
            service: ganacheInstance.service
        };
    }

    /**
     * Iterator: configs are sorted in service type order
     */
    [Symbol.iterator]() {
        // Use a new index for each iterator. This makes multiple
        // iterations over the iterable safe for non-trivial cases,
        // such as use of break or nested looping over the same iterable.
        let typeIndex = 0;
        let nameIndex = 0;

        return {
            // Note: using an arrow function allows `this` to point to the
            // one of `[@@iterator]()` instead of `next()`
            /** 
             * @returns {{ done: true } | 
             * { 
             *   value: srvTypes.InventoryConfig, 
             *   done: false 
             * }} 
             * */
            next: () => {
                for (let i = typeIndex; i < ORDERED_SERVICE_TYPES.length; ++i) {
                    const type = ORDERED_SERVICE_TYPES[i]
                    const names = this.#typeToNames.get(type);
                    if (!names || nameIndex >= names.length) {
                        nameIndex = 0;
                        continue;
                    }
                    const name = names[nameIndex];
                    const ic = this.getConfig(name);
                    nameIndex++;
                    typeIndex = i;
                    if (!ic) {
                        continue;
                    }
                    return { value: ic, done: false };
                }
                return { done: true };
            },
        };
    }

    /**
     * @param {{
     *      name?: string,
     *      chain?: string
     *      chainid?: number | string
     *      hub?: string,
     *      workerIndex?: number,
     *      type?: srvTypes.ServiceType | 'iexecsdk',
     * }} options 
     */
    guessConfig(options) {
        if (options.type === 'iexecsdk') {
            return;
        }

        if (options.type === 'worker') {
            if (options.workerIndex === undefined) {
                throw new CodeError(`Missing worker index`);
            }
            if (isNullishOrEmptyString(options.hub)) {
                throw new CodeError(`Missing worker hub`);
            }
            assert(options.workerIndex >= 0);
            assert(options.hub);
            return this.getWorkerConfig(options.hub, options.workerIndex)
        }

        /**
         * @type {srvTypes.NonWorkerServiceType | undefined}
         */
        const nonWType = options.type;

        // Must duplicate options to avoid compiler warning 
        // We want to keep compiler analysis
        if (!isNullishOrEmptyString(options.name)) {
            assert(options.name);
            return this.getConfig(options.name);
        }
        if (isNullishOrEmptyString(nonWType)) {
            return;
        }
        assert(nonWType);
        if (nonWType === 'ipfs') {
            return this.getIpfsConfig();
        }
        if (nonWType === 'docker') {
            return this.getDockerConfig();
        }
        if (nonWType === 'mongo') {
            // no mongo config
            return;
        }
        if (nonWType === 'redis') {
            // no redis config
            return;
        }
        if (nonWType === 'ganache') {
            if (options.chainid !== undefined) {
                /** @type {number} */
                let chainid;
                if (typeof options.chainid === 'string') {
                    const num = stringToPositiveInteger(options.chainid);
                    if (num === undefined) {
                        throw new CodeError('Invalid chainid');
                    }
                    chainid = num;
                } else {
                    chainid = options.chainid;
                }
                return this.getGanacheConfigFromChainid(chainid);
            }
        }
        let hub = (isNullishOrEmptyString(options.hub)) ? undefined : options.hub;
        let chain = (isNullishOrEmptyString(options.chain)) ? undefined : options.chain;
        if (!chain && !hub) {
            chain = this.#defaultChainName;
        }
        if (chain) {
            const c = this.#allChains.get(chain);
            if (c) {
                assert(c.hubAlias);
                if (hub && c.hubAlias !== hub) {
                    throw new CodeError('Incompatible hub');
                }
                hub = c.hubAlias;
            }
        }
        if (!hub) {
            return;
        }
        return this.getConfigFromHub(nonWType, hub);
    }

    /**
     * @param {*} options 
     */
    guessHubAlias(options) {

        /** @type {string=} */
        let hubAlias;
        /** @type {string=} */
        let chainName;

        hubAlias = (isNullishOrEmptyString(options.hub)) ? undefined : options.hub;
        chainName = (isNullishOrEmptyString(options.chain)) ? undefined : options.chain;

        assert(hubAlias === undefined || typeof hubAlias === 'string');
        assert(chainName === undefined || typeof chainName === 'string');

        if (!hubAlias && !chainName) {
            chainName = this.#defaultChainName;
        }

        if (chainName) {
            const c = this.#allChains.get(chainName);
            if (c) {
                assert(c.hubAlias);
                if (hubAlias && c.hubAlias !== hubAlias) {
                    throw new CodeError(`xIncompatible hub, got '${hubAlias}', expecting '${c.hubAlias}'`);
                }
                hubAlias = c.hubAlias;
            } else {
                throw new CodeError(`Unknown chain name '${chainName}'`);
            }
        }

        assert(hubAlias);
        return hubAlias;
    }

    /**
     * @param {string} name 
     */
    dependencies(name) {
        return Dependencies.fromName(name, this);
    }

    /**
     * @param {string} hub 
     * @param {number} index 
     */
    workerDependencies(hub, index) {
        return Dependencies.fromWorkerIndex(hub, index, this);
    }

    /**
     * @param {string} hubAlias 
     * @returns {srvTypes.InventoryMarketConfig | undefined}
     */
    getMarketConfigFromHubAlias(hubAlias) {
        const hubData = this.#hubAliasToHubData.get(hubAlias);
        if (!hubData?.market) {
            return undefined;
        }
        return this.getMarketConfig(hubData.market);
    }

    /**
     * @param {string} hubAlias 
     */
    getMarketApiUrlFromHubAlias(hubAlias) {
        const ic = this.getMarketConfigFromHubAlias(hubAlias);
        if (!ic) {
            return undefined;
        }
        return "http://" + (ic.resolved.api.hostname ?? 'localhost') + ":" + ic.resolved.api.port.toString();
    }

    /**
     * @param {number} chainid 
     * @returns {srvTypes.InventoryGanacheConfig | undefined}
     */
    getGanacheConfigFromChainid(chainid) {
        const ganacheNames = this.#typeToNames.get('ganache');
        if (!ganacheNames || ganacheNames.length === 0) {
            return undefined;
        }
        for (let i = 0; i < ganacheNames.length; ++i) {
            const ic = this.getGanacheConfig(ganacheNames[i]);
            const resolved = ic.resolved;
            if (resolved.config.chainid === chainid) {
                return ic;
            }
        }
        return undefined;
    }

    /**
     * @param {string} hubAlias 
     * @returns {srvTypes.InventoryGanacheConfig | undefined}
     */
    getGanacheConfigFromHubAlias(hubAlias) {
        const hubData = this.#hubAliasToHubData.get(hubAlias);
        if (!hubData?.ganache) {
            return undefined;
        }
        return this.getGanacheConfig(hubData.ganache);
    }

    /**
     * @param {string} hubAlias 
     */
    getGanacheDeploySequenceFromHubAlias(hubAlias) {
        const conf = this.getGanacheConfigFromHubAlias(hubAlias)?.resolved;
        if (!conf) {
            return undefined;
        }
        for (let i = 0; i < conf.config.deploySequence.length; ++i) {
            const seq = conf.config.deploySequence[i];
            const seqHubAlias = conf.config.chainid.toString() + '.' + seq.name;
            if (hubAlias === seqHubAlias) {
                return seq;
            }
        }
        return undefined;
    }

    /**
     * @param {'ganache' | 'sms' | 'blockchainadapter' | 'resultproxy' | 'core' | 'market'} type 
     * @param {string} hub 
     */
    async newInstanceFromHub(type, hub) {
        const name = this.getConfigFromHub(type, hub)?.name;
        if (!name) {
            return null;
        }
        const instance = await this.newInstanceFromName(name);
        assert(!(instance instanceof MongoService));
        assert(!(instance instanceof RedisService));
        assert(!(instance instanceof IpfsService));
        assert(!(instance instanceof DockerService));
        return instance;
    }

    /**
     * @param {string} host 
     */
    async newInstanceFromHost(host) {
        const name = this.configNameFromHost(host);
        if (isNullishOrEmptyString(name)) {
            throw new CodeError(`Unkown service host='${host}'`);
        }
        assert(name);
        return this.newInstanceFromName(name);
    }

    /**
     * @param {string} hub 
     */
    async newMarketInstanceFromHub(hub) {
        const conf = this.getMarketConfigFromHubAlias(hub)?.resolved;
        return (conf) ? Market.newInstance(conf, this) : null;
    }

    /**
     * @param {string} hubAlias 
     */
    async newGanacheInstanceFromHubAlias(hubAlias) {
        const conf = this.getGanacheConfigFromHubAlias(hubAlias)?.resolved;
        return (conf) ? GanachePoCoService.newInstance(conf) : null;
    }

    /**
     * @param {string} name - config name
     */
    async newGanacheInstance(name) {
        const conf = this.getGanacheConfig(name)?.resolved;
        return (conf) ? GanachePoCoService.newInstance(conf) : null;
    }

    async newIpfsInstance() {
        const conf = this.getIpfsConfig().resolved;
        return (conf) ? IpfsService.newInstance(conf) : null;
    }

    /**
     * @param {types.IpfsConfig} config 
     */
    async addIpfs(config) {
        if (!config) {
            throw new TypeError(`Missing ipfs config argument`);
        }
        assert(config.type === 'ipfs');
        const host = (config.hostname ?? 'localhost') + ':' + config.apiPort.toString();

        return this.#resolveAndAddConfig('ipfs', host, config, true);
    }

    /**
     * @param {srvTypes.DockerConfig} config 
     */
    async addDocker(config) {
        if (!config) {
            throw new TypeError(`Missing docker config argument`);
        }
        assert(config.type === 'docker');
        const host = (config.hostname ?? 'localhost') + ':' + config.port.toString();

        return this.#resolveAndAddConfig('docker', host, config, true);
    }

    /**
     * @param {object} args 
     * @param {string=} args.name 
     * @param {pocoTypes.GanachePoCoServiceConfig} args.config 
     */
    async addGanache({ name, config }) {
        if (!config) {
            throw new TypeError(`Missing ipfs config argument`);
        }

        assert(config.type === 'ganache');
        const host = (config.hostname ?? 'localhost') + ':' + config.port.toString();

        if (!name) {
            name = defaultChainServiceName('ganache', config.config.chainid);
        }

        const chainidStr = config.config.chainid.toString();
        const seq = config.config.deploySequence;
        seq.forEach((dConf) => {
            const hubAlias = chainidStr + '.' + dConf.name;
            if (this.#hubAliasToHubData.has(hubAlias)) {
                throw new TypeError(`Duplicate hub ${hubAlias}`);
            }
            assert(name);
            dConf.asset
            this.#hubAliasToHubData.set(hubAlias, {
                ganache: name,
                chainid: config.config.chainid,
                native: (dConf.asset === 'Native'),
                flavour: (dConf.asset === 'Token' && dConf.kyc === true) ? 'enterprise' : 'standard'
            });
        });

        return this.#resolveAndAddConfig(name, host, config, true);
    }

    /**
     * @param {object} args 
     * @param {string=} args.name 
     * @param {srvTypes.MongoConfig} args.config 
     */
    async addMongo({ name, config }) {
        return this.#addDB({ name, config });
    }

    /**
     * @param {object} args 
     * @param {string=} args.name 
     * @param {srvTypes.RedisConfig} args.config 
     */
    async addRedis({ name, config }) {
        return this.#addDB({ name, config });
    }

    /**
     * @param {object} args 
     * @param {string=} args.name 
     * @param {srvTypes.MongoConfig | srvTypes.RedisConfig} args.config 
     * @param {string=} args.parentName 
     */
    async #addDB({ name, config, parentName }) {
        if (name) {
            if (!stringIsPOSIXPortable(name)) {
                throw new TypeError(`Invalid name='${name}', only POSIX portable characters are allowed`);
            }
        }

        if (!config) {
            throw new TypeError(`Missing config argument`);
        }

        assert(config.type === 'mongo' || config.type === 'redis');
        const host = (config.hostname ?? 'localhost') + ':' + config.port.toString();

        let shared = true;
        if (parentName) {
            shared = false;
            if (!this.#nameToConfig.has(parentName)) {
                throw new CodeError(`Unknown parent name ${parentName}`);
            }
            // only mongo db supports parent.
            const parentConfig = this.getConfig(parentName).resolved;
            assert(parentConfig);
            if (config.type !== 'mongo' || (
                parentConfig.type !== 'blockchainadapter' &&
                parentConfig.type !== 'core' &&
                parentConfig.type !== 'resultproxy'
            )) {
                throw new CodeError(`Invalid parent name '${parentName}'`);
            }
            if (parentConfig.mongoHost !== host) {
                throw new CodeError(`Invalid parent name '${parentName}'`);
            }
        }

        if (!name) {
            if (parentName) {
                name = config.type + '.' + parentName;
            } else {
                // quick and dirty loop to determine the shared index
                let i = 0;
                while (true) {
                    name = config.type + '.shared.' + i;
                    if (!this.#nameToConfig.has(name)) {
                        break;
                    }
                    i++;
                }
            }
        }

        return this.#resolveAndAddConfig(name, host, config, shared);
    }

    /**
     * @param {object} args 
     * @param {string=} args.name 
     * @param {srvTypes.MarketConfig} args.config 
     * @param {srvTypes.MongoConfig=} args.mongoConfig 
     * @param {srvTypes.RedisConfig=} args.redisConfig 
     */
    async addMarket({ name, config, mongoConfig, redisConfig }) {
        if (!name) {
            // quick and dirty loop to determine the shared index
            let i = 0;
            while (true) {
                name = config.type + '.' + i;
                if (!this.#nameToConfig.has(name)) {
                    break;
                }
                i++;
            }
        }

        const host = (config.api.hostname ?? 'localhost') + ':' + config.api.port.toString();
        name = await this.#resolveAndAddConfig(name, host, config, true);

        if (mongoConfig) {
            await this.#addDB({ config: mongoConfig, parentName: name });
        }
        if (redisConfig) {
            await this.#addDB({ config: redisConfig, parentName: name });
        }

        // Link market to hub 
        const chains = config.api.chains;
        for (let i = 0; i < chains.length; ++i) {
            let hub;
            const c = chains[i];
            if (c instanceof PoCoHubRef) {
                assert(c.hasDeployConfigName);
                hub = c.chainid.toString() + '.' + c.deployConfigName;
            } else {
                throwIfNullishOrEmptyString(c);
                hub = c;
            }
            const hubData = this.#hubAliasToHubData.get(hub);
            if (hubData) {
                assert(!hubData.market);
                hubData.market = name;
            }
        }
        return name;
    }

    /**
     * @param {object} args 
     * @param {string=} args.name 
     * @param {srvTypes.SmsConfig} args.config 
     */
    async addSms({ name, config }) {
        return this.#addHubService({ name, config });
    }

    /**
     * @param {object} args 
     * @param {string=} args.name 
     * @param {srvTypes.ResultProxyConfig} args.config 
     * @param {srvTypes.MongoConfig=} args.mongoConfig 
     */
    async addResultProxy({ name, config, mongoConfig }) {
        if (isNullishOrEmptyString(config.ipfsHost)) {
            throw new CodeError('Missing ipfs host');
        }

        assert(config.ipfsHost);

        const ipfsName = this.configNameFromHost(config.ipfsHost);

        if (!ipfsName) {
            throw new CodeError('Missing ipfs host');
        }

        return this.#addHubService({ name, config, mongoConfig });
    }

    /**
     * @param {object} args 
     * @param {string=} args.name 
     * @param {srvTypes.BlockchainAdapterConfig} args.config 
     * @param {srvTypes.MongoConfig=} args.mongoConfig 
     */
    async addBlockchainAdapter({ name, config, mongoConfig }) {
        assert(config.marketApiUrl);
        assert(config.marketApiUrl.startsWith('http'));

        const marketName = this.configNameFromHost(config.marketApiUrl);

        if (!marketName) {
            throw new CodeError('Missing market api host');
        }

        return this.#addHubService({ name, config, mongoConfig });
    }

    /**
     * @param {object} args 
     * @param {string=} args.name 
     * @param {srvTypes.CoreConfig} args.config 
     * @param {srvTypes.MongoConfig=} args.mongoConfig 
     */
    async addCore({ name, config, mongoConfig }) {
        if (isNullishOrEmptyString(config.blockchainAdapterUrl)) {
            throw new CodeError('Missing blockchain adapter url');
        }
        if (isNullishOrEmptyString(config.smsUrl)) {
            throw new CodeError('Missing sms url');
        }
        if (isNullishOrEmptyString(config.resultProxyUrl)) {
            throw new CodeError('Missing result proxy url');
        }
        if (isNullishOrEmptyString(config.ipfsHost)) {
            throw new CodeError('Missing ipfs host');
        }

        assert(config.ipfsHost);
        assert(config.smsUrl);
        assert(config.resultProxyUrl);
        assert(config.blockchainAdapterUrl);

        const ipfsName = this.configNameFromHost(config.ipfsHost);
        const resultProxyName = this.configNameFromHost(config.resultProxyUrl);
        const blockchainAdapterName = this.configNameFromHost(config.blockchainAdapterUrl);
        const smsName = this.configNameFromHost(config.smsUrl);

        if (!ipfsName) {
            throw new CodeError('Missing ipfs host');
        }
        if (!blockchainAdapterName) {
            throw new CodeError('Missing blockchain adapter url');
        }
        if (!smsName) {
            throw new CodeError('Missing sms url');
        }
        if (!resultProxyName) {
            throw new CodeError('Missing result proxy url');
        }

        return this.#addHubService({ name, config, mongoConfig });
    }

    /**
     * @param {object} workers 
     * @param {string} workers.hub 
     * @param {string | types.Package} workers.repository 
     * @param {string} workers.directory 
     * @param {{ from: number, to: number, size: number }} workers.portRange 
     */
    async addWorkers(workers) {
        if (isNullishOrEmptyString(workers.hub)) {
            throw new CodeError(`Invalid workers hub`);
        }
        if (!workers.repository) {
            throw new CodeError(`Invalid workers repository`);
        }
        if (isNullishOrEmptyString(workers.directory)) {
            throw new CodeError(`Invalid workers directory`);
        }

        throwIfNotStrictlyPositiveInteger(workers.portRange.from);
        throwIfNotStrictlyPositiveInteger(workers.portRange.to);
        throwIfNotStrictlyPositiveInteger(workers.portRange.size);

        const unsolvedPkg = toPackage(workers.repository, WorkerService.defaultGitUrl);
        const resolvedPkg = deepCopyPackage(unsolvedPkg);
        assert(typeof resolvedPkg !== 'string'); //compiler

        // Downloads the latest git repo version if needed
        const gitHubRepo = await WorkerService.getGitHubRepo(resolvedPkg);
        placeholdersPropertyReplace(
            resolvedPkg,
            'directory',
            {
                "${version}": gitHubRepo.commitish,
                "${repoName}": gitHubRepo.gitHubRepoName
            }
        );

        const hubData = this.#hubAliasToHubData.get(workers.hub);
        if (!hubData) {
            throw new CodeError(`Unknown workers hub=${workers.hub}`);
        }
        hubData.workers = {
            directory: workers.directory,
            portRange: { ...workers.portRange }
        }
        this.#workersRepository = { unsolved: unsolvedPkg, resolved: resolvedPkg };
    }

    /* ------------------------ iexec-sdk ----------------------------------- */

    /** @type {srvTypes.InventoryIExecSdkConfig=} */
    #iexecsdkConfig;
    /** @type {string} */
    static #iexecsdkLatestVersion;
    static async iexecSdkLatestVersion() {
        if (!InventoryDB.#iexecsdkLatestVersion) {
            InventoryDB.#iexecsdkLatestVersion = await getLatestVersion(this.iexecSdkDefaultGitUrl);
        }
        return InventoryDB.#iexecsdkLatestVersion;
    }
    static get iexecSdkDefaultGitUrl() {
        return 'https://github.com/iExecBlockchainComputing/iexec-sdk.git';
    }
    static get iexecSdkGitHubRepoName() {
        return 'iexec-sdk';
    }

    /**
     * @param {object} args 
     * @param {srvTypes.IExecSdkConfig} args.config 
     */
    async addIExecSdk({ config }) {
        assert(config);
        assert(config.chainsJsonLocation);
        assert(config.repository);
        assert(config.type === 'iexecsdk');

        const type = config.type;

        const unsolvedPkg = toPackage(config.repository, InventoryDB.iexecSdkDefaultGitUrl);
        if (!unsolvedPkg.gitHubRepoName) {
            unsolvedPkg.gitHubRepoName = InventoryDB.iexecSdkGitHubRepoName;
        }
        if (!unsolvedPkg.cloneRepo) {
            unsolvedPkg.cloneRepo = InventoryDB.iexecSdkDefaultGitUrl;
        }
        if (!unsolvedPkg.clone) {
            unsolvedPkg.clone = 'ifmissing';
        }
        const resolvedPkg = deepCopyPackage(unsolvedPkg);
        assert(typeof resolvedPkg !== 'string');

        // Downloads the latest git repo version if needed
        const gitHubRepo = await getGitHubRepo(
            resolvedPkg,
            InventoryDB.iexecSdkDefaultGitUrl,
            InventoryDB.iexecSdkGitHubRepoName);

        placeholdersPropertyReplace(
            resolvedPkg,
            'directory',
            {
                "${version}": gitHubRepo.commitish,
                "${repoName}": gitHubRepo.gitHubRepoName
            }
        );

        this.#iexecsdkConfig = {
            type,
            unsolved: { type, repository: unsolvedPkg, chainsJsonLocation: config.chainsJsonLocation },
            resolved: { type, repository: resolvedPkg, chainsJsonLocation: config.chainsJsonLocation },
        }
    }

    getIExecSdkConfig() {
        return this.#iexecsdkConfig;
    }

    /* ---------------------- tee-worker-pre-compute ------------------------ */
    
    /** @type {srvTypes.InventoryTeeWorkerPreComputeConfig=} */
    #teeworkerprecomputeConfig;
    /** @type {string} */
    static #teeworkerprecomputeLatestVersion;
    static async teeWorkerPreComputeLatestVersion() {
        if (!InventoryDB.#teeworkerprecomputeLatestVersion) {
            InventoryDB.#teeworkerprecomputeLatestVersion = await getLatestVersion(this.teeWorkerPreComputeDefaultGitUrl);
        }
        return InventoryDB.#teeworkerprecomputeLatestVersion;
    }
    static get teeWorkerPreComputeDefaultGitUrl() {
        return 'https://github.com/iExecBlockchainComputing/tee-worker-pre-compute.git';
    }
    static get teeWorkerPreComputeGitHubRepoName() {
        return 'tee-worker-pre-compute';
    }

    /**
     * @param {object} args 
     * @param {srvTypes.TeeWorkerPreComputeConfig} args.config 
     */
    async addTeeWorkerPreCompute({ config }) {
        assert(config);
        assert(config.repository);
        assert(config.type === 'teeworkerprecompute');

        const type = config.type;

        const unsolvedPkg = toPackage(config.repository, InventoryDB.teeWorkerPreComputeDefaultGitUrl);
        if (!unsolvedPkg.gitHubRepoName) {
            unsolvedPkg.gitHubRepoName = InventoryDB.teeWorkerPreComputeGitHubRepoName;
        }
        if (!unsolvedPkg.cloneRepo) {
            unsolvedPkg.cloneRepo = InventoryDB.teeWorkerPreComputeDefaultGitUrl;
        }
        if (!unsolvedPkg.clone) {
            unsolvedPkg.clone = 'ifmissing';
        }
        const resolvedPkg = deepCopyPackage(unsolvedPkg);
        assert(typeof resolvedPkg !== 'string');

        // Downloads the latest git repo version if needed
        const gitHubRepo = await getGitHubRepo(
            resolvedPkg,
            InventoryDB.teeWorkerPreComputeDefaultGitUrl,
            InventoryDB.teeWorkerPreComputeGitHubRepoName);

        placeholdersPropertyReplace(
            resolvedPkg,
            'directory',
            {
                "${version}": gitHubRepo.commitish,
                "${repoName}": gitHubRepo.gitHubRepoName
            }
        );

        this.#teeworkerprecomputeConfig = {
            type,
            unsolved: { type, repository: unsolvedPkg },
            resolved: { type, repository: resolvedPkg },
        }
    }

    getTeeWorkerPreComputeConfig() {
        return this.#teeworkerprecomputeConfig;
    }

    /* ---------------------- tee-worker-post-compute ----------------------- */
    
    /** @type {srvTypes.InventoryTeeWorkerPostComputeConfig=} */
    #teeworkerpostcomputeConfig;
    /** @type {string} */
    static #teeworkerpostcomputeLatestVersion;
    static async teeWorkerPostComputeLatestVersion() {
        if (!InventoryDB.#teeworkerpostcomputeLatestVersion) {
            InventoryDB.#teeworkerpostcomputeLatestVersion = await getLatestVersion(this.teeWorkerPostComputeDefaultGitUrl);
        }
        return InventoryDB.#teeworkerpostcomputeLatestVersion;
    }
    static get teeWorkerPostComputeDefaultGitUrl() {
        return 'https://github.com/iExecBlockchainComputing/tee-worker-post-compute.git';
    }
    static get teeWorkerPostComputeGitHubRepoName() {
        return 'tee-worker-post-compute';
    }

    /**
     * @param {object} args 
     * @param {srvTypes.TeeWorkerPostComputeConfig} args.config 
     */
    async addTeeWorkerPostCompute({ config }) {
        assert(config);
        assert(config.repository);
        assert(config.type === 'teeworkerpostcompute');

        const type = config.type;

        const unsolvedPkg = toPackage(config.repository, InventoryDB.teeWorkerPostComputeDefaultGitUrl);
        if (!unsolvedPkg.gitHubRepoName) {
            unsolvedPkg.gitHubRepoName = InventoryDB.teeWorkerPostComputeGitHubRepoName;
        }
        if (!unsolvedPkg.cloneRepo) {
            unsolvedPkg.cloneRepo = InventoryDB.teeWorkerPostComputeDefaultGitUrl;
        }
        if (!unsolvedPkg.clone) {
            unsolvedPkg.clone = 'ifmissing';
        }
        const resolvedPkg = deepCopyPackage(unsolvedPkg);
        assert(typeof resolvedPkg !== 'string');

        // Downloads the latest git repo version if needed
        const gitHubRepo = await getGitHubRepo(
            resolvedPkg,
            InventoryDB.teeWorkerPostComputeDefaultGitUrl,
            InventoryDB.teeWorkerPostComputeGitHubRepoName);

        placeholdersPropertyReplace(
            resolvedPkg,
            'directory',
            {
                "${version}": gitHubRepo.commitish,
                "${repoName}": gitHubRepo.gitHubRepoName
            }
        );

        this.#teeworkerpostcomputeConfig = {
            type,
            unsolved: { type, repository: unsolvedPkg },
            resolved: { type, repository: resolvedPkg },
        }
    }

    getTeeWorkerPostComputeConfig() {
        return this.#teeworkerpostcomputeConfig;
    }

    /**
     * @param {object} args 
     * @param {string=} args.name 
     * @param {srvTypes.SmsConfig | 
     *      srvTypes.ResultProxyConfig | 
     *      srvTypes.CoreConfig | 
     *      srvTypes.BlockchainAdapterConfig } args.config 
     * @param {srvTypes.MongoConfig=} args.mongoConfig 
     */
    async #addHubService({ name, config, mongoConfig }) {
        if (!config) {
            throw new TypeError(`Missing config argument`);
        }
        assert(
            config.type === 'sms' ||
            config.type === 'resultproxy' ||
            config.type === 'blockchainadapter' ||
            config.type === 'core'
        );

        if (!this.#hubAliasToHubData.has(config.hub)) {
            throw new TypeError(`Unknown hub=${config.hub}, add the corresponding ganache service first.`);
        }

        const hubRef = InventoryDB.#toPoCoHubRef(config.hub);

        if (!name) {
            assert(hubRef.deployConfigName);
            name = defaultHubServiceName(config.type, hubRef.chainid, hubRef.deployConfigName);
        } else {
            if (!stringIsPOSIXPortable(name)) {
                throw new TypeError(`Invalid name='${name}', only POSIX portable characters are allowed`);
            }
        }

        const host = (config.hostname ?? 'localhost') + ':' + config.port.toString();

        // Throws an exception if already added
        name = await this.#resolveAndAddConfig(name, host, config, false);

        const hubData = this.#hubAliasToHubData.get(config.hub);
        assert(hubData);
        assert(!hubData[config.type]);
        hubData[config.type] = name;

        if (mongoConfig) {
            assert(config.type !== 'sms');
            await this.#addDB({ config: mongoConfig, parentName: name });
        }

        if (config.type !== 'sms') {
            const mongoHost = this.#mongoHostFromConfigName(name);
            assert(mongoHost);
            assert(this.#hostToName.has(mongoHost));
        }

        return name;
    }

    /**
     * @param {string} name 
     */
    #mongoHostFromConfigName(name) {
        const ic = this.getConfig(name);
        if (!ic) {
            return null;
        }
        const conf = ic.resolved;
        if (conf.type === 'ipfs' ||
            conf.type === 'docker' ||
            conf.type === 'ganache' ||
            conf.type === 'redis' ||
            conf.type === 'sms') {
            return null;
        }
        if (conf.type === 'mongo') {
            return (conf.hostname ?? 'localhost') + ':' + conf.toString();
        }
        if (conf.type === 'market') {
            return (conf.mongo.hostname ?? 'localhost') + ':' + conf.mongo.port.toString();
        }
        return conf.mongoHost;
    }

    /**
     * @param {string} name 
     * @param {string} hub 
     */
    addChain(name, hub) {
        throwIfNullishOrEmptyString(name);
        throwIfNullishOrEmptyString(hub);
        if (!this.#hubAliasToHubData.has(hub)) {
            throw new CodeError(`Unknown hub ${hub}`);
        }
        if (this.#allChains.has(name)) {
            throw new CodeError(`Chain ${name} already exists`);
        }
        this.#allChains.set(name, {
            hubAlias: hub,
            bridgedChainName: null,
            enterpriseSwapChainName: null
        });
    }

    getChains() {
        /** @type {{name: string, chain:Chain}[]} */
        const arr = [];
        this.#allChains.forEach((chain, name) => {
            arr.push({ name, chain: { ...chain } });
        });
        return arr;
    }

    /**
     * - `token.contract` is deployed on `token.chain` (see: `ForeignBridgeErcToNative.sol`)
     * - `native.contract` is deployed on `native.chain` (see: `HomeBridgeErcToNative.sol`)
     * - on token.chain, token.contract is a `ForeignBridgeErcToNative.sol`
     * - see: https://github.com/omni/tokenbridge-contracts/blob/master/contracts/upgradeable_contracts/erc20_to_native/ForeignBridgeErcToNative.sol
     * - on native.chain, native.contract is a `HomeBridgeErcToNative.sol`
     * - see: https://github.com/omni/tokenbridge-contracts/blob/master/contracts/upgradeable_contracts/erc20_to_native/HomeBridgeErcToNative.sol
     * - see: Omni bridge contracts : https://github.com/omni/tokenbridge-contracts
     * @param {{chain:string, contract:string}} token
     * @param {{chain:string, contract:string}} native
     */
    bridgeChains(token, native) {
        throwIfNullishOrEmptyString(token.chain);
        throwIfNullishOrEmptyString(native.chain);

        // `ForeignBridgeErcToNative.sol`
        token.contract = toChecksumAddress(token.contract);
        // `HomeBridgeErcToNative.sol`
        native.contract = toChecksumAddress(native.contract);

        if (!this.#allChains.has(token.chain)) {
            throw new CodeError(`Chain ${token.chain} does not exist`);
        }
        if (!this.#allChains.has(native.chain)) {
            throw new CodeError(`Chain ${native.chain} does not exist`);
        }

        const c1 = this.#allChains.get(token.chain);
        assert(c1);
        const c2 = this.#allChains.get(native.chain);
        assert(c2);

        c1.bridgedChainName = native.chain;
        c2.bridgedChainName = token.chain;
    }

    #initDefaultEnterpriseSwap() {
        /** @type {Map<number, {id:number, standard?:string, enterprise?:string}>} */
        const allChainIds = new Map();
        // [ {id:<chainid>, standard:<enterprise chain name>, enterprise:<enterprise chain name>} ]
        const chainNames = [...this.#allChains.keys()];
        for (let i = 0; i < chainNames.length; ++i) {
            const chainName = chainNames[i];
            const chain = this.#allChains.get(chainName);
            assert(chain);
            const hubData = this.#hubAliasToHubData.get(chain.hubAlias);
            assert(hubData);
            if (hubData.native) {
                continue;
            }
            let info = allChainIds.get(hubData.chainid);
            if (!info) {
                info = { id: hubData.chainid };
                allChainIds.set(hubData.chainid, info);
            }
            if (hubData.flavour === 'enterprise') {
                if (!info.enterprise) {
                    info.enterprise = chainName;
                }
            } else {
                if (!info.standard) {
                    info.standard = chainName;
                }
            }
        }

        allChainIds.forEach((v) => {
            if (v.standard && v.enterprise) {
                this.enterpriseSwapChains(v.standard, v.enterprise);
            }
        });
    }

    /**
     * @param {string} chain1 
     * @param {string} chain2 
     */
    enterpriseSwapChains(chain1, chain2) {
        throwIfNullishOrEmptyString(chain1);
        throwIfNullishOrEmptyString(chain2);

        if (!this.#allChains.has(chain1)) {
            throw new CodeError(`Chain ${chain1} does not exist`);
        }
        if (!this.#allChains.has(chain2)) {
            throw new CodeError(`Chain ${chain2} does not exist`);
        }

        const c1 = this.#allChains.get(chain1);
        assert(c1);
        const c2 = this.#allChains.get(chain2);
        assert(c2);

        const hubData1 = this.#hubAliasToHubData.get(c1.hubAlias);
        if (!hubData1) {
            throw new CodeError(`Hub alias ${c1.hubAlias} does not exist`);
        }
        const hubData2 = this.#hubAliasToHubData.get(c2.hubAlias);
        if (!hubData2) {
            throw new CodeError(`Hub alias ${c2.hubAlias} does not exist`);
        }

        if (hubData1.native) {
            throw new CodeError(`Invalid chain ${chain1}, native chains are not allowed`);
        }
        if (hubData2.native) {
            throw new CodeError(`Invalid chain ${chain2}, native chains are not allowed`);
        }

        if ((hubData1.flavour === 'standard' && hubData2.flavour === 'enterprise') ||
            (hubData1.flavour === 'enterprise' && hubData2.flavour === 'standard')) {
            c1.enterpriseSwapChainName = chain2;
            c2.enterpriseSwapChainName = chain1;
            return;
        }

        throw new CodeError(`Invalid chains '${chain1}' and '${chain2}'`);
    }

    /**
     * @param {'ganache' | 'sms' | 'blockchainadapter' | 'resultproxy' | 'core' | 'market'} type 
     * @param {string | PoCoHubRef} hubAliasOrHubRef 
     */
    getHubServiceURL(type, hubAliasOrHubRef) {
        const urlStr = this.getHubServiceUrl(type, hubAliasOrHubRef);
        return new URL(urlStr);
    }

    /**
     * @param {'ganache' | 'sms' | 'blockchainadapter' | 'resultproxy' | 'core' | 'market'} type 
     * @param {string | PoCoHubRef} hubAliasOrHubRef 
     */
    getHubServiceUrl(type, hubAliasOrHubRef) {
        const conf = this.getConfigFromHub(type, hubAliasOrHubRef)?.resolved;
        if (!conf) {
            throw new CodeError('Unknown hub alias or hub ref');
        }
        assert(conf.type === type);
        if (conf.type === 'market') {
            return "http://" + (conf.api.hostname ?? 'localhost') + ":" + conf.api.port.toString();
        }
        return "http://" + (conf.hostname ?? 'localhost') + ":" + conf.port.toString();
    }

    /**
     * @param {string} configName 
     */
    getHubServiceUrlFromConfigName(configName) {
        const conf = this.getConfig(configName)?.resolved;
        if (!conf) {
            throw new CodeError(`Unknown config name ${configName}`);
        }
        if (conf.type === 'ipfs' ||
            conf.type === 'docker' ||
            conf.type === 'mongo' ||
            conf.type === 'redis') {
            return;
        }
        if (conf.type === 'market') {
            return "http://" + (conf.api.hostname ?? 'localhost') + ":" + conf.api.port.toString();
        }
        return "http://" + (conf.hostname ?? 'localhost') + ":" + conf.port.toString();
    }

    /**
     * @param {string} hubAlias 
     */
    #getIpfsUrl(hubAlias) {
        const ipfsConf = this.getIpfsConfig()?.resolved;
        assert(ipfsConf);
        return "http://" + (ipfsConf.hostname ?? 'localhost') + ":" + ipfsConf.apiPort.toString();
    }

    /**
     * @param {string=} defaultChainName 
     */
    async getChainsJSON(defaultChainName) {
        if (defaultChainName) {
            if (!this.#allChains.has(defaultChainName)) {
                throw new CodeError(`Unknown chain name ${defaultChainName}`);
            }
        }

        this.#initDefaultEnterpriseSwap();

        /** 
         * @type {{ 
         *      default:string, 
         *      chains: any
         * }} 
         */
        const o = {
            default: defaultChainName ?? '',
            chains: {}
        };

        const names = Array.from(this.#allChains.keys());
        if (names.length === 0) {
            return o;
        }
        if (o.default === '') {
            o.default = names[0];
        }

        const promises = [];
        for (let i = 0; i < names.length; ++i) {
            const name = names[i];
            const p = this.getChain(name);
            promises.push(p);
        }
        const chains = await Promise.all(promises);
        assert(chains.length === names.length);
        for (let i = 0; i < chains.length; ++i) {
            o.chains[names[i]] = chains[i];
        }
        return o;
    }

    /**
     * @param {string} hubAlias 
     */
    hubAliasToChainName(hubAlias) {
        const chains = [...this.#allChains];
        for (let i = 0; i < chains.length; ++i) {
            const [chainName, chain] = chains[i];
            if (chain.hubAlias === hubAlias) {
                return chainName;
            }
        }
        return undefined;
    }

    /**
     * @param {string} name 
     */
    async getChain(name) {
        const chain = this.#allChains.get(name);
        if (!chain) {
            return null;
        }

        const hub = this.#hubAliasToHubData.get(chain.hubAlias);
        if (!hub) {
            return null;
        }

        const g = await this.newGanacheInstance(hub.ganache);
        assert(g);
        return this.#resolveChain(chain, g);
    }

    /**
     * @param {Chain} chain 
     * @param {GanachePoCoService} ganacheService 
     */
    #resolveChain(chain, ganacheService) {
        const ensRegistryRef = ganacheService.resolve(chain.hubAlias, 'ENSRegistry');
        assert(ensRegistryRef);

        const ensPublicResolverRef = ganacheService.resolve(chain.hubAlias, 'PublicResolver');
        assert(ensPublicResolverRef);

        const bridgeContract = NULL_ADDRESS;

        const hubRef = ganacheService.resolve(chain.hubAlias, 'ERC1538Proxy');
        assert(hubRef);
        assert(hubRef instanceof PoCoHubRef);

        const marketApiUrl = this.getMarketApiUrlFromHubAlias(chain.hubAlias);
        assert(marketApiUrl);

        /** @type {Object.<string, any>} */
        const o = {
            id: ganacheService.chainid.toString(),
            host: ganacheService.urlString,
            hub: hubRef.address,
            ensRegistry: ensRegistryRef.address,
            ensPublicResolver: ensPublicResolverRef.address,
            flavour: (hubRef.isEnterprise) ? 'enterprise' : 'standard',
            sms: this.getHubServiceUrl('sms', chain.hubAlias),
            resultProxy: this.getHubServiceUrl('resultproxy', chain.hubAlias),
            ipfsGateway: this.#getIpfsUrl(chain.hubAlias),
            iexecGateway: marketApiUrl,
            native: hubRef.isNative,
            useGas: true,
        }

        if (chain.enterpriseSwapChainName) {
            o.enterprise = { enterpriseSwapChainName: chain.enterpriseSwapChainName }
        }
        if (chain.bridgedChainName) {
            o.bridge = {
                bridgedChainName: chain.bridgedChainName,
                contract: bridgeContract
            }
            /** @todo bidgeContract are not yet been tested */
            assert(false, 'TODO bridgeContract');
        }

        return o;
    }

    /**
     * @param {string | PoCoHubRef} hub 
     * @param {number} index 
     */
    static computeWorkerName(hub, index) {
        assert(hub);
        const hubStr = (typeof hub === 'string') ? hub : hub.hubAlias();
        return 'worker.' + index.toString() + '.' + hubStr;
    }
}

/**
 * @param {InventoryDB} inventory 
 * @param {{name: string, config:{ type: srvTypes.SharedServiceType }}[][]} sortedConfigs
 */
export async function addSortedConfigsToInventory(inventory, sortedConfigs) {
    for (let i = 0; i < sortedConfigs.length; ++i) {
        //type index = i
        const services = sortedConfigs[i];
        if (!services) {
            continue;
        }
        for (let j = 0; j < services.length; ++j) {
            const service = services[j];
            if (service) {
                await addToInventory(inventory, service);
            }
        }
    }
}

/**
 * @param {InventoryDB} inventory 
 * @param {object} params 
 * @param {string} params.name 
 * @param {any} params.config 
 */
export async function addToInventory(inventory, { name, config }) {
    /** @type {srvTypes.NonWorkerServiceType} */
    const type = config.type;
    switch (type) {
        case 'ganache': { await inventory.addGanache({ name, config }); break; }
        case 'ipfs': { await inventory.addIpfs(config); break; }
        case 'docker': { await inventory.addDocker(config); break; }
        case 'mongo': { await inventory.addMongo({ name, config }); break; }
        case 'redis': { await inventory.addRedis({ name, config }); break; }
        case 'market': { await inventory.addMarket({ name, config }); break; }
        case 'sms': { await inventory.addSms({ name, config }); break; }
        case 'resultproxy': { await inventory.addResultProxy({ name, config }); break; }
        case 'blockchainadapter': { await inventory.addBlockchainAdapter({ name, config }); break; }
        case 'core': { await inventory.addCore({ name, config }); break; }
        default: {
            throw new CodeError(`Unknown service type ${type}`);
        }
    }
}
