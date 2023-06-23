import * as srvTypes from './services-types-internal.js';
import assert from 'assert';
import path from 'path';
import { fromServiceType, InventoryDB } from "./InventoryDB.js";
import { installPackage } from '../pkgmgr/pkg.js';
import { resolveAbsolutePath, throwIfFileDoesNotExist, toRelativePath } from '../common/fs.js';
import { computeDockerChecksumAndMultiaddr } from '../contracts/app-generator.js';
import { removeSuffix } from '../common/string.js';
import { CodeError } from '../common/error.js';
import * as ssh from '../common/ssh.js';

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
     * @param {((name:string, type: srvTypes.ServiceType | 'iexecsdk' | 'teeworkerprecompute' | 'teeworkerpostcompute', progress:number, progressTotal:number) => (void))=} callbackfn 
     */
    async installAll(callbackfn) {
        const ics = [...this._inv];
        const nInstalls = ics.length + 4;
        for (let i = 0; i < ics.length; ++i) {
            const ic = ics[i];
            assert(ic.type !== 'worker');
            await this.install(ic.name, (i + 1), nInstalls, callbackfn);
        }
        await this.installWorkers(ics.length + 1, nInstalls, callbackfn);
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
     * @param {number} progress
     * @param {number} progressTotal
     * @param {((name:string, type: srvTypes.ServiceType | 'worker', progress:number, progressTotal:number) => (void))=} callbackfn 
     */
    async installWorkers(progress, progressTotal, callbackfn) {
        callbackfn?.('', 'worker', progress, progressTotal);
        return this.#installWorkers();
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
     * @param {srvTypes.InventoryConfig} ic 
     */
    async #installInventoryConfig(ic) {
        assert(ic.type !== 'worker');
        if (this._inv.isConfigRunningLocally(ic)) {
            // Must use unsolved !
            // @ts-ignore
            return fromServiceType[ic.type].install(ic.unsolved);
        } else {
            if (this._inv.getLocalRunningMachineName() !== 'master') {
                throw new CodeError('Cannot perform any ssh install from a slave machine');
            }
            // forward install command to remote machine via ssh
            const machine = this._inv.getConfigRunningMachine(ic);
            if (!machine) {
                throw new CodeError(`No machine availabled for config ${ic.name}`);
            }

            // must copy shared/db/ganache.1337/ixcdv-ganache-poco-config.json
            // if needed
            assert(machine.sshConfig.username);
            const remoteGanacheAddr = path.join(
                '/home',
                machine.sshConfig.username,
                machine.ixcdvWorkspaceDirectory,
                'shared/db/ganache.1337/ixcdv-ganache-poco-config.json');

            //@ts-ignore
            assert(ic.type === 'sms' || ic.type === 'worker');
            const ganacheConf = this._inv.getGanacheConfigFromHubAlias(ic.resolved.hub);
            assert(ganacheConf);

            if (!(await ssh.exists(machine.sshConfig, remoteGanacheAddr)).exists) {
                await ssh.mkDirP(machine.sshConfig, path.dirname(remoteGanacheAddr));
                //./shared/db/ganache.1337/ixcdv-ganache-poco-config.json
                await ssh.scp(machine.sshConfig,
                    path.join(machine.rootDir, `shared/db/ganache.${ganacheConf.resolved.config.chainid}/ixcdv-ganache-poco-config.json`),
                    path.dirname(remoteGanacheAddr));
                //./shared/db/ganache.1337/DBUUID
                await ssh.scp(machine.sshConfig,
                    path.join(machine.rootDir, `shared/db/ganache.${ganacheConf.resolved.config.chainid}/DBUUID`),
                    path.dirname(remoteGanacheAddr));
            }
            await ssh.ixcdv(
                machine.sshConfig,
                machine.ixcdvWorkspaceDirectory,
                ["install", "--name", ic.name]);
        }
    }

    async #installWorkers() {
        // Must use unsolved !
        const repository = this._inv.getWorkersRepository().unsolved;
        return fromServiceType['worker'].install({ repository });
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