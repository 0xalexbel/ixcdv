// Dependencies
// ../common
import * as types from '../common/common-types.js';
import * as cTypes from './contracts-types-internal.js';
import assert from 'assert';
import { Contract, Wallet, BigNumber } from "ethers";
import { Registry, RegistryConstructorGuard, registryEntryAtIndex, registryEntryOfOwnerAtIndex } from "./Registry.js";
import { SharedReadonlyContracts } from '../common/contracts/SharedReadonlyContracts.js';
import { ContractBase } from '../common/contracts/ContractBase.js';
import { WorkerpoolRegistryEntry } from './WorkerpoolRegistryEntry.js';
import { ContractRef, newContract } from '../common/contractref.js';
import { ERC721TokenIdToAddress, NULL_ADDRESS, toChecksumAddress, toTxArgs } from '../common/ethers.js';
import { CodeError } from '../common/error.js';

export const WorkerpoolRegistryConstructorGuard = { value: false };

export class WorkerpoolRegistry extends Registry {

    /**
     * @param {Contract} contract 
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     */
    constructor(contract, contractRef, contractDir) {
        if (!WorkerpoolRegistryConstructorGuard.value) {
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
    static #newWorkerpoolRegistry(contract, contractRef, contractDir) {
        assert(!WorkerpoolRegistryConstructorGuard.value);
        WorkerpoolRegistryConstructorGuard.value = true;
        const o = new WorkerpoolRegistry(contract, contractRef, contractDir);
        WorkerpoolRegistryConstructorGuard.value = false;
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
        const c = SharedReadonlyContracts.get(contractRef, 'WorkerpoolRegistry', contractDir, options);
        return WorkerpoolRegistry.#newWorkerpoolRegistry(c, contractRef, contractDir);
    }

    /**
     * @param {string} address 
     * @param {ContractBase} baseContract 
     */
    static fromAddr(address, baseContract) {
        assert(baseContract);

        const contractRef = new ContractRef({
            chainid: baseContract.chainid,
            contractName: 'WorkerpoolRegistry',
            address: address,
            url: baseContract.url
        });

        if (baseContract.isSharedReadOnly) {
            return WorkerpoolRegistry.sharedReadOnly(
                contractRef, 
                baseContract.contractDir, 
                baseContract.network);
        }

        const newC = newContract(
            contractRef,
            'WorkerpoolRegistry',
            baseContract.contractDir,
            baseContract.signerOrProvider);

        return WorkerpoolRegistry.#newWorkerpoolRegistry(newC, contractRef, baseContract.contractDir);
    }

    /**
     * @param {Wallet} wallet 
     */
    newSigningContract(wallet) {
        return newContract(this.contractRef, 'WorkerpoolRegistry', this.contractDir, wallet);
    }

    /**
     * @param {cTypes.Workerpool} validWorkerpoolData 
     */
    async predictAddress(validWorkerpoolData) {
        const c = this.contract;
        /*
        function predictWorkerpool(
            address          _workerpoolOwner,
            string  calldata _workerpoolDescription)
        */
        /** @type {string} */
        const predictedAddr = await c.predictWorkerpool(
            validWorkerpoolData.owner,
            validWorkerpoolData.description);

        return predictedAddr;
    }

    /**
     * API: 
     * - if `strict = true`, throws error when `workerpoollike` is not valid.
     * @param {cTypes.Workerpool | types.checksumaddress} workerpoolOrAddress
     */
    async isRegistered(workerpoolOrAddress) {
        let addr;
        if (typeof workerpoolOrAddress === 'string') {
            addr = toChecksumAddress(workerpoolOrAddress);
        } else if (typeof workerpoolOrAddress === 'object') {
            if (!WorkerpoolRegistry.isValidEntryData(workerpoolOrAddress)) {
                throw new CodeError('Invalid workerpool data');
            }
            addr = await this.predictAddress(workerpoolOrAddress);
        } else {
            throw new CodeError('Invalid argument');
        }
        const ok = await this.contract.isRegistered(addr);
        return (ok) ? true : false;
    }

    /**
     * API : 
     * - Returns true, if `value` is a valid workerpool object
     * @param {any} value
     */
    static isValidEntryData(value) {
        return WorkerpoolRegistryEntry.isValidObject(value);
    }

    /**
     * @param {cTypes.Workerpool} validUnregisteredWorkerpool 
     * @param {types.TxArgsOrWallet} txArgsOrWallet 
     */
    async createWorkerpool(validUnregisteredWorkerpool, txArgsOrWallet) {
        const txArgs = toTxArgs(txArgsOrWallet);
        const sc = this.newSigningContract(txArgs.wallet);

        /*
        function createWorkerpool(
            address          _workerpoolOwner,
            string  calldata _workerpoolDescription)
        */
        /** @type {any} */
        const tx = await sc.createWorkerpool(
            validUnregisteredWorkerpool.owner,
            validUnregisteredWorkerpool.description,
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
     * @param {cTypes.Workerpool | string} workerpoolOrAddress 
     */
    async getEntry(workerpoolOrAddress) {
        if (workerpoolOrAddress === null || workerpoolOrAddress === undefined) {
            throw new CodeError('Invalid argument');
        }
        if (workerpoolOrAddress === NULL_ADDRESS) {
            return null;
        }
        let addr = null;
        if (typeof workerpoolOrAddress == 'string') {
            addr = toChecksumAddress(workerpoolOrAddress);
        } else {
            addr = await this.predictAddress(workerpoolOrAddress);
        }
        const registered = await this.contract.isRegistered(addr);
        if (!registered) {
            return null;
        }
        return WorkerpoolRegistryEntry.fromAddr(addr, this);
    }

    /**
     * @param {cTypes.Workerpool} workerpool 
     * @param {types.TxArgsOrWallet} txArgsOrWallet 
     */
    async newEntry(workerpool, txArgsOrWallet) {
        if (workerpool === null || workerpool === undefined) {
            throw new CodeError('Invalid argument');
        }

        const e = await this.getEntry(workerpool);
        if (e) {
            return e;
        }

        const { address, txHash } = await this.createWorkerpool(workerpool, txArgsOrWallet);
        return this.getEntry(address);
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
