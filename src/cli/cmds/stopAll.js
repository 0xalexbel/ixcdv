import * as srvTypes from '../../services/services-types-internal.js';
import { Cmd } from "../Cmd.js";
import cliProgress from 'cli-progress';
import { CodeError } from "../../common/error.js";
import { Inventory } from "../../services/Inventory.js";
import { asServiceType } from '../../services/base-internal.js';

export default class StopAllCmd extends Cmd {

    static cmdname() { return 'stopAll'; }

    /** @type {boolean} */
    static #calledOnce = false;

    /** @type {cliProgress.SingleBar} */
    static progressBar;

    /**
     * @param {string} cliDir 
     * @param {string} type 
     * @param {boolean} kill 
     * @param {*} options 
     */
    async cliExec(cliDir, type, kill, options) {
        try {
            /** @type {srvTypes.ServiceType | 'all'} */
            const t = (type === 'all') ? type : asServiceType(type);
            await this.#execOnce(t, kill, options);

            /**
             * @todo To be removed
             * - ixcdv start core
             * - ixcdv stop all -> freezes 30s (wait until internal nodejs timeout is reached)
             * - The problem does not occur with ixcdv kill all
             * Probably due to nodejs services like 'market'
             * runs process.exit(0)
             */
            process.exit(0);
        } catch (err) {
            this.exit(options, err);
        }
    }

    /**
     * @param {boolean} kill
     * @param {*} options 
     */
    static async exec(kill, options) {
        const cmd = new StopAllCmd();
        return cmd.#execOnce('all', kill, options);
    }

    /**
     * @param {srvTypes.ServiceType | 'all'} type 
     * @param {boolean} kill
     * @param {*} options 
     */
    async #execOnce(type, kill, options) {
        // The current implementation does not support multiple calls.
        if (StopAllCmd.#calledOnce) {
            throw new CodeError('Internal error (stop all can only be called once)');
        }
        StopAllCmd.#calledOnce = true;

        if (kill) {
            // stop any other running services (zombie)
            await Inventory.killAny({ progressCb: stopProgress });
        } else {
            // stop any other running services (zombie)
            await Inventory.stopAny(type, { progressCb: stopProgress, reset: false });
        }

        endProgress('all services stopped');
    }
}

/**
 * @param {string} msg 
 */
function endProgress(msg) {
    StopAllCmd.progressBar?.update(StopAllCmd.progressBar?.getTotal(), { msg });
    StopAllCmd.progressBar?.stop();
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

    if (!StopAllCmd.progressBar) {
        StopAllCmd.progressBar = new cliProgress.SingleBar({
            hideCursor: true,
            clearOnComplete: true,
            autopadding: true,
            synchronousUpdate: true,
            format: ' {bar} | {percentage}% | {msg}',
        }, cliProgress.Presets.shades_classic);
        StopAllCmd.progressBar.start(total, 0);
    }

    let msg = '';
    if (name) {
        msg = `${name}`;
    } else if (type) {
        msg = `${type}`;
    }

    StopAllCmd.progressBar.update(count, { msg });
}