import assert from 'assert';
import { Contract } from 'ethers';
import { newContract, SharedReadonlyContracts } from './SharedReadonlyContracts.js';
import { HubBase, HubBaseConstructorGuard } from './HubBase.js';
import { ContractBase } from './ContractBase.js';
import { PoCoHubRef } from '../common/contractref.js';
import { CodeError } from '../common/error.js';

export class HubNative extends HubBase {

    /**
     * @param {Contract} contract 
     * @param {PoCoHubRef} hubRef 
     * @param {string} contractDir
     */
    constructor(contract, hubRef, contractDir) {
        assert(!HubBaseConstructorGuard.value);
        HubBaseConstructorGuard.value = true;
        super(contract, hubRef, contractDir);
        HubBaseConstructorGuard.value = false;
    }

    /** @override */
    static defaultContractName() { return 'IexecInterfaceNative'; }
    /** @override */
    defaultContractName() { return HubNative.defaultContractName(); }

    /**
     * @param {PoCoHubRef} hubRef 
     * @param {string} contractDir
     */
    static sharedReadOnly(hubRef, contractDir) {
        if (!hubRef.isNative) {
            throw new CodeError(`Invalid hub=${hubRef.address} argument (not native hub).`);
        }
        const c = SharedReadonlyContracts.get(hubRef, this.defaultContractName(), contractDir);
        return new HubNative(c, hubRef, contractDir);
    }

    /**
     * @param {string} address 
     * @param {ContractBase} baseContract 
     */
    static fromAddr(address, baseContract) {
        assert(baseContract);

        const contractRef = new PoCoHubRef({
            chainid: baseContract.chainid,
            address: address,
            url: baseContract.url,
            asset: 'Native',
            kyc:false,
            uniswap:false,
            contractName: 'ERC1538Proxy'
        });
        assert(contractRef.isNative);

        if (baseContract.isSharedReadOnly) {
            return HubNative.sharedReadOnly(contractRef, baseContract.contractDir);
        } 

        const newC = newContract(
            contractRef,
            HubNative.defaultContractName(),
            baseContract.contractDir,
            baseContract.signerOrProvider);

        return new HubNative(newC, contractRef, baseContract.contractDir);
    }
}