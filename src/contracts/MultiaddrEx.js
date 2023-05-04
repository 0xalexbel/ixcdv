// Dependencies
// ../common
import * as cTypes from './contracts-types-internal.js';
import assert from 'assert';
import { multiaddr, Multiaddr } from 'multiaddr';
import { isDataHexString, toBytes, toBytesString } from '../common/ethers.js';

export class MultiaddrEx {
    /** @type {Multiaddr?} */
    #multiaddr;
    /** @type {string?} */
    #multiaddrstring;

    /**
     * @param {Multiaddr?} multiaddr 
     * @param {string?} multiaddrstring 
     */
    constructor(multiaddr, multiaddrstring) {
        this.#multiaddr = multiaddr;
        this.#multiaddrstring = multiaddrstring;
    }

    /** @param { cTypes.DataHexString } value */
    static fromDataHexString(value) {
        if (value == null || value === '0x0' || value === '') {
            return this.from(null);
        }
        if (!isDataHexString(value)) {
            throw Error('Invalid argument');
        }
        const bytes = toBytes(value);
        return this.from(bytes);
    }

    /**
     * - If needed, converts to a non-null `iExecMultiaddr` instance.
     * @param {any} maddr 
     */
    static toNonNullOrThrowError(maddr) {
        if (maddr == null) {
            throw Error('Invalid multiaddr');
        }
        if (!(maddr instanceof MultiaddrEx)) {
            maddr = MultiaddrEx.from(maddr);
        }
        if (maddr == null || maddr.isNull()) {
            throw Error('Invalid multiaddr');
        }
        return maddr;
    }

    /** @param { MultiaddrEx | string | Uint8Array | null } value */
    static from(value) {
        if (!MultiaddrEx.isMultiaddrLike(value)) {
            throw Error('Invalid multiaddr');
        }

        if (value == null) {
            return new MultiaddrEx(null, null);
        }

        if(value instanceof MultiaddrEx) {
            return new MultiaddrEx(value.#multiaddr, value.#multiaddrstring);
        }

        assert((typeof value === 'string') || (value instanceof Uint8Array));

        let _multiaddr = null;
        let _multiaddrstring = null;
        
        try {
            // throw error if wrong format
            // will keep the original string instead
            _multiaddr = multiaddr(value);
        } catch (err) {}

        if (typeof value === 'string') {
            _multiaddrstring = value;
        } else if (value instanceof Uint8Array) {
            _multiaddrstring = Buffer.from(value).toString();
        }

        if (_multiaddr == null && _multiaddrstring == null) {
            throw Error('Invalid multiaddr');
        }

        return new MultiaddrEx(_multiaddr, _multiaddrstring);
    }

    /**
     * @param {any} value 
     */
    static isMultiaddrLike(value) {
        if (value == null) {
            return true;
        }
        if (value instanceof MultiaddrEx) {
            return true;
        }
        if (typeof value === 'string' || (value instanceof Uint8Array)) {
            return true;
        }
        return false;
    }

    /**
     * Supports JSON.stringify
     */
    toJSON() {
        return this.toString();    
    }

    toBytes() {
        if (this.#multiaddr != null) {
            return Buffer.from(this.#multiaddr.bytes);
        }
        if (this.#multiaddrstring != null) {
            return Buffer.from(this.#multiaddrstring, 'utf8');
        }
        return null;
    }

    toString() {
        if (this.#multiaddr != null) {
            return this.#multiaddr.toString();
        }
        return this.#multiaddrstring;
    }

    /**
     * Implements Hexable ethers interface
     * @return {cTypes.DataHexString}
     */
    toHexString() {
        if (this.#multiaddr != null) {
            return toBytesString(this.#multiaddr.bytes);
        }
        return toBytesString(this.toBytes());
    }

    isNull() {
        return this.#multiaddr == null && this.#multiaddrstring == null;
    }
}
