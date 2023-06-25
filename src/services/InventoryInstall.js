import * as srvTypes from './services-types-internal.js';
import assert from 'assert';
import path, { relative } from 'path';
import { fromServiceType, InventoryDB } from "./InventoryDB.js";
import { installPackage } from '../pkgmgr/pkg.js';
import { resolveAbsolutePath, throwIfFileDoesNotExist, toRelativePath } from '../common/fs.js';
import { computeDockerChecksumAndMultiaddr } from '../contracts/app-generator.js';
import { removeSuffix } from '../common/string.js';
import { CodeError } from '../common/error.js';
import * as ssh from '../common/ssh.js';
import { GanachePoCoService } from '../poco/GanachePoCoService.js';
import { ConfigFile, inventoryToMachineConfigJSON } from './ConfigFile.js';
import { AbstractMachine } from '../common/machine.js';

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
     * @param {string | 'local' | 'default'} workersMachineName
     * @param {((name:string, type: srvTypes.ServiceType | 'iexecsdk' | 'teeworkerprecompute' | 'teeworkerpostcompute', progress:number, progressTotal:number) => (void))=} callbackfn 
     */
    async installAll(workersMachineName, callbackfn) {
        assert(workersMachineName);
        const ics = [...this._inv];
        const nInstalls = ics.length + 4;
        for (let i = 0; i < ics.length; ++i) {
            const ic = ics[i];
            assert(ic.type !== 'worker');
            await this.install(ic.name, (i + 1), nInstalls, callbackfn);
        }
        await this.installWorkers(workersMachineName, ics.length + 1, nInstalls, callbackfn);
        await this.installIExecSdk(ics.length + 2, nInstalls, callbackfn);
        await this.installTeeWorkerPreCompute(ics.length + 3, nInstalls, callbackfn);
        await this.installTeeWorkerPostCompute(ics.length + 3, nInstalls, callbackfn);
    }

    /**
     * Ex: sms.1337.standard
     * @param {string} name 
     * @param {number} progress
     * @param {number} progressTotal
     * @param {((name:string, type: srvTypes.ServiceType, progress:number, progressTotal:number) => (void))=} callbackfn 
     */
    async install(name, progress, progressTotal, callbackfn) {
        const ic = this._inv.getConfig(name);
        // @ts-ignore
        assert(ic.type !== 'worker');
        callbackfn?.(ic.name, ic.type, progress, progressTotal);
        return this.#installInventoryConfig(ic);
    }

    /**
     * @param {number} progress
     * @param {number} progressTotal
     * @param {((name:string, type: srvTypes.ServiceType, progress:number, progressTotal:number) => (void))=} callbackfn 
     */
    async installSms(progress, progressTotal, callbackfn) {
        // Must use unsolved !
        const names = this._inv.getConfigNamesFromType('sms');
        if (!names || names.length === 0) {
            return;
        }
        for (let i = 0; i < names.length; ++i) {
            await this.install(names[i], (i + 1), names.length, callbackfn);
        }
    }

    /**
     * @param {number} progress
     * @param {number} progressTotal
     * @param {((name:string, type: srvTypes.ServiceType, progress:number, progressTotal:number) => (void))=} callbackfn 
     */
    async installGanache(progress, progressTotal, callbackfn) {
        // Must use unsolved !
        const names = this._inv.getConfigNamesFromType('ganache');
        if (!names || names.length === 0) {
            return;
        }
        for (let i = 0; i < names.length; ++i) {
            await this.install(names[i], (i + 1), names.length, callbackfn);
        }
    }

    /**
     * @param {string | 'local' | 'default'} machineName
     * @param {number} progress
     * @param {number} progressTotal
     * @param {((name:string, type: srvTypes.ServiceType | 'worker', progress:number, progressTotal:number) => (void))=} callbackfn 
     */
    async installWorkers(machineName, progress, progressTotal, callbackfn) {
        assert(machineName);
        callbackfn?.(machineName, 'worker', progress, progressTotal);
        return this.#installWorkers(machineName);
    }

    /**
     * @param {number} progress
     * @param {number} progressTotal
     * @param {((name:string, type: srvTypes.ServiceType | 'iexecsdk', progress:number, progressTotal:number) => (void))=} callbackfn 
     */
    async installIExecSdk(progress, progressTotal, callbackfn) {
        callbackfn?.('', 'iexecsdk', progress, progressTotal);
        return this.#installIExecSdk();
    }
    /**
     * @param {number} progress
     * @param {number} progressTotal
     * @param {((name:string, type: srvTypes.ServiceType | 'teeworkerprecompute', progress:number, progressTotal:number) => (void))=} callbackfn 
     */
    async installTeeWorkerPreCompute(progress, progressTotal, callbackfn) {
        callbackfn?.('', 'teeworkerprecompute', progress, progressTotal);
        return this.#installTeeWorkerPreCompute();
    }
    /**
     * @param {number} progress
     * @param {number} progressTotal
     * @param {((name:string, type: srvTypes.ServiceType | 'teeworkerpostcompute', progress:number, progressTotal:number) => (void))=} callbackfn 
     */
    async installTeeWorkerPostCompute(progress, progressTotal, callbackfn) {
        callbackfn?.('', 'teeworkerpostcompute', progress, progressTotal);
        return this.#installTeeWorkerPostCompute();
    }

    /**
     * @param {AbstractMachine} targetMachine 
     */
    async #remotePreInstall(targetMachine) {
        const ics = this._inv.getGanacheConfigs();
        if (!ics || ics.length === 0) {
            return;
        }
        for (let i = 0; i < ics.length; ++i) {
            const ganacheConf = ics[i];
            assert(ganacheConf);
            const ganacheLocalDBDir = ganacheConf.resolved.directory;
            const ganacheDBRelDir = toRelativePath(targetMachine.rootDir, ganacheLocalDBDir);

            // must copy shared/db/ganache.1337/ixcdv-ganache-poco-config.json
            await targetMachine.copyIxcdvFile(GanachePoCoService.configFileBasename(), ganacheDBRelDir, true);
            // must copy shared/db/ganache.1337/DBUUID
            await targetMachine.copyIxcdvFile(GanachePoCoService.DBUUIDBasename(), ganacheDBRelDir, true);
        }
    }

    /**
     * @param {srvTypes.InventoryConfig} ic 
     */
    async #installInventoryConfig(ic) {
        assert(ic.type !== 'worker');
        if (this._inv.isConfigRunningLocally(ic)) {
            // Special case for ipfs, the resolved hostname is needed at
            // install time
            if (ic.type === 'ipfs') {
                // Must use unsolved !
                return fromServiceType[ic.type].install({
                    ...ic.unsolved,
                    //@ts-ignore
                    hostname: ic.resolved.hostname
                });
            }
            // Must use unsolved !
            // @ts-ignore
            return fromServiceType[ic.type].install(ic.unsolved);
        } else {
            // forward install command to remote machine via ssh
            const targetMachine = this._inv.getConfigRunningMachine(ic);
            // the target is a remote machine
            // our machine must be the master !
            if (!this._inv.isLocalMaster()) {
                throw new CodeError('Cannot perform any ssh install from a slave machine');
            }
            if (!targetMachine) {
                throw new CodeError(`No machine available for config ${ic.name}`);
            }

            //@ts-ignore
            assert(ic.type === 'sms' || ic.type === 'worker');

            // Copy various required files on the remote machine
            // - ixcdv-ganache-poco-config.json
            // - ...
            await this.#remotePreInstall(targetMachine);

            await targetMachine.ixcdvInstall(ic.name, undefined);
        }
    }

    /**
     * @param {string | 'local' | 'default'} machineName 
     */
    async #installWorkers(machineName) {
        const targetMachineName = this._inv.resolveMachineName(machineName);
        // is the target machine the local machine ?
        if (this._inv.isLocalMachineName(targetMachineName)) {
            // Must use unsolved !
            const repository = this._inv.getWorkersRepository().unsolved;
            return fromServiceType['worker'].install({ repository });
        } else {
            const targetMachine = this._inv.getMachine(targetMachineName);
            // the target is a remote machine
            // our machine must be the master !
            if (!this._inv.isLocalMaster()) {
                throw new CodeError('Cannot perform any ssh install from a slave machine');
            }

            // Copy various required files on the remote machine
            // - ixcdv-ganache-poco-config.json
            // - ...
            await this.#remotePreInstall(targetMachine);

            // run ixcdv cli cmd on target machine
            await targetMachine.ixcdvInstallWorkers();
        }
    }

    async #installIExecSdk() {
        const ic = this._inv.getIExecSdkConfig();
        if (!ic) {
            return;
        }
        const conf = ic.resolved;
        assert(typeof conf.repository !== 'string');
        await installPackage(conf.repository);
    }

    async #installTeeWorkerPreCompute() {
        const ic = this._inv.getTeeWorkerPreComputeConfig();
        if (!ic) {
            return;
        }
        const conf = ic.unsolved;
        assert(typeof conf.repository !== 'string');
        await installPackage(conf.repository);

        let appAllJar = path.join(conf.repository.directory, 'build', 'libs', 'app-all.jar');
        assert(appAllJar);
        assert(path.isAbsolute(appAllJar));
        throwIfFileDoesNotExist(appAllJar);
        appAllJar = resolveAbsolutePath(appAllJar);
        appAllJar = path.join(
            toRelativePath(conf.repository.directory, path.dirname(appAllJar)),
            path.basename(appAllJar));

        const imgName = conf.repository.gitHubRepoName;
        assert(imgName);
        assert(conf.repository.commitish);
        assert(conf.repository.commitish.startsWith('v'));
        const imgVersion = removeSuffix('v', conf.repository.commitish);
        // Ex: multiaddr = localhost:5008/tee-worker-pre-compute:v8.0.0
        const res = await computeDockerChecksumAndMultiaddr(
            conf.repository.directory,
            imgName,
            imgVersion,
            this._inv.getDockerUrl(),
            [`jar=${appAllJar}`], /* buildArgs */
            true
        );
        console.log("tee-worker-pre-compute.checksum : " + res.checksum);
        console.log("tee-worker-pre-compute.multiaddr: " + res.multiaddr);
    }

    async #installTeeWorkerPostCompute() {
        const ic = this._inv.getTeeWorkerPostComputeConfig();
        if (!ic) {
            return;
        }
        const conf = ic.unsolved;
        assert(typeof conf.repository !== 'string');
        await installPackage(conf.repository);

        let appAllJar = path.join(conf.repository.directory, 'build', 'libs', 'app-all.jar');
        assert(appAllJar);
        assert(path.isAbsolute(appAllJar));
        throwIfFileDoesNotExist(appAllJar);
        appAllJar = resolveAbsolutePath(appAllJar);
        appAllJar = path.join(
            toRelativePath(conf.repository.directory, path.dirname(appAllJar)),
            path.basename(appAllJar));

        const imgName = conf.repository.gitHubRepoName;
        assert(imgName);
        assert(conf.repository.commitish);
        assert(conf.repository.commitish.startsWith('v'));
        const imgVersion = removeSuffix('v', conf.repository.commitish);
        // Ex: multiaddr = localhost:5008/tee-worker-post-compute:v8.0.0
        const res = await computeDockerChecksumAndMultiaddr(
            conf.repository.directory,
            imgName,
            imgVersion,
            this._inv.getDockerUrl(),
            [`jar=${appAllJar}`], /* buildArgs */
            true
        );
        console.log("tee-worker-post-compute.checksum : " + res.checksum);
        console.log("tee-worker-post-compute.multiaddr: " + res.multiaddr);
    }
}