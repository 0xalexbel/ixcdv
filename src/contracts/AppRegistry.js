// Dependencies
// ../common
// ../docker
import * as types from "../common/common-types.js";
import * as cTypes from './contracts-types-internal.js';
import assert from 'assert';
import { BigNumber, Wallet, Contract } from "ethers";
import { Registry, RegistryConstructorGuard, registryEntryAtIndex, registryEntryOfOwnerAtIndex } from "./Registry.js";
import { SharedReadonlyContracts } from '../common/contracts/SharedReadonlyContracts.js';
import { ContractBase } from '../common/contracts/ContractBase.js';
import { MultiaddrEx } from './MultiaddrEx.js';
import { AppRegistryEntry } from './AppRegistryEntry.js';
import { computeDockerChecksumAndMultiaddr, computeMREnclave } from './app-generator.js';
import { ContractRef, newContract } from '../common/contractref.js';
import { ERC721TokenIdToAddress, NULL_ADDRESS, toChecksumAddress, toTxArgs } from '../common/ethers.js';
import { CodeError } from '../common/error.js';
import { throwIfNullishOrEmptyString } from "../common/string.js";
import { throwIfFileDoesNotExist } from "../common/fs.js";

export const AppRegistryConstructorGuard = { value: false };

export class AppRegistry extends Registry {

    /**
     * @param {Contract} contract 
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     */
    constructor(contract, contractRef, contractDir) {
        if (!AppRegistryConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }

        assert(!RegistryConstructorGuard.value);
        RegistryConstructorGuard.value = true;
        super(contract, contractRef, contractDir);
        RegistryConstructorGuard.value = false;
    }

    /**
     * @param {Contract} contract 
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     */
    static #newAppRegistry(contract, contractRef, contractDir) {
        assert(!AppRegistryConstructorGuard.value);
        AppRegistryConstructorGuard.value = true;
        const o = new AppRegistry(contract, contractRef, contractDir);
        AppRegistryConstructorGuard.value = false;
        return o;
    }

    /**
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     * @param {{
     *      ensAddress: string
     *      networkName: string
     * }} options 
     */
    static sharedReadOnly(contractRef, contractDir, options) {
        const c = SharedReadonlyContracts.get(contractRef, 'AppRegistry', contractDir, options);
        return AppRegistry.#newAppRegistry(c, contractRef, contractDir);
    }

    /**
     * @param {string} address 
     * @param {ContractBase} baseContract 
     */
    static fromAddr(address, baseContract) {
        assert(baseContract);

        const contractRef = new ContractRef({
            chainid: baseContract.chainid,
            contractName: 'AppRegistry',
            address: address,
            url: baseContract.url
        });

        if (baseContract.isSharedReadOnly) {
            return AppRegistry.sharedReadOnly(
                contractRef,
                baseContract.contractDir,
                baseContract.network);
        }

        const newC = newContract(
            contractRef,
            'AppRegistry',
            baseContract.contractDir,
            baseContract.signerOrProvider);

        return AppRegistry.#newAppRegistry(newC, contractRef, baseContract.contractDir);
    }

    /**
     * @param {Wallet} wallet 
     */
    newSigningContract(wallet) {
        return newContract(this.contractRef, 'AppRegistry', this.contractDir, wallet);
    }

    /**
     * Converts a MREnclave object to string
     * @param {?cTypes.MREnclave=} mrenclaveObj 
     */
    static MREnclaveToString(mrenclaveObj) {
        assert(typeof mrenclaveObj == 'object');
        if (mrenclaveObj == null || mrenclaveObj == undefined) {
            return '';
        }
        return JSON.stringify(mrenclaveObj);
    }

    /**
     * Converts a MREnclave object to utf8 buffer
     * @param {?cTypes.MREnclave=} mrenclaveObj 
     */
    static MREnclaveToUtf8Buffer(mrenclaveObj) {
        console.error("*********************************************");
        console.error("* TODO: check how MREnclave is encoded !!!! *");
        console.error("*********************************************");
        const mre = (mrenclaveObj) ? {
            //provider: mrenclaveObj.provider, // key order is important
            framework: mrenclaveObj.framework, // key order is important
            version: mrenclaveObj.version, // key order is important
            entrypoint: mrenclaveObj.entrypoint, // key order is important
            heapSize: mrenclaveObj.heapSize, // key order is important
            fingerprint: mrenclaveObj.fingerprint, // key order is important
        } : null;
        return Buffer.from(AppRegistry.MREnclaveToString(mre), 'utf8');
    }

    /** @param {cTypes.App} validApp */
    async predictAddress(validApp) {
        const c = this.contract;

        const multiaddr = MultiaddrEx.toNonNullOrThrowError(validApp.multiaddr);
        const mrenclaveUtf8Buffer = AppRegistry.MREnclaveToUtf8Buffer(validApp.mrenclave);

        /*
        function predictApp(
            address          _appOwner,
            string  calldata _appName,
            string  calldata _appType,
            bytes   calldata _appMultiaddr,
            bytes32          _appChecksum,
            bytes   calldata _appMREnclave)
        */
        /** @type {types.checksumaddress} */
        const predictedAddr = await c.predictApp(
            validApp.owner,
            validApp.name,
            validApp.type,
            multiaddr, /* Hexable */
            validApp.checksum,
            mrenclaveUtf8Buffer);
        return predictedAddr;
    }

    /**
     * API : 
     * - Returns true, if `value` is a valid app object
     * @param {any} value
     */
    static isValidEntryData(value) {
        return AppRegistryEntry.isValidObject(value);
    }

    /**
     * @param {cTypes.App | types.checksumaddress} appOrAddress
     */
    async isRegistered(appOrAddress) {
        let addr;
        if (typeof appOrAddress === 'string') {
            addr = toChecksumAddress(appOrAddress);
        } else if (typeof appOrAddress === 'object') {
            if (!AppRegistry.isValidEntryData(appOrAddress)) {
                throw new CodeError('Invalid app data');
            }
            addr = await this.predictAddress(appOrAddress);
        } else {
            throw new CodeError('Invalid argument');
        }
        const ok = await this.contract.isRegistered(addr);
        return (ok) ? true : false;
    }

    /**
     * @param {cTypes.App} validUnregisteredApp 
     * @param {types.TxArgsOrWallet} txArgsOrWallet 
     */
    async createApp(validUnregisteredApp, txArgsOrWallet) {
        const txArgs = toTxArgs(txArgsOrWallet);
        const sc = this.newSigningContract(txArgs.wallet);

        const multiaddr = MultiaddrEx.toNonNullOrThrowError(validUnregisteredApp.multiaddr);
        const mrenclaveUtf8Buffer = AppRegistry.MREnclaveToUtf8Buffer(validUnregisteredApp.mrenclave);

        /*
        function createApp(
            address          _appOwner,
            string  calldata _appName,
            string  calldata _appType,
            bytes   calldata _appMultiaddr,
            bytes32          _appChecksum,
            bytes   calldata _appMREnclave)
        */
        /** @type {any} */
        const tx = await sc.createApp(
            validUnregisteredApp.owner,
            validUnregisteredApp.name,
            validUnregisteredApp.type,
            multiaddr, /* Hexable */
            validUnregisteredApp.checksum,
            mrenclaveUtf8Buffer,
            txArgs.txOverrides);

        // wait for tx
        const txReceipt = await tx.wait(txArgs.txConfirms);
        const evtTransfer = txReceipt.events.find(/** @param {any} event */(event) => event.event === 'Transfer');
        if (!evtTransfer) {
            throw new Error(`Unknown event 'Transfer'`);
        }

        /*
            From ERC721.sol
            _mint(...)
            emit Transfer(address(0), to, tokenId);
            event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
         */
        /** @type {{ tokenId: BigNumber }} */
        const { tokenId } = evtTransfer.args;
        assert(tokenId instanceof BigNumber);

        const address = ERC721TokenIdToAddress(tokenId);
        return {
            address: address,
            txHash: txReceipt.transactionHash
        };
    }

    /**
     * API : 
     * - if `workerpoolOrAddress` is already registered : returns the existing entry.
     * - if `workerpoolOrAddress` is not yet registered : returns null.
     * - Throws error if failed.
     * @param {cTypes.App | string} appOrAddress 
     */
    async getEntry(appOrAddress) {
        if (appOrAddress === null || appOrAddress === undefined) {
            throw new CodeError('Invalid argument');
        }
        if (appOrAddress === NULL_ADDRESS) {
            return null;
        }
        let addr = null;
        if (typeof appOrAddress == 'string') {
            addr = toChecksumAddress(appOrAddress);
        } else {
            addr = await this.predictAddress(appOrAddress);
        }
        const registered = await this.contract.isRegistered(addr);
        if (!registered) {
            return null;
        }
        return AppRegistryEntry.fromAddr(addr, this);
    }

    /**
     * @param {cTypes.App} app 
     * @param {types.TxArgsOrWallet} txArgsOrWallet 
     */
    async newEntry(app, txArgsOrWallet) {
        if (app === null || app === undefined) {
            throw new CodeError('Invalid argument');
        }

        const e = await this.getEntry(app);
        if (e) {
            return e;
        }

        const { address, txHash } = await this.createApp(app, txArgsOrWallet);
        return this.getEntry(address);
    }

    /**
     * @param {{
     *     tee?: boolean,
     *     name: string
     *     dockerfile: string
     *     dockerRepo: string
     *     dockerTag: string
     *     dockerUrl: string
     *     rebuildDockerImage?: boolean
     * }} args 
     * @param {types.TxArgsOrWallet} txArgsOrWallet 
     */
    async newEntryFromDockerfile(args, txArgsOrWallet) {
        throwIfNullishOrEmptyString(args.name);
        throwIfFileDoesNotExist(args.dockerfile);

        const tee = (args.tee === true);
        const txArgs = toTxArgs(txArgsOrWallet);

        const appDockerfile = args.dockerfile;
        assert(appDockerfile);
        const appName = args.name;
        assert(appName);

        // compute app multiaddr & checksum
        const appMC = await computeDockerChecksumAndMultiaddr(
            args.dockerfile, /* app dockerfile dir */
            args.dockerRepo, /* app docker repo */
            args.dockerTag, /* app docker tag */
            args.dockerUrl, /* docker registry url */
            [], /* buildArgs */
            args.rebuildDockerImage ?? false /* rebuild docker image */
        );

        const mrenclave = (tee) ? await computeMREnclave(
            args,
            args.rebuildDockerImage ?? false /* rebuild docker image */
        ) : undefined;

        /** @type {cTypes.App} */
        const app = {
            owner: txArgs.wallet.address,
            name: appName,
            type: "DOCKER",
            checksum: appMC.checksum,
            multiaddr: appMC.multiaddr,
            mrenclave
        }

        return this.newEntry(app, txArgs);
    }

    /**
     * API:
     * - Returns the `index`th Registry Entry.
     * @param {types.uint256 | number} index
     */
    async getEntryAtIndex(index) {
        return registryEntryAtIndex(this, index);
    }

    /**
     * API:
     * - Returns the `index`th Registry Entry.
     * @param {types.checksumaddress} owner
     * @param {types.uint256 | number} index
     */
    async getEntryOfOwnerAtIndex(owner, index) {
        return registryEntryOfOwnerAtIndex(this, owner, index);
    }
}
