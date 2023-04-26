import * as cTypes from './contracts-types-internal.js';
import assert from 'assert';
import { Contract } from "ethers";
import { newContract, SharedReadonlyContracts } from './SharedReadonlyContracts.js';
import { RegistryEntry, RegistryEntryConstructorGuard } from './RegistryEntry.js';
import { ContractBase } from './ContractBase.js';
import { MultiaddrEx } from './MultiaddrEx.js';
import { AppRegistry } from './AppRegistry.js';
import { ContractRef } from '../common/contractref.js';
import { isValidAddress, NULL_ADDRESS, toChecksumAddress } from '../common/ethers.js';
import { isNullishOrEmptyString } from '../common/string.js';
import { isPositiveInteger } from '../common/number.js';
import { CodeError } from '../common/error.js';

export const AppRegistryEntryConstructorGuard = { value: false };

export class AppRegistryEntry extends RegistryEntry {

    /** @type {string=} */
    #m_appName;
    /** @type {string=} */
    #m_appType;
    /** @type {string=} */
    #m_appChecksum;
    /** @type {MultiaddrEx=} */
    #m_appMultiaddr;
    /** @type {cTypes.MREnclave=} */
    #m_appMREnclave;

    /**
     * @param {Contract} contract 
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     */
    constructor(contract, contractRef, contractDir) {
        if (!AppRegistryEntryConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }
    
        assert(!RegistryEntryConstructorGuard.value);
        RegistryEntryConstructorGuard.value = true;
        super(contract, contractRef, contractDir);
        RegistryEntryConstructorGuard.value = false;
    }

    /**
     * @param {Contract} contract 
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     */
    static #newAppRegistryEntry(contract, contractRef, contractDir) {
        assert(!AppRegistryEntryConstructorGuard.value);
        AppRegistryEntryConstructorGuard.value = true;
        const o = new AppRegistryEntry(contract, contractRef, contractDir);
        AppRegistryEntryConstructorGuard.value = false;
        return o;
    }

    /**
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     */
    static sharedReadOnly(contractRef, contractDir) {
        const c = SharedReadonlyContracts.get(contractRef, 'App', contractDir);
        return AppRegistryEntry.#newAppRegistryEntry(c, contractRef, contractDir);
    }

    /**
     * @param {string} address 
     * @param {ContractBase} baseContract 
     */
    static fromAddr(address, baseContract) {
        assert(baseContract);

        const contractRef = new ContractRef({
            chainid: baseContract.chainid,
            contractName: 'App',
            address: address,
            url: baseContract.url
        });

        if (baseContract.isSharedReadOnly) {
            return AppRegistryEntry.sharedReadOnly(contractRef, baseContract.contractDir);
        }

        const newC = newContract(
            contractRef,
            'App',
            baseContract.contractDir,
            baseContract.signerOrProvider);

        return AppRegistryEntry.#newAppRegistryEntry(newC, contractRef, baseContract.contractDir);
    }

    /**
     * @param {cTypes.App} anyObject 
     */
    static isValidObject(anyObject) {
        if (anyObject === null || anyObject === undefined) { return false; }
        if (typeof anyObject != 'object') { return false; }
        if (anyObject instanceof AppRegistryEntry) {
            return true;
        }
        if (!isValidAddress(anyObject.owner)) { return false; }
        if (isNullishOrEmptyString(anyObject.name)) { return false; }
        if (isNullishOrEmptyString(anyObject.type)) { return false; }
        if (isNullishOrEmptyString(anyObject.checksum)) { return false; }
        if (isNullishOrEmptyString(anyObject.multiaddr)) { return false; }
        if (anyObject.mrenclave) {
            /** @type {cTypes.MREnclave} */
            const mrenclave = anyObject.mrenclave;
            if (isNullishOrEmptyString(mrenclave.provider)) { return false; }
            if (isNullishOrEmptyString(mrenclave.version)) { return false; }
            if (isNullishOrEmptyString(mrenclave.entrypoint)) { return false; }
            if (!isPositiveInteger(mrenclave.heapSize)) { return false; }
            if (mrenclave.heapSize > Number.MAX_SAFE_INTEGER - 1) { return false; }
            if (isNullishOrEmptyString(mrenclave.fingerprint)) { return false; }
        }
        return true;
    }

    async name() {
        if (!this.#m_appName) {
            this.#m_appName = await this.contract['m_appName']();
            if (!this.#m_appName) {
                throw new CodeError("Failed to retrieve m_appName property value.");
            }
        }
        return this.#m_appName;
    }
    async type() {
        if (!this.#m_appType) {
            this.#m_appType = await this.contract['m_appType']();
            if (!this.#m_appType) {
                throw new CodeError("Failed to retrieve m_appType property value.");
            }
        }
        return this.#m_appType;
    }
    async checksum() {
        if (!this.#m_appChecksum) {
            this.#m_appChecksum = await this.contract['m_appChecksum']();
            if (!this.#m_appChecksum) {
                throw new CodeError("Failed to retrieve m_appChecksum property value.");
            }
        }
        return this.#m_appChecksum;
    }
    async multiaddr() {
        if (!this.#m_appMultiaddr) {
            const maddr = await this.contract['m_appMultiaddr']();
            this.#m_appMultiaddr = MultiaddrEx.fromDataHexString(maddr);
            if (!this.#m_appMultiaddr) {
                throw new CodeError("Failed to retrieve m_appMultiaddr property value.");
            }
        }
        return this.#m_appMultiaddr;
    }
    async mrenclave() {
        if (!this.#m_appMREnclave) {
            const mrenclave = await this.contract['m_appMREnclave']();
            this.#m_appMREnclave = AppRegistry.Utf8BufferHexToMREnclave(mrenclave);
            if (!this.#m_appMREnclave) {
                throw new CodeError("Failed to retrieve m_appMREnclave property value.");
            }
        }
        return this.#m_appMREnclave;
    }

    /**
     * Helper
     * @param {?(string | AppRegistryEntry)=} app 
     */
    static toAppAddr(app) {
        if (!app) {
            NULL_ADDRESS;
        }
        if (typeof app === 'string') {
            return toChecksumAddress(app);
        }
        if (app instanceof AppRegistryEntry) {
            return app.address ?? NULL_ADDRESS;
        }
        return NULL_ADDRESS;
    }

    /**
     iexec.json format:
     ==================
     owner: checksumaddr
     name: string
     type: 'DOCKER'
     multiaddr: string or multiaddr
     checksum: bytes32string
     mrenclave: {
        provider: string
        version: string
        entrypoint: string
        heapSize: uint [0,Number.MAX_SAFE_INTEGER - 1],
        fingerprint: string,
     }
     */

     async toIExecJSON() {
        const values = await Promise.all([
            this.owner(),
            this.name(),
            this.type(),
            this.multiaddr(),
            this.checksum(),
            this.mrenclave(),
        ]);
        return {
            owner: values[0],
            name: values[1],
            type: values[2],
            multiaddr: values[3],
            checksum: values[4],
            mrenclave: values[5],
        }
    }
}
