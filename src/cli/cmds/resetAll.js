import { Cmd } from "../Cmd.js";
import cliProgress from 'cli-progress';
import { CodeError } from '../../common/error.js';
import { Inventory } from '../../services/Inventory.js';

export default class ResetAllCmd extends Cmd {

    static cmdname() { return 'resetAll'; }

    /** @type {boolean} */
    static #calledOnce = false;

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

            const vars = this.parseVars(options);

            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir, vars);
            await this.#execOnce(inventory, options);
        } catch (err) {
            this.exit(options, err);
        }
    }

    /**
     * @param {Inventory} inventory 
     * @param {*} options 
     */
    static async exec(inventory, options) {
        const cmd = new ResetAllCmd();
        return cmd.#execOnce(inventory, options);
    }

    /**
     * @param {Inventory} inventory 
     * @param {*} options 
     */
    async #execOnce(inventory, options) {
        // The current implementation does not support multiple calls.
        if (ResetAllCmd.#calledOnce) {
            throw new CodeError('Internal error (reset all can only be called once)');
        }
        ResetAllCmd.#calledOnce = true;

        // stop all running config services
        await inventory.resetAll({ progressCb: resetAllProgress });

        ResetAllCmd.progressBar?.stop();
    }
}

/**
 * @param {{
 *      count: number 
 *      total: number 
 *      value: any
 * }} args 
 */
function resetAllProgress({ count, total, value }) {
    const name = value?.context?.name;
    const type = value?.type;

    let msg = 'reset...';
    if (name) {
        msg = `${name}`;
    } else if (type) {
        msg = `${type}`;
    }

    if (count === 0 && total > 1) {
        if (!ResetAllCmd.progressBar) {
            ResetAllCmd.progressBar = new cliProgress.SingleBar({
                hideCursor: true,
                clearOnComplete: true,
                autopadding: true,
                synchronousUpdate: true,
                format: ' {bar} | {percentage}% | {msg}',
            }, cliProgress.Presets.shades_classic);
        }
        ResetAllCmd.progressBar.start(total, 0);
    }

    ResetAllCmd.progressBar.update(count, { msg });
}