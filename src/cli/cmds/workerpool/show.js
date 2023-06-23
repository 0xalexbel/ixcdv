import assert from 'assert';
import { Cmd } from '../../Cmd.js';
import { Inventory } from '../../../services/Inventory.js';
import { CodeError } from '../../../common/error.js';
import { PoCoContractRef, PoCoHubRef } from '../../../common/contractref.js';
import { ENSRegistry } from '../../../common/contracts/ENSRegistry.js';
import { WORKERPOOL_URL_TEXT_RECORD_KEY } from '../../../common/consts.js';

export default class WorkerpoolShowCmd extends Cmd {

    static cmdname() { return 'workerpool_show'; }

    /**
     * @param {string} cliDir 
     * @param {{
     *      hub?: string
     *      chain?: string
     * }} options 
     */
    async cliExec(cliDir, options) {
        try {
            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);

            const vars = this.parseVars(options);

            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir, vars);

            const hubAlias = inventory._inv.guessHubAlias(options);

            // Retrieve the ganache service
            const g = await inventory._inv.newGanacheInstanceFromHubAlias(hubAlias);
            if (!g) {
                throw new CodeError('Unknown ganache config');
            }
            
            const hub = g.resolve(hubAlias);
            assert(hub);
            assert(hub.deployConfigName);
            assert(hub.address);
            assert(hub instanceof PoCoHubRef);

            const chainName = inventory._inv.hubAliasToChainName(hubAlias);

            const ensRef = g.resolve(hubAlias, 'ENSRegistry');
            assert(ensRef);
            assert(ensRef.address);
            assert(ensRef instanceof PoCoContractRef);

            const providerOpts = { ensAddress: ensRef.address, networkName: chainName ?? 'unknown' };

            const wp = g.workerpool(hub.deployConfigName);
            assert(wp);
            console.log(`address : ${wp.address}`);
            console.log(`owner   : ${g.walletKeysAtIndex(0).address}`);

            const ensRegistryContract = ENSRegistry.sharedReadOnly(ensRef, g.contractsMinDir, providerOpts);
            const ensName = await ensRegistryContract.contract.provider.lookupAddress(wp.address);
            if (ensName) {
                let savedUrl;
                try {
                    savedUrl = await ensRegistryContract.getText(ensName, WORKERPOOL_URL_TEXT_RECORD_KEY);
                } catch {
                    savedUrl = '???';
                }
                console.log(`ENS     : ${ensName}`);
                console.log(`api url : ${savedUrl}`);
            } else {
                console.log(`ENS     : ???`);
                console.log(`api url : ???`);
            }
        } catch (err) {
            this.exit(options, err);
        }
    }
}
