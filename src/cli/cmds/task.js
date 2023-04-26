import assert from 'assert';
import { Cmd } from "../Cmd.js";
import { CodeError } from '../../common/error.js';
import { PoCoHubRef } from '../../common/contractref.js';
import { isNullishOrEmptyString } from '../../common/string.js';
import { isBytes32String } from '../../common/ethers.js';
import { Inventory } from '../../services/Inventory.js';
import { Hub } from '../../contracts/Hub.js';

export default class TaskCmd extends Cmd {

    static cmdname() { return 'task'; }

    /**
     * @param {string} cliDir 
     * @param {string} taskid 
     * @param {{
     *      hub?: string
     *      chain?: string
     * }} options 
     */
    async cliExec(cliDir, taskid, options) {
        try {
            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);
            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir);

            const hubAlias = inventory._inv.guessHubAlias(options);

            // Retrieve the ganache service
            const g = await inventory._inv.newGanacheInstanceFromHubAlias(hubAlias);
            if (!g) {
                throw new CodeError('Unknown ganache config');
            }

            const hub = g.resolve(hubAlias);
            assert(hub);
            assert(hub.address);
            assert(hub instanceof PoCoHubRef);

            const hubContract = Hub.sharedReadOnly(hub, g.contractsMinDir);

            if (isNullishOrEmptyString(taskid)) {
                const taskids = await hubContract.queryTaskInitializeEvents();
                for (let i = 0; i < taskids.length; ++i) {
                    console.log(taskids[i]);
                }
            } else {
                if (!isBytes32String(taskid)) {
                    throw new CodeError(`Invalid taskid, expecting bytes 32 hex string. (got taskid='${taskid}')`);
                }
                const t = await hubContract.viewTask(taskid);
                console.log(JSON.stringify(t, null, 2));
            }

        } catch (err) {
            this.exit(options, err);
        }
    }
}
