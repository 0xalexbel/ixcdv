import * as types from "../common-types.js";
import assert from "assert";
import { Contract, ContractFactory, Signer, ethers } from "ethers";
import { ContractBaseConstructorGuard, ContractBase } from "./ContractBase.js";
import { ContractRef, newContract } from '../contractref.js';
import { keccak256, toUtf8Bytes } from 'ethers/lib/utils.js';
import { NULL_ADDRESS, isContract, newAbi, toChecksumAddress, toTxArgs, toTxParams } from '../ethers.js';
import { ENSRegistry } from './ENSRegistry.js';
import { CodeError } from '../error.js';

export const FIFSRegistrarConstructorGuard = { value: false };

export class FIFSRegistrar extends ContractBase {

    /** @type {string} */
    #domain;
    /** @type {string} */
    #ensAddress;

    /**
     * @param {string} ensAddress 
     * @param {string} domain 
     * @param {Contract} contract 
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     */
    constructor(ensAddress, domain, contract, contractRef, contractDir) {
        if (!FIFSRegistrarConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }
        assert(!ContractBaseConstructorGuard.value);
        ContractBaseConstructorGuard.value = true;
        super(contract, contractRef, contractDir);
        ContractBaseConstructorGuard.value = false;

        this.#ensAddress = toChecksumAddress(ensAddress);
        this.#domain = domain;
    }

    /**
     * @param {string} ensAddress 
     * @param {string} domain 
     * @param {Contract} contract 
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     */
    static #newFIFSRegistrar(ensAddress, domain, contract, contractRef, contractDir) {
        assert(!FIFSRegistrarConstructorGuard.value);
        FIFSRegistrarConstructorGuard.value = true;
        const o = new FIFSRegistrar(ensAddress, domain, contract, contractRef, contractDir);
        FIFSRegistrarConstructorGuard.value = false;
        return o;
    }

    /**
     * @param {ENSRegistry} ens 
     * @param {string} name 
     * @param {Signer} signer
     */
    static async newSigning(ens, name, signer) {
        ENSRegistry.validateName(name);

        // should be the equal to FIFSRegistrar address
        const nameOwner = await ens.nameOwner(name);
        if (nameOwner === NULL_ADDRESS) {
            throw new CodeError(`Unknown name ${name}`);
        }

        if (! await isContract(ens.baseProvider, nameOwner)) {
            throw new CodeError('owner is not a contract');
        }

        const ensAddress = ens.address;
        if (!ensAddress) {
            throw new CodeError('Invalid ens');
        }

        const fifsRegRef = new ContractRef({
            chainid: ens.chainid,
            address: nameOwner,
            contractName: 'FIFSRegistrar',
            url: ens.contractRef.url
        });
        assert(fifsRegRef.contractName);

        // create a new FIFSRegistrar contract
        const newSC = newContract(
            fifsRegRef,
            fifsRegRef.contractName,
            ens.contractDir,
            signer);

        return FIFSRegistrar.#newFIFSRegistrar(
            ensAddress, 
            name, 
            newSC, 
            fifsRegRef, 
            ens.contractDir);
    }

    get domain() { return this.#domain; }
    get ensAddress() { return this.#ensAddress; }

    /** @param {string} label */
    static #labelhash(label) {
        // throws an error if not a string
        return keccak256(toUtf8Bytes(label));
    }

    get #ensRef() {
        return new ContractRef({
            chainid: this.chainid,
            contractName: 'ENSRegistry',
            address: this.#ensAddress,
            url: this.contractRef.url,
        });
    }

    get #ensRegistryReadOnly() {
        const ensRegistryContract = ENSRegistry.sharedReadOnly(
            this.#ensRef,
            this.contractDir,
            this.network);
        return ensRegistryContract;
    }

    /**
     * @param {string} label 
     */
    async #labelOwner(label) {
        const ensRegistryContract = this.#ensRegistryReadOnly;

        const domainOwner = await ensRegistryContract.nameOwner(this.#domain);
        if (domainOwner.toLowerCase() !== this.address?.toLowerCase()) {
            throw new CodeError('Invalid FIFSRegistrar');
        }

        const name = `${label}.${this.#domain}`;
        const currentOwner = await ensRegistryContract.nameOwner(name);

        return currentOwner;
    }

    /**
     * @param {string} label 
     * @param {string} owner 
     * @param {types.TxParams=} txParams
     */
    async register(label, owner, txParams) {
        ENSRegistry.validateName(label);

        txParams = toTxParams(txParams);
        const labelOwner = await this.#labelOwner(label);
        if (labelOwner.toLowerCase() === owner.toLowerCase()) {
            return;
        }
        if (labelOwner.toLowerCase() !== NULL_ADDRESS) {
            throw new CodeError(`name '${label}.${this.#domain}' already owned by ${labelOwner}`);
        }

        const labelHash = FIFSRegistrar.#labelhash(label);

        /** @type {any} */
        const tx = await this.contract.register(
            labelHash,
            owner,
            txParams.txOverrides);

        // wait for tx
        const txReceipt = await tx.wait(txParams.txConfirms);
        return { label, txHash: txReceipt.hash };
    }

    /**
     * @param {string} name
     * @param {string} ensAddress
     * @param {string} contractDir
     * @param {types.TxArgsOrWallet} txArgsOrWallet
     */
    static async deployNewAt(name, ensAddress, contractDir, txArgsOrWallet) {
        ENSRegistry.validateName(name);

        const txArgs = toTxArgs(txArgsOrWallet);
        //assert(this.address);

        const node = ethers.utils.namehash(name);

        let bytecode = "0x608060405234801561001057600080fd5b506040516040806103ef8339810180604052604081101561003057600080fd5b810190808051906020019092919080519060200190929190505050816000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555080600181905550505061034c806100a36000396000f3fe608060405260043610610041576000357c0100000000000000000000000000000000000000000000000000000000900463ffffffff168063d22057a914610046575b600080fd5b34801561005257600080fd5b5061009f6004803603604081101561006957600080fd5b8101908080359060200190929190803573ffffffffffffffffffffffffffffffffffffffff1690602001909291905050506100a1565b005b8160008060009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166302571be3600154846040516020018083815260200182815260200192505050604051602081830303815290604052805190602001206040518263ffffffff167c01000000000000000000000000000000000000000000000000000000000281526004018082815260200191505060206040518083038186803b15801561016257600080fd5b505afa158015610176573d6000803e3d6000fd5b505050506040513d602081101561018c57600080fd5b81019080805190602001909291905050509050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16148061020557503373ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff16145b151561021057600080fd5b6000809054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166306ab592360015486866040518463ffffffff167c0100000000000000000000000000000000000000000000000000000000028152600401808481526020018381526020018273ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019350505050602060405180830381600087803b1580156102de57600080fd5b505af11580156102f2573d6000803e3d6000fd5b505050506040513d602081101561030857600080fd5b8101908080519060200190929190505050505050505056fea165627a7a72305820a68d144c577afd34097432bdfad24871fcec65668c28b1d766895f02ec4aa70e0029";

        ensAddress = toChecksumAddress(ensAddress);

        const abi = newAbi('FIFSRegistrar', contractDir);
        const factory = new ContractFactory(abi, bytecode, txArgs.wallet);

        const newC = await factory.deploy(ensAddress, node);
        const futureAddr = newC.address;

        // wait for tx
        const txReceipt = await newC.deployTransaction.wait();
        assert(futureAddr === txReceipt.contractAddress);

        return { address: futureAddr, txHash: txReceipt.transactionHash };
    }
}
