import * as types from '../common/common-types.js';
import * as srvTypes from './services-types-internal.js';
import * as cTypes from '../contracts/contracts-types-internal.js';
import assert from 'assert';
import { Inventory } from "./Inventory.js";
import { SmsService } from './Sms.js';
import { ResultProxyService } from './ResultProxy.js';
import { Wallet } from 'ethers';
import { DevContractRef, PoCoContractRef, PoCoHubRef } from '../common/contractref.js';
import { CodeError } from '../common/error.js';
import { SharedJsonRpcProviders } from '../common/shared-json-rpc-providers.js';
import { isNullishOrEmptyString } from '../common/string.js';
import { genRandomSalt } from '../common/ethers.js';
import { sleep } from '../common/utils.js';
import { Hub } from '../contracts/Hub.js';
import { HubBase } from '../contracts/HubBase.js';
import { Deal } from '../contracts/Deal.js';

/** 
    @typedef {{ 
        hub: string | PoCoHubRef | types.PoCoHubRefLike
        tee?: boolean,
        trust?: number,
        args?: string,
        inputFiles?: string[],
        requesterWallet?: Wallet,
        appWallet?: Wallet,
        appDir: string,
        appName: string,
        appOrderSalt?: string,
        appDockerfile: string,
        appDockerRepo?: string,
        appDockerTag?: string,
        datasetWallet?: Wallet,
        datasetFile?: string,
        datasetKey?: string,
        datasetName?: string,
        datasetOrderSalt?: string,
        workerpoolWallet?: Wallet,
        workerpoolAddress?: string,
     }} RunArgs
*/

/**
 * @param {Inventory} inventory 
 * @param {RunArgs} args
 */
export async function runIexecApp(inventory, args) {
    const salt1 = "0x0000000000000000000000000000000000000000000000000000000000000001";

    const hubAlias = DevContractRef.toHubAlias(args.hub);
    const { chainid, deployConfigName } = DevContractRef.fromHubAlias(hubAlias);
    assert(deployConfigName);

    const tee = (args.tee === true);
    const requestTrust = args.trust ?? 1;

    const workerpoolTrust = args.trust ?? 1;

    const appDir = args.appDir;
    const appName = args.appName;
    const appDockerRepo = args.appDockerRepo;
    const appDockerTag = args.appDockerTag;
    const appDockerfile = args.appDockerfile;
    const appRebuildImage = true;
    const appSalt = args.appOrderSalt ?? salt1;

    assert(appDockerRepo);
    assert(appDockerTag);
    assert(appDockerfile);
    
    const datasetFile = args.datasetFile;
    const datasetSalt = (args.datasetFile) ? (args.datasetOrderSalt ?? salt1) : null;
    const datasetName = args.datasetName;

    // Retrieve the ganache service
    const g = await inventory._inv.newGanacheInstanceFromHubAlias(hubAlias);
    if (!g) {
        throw new CodeError('Unknown ganache config');
    }

    // Resolve the hub contract ref
    const hubRef = g.resolve(hubAlias);
    assert(hubRef);
    assert(hubRef.address);
    assert(hubRef instanceof PoCoHubRef);

    const chainName = inventory._inv.hubAliasToChainName(hubAlias);

    const ensRef = g.resolve(hubAlias, 'ENSRegistry');
    assert(ensRef);
    assert(ensRef.address);
    assert(ensRef instanceof PoCoContractRef);

    const providerOpts = { ensAddress: ensRef.address, networkName: chainName ?? 'unknown' };

    const requesterWallet =
        args.requesterWallet ??
        g.newWalletAtIndex(inventory.getDefaultWalletIndex('requester'), providerOpts);

    const appWallet =
        args.appWallet ??
        g.newWalletAtIndex(inventory.getDefaultWalletIndex('app'), providerOpts);

    let datasetWallet = null;
    if (datasetFile) {
        datasetWallet =
            args.datasetWallet ??
            g.newWalletAtIndex(inventory.getDefaultWalletIndex('dataset'), providerOpts);
    }

    let workerpoolWallet = args.workerpoolWallet;
    let workerpoolAddress = args.workerpoolAddress;

    if (!workerpoolWallet || !workerpoolAddress) {
        const workerpool = g.workerpool(deployConfigName);
        if (!workerpool) {
            throw new CodeError(`Invalid deploy config name '${deployConfigName}'`);
        }
        if (!workerpoolAddress) {
            workerpoolAddress = workerpool.address;
        }
        if (!workerpoolWallet) {
            workerpoolWallet = new Wallet(
                g.walletKeysAtIndex(workerpool.accountIndex).privateKey,
                SharedJsonRpcProviders.fromContractRef(hubRef, providerOpts));
        }
    }

    if (!workerpoolAddress || isNullishOrEmptyString(workerpoolAddress)) {
        throw new CodeError('Missing workerpool address');
    }
    if (!workerpoolWallet) {
        throw new CodeError('Missing workerpool wallet');
    }

    const dockerUrl = inventory.getDockerUrl();

    const ipfs = await inventory._inv.newIpfsInstance();
    if (!ipfs || !ipfs.ipfsDir) {
        throw new CodeError('Missing Ipfs service');
    }

    //iexec dataset push-secret [datasetAddress]
    const sms = await inventory.newInstanceFromHub('sms', hubAlias);
    if (!sms) {
        throw new CodeError('Missing Sms service');
    }
    assert(sms instanceof SmsService); //compiler

    const resultproxy = await inventory.newInstanceFromHub('resultproxy', hubAlias);
    if (!resultproxy) {
        throw new CodeError('Missing Result Proxy service');
    }
    assert(resultproxy instanceof ResultProxyService);

    const ok = await sms.checkIpfsSecret(requesterWallet.address);
    if (!ok) {
        const secret = await resultproxy.login(requesterWallet);
        const { isPushed, isUpdated } = await sms.pushIpfsSecret(requesterWallet, secret, false);
        assert(isPushed);
    }

    const hubContract = Hub.sharedReadOnly(hubRef, g.contractsMinDir, providerOpts);

    const appRegistry = await hubContract.appRegistry();
    // Will compute the MREnclave if needed
    const newApp = await appRegistry.newEntryFromDockerfile(
        {
            tee,
            name: appName,
            dockerfile: appDockerfile,
            dockerRepo: appDockerRepo,
            dockerTag: appDockerTag,
            dockerUrl,
            rebuildDockerImage: appRebuildImage
        },
        appWallet);

    if (!newApp) {
        throw new CodeError(`Failed to add app to hub's app registry. (${appDir})`);
    }

    /** @type {cTypes.tag} */
    const tag = (tee) ? ["tee"] : [];

    // Create an infinite appOrder
    const appOrder = await hubContract.newAppOrder({
        app: newApp,
        tag,
        volume: 1000000 //infinite
    });

    let datasetOrder = null;
    if (datasetFile) {
        if (!datasetWallet) {
            throw new CodeError('Missing dataset wallet');
        }

        const datasetRegistry = await hubContract.datasetRegistry();
        const newDataset = await datasetRegistry.newEntryFromFile(
            {
                name: datasetName,
                file: datasetFile,
                ipfs
            },
            datasetWallet);

        if (!newDataset) {
            throw new CodeError(`Failed to add dataset to hub's dataset registry. (${datasetFile})`);
        }

        if (tee) {
            // In Tee mode only
            if (isNullishOrEmptyString(args.datasetKey)) {
                throw new CodeError("Missing --dataset-key option");
            }
            assert(args.datasetKey);
            const datasetEncryptionKey = args.datasetKey;
            assert(newDataset.address);
            const ok = await sms.checkDatasetSecret(newDataset.address);
            if (!ok) {
                // Must compute the dataset encryption key
                const { isPushed, isUpdated } = await sms.pushDatasetSecret(
                    datasetWallet, 
                    newDataset.address, 
                    datasetEncryptionKey);
                assert(isPushed);
            }
        }

        datasetOrder = await hubContract.newDatasetOrder({
            dataset: newDataset,
            tag,
            volume: 1000000 //infinite
        });
    }

    // Create a single workerpoolOrder
    const workerpoolOrder = await hubContract.newWorkerpoolOrder({
        workerpool: workerpoolAddress,
        trust: workerpoolTrust,
        tag,
        volume: 1 //default
    });
    const workerpoolSalt = genRandomSalt();

    /** @type {cTypes.RequestOrderLike} */
    const ro = {
        app: newApp,
        dataset: datasetOrder?.dataset,
        workerpool: workerpoolOrder.workerpool,
        requester: requesterWallet.address,
        volume: 1,
        tag,
        trust: requestTrust,
        params: {
            //"iexec_args": "",
            //"iexec_input_files": "",
            "iexec_result_storage_provider": "ipfs",
            "iexec_result_storage_proxy": resultproxy.urlString
        }
    };

    assert(ro.params);
    if (!isNullishOrEmptyString(args.args)) {
        assert(args.args);
        ro.params.iexec_args = args.args;
    }
    if (args.inputFiles &&
        Array.isArray(args.inputFiles) &&
        args.inputFiles.length > 0) {
        ro.params.iexec_input_files = [...args.inputFiles];
    }

    // if (args.args) {
    //     const _args = [];
    //     for (let i = 0; i < args.args.length; ++i) {
    //         const a = args.args[i];
    //         const hasWhitespace = (a.indexOf(' ') >= 0);
    //         const hasQuote = (a.indexOf("'") >= 0);
    //         const hasDoubleQuote = (a.indexOf('"') >= 0);
    //         if (!hasWhitespace) {
    //             _args.push(a);
    //         } else if (!hasQuote) {
    //             _args.push("'" + a + "'");
    //         } else if (!hasDoubleQuote) {
    //             _args.push('"' + a + '"');
    //         } else {
    //             throw new CodeError(`Invalid args syntax = '${args.args}'`);
    //         }
    //     }
    //     assert(ro.params);
    //     ro.params.iexec_args = _args.join(' ');
    // }

    // Create a single requestOrder
    const requestOrder = await hubContract.newRequestOrder(ro);
    const requestSalt = genRandomSalt();

    // iexec app run (uses matchorders)
    const deal = await hubContract.matchOrders(
        {
            appOrder,
            appOrderSalt: appSalt,
            appOrderSigner: appWallet,
            datasetOrder,
            datasetOrderSalt: datasetSalt,
            datasetOrderSigner: datasetWallet,
            workerpoolOrder,
            workerpoolOrderSalt: workerpoolSalt,
            workerpoolOrderSigner: workerpoolWallet,
            requestOrder,
            requestOrderSalt: requestSalt,
        },
        requesterWallet);

    return { hubContract, deal };
}

/**
 * @param {HubBase} hubContract 
 * @param {types.bytes32string | Deal} dealidOrDeal 
 * @param {number} taskidx 
 * @param {types.progressCallback} progressCb
 */
export async function waitUntilTaskCompleted(hubContract, dealidOrDeal, taskidx, progressCb) {
    let i = 0;
    while (i <= 100) {
        const t = await hubContract.viewTaskAt(dealidOrDeal, taskidx);

        if (t.status === 'COMPLETED') {
            i = 100;
        }

        progressCb({ count: i, total: 100, value: t });

        if (i >= 100) {
            return t;
        }

        await sleep(2000);
        i++;
    }

    throw new CodeError('Failed to wait for task completion');
}
