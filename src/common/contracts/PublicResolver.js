import * as types from "../common-types.js";
import assert from "assert";
import { Contract, Wallet } from "ethers";
import { ContractBaseConstructorGuard, ContractBase } from "./ContractBase.js";
import { toChecksumAddress, toTxArgs } from '../ethers.js';
import { ContractRef, newContract } from '../contractref.js';
import { SharedReadonlyContracts } from './SharedReadonlyContracts.js';
import { throwIfNullishOrEmptyString } from '../string.js';
import { ENSRegistry } from './ENSRegistry.js';

export const PublicResolverConstructorGuard = { value: false };

export class PublicResolver extends ContractBase {

    /**
     * @param {Contract} contract 
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     */
    constructor(contract, contractRef, contractDir) {
        if (!PublicResolverConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }

        assert(!ContractBaseConstructorGuard.value);
        ContractBaseConstructorGuard.value = true;
        super(contract, contractRef, contractDir);
        ContractBaseConstructorGuard.value = false;
    }

    /**
     * @param {Contract} contract 
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     */
    static #newPublicResolver(contract, contractRef, contractDir) {
        assert(!PublicResolverConstructorGuard.value);
        PublicResolverConstructorGuard.value = true;
        const o = new PublicResolver(contract, contractRef, contractDir);
        PublicResolverConstructorGuard.value = false;
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
        const c = SharedReadonlyContracts.get(contractRef, 'PublicResolver', contractDir, options);
        return PublicResolver.#newPublicResolver(c, contractRef, contractDir);
    }

    /**
     * @param {Wallet} wallet 
     */
    newSigningContract(wallet) {
        return newContract(this.contractRef, 'PublicResolver', this.contractDir, wallet);
    }

    /**
     * @param {string} name 
     * @param {string} address 
     * @param {types.TxArgsOrWallet} txArgsOrWallet 
     */
    async setAddress(name, address, txArgsOrWallet) {
        ENSRegistry.validateName(name);

        const txArgs = toTxArgs(txArgsOrWallet);

        throwIfNullishOrEmptyString(name);
        address = toChecksumAddress(address);
        const node = ENSRegistry.HumanReadableNameToNode(name);

        // retrieve existing addr
        const existingAddr = await this.contract.functions['addr(bytes32)'](node);
        const isAddrSet =
            existingAddr &&
            existingAddr[0] &&
            existingAddr[0].toLowerCase() === address.toLowerCase();

        // if existing addr is not our address
        if (!isAddrSet) {
            const sc = this.newSigningContract(txArgs.wallet);
            const tx = await sc.functions['setAddr(bytes32,address)'](
                node,
                address,
                txArgs.txOverrides
            );
            // wait for tx
            const txReceipt = await tx.wait(txArgs.txConfirms);
        }
    }
}
