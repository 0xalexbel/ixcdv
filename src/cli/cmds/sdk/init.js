import assert from 'assert';
import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as cTypes from '../../../contracts/contracts-types-internal.js';
import path from 'path';
import { Cmd } from "../../Cmd.js";
import { CodeError } from '../../../common/error.js';
import { Inventory } from '../../../services/Inventory.js';
import { dirExists, errorDirDoesNotExist, exists, isSymLinkSync, lns, mkDirP, readObjectFromJSONFile, rmrf, saveToFile } from '../../../common/fs.js';
import { PoCoHubRef } from '../../../common/contractref.js';

export default class SdkInitCmd extends Cmd {

    static cmdname() { return 'sdk_init'; }

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

            const hubAlias = inventory._inv.guessHubAlias(options);
            const g = await inventory._inv.newGanacheInstanceFromHubAlias(hubAlias);
            if (!g) {
                throw new CodeError('Unknown ganache config');
            }
            const hubRef = g.resolve(hubAlias);
            assert(hubRef instanceof PoCoHubRef);
            assert(hubRef.deployConfigName);

            const workerpool = g.workerpool(hubRef.deployConfigName);
            assert(workerpool?.description);

            /** @type {cTypes.Workerpool} */
            const iExecWorkerpoolEntry = {
                owner: g.walletKeysAtIndex(workerpool.accountIndex).address,
                description: workerpool.description,
            }

            const outDir = options.out ?? process.cwd();
            if (!dirExists(outDir)) {
                if (options.force !== true) {
                    throw errorDirDoesNotExist(outDir);
                }
            }

            let loadedIExecJson = await readObjectFromJSONFile(path.join(outDir, 'iexec.json'));
            if (!loadedIExecJson) {
                loadedIExecJson = {};
            }
            loadedIExecJson.workerpool = iExecWorkerpoolEntry;

            // create 'chain.json' (required to execute any 'iexec' sdk command)
            const chainJson = await inventory._inv.getChainsJSON();

            // create out directory if it does not exist
            mkDirP(outDir);

            await saveToFile(JSON.stringify(loadedIExecJson, null, 2), outDir, 'iexec.json', { strict: true });
            await saveToFile(JSON.stringify(chainJson, null, 2), outDir, 'chain.json', { strict: true });

            // Generate 'deployed.json'
            let loadedDeployedJson = await readObjectFromJSONFile(path.join(outDir, 'deployed.json'));
            if (!loadedDeployedJson) {
                loadedDeployedJson = {};
            }
            if (!loadedDeployedJson.workepool) {
                loadedDeployedJson.workerpool = {};
            }
            loadedDeployedJson.workerpool[g.chainid] = workerpool.address;

            await saveToFile(JSON.stringify(loadedDeployedJson, null, 2), outDir, 'deployed.json', { strict: true });

            try {
                // Unlink any existing symbolic link to wallets directory
                const walletsDir = path.join(outDir, 'wallets');
                if (exists(walletsDir)) {
                    if (isSymLinkSync(walletsDir)) {
                        await fsPromises.unlink(walletsDir);
                    }
                }

                if (!exists(walletsDir)) {
                    // Throw exception if something already exists
                    await lns(g.walletsDir, path.join(outDir, 'wallets'));
                }
            } catch (err) {
                throw new CodeError('Could not create symbolic link to wallets directory.');
            }
        } catch (err) {
            this.exit(options, err);
        }
    }
}

