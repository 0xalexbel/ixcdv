import * as types from '../common/common-types.js';
import * as srvTypes from './services-types-internal.js';
import assert from 'assert';
import path from 'path';
import { fromServiceType, InventoryDB } from "./InventoryDB.js";
import { ConfigFile, inventoryToConfigFile } from './ConfigFile.js';
import { InventoryRun } from './InventoryRun.js';
import { InventoryInstall } from './InventoryInstall.js';
import { ORDERED_SERVICE_TYPES } from './base-internal.js';
import { DEFAULT_WALLET_INDEX } from './default-config.js';
import { PoCoHubRef } from '../common/contractref.js';
import { isNullishOrEmptyString, stringToPositiveInteger } from '../common/string.js';
import { resolveAbsolutePath, saveToFile, throwIfDirDoesNotExist, throwIfFileAlreadyExists } from '../common/fs.js';
import { AbstractService } from '../common/service.js';
import { createRandomMnemonic, ethersIsValidMnemonic } from '../common/ethers.js';

export const InventoryConstructorGuard = { value: false };

export function newInventory() {
    assert(!InventoryConstructorGuard.value);
    InventoryConstructorGuard.value = true;
    let o = null;
    try {
        o = new Inventory();
    } catch (err) {
        InventoryConstructorGuard.value = false;
        throw err;
    }
    InventoryConstructorGuard.value = false;
    return o;
}

export class Inventory {
    /** @type {InventoryDB} */
    // @ts-ignore
    _inv;

    constructor() {
        if (!InventoryConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }
    }

    /**
     * @param {'admin'|'workerpool'|'app'|'dataset'|'requester'|'worker'} type 
     */
    getDefaultWalletIndex(type) {
        const index = DEFAULT_WALLET_INDEX[type];
        assert(typeof index === 'number');
        return index;
    }
    getDefaultHubAlias() {
        return this._inv.defaultHubAlias
    }
    getDefaultChainName() {
        return this._inv.defaultChainName;
    }

    /**
     * - Throws an error if failed.
     * @param {string | types.DevContractRefLike} refLike 
     */
    async resolve(refLike) {
        return this._inv.resolve(refLike);
    }

    getIpfsApiHost() {
        return this._inv.getIpfsApiHost();
    }

    getDockerHost() {
        return this._inv.getDockerHost();
    }
    getDockerUrl() {
        return this._inv.getDockerUrl();
    }

    async getChainids() {
        return this._inv.getChainids();
    }

    /**
     * @param {'ganache' | 'sms' | 'blockchainadapter' | 'resultproxy' | 'core' | 'market'} type 
     * @param {string | PoCoHubRef} hub 
     */
    getHubServiceURL(type, hub) {
        return this._inv.getHubServiceURL(type, hub);
    }

    /**
     * @param {string} host 
     */
    async newInstanceFromHost(host) {
        return this._inv.newInstanceFromHost(host);
    }

    /**
     * @param {'ganache' | 'sms' | 'blockchainadapter' | 'resultproxy' | 'core' | 'market'} type 
     * @param {string} hub 
     */
    async newInstanceFromHub(type, hub) {
        return this._inv.newInstanceFromHub(type, hub);
    }

    /**
     * @param {string | URL} host 
     * @returns {string}
     */
    getHubFromHost(host) {
        return this._inv.getHubFromHost(host);
    }

    /**
     * @param {?string=} dir 
     * @param {{
     *      firstChainId?: string
     *      countChainIds?: string
     *      mnemonic?: string | string[]
     * }=} options 
     */
    static newDefault(dir, options) {
        const firstChainId = stringToPositiveInteger(options?.firstChainId ?? "1337", { strict : true });
        const countChainIds = stringToPositiveInteger(options?.countChainIds ?? "2", { strict : true });

        assert(firstChainId);
        assert(countChainIds);

        // starts with a basic empty config containing the minimal PoCo configs
        const defaultJSON = ConfigFile.default(firstChainId, countChainIds, options?.mnemonic);
        // Generates the corresponding inventory
        // All the folder absolute paths are resolved as well as all the service ports.
        return ConfigFile.load(defaultJSON, dir);
    }

    /**
     * - Returns a config json object ready to be saved. 
     * - All path are constructed relative to `dir`
     * @param {string} dir 
     */
    toConfigJSON(dir) {
        return inventoryToConfigFile(this._inv, dir);
    }

    /**
      * @param {{
      *      default: string   
      *      shared: any
      *      chains: any
      * }} configJson
      * @param {?string=} dir 
      */
    static fromConfigJSON(configJson, dir) {
        return ConfigFile.load(configJson, dir);
    }

    /**
     * @param {?string=} dir 
     */
    static fromConfigFile(dir) {
        return ConfigFile.loadFile(dir);
    }

    /**
     * - Save inventory to config json file `<dir>/<config-file>.json`. 
     * - All path are constructed relative to `dir`
     * - if `dir` is null, undefined or empty, use process `cwd` instead.
     * - Throws an exception if failed.
     * @param {{
     *      directory?: string     
     *      overrideExistingFile?: boolean     
     * }} options 
     */
    async saveConfigFile({ directory, overrideExistingFile } = {}) {
        if (isNullishOrEmptyString(directory)) {
            directory = process.cwd();
        }
        assert(directory);
        directory = resolveAbsolutePath(directory);

        throwIfDirDoesNotExist(directory);
        if (!overrideExistingFile) {
            throwIfFileAlreadyExists(path.join(directory, ConfigFile.basename()));
        }

        // generate the config file from the inventory
        // all paths are made relative to 'dir'
        const configJSON = await this.toConfigJSON(directory);

        // save config json file
        await saveToFile(
            JSON.stringify(configJSON, null, 2),
            directory,
            ConfigFile.basename(),
            { strict: true });
    }

    // /**
    //  * @param {types.StopOptionsWithContext=} options 
    //  */
    // async stopAll(options) {
    //     const run = new InventoryRun(this._inv);
    //     return run.stopAll(options);
    // }

    /**
     * @param {types.StopOptionsWithContext=} options 
     */
    static async stopAny(options) {
        return InventoryRun.stopAny(options);
    }

    /**
     * @param {types.StopOptionsWithContext=} options 
     */
    async resetAll(options) {
        const run = new InventoryRun(this._inv);
        return run.resetAll(options);
    }

    /**
     * @param {{
     *      name?: string,
     *      hub?: string,
     *      chainid?: number | string
     *      type?: srvTypes.NonWorkerServiceType,
     *      onlyDependencies?: boolean
     *      types?: srvTypes.OptionalServiceTypes<boolean>
     *      progressCb?: types.progressCallback
     * }} options 
     */
    async start(options) {
        const run = new InventoryRun(this._inv);
        return run.start(options);
    }

    /**
     * @param {{
     *      hub?: string,
     *      workerIndex: number,
     *      onlyDependencies?: boolean
     *      noDependencies?: boolean
     *      types?: srvTypes.OptionalServiceTypes<boolean>
     *      progressCb?: types.progressCallback
     * }} options 
     */
    async startWorker(options) {
        const run = new InventoryRun(this._inv);
        return run.startWorker(options);
    }

    /**
     * @param {((name:string, type: srvTypes.ServiceType | 'iexecsdk', progress:number, progressTotal:number) => (void))=} callbackfn 
     */
    async installAll(callbackfn) {
        const install = new InventoryInstall(this._inv);
        return install.installAll(callbackfn);
    }

    /**
     * @param {srvTypes.ServiceType | 'all'} type 
     */
    static async running(type) {
        if (type === 'all') {
            const promises = [];
            for (let i = 0; i < ORDERED_SERVICE_TYPES.length; ++i) {
                const t = ORDERED_SERVICE_TYPES[i];
                let p = null;
                if (t !== 'docker') {
                    p = fromServiceType[t].running();
                }
                promises.push(p);
            }
            const out = await Promise.all(promises);
            assert(out.length === ORDERED_SERVICE_TYPES.length);

            /** @type {{[serviceType:string]: {pid:number, service:(AbstractService | null)}[] | null}} */
            const o = {};
            for (let i = 0; i < out.length; ++i) {
                const t = ORDERED_SERVICE_TYPES[i];
                o[t] = out[i];
            }
            return o;
        } else {
            const out = await fromServiceType[type].running();
            return { [type]: out };
        }
    }

    /**
     * @param {srvTypes.ServiceType} type 
     */
    static typeToClass(type) {
        return fromServiceType[type];
    }
}
