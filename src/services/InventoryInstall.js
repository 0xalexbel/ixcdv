import * as srvTypes from './services-types-internal.js';
import assert from 'assert';
import { fromServiceType, InventoryDB } from "./InventoryDB.js";
import { installPackage } from '../pkgmgr/pkg.js';

export class InventoryInstall {
    /** @type {InventoryDB} */
    _inv;

    /**
     * @param {InventoryDB} inventoryDB 
     */
    constructor(inventoryDB) {
        this._inv = inventoryDB;
    }

    /**
     * @param {((name:string, type: srvTypes.ServiceType | 'iexecsdk', progress:number, progressTotal:number) => (void))=} callbackfn 
     */
    async installAll(callbackfn) {
        const ics = [...this._inv];
        const nInstalls = ics.length + 2;
        for (let i = 0; i < ics.length; ++i) {
            const ic = ics[i];
            assert(ic.type !== 'worker');
            callbackfn?.(ic.name, ic.type, (i + 1), nInstalls);
            await this.install(ic.name);
        }
        callbackfn?.('', 'worker', ics.length + 1, nInstalls);
        await this.installWorkers();

        callbackfn?.('', 'iexecsdk', ics.length + 2, nInstalls);
        await this.#installIExecSdk();
    }

    /**
     * @param {string} name 
     */
    async install(name) {
        const ic = this._inv.getConfig(name);
        return this.#installInventoryConfig(ic);
    }

    async installWorkers() {
        return this.#installWorkers();
    }

    /**
     * @param {((name:string, type: srvTypes.ServiceType | 'iexecsdk', progress:number, progressTotal:number) => (void))=} callbackfn 
     */
    async installIExecSdk(callbackfn) {
        callbackfn?.('', 'iexecsdk', 1, 1);
        return this.#installIExecSdk();
    }

    /**
     * @param {srvTypes.InventoryConfig} ic 
     */
    async #installInventoryConfig(ic) {
        assert(ic.type !== 'worker');
        // Must use unsolved !
        // @ts-ignore
        return fromServiceType[ic.type].install(ic.unsolved);
    }

    async #installWorkers() {
        // Must use unsolved !
        const repository = this._inv.getWorkersRepository().unsolved;
        return fromServiceType['worker'].install({ repository });
    }

    async #installIExecSdk() {
        // 1- install package
        // 2- install chain.json
        // 3- compile app
        // 4- compile dataset
        // 5- generate vscode
        const ic = this._inv.getIExecSdkConfig();
        if (!ic) {
            return;
        }
        const conf = ic.resolved;
        assert(typeof conf.repository !== 'string');
        await installPackage(conf.repository);
    }
}