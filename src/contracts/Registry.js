// Dependencies
// ../common
import * as types from "../common/common-types.js";
import assert from "assert";
import { Contract } from "ethers";
import { ContractBaseConstructorGuard, ContractBase } from "../common/contracts/ContractBase.js";
import { toEthAddress, toEthersArg_uint256 } from './utils.js';
import { toChecksumAddress, toUint256 } from '../common/ethers.js';
import { ContractRef } from '../common/contractref.js';

export const RegistryConstructorGuard = { value: false };

/** 
 * @template T
 * @typedef {{ 
 *    contract: Contract
 *    getEntry: (address:string) => Promise<T | null>
 * }} IRegisty<T> 
 */

/**
 * @template T
 * @param {IRegisty<T>} registry
 * @param {types.uint256 | number} index
 */
export async function registryEntryAtIndex(registry, index) {
    const index_uint256 = toEthersArg_uint256(index);

    // implements ERC721
    const tokenId = await registry.contract.tokenByIndex(index_uint256);
    const entryAddr = toEthAddress(tokenId);

    return registry.getEntry(entryAddr);
}

/**
/**
 * @template T
 * @param {IRegisty<T>} registry
 * @param {types.checksumaddress} owner
 * @param {types.uint256 | number} index
 */
export async function registryEntryOfOwnerAtIndex(registry, owner, index) {
    const ownerAddr = toChecksumAddress(owner);
    const index_uint256 = toEthersArg_uint256(index);

    // implements ERC721
    const tokenId = await registry.contract.tokenOfOwnerByIndex(ownerAddr, index_uint256);
    const entryAddr = toEthAddress(tokenId);
    return registry.getEntry(entryAddr);
}

export class Registry extends ContractBase {

    // inherits ERC721

    /**
     * @param {Contract} contract
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     */
    constructor(contract, contractRef, contractDir) {
        if (!RegistryConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }

        assert(!ContractBaseConstructorGuard.value);
        ContractBaseConstructorGuard.value = true;
        super(contract, contractRef, contractDir);
        ContractBaseConstructorGuard.value = false;
    }

    /**
     * API:
     * - Returns the total number of Apps, Datasets or Workerpools stored
     *   in the registry
     * @return {Promise<types.uint256>}
     */
    async countEntries() {
        return this.contract['totalSupply']();
    }

    /**
     * API:
     * - Returns the number of Apps, Datasets or Workerpools owned by `owner`
     * - Since Apps, Datasets and Workerpools are stored as NFTs, 
     *   this number is exactly the underlying ERC721 `balanceOf(owner)`
     * @param {types.checksumaddress} owner
     */
    async countEntriesByOwner(owner) {
        const ownerAddr = toChecksumAddress(owner);
        const b = await this.contract.balanceOf(ownerAddr);
        return toUint256(b);
    }
}

