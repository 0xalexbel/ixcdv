// Dependencies
// ../common
import * as cTypes from './contracts-types-internal.js';
import assert from 'assert';
import { Contract } from "ethers";
import { SharedReadonlyContracts } from '../common/contracts/SharedReadonlyContracts.js';
import { RegistryEntry, RegistryEntryConstructorGuard } from './RegistryEntry.js';
import { ContractBase } from '../common/contracts/ContractBase.js';
import { MultiaddrEx } from './MultiaddrEx.js';
import { ContractRef, newContract } from '../common/contractref.js';
import { isValidAddress, NULL_ADDRESS, toChecksumAddress } from '../common/ethers.js';
import { isNullishOrEmptyString } from '../common/string.js';
import { CodeError } from '../common/error.js';

export const DatasetRegistryEntryConstructorGuard = { value: false };

export class DatasetRegistryEntry extends RegistryEntry {

    /** @type {string=} */
    #m_datasetName;
    /** @type {string=} */
    #m_datasetChecksum;
    /** @type {MultiaddrEx=} */
    #m_datasetMultiaddr;

    /**
     * @param {Contract} contract 
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     */
    constructor(contract, contractRef, contractDir) {
        if (!DatasetRegistryEntryConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }
    
        assert(!RegistryEntryConstructorGuard.value);
        RegistryEntryConstructorGuard.value = true;
        super(contract, contractRef, contractDir);
        RegistryEntryConstructorGuard.value = false;
    }

    /**
     * @param {Contract} contract 
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     */
    static #newDatasetRegistryEntry(contract, contractRef, contractDir) {
        assert(!DatasetRegistryEntryConstructorGuard.value);
        DatasetRegistryEntryConstructorGuard.value = true;
        const o = new DatasetRegistryEntry(contract, contractRef, contractDir);
        DatasetRegistryEntryConstructorGuard.value = false;
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
        const c = SharedReadonlyContracts.get(contractRef, 'Dataset', contractDir, options);
        return DatasetRegistryEntry.#newDatasetRegistryEntry(c, contractRef, contractDir);
    }

    /**
     * @param {string} address 
     * @param {ContractBase} baseContract 
     */
    static fromAddr(address, baseContract) {
        assert(baseContract);

        const contractRef = new ContractRef({
            chainid: baseContract.chainid,
            contractName: 'Dataset',
            address: address,
            url: baseContract.url
        });

        if (baseContract.isSharedReadOnly) {
            return DatasetRegistryEntry.sharedReadOnly(
                contractRef, 
                baseContract.contractDir,
                baseContract.network);
        }

        const newC = newContract(
            contractRef,
            'Dataset',
            baseContract.contractDir,
            baseContract.signerOrProvider);

        return DatasetRegistryEntry.#newDatasetRegistryEntry(newC, contractRef, baseContract.contractDir);
    }

    /**
     * @param {cTypes.Dataset} anyObject 
     */
    static isValidObject(anyObject) {
        if (anyObject === null || anyObject === undefined) { return false; }
        if (typeof anyObject != 'object') { return false; }
        if (anyObject instanceof DatasetRegistryEntry) {
            return true;
        }
        if (!isValidAddress(anyObject.owner)) { return false; }
        if (isNullishOrEmptyString(anyObject.name)) { return false; }
        if (isNullishOrEmptyString(anyObject.checksum)) { return false; }
        if (isNullishOrEmptyString(anyObject.multiaddr)) { return false; }
        return true;
    }

    async name() {
        if (!this.#m_datasetName) {
            this.#m_datasetName = await this.contract['m_datasetName']();
            if (!this.#m_datasetName) {
                throw new CodeError("Failed to retrieve m_datasetName property value.");
            }
        }
        return this.#m_datasetName;
    }
    async checksum() {
        if (!this.#m_datasetChecksum) {
            this.#m_datasetChecksum = await this.contract['m_datasetChecksum']();
            if (!this.#m_datasetChecksum) {
                throw new CodeError("Failed to retrieve m_datasetChecksum property value.");
            }
        }
        return this.#m_datasetChecksum;
    }
    async multiaddr() {
        if (!this.#m_datasetMultiaddr) {
            const maddr = await this.contract['m_datasetMultiaddr']();
            this.#m_datasetMultiaddr = MultiaddrEx.fromDataHexString(maddr);
            if (!this.#m_datasetMultiaddr) {
                throw new CodeError("Failed to retrieve m_datasetMultiaddr property value.");
            }
        }
        return this.#m_datasetMultiaddr;
    }

    /**
     * Helper
     * @param {?(string | DatasetRegistryEntry)=} dataset 
     */
    static toDatasetAddr(dataset) {
        if (!dataset) {
            NULL_ADDRESS;
        }
        if (typeof dataset === 'string') {
            return toChecksumAddress(dataset);
        }
        if (dataset instanceof DatasetRegistryEntry) {
            return dataset.address ?? NULL_ADDRESS;
        }
        return NULL_ADDRESS;
    }
}
