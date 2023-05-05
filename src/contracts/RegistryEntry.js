// Dependencies
// ../common
import * as types from "../common/common-types.js";
import * as cTypes from './contracts-types-internal.js';
import assert from "assert";
import { Contract } from "ethers";
import { ContractBaseConstructorGuard, ContractBase } from "../common/contracts/ContractBase.js";
import { ContractRef } from '../common/contractref.js';
import { CodeError } from '../common/error.js';

export const RegistryEntryConstructorGuard = { value: false };

export class RegistryEntry extends ContractBase {

    /** @type {types.checksumaddress=} */
    #registryAddr;
    /** @type {types.checksumaddress=} */
    #ownerAddr;

    /**
     * @param {Contract} contract
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     */
    constructor(contract, contractRef, contractDir) {
        if (!RegistryEntryConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }

        assert(!ContractBaseConstructorGuard.value);
        ContractBaseConstructorGuard.value = true;
        super(contract, contractRef, contractDir);
        ContractBaseConstructorGuard.value = false;
    }

    async registryAddr() {
        if (!this.#registryAddr) {
            this.#registryAddr = await this.contract['registry']();
            if (!this.#registryAddr) {
                throw new CodeError("Failed to retrieve 'registry' property value.");
            }
        }
        return this.#registryAddr;
    }
    async owner() {
        if (!this.#ownerAddr) {
            this.#ownerAddr = await this.contract['owner']();
            if (!this.#ownerAddr) {
                throw new CodeError("Failed to retrieve 'owner' property value.");
            }
        }
        return this.#ownerAddr;
    }
}