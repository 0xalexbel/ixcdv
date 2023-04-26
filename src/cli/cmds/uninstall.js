import { Cmd } from "../Cmd.js";
import path from "path";
import cliProgress from 'cli-progress';
import StopAllCmd from "./stopAll.js";
import { getSysReq } from "../../common/sysreq.js";
import { sleep } from "../../common/utils.js";
import { CodeError } from "../../common/error.js";
import { Inventory } from "../../services/Inventory.js";
import { PROD_BIN } from "../../common/consts.js";
import { rmrfDir } from "../../common/fs.js";
import readline from 'readline/promises'

export default class UninstallCmd extends Cmd {

    static cmdname() { return 'uninstall'; }

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
            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir);

            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
              });
              
            const answer = await rl.question(`uninstall ${cliDir} workspace (Y/n)? `);
            rl.close();
            if (answer !== 'Y') {
                throw new Error();
            }

            await StopAllCmd.exec(null);

            const folders = [
                'chains',
                'src',
                'shared'
            ];
            for (let i = 0; i < folders.length; ++i) {
                const d = path.join(configDir, folders[i]);
                console.log(`Please wait, deleting folder ${d} ...`);
                await rmrfDir(d, { strict: false });
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
function uninstallProgress({ count, total, value }) {

    const name = value[0];
    const parsedVersion = value[1].parsedVersion;

    let msg = 'check system requirements...';
    if (name) {
        msg = `check ${name} : ${parsedVersion}`;
    }

    if (!UninstallCmd.progressBar) {
        UninstallCmd.progressBar = new cliProgress.SingleBar({
            hideCursor: true,
            clearOnComplete: true,
            autopadding: true,
            synchronousUpdate: true,
            format: ' {bar} | {percentage}% | {msg}',
        }, cliProgress.Presets.shades_classic);
        UninstallCmd.progressBar.start(total, 0, { msg });
    }

    UninstallCmd.progressBar.update(count, { msg });
}