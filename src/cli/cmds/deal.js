import assert from 'assert';
import { Cmd } from "../Cmd.js";
import { CodeError } from '../../common/error.js';
import { isBytes32String } from '../../common/ethers.js';
import { isNullishOrEmptyString } from '../../common/string.js';
import { PoCoContractRef, PoCoHubRef } from '../../common/contractref.js';
import { Inventory } from '../../services/Inventory.js';
import { Hub } from '../../contracts/Hub.js';

export default class DealCmd extends Cmd {

    static cmdname() { return 'deal'; }

    /**
     * @param {string} cliDir 
     * @param {string} dealid 
     * @param {{
     *      hub?: string
     *      chain?: string
     * }} options 
     */
    async cliExec(cliDir, dealid, options) {
        try {
            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);

            const vars = this.parseVars(options);

            const inventory = await Inventory.fromConfigFile(configDir, vars);

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

            const chainName = inventory._inv.hubAliasToChainName(hubAlias);

            const ensRef = g.resolve(hubAlias, 'ENSRegistry');
            assert(ensRef);
            assert(ensRef.address);
            assert(ensRef instanceof PoCoContractRef);

            const providerOpts = { ensAddress: ensRef.address, networkName: chainName ?? 'unknown' };

            const hubContract = Hub.sharedReadOnly(hub, g.contractsMinDir, providerOpts);

            if (isNullishOrEmptyString(dealid)) {
                const dealids = await hubContract.queryOrdersMatchedEvents();
                for (let i = 0; i < dealids.length; ++i) {
                    console.log(dealids[i]);
                }
            } else {
                if (!isBytes32String(dealid)) {
                    throw new CodeError(`Invalid dealid, expecting bytes 32 hex string. (got dealid='${dealid}')`);
                }
                const d = await hubContract.viewDeal(dealid);
                console.log(JSON.stringify(d, null, 2));
            }

        } catch (err) {
            this.exit(options, err);
        }
    }
}
