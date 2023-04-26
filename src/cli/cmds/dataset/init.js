import assert from 'assert';
import * as cTypes from '../../../contracts/contracts-types-internal.js';
import path from 'path';
import { Cmd } from "../../Cmd.js";
import { CodeError } from '../../../common/error.js';
import { Inventory } from '../../../services/Inventory.js';
import { dirExists, errorDirDoesNotExist, errorFileDoesNotExist, fileExists, mkDirP, readObjectFromJSONFile, resolveAbsolutePath, saveToFile } from '../../../common/fs.js';
import { isDeepStrictEqual } from 'util';
import { computeIpfsChecksumAndMultiaddr } from '../../../contracts/dataset-generator.js';
import { PoCoHubRef } from '../../../common/contractref.js';
import { Hub } from '../../../contracts/Hub.js';

export default class DatasetInitCmd extends Cmd {

    static cmdname() { return 'dataset_init'; }

    /**
     * @param {string} cliDir 
     * @param {string} datasetFile 
     * @param {*} options 
     */
    async cliExec(cliDir, datasetFile, options) {
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

            const datasetWallet = g.walletKeysAtIndex(inventory.getDefaultWalletIndex('dataset'));

            if (!fileExists(datasetFile)) {
                throw errorFileDoesNotExist(datasetFile);
            }
            datasetFile = resolveAbsolutePath(datasetFile);

            const outDir = options.out ?? process.cwd();
            if (!dirExists(outDir)) {
                if (options.force !== true) {
                    throw errorDirDoesNotExist(outDir);
                }
            }

            const ipfs = await inventory._inv.newIpfsInstance();
            if (!ipfs || !ipfs.ipfsDir) {
                throw new CodeError('Missing Ipfs service');
            }

            // dataset multiaddr & checksum
            const datasetMC = await computeIpfsChecksumAndMultiaddr(
                datasetFile, /* dataset file */
                ipfs.ipfsDir
            );

            const outIpfs = await ipfs.addFile(datasetFile);
            // modify
            datasetMC.multiaddr = outIpfs.url.toString();

            /** @type {cTypes.Dataset} */
            const iExecDatasetEntry = {
                owner: datasetWallet.address,
                name: path.basename(datasetFile),
                checksum: datasetMC.checksum,
                multiaddr: datasetMC.multiaddr
            }

            const hubContract = Hub.sharedReadOnly(hubRef, g.contractsMinDir);
            const datasetRegistry = await hubContract.datasetRegistry();
            const datasetEntry = await datasetRegistry.getEntry(iExecDatasetEntry);

            console.log(JSON.stringify(iExecDatasetEntry, null, 2));

            let loadedIExecJson = await readObjectFromJSONFile(path.join(outDir, 'iexec.json'));
            if (!loadedIExecJson) {
                loadedIExecJson = {};
            }
            if (loadedIExecJson.dataset) {
                if (!isDeepStrictEqual(loadedIExecJson.dataset, iExecDatasetEntry)) {
                    if (options.force !== true) {
                        throw new CodeError('iexec.json dataset entry already exist, use --force option to override it.');
                    }
                }
            }
            loadedIExecJson.dataset = iExecDatasetEntry;
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
            if (datasetEntry) {
                if (!loadedDeployedJson.dataset) {
                    loadedDeployedJson.dataset = {};
                }
                loadedDeployedJson.dataset[g.chainid] = datasetEntry.address;
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

