import { Cmd } from "../Cmd.js";
import cliProgress from 'cli-progress';
import StopAllCmd from "./stopAll.js";
import { MIN_GANACHE_VERSION, checkMinGanacheVersion, getSysReq } from "../../common/sysreq.js";
import { sleep } from "../../common/utils.js";
import { CodeError } from "../../common/error.js";
import { Inventory } from "../../services/Inventory.js";
import { PROD_BIN, PROD_CONFIG_BASENAME, PROD_NAME } from "../../common/consts.js";
import { isNullishOrEmptyString } from "../../common/string.js";

export default class InstallCmd extends Cmd {

    static cmdname() { return 'install'; }

    /** @type {cliProgress.SingleBar} */
    static progressBar;

    /**
     * @param {string} cliDir 
     * @param {*} options 
     */
    async cliExec(cliDir, options) {
        try {
            let type = 'all';
            let name;
            if (options.type) {
                if (options.type !== 'iexecsdk' &&
                    options.type !== 'worker' &&
                    options.type !== 'sms' &&
                    options.type !== 'ganache' &&
                    options.type !== 'teeworkerprecompute' &&
                    options.type !== 'teeworkerpostcompute' &&
                    options.type !== 'all') {
                    throw new CodeError(`Unsupported type option ${options.type}`);
                }
                type = options.type;
            }
            if (options.name) {
                name = options.name;
            }

            const vars = this.parseVars(options);
            const hasVars = Object.keys(vars).length;

            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);

            const checkRequirements = !true;
            if (checkRequirements) {
                const sysReq = await getSysReq(installProgress);
                await sleep(1000);
                InstallCmd.progressBar?.stop();

                console.log(sysReq.toMessage() + "\n");

                const countMissing = sysReq.countMissing();
                if (countMissing > 0) {
                    throw new CodeError(`${countMissing} required dependencies are missing. Type '${PROD_BIN} show sysreq' to print the detailed list of all the required software tools.`);
                }
            }

            // This piece of code should also be included in 'show sysreq' command
            const checkGanache = await checkMinGanacheVersion(MIN_GANACHE_VERSION);
            if (!checkGanache.ok) {
                if (checkGanache.semver) {
                    throw new CodeError(`${PROD_NAME} requires Ganache version ${MIN_GANACHE_VERSION} or higher (current version=${checkGanache.semver.toString()}).`);
                }
                if (isNullishOrEmptyString(checkGanache.version)) {
                    throw new CodeError(`${PROD_NAME} requires Ganache version ${MIN_GANACHE_VERSION} or higher.`);
                }
                // Version parsing failed. Should adjust function 'checkMinGanacheVersion'
                throw new CodeError(`Unknown Ganache version : ${checkGanache.version}`);
            }

            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir, vars);

            if (inventory._inv.isLocalMaster()) {
                const allMachines = inventory._inv.allMachinesArray;
                for (let i = 0; i < allMachines.length; ++i) {
                    const machineConfigJSON = await inventory.toMachineConfigJSON(allMachines[i]);
                    console.log(`Uploading ${PROD_CONFIG_BASENAME} to ${allMachines[i].name}`);
                    await allMachines[i].uploadIxcdvConfigJSON(machineConfigJSON);
                }
            }

            // First stop (gently)
            await StopAllCmd.exec(false /* only gentle stop */, inventory, null);

            if (hasVars) {
                await inventory.saveConfigFile({ directory: configDir, overrideExistingFile: true });
            }

            let installWallets = false;

            if (name !== null && name !== undefined) {
                const ic = inventory._inv.getConfig(name);
                if (!ic) {
                    throw new CodeError(`Unknown inventory config name : '${name}'`);
                }
                if (ic.type === 'ganache') {
                    installWallets = true;
                }
                await inventory.installSingleConfig(name, (name, type, progress, progressTotal) => {
                    console.log(`${progress}/${progressTotal} Install ${name}`);
                });
            } else if (type === 'all') {
                installWallets = true;
                await inventory.installAll('local', (name, type, progress, progressTotal) => {
                    if (type === 'worker') {
                        console.log(`${progress}/${progressTotal} Install workers`);
                    } else if (type === 'iexecsdk') {
                        console.log(`${progress}/${progressTotal} Install iexec-sdk`);
                    } else {
                        console.log(`${progress}/${progressTotal} Install ${type} : ${name}`);
                    }
                });
            } else if (type === 'iexecsdk') {
                await inventory.installIExecSdk((name, type, progress, progressTotal) => {
                    console.log(`${progress}/${progressTotal} Install iexec-sdk`);
                });
            } else if (type === 'worker') {
                if (!options.machine) {
                    options.machine = 'local';
                }
                await inventory.installWorkers(options.machine, (name, type, progress, progressTotal) => {
                    console.log(`${progress}/${progressTotal} Install workers : ${name}`);
                });
            } else if (type === 'ganache') {
                installWallets = true;
                await inventory.installGanache((name, type, progress, progressTotal) => {
                    console.log(`${progress}/${progressTotal} Install ganache : ${name}`);
                });
            } else if (type === 'sms') {
                await inventory.installSms((name, type, progress, progressTotal) => {
                    console.log(`${progress}/${progressTotal} Install sms : ${name}`);
                });
            } else if (type === 'teeworkerprecompute') {
                await inventory.installTeeWorkerPreCompute((name, type, progress, progressTotal) => {
                    console.log(`${progress}/${progressTotal} Install tee-worker-pre-compute`);
                });
            } else if (type === 'teeworkerpostcompute') {
                await inventory.installTeeWorkerPostCompute((name, type, progress, progressTotal) => {
                    console.log(`${progress}/${progressTotal} Install tee-worker-post-compute`);
                });
            }

            if (installWallets) {
                const configNames = inventory._inv.getConfigNamesFromType('ganache');
                if (configNames && configNames.length > 0) {
                    for (let i = 0; i < configNames.length; ++i) {
                        const g = await inventory._inv.newGanacheInstance(configNames[i]);
                        if (g) {
                            let f;
                            f = await g.walletFileAtIndex(inventory.getDefaultWalletIndex('admin'));
                            console.log('Generates wallet file : admin       = ' + f);
                            f = await g.walletFileAtIndex(inventory.getDefaultWalletIndex('workerpool'));
                            console.log('Generates wallet file : workerpool  = ' + f);
                            f = await g.walletFileAtIndex(inventory.getDefaultWalletIndex('app'));
                            console.log('Generates wallet file : app         = ' + f);
                            f = await g.walletFileAtIndex(inventory.getDefaultWalletIndex('dataset'));
                            console.log('Generates wallet file : dataset     = ' + f);
                            f = await g.walletFileAtIndex(inventory.getDefaultWalletIndex('requester'));
                            console.log('Generates wallet file : requester   = ' + f);
                            f = await g.walletFileAtIndex(inventory.getDefaultWalletIndex('worker') + 0);
                            console.log('Generates wallet file : worker #0   = ' + f);
                            f = await g.walletFileAtIndex(inventory.getDefaultWalletIndex('worker') + 1);
                            console.log('Generates wallet file : worker #1   = ' + f);
                            f = await g.walletFileAtIndex(inventory.getDefaultWalletIndex('worker') + 2);
                            console.log('Generates wallet file : worker #2   = ' + f);
                            f = await g.walletFileAtIndex(inventory.getDefaultWalletIndex('worker') + 3);
                            console.log('Generates wallet file : worker #3   = ' + f);
                            f = await g.walletFileAtIndex(inventory.getDefaultWalletIndex('worker') + 4);
                            console.log('Generates wallet file : worker #4   = ' + f);
                        }
                    }
                }
            }
        } catch (err) {
            this.exit(options, err);
        }
    }
}

/**
 * @param {{
 *      count: number 
 *      total: number
 *      value: any
 * }} args 
 */
function installProgress({ count, total, value }) {

    const name = value[0];
    const parsedVersion = value[1].parsedVersion;

    if (Cmd.JsonProgress) {
        console.log(JSON.stringify({ count, total, value: [name, { parsedVersion }] }));
        return;
    }

    let msg = 'check system requirements...';
    if (name) {
        msg = `check ${name} : ${parsedVersion}`;
    }

    if (!InstallCmd.progressBar) {
        InstallCmd.progressBar = new cliProgress.SingleBar({
            hideCursor: true,
            clearOnComplete: true,
            autopadding: true,
            synchronousUpdate: true,
            format: ' {bar} | {percentage}% | {msg}',
        }, cliProgress.Presets.shades_classic);
        InstallCmd.progressBar.start(total, 0, { msg });
    }

    InstallCmd.progressBar.update(count, { msg });
}