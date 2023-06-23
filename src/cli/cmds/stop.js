import * as srvTypes from '../../services/services-types.js';
import { Cmd } from "../Cmd.js";
import cliProgress from 'cli-progress';
import { Inventory } from '../../services/Inventory.js';
import { WorkerService } from '../../services/Worker.js';

export default class StopCmd extends Cmd {

    static cmdname() { return 'stop'; }

    /** @type {cliProgress.SingleBar} */
    static progressBar;

    /**
     * @param {string} cliDir 
     * @param {srvTypes.ServiceType} serviceType 
     * @param {*} options 
     */
    async cliExec(cliDir, serviceType, options) {
        try {
            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);

            const vars = this.parseVars(options);

            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir, vars);

            if (serviceType === 'worker') {
                await WorkerService.stopAll(null, { progressCb: stopProgress, reset: false });
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
function stopProgress({ count, total, value }) {

    const name = value?.context?.name;
    const type = value?.type;

    if (count === 0 && total > 1) {
        if (!StopCmd.progressBar) {
            StopCmd.progressBar = new cliProgress.SingleBar({
                hideCursor: true,
                clearOnComplete: true,
                autopadding: true,
                synchronousUpdate: true,
                format: ' {bar} | {percentage}% | {msg}',
            }, cliProgress.Presets.shades_classic);
        }
        StopCmd.progressBar.start(total, 0);
    }

    let msg = '';
    if (name) {
        msg = `${name}`;
    } else if (type) {
        msg = `${type}`;
    }

    StopCmd.progressBar.update(count, { msg });
}