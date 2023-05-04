import { Cmd } from "../Cmd.js";
import assert from 'assert';
import { Inventory } from "../../services/Inventory.js";
import { CodeError } from "../../common/error.js";
import { PoCoContractRef, PoCoHubRef, newContract } from "../../common/contractref.js";
import { Hub } from "../../contracts/Hub.js";
import { SharedReadonlyContracts } from "../../common/contracts/SharedReadonlyContracts.js";
import { toChecksumAddress } from "../../common/ethers.js";

export default class KycCmd extends Cmd {

    static cmdname() { return 'kyc'; }

    /**
     * @param {string} cliDir 
     * @param {string} cmd 
     * @param {string} address 
     * @param {*} options 
     */
    async cliExec(cliDir, cmd, address, options) {
        try {
            address = toChecksumAddress(address);

            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);
            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir);

            const hubAlias = inventory._inv.guessHubAlias(options);
            console.log('hubAlias=' + hubAlias);

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
            const symbol = await hubContract.symbol();

            if (symbol !== 'SeRLC') {
                throw new CodeError(`hubAlias '${hubAlias}' does not refer to an enterprise hub`);
            }

            const tokenRef = await hubContract.tokenRef();
            assert(tokenRef.hasContractName);

            if (cmd === 'show') {
                const c = SharedReadonlyContracts.get(tokenRef, tokenRef.contractName, g.contractsMinDir, providerOpts);
                const isKYC = await c.isKYC(address);
                console.log(isKYC);
            } else if (cmd === 'grant') {
                const adminWallet = g.newWalletAtIndex(inventory.getDefaultWalletIndex('admin'), providerOpts);
                const signingContract = newContract(tokenRef, tokenRef.contractName, g.contractsMinDir, adminWallet);

                const isKYC = await signingContract.isKYC(address);
                if (isKYC) {
                    console.log(`address=${address} is already KYC enabled.`);
                    return;
                }

                /** @type {any} */
                const tx = await signingContract.grantKYC([address]);
                // wait for tx
                const txReceipt = await tx.wait(1);
                const evtTransfer = txReceipt.events.find(/** @param {any} event */(event) => event.event === 'RoleGranted');
                if (!evtTransfer) {
                    throw new Error(`Unknown event 'RoleGranted'`);
                }
                console.log(`address=${address} has been successfully granted the KYC role.`);
            } else if (cmd === 'revoke') {
                const adminWallet = g.newWalletAtIndex(inventory.getDefaultWalletIndex('admin'), providerOpts);
                const signingContract = newContract(tokenRef, tokenRef.contractName, g.contractsMinDir, adminWallet);
                if (adminWallet.address === address) {
                    throw new CodeError('Cannot revoke admin');
                }

                const isKYC = await signingContract.isKYC(address);
                if (!isKYC) {
                    console.log(`KYC role has already been revoked from address=${address}.`);
                    return;
                }

                /** @type {any} */
                const tx = await signingContract.revokeKYC([address]);
                // wait for tx
                const txReceipt = await tx.wait(1);
                const evtTransfer = txReceipt.events.find(/** @param {any} event */(event) => event.event === 'RoleRevoked');
                if (!evtTransfer) {
                    throw new Error(`Unknown event 'RoleRevoked'`);
                }
                console.log(`KYC role has been revoked successfully from address=${address}.`);
            }
        } catch (err) {
            this.exit(options, err);
        }
    }
}
