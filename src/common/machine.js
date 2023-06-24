import * as types from './types.js';
import assert from 'assert';
import path from 'path';
import { CodeError, pureVirtualError } from './error.js';
import { qemuSystemI386, qemuSystemI386IsRunning } from '../qemu/qemu-system-i386-api.js';
import { fileExists, readFileSync, toAbsolutePath } from './fs.js';
import { isNullishOrEmptyString } from './string.js';
import * as ssh from './ssh.js';
import { PROD_CONFIG_BASENAME } from './consts.js';
import { assertIsStrictlyPositiveInteger } from './number.js';
import { addToEtcHostsStr } from './utils.js';

/* ----------------------- AbstractMachine Class -------------------------- */

export class AbstractMachine {

    /** 
     * @virtual
     * @returns {typeof AbstractMachine} 
     */
    theClass() { return AbstractMachine; }
    /** @returns {string} */
    static typename() { throw pureVirtualError('AbstractService.typename()'); }

    /** @type {types.SSHConfig} */
    #sshConfig;

    /** @type {string} */
    #name;

    /** @type {string} */
    #gatewayIp;

    /** @type {string} */
    #ixcdvWorkspaceDirectory;

    /** @type {string} */
    #rootDir;

    /** @type {number[]} */
    #hostfwdPorts;

    /**
     * @hideconstructor
     * @param {string} rootDir
     * @param {types.AbstractMachineArgs} args
     */
    constructor(rootDir, args) {
        this.#rootDir = rootDir;
        this.#name = args.name;
        this.#gatewayIp = args.gatewayIp;
        this.#ixcdvWorkspaceDirectory = args.ixcdvWorkspaceDirectory;
        this.#sshConfig = { ...args.sshConfig };
        this.#hostfwdPorts = [];

        const keyFile = toAbsolutePath(this.#rootDir, this.#sshConfig.privateKeyFile);
        if (fileExists(keyFile)) {
            const k = readFileSync(
                keyFile,
                { strict: true });
            if (isNullishOrEmptyString(k)) {
                throw new CodeError(`Invalid private key file ${keyFile}`);
            }
            assert(k);
            this.#sshConfig.privateKey = k;
        }
    }

    toJSON() {
        // do not save the private key
        const sshConfig = { ...this.#sshConfig };
        delete sshConfig.privateKey;

        const json = {
            type: this.typename(),
            name: this.#name,
            gatewayIp: this.#gatewayIp,
            ixcdvWorkspaceDirectory: this.#ixcdvWorkspaceDirectory,
            sshConfig,
        };
        return json;
    }

    /** @returns {string} */
    typename() {
        // @ts-ignore
        return this.constructor.typename();
    }

    get sshPrivateKeyFile() {
        return toAbsolutePath(this.rootDir, this.#sshConfig.privateKeyFile);
    }

    get rootDir() { return this.#rootDir; }
    get hostfwdPorts() { return this.#hostfwdPorts; }
    get sshConfig() {
        return {
            ...this.#sshConfig,
            privateKeyFile: this.sshPrivateKeyFile
        };
    }
    get name() { return this.#name; }
    get isMaster() { return (this.#name === 'master'); }
    get gatewayIp() { return this.#gatewayIp; }
    get ixcdvWorkspaceDirectory() { return this.#ixcdvWorkspaceDirectory; }

    async isRunning() {
        return true;
    }
    async start() {
        return;
    }
    async shutdown() {
        return;
    }
    /**
     * @param {number} port 
     */
    async forwardPort(port) {
        assertIsStrictlyPositiveInteger(port);
        this.#hostfwdPorts.push(port);
    }

    async ixcdvStopAll() {
        if (this.isMaster) {
            // cannot target master ??
            throw new CodeError('Cannot perform any ssh command targeting the master machine');
        }
        if (! await this.isRunning()) {
            throw new CodeError(`machine ${this.#name} is not running or 'ixcdv-config.json' has been edited (forward ports must be updated).`);
        }
        const sshConf = this.sshConfig;
        await ssh.ixcdv(
            sshConf,
            this.#ixcdvWorkspaceDirectory,
            ["stop", "all"]);
    }

    async ixcdvInstallWorkers() {
        if (this.isMaster) {
            // cannot target master ??
            throw new CodeError('Cannot perform any ssh command targeting the master machine');
        }
        if (! await this.isRunning()) {
            throw new CodeError(`machine ${this.#name} is not running or 'ixcdv-config.json' has been edited (forward ports must be updated).`);
        }
        const sshConf = this.sshConfig;
        await ssh.ixcdv(
            sshConf,
            this.#ixcdvWorkspaceDirectory,
            ["install", "--type", "worker"]);
    }

    async ixcdvKillAll() {
        if (this.isMaster) {
            // cannot target master ??
            throw new CodeError('Cannot perform any ssh command targeting the master machine');
        }
        if (! await this.isRunning()) {
            throw new CodeError(`machine ${this.#name} is not running or 'ixcdv-config.json' has been edited (forward ports must be updated).`);
        }
        const sshConf = this.sshConfig;
        await ssh.ixcdv(
            sshConf,
            this.#ixcdvWorkspaceDirectory,
            ["kill", "all"]);
    }

    /**
     * @param {string} hub 
     * @param {number} index 
     * @param {types.StartReturn} index 
     */
    async ixcdvStartWorker(hub, index) {
        if (this.isMaster) {
            // cannot target master ??
            throw new CodeError('Cannot perform any ssh command targeting the master machine');
        }
        if (! await this.isRunning()) {
            throw new CodeError(`machine ${this.#name} is not running or 'ixcdv-config.json' has been edited (forward ports must be updated).`);
        }
        const sshConf = this.sshConfig;
        const okOrErr = await ssh.ixcdv(
            sshConf,
            this.#ixcdvWorkspaceDirectory,
            ["start", "worker", "--hub", hub, "--index", `${index}`, "--no-dependencies"]);
        return okOrErr;
    }

    /**
     * @param {object} ixcdvConfigJSON 
     */
    async uploadIxcdvConfigJSON(ixcdvConfigJSON) {
        if (this.isMaster) {
            // cannot target master ??
            throw new CodeError('Cannot perform any ssh command targeting the master machine');
        }
        if (typeof ixcdvConfigJSON !== 'object' || !ixcdvConfigJSON) {
            throw new CodeError(`Invalid ${PROD_CONFIG_BASENAME} content`);
        }
        if (! await this.isRunning()) {
            throw new CodeError(`machine ${this.#name} is not running or 'ixcdv-config.json' has been edited (forward ports must be updated).`);
        }

        const sshConf = this.sshConfig;

        // Update /etc/hosts
        // =================
        // add :
        // 10.0.2.2 ixcdv-master
        // 127.0.0.1 ixcdv-node1

        const etchosts = await ssh.cat(sshConf, "/etc/hosts");
        if (!etchosts || etchosts.length === 0) {
            throw new CodeError(`Unable to retrieve /etc/hosts from machine ${this.#name}.`);
        }
        // @ts-ignore
        assert(ixcdvConfigJSON.vars);

        const masterIp = this.gatewayIp;
        const myIp = "127.0.0.1"; //keep ipv4 for QEMU

        assert(masterIp);

        const new_etchosts = addToEtcHostsStr(["ixcdv-master", `ixcdv-${this.#name}`], [masterIp, myIp], etchosts);
        if (new_etchosts !== etchosts) {
            await ssh.scpString(sshConf, new_etchosts, "/tmp/ixcdv-etc-hosts");
            await ssh.exec(sshConf, "sudo cp /tmp/ixcdv-etc-hosts /etc/hosts ; rm -rf /tmp/ixcdv-etc-hosts");
        }

        const ok = await ssh.mkDirP(sshConf, this.#ixcdvWorkspaceDirectory);
        await ssh.scpString(
            sshConf,
            JSON.stringify(ixcdvConfigJSON, null, 2),
            path.join(this.#ixcdvWorkspaceDirectory, PROD_CONFIG_BASENAME));
    }
}

/* ----------------------- QemuMachine Class -------------------------- */

export class QemuMachine extends AbstractMachine {

    /** 
     * @override
     * @returns {typeof QemuMachine} 
     */
    theClass() { return QemuMachine; }
    /** @override */
    static typename() { return 'qemu'; }

    /** @type {types.QemuConfig} */
    #qemuConfig;

    /**
     * @hideconstructor
     * @param {string} rootDir
     * @param {types.QemuMachineArgs} args
     */
    constructor(rootDir, args) {
        assert(args);
        super(rootDir, args); //compiler
        this.#qemuConfig = { ...args.qemuConfig };
        if (this.isMaster) {
            throw new CodeError('Master cannot be a qemu machine');
        }
    }

    toJSON() {
        const json = {
            ... super.toJSON(),
            qemuConfig: this.qemuConfig,
        };
        return json;
    }

    get qemuConfig() { return this.#qemuConfig; }
    get qemuHda() {
        return toAbsolutePath(this.rootDir, this.#qemuConfig.hda);
    }

    async isRunning() {
        const isRunning = await qemuSystemI386IsRunning(
            this.qemuHda,
            this.#qemuConfig.cpu,
            this.sshConfig.port,
            this.hostfwdPorts);
        return isRunning;
    }

    /**
     * Throws an error if failed
     */
    async start() {
        if (await this.isRunning()) {
            return;
        }
        await qemuSystemI386(
            this.qemuHda,
            this.#qemuConfig.cpu,
            this.sshConfig.port,
            this.hostfwdPorts,
            { strict: true });
    }

    async shutdown() {
        await ssh.shutdown(this.sshConfig);
    }

}
