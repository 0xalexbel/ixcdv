import assert from 'assert';
import * as cTypes from '../../../contracts/contracts-types-internal.js';
import path from 'path';
import { Cmd } from "../../Cmd.js";
import { CodeError } from '../../../common/error.js';
import { Inventory } from '../../../services/Inventory.js';
import { dirExists, errorDirDoesNotExist, fileExists, fileExistsInDir, getTemplatesDir, mkDirP, pathIsPOSIXPortable, readObjectFromJSONFile, replaceInFile, resolveAbsolutePath, saveToFile, throwIfFileDoesNotExist } from '../../../common/fs.js';
import { computeIExecAppEntry } from '../../../contracts/app-generator.js';
import { isDeepStrictEqual } from 'util';
import { PoCoContractRef, PoCoHubRef } from '../../../common/contractref.js';
import { Hub } from '../../../contracts/Hub.js';

export default class AppInitCmd extends Cmd {

    static cmdname() { return 'app_init'; }

    /**
     * @param {string} cliDir 
     * @param {string} directory 
     * @param {*} options 
     */
    async cliExec(cliDir, directory, options) {
        try {
            if (!directory) {
                directory = cliDir;
            }
            if (options.dockerRepo && options.dockerRepoDir) {
                throw new CodeError('Options --docker-repo and --docker-repo-dir are mutually exclusive.')
            }
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

            if (!dirExists(directory)) {
                throw errorDirDoesNotExist(directory);
            }
            directory = resolveAbsolutePath(directory);

            const outDir = options.out ?? cliDir;
            if (!dirExists(outDir)) {
                if (options.force !== true) {
                    throw errorDirDoesNotExist(outDir);
                }
            }

            const appWallet = g.walletKeysAtIndex(inventory.getDefaultWalletIndex('app'));

            let iExecAppEntry = await computeIExecAppEntry(
                directory, /* app directory */
                appWallet.address, /* app owner */
                { ...options, dockerUrl: inventory._inv.getDockerUrl() },
                true /* rebuildDockerImage */);

            const chainName = inventory._inv.hubAliasToChainName(hubAlias);

            const ensRef = g.resolve(hubAlias, 'ENSRegistry');
            assert(ensRef);
            assert(ensRef.address);
            assert(ensRef instanceof PoCoContractRef);

            const providerOpts = { ensAddress: ensRef.address, networkName: chainName ?? 'unknown' };

            const hubContract = Hub.sharedReadOnly(hubRef, g.contractsMinDir, providerOpts);
            const appRegistry = await hubContract.appRegistry();
            const appEntry = await appRegistry.getEntry(iExecAppEntry);

            console.log(JSON.stringify(iExecAppEntry, null, 2));

            let loadedIExecJson = await readObjectFromJSONFile(path.join(outDir, 'iexec.json'));
            if (!loadedIExecJson) {
                loadedIExecJson = {};
            }
            if (loadedIExecJson.app) {
                if (!isDeepStrictEqual(loadedIExecJson.app, iExecAppEntry)) {
                    if (options.force !== true) {
                        throw new CodeError('iexec.json app entry already exist, use --force option to override it.');
                    }
                }
            }
            loadedIExecJson.app = iExecAppEntry;
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
            if (appEntry) {
                if (!loadedDeployedJson.app) {
                    loadedDeployedJson.app = {};
                }
                loadedDeployedJson.app[g.chainid] = appEntry.address;
            }
            if (!loadedDeployedJson.workepool) {
                loadedDeployedJson.workerpool = {};
            }
            loadedDeployedJson.workerpool[g.chainid] = workerpool.address;

            await saveToFile(JSON.stringify(loadedDeployedJson, null, 2), outDir, 'deployed.json', { strict: true });
        } catch (err) {
            this.exit(options, err);
        }
    }
}

