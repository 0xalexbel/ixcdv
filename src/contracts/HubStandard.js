import assert from 'assert';
import { Contract } from 'ethers';
import { SharedReadonlyContracts } from '../common/contracts/SharedReadonlyContracts.js';
import { HubBase, HubBaseConstructorGuard } from './HubBase.js';
import { ContractBase } from '../common/contracts/ContractBase.js';
import { PoCoContractRef, PoCoHubRef, newContract } from '../common/contractref.js';
import { CodeError } from '../common/error.js';

export class HubStandard extends HubBase {

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
    defaultContractName() { return HubStandard.defaultContractName(); }

    /**
     * @param {PoCoHubRef} hubRef 
     * @param {string} contractDir
     * @param {{
     *      ensAddress: string
     *      networkName: string
     * }} options 
     */
    static sharedReadOnly(hubRef, contractDir, options) {
        if (!hubRef.isStandard) {
            throw new CodeError(`Invalid hub=${hubRef.address} argument (not standard hub).`);
        }
        const c = SharedReadonlyContracts.get(hubRef, this.defaultContractName(), contractDir, options);
        return new HubStandard(c, hubRef, contractDir);
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
            uniswap:false,
            contractName: 'ERC1538Proxy'
        });

        if (baseContract.isSharedReadOnly) {
            return HubStandard.sharedReadOnly(contractRef, baseContract.contractDir, baseContract.network);
        } 

        const newC = newContract(
            contractRef,
            HubStandard.defaultContractName(),
            baseContract.contractDir,
            baseContract.signerOrProvider);

        return new HubStandard(newC, contractRef, baseContract.contractDir);
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