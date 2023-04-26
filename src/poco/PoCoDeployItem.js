import * as ERROR_CODES from "../common/error-codes.js";
import * as pocoTypes from './poco-types.js';
import assert from 'assert';
import { assertIsPositiveInteger, isPositiveInteger } from '../common/number.js';
import { assertIsBoolean, assertIsObject, assertNotNullish } from '../common/assert-strict.js';
import { assertNonEmptyString, isNullishOrEmptyString, stringIsJsVar, throwIfNullishOrEmptyString } from '../common/string.js';
import { isBytes32String, isHexString40, isValidAddress, toChecksumAddress } from '../common/ethers.js';
import { CodeError } from '../common/error.js';

export class PoCoDeployItem {

    /** @type {string} */
    #hub = '';
    /** @type {number} */
    #index;
    /** @type {pocoTypes.PoCoDeployConfig} */
    #config;

    /** 
     * @param {number} index
     * @param {pocoTypes.PoCoDeployConfig} config 
     */
    constructor(index, config) {
        assertIsPositiveInteger(index);
        assertNotNullish(config);
        assertIsPositiveInteger(config.WorkerpoolAccountIndex);
        assertNonEmptyString(config.WorkerpoolDescription);

        /** @type {pocoTypes.PoCoDeployConfig} */
        const _config = {
            name: config.name,
            asset: config.asset,
            salt: config.salt,
            WorkerpoolAccountIndex: config.WorkerpoolAccountIndex,
            WorkerpoolDescription: config.WorkerpoolDescription,
        };

        // Setup default values
        _config.kyc = config.kyc ?? false;
        _config.uniswap = config.uniswap ?? false;
        _config.token = (_config.asset === 'Token') ? (config.token ?? 'new') : config.token;
        _config.etoken = (_config.asset === 'Token' && _config.kyc) ? (config.etoken ?? 'new') : config.etoken;
        _config.AppRegistry = config.AppRegistry ?? 'new';
        _config.DatasetRegistry = config.DatasetRegistry ?? 'new';
        _config.WorkerpoolRegistry = config.WorkerpoolRegistry ?? 'new';
        _config.proxySalt = config.proxySalt ?? 'auto';
        _config.salt = config.salt ?? '0x0000000000000000000000000000000000000000000000000000000000000000';
        _config.Workerpool = config.Workerpool ?? 'new';

        PoCoDeployItem.#validate(_config, true);

        this.#index = index;
        this.#config = _config;
    }

    get name() { return this.#config.name; }
    get index() { return this.#index; }
    get deployed() { return isHexString40(this.#hub); }

    /** @returns {string=} */
    get hub() {
        return this.#hub;
    }

    /** @returns {string=} */
    get token() {
        return this.#config.token;
    }

    /** @returns {string=} */
    get etoken() {
        return this.#config.etoken;
    }

    /** @returns {string} */
    get AppRegistry() {
        // compiler
        assert(this.#config.AppRegistry);
        return this.#config.AppRegistry;
    }

    /** @returns {string} */
    get DatasetRegistry() {
        // compiler
        assert(this.#config.DatasetRegistry);
        return this.#config.DatasetRegistry;
    }

    /** @returns {string} */
    get WorkerpoolRegistry() {
        // compiler
        assert(this.#config.WorkerpoolRegistry);
        return this.#config.WorkerpoolRegistry;
    }

    get asset() {
        assert(
            this.#config.asset === 'Token' ||
            this.#config.asset === 'Native');
        return this.#config.asset;
    }

    get kyc() {
        // compiler
        assert(typeof this.#config.kyc === 'boolean');
        return this.#config.kyc;
    }

    get uniswap() {
        // compiler
        assert(typeof this.#config.uniswap === 'boolean');
        return this.#config.uniswap;
    }

    /** @returns {string} */
    get proxySalt() {
        // compiler
        assert(this.#config.proxySalt);
        return this.#config.proxySalt;
    }

    /** @returns {string=} */
    get salt() {
        return this.#config.salt;
    }

    /** @returns {number} */
    get WorkerpoolAccountIndex() {
        return this.#config.WorkerpoolAccountIndex;
    }

    /** @returns {string} */
    get WorkerpoolDescription() {
        return this.#config.WorkerpoolDescription;
    }

    /** @returns {string} */
    get Workerpool() {
        assert(this.#config.Workerpool);
        return this.#config.Workerpool;
    }

    duplicate() {
        return new PoCoDeployItem(this.#index, this.#config);
    }

    /** @param {PoCoDeployItem} item */
    same(item) {
        if (!item) {
            return false;
        }
        if (this.asset !== item.asset) {
            return false;
        }
        if (this.kyc !== item.kyc) {
            return false;
        }
        if (this.uniswap !== item.uniswap) {
            return false;
        }
        if (this.proxySalt !== item.proxySalt) {
            return false;
        }
        if (this.salt !== item.salt) {
            return false;
        }
        return true;
    }

    /** @param {PoCoDeployItem} item */
    equals(item) {
        if (!this.same(item)) {
            return false;
        }
        if (this.token !== item.token) {
            return false;
        }
        if (this.etoken !== item.etoken) {
            return false;
        }
        if (this.AppRegistry !== item.AppRegistry) {
            return false;
        }
        if (this.DatasetRegistry !== item.DatasetRegistry) {
            return false;
        }
        if (this.WorkerpoolRegistry !== item.WorkerpoolRegistry) {
            return false;
        }
        return true;
    }

    /**
     * @param {string} s 
     */
    resolveProxySalt(s) {
        assert(this.#config.proxySalt === 'auto');
        assert(isBytes32String(s));
        this.#config.proxySalt = s;
    }

    /**
     * @param {'token' | 'etoken' | 'Workerpool' | 'AppRegistry' | 'DatasetRegistry' | 'WorkerpoolRegistry'} key 
     * @param {string} addr 
     */
    resolveAddress(key, addr) {
        assert(!isNullishOrEmptyString(key));
        assert(isValidAddress(addr));
        assert(
            key === 'token' ||
            key === 'etoken' ||
            key === 'Workerpool' ||
            key === 'AppRegistry' ||
            key === 'DatasetRegistry' ||
            key === 'WorkerpoolRegistry');
        assert(!isHexString40(this.#config[key]));
        this.#config[key] = addr;
    }

    /**
     * @param {string} hubAddr 
     */
    resolveHubAddress(hubAddr) {
        assert(isNullishOrEmptyString(this.#hub));
        assert(isValidAddress(hubAddr));
        this.#hub = hubAddr;
    }

    /**
     * For example: if addrName === 'token' :
     * - config.token is nullish
     * - config.token !== ''
     * - config.token is
     *      - 'new' 
     *      - an existing config name
     *      - a valid checksum address
     * @param {any} config 
     * @param {string} addrName 
     * @param {boolean} modifyIfNeeded compute the checksum address
     */
    static #validateNewOrRefOrAddr(config, addrName, modifyIfNeeded) {
        const addr = config[addrName];
        if (!addr) {
            return;
        }

        throwIfNullishOrEmptyString(addr);

        if (addr !== 'new') {
            if (addr.startsWith('0x')) {
                // throw error if invalid
                const a = toChecksumAddress(addr);
                if (modifyIfNeeded) {
                    config[addrName] = a;
                }
            }
        }
    }

    /**
     * For example: if addrName === 'token' :
     * - config.token is nullish
     * - config.token !== ''
     * - config.token is
     *      - 'new' 
     *      - a valid checksum address
     * @param {any} config 
     * @param {string} addrName 
     * @param {boolean} modifyIfNeeded compute the checksum address
     */
    static #validateNewOrAddr(config, addrName, modifyIfNeeded) {
        const addr = config[addrName];
        if (!addr) {
            return;
        }

        throwIfNullishOrEmptyString(addr);

        if (addr !== 'new') {
            // throw error if invalid
            const a = toChecksumAddress(addr);
            if (modifyIfNeeded) {
                config[addrName] = a;
            }
        }
    }

    /**
     * @param {*} value 
     */
    static validate(value) {
        this.#validate(value, false);
    }

    /**
     * @param {any} value 
     * @param {boolean} modifyIfNeeded 
     */
    static #validate(value, modifyIfNeeded) {
        assert(value);
        assertIsObject(value);

        // 'name' not nullish
        // 'name' !== ''
        // 'name' !== 'new'
        if (isNullishOrEmptyString(value.name)) {
            throw new CodeError("Missing 'name' property", ERROR_CODES.POCO_ERROR);
        }
        if (!stringIsJsVar(value.name)) {
            throw new CodeError(
                "'name' property is invalid, contains unauthorized characters",
                ERROR_CODES.POCO_ERROR);
        }
        assert(value.name !== 'new');

        if (!isPositiveInteger(value.WorkerpoolAccountIndex)) {
            throw new CodeError(
                "'workerpoolAccoundIndex' property is not a positive integer",
                ERROR_CODES.POCO_ERROR);
        }
        if (isNullishOrEmptyString(value.WorkerpoolDescription)) {
            throw new CodeError(
                "'workerpoolDescription' property is missing",
                ERROR_CODES.POCO_ERROR);
        }

        // 'asset' === 'Token' | 'Native'
        throwIfNullishOrEmptyString(value.asset);
        assert(value.asset === 'Token' || value.asset === 'Native');

        // 'kyc' is nullish or a boolean
        if (value.kyc != null) {
            assertIsBoolean(value.kyc);
        }
        // 'uniswap' is nullish or a boolean
        if (value.uniswap != null) {
            assertIsBoolean(value.uniswap);
        }

        // 'token' is nullish | 'new' | <configName> | <checksumAddress>
        this.#validateNewOrRefOrAddr(value, 'token', modifyIfNeeded);
        // 'etoken' is nullish | 'new' | <configName> | <checksumAddress>
        this.#validateNewOrRefOrAddr(value, 'etoken', modifyIfNeeded);
        // 'AppRegistry' is nullish | 'new' | <configName> | <checksumAddress>
        this.#validateNewOrRefOrAddr(value, 'AppRegistry', modifyIfNeeded);
        // 'DatasetRegistry' is nullish | 'new' | <configName> | <checksumAddress>
        this.#validateNewOrRefOrAddr(value, 'DatasetRegistry', modifyIfNeeded);
        // 'WorkerpoolRegistry' is nullish | 'new' | <configName> | <checksumAddress>
        this.#validateNewOrRefOrAddr(value, 'WorkerpoolRegistry', modifyIfNeeded);

        // 'Workerpool' is nullish | 'new' | <checksumAddress>
        this.#validateNewOrAddr(value, 'Workerpool', modifyIfNeeded);

        // 'salt' is not nullish
        // 'salt' === <a bytes 32 hex string>
        if (!isBytes32String(value.salt)) {
            throw new TypeError(`Invalid salt value, not a bytes32 (salt='${value.salt}').`)
        }

        // 'proxySalt' is nullish | 'auto' | <a bytes 32 hex string>
        if (value.proxySalt) {
            if (value.proxySalt !== 'auto') {
                if (!isBytes32String(value.proxySalt)) {
                    throw new TypeError(`Invalid proxySalt value, not a bytes32 (proxySalt='${value.proxySalt}').`)
                }
            }
        }

        // Validate standard, enterprise, uniswap or native configs.
        if (value.asset === 'Token') {
            if (value.kyc) {
                if (value.uniswap) {
                    throw new TypeError("'uniswap = true' is not supported in enterprise 'Token' asset mode (kyc=true)");
                }
            } else {
                if (value.etoken) {
                    throw new TypeError("'etoken' is not supported in standard 'Token' asset mode");
                }
            }
        } else if (value.asset === 'Native') {
            if (value.kyc) {
                throw new TypeError("'kyc = true' is not supported in 'Native' asset mode");
            }
            if (value.uniswap) {
                throw new TypeError("'uniswap = true' is not supported in 'Native' asset mode");
            }
            assert(!value.token);
            assert(!value.etoken);
        }
    }

    /** @returns {pocoTypes.PoCoDeployConfig} */
    toPoCoDeployConfig() {
        const c = { ...this.#config };
        if (this.token === 'new') { delete c.token; }
        if (this.etoken === 'new') { delete c.etoken; }
        if (this.AppRegistry === 'new') { delete c.AppRegistry; }
        if (this.DatasetRegistry === 'new') { delete c.DatasetRegistry; }
        if (this.WorkerpoolRegistry === 'new') { delete c.WorkerpoolRegistry; }
        if (this.Workerpool === 'new') { delete c.Workerpool; }
        return c;
    }
}