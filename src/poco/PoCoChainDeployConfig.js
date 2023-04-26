import * as pocoTypes from './poco-types.js';
import * as types from '../common/common-types.js';
import * as ERROR_CODES from "../common/error-codes.js";
import assert from 'assert';
import { PoCoDeploySequence } from './PoCoDeploySequence.js';
import { STANDARD_CONFIG } from './PoCoDeployer.js';
import { isNullishOrEmptyString, throwIfNullishOrEmptyString } from '../common/string.js';
import { ethersIsValidMnemonic, isValidAddress } from '../common/ethers.js';
import { CodeError } from '../common/error.js';
import { isStrictlyPositiveInteger } from '../common/number.js';
import { ContratRefFromString, DevContractRef, EXTRA_POCO_CONTRACT_NAMES, PoCoContractRef, PoCoHubRef, POCO_CONTRACT_NAMES } from '../common/contractref.js';

export class PoCoChainDeployConfig {

    /** @type {string} */
    #mnemonic
    /** @type {number} */
    #chainid
    /** @type {PoCoDeploySequence} */
    #sequence
    /** @type {Object.<string, pocoTypes.PoCoContracts>} */
    #addresses
    /** @type {Object.<string, pocoTypes.ExtraPoCoContracts>} */
    #extraaddresses

    /** 
     * @param {pocoTypes.PoCoChainConfig=} arg 
     */
    constructor(arg) {
        // 'mnemonic' should never be set with a default value
        let mnemonic = arg?.mnemonic;
        throwIfNullishOrEmptyString(mnemonic);
        assert(mnemonic);
        if (!ethersIsValidMnemonic(mnemonic)) {
            throw new CodeError(
                "Invalid 'mnemonic' property.",
                ERROR_CODES.POCO_ERROR);
        }
        this.#mnemonic = mnemonic;

        // 'chainid' should never be set with a default value
        let chainid = arg?.chainid;
        if (!isStrictlyPositiveInteger(chainid)) {
            throw new CodeError(
                "Invalid 'chainid' property.",
                ERROR_CODES.POCO_ERROR);
        }
        assert(chainid);
        this.#chainid = chainid;

        let ds = arg?.deploySequence;
        if (ds === null || ds === undefined) {
            /** @type {pocoTypes.PoCoDeployConfig} */
            const std = { ...STANDARD_CONFIG };
            ds = [std];
        }
        if (!Array.isArray(ds)) {
            throw new CodeError(
                "'deploySequence' must be an array.",
                ERROR_CODES.POCO_ERROR);
        }

        /*
        deploySequence:[
            {
                name: "myConfig1"
            },
            {
                name: "myConfig2"
                AppRegistry: "myConfig1"
            },
        ],
        addresses: {
            "myConfig1":{
                AppRegistry: "0x12345..."
            }
            "myConfig2":{
                AppRegistry: "0x12345..."
            }
        }
        */

        const addr = arg?.addresses;
        if (addr !== null && addr !== undefined) {
            if (typeof addr !== 'object') {
                throw new CodeError(
                    "Invalid 'addresses' property.",
                    ERROR_CODES.POCO_ERROR);
            }
        }
        const xaddr = arg?.extraaddresses;
        if (xaddr !== null && xaddr !== undefined) {
            if (typeof xaddr !== 'object') {
                throw new CodeError(
                    "Invalid 'extraaddresses' property.",
                    ERROR_CODES.POCO_ERROR);
            }
        }
        const configNames = (addr) ? Object.keys(addr) : [];

        this.#sequence = new PoCoDeploySequence(ds);
        this.#addresses = {};
        this.#extraaddresses = {};

        if (addr) {
            for (let i = 0; i < configNames?.length; ++i) {
                const configName = configNames[i];
                const configAddresses = addr[configName];
                if (!this.#sequence.has(configName)) {
                    throw new CodeError(
                        `Invalid config name '${configName}'.`,
                        ERROR_CODES.POCO_ERROR);
                }
                if (configAddresses === null || configAddresses === undefined) {
                    throw new CodeError(
                        "Invalid 'addresses' property.",
                        ERROR_CODES.POCO_ERROR);
                }
                if (typeof configAddresses !== 'object') {
                    throw new CodeError(
                        "Invalid 'addresses' property.",
                        ERROR_CODES.POCO_ERROR);
                }
                this.#addresses[configName] = {};
                for (let j = 0; j < POCO_CONTRACT_NAMES.length; ++j) {
                    const a = configAddresses[POCO_CONTRACT_NAMES[j]];
                    if (a === null || a === undefined) {
                        continue;
                    }
                    if (!isValidAddress(a)) {
                        throw new CodeError(
                            `Invalid contract address ${POCO_CONTRACT_NAMES[j]}='${a}'`,
                            ERROR_CODES.POCO_ERROR);
                    }
                    this.#addresses[configName][POCO_CONTRACT_NAMES[j]] = a;
                }
                Object.freeze(this.#addresses[configName]);
                this.#sequence.applyAddresses(
                    configName,
                    this.#addresses[configName]);
            }
        }
        if (xaddr) {
            for (let i = 0; i < configNames?.length; ++i) {
                const configName = configNames[i];
                const configAddresses = xaddr[configName];
                if (!this.#sequence.has(configName)) {
                    throw new CodeError(
                        `Invalid config name '${configName}'.`,
                        ERROR_CODES.POCO_ERROR);
                }
                if (configAddresses === null || configAddresses === undefined) {
                    throw new CodeError(
                        "Invalid 'extraaddresses' property.",
                        ERROR_CODES.POCO_ERROR);
                }
                if (typeof configAddresses !== 'object') {
                    throw new CodeError(
                        "Invalid 'extraaddresses' property.",
                        ERROR_CODES.POCO_ERROR);
                }
                this.#extraaddresses[configName] = {};
                for (let j = 0; j < EXTRA_POCO_CONTRACT_NAMES.length; ++j) {
                    const a = configAddresses[EXTRA_POCO_CONTRACT_NAMES[j]];
                    if (a === null || a === undefined) {
                        continue;
                    }
                    if (!isValidAddress(a)) {
                        throw new CodeError(
                            `Invalid contract extraaddress ${EXTRA_POCO_CONTRACT_NAMES[j]}='${a}'`,
                            ERROR_CODES.POCO_ERROR);
                    }
                    this.#extraaddresses[configName][EXTRA_POCO_CONTRACT_NAMES[j]] = a;
                }
                Object.freeze(this.#extraaddresses[configName]);
                this.#sequence.applyExtraAddresses(
                    configName,
                    this.#extraaddresses[configName]);
            }
        }
    }

    /**
     * - returns null or resolved
     * @param {string} address 
     * @param {string=} url 
     * @returns {PoCoHubRef | PoCoContractRef | null}
     */
    findAddress(address, url) {
        if (isNullishOrEmptyString(address)) {
            return null;
        }
        const configNames = Object.keys(this.#addresses);
        for (let i = 0; i < configNames.length; ++i) {
            const configName = configNames[i];
            const contracts = this.#addresses[configName];
            for (let j = 0; j < POCO_CONTRACT_NAMES.length; ++j) {
                const addr = contracts[POCO_CONTRACT_NAMES[j]];
                if (addr === address) {
                    if (POCO_CONTRACT_NAMES[j] === 'ERC1538Proxy') {
                        const conf = this.#sequence.getPoCoConfig(configName);
                        assert(conf);
                        const c = new PoCoHubRef({
                            chainid: this.chainid,
                            deployConfigName: configName,
                            address: address,
                            contractName: 'ERC1538Proxy',
                            asset: conf.asset,
                            kyc: conf.kyc ?? false,
                            uniswap: conf.uniswap ?? false,
                            url: url
                        });
                        assert(c.resolved);
                        return c;
                    } else {
                        const c = new PoCoContractRef({
                            chainid: this.chainid,
                            deployConfigName: configName,
                            address: address,
                            contractName: POCO_CONTRACT_NAMES[j],
                            url: url
                        });
                        assert(c.resolved);
                        return c;
                    }
                }
            }
        }
        return null;
    }

    /**
     * - returns null or resolved
     * @param {string} address 
     * @param {string=} url 
     * @returns {DevContractRef | null}
     */
    findExtraAddress(address, url) {
        if (isNullishOrEmptyString(address)) {
            return null;
        }
        const configNames = Object.keys(this.#extraaddresses);
        for (let i = 0; i < configNames.length; ++i) {
            const configName = configNames[i];
            const contracts = this.#extraaddresses[configName];
            for (let j = 0; j < EXTRA_POCO_CONTRACT_NAMES.length; ++j) {
                const addr = contracts[EXTRA_POCO_CONTRACT_NAMES[j]];
                if (addr === address) {
                    const c = new DevContractRef({
                        chainid: this.chainid,
                        deployConfigName: configName,
                        address: address,
                        contractName: EXTRA_POCO_CONTRACT_NAMES[j],
                        url: url
                    });
                    assert(c.resolved);
                    return c;
                }
            }
        }
        return null;
    }

    /**
     * string value can be one of the following:
     * - `<chainid>.<address>`
     * - `<chainid>.<deployConfigName>` (resolved as a 'ERC1538Proxy' contract)
     * - any ContractRef key 
     * - returns null or resolved
     * @param {string | types.DevContractRefLike} ref 
     * @param {{
     *      contractName?: types.PoCoContractName | types.ExtraPoCoContractName
     *      url?: string
     * }} options
     * @returns {PoCoHubRef | PoCoContractRef | DevContractRef | null}
     */
    resolve(ref, { contractName = 'ERC1538Proxy', url } = {}) {
        if (!ref) {
            return null;
        }
        if (url) {
            throwIfNullishOrEmptyString(url);
        }
        throwIfNullishOrEmptyString(contractName);
        assert(contractName);

        if (typeof ref === 'string') {
            /** @type {types.DevContractRefLike?} */
            const cr = ContratRefFromString(ref, contractName);
            if (!cr) {
                return null;
            }
            ref = cr;
        }

        if (ref.url && url) {
            const u = new URL(url);
            if (ref.url.toString() !== u.toString()) {
                return null;
            }
        }
        if (ref.contractName) {
            if (ref.contractName !== contractName) {
                return null;
            }
        }

        if (ref.chainid !== this.chainid) {
            return null;
        }

        if (ref.address) {
            const hr = this.findAddress(ref.address, url);
            if (hr) {
                assert(hr.hasContractName);
                if (hr.contractName !== contractName) {
                    return null;
                }
                assert(!hr.notEq(ref));
                return hr;
            }

            const hrx = this.findExtraAddress(ref.address, url);
            if (hrx) {
                assert(hrx.hasContractName);
                if (hrx.contractName !== contractName) {
                    return null;
                }
                assert(!hrx.notEq(ref));
                return hrx;
            }

            return null;
        }

        if (!ref.deployConfigName) {
            return null;
        }
        if (!ref.contractName) {
            return null;
        }
        const conf = this.getPoCoConfig(ref.deployConfigName)
        if (!conf) {
            return null;
        }

        const pocoContracts = this.#addresses[ref.deployConfigName];

        /** @todo remove ts-ignore */
        // @ts-ignore
        let addr = pocoContracts[ref.contractName];
        if (!addr) {
            // Happens with extra contracts or 'ERLCTokenSwap' on a standard hub
            const extraPocoContracts = this.#extraaddresses[ref.deployConfigName];
            /** @todo remove ts-ignore */
            // @ts-ignore
            addr = extraPocoContracts[ref.contractName];
        }

        if (!addr) {
            return null;
        }

        const refContractName = ref.contractName;

        if ((ref instanceof PoCoHubRef) || refContractName === 'ERC1538Proxy') {
            const c = new PoCoHubRef({
                chainid: this.chainid,
                deployConfigName: ref.deployConfigName,
                contractName: 'ERC1538Proxy',
                address: addr,
                asset: conf.asset,
                kyc: conf.kyc ?? false,
                uniswap: conf.uniswap ?? false,
                url: url
            });
            assert(c.resolved);
            return c;
        }

        if ((ref instanceof PoCoContractRef) || PoCoContractRef.isPoCoContractName(refContractName)) {
            const c = new PoCoContractRef({
                chainid: this.chainid,
                deployConfigName: ref.deployConfigName,
                // @ts-ignore
                contractName: refContractName,
                address: addr,
                url: url
            });
            assert(c.resolved);
            return c;
        }

        if ((ref instanceof DevContractRef) || refContractName === 'Workerpool') {
            const c = new DevContractRef({
                chainid: this.chainid,
                deployConfigName: ref.deployConfigName,
                contractName: refContractName,
                address: addr,
                url: url
            });
            assert(c.resolved);
            return c;
        }

        return null;
    }

    get chainid() { return this.#chainid }
    get mnemonic() { return this.#mnemonic }
    get length() { return (this.#sequence) ? this.#sequence.length : 0; }

    get isFullyDeployed() {
        return Object.keys(this.#addresses).length === this.#sequence.length;
    }

    /** @param {*} index */
    isConfigDeployedAt(index) {
        return (this.#addresses[index] != null);
    }

    configNames() {
        return this.#sequence?.configNames();
    }

    /** @param {*} index */
    configNameAt(index) {
        return this.#sequence?.configNameAt(index);
    }

    /** @param {*} index */
    workerpoolAt(index) {
        return this.#sequence?.workerpoolAt(index);
    }

    /** @param {string} name */
    workerpool(name) {
        return this.#sequence?.workerpool(name);
    }

    /** @param {number} index */
    getPoCoConfigAt(index) {
        return this.#sequence?.getPoCoConfigAt(index);
    }

    /** @param {string} name */
    getPoCoConfig(name) {
        return this.#sequence?.getPoCoConfig(name);
    }

    /**
     * @param {string} configName 
     * @param {types.PoCoContractName} contractName 
     */
    address(configName, contractName) {
        return this.#addresses?.[configName]?.[contractName];
    }
    /**
     * @param {string} configName 
     * @param {types.ExtraPoCoContractName} contractName 
     */
    extraaddress(configName, contractName) {
        return this.#extraaddresses?.[configName]?.[contractName];
    }

    /**
     * @param {string} configName 
     * @param {pocoTypes.PoCoContracts} addresses 
     */
    setConfigDeployedAddresses(configName, addresses) {
        this.#sequence.applyAddresses(configName, addresses);
        if (!this.#addresses) {
            this.#addresses = {};
        }
        assert(!this.#addresses[configName]);
        this.#addresses[configName] = { ...addresses };
        Object.freeze(this.#addresses[configName]);
    }

    /**
     * @param {string} configName 
     * @param {pocoTypes.ExtraPoCoContracts} extraaddresses 
     */
    setConfigDeployedExtraAddresses(configName, extraaddresses) {
        this.#sequence.applyExtraAddresses(configName, extraaddresses);
        if (!this.#extraaddresses) {
            this.#extraaddresses = {};
        }
        assert(!this.#extraaddresses[configName]);
        this.#extraaddresses[configName] = { ...extraaddresses };
        Object.freeze(this.#extraaddresses[configName]);
    }

    /** 
     * @param {boolean} onlyDeployed
     * @returns {pocoTypes.PoCoChainConfig} 
     */
    toPoCoChainConfig(onlyDeployed = false) {
        return {
            chainid: this.#chainid,
            mnemonic: this.#mnemonic,
            deploySequence: this.#sequence.toPoCoDeployConfigArray(onlyDeployed),
            addresses: this.#addresses,
            extraaddresses: this.#extraaddresses
        }
    }

    /**
     * @param {PoCoChainDeployConfig} config 
     */
    isCompatibleWith(config) {
        if (this.chainid !== config.chainid) {
            return false;
        }
        if (this.mnemonic !== config.mnemonic) {
            return false;
        }
        const ok = PoCoDeploySequence.compatible(
            this.#sequence,
            this.#addresses,
            config.#sequence,
            config.#addresses
        );
        return ok;
    }
}