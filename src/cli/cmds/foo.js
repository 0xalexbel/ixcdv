import assert from "assert";
import { Cmd } from "../Cmd.js";
import path from 'path';
import { Inventory } from "../../services/Inventory.js";
import { dirExists, errorDirDoesNotExist, fileExists, mkDirP, resolveAbsolutePath, saveToFile } from "../../common/fs.js";
import { CodeError } from "../../common/error.js";

export default class FooCmd extends Cmd {

    static cmdname() { return 'foo'; }

    /**
     * @param {string} cliDir 
     * @param {string | undefined} directory 
     * @param {*} options 
     */
    async cliExec(cliDir, directory, options) {
        try {
            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);
            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir);

            const hubAlias = inventory._inv.guessHubAlias(options);
            const chainName = inventory._inv.hubAliasToChainName(hubAlias);
            assert(chainName);

            const g = await inventory._inv.newGanacheInstanceFromHubAlias(hubAlias);
            if (!g) {
                throw new CodeError('Unknown ganache config');
            }

            // directory = path to directory where chain.json file should be created
            if (!directory) {
                directory = process.cwd();
            }

            console.log(directory);


            let f;
            let k;
            let idx;

            idx = inventory.getDefaultWalletIndex('app');
            f = await g.walletFileAtIndex(idx);
            k = g.walletKeysAtIndex(idx);
            const cli_wallet = `--keystoredir ${path.dirname(f)} --wallet-file ${path.basename(f)} --password ${g.walletsPassword}`;
            const cli_chain = `--chain ${chainName}`;
            console.log( "iexec app show " + cli_wallet + " " + cli_chain + " 0" );
            console.log( "iexec app show --user " + k.address + " " + cli_chain + " 0" );
            console.log( "iexec app count --user " + k.address + " " + cli_chain + " 0" );

            console.log( "iexec app publish " + cli_wallet + " " + cli_chain );

            // iexec app show 
//0xeCF7b1A7cEd377d29Dfa4c69Aeaabd82fD331f15

            // const chainJsonDir = resolveAbsolutePath(directory);
            // const chainJsonPath = path.join(chainJsonDir, 'chain.json');
            // if (fileExists(chainJsonPath)) {
            //     if (!options.force) {
            //         throw new CodeError(`'chain.json' file already exists in directory ${chainJsonDir}`);
            //     }
            // }
            // if (!dirExists(chainJsonDir)) {
            //     if (!options.force) {
            //         throw errorDirDoesNotExist(chainJsonDir);
            //     }
            // }

            // const chainJson = await inventory._inv.getChainsJSON();
            // const chainJsonStr = JSON.stringify(chainJson, null, 2);

            // mkDirP(chainJsonDir, { strict: true });
            // saveToFile(chainJsonStr, chainJsonDir, 'chain.json');

        } catch (err) {
            this.exit(options, err);
        }
    }
}
