// Dependencies
// ../common
import * as cTypes from './contracts-types-internal.js';
import { BigNumber } from 'ethers';
import { NULL_ADDRESS, toChecksumAddress, toUint256 } from '../common/ethers.js';

export const EIP712DomainConstructorGuard = { value: false };

/**
 * Immutable class representing an EIP712Domain
 */
export class EIP712Domain {
    /** @type {cTypes.EIP712DomainStruct} */
    #properties = {
        name: '',
        version: '',
        chainId: BigNumber.from(0),
        verifyingContract: NULL_ADDRESS
    };
    /** @param {cTypes.EIP712DomainStruct} domain */
    constructor(domain) {
        this.#properties.name = domain.name.toString();
        this.#properties.version = domain.version.toString();
        this.#properties.chainId = toUint256(domain.chainId);
        this.#properties.verifyingContract = toChecksumAddress(domain.verifyingContract);
        Object.freeze(this.#properties);
        Object.freeze(this);
    }

    get name() { return this.#properties.name; }
    get version() { return this.#properties.version; }
    get chainId() { return this.#properties.chainId; }
    get verifyingContract() { return this.#properties.verifyingContract; }

    static abiOrderedTypes() {
        return {
            EIP712Domain: [
                { name: 'name', type: 'string' },
                { name: 'version', type: 'string' },
                { name: 'chainId', type: 'uint256' },
                { name: 'verifyingContract', type: 'address' },
            ]
        };
    }

    abiEncodableProperties() {
        // immutable (frozen)
        // #properties are already abi encodable.
        return this.#properties;
    }
}