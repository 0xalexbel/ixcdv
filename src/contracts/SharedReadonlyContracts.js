import assert from "assert";
import path from "path";
import { Contract, providers, Signer } from 'ethers';
import { ContractRef } from "../common/contractref.js";
import { importJsonModule } from "../common/import.cjs";
import { SharedJsonRpcProviders } from "../common/shared-json-rpc-providers.js";
import { CodeError } from "../common/error.js";

/**
 * @param {ContractRef} contractRef 
 * @param {string} contractName
 * @param {string} contractDir
 * @param {Signer | providers.Provider} signerOrProvider 
 */
export function newContract(contractRef, contractName, contractDir, signerOrProvider) {
    assert(signerOrProvider);
    assert(contractRef.address);

    const modulePath = path.join(contractDir, contractName + '.json');
    const contractModule = importJsonModule(modulePath);

    return new Contract(contractRef.address, contractModule.abi, signerOrProvider);
}

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
     */
    static get(ref, contractName, contractDir) {
        if (!ref || !ref.hasURL || !ref.hasAddress) {
            throw new CodeError('Invalid ContractRef argument');
        }
        assert(ref.address);
        const key = ref.baseKey + '/' + contractName;

        const provider = SharedJsonRpcProviders.fromContractRef(ref);

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