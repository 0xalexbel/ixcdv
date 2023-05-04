import assert from "assert";
import { Cmd } from "../Cmd.js";
import path from 'path';
import { Inventory } from "../../services/Inventory.js";
import { dirExists, errorDirDoesNotExist, fileExists, mkDirP, resolveAbsolutePath, saveToFile } from "../../common/fs.js";
import { CodeError } from "../../common/error.js";
import { ContractRef, DevContractRef, PoCoContractRef, PoCoHubRef } from "../../common/contractref.js";
import { Hub } from "../../contracts/Hub.js";
import { ethers, providers } from "ethers";
import { SharedReadonlyContracts } from "../../common/contracts/SharedReadonlyContracts.js";
import { PublicResolver } from "../../common/contracts/PublicResolver.js";
import { ENSRegistry } from "../../common/contracts/ENSRegistry.js";
import { FIFSRegistrar } from "../../common/contracts/FIFSRegistrar.js";
import { NULL_ADDRESS } from "../../common/ethers.js";
import { WORKERPOOL_URL_TEXT_RECORD_KEY } from "../../common/consts.js";

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

            // Retrieve the ganache service
            const g = await inventory._inv.newGanacheInstanceFromHubAlias(hubAlias);
            if (!g) {
                throw new CodeError('Unknown ganache config');
            }

            const hub = g.resolve(hubAlias);
            assert(hub);
            assert(hub.address);
            assert(hub.deployConfigName);
            assert(hub instanceof PoCoHubRef);

            const chainName = inventory._inv.hubAliasToChainName(hubAlias);
            const ensRef = g.resolveContractName('ENSRegistry', hub.deployConfigName);
            const publicResolverRef = g.resolveContractName('PublicResolver', hub.deployConfigName);

            assert(ensRef);
            assert(ensRef.address);
            assert(ensRef instanceof PoCoContractRef);
            assert(publicResolverRef);
            assert(publicResolverRef.address);
            assert(publicResolverRef instanceof PoCoContractRef);

            const providerOpts = { ensAddress: ensRef.address, networkName: chainName ?? 'unknown' };

            // resolveer = 0x1b964A645c634ffD7cD85FbfDF64176a912E592a
            //             0x1b964A645c634ffD7cD85FbfDF64176a912E592a
            // node = 0xfa864f6b1044d6c773fbc64f2818463ce044d89e542dadcbe177c7c09122212f
            //        0xfa864f6b1044d6c773fbc64f2818463ce044d89e542dadcbe177c7c09122212f
            // key = iexec:workerpool-api:url
            //       iexec:workerpool-api:url
            const hubContract = Hub.sharedReadOnly(hub, g.contractsMinDir, providerOpts);

            const wp = g.workerpool(hub.deployConfigName);
            assert(wp);
            const wpWallet = g.newWalletAtIndex(wp.accountIndex, providerOpts);
            const adminWallet = g.newWalletAtIndex(0, providerOpts);

            const ensRegistryContract = ENSRegistry.sharedReadOnly(ensRef, g.contractsMinDir, providerOpts);
            const publicResolverContract = await ensRegistryContract.getPublicResolver(wp.address);
            assert(publicResolverContract.address);


            const ensName0 = await ensRegistryContract.contract.provider.lookupAddress(wp.address);

            console.log('ens = ' + ensRef.address);
            console.log('admin = ' + adminWallet.address);
            console.log('workerpool = ' + wp.address);
            console.log('workerpool wallet = ' + wpWallet.address);
            console.log('hub = ' + hub.address);

            const o0 = await ensRegistryContract.nameOwner('eth');
            const o1 = await ensRegistryContract.nameOwner('iexec.eth');
            const c0 = await ensRegistryContract.baseProvider.getCode(o0);
            const c1 = await ensRegistryContract.baseProvider.getCode(o1);

            if (c1 === c0) {
                console.log('AAA');
            }

            const jeanjean = await ensRegistryContract.nameOwner('pools.iexec.eth');
            const fifsBase = await ensRegistryContract.getFIFSRegistrar('iexec.eth', adminWallet);

            // Create a new public domain named 'pipopuu.iexec.eth'
            const fifsPools = await ensRegistryContract.addFIFSRegistrar('pools', 'iexec.eth', publicResolverRef, adminWallet);
            // set mywp.pipopuu.iexec.eth = workerpool address
            await ensRegistryContract.registerAddress('mywp', 'pools.iexec.eth', wp.address, wpWallet);

            const ensName = await ensRegistryContract.baseProvider.lookupAddress(wp.address);
            assert(ensName === 'mywp.pools.iexec.eth');
            const wpAddr = await ensRegistryContract.baseProvider.resolveName(ensName);
            assert(wpAddr === wp.address);
            
            // Throw an error if failed
            const coreURL = inventory.getHubServiceURL('core', hubAlias);
            if (ensName) {
                if (coreURL.hostname === 'localhost') {
                    coreURL.hostname = '127.0.0.1';
                }
                await ensRegistryContract.setText(ensName, WORKERPOOL_URL_TEXT_RECORD_KEY, coreURL.toString(), wpWallet);
                const savedUrl = await ensRegistryContract.getText(ensName, WORKERPOOL_URL_TEXT_RECORD_KEY);
                assert(savedUrl === coreURL.toString());
            }

            let puip;


            //ensRegistryContract.getPublicResolver('pipopuu.iexec.eth');

            // await ensRegistryContract.registerAddress(
            //     'pipopuu',
            //     defaultWpDomain,
            //     wp.address,
            //     publicResolverContract.address,
            //     wpWallet);


            // console.log('ff2=' + ff2.address);
            // const o10 = await ensRegistryContract.nameOwner('pipopu.iexec.eth');
            // console.log('o10=' + o10);

            // const o8 = await ensRegistryContract.nameOwner('pipitch.iexec.eth');
            // const a = await ff.registerFIFSRegistrar('pipitch2');
            // const o9 = await ensRegistryContract.nameOwner('pipitch.iexec.eth');

            // await ff.register('plouf', adminWallet.address);
            // await ff.register('plouf', adminWallet.address);
            // const o4 = await ensRegistryContract.nameOwner('plouf.iexec.eth');


            // console.log('plouf.iexec.eth = ' + o4);

            // // FIFS 0xe8237Abfbcae9cc476FE72751a647086B6aacE81
            // // Transfer ownership of plouf to a new FiFsRegistrar
            // //const newaddr = await ff.deployNewAt('plouf.iexec.eth', adminWallet);
            // //console.log('plouf.iexec.eth = ' + newaddr);
            // await ensRegistryContract.setNameOwner('plouf.iexec.eth', '0xe8237Abfbcae9cc476FE72751a647086B6aacE81', adminWallet);

            // const o2 = await ensRegistryContract.nameOwner('jb.iexec.eth');
            // console.log('o2 = ' + o2);


            // const o3 = await ensRegistryContract.nameOwner('jb.iexec.eth');
            // console.log('o3 = ' + o3);
            // return;


            // //'pools.iexec.eth'
            // const label = 'pipo5';
            // const defaultWpDomain = 'iexec.eth';
            // const name = `${label}.${defaultWpDomain}`;

            // // Register defaultWpDomain
            // const ooo = await ensRegistryContract.nameOwner(defaultWpDomain);

            // // Make wpWallet the owner of 'url' name 'pipo4.iexec.eth'
            // await ensRegistryContract.registerDomain(label, defaultWpDomain, wpWallet.address, wpWallet);

            // // workerpool address -> ENS Name
            // const ensName0 = await ensRegistryContract.contract.provider.lookupAddress(wp.address);
            // assert(ensName0);

            // await ensRegistryContract.registerAddress(
            //     label,
            //     defaultWpDomain,
            //     wp.address,
            //     publicResolverContract.address,
            //     wpWallet);


            // const ensName1 = await ensRegistryContract.contract.provider.lookupAddress(wp.address);
            // assert(ensName1);

            // const WORKERPOOL_URL_TEXT_RECORD_KEY = 'iexec:workerpool-api:url';

            // await ensRegistryContract.setText(ensName1, WORKERPOOL_URL_TEXT_RECORD_KEY, "baba", wpWallet);
            // const v = await ensRegistryContract.getText(ensName1, WORKERPOOL_URL_TEXT_RECORD_KEY);

            // // pipo.iexec.eth
            // // label = pipo
            // // domain = iexec.eth
            // const domainOwner = await ensRegistryContract.nameOwner('iexec.eth');
            // if (! await isContract(ensRegistryContract.baseProvider, domainOwner)) {
            //     throw new CodeError('Invalid domain owner');
            // }




            //FIFSRegistrar.json

            // const FIFS_DOMAINS = {
            //     [APP]: 'apps.iexec.eth',
            //     [DATASET]: 'datasets.iexec.eth',
            //     [WORKERPOOL]: 'pools.iexec.eth',
            //     default: 'users.iexec.eth',
            //   };


            // export const registerFifsEns = async (
            //     contracts = throwIfMissing(),
            //     label = throwIfMissing(),
            //     domain = FIFS_DOMAINS.default,
            //   ) => {
            //     try {
            //       checkSigner(contracts);
            //       const vDomain = await ensDomainSchema().validate(domain);
            //       const vLabel = await ensLabelSchema().validate(label);
            //       let registerTxHash;
            //       const name = `${vLabel}.${vDomain}`;
            //       const labelHash = utils.id(vLabel);
            //       const address = await getAddress(contracts);
            //       const ownedBy = await getOwner(contracts, name);
            //       if (ownedBy === NULL_ADDRESS) {
            //         const domainOwner = await getOwner(contracts, vDomain);
            //         const domainOwnerCode = await wrapCall(
            //           contracts.provider.getCode(domainOwner),
            //         );
            //         if (domainOwnerCode === '0x') {
            //           throw Error(
            //             `The base domain ${vDomain} owner ${domainOwner} is not a contract`,
            //           );
            //         }
            //         const fifsRegistrarContract = new Contract(
            //           domainOwner,
            //           FIFSRegistrarAbi,
            //           contracts.signer,
            //         );
            //         const registerTx = await wrapSend(
            //           fifsRegistrarContract.register(labelHash, address, contracts.txOptions),
            //         );
            //         await wrapWait(registerTx.wait(contracts.confirms));
            //         registerTxHash = registerTx.hash;
            //       } else if (ownedBy.toLowerCase() === address.toLowerCase()) {
            //         debug(`${name} is already owned by current wallet ${ownedBy}`);
            //       } else {
            //         throw Error(`${name} is already owned by ${ownedBy}`);
            //       }
            //       return {
            //         registerTxHash,
            //         name,
            //       };
            //     } catch (e) {
            //       debug('registerFifsEns()', e);
            //       throw e;
            //     }
            //   };



            // // workerpool address -> ENS Name
            // const ensName = await ensRegistryContract.contract.provider.lookupAddress(wp.address);
            // assert(ensName);

            // // ensNameOwner === workerpool.owner
            // const ensNameOwner = await ensRegistryContract.nameOwner(ensName);

            // // ensNameResolver === deployconfig.PublicResolver
            // const ensNameResolver = await ensRegistryContract.nameResolver(ensName);

            // const publicResolver = PublicResolver.sharedReadOnly(ensNameResolver, g.contractsMinDir, providerOpts);





            // const aaa = await hubContract.contract.provider.getNetwork();
            // const resolver = await hubContract.baseProvider.getResolver(ensName);
            // assert(resolver);

            // let hh = 0;

            // const resolverRef = g.resolve(`${g.chainid}.${resolver.address}`, 'PublicResolver');
            // assert(resolverRef);
            // assert(resolverRef.address);
            // assert(resolverRef instanceof PoCoContractRef);

            // const ensNameHash = ethers.utils.namehash(ensName);
            // const ensAddress = ensRef.address;

            // const ensRegistryContract = SharedReadonlyContracts.get(
            //     ensRef, 
            //     ensRef.contractName, 
            //     g.contractsMinDir, 
            //     providerOpts);
            // const ownerAddr = await ensRegistryContract.owner(ensNameHash);
            // assert(typeof ownerAddr === 'string');

            let jjj = 0;


            // if (ownerAddr.toLowerCase() === wallet.address.toLowerCase()) {
            //     let kkk = 0;
            // }

            // const resolverRef = new PoCoContractRef({
            //     chainid: ensRef.chainid, 
            //     contractName: 'PublicResolver',
            //     address: resolver?.address,
            //     url: g.url
            // });
            // assert(resolverRef.contractName);

            //const publicResolver = PublicResolver.sharedReadOnly(resolverRef, g.contractsMinDir, providerOpts);
            //const sss  = publicResolver.contract;


            let jjjj = 0;
            // export const getOwner = async (
            //     contracts = throwIfMissing(),
            //     name = throwIfMissing(),
            //   ) => {
            //     try {
            //       const vName = await ensDomainSchema().validate(name);
            //       const nameHash = utils.namehash(vName);
            //       const ensAddress = await getEnsRegistryAddress(contracts);
            //       const ensRegistryContract = new Contract(
            //         ensAddress,
            //         abi,
            //         contracts.provider,
            //       );
            //       return await wrapCall(ensRegistryContract.owner(nameHash));
            //     } catch (e) {
            //       debug('getOwner()', e);
            //       throw e;
            //     }
            //   };

            // make sure signer address === contract owner
            // assert(wallet.address === )

            // const ownedBy = await getOwner(contracts, vName);
            // const userAddress = await getAddress(contracts);
            // if (ownedBy !== userAddress) {
            // throw Error(
            //     `${userAddress} is not authorised to set a text record for ${vName}`,
            // );
            // }

            // export const setWorkerpoolApiUrl = async (
            //     contracts = throwIfMissing(),
            //     workerpoolAddress,
            //     url,
            //   ) => {
            //     try {
            //       const vAddress = await addressSchema({
            //         ethProvider: contracts.provider,
            //       }).validate(workerpoolAddress);
            //       const vUrl = await workerpoolApiUrlSchema()
            //         .label('workerpool API url')
            //         .validate(url);
            //       const name = await lookupAddress(contracts, vAddress);
            //       if (!name) {
            //         throw Error(`No ENS name reverse resolution configured for ${vAddress}`);
            //       }
            //       return await setTextRecord(
            //         contracts,
            //         name,
            //         WORKERPOOL_URL_TEXT_RECORD_KEY,
            //         vUrl,
            //       );
            //     } catch (e) {
            //       debug('setWorkerpoolApiUrl()', e);
            //       throw e;
            //     }
            //   };

            // export const setTextRecord = async (
            //     contracts = throwIfMissing(),
            //     name,
            //     key,
            //     value = '',
            //   ) => {
            //     try {
            //       const vName = await ensDomainSchema().validate(name);
            //       const vKey = await textRecordKeySchema().validate(key);
            //       const vValue = await textRecordValueSchema().validate(value);
            //       const node = utils.namehash(vName);
            //       const currentResolver = await wrapCall(
            //         contracts.provider.getResolver(vName),
            //       );
            //       const isResolverSet =
            //         currentResolver &&
            //         currentResolver.address &&
            //         currentResolver.address !== NULL_ADDRESS;
            //       if (!isResolverSet) {
            //         throw Error(`No resolver is configured for ${vName}`);
            //       }
            //       const ownedBy = await getOwner(contracts, vName);
            //       const userAddress = await getAddress(contracts);
            //       if (ownedBy !== userAddress) {
            //         throw Error(
            //           `${userAddress} is not authorised to set a text record for ${vName}`,
            //         );
            //       }
            //       const resolverContract = new Contract(
            //         currentResolver.address,
            //         abi,
            //         contracts.signer,
            //       );
            //       const tx = await wrapSend(resolverContract.setText(node, vKey, vValue));
            //       await wrapWait(tx.wait(contracts.confirms));
            //       return tx.hash;
            //     } catch (e) {
            //       debug('setTextRecord()', e);
            //       throw e;
            //     }
            //   };


            // export const getEnsRegistryAddress = async (contracts = throwIfMissing()) => {
            //     try {
            //       const { ensAddress } = await wrapCall(contracts.provider.getNetwork());
            //       if (!ensAddress) {
            //         throw new ConfigurationError('Network does not support ENS');
            //       }
            //       return ensAddress;
            //     } catch (e) {
            //       debug('getEnsRegistryAddress()', e);
            //       throw e;
            //     }
            //   };


            //             const g = await inventory._inv.newGanacheInstanceFromHubAlias(hubAlias);
            //             if (!g) {
            //                 throw new CodeError('Unknown ganache config');
            //             }

            //             // directory = path to directory where chain.json file should be created
            //             if (!directory) {
            //                 directory = process.cwd();
            //             }

            //             console.log(directory);


            //             let f;
            //             let k;
            //             let idx;

            //             idx = inventory.getDefaultWalletIndex('app');
            //             f = await g.walletFileAtIndex(idx);
            //             k = g.walletKeysAtIndex(idx);
            //             const cli_wallet = `--keystoredir ${path.dirname(f)} --wallet-file ${path.basename(f)} --password ${g.walletsPassword}`;
            //             const cli_chain = `--chain ${chainName}`;
            //             console.log( "iexec app show " + cli_wallet + " " + cli_chain + " 0" );
            //             console.log( "iexec app show --user " + k.address + " " + cli_chain + " 0" );
            //             console.log( "iexec app count --user " + k.address + " " + cli_chain + " 0" );

            //             console.log( "iexec app publish " + cli_wallet + " " + cli_chain );

            //             // iexec app show 
            // //0xeCF7b1A7cEd377d29Dfa4c69Aeaabd82fD331f15

            //             // const chainJsonDir = resolveAbsolutePath(directory);
            //             // const chainJsonPath = path.join(chainJsonDir, 'chain.json');
            //             // if (fileExists(chainJsonPath)) {
            //             //     if (!options.force) {
            //             //         throw new CodeError(`'chain.json' file already exists in directory ${chainJsonDir}`);
            //             //     }
            //             // }
            //             // if (!dirExists(chainJsonDir)) {
            //             //     if (!options.force) {
            //             //         throw errorDirDoesNotExist(chainJsonDir);
            //             //     }
            //             // }

            //             // const chainJson = await inventory._inv.getChainsJSON();
            //             // const chainJsonStr = JSON.stringify(chainJson, null, 2);

            //             // mkDirP(chainJsonDir, { strict: true });
            //             // saveToFile(chainJsonStr, chainJsonDir, 'chain.json');

        } catch (err) {
            this.exit(options, err);
        }
    }
}
