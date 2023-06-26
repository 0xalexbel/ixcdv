import * as types from '../common/common-types.js';
import * as srvTypes from './services-types-internal.js';
import assert from 'assert';
import { ORDERED_SERVICE_TYPES, SERVICE_TYPE_INDICES } from './base-internal.js';
import { InventoryDB } from './InventoryDB.js';
import { PoCoHubRef } from '../common/contractref.js';
import { GanachePoCoService } from '../poco/GanachePoCoService.js';
import { isNullishOrEmptyString, stringToHostnamePort } from '../common/string.js';
import { CodeError } from '../common/error.js';

export class Dependencies {

    /** @type {(Map<string,{name:string, config:any}>|null)[]} */
    #typeIndexToNameConfigs;

    /** @type {Map<string,{name:string, hub:(string | PoCoHubRef), index:number, config:any}>} */
    #workerConfigs = new Map();

    /** @type {number} */
    #size

    constructor() {
        this.#typeIndexToNameConfigs = Array(ORDERED_SERVICE_TYPES.length).fill(null);
        this.#size = 0;
    }

    /**
     * @param {srvTypes.NonWorkerServiceType} type 
     */
    getConfigNamesArrayFromType(type) {
        //@ts-ignore
        assert(type != 'worker');
        const typeIndex = SERVICE_TYPE_INDICES[type];
        assert(typeIndex >= 0);
        const names = this.#typeIndexToNameConfigs[typeIndex];
        if (!names || names.size === 0) {
            return null;
        }
        return [...names.keys()];
    }

    /** @returns {Promise<Map<number, GanachePoCoService> | undefined>} */
    async chainids() {
        const index = SERVICE_TYPE_INDICES['ganache'];
        const confs = this.#typeIndexToNameConfigs[index];
        if (!confs || confs.size === 0) {
            return undefined;
        }

        const m = new Map();
        const arr = [...confs.values()];
        for (let i = 0; i < arr.length; ++i) {
            const g = await GanachePoCoService.newInstance(arr[i].config);
            m.set(g.chainid, g);
        }
        return m;
    }

    toArray() {
        /** @type {{name:string, config:any}[]} */
        const a = [];
        for (let i = 0; i < this.#typeIndexToNameConfigs.length; ++i) {
            const confs = this.#typeIndexToNameConfigs[i];
            if (!confs) {
                continue;
            }
            confs.forEach(o => a.push(o));
        }
        return a;
    }

    get size() { return this.#size }

    /**
     * @param {string} name 
     * @param {srvTypes.ServiceType} type 
     * @param {InventoryDB} inventory 
     */
    #addServiceName(name, type, inventory) {
        assert(this.#typeIndexToNameConfigs.length === ORDERED_SERVICE_TYPES.length);

        const config = inventory.getConfig(name).resolved;
        assert(config);
        assert(config.type);
        assert(config.type === type);

        const index = SERVICE_TYPE_INDICES[type];

        let map = this.#typeIndexToNameConfigs[index];
        if (!map) {
            map = new Map();
            this.#typeIndexToNameConfigs[index] = map;
        }
        const c = { name, config };
        if (!map.has(name)) {
            map.set(name, c);
            this.#size++;
        }
        
        return c;
    }

    /**
     * @param {string | PoCoHubRef | types.PoCoHubRefLike} hub 
     */
    static #hubToChainidDeployConfigName(hub) {
        let hubStr = '';
        if (typeof hub === 'string') {
            hubStr = hub;
        } else {
            assert(!isNullishOrEmptyString(hub.deployConfigName))
            hubStr = hub.chainid + "." + hub.deployConfigName;
        }
        return hubStr;
    }

    /**
     * @param {string | PoCoHubRef | types.PoCoHubRefLike} hub 
     * @param {InventoryDB} inventory 
     */
    #addIpfsFromHub(hub, inventory) {
        assert(this.#typeIndexToNameConfigs.length === ORDERED_SERVICE_TYPES.length);
        const type = 'ipfs';

        const hubStr = Dependencies.#hubToChainidDeployConfigName(hub);
        const ics = inventory.getConfigsByType(type);
        assert(ics);
        assert(ics.length === 1);
        assert(ics[0].resolved);
        assert(ics[0].resolved.type === type);

        this.#addServiceName(ics[0].name, type, inventory);
    }

    /**
     * @param {string} name
     * @param {InventoryDB} inventory 
     */
    #addIpfsFromName(name, inventory) {
        assert(this.#typeIndexToNameConfigs.length === ORDERED_SERVICE_TYPES.length);
        const type = 'ipfs';

        const ics = inventory.getConfigsByType(type);
        assert(ics);
        assert(ics.length === 1);
        assert(ics[0].resolved);
        assert(ics[0].resolved.type === type);
        assert(ics[0].name === name);

        this.#addServiceName(ics[0].name, type, inventory);
    }

    /**
     * @param {string | PoCoHubRef | types.PoCoHubRefLike} hub 
     * @param {InventoryDB} inventory 
     */
    #addDockerFromHub(hub, inventory) {
        assert(this.#typeIndexToNameConfigs.length === ORDERED_SERVICE_TYPES.length);
        const type = 'docker';

        const hubStr = Dependencies.#hubToChainidDeployConfigName(hub);
        const ics = inventory.getConfigsByType(type);
        assert(ics);
        assert(ics.length === 1);
        assert(ics[0].resolved);
        assert(ics[0].resolved.type === type);

        this.#addServiceName(ics[0].name, type, inventory);
    }

    /**
     * @param {string} name 
     * @param {InventoryDB} inventory 
     */
    #addDockerFromName(name, inventory) {
        assert(this.#typeIndexToNameConfigs.length === ORDERED_SERVICE_TYPES.length);
        const type = 'docker';

        const ics = inventory.getConfigsByType(type);
        assert(ics);
        assert(ics.length === 1);
        assert(ics[0].resolved);
        assert(ics[0].resolved.type === type);
        assert(ics[0].name === name);

        this.#addServiceName(ics[0].name, type, inventory);
    }

    /**
     * @param {string | PoCoHubRef | types.PoCoHubRefLike} hub 
     * @param {InventoryDB} inventory 
     */
    #addGanacheFromHub(hub, inventory) {
        assert(this.#typeIndexToNameConfigs.length === ORDERED_SERVICE_TYPES.length);
        const type = 'ganache';

        const hubStr = Dependencies.#hubToChainidDeployConfigName(hub);
        const ic = inventory.getConfigFromHub(type, hubStr);
        assert(ic);
        assert(ic.resolved);
        assert(ic.resolved.type === type);

        this.#addServiceName(ic.name, type, inventory);
    }

    /**
     * @param {string} name 
     * @param {InventoryDB} inventory 
     */
    #addGanacheFromName(name, inventory) {
        assert(this.#typeIndexToNameConfigs.length === ORDERED_SERVICE_TYPES.length);
        const type = 'ganache';

        const conf = inventory.getConfig(name).resolved;
        assert(conf);
        assert(conf.type === type);

        this.#addServiceName(name, type, inventory);
    }

    /**
     * @param {string | PoCoHubRef | types.PoCoHubRefLike} hub 
     * @param {InventoryDB} inventory 
     */
    #addMarketFromHub(hub, inventory) {
        assert(this.#typeIndexToNameConfigs.length === ORDERED_SERVICE_TYPES.length);
        const type = 'market';

        const hubStr = Dependencies.#hubToChainidDeployConfigName(hub);
        const ic = inventory.getConfigFromHub(type, hubStr);
        assert(ic);
        assert(ic.resolved);
        assert(ic.resolved.type === type);

        for (let i = 0; i < ic.resolved.api.chains.length; ++i) {
            const h = ic.resolved.api.chains[i];
            this.#addGanacheFromHub(h, inventory);
        }

        this.#addServiceName(ic.name, ic.type, inventory);
    }

    /**
     * @param {string} name 
     * @param {InventoryDB} inventory 
     */
    #addMarketFromName(name, inventory) {
        assert(this.#typeIndexToNameConfigs.length === ORDERED_SERVICE_TYPES.length);
        const type = 'market';

        const conf = inventory.getConfig(name).resolved;
        assert(conf);
        assert(conf.type === type);

        for (let i = 0; i < conf.api.chains.length; ++i) {
            const h = conf.api.chains[i];
            this.#addGanacheFromHub(h, inventory);
        }

        this.#addServiceName(name, conf.type, inventory);
    }

    /**
     * @param {string | PoCoHubRef | types.PoCoHubRefLike} hub 
     * @param {InventoryDB} inventory 
     */
    #addSmsFromHub(hub, inventory) {
        assert(this.#typeIndexToNameConfigs.length === ORDERED_SERVICE_TYPES.length);
        const type = 'sms';

        const hubStr = Dependencies.#hubToChainidDeployConfigName(hub);
        const ic = inventory.getConfigFromHub(type, hubStr);
        assert(ic);
        assert(ic.resolved);
        assert(ic.resolved.type === type);
        assert(ic.resolved.port);
        assert(ic.resolved.hub);

        this.#addIpfsFromHub(hub, inventory);
        this.#addGanacheFromHub(hub, inventory);
        this.#addServiceName(ic.name, ic.type, inventory);
    }

    /**
     * @param {string} name 
     * @param {InventoryDB} inventory 
     */
    #addSmsFromName(name, inventory) {
        assert(this.#typeIndexToNameConfigs.length === ORDERED_SERVICE_TYPES.length);
        const type = 'sms';

        const conf = inventory.getConfig(name).resolved;
        assert(conf);
        assert(conf.type === type);
        assert(conf.hub);

        const hubStr = Dependencies.#hubToChainidDeployConfigName(conf.hub);

        this.#addIpfsFromHub(hubStr, inventory);
        this.#addGanacheFromHub(hubStr, inventory);
        this.#addServiceName(name, conf.type, inventory);
    }

    /**
     * @param {string | PoCoHubRef | types.PoCoHubRefLike} hub 
     * @param {InventoryDB} inventory 
     */
    #addResultProxyFromHub(hub, inventory) {
        assert(this.#typeIndexToNameConfigs.length === ORDERED_SERVICE_TYPES.length);
        const type = 'resultproxy';

        const hubStr = Dependencies.#hubToChainidDeployConfigName(hub);
        const ic = inventory.getConfigFromHub(type, hubStr);
        assert(ic);
        assert(ic.resolved);
        assert(ic.resolved.type === type);
        assert(ic.resolved.port);
        assert(ic.resolved.hub);
        assert(ic.resolved.mongoHost);

        const { hostname: mongoHostname, port: mongoPort } = stringToHostnamePort(ic.resolved.mongoHost);
        assert(mongoPort);
        assert(mongoHostname);

        const mongoName = inventory.configNameFromHost(mongoHostname + ":" + mongoPort.toString());
        assert(mongoName);

        this.#addIpfsFromHub(hub, inventory);
        this.#addGanacheFromHub(hub, inventory);
        this.#addServiceName(mongoName, 'mongo', inventory);
        this.#addServiceName(ic.name, ic.type, inventory);
    }

    /**
     * @param {string} name 
     * @param {InventoryDB} inventory 
     */
    #addResultProxyFromName(name, inventory) {
        assert(this.#typeIndexToNameConfigs.length === ORDERED_SERVICE_TYPES.length);
        const type = 'resultproxy';

        const conf = inventory.getConfig(name).resolved;
        assert(conf);
        assert(conf.type === type);
        assert(conf.port);
        assert(conf.hub);
        assert(conf.mongoHost);

        const { hostname: mongoHostname, port: mongoPort } = stringToHostnamePort(conf.mongoHost);
        assert(mongoPort);
        assert(mongoHostname);

        const mongoName = inventory.configNameFromHost(mongoHostname + ":" + mongoPort.toString());
        assert(mongoName);

        this.#addIpfsFromHub(conf.hub, inventory);
        this.#addGanacheFromHub(conf.hub, inventory);
        this.#addServiceName(mongoName, 'mongo', inventory);
        this.#addServiceName(name, conf.type, inventory);
    }

    /**
     * @param {string | PoCoHubRef | types.PoCoHubRefLike} hub 
     * @param {InventoryDB} inventory 
     */
    #addBlockchainAdapterFromHub(hub, inventory) {
        assert(this.#typeIndexToNameConfigs.length === ORDERED_SERVICE_TYPES.length);
        const type = 'blockchainadapter';

        const hubStr = Dependencies.#hubToChainidDeployConfigName(hub);
        const ic = inventory.getConfigFromHub(type, hubStr);
        assert(ic);
        assert(ic.resolved);
        assert(ic.resolved.type === type);
        assert(ic.resolved.port);
        assert(ic.resolved.hub);
        assert(ic.resolved.mongoHost);

        const { hostname: mongoHostname, port: mongoPort } = stringToHostnamePort(ic.resolved.mongoHost);
        assert(mongoPort);
        assert(mongoHostname);

        const mongoName = inventory.configNameFromHost(mongoHostname + ":" + mongoPort.toString());
        assert(mongoName);

        const marketApiURL = new URL(ic.resolved.marketApiUrl);

        const marketName = inventory.configNameFromHost(marketApiURL.host);
        assert(marketName);

        this.#addGanacheFromHub(hub, inventory);
        this.#addMarketFromName(marketName, inventory);
        this.#addServiceName(mongoName, 'mongo', inventory);
        this.#addServiceName(ic.name, ic.type, inventory);
    }

    /**
     * @param {string} name 
     * @param {InventoryDB} inventory 
     */
    #addBlockchainAdapterFromName(name, inventory) {
        assert(this.#typeIndexToNameConfigs.length === ORDERED_SERVICE_TYPES.length);
        const type = 'blockchainadapter';

        const conf = inventory.getConfig(name).resolved;
        assert(conf);
        assert(conf.type === type);
        assert(conf.port);
        assert(conf.hub);
        assert(conf.mongoHost);
        assert(conf.marketApiUrl);

        const { hostname: mongoHostname, port: mongoPort } = stringToHostnamePort(conf.mongoHost);
        assert(mongoPort);
        assert(mongoHostname);

        const mongoName = inventory.configNameFromHost(mongoHostname + ":" + mongoPort.toString());
        assert(mongoName);

        const marketApiURL = new URL(conf.marketApiUrl);

        const marketName = inventory.configNameFromHost(marketApiURL.host);
        assert(marketName);

        this.#addGanacheFromHub(conf.hub, inventory);
        this.#addMarketFromName(marketName, inventory);
        this.#addServiceName(mongoName, 'mongo', inventory);
        this.#addServiceName(name, conf.type, inventory);
    }

    /**
     * @param {string | PoCoHubRef | types.PoCoHubRefLike} hub 
     * @param {InventoryDB} inventory 
     */
    #addCoreFromHub(hub, inventory) {
        assert(this.#typeIndexToNameConfigs.length === ORDERED_SERVICE_TYPES.length);
        const type = 'core';

        const hubStr = Dependencies.#hubToChainidDeployConfigName(hub);
        const ic = inventory.getConfigFromHub(type, hubStr);
        assert(ic);
        assert(ic.resolved);
        assert(ic.resolved.type === type);
        assert(ic.resolved.port);
        assert(ic.resolved.hub);
        assert(ic.resolved.mongoHost);
        assert(ic.resolved.smsUrl);
        assert(ic.resolved.resultProxyUrl);
        assert(ic.resolved.blockchainAdapterUrl);

        const { hostname: mongoHostname, port: mongoPort } = stringToHostnamePort(ic.resolved.mongoHost);
        assert(mongoPort);
        assert(mongoHostname);

        const smsURL = new URL(ic.resolved.smsUrl);
        const resultProxyURL = new URL(ic.resolved.resultProxyUrl);
        const blockchainAdapterURL = new URL(ic.resolved.blockchainAdapterUrl);

        const mongoName = inventory.configNameFromHost(mongoHostname + ":" + mongoPort.toString());
        assert(mongoName);

        const smsName = inventory.configNameFromHost(smsURL.host);
        assert(smsName);

        const resultProxyName = inventory.configNameFromHost(resultProxyURL.host);
        assert(resultProxyName);

        const blockchainAdapterName = inventory.configNameFromHost(blockchainAdapterURL.host);
        assert(blockchainAdapterName);

        this.#addGanacheFromHub(hub, inventory);
        this.#addSmsFromName(smsName, inventory);
        this.#addResultProxyFromName(resultProxyName, inventory);
        this.#addBlockchainAdapterFromName(blockchainAdapterName, inventory);
        this.#addServiceName(mongoName, 'mongo', inventory);
        this.#addServiceName(ic.name, ic.type, inventory);
    }

    /**
     * @param {string} name 
     * @param {InventoryDB} inventory 
     */
    #addCoreFromName(name, inventory) {
        assert(this.#typeIndexToNameConfigs.length === ORDERED_SERVICE_TYPES.length);
        const type = 'core';

        const conf = inventory.getConfig(name).resolved;
        assert(conf);
        assert(conf.type === type);
        assert(conf.port);
        assert(conf.hub);
        assert(conf.mongoHost);
        assert(conf.smsUrl);
        assert(conf.resultProxyUrl);
        assert(conf.blockchainAdapterUrl);

        const { hostname: mongoHostname, port: mongoPort } = stringToHostnamePort(conf.mongoHost);
        assert(mongoPort);
        assert(mongoHostname);

        const smsURL = new URL(conf.smsUrl);
        const resultProxyURL = new URL(conf.resultProxyUrl);
        const blockchainAdapterURL = new URL(conf.blockchainAdapterUrl);

        const mongoName = inventory.configNameFromHost(mongoHostname + ":" + mongoPort.toString());
        assert(mongoName);

        const smsName = inventory.configNameFromHost(smsURL.host);
        assert(smsName);

        const resultProxyName = inventory.configNameFromHost(resultProxyURL.host);
        assert(resultProxyName);

        const blockchainAdapterName = inventory.configNameFromHost(blockchainAdapterURL.host);
        assert(blockchainAdapterName);

        this.#addDockerFromHub(conf.hub, inventory); //even if core does not actually depends on docker
        this.#addGanacheFromHub(conf.hub, inventory);
        this.#addSmsFromName(smsName, inventory);
        this.#addResultProxyFromName(resultProxyName, inventory);
        this.#addBlockchainAdapterFromName(blockchainAdapterName, inventory);
        this.#addServiceName(mongoName, 'mongo', inventory);
        this.#addServiceName(name, conf.type, inventory);
    }

    /**
     * @param {string | 'local' | 'default'} machineName 
     * @param {string | PoCoHubRef} hub 
     * @param {number} index 
     * @param {types.SgxDriverMode} sgxDriverMode 
     * @param {InventoryDB} inventory 
     */
    #addWorkerFromIndex(machineName, hub, index, sgxDriverMode, inventory) {
        assert(this.#typeIndexToNameConfigs.length === ORDERED_SERVICE_TYPES.length);
        const type = 'worker';

        const name = InventoryDB.computeWorkerName(hub, index);

        const config = inventory.getWorkerConfig(machineName, hub, index, sgxDriverMode).resolved;
        assert(config);
        assert(config.type === type);
        assert(config.port);
        assert(config.coreUrl);
        assert(config.dockerHost);

        const coreURL = new URL(config.coreUrl);

        const coreName = inventory.configNameFromHost(coreURL.host);
        assert(coreName);

        const dockerName = inventory.configNameFromHost(config.dockerHost);
        assert(dockerName);

        this.#addDockerFromName(dockerName, inventory);
        this.#addCoreFromName(coreName, inventory);

        const c = { name, hub, index, config };
        if (!this.#workerConfigs.has(name)) {
            this.#workerConfigs.set(name, c);
            this.#size++;
        }
    }

    /**
     * @param {string | 'local' | 'default'} machineName 
     * @param {string} hub 
     * @param {number} index 
     * @param {types.SgxDriverMode} sgxDriverMode 
     * @param {InventoryDB} inventory 
     */
    static fromWorkerIndex(machineName, hub, index, sgxDriverMode, inventory) {
        const dependencies = new Dependencies();
        dependencies.#addWorkerFromIndex(machineName, hub, index, sgxDriverMode, inventory);
        return dependencies;
    }

    /**
     * @param {string} hub 
     * @param {InventoryDB} inventory 
     */
    static newIExecSDK(hub, inventory) {
        const dependencies = new Dependencies();
        dependencies.#addDockerFromHub(hub, inventory);
        dependencies.#addIpfsFromHub(hub, inventory);
        dependencies.#addMarketFromHub(hub, inventory);
        dependencies.#addResultProxyFromHub(hub, inventory);
        dependencies.#addSmsFromHub(hub, inventory);
        return dependencies;
    }

    /**
     * @param {string} name 
     * @param {InventoryDB} inventory 
     */
    static fromName(name, inventory) {
        const conf = inventory.getConfig(name).resolved;
        if (!conf) {
            throw new CodeError(`Unknown config name='${name}'`);
        }

        /** @type {srvTypes.ServiceType} */
        const type = conf.type;
        const dependencies = new Dependencies();

        switch (type) {
            case 'ipfs': dependencies.#addIpfsFromName(name, inventory); break;
            case 'docker': dependencies.#addDockerFromName(name, inventory); break;
            case 'mongo': break;
            case 'redis': break;
            case 'ganache': dependencies.#addGanacheFromName(name, inventory); break;
            case 'market': dependencies.#addMarketFromName(name, inventory); break;
            case 'sms': dependencies.#addSmsFromName(name, inventory); break;
            case 'resultproxy': dependencies.#addResultProxyFromName(name, inventory); break;
            case 'blockchainadapter': dependencies.#addBlockchainAdapterFromName(name, inventory); break;
            case 'core': dependencies.#addCoreFromName(name, inventory); break;
            default:
                break;
        }

        return dependencies;
    }
}