import assert from 'assert';
import { Contract, BigNumber } from "ethers";
import { newContract, SharedReadonlyContracts } from './SharedReadonlyContracts.js';
import { RegistryEntry, RegistryEntryConstructorGuard } from './RegistryEntry.js';
import { ContractBase } from './ContractBase.js';
import { CodeError } from '../common/error.js';
import { ContractRef } from '../common/contractref.js';
import { isValidAddress, NULL_ADDRESS, toChecksumAddress } from '../common/ethers.js';
import { isNullishOrEmptyString } from '../common/string.js';

export const WorkerpoolRegistryEntryConstructorGuard = { value: false };

export class WorkerpoolRegistryEntry extends RegistryEntry {

    /** @type {string=} */
    #m_workerpoolDescription;
    /** @type {BigNumber=} */
    #m_workerStakeRatioPolicy;
    /** @type {BigNumber=} */
    #m_schedulerRewardRatioPolicy;

    /**
     * @param {Contract} contract 
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     */
    constructor(contract, contractRef, contractDir) {
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
    static #newWorkerpoolRegistryEntry(contract, contractRef, contractDir) {
        assert(!WorkerpoolRegistryEntryConstructorGuard.value);
        WorkerpoolRegistryEntryConstructorGuard.value = true;
        const o = new WorkerpoolRegistryEntry(contract, contractRef, contractDir);
        WorkerpoolRegistryEntryConstructorGuard.value = false;
        return o;
    }

    /**
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     */
    static sharedReadOnly(contractRef, contractDir) {
        const c = SharedReadonlyContracts.get(contractRef, 'Workerpool', contractDir);
        return WorkerpoolRegistryEntry.#newWorkerpoolRegistryEntry(c, contractRef, contractDir);
    }

    /**
     * @param {string} address 
     * @param {ContractBase} baseContract 
     */
    static fromAddr(address, baseContract) {
        assert(baseContract);

        const contractRef = new ContractRef({
            chainid: baseContract.chainid,
            contractName: 'Workerpool',
            address: address,
            url: baseContract.url
        });

        if (baseContract.isSharedReadOnly) {
            return WorkerpoolRegistryEntry.sharedReadOnly(contractRef, baseContract.contractDir);
        }

        const newC = newContract(
            contractRef,
            'Workerpool',
            baseContract.contractDir,
            baseContract.signerOrProvider);

        return WorkerpoolRegistryEntry.#newWorkerpoolRegistryEntry(newC, contractRef, baseContract.contractDir);
    }

    /**
     * @param {any} anyObject 
     */
    static isValidObject(anyObject) {
        if (anyObject === null || anyObject === undefined) { return false; }
        if (typeof anyObject != 'object') { return false; }
        if (anyObject instanceof WorkerpoolRegistryEntry) {
            return true;
        }
        if (!isValidAddress(anyObject.owner)) { return false; }
        if (isNullishOrEmptyString(anyObject.description)) { return false; }
        return true;
    }

    async description() {
        if (!this.#m_workerpoolDescription) {
            this.#m_workerpoolDescription = await this.contract['m_workerpoolDescription']();
            if (!this.#m_workerpoolDescription) {
                throw new CodeError("Failed to retrieve m_workerpoolDescription property value.");
            }
        }
        return this.#m_workerpoolDescription;
    }
    async stakeRatioPolicy() {
        if (!this.#m_workerStakeRatioPolicy) {
            this.#m_workerStakeRatioPolicy = await this.contract['m_workerStakeRatioPolicy']();
            if (!this.#m_workerStakeRatioPolicy) {
                throw new CodeError("Failed to retrieve m_workerStakeRatioPolicy property value.");
            }
        }
        return this.#m_workerStakeRatioPolicy;
    }
    async schedulerRewardRatioPolicy() {
        if (!this.#m_schedulerRewardRatioPolicy) {
            this.#m_schedulerRewardRatioPolicy = await this.contract['m_schedulerRewardRatioPolicy']();
            if (!this.#m_schedulerRewardRatioPolicy) {
                throw new CodeError("Failed to retrieve m_schedulerRewardRatioPolicy property value.");
            }
        }
        return this.#m_schedulerRewardRatioPolicy;
    }

    /**
     * Helper
     * @param {?(string | WorkerpoolRegistryEntry)=} workerpool 
     */
    static toWorkerpoolAddr(workerpool) {
        if (!workerpool) {
            NULL_ADDRESS;
        }
        if (typeof workerpool === 'string') {
            return toChecksumAddress(workerpool);
        }
        if (workerpool instanceof WorkerpoolRegistryEntry) {
            return workerpool.address ?? NULL_ADDRESS;
        }
        return NULL_ADDRESS;
    }
}
