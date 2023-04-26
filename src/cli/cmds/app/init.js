import assert from 'assert';
import * as cTypes from '../../../contracts/contracts-types-internal.js';
import path from 'path';
import { Cmd } from "../../Cmd.js";
import { CodeError } from '../../../common/error.js';
import { Inventory } from '../../../services/Inventory.js';
import { dirExists, errorDirDoesNotExist, errorFileDoesNotExist, fileExists, mkDirP, readObjectFromJSONFile, resolveAbsolutePath, saveToFile } from '../../../common/fs.js';
import { stringIsPOSIXPortable } from '../../../common/string.js';
import { computeDockerChecksumAndMultiaddr } from '../../../contracts/app-generator.js';
import { isDeepStrictEqual } from 'util';
import { PoCoHubRef } from '../../../common/contractref.js';
import { Hub } from '../../../contracts/Hub.js';
import { dockerAppName } from '../../../common/consts.js';

export default class AppInitCmd extends Cmd {

    static cmdname() { return 'app_init'; }

    /**
     * @param {string} cliDir 
     * @param {string} directory 
     * @param {*} options 
     */
    async cliExec(cliDir, directory, options) {
        try {
            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);
            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir);

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

            const appWallet = g.walletKeysAtIndex(inventory.getDefaultWalletIndex('app'));

            if (!dirExists(directory)) {
                throw errorDirDoesNotExist(directory);
            }
            directory = resolveAbsolutePath(directory);

            const outDir = options.out ?? process.cwd();
            if (!dirExists(outDir)) {
                if (options.force !== true) {
                    throw errorDirDoesNotExist(outDir);
                }
            }

            const dockerfilePath = path.join(directory, 'Dockerfile');
            if (!fileExists(dockerfilePath)) {
                throw errorFileDoesNotExist(dockerfilePath);
            }

            if (!stringIsPOSIXPortable(options.name)) {
                throw new CodeError(`Invalid app name '${options.name}'`);
            }

            const dockerImageName = options.name;
            const dockerUrl = inventory._inv.getDockerUrl();
            const appDockerRepo = dockerAppName(dockerImageName);
            const rebuildDockerImage = true;

            // compute app multiaddr & checksum
            const appMC = await computeDockerChecksumAndMultiaddr(
                directory, /* app dockerfile dir */
                appDockerRepo, /* app docker repo */
                '1.0.0', /* app docker tag */
                dockerUrl, /* docker registry url */
                rebuildDockerImage ?? false /* rebuild docker image */
            );

            /** @type {cTypes.App} */
            const iExecAppEntry = {
                owner: appWallet.address,
                name: appDockerRepo,
                type: "DOCKER",
                checksum: appMC.checksum,
                multiaddr: appMC.multiaddr,
                //mrenclave:undefined
            }

            const hubContract = Hub.sharedReadOnly(hubRef, g.contractsMinDir);
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

