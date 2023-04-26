import assert from 'assert';
import { Contract } from 'ethers';
import { newContract, SharedReadonlyContracts } from './SharedReadonlyContracts.js';
import { HubBase, HubBaseConstructorGuard } from './HubBase.js';
import { ContractBase } from './ContractBase.js';
import { PoCoContractRef, PoCoHubRef } from '../common/contractref.js';
import { CodeError } from '../common/error.js';

export class HubUniswap extends HubBase {

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
    static defaultContractName() { return 'IexecInterfaceToken'; }
    /** @override */
    defaultContractName() { return HubUniswap.defaultContractName(); }

    /**
     * @param {PoCoHubRef} hubRef 
     * @param {string} contractDir
     */
    static sharedReadOnly(hubRef, contractDir) {
        if (!hubRef.isUniswap) {
            throw new CodeError(`Invalid hub=${hubRef.address} argument (not uniswap hub).`);
        }
        const c = SharedReadonlyContracts.get(hubRef, this.defaultContractName(), contractDir);
        return new HubUniswap(c, hubRef, contractDir);
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
            asset: 'Token',
            kyc:false,
            uniswap:true,
            contractName: 'ERC1538Proxy'
        });
        assert(contractRef.isUniswap);

        if (baseContract.isSharedReadOnly) {
            return HubUniswap.sharedReadOnly(contractRef, baseContract.contractDir);
        } 

        const newC = newContract(
            contractRef,
            HubUniswap.defaultContractName(),
            baseContract.contractDir,
            baseContract.signerOrProvider);

        return new HubUniswap(newC, contractRef, baseContract.contractDir);
    }

    async tokenRef() {
        const t = await this.token();
        return new PoCoContractRef({
            chainid: this.chainid,
            contractName: 'RLC',
            url: this.url.toString(),
            address: t
        });
    }
}