// Dependencies
// ../common
// ../ipfs
import * as types from "../common/common-types.js";
import * as cTypes from './contracts-types-internal.js';
import assert from 'assert';
import path from 'path';
import { BigNumber, Wallet, Contract } from "ethers";
import { Registry, RegistryConstructorGuard, registryEntryAtIndex, registryEntryOfOwnerAtIndex } from "./Registry.js";
import { SharedReadonlyContracts } from '../common/contracts/SharedReadonlyContracts.js';
import { ContractBase } from '../common/contracts/ContractBase.js';
import { MultiaddrEx } from './MultiaddrEx.js';
import { DatasetRegistryEntry } from './DatasetRegistryEntry.js';
import { computeIpfsChecksumAndMultiaddr } from './dataset-generator.js';
import { ContractRef, newContract } from '../common/contractref.js';
import { ERC721TokenIdToAddress, NULL_ADDRESS, toChecksumAddress, toTxArgs } from '../common/ethers.js';
import { CodeError } from '../common/error.js';
import { IpfsService } from '../ipfs/IpfsService.js';
import { errorFileDoesNotExist, fileExists } from '../common/fs.js';

export const DatasetRegistryConstructorGuard = { value: false };

export class DatasetRegistry extends Registry {

    /**
     * @param {Contract} contract 
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     */
    constructor(contract, contractRef, contractDir) {
        if (!DatasetRegistryConstructorGuard.value) {
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
    static #newDatasetRegistry(contract, contractRef, contractDir) {
        assert(!DatasetRegistryConstructorGuard.value);
        DatasetRegistryConstructorGuard.value = true;
        const o = new DatasetRegistry(contract, contractRef, contractDir);
        DatasetRegistryConstructorGuard.value = false;
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
        const c = SharedReadonlyContracts.get(contractRef, 'DatasetRegistry', contractDir, options);
        return DatasetRegistry.#newDatasetRegistry(c, contractRef, contractDir);
    }

    /**
     * @param {string} address 
     * @param {ContractBase} baseContract 
     */
    static fromAddr(address, baseContract) {
        assert(baseContract);

        const contractRef = new ContractRef({
            chainid: baseContract.chainid,
            contractName: 'DatasetRegistry',
            address: address,
            url: baseContract.url
        });

        if (baseContract.isSharedReadOnly) {
            return DatasetRegistry.sharedReadOnly(
                contractRef,
                baseContract.contractDir,
                baseContract.network
            );
        }

        const newC = newContract(
            contractRef,
            'DatasetRegistry',
            baseContract.contractDir,
            baseContract.signerOrProvider);

        return DatasetRegistry.#newDatasetRegistry(newC, contractRef, baseContract.contractDir);
    }

    /**
     * @param {Wallet} wallet 
     */
    newSigningContract(wallet) {
        return newContract(this.contractRef, 'DatasetRegistry', this.contractDir, wallet);
    }

    /** @param {cTypes.Dataset} validDataset */
    async predictAddress(validDataset) {
        const c = this.contract;

        const multiaddr = MultiaddrEx.toNonNullOrThrowError(validDataset.multiaddr);

        /*
        function predictDataset(
            address          _datasetOwner,
            string  calldata _datasetName,
            bytes   calldata _datasetMultiaddr,
            bytes32          _datasetChecksum)
        */
        /** @type {types.checksumaddress} */
        const predictedAddr = await c.predictDataset(
            validDataset.owner,
            validDataset.name,
            multiaddr, /* Hexable */
            validDataset.checksum);
        return predictedAddr;
    }

    /**
     * API : 
     * - Returns true, if `value` is a valid dataset object
     * @param {any} value
     */
    static isValidEntryData(value) {
        return DatasetRegistryEntry.isValidObject(value);
    }

    /**
     * @param {cTypes.Dataset | types.checksumaddress} datasetOrAddress
     */
    async isRegistered(datasetOrAddress) {
        let addr;
        if (typeof datasetOrAddress === 'string') {
            addr = toChecksumAddress(datasetOrAddress);
        } else if (typeof datasetOrAddress === 'object') {
            if (!DatasetRegistry.isValidEntryData(datasetOrAddress)) {
                throw new CodeError('Invalid dataset data');
            }
            addr = await this.predictAddress(datasetOrAddress);
        } else {
            throw new CodeError('Invalid argument');
        }
        const ok = await this.contract.isRegistered(addr);
        return (ok) ? true : false;
    }

    /**
     * @param {cTypes.Dataset} validUnregisteredDataset 
     * @param {types.TxArgsOrWallet} txArgsOrWallet 
     */
    async createDataset(validUnregisteredDataset, txArgsOrWallet) {
        const txArgs = toTxArgs(txArgsOrWallet);
        const sc = this.newSigningContract(txArgs.wallet);

        const multiaddr = MultiaddrEx.toNonNullOrThrowError(validUnregisteredDataset.multiaddr);

        /*
        function createDataset(
            address          _datasetOwner,
            string  calldata _datasetName,
            bytes   calldata _datasetMultiaddr,
            bytes32          _datasetChecksum)
        */
        /** @type {any} */
        const tx = await sc.createDataset(
            validUnregisteredDataset.owner,
            validUnregisteredDataset.name,
            multiaddr, /* Hexable */
            validUnregisteredDataset.checksum,
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
     * @param {cTypes.Dataset | string} datasetOrAddress 
     */
    async getEntry(datasetOrAddress) {
        if (datasetOrAddress === null || datasetOrAddress === undefined) {
            throw new CodeError('Invalid argument');
        }
        if (datasetOrAddress === NULL_ADDRESS) {
            return null;
        }
        let addr = null;
        if (typeof datasetOrAddress == 'string') {
            addr = toChecksumAddress(datasetOrAddress);
        } else {
            addr = await this.predictAddress(datasetOrAddress);
        }
        const registered = await this.contract.isRegistered(addr);
        if (!registered) {
            return null;
        }
        return DatasetRegistryEntry.fromAddr(addr, this);
    }

    /**
     * @param {cTypes.Dataset} dataset 
     * @param {types.TxArgsOrWallet} txArgsOrWallet 
     */
    async newEntry(dataset, txArgsOrWallet) {
        if (dataset === null || dataset === undefined) {
            throw new CodeError('Invalid argument');
        }

        const e = await this.getEntry(dataset);
        if (e) {
            return e;
        }

        const { address, txHash } = await this.createDataset(dataset, txArgsOrWallet);
        return this.getEntry(address);
    }

    /**
     * @param {{
    *     file: string
    *     ipfs: IpfsService
    * }} args 
    * @param {types.TxArgsOrWallet} txArgsOrWallet 
    */
    async newEntryFromFile(args, txArgsOrWallet) {
        const txArgs = toTxArgs(txArgsOrWallet);

        if (!fileExists(args.file)) {
            throw errorFileDoesNotExist(args.file);
        }
        if (!txArgs.wallet) {
            throw new CodeError('Missing dataset wallet');
        }

        const ipfs = args.ipfs;
        if (!ipfs.ipfsDir) {
            throw new CodeError('Missing ipfs directory');
        }

        // dataset multiaddr & checksum
        const datasetMC = await computeIpfsChecksumAndMultiaddr(
            args.file, /* dataset file */
            ipfs.ipfsDir
        );

        const outIpfs = await ipfs.addFile(args.file);
        // modify
        datasetMC.multiaddr = outIpfs.url.toString();

        /** @type {cTypes.Dataset} */
        const dataset = {
            owner: txArgs.wallet.address,
            name: path.basename(args.file),
            checksum: datasetMC.checksum,
            multiaddr: datasetMC.multiaddr
        }

        return this.newEntry(dataset, txArgs);
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

