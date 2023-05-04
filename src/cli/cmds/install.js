import { Cmd } from "../Cmd.js";
import cliProgress from 'cli-progress';
import StopAllCmd from "./stopAll.js";
import { getSysReq } from "../../common/sysreq.js";
import { sleep } from "../../common/utils.js";
import { CodeError } from "../../common/error.js";
import { Inventory } from "../../services/Inventory.js";
import { PROD_BIN } from "../../common/consts.js";

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
            
            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir);

            // First stop
            await StopAllCmd.exec(false, null);

            await inventory.installAll((name, type, progress, progressTotal) => {
                if (type === 'worker') {
                    console.log(`${progress}/${progressTotal} Install workers`);
                } else if (type === 'iexecsdk') {
                    console.log(`${progress}/${progressTotal} Install iexec-sdk`);
                } else {
                    console.log(`${progress}/${progressTotal} Install ${type} : ${name}`);
                }
            });

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