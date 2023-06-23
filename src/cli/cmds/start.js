import * as srvTypes from '../../services/services-types.js';
import assert from 'assert';
import { Cmd } from "../Cmd.js";
import cliProgress from 'cli-progress';
import { Inventory } from '../../services/Inventory.js';
import { stringToPositiveInteger } from '../../common/string.js';
import { CodeError } from '../../common/error.js';
import { sleep } from '../../common/utils.js';

export default class StartCmd extends Cmd {

    static cmdname() { return 'start'; }

    /** 
     @type {{
        [name:string]: cliProgress.SingleBar
     }} 
     */
    static progressBars;

    /** @type {cliProgress.MultiBar} */
    static multiBar;

    /**
     * @param {string} cliDir 
     * @param {srvTypes.ServiceType} serviceType 
     * @param {*} options 
     */
    async cliExec(cliDir, serviceType, options) {
        try {
            if (options.dependencies === false) {
                delete options.dependencies;
                options.noDependencies = true;
            }
            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);

            const vars = this.parseVars(options);

            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir, vars);
            await this.#execOnce(inventory, serviceType, options);
        } catch (err) {
            this.exit(options, err);
        }
    }

    /**
     * @param {Inventory} inventory 
     * @param {srvTypes.ServiceType} serviceType 
     * @param {*} options 
     */
    static async exec(inventory, serviceType, options) {
        const cmd = new StartCmd();
        return cmd.#execOnce(inventory, serviceType, options);
    }

    /**
     * @param {Inventory} inventory 
     * @param {srvTypes.ServiceType} serviceType 
     * @param {*} options 
     */
    async #execOnce(inventory, serviceType, options) {

        if (serviceType === 'worker') {
            let count = 1;
            if (options?.count !== undefined) {
                let c;
                if (typeof options.count === 'string') {
                    c = stringToPositiveInteger(options.count);
                    if (c === undefined) {
                        throw new CodeError(`Invalid count option '${options.count}'`);
                    }
                } else if (typeof options.count === 'number') {
                    c = options.count;
                } else {
                    throw new CodeError(`Invalid count option '${options.count}'`);
                }
                count = c;
            }

            await inventory.start({
                ...options,
                type: 'core',
                progressCb: startProgress
            });

            const promises = [];
            for (let i = 0; i < count; ++i) {
                const p = inventory.startWorker({
                    ...options,
                    noDependencies: true,
                    workerIndex: i,
                    progressCb: startProgress
                });
                promises.push(p);
            }
            await Promise.all(promises);
        } else {
            await inventory.start({
                ...options,
                type: serviceType,
                progressCb: startProgress
            });
        }

        StartCmd.multiBar?.stop();
    }
}

/**
 * @param {{
 *      count: number 
 *      total: number 
 *      value: any 
 * }} args 
 */
function startProgress({ count, total, value }) {
    const name = value?.context?.name;
    if (!name) {
        return;
    }
    const type = value?.type;
    if (!type) {
        return;
    }
    /** @type {Object.<string,string>} */
    const formattedState = {
        'starting': 'starting',
        'started': 'started ',
        'ready': 'ready   ',
        'readying': 'readying',
    }
    const state = value?.state;
    if (!state) {
        return;
    }

    if (!StartCmd.multiBar) {
        StartCmd.multiBar = new cliProgress.MultiBar({
            hideCursor: true,
            synchronousUpdate: true,
            clearOnComplete: true,
            autopadding: true,
            format: ' {bar} | {percentage}% | {state} | {name}',
        }, cliProgress.Presets.shades_classic);
        assert(!StartCmd.progressBars);
        StartCmd.progressBars = {};
    }

    if (!StartCmd.progressBars[name]) {
        StartCmd.progressBars[name] = StartCmd.multiBar.create(total, 0, { state: formattedState[state], name });
    }

    StartCmd.progressBars[name].update(count, { state: formattedState[state], name });
    return;
}