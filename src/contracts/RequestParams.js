import * as cTypes from './contracts-types-internal.js';
import assert from 'assert';
import { CodeError } from '../common/error.js';
import { isNullishOrEmptyString, removeSuffix } from '../common/string.js';

export class RequestParams {

    /** @type {string=} */
    #args;

    /** @type {('ipfs' | 'dropbox')=} */
    #storageProvider;

    /** @type {URL=} */
    #storageProxy;

    /** @type {(URL[])=} */
    #inputFiles;

    /** @type {(string[])=} */
    #secrets;

    // iexec_args?: string,
    // iexec_input_files?: string[],
    // iexec_secrets?: Object.<strictlyPositiveInteger,string>,
    // iexec_result_encryption?: boolean,
    // iexec_result_storage_provider?: 'ipfs' | 'dropbox', 
    // iexec_result_storage_proxy?: string
    // iexec_developer_logger?: boolean 

    /**
     * @param {any} value 
     */
    static from(value) {
        if (value === null || value === undefined) {
            throw new CodeError('Invalid argument');
        }
        if (typeof value === 'string') {
            return RequestParams.fromString(value);
        }
        if (typeof value === 'object') {
            return RequestParams.fromJson(value);
        }
        throw new CodeError('Invalid argument');
    }

    /**
     * @param {string} str 
     */
    static fromString(str) {
        const json = JSON.parse(str);
        return this.fromJson(json);
    }

    /**
     * @param {any} json 
     */
    static fromJson(json) {
        const p = new RequestParams();
        const storageProvider = json['iexec_result_storage_provider'];
        if (isNullishOrEmptyString(storageProvider)) {
            throw new CodeError("Invalid request params. Missing 'iexec_result_storage_provider'.");
        }
        if (storageProvider !== 'ipfs' && storageProvider !== 'dropbox') {
            throw new CodeError("Invalid request params. Invalid 'iexec_result_storage_provider'.");
        }
        p.#storageProvider = storageProvider;

        const storageProxy = json['iexec_result_storage_proxy'];
        if (isNullishOrEmptyString(storageProxy)) {
            throw new CodeError("Invalid request params. Missing 'iexec_result_storage_proxy'.");
        }
        try {
            const u = new URL(storageProxy);
            p.#storageProxy = u;
        } catch {
            throw new CodeError("Invalid request params. Invalid 'iexec_result_storage_proxy'.");
        }

        if (!isNullishOrEmptyString(json['iexec_args'])) {
            p.#args = json['iexec_args'];
        }
        if (Array.isArray(json['iexec_input_files'])) {
            const f = json['iexec_input_files'];
            if (f.length > 0) {
                p.#inputFiles = [];
                for (let i = 0; i < f.length; ++i) {
                    p.#inputFiles.push(new URL(f[i]));
                }
            }
        }

        return p;
    }

    get args() {
        return this.#args;
    }

    /**
     * @param {cTypes.positiveInteger} index 
     */
    getSecret(index) {
        return this.#secrets?.[index];
    }

    /**
     * @param {cTypes.positiveInteger} index 
     */
    getInputFile(index) {
        return this.#inputFiles?.[index];
    }

    get storageProvider() {
        assert(this.#storageProvider);
        return this.#storageProvider;
    }

    get storageProxy() {
        assert(this.#storageProxy);
        return this.#storageProxy.toString();
    }

    // WARNING : any modification will alter the RequestOrder hash value.
    #abiEncodableSecrets() {
        if (!this.#secrets || this.#secrets.length === 0) {
            return null;
        }
        /** @type {Object.<string,string>} */
        const s = {};
        for (let i = 0; i < this.#secrets.length; ++i) {
            const j = i + 1;
            s[j.toString()] = this.#secrets[i];
        }
        return s;
    }

    /**
     * Compute ready-to-abi-encode properties
     * keys order does not matter.
     */
    abiEncodableProperties() {
        // WARNING : any modification will alter the RequestOrder hash value.
        const ep = {};
        if (this.#args) { 
            ep['iexec_args'] = this.#args; 
        }
        if (this.#inputFiles) { 
            ep['iexec_input_files'] = this.#inputFiles.map((f) => { return f.toString(); }); 
        }
        if (this.#secrets) { 
            ep['iexec_secrets'] = this.#abiEncodableSecrets(); 
        }

        assert(this.#storageProvider);
        assert(this.#storageProxy);

        ep['iexec_result_storage_provider'] = this.#storageProvider;

        // Remove '/' suffix 
        // Keeping the '/' suffix will also run but all the resulting RequestOrder hash values will differ.
        ep['iexec_result_storage_proxy'] = removeSuffix('/', this.#storageProxy.toString());

        // WARNING: do not change any stringify argument !
        // It may alter the RequestOrder hash value
        return JSON.stringify(ep);
    }
}
