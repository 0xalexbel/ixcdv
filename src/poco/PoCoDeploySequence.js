import * as ERROR_CODES from "../common/error-codes.js";
import * as pocoTypes from './poco-types.js';
import { BigNumber } from 'ethers';
import assert from 'assert';
import { PoCoDeployItem } from './PoCoDeployItem.js';
import { isDeepStrictEqual } from 'util';
import { isBytes32String, isHexString40, isValidAddress } from '../common/ethers.js';
import { CodeError } from '../common/error.js';
import { isNullishOrEmptyString, removePrefix } from "../common/string.js";

export class PoCoDeploySequence {

    /** @type {PoCoDeployItem[]} */
    #sequence = [];

    /** @type {Map.<string, PoCoDeployItem>} */
    #dict = new Map();

    /** @type {BigNumber} */
    #nextAutoSalt = BigNumber.from(1);

    /** @param {*} arg */
    constructor(arg) {
        if (arg === null || arg === undefined) {
            return;
        }
        if (!Array.isArray(arg)) {
            return;
        }
        for (let i = 0; i < arg.length; ++i) {
            this.add(arg[i]);
        }
    }

    /**
     * @param {PoCoDeployItem} config 
     * @param {string} key 
     */
    #resolveAddress(config, key) {
        assert( key === 'etoken' || 
            key === 'token' || 
            key === 'AppRegistry' || 
            key === 'WorkerpoolRegistry' || 
            key === 'DatasetRegistry' || 
            key === 'Workerpool' );
        let value = config[key];
        if (value && value !== 'new') {
            if (value.startsWith('0x')) {
                assert(isValidAddress(value));
            } else {
                const c = this.#dict.get(value);
                assert(c);
                value = c[key];
                if (!value) {
                    throw new TypeError(`Missing deployed address '${key}' in PoCo config '${value}'`);
                }
                assert(isValidAddress(value));
                config.resolveAddress(key, value);
            }
        }
    }

    get length() {
        return this.#sequence.length;
    }

    /** @param {*} index */
    workerpoolAt(index) {
        if (index < 0 || index >= this.#sequence.length) {
            return; /* undefined */
        }
        return {
            registry: this.#sequence[index]?.WorkerpoolRegistry,
            address: this.#sequence[index]?.Workerpool,
            accountIndex: this.#sequence[index]?.WorkerpoolAccountIndex,
            description: this.#sequence[index]?.WorkerpoolDescription,
        }
    }

    /** @param {string} configName */
    workerpool(configName) {
        const config = this.#dict.get(configName);
        if (!config) {
            return; /* undefined */
        }
        return this.workerpoolAt(config.index);
    }

    /** @param {*} index */
    configNameAt(index) {
        try {
            return this.#sequence?.[index]?.name;
        } catch { }
        return undefined;
    }

    configNames() {
        return this.#sequence?.map( v => v.name );
    }

    /**
     * @param {string} configName 
     */
    has(configName) {
        return this.#dict.has(configName);
    }

    /**
     * @param {string} configName
     * @returns {pocoTypes.PoCoConfig=}
     */
    getPoCoConfig(configName) {
        const config = this.#dict.get(configName);
        if (!config) {
            return /* undefined */;
        }
        return this.getPoCoConfigAt(config.index);
    }

    /**
     * @param {number} index 
     * @returns {pocoTypes.PoCoConfig=}
     */
    getPoCoConfigAt(index) {
        const config = this.#sequence[index];

        this.#resolveAddress(config, 'token');
        this.#resolveAddress(config, 'etoken');
        this.#resolveAddress(config, 'AppRegistry');
        this.#resolveAddress(config, 'DatasetRegistry');
        this.#resolveAddress(config, 'WorkerpoolRegistry');
        this.#resolveAddress(config, 'Workerpool');

        /** @type {pocoTypes.PoCoConfig} */
        let pocoConf;

        if (config.asset === 'Token') {

            /** @type {pocoTypes.PoCoEnterpriseConfig | pocoTypes.PoCoStandardConfig | pocoTypes.PoCoUniswapConfig} */
            let pocoTokenConf;
            if (config.kyc) {
                assert(!config.uniswap);
                /** @type {pocoTypes.PoCoEnterpriseConfig} */
                const pocoEntConf = {
                    asset: config.asset,
                    kyc: config.kyc,
                    uniswap: config.uniswap
                }
                if (config.etoken && config.etoken !== 'new') {
                    pocoEntConf.etoken = config.etoken;
                }
                pocoTokenConf = pocoEntConf;
            } else {
                if (config.uniswap) {
                    /** @type {pocoTypes.PoCoUniswapConfig} */
                    const pocoUniConf = {
                        asset: config.asset,
                        kyc: config.kyc,
                        uniswap: config.uniswap
                    }
                    pocoTokenConf = pocoUniConf;
                } else {
                    /** @type {pocoTypes.PoCoStandardConfig} */
                    const pocoStdConf = {
                        asset: config.asset,
                        kyc: config.kyc,
                        uniswap: config.uniswap
                    }
                    pocoTokenConf = pocoStdConf;
                }
            }

            if (config.token && config.token !== 'new') {
                pocoTokenConf.token = config.token;
            }

            pocoConf = pocoTokenConf;
        } else {
            /** @type {pocoTypes.PoCoNativeConfig} */
            const nativePoCoConf = {
                asset: 'Native'
            };

            pocoConf = nativePoCoConf;
        }

        if (config.AppRegistry && config.AppRegistry !== 'new') {
            pocoConf.AppRegistry = config.AppRegistry;
        }
        if (config.DatasetRegistry && config.DatasetRegistry !== 'new') {
            pocoConf.DatasetRegistry = config.DatasetRegistry;
        }
        if (config.WorkerpoolRegistry && config.WorkerpoolRegistry !== 'new') {
            pocoConf.WorkerpoolRegistry = config.WorkerpoolRegistry;
        }

        pocoConf.proxySalt = config.proxySalt;
        pocoConf.salt = config.salt;

        assert(isBytes32String(pocoConf.proxySalt));
        assert(isBytes32String(pocoConf.salt));

        return pocoConf;
    }

    /**
     * addr must be one of the following :
     * - 'new'
     * - a valid checksum address '0x...'
     * - the name of an existing PoCoDeployConfig
     * @param {any} config 
     * @param {string} addrName 
     */
    #validateAddrTokenArg(config, addrName) {
        const token = config?.[addrName];
        if (!token) {
            return;
        }

        if (token === 'new') {
            throw new CodeError(
                `${addrName}=new is not allowed. 'new' is a reserved keyword.`,
                ERROR_CODES.POCO_ERROR);
        }

        const prevConfig = this.#dict.get(token);
        if (!prevConfig) {
            // checksum address validation 
            // is performed by 'PoCoDeployConfigItem' 
            if (!token.startsWith('0x')) {
                throw new CodeError(
                    `${addrName}=${token} is neither a valid checksum address nor a prior existing PoCo config name.`,
                    ERROR_CODES.POCO_ERROR);
            }
        } else {
            if (addrName === 'etoken') {
                if (!prevConfig.kyc || prevConfig.uniswap || prevConfig.asset === 'Native') {
                    throw new CodeError(
                        `${addrName}=${token} refers to a PoCo config that does not support kyc.`,
                        ERROR_CODES.POCO_ERROR);
                }
            } else if (addrName === 'token') {
                if (prevConfig.asset === 'Native') {
                    throw new CodeError(
                        `${addrName}=${token} refers to a 'Native' PoCo config.`,
                        ERROR_CODES.POCO_ERROR);
                }
            }
        }
    }

    /**
     * @param {PoCoDeployItem} configItem 
     */
    #computeAutoProxySalt(configItem) {
        if (configItem.proxySalt !== 'auto') {
            assert(isBytes32String(configItem.proxySalt));
            return;
        }

        let iter = 0;
        while (iter <= this.#sequence.length) {
            iter++;

            const s = removePrefix('0x', this.#nextAutoSalt.toHexString());
            let proxySalt = '0x' + s.padStart(64, '0');

            // check if the auto computed proxy salt is 
            // already in use
            let isUsed = false;
            for (let i = 0; i < this.#sequence.length; ++i) {
                if (this.#sequence[i].proxySalt === proxySalt) {
                    isUsed = true;
                    // increment the next auto salt
                    this.#nextAutoSalt = this.#nextAutoSalt.add(1);
                    break;
                }
            }

            if (!isUsed) {
                configItem.resolveProxySalt(proxySalt);
                return;
            }
        }

        throw new CodeError('Unable to compute proxy salt');
    }

    /**
     * @param {PoCoDeployItem} configItem 
     */
    #validateProxySalt(configItem) {
        for (let i = 0; i < this.#sequence.length; ++i) {
            if (this.#sequence[i] === configItem) {
                continue;
            }
            if (this.#sequence[i].proxySalt === configItem.proxySalt) {
                throw new CodeError(`'proxySalt' conflict (${configItem.name}.proxySalt === ${this.#sequence[i].name}.proxySalt). PoCo deploy configs must have different 'proxySalt' values.`)
            }
        }
    }

    #defaultTokenRef() {
        for (let i = 0; i < this.#sequence.length; ++i) {
            if (this.#sequence[i].asset === 'Token') {
                return this.#sequence[i].name;
            }
        }
        return undefined;
    }

    /**
     * @param {pocoTypes.PoCoDeployConfig} config 
     */
    add(config) {
        if (config === null || config === undefined) {
            return;
        }
        if (typeof config !== 'object') {
            return;
        }
        this.#validateAddrTokenArg(config, 'etoken');
        this.#validateAddrTokenArg(config, 'token');
        this.#validateAddrTokenArg(config, 'AppRegistry');
        this.#validateAddrTokenArg(config, 'DatasetRegistry');
        this.#validateAddrTokenArg(config, 'WorkerpoolRegistry');
        this.#validateAddrTokenArg(config, 'Workerpool');

        // By default : share the same RLC
        const _config = { ...config };
        if (_config.asset === 'Token') {
            if (isNullishOrEmptyString(_config.token)) {
                const def = this.#defaultTokenRef();
                if (def) {
                    _config.token = def;
                }
            }
        }

        const configItem = new PoCoDeployItem(this.#sequence.length, _config);

        if (this.#dict.has(configItem.name)) {
            throw new TypeError(`PoCo config name conflict. A PoCo config with name='${configItem.name}' already exists`);
        }

        this.#computeAutoProxySalt(configItem);
        this.#validateProxySalt(configItem);

        this.#dict.set(configItem.name, configItem);
        this.#sequence.push(configItem);
    }

    /**
     * @param {string} configName 
     * @param {pocoTypes.PoCoContracts} addresses 
     */
    applyAddresses(configName, addresses) {
        this.#applyAddress(configName, addresses, 'token', 'RLC');
        this.#applyAddress(configName, addresses, 'etoken', 'ERLCTokenSwap');
        this.#applyAddress(configName, addresses, 'AppRegistry', 'AppRegistry');
        this.#applyAddress(configName, addresses, 'DatasetRegistry', 'DatasetRegistry');
        this.#applyAddress(configName, addresses, 'WorkerpoolRegistry', 'WorkerpoolRegistry');
        this.#applyAddress(configName, addresses, 'hub', 'ERC1538Proxy');
    }

    /**
     * @param {string} configName 
     * @param {pocoTypes.ExtraPoCoContracts} addresses 
     */
    applyExtraAddresses(configName, addresses) {
        this.#applyExtraAddress(configName, addresses, 'Workerpool', 'Workerpool');
    }

    /**
     * @param {string} configName 
     * @param {pocoTypes.PoCoContracts} addresses 
     * @param {'token' | 'etoken' | 'AppRegistry' | 'DatasetRegistry' | 'WorkerpoolRegistry' | 'hub'} addrName
     * @param {'RLC' | 'ERLCTokenSwap' | 'AppRegistry' | 'DatasetRegistry' | 'WorkerpoolRegistry' | 'ERC1538Proxy'} contractName 
     */
    #applyAddress(configName, addresses, addrName, contractName) {

        // (addrName, contractName):
        // - ('token', 'RLC')
        // - ('etoken', 'ERLCTokenSwap')
        // - ('AppRegistry', 'AppRegistry')
        // - ('DatasetRegistry', 'DatasetRegistry')
        // - ('WorkerpoolRegistry', 'WorkerpoolRegistry')

        /** @type {PoCoDeployItem=} */
        const item = this.#dict.get(configName);
        if (!item) {
            throw new CodeError(`Missing config name '${configName}'.`);
        }

        // itemAddr :
        //  - nullish 
        //  - 'new' 
        //  - <a checksum address> 
        //  - <a previous config name>
        const contractAddr = addresses[contractName];
        const itemAddr = item[addrName];

        if (addrName === 'hub') {
            if (itemAddr) {
                throw new CodeError(`Config already deployed.`);
            }
            assert(contractName === 'ERC1538Proxy');
            assert(contractAddr);
            item.resolveHubAddress(contractAddr);
            return;
        }

        if (!itemAddr) {
            if (contractAddr) {
                throw new CodeError(`Unexpected '${contractName}' deployed address.`);
            } else {
                return;
            }
        } else {
            if (!contractAddr) {
                throw new CodeError(`Missing '${contractName}' deployed address.`);
            }
        }

        if (itemAddr === 'new') {
            assert(contractAddr);
            item.resolveAddress(addrName, contractAddr);
            return;
        }

        // <a checksum address>
        if (isHexString40(itemAddr)) {
            // the specified checksum address must be equal
            // to the actual deployed address
            if (itemAddr !== contractAddr) {
                throw new CodeError(`Invalid deployed ${addrName} address '${contractAddr}', expecting '${item[addrName]}'`);
            }
        } else {
            // <a previous config name>
            const configNameRef = itemAddr;
            const itemRef = this.#dict.get(configNameRef);
            if (!itemRef) {
                throw new CodeError(
                    `Unknown config name '${configNameRef}'`,
                    ERROR_CODES.POCO_ERROR);
            }
            if (itemRef.index >= item.index) {
                throw new CodeError(
                    `Invalid config reference. Config '${configNameRef}' is posterior to config '${configName}'`,
                    ERROR_CODES.POCO_ERROR);
            }
            if (!isHexString40(itemRef[addrName])) {
                throw new CodeError(
                    `Unresolved address ${configNameRef}.${addrName}`,
                    ERROR_CODES.POCO_ERROR);
            }
            if (itemRef[addrName] !== contractAddr) {
                throw new CodeError(
                    `Invalid deployed ${addrName} address '${contractAddr}', expecting '${itemRef[addrName]}'`,
                    ERROR_CODES.POCO_ERROR);
            }
            item.resolveAddress(addrName, contractAddr);
        }
    }

    /**
     * @param {string} configName 
     * @param {pocoTypes.ExtraPoCoContracts} addresses 
     * @param {'Workerpool'} addrName
     * @param {'Workerpool'} contractName 
     */
    #applyExtraAddress(configName, addresses, addrName, contractName) {

        // (addrName, contractName):
        // - ('Workerpool', 'Workerpool')

        /** @type {PoCoDeployItem=} */
        const item = this.#dict.get(configName);
        if (!item) {
            throw new CodeError(`Missing config name '${configName}'.`);
        }

        // itemAddr :
        //  - nullish 
        //  - 'new' 
        //  - <a checksum address> 
        const contractAddr = addresses[contractName];
        const itemAddr = item[addrName];

        if (!itemAddr) {
            if (contractAddr) {
                throw new CodeError(`Unexpected '${contractName}' deployed address.`);
            } else {
                return;
            }
        } else {
            if (!contractAddr) {
                throw new CodeError(`Missing '${contractName}' deployed address.`);
            }
        }

        if (itemAddr === 'new') {
            item.resolveAddress(addrName, contractAddr);
            return;
        }

        // <a checksum address>
        if (isHexString40(itemAddr)) {
            // the specified checksum address must be equal
            // to the actual deployed address
            if (itemAddr !== contractAddr) {
                throw new CodeError(`Invalid deployed ${addrName} address '${contractAddr}', expecting '${item[addrName]}'`);
            }
        } else {
            throw new CodeError(`Invalid deployed ${addrName} address`);
        }
    }

    /**
     * @param {PoCoDeploySequence} seq1 
     * @param {Object.<string, pocoTypes.PoCoContracts>} addresses1 
     * @param {PoCoDeploySequence} seq2
     * @param {Object.<string, pocoTypes.PoCoContracts>} addresses2 
     */
    static compatible(seq1, addresses1, seq2, addresses2) {
        assert(seq1);
        assert(seq2);
        assert(addresses1);
        assert(addresses2);

        let nAddr1 = Object.keys(addresses1).length;
        let nAddr2 = Object.keys(addresses2).length;

        if (nAddr1 < nAddr2) {
            // swap
            const s = seq1;
            seq1 = seq2;
            seq2 = s;

            const a = addresses1;
            addresses1 = addresses2;
            addresses2 = a;

            const n = nAddr1;
            nAddr1 = nAddr2;
            nAddr2 = n;
        }

        const n1 = seq1.length;
        const n2 = seq2.length;
        if (n1 !== n2) {
            return false;
        }
        for (let i = 0; i < n1; ++i) {
            const item1 = seq1.#sequence[i];
            const item2 = seq2.#sequence[i];
            if (!item1.same(item2)) {
                return false;
            }
        }

        for (let i = 0; i < n1; ++i) {
            const item1 = seq1.#sequence[i];
            const item2 = seq2.#sequence[i];

            if (!item2.deployed) {
                assert(!addresses2[item2.name]);
                seq2.applyAddresses(item2.name, addresses1[item1.name]);
                addresses2[item2.name] = { ...addresses1[item1.name] };
            } else {
                if (!isDeepStrictEqual(
                    addresses1[item1.name],
                    addresses2[item2.name])) {
                    return false;
                }
            }

            if (!item1.equals(item2)) {
                return false;
            }
        }
        return true;
    }

    /** 
     * @param {boolean} onlyDeployed
     * @returns {pocoTypes.PoCoDeployConfig[]} 
     */
    toPoCoDeployConfigArray(onlyDeployed) {
        const deployedSeq = [];
        for (let i = 0; i < this.#sequence.length; ++i) {
            if (onlyDeployed) {
                if (!this.#sequence[i].deployed) {
                    continue;
                }
            }
            deployedSeq.push(this.#sequence[i].toPoCoDeployConfig());
        }
        return deployedSeq;
    }
}