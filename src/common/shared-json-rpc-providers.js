import assert from "assert";
import { ContractRef } from "./contractref.js";
import { providers } from 'ethers';
import { CodeError } from "./error.js";
import { isNullishOrEmptyString } from "./string.js";
import { toChecksumAddress } from "./ethers.js";

export class SharedJsonRpcProviders {

    /** @type {Map<string, providers.JsonRpcProvider>} */
    static #map = new Map();

    /**
     * - Throws an error if `ref` is invalid
     * @param {ContractRef} ref 
     * @param {{
     *      ensAddress: string
     *      networkName: string
     * }} options 
     */
    static fromContractRef(ref, { ensAddress, networkName }) {
        if (!ref || !ref.hasURL) {
            throw new CodeError('Invalid ContractRef argument');
        }
        assert(ref.url); //compiler
        networkName = networkName ?? 'unknown';
        const url = ref.url.toString();
        const key = url + ref.chainid + ensAddress + networkName;
        const p = SharedJsonRpcProviders.#map.get(key);
        if (p) {
            return p;
        }
        ensAddress = toChecksumAddress(ensAddress);
        const newP = new providers.JsonRpcProvider(url, {
            ensAddress,
            chainId: ref.chainid,
            name: networkName
        });

        SharedJsonRpcProviders.#map.set(key, newP);
        return newP;
    }

    /**
     * @param {URL} url
     * @param {number} chainid
     * @param {{ 
     *      ensAddress: string,
     *      networkName: string
     * }} options 
     */
    static fromURL(url, chainid, { ensAddress, networkName }) {
        if (!url) {
            throw new CodeError('Invalid url argument');
        }
        const urlStr = url.toString();
        const key = urlStr + chainid.toString();
        const p = SharedJsonRpcProviders.#map.get(key);
        if (p) {
            return p;
        }
        ensAddress = toChecksumAddress(ensAddress);
        const newP = new providers.JsonRpcProvider(urlStr, {
            ensAddress,
            chainId: chainid,
            name: networkName ?? 'unknown'
        });

        SharedJsonRpcProviders.#map.set(key, newP);
        return newP;
    }
}