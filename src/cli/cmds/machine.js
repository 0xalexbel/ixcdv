import assert from 'assert';
import path from 'path';
import { Cmd } from "../Cmd.js";
import { Inventory } from "../../services/Inventory.js";
import { CodeError } from "../../common/error.js";
import { chmodUXSync, generateTmpPathname, mkDirP, replaceInFile, rmrf, saveToFileSync } from "../../common/fs.js";
import { fileURLToPath } from 'url';
import { copyFile } from 'fs/promises';
import { QemuMachine } from '../../common/machine.js';
import * as ssh from '../../common/ssh.js';
import { hostnamePortToString } from '../../common/string.js';

export default class MachineCmd extends Cmd {

    static cmdname() { return 'machine'; }

    /**
     * @param {string} cliDir 
     * @param {string} cmd
     * @param {*} args 
     */
    async cliExec(cliDir, cmd, args) {
        if (cmd === 'shutdown') {
            this.shutdown(cliDir, args.name, args.options);
        } else if (cmd === 'start') {
            this.start(cliDir, args.name, args.options);
        } else if (cmd === 'generate-scripts') {
            this.generateScripts(cliDir, args.name, args.options);
        } else if (cmd === 'install-tools') {
            this.installTools(cliDir, args.name, args.options);
        } else if (cmd === 'print-config') {
            this.printConfig(cliDir, args.name, args.options);
        }
    }

    /**
     * @param {string} cliDir 
     * @param {string} machineName
     * @param {*} options 
     */
    async shutdown(cliDir, machineName, options) {
        try {
            const vars = this.parseVars(options);
            const hasVars = Object.keys(vars).length;

            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);

            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir, vars);

            const machine = inventory._inv.getMachine(machineName);
            if (!machine) {
                throw new CodeError(`Unknown machine name ${machineName}`);
            }
            await machine.shutdown();
        } catch (err) {
            this.exit(options, err);
        }
    }

    /**
     * @param {string} cliDir 
     * @param {string} machineName
     * @param {*} options 
     */
    async start(cliDir, machineName, options) {
        try {
            const vars = this.parseVars(options);
            const hasVars = Object.keys(vars).length;

            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);

            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir, vars);

            const machine = inventory._inv.getMachine(machineName);
            if (!machine) {
                throw new CodeError(`Unknown machine name ${machineName}`);
            }
            await machine.start();
        } catch (err) {
            this.exit(options, err);
        }
    }

    /**
     * @param {string} cliDir 
     * @param {string} machineName
     * @param {*} options 
     */
    async generateScripts(cliDir, machineName, options) {
        try {
            const vars = this.parseVars(options);
            const hasVars = Object.keys(vars).length;

            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);

            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir, vars);

            const machine = inventory._inv.getMachine(machineName);
            if (!machine) {
                throw new CodeError(`Unknown machine name ${machineName}`);
            }
            assert(machine instanceof QemuMachine);

            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);

            const scriptsDir = path.join(__dirname, "../../../scripts");
            const dstDir = path.dirname(machine.qemuHda);

            mkDirP(dstDir, { strict: true });

            // <machineName>-install-qemu-ubuntu2004-live-server.sh
            let dstFile = path.join(dstDir, `${machineName}-install-qemu-ubuntu2004-live-server.sh`);
            let scriptFile = path.join(scriptsDir, "install-qemu-ubuntu2004-live-server.sh.template");
            await copyFile(scriptFile, dstFile);
            await replaceInFile(
                ["{{ machineName }}"],
                [`${machineName}`],
                dstFile);

            // <machineName>-install-ssh.sh
            dstFile = path.join(dstDir, `${machineName}-install-ssh.sh`);
            scriptFile = path.join(scriptsDir, "install-ssh.sh.template");
            await copyFile(scriptFile, dstFile);

            assert(machine.sshConfig.host);
            assert(machine.sshConfig.port);
            assert(machine.sshConfig.username);

            await replaceInFile(
                ["{{ dir }}", "{{ host }}", "{{ port }}", "{{ user }}"],
                [dstDir, machine.sshConfig.host, machine.sshConfig.port.toString(), machine.sshConfig.username],
                dstFile);

            // <machineName>-ssh.sh
            let sshFilename = `${machineName}-ssh.sh`;
            let cmd = `#!/bin/bash
ssh ${machine.sshConfig.username}@${machine.sshConfig.host} -p ${machine.sshConfig.port} -i ${path.join(dstDir, 'qemuworkerkey')}
`;
            saveToFileSync(cmd, dstDir, sshFilename);
            chmodUXSync(path.join(dstDir, sshFilename));
        } catch (err) {
            this.exit(options, err);
        }
    }

    /**
     * @param {string} cliDir 
     * @param {string} machineName
     * @param {*} options 
     */
    async installTools(cliDir, machineName, options) {
        try {
            const vars = this.parseVars(options);
            const hasVars = Object.keys(vars).length;

            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);

            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir, vars);
            const dockerHost = hostnamePortToString(inventory._inv.getDockerHost(), undefined);

            const machine = inventory._inv.getMachine(machineName);
            if (!machine) {
                throw new CodeError(`Unknown machine name ${machineName}`);
            }
            await machine.start();

            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);

            const scriptsDir = path.join(__dirname, "../../../scripts");

            const tmpFile = await generateTmpPathname();
            try {
                const scriptFile = path.join(scriptsDir, "install-tools.sh.template");
                await copyFile(scriptFile, tmpFile);

                assert(machine.sshConfig.username);

                await replaceInFile(
                    [
                        "{{ user }}", 
                        "{{ slave-hostname }}", 
                        "{{ slave-ip }}", 
                        "{{ master-hostname }}", 
                        "{{ master-ip }}", 
                        "{{ gradle_version }}", 
                        "{{ node_major_version }}", 
                        "{{ jdk }}", 
                        "{{ docker-registry }}", 
                        "{{ ixcdv-git }}", 
                        "{{ ixcdv-git-branch }}"
                    ],
                    [
                        machine.sshConfig.username, // user
                        `ixcdv-${machine.name}`, //salve hostname
                        "127.0.0.1", //salve ip
                        "ixcdv-master", //master hostname
                        machine.gatewayIp, //master ip
                        "7.4.2", //gradle version
                        "19", //node version
                        "11", //jdk
                        `${dockerHost}`, //docker registry
                        "https://github.com/0xalexbel/ixcdv.git", 
                        "develop"
                    ],
                    tmpFile);

                await ssh.scp(machine.sshConfig, tmpFile, `/home/${machine.sshConfig.username}/install-tools.sh`);
                rmrf(tmpFile);

                await ssh.execProgress(machine.sshConfig, './install-tools.sh');
            } catch (e) {
                rmrf(tmpFile);
                throw e;
            }
        } catch (err) {
            this.exit(options, err);
        }
    }

    /**
     * @param {string} cliDir 
     * @param {string} machineName
     * @param {*} options 
     */
    async printConfig(cliDir, machineName, options) {
        try {
            const vars = this.parseVars(options);
            const hasVars = Object.keys(vars).length;

            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);

            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir, vars);

            const machine = inventory._inv.getMachine(machineName);
            if (!machine) {
                throw new CodeError(`Unknown machine name ${machineName}`);
            }

            const configJSON = await inventory.toMachineConfigJSON(machine);

            if (options.upload) {
                await machine.uploadIxcdvConfigJSON(configJSON);
            } else {
                process.stdout.write(JSON.stringify(configJSON, null, 2));
            }

        } catch (err) {
            this.exit(options, err);
        }
    }
}
