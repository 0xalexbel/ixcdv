import * as types from "../common-types.js";
import assert from 'assert';
import { Contract, Signer, providers } from "ethers";
import { SharedReadonlyContracts } from './SharedReadonlyContracts.js';
import { ContractRef } from '../contractref.js';
import { throwIfDirDoesNotExist } from '../fs.js';
import { CodeError } from '../error.js';

export const ContractBaseConstructorGuard = { value: false };

export class ContractBase {

    /** @type {types.checksumaddress=} */
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
    get baseProvider() {
        let p;
        const sOrp = this.signerOrProvider;
        if (sOrp instanceof Signer) {
            p = sOrp.provider;
            assert(p);
        } else {
            p = sOrp;
        }
        assert(this.#contract.provider instanceof providers.JsonRpcProvider);
        assert(p instanceof providers.JsonRpcProvider);
        return p;
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
    get network() {
        // Add a bunch of asserts. 
        // Make sure to detect any misconfig
        const p = this.baseProvider;
        const network = p.network;
        const ensAddress = network.ensAddress;
        const networkName = network.name;
        assert(ensAddress);
        assert(networkName);
        assert(this.#contract.provider instanceof providers.BaseProvider);
        assert(this.#contract.provider.network.ensAddress === ensAddress);
        assert(this.#contract.provider.network.name === networkName);
        return { ensAddress, networkName };
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
            if (typeof this.#contract.owner !== 'function') {
                throw new CodeError('Contract is not ownable');
            }
            this.#owner = this.#contract.owner();
        }
        assert(!this.#owner);
        return this.#owner;
    }
}