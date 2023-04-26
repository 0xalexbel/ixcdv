import * as cTypes from './contracts-types-internal.js';
import assert from 'assert';
import { Contract } from "ethers";
import { SharedReadonlyContracts } from './SharedReadonlyContracts.js';
import { ContractRef } from '../common/contractref.js';
import { throwIfDirDoesNotExist } from '../common/fs.js';

export const ContractBaseConstructorGuard = { value: false };

export class ContractBase {

    /** @type {cTypes.checksumaddress=} */
    #owner;
    /** @type {Contract} */
    #contract;
    /** @type {ContractRef} */
    #contractRef;
    /** @type {string} */
    #contractDir;

    /**
     * @param {Contract} contract
     * @param {ContractRef} contractRef 
     * @param {string} contractDir 
     */
    constructor(contract, contractRef, contractDir) {
        if (!ContractBaseConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }

        assert(contract);
        assert(contractRef);
        assert(contractRef.resolved);
        throwIfDirDoesNotExist(contractDir);

        this.#contract = contract;
        this.#contractRef = contractRef;
        this.#contractDir = contractDir;
    }

    get contract() {
        return this.#contract;
    }
    get signerOrProvider() {
        return this.#contract.signer ?? this.#contract.provider;
    }
    get contractRef() {
        return this.#contractRef;
    }
    get contractDir() {
        return this.#contractDir;
    }
    get chainid() {
        return this.#contractRef.chainid;
    }
    get address() {
        return this.#contractRef.address;
    }
    get url() {
        assert(this.#contractRef.url);
        return this.#contractRef.url.toString();
    }
    get isSharedReadOnly() {
        return SharedReadonlyContracts.isShared(this.#contract);
    }
    async owner() {
        if (!this.#owner) {
            this.#owner = this.#contract.owner();
        }
        assert(!this.#owner);
        return this.#owner;
    }
}