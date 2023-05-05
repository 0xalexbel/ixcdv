import assert from "assert";
import path from "path";
import { Contract, providers, Signer } from 'ethers';
import { ContractRef } from "../contractref.js";
import { importJsonModule } from "../import.cjs";
import { SharedJsonRpcProviders } from "../shared-json-rpc-providers.js";
import { CodeError } from "../error.js";

export class SharedReadonlyContracts {

    // #map.get(<provider>) === Map that contains the following
    // heterogeneous (key,value) pairs: 
    // - <ContractRef.baseKey>/<contractName> -> <Contract>
    // and
    // - <Contract> -> <contractName>
    /** @type {Map<providers.JsonRpcProvider, Map<(string | Contract),(Contract | string)>>} */
    static #map = new Map();

    /**
     * @param {ContractRef} ref 
     * @param {string} contractName 
     * @param {string} contractDir 
     * @param {{
     *      ensAddress: string
     *      networkName: string
     * }} options 
     */
    static get(ref, contractName, contractDir, { ensAddress, networkName }) {
        if (!ref || !ref.hasURL || !ref.hasAddress) {
            throw new CodeError('Invalid ContractRef argument');
        }
        assert(ref.address);
        const key = ref.baseKey + '/' + contractName;

        const provider = SharedJsonRpcProviders.fromContractRef(ref, { ensAddress, networkName });

        let contracts = SharedReadonlyContracts.#map.get(provider);
        if (contracts) {
            const c = contracts.get(key);
            if (c) {
                assert(c instanceof Contract);
                return c;
            }
        }

        const modulePath = path.join(contractDir, contractName + '.json');
        const contractModule = importJsonModule(modulePath);

        const newC = new Contract(ref.address, contractModule.abi, provider);
        if (!contracts) {
            contracts = new Map();
            SharedReadonlyContracts.#map.set(provider, contracts)
        }

        // key = <ContractRef.baseKey>/<contractName>
        // newC = <Contract>
        contracts.set(key, newC);
        contracts.set(newC, contractName);
        return newC;
    }

    /**
     * @param {Contract} contract 
     */
    static isShared(contract) {
        const p = contract.provider;

        if (p instanceof providers.JsonRpcProvider) {
            const contracts = SharedReadonlyContracts.#map.get(p);
            if (contracts) {
                return contracts.has(contract);
            }
        }
        return false;
    }
}