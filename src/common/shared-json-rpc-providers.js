import assert from "assert";
import { ContractRef } from "./contractref.js";
import { providers } from 'ethers';
import { CodeError } from "./error.js";

export class SharedJsonRpcProviders {

    /** @type {Map<string, providers.JsonRpcProvider>} */
    static #map = new Map();

    /**
     * - Throws an error if `ref` is invalid
     * @param {ContractRef} ref 
     */
    static fromContractRef(ref) {
        if (!ref || !ref.hasURL) {
            throw new CodeError('Invalid ContractRef argument');
        }
        assert(ref.url); //compiler
        const url = ref.url.toString();
        const key = url + ref.chainid;
        const p = SharedJsonRpcProviders.#map.get(key);
        if (p) {
            return p;
        }
        const newP = new providers.JsonRpcProvider(url, {
            chainId: ref.chainid,
            name: 'unknown'
        });

        SharedJsonRpcProviders.#map.set(key, newP);
        return newP;
    }

    /**
     * @param {{ 
     *      chainid: number
     *      url?: URL
     * }} args 
     */
    static fromURL({ chainid, url }) {
        if (!url) {
            throw new CodeError('Invalid url argument');
        }
        const urlStr = url.toString();
        const key = urlStr + chainid.toString();
        const p = SharedJsonRpcProviders.#map.get(key);
        if (p) {
            return p;
        }
        const newP = new providers.JsonRpcProvider(urlStr, {
            chainId: chainid,
            name: 'unknown'
        });

        SharedJsonRpcProviders.#map.set(key, newP);
        return newP;
    }
}