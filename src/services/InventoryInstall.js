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
        callbackfn?.('', 'worker', nInstalls, nInstalls);
        await this.installWorkers();

        callbackfn?.('', 'iexecsdk', nInstalls, nInstalls);
        await this.installIExecSdk();
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

    /** @param {srvTypes.NonWorkerServiceType} type */
    async #seqInstallType(type) {
        const names = this._inv.getConfigNamesFromType(type);
        if (!names || names.length === 0) {
            return;
        }
        // Sequential install
        for (let i = 0; i < names.length; ++i) {
            const name = names[i];
            // Must use unsolved !
            const ic = this._inv.getConfig(name);
            assert(ic);
            assert(ic.type === type);
            // @ts-ignore
            await this.#installInventoryConfig(ic);
        }
    }

    async installIExecSdk() {
        // 1- install package
        // 2- install chain.json
        // 3- compile app
        // 4- compile dataset
        // 5- generate vscode
        const ic = this._inv.getIExecSdkConfig();
        const conf = ic.resolved;       
        assert(typeof conf.repository !== 'string');
        await installPackage(conf.repository);
    }
}