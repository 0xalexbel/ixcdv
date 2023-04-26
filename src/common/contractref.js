import * as types from './types.js';
import assert from 'assert';
import path from 'path';
import { isNullishOrEmptyString, stringToPositiveInteger, throwIfNotJsVarString, throwIfNullishOrEmptyString } from './string.js';
import { CodeError, pureVirtualError, throwIfNullish } from './error.js';
import { toChecksumAddress } from './ethers.js';
import { throwIfNotStrictlyPositiveInteger } from './number.js';

const EQUAL = 1;
const NOT_EQUAL = 0;
const UNDETERMINED = -1;

/** @type {types.PoCoContractName[]} */
export const POCO_CONTRACT_NAMES = [
    'RLC',
    'ERLCTokenSwap',
    'AppRegistry',
    'DatasetRegistry',
    'WorkerpoolRegistry',
    'ERC1538Proxy',
    'ENSRegistry',
    'PublicResolver',
];
Object.freeze(POCO_CONTRACT_NAMES);

/** @type {types.ExtraPoCoContractName[]} */
export const EXTRA_POCO_CONTRACT_NAMES = [
    'Workerpool',
];
Object.freeze(EXTRA_POCO_CONTRACT_NAMES);

/**
 * @param {string} str 
 * @param {(types.PoCoContractName | types.ExtraPoCoContractName)=} deployConfigContractName 
 * @returns {PoCoHubRef | DevContractRef | ContractRef | null}
 */
export function ContratRefFromString(str, deployConfigContractName) {
    let cr = null;
    try {
        // try to parse any kind of contract key
        cr = ContratRefFromKey(str);
    } catch { }

    if (cr) {
        return cr;
    }

    try {
        // try to parse something like:
        // - <chainid>.<address> 
        // - <chainid>.<deployConfigName> (interpreted as a 'deployConfigContractName' contract)
        cr = ContractRefFromStringArg(str, deployConfigContractName);
    } catch { }

    return cr;
}

/**
 * try to parse something like:
 * - <chainid>.<address> 
 * - <chainid>.<deployConfigName> (interpreted as a 'deployConfigContractName' contract)
 * @param {string} arg 
 * @param {(types.PoCoContractName | types.ExtraPoCoContractName)=} deployConfigContractName 
 * @returns {PoCoContractRef | DevContractRef | ContractRef}
 */
function ContractRefFromStringArg(arg, deployConfigContractName) {
    const args = parseStringArg(arg);

    // address === 0x....
    if (!isNullishOrEmptyString(args.address)) {
        if (!isNullishOrEmptyString(args.deployConfigName)) {
            return new DevContractRef(args);
        } else {
            return new ContractRef(args);
        }
    }

    // address == null
    if (!isNullishOrEmptyString(args.deployConfigName)) {
        if (isNullishOrEmptyString(deployConfigContractName)) {
            return new DevContractRef(args);
        } else {
            assert(deployConfigContractName);
            if (deployConfigContractName === 'Workerpool') {
                return new DevContractRef({ ...args, contractName: deployConfigContractName });
            }
            return new PoCoContractRef({ ...args, contractName: deployConfigContractName });
        }
    }

    throw new CodeError('Invalid contract string argument');
}

/**
 * @param {string} key 
 * @returns {PoCoHubRef | ContractRef}
 */
function ContratRefFromKey(key) {
    const u = new URL(key);
    const urlStr = u.protocol + '//' + u.hostname;
    const p = u.pathname;
    const address = path.basename(p);
    const chainid = stringToPositiveInteger(path.basename(path.dirname(p)), { strict: true });
    assert(chainid);
    assert(!isNullishOrEmptyString(address));

    const sp = u.searchParams;
    const assetStr = sp.get('asset');
    const kycStr = sp.get('kyc');
    const uniswapStr = sp.get('kyc');

    if (!assetStr) {
        return new ContractRef({
            chainid: chainid,
            url: urlStr,
            address: address,
        });
    }

    assert(assetStr === 'Token' || assetStr === 'Native');

    let kyc;
    if (kycStr === 'true') {
        kyc = true;
    } else if (kycStr === 'false') {
        kyc = false;
    }

    let uniswap;
    if (uniswapStr === 'true') {
        uniswap = true;
    } else if (uniswapStr === 'false') {
        uniswap = false;
    }

    return new PoCoHubRef({
        chainid: chainid,
        url: urlStr,
        contractName: 'ERC1538Proxy',
        address: address,
        asset: assetStr,
        uniswap: uniswap,
        kyc: kyc
    });
}

/**
 * @param {string} key 
 */
function parseKey(key) {
    const u = new URL(key);
    const url = u.protocol + '//' + u.hostname;
    const p = u.pathname;
    const address = path.basename(p);
    const chainid = stringToPositiveInteger(path.dirname(p), { strict: true });
    assert(chainid);
    assert(!isNullishOrEmptyString(address));
    return { chainid, address, url };
}

/**
 * @param {string} str 
 */
function parseStringArg(str) {
    // key = <chainid>.<addr> | <chainid>.<deployConfig>
    const i = str.indexOf('.');
    if (i < 0) {
        throw new TypeError('invalid key argument.');
    }
    const chainid = stringToPositiveInteger(
        str.substring(0, i),
        { strict: true });
    assert(chainid);
    const s = str.substring(i + 1);

    let address;
    let deployConfigName;

    try {
        address = toChecksumAddress(s);
    } catch {
        deployConfigName = s;
    }

    return {
        chainid,
        address,
        deployConfigName
    };
}

/* -------------------------------------------------------------------------- */
/*                                                                            */
/*                            Class ContractRef                               */
/*                                                                            */
/* -------------------------------------------------------------------------- */

/* Immutable class */
export class ContractRef {

    /** @type {number} */
    #chainid;

    /** @type {string=} */
    #contractName;

    /** @type {string=} */
    #address;

    /** @type {URL=} */
    #url;

    /** @type {string=} */
    #baseKey;

    /**
     * @param {types.ContractRefLike} args 
     */
    constructor({ chainid, contractName, address, url }) {
        throwIfNotStrictlyPositiveInteger(chainid);
        this.#chainid = chainid;

        if (contractName) {
            throwIfNotJsVarString(contractName);
            this.#contractName = contractName;
        }

        if (address) {
            this.#address = toChecksumAddress(address);
        }

        if (url) {
            if (url instanceof URL) {
                this.#url = new URL(url.toString());
            } else {
                throwIfNullishOrEmptyString(url);
                this.#url = new URL(url);
            }
        }
    }

    get resolved() {
        if (!this.hasAddress) {
            return false;
        }
        if (!this.hasURL) {
            return false;
        }
        if (!this.hasContractName) {
            return false;
        }
        return true;
    }

    /**
     * @param {string | types.ContractRefLike} value 
     */
    static from(value) {
        throwIfNullish(value);
        if (typeof value === 'string') {
            return this.fromKey(value);
        }
        return new ContractRef({
            chainid: value.chainid,
            contractName: value.contractName,
            address: value.address,
            url: value.url
        });
    }

    get chainid() { return this.#chainid; }
    get address() { return this.#address; }
    get url() { return this.#url; }
    get contractName() { return this.#contractName; }

    get httpHost() {
        if (!this.#url) {
            return null;
        }
        const p = this.#url.protocol;
        if (p === 'http:' || p === 'https:') {
            return this.#url.toString();
        }
        this.#url.protocol = (p === 'wss:') ? "https" : "http";
        const s = this.#url.toString();
        this.#url.protocol = p;
        return s;
    }

    get wsHost() {
        if (!this.#url) {
            return null;
        }
        const p = this.#url.protocol;
        if (p === 'ws:' || p === 'wss:') {
            return this.#url.toString();
        }
        this.#url.protocol = (p === 'https:') ? "wss" : "ws";
        const s = this.#url.toString();
        this.#url.protocol = p;
        return s;
    }

    get baseKey() {
        if (!this.#baseKey) {
            if (!this.#url || !this.#chainid || !this.#address) {
                this.#baseKey = '';
            } else {
                this.#baseKey = this.#url.toString() + this.#chainid.toString() + '/' + this.#address;
            }
        }
        return this.#baseKey;
    }
    get key() {
        return this.baseKey;
    }

    /**
     * @param {string} key 
     */
    static fromKey(key) {
        return new ContractRef(parseKey(key));
    }

    get hasAddress() {
        return !isNullishOrEmptyString(this.#address);
    }
    get hasContractName() {
        return !isNullishOrEmptyString(this.#contractName);
    }
    get hasURL() {
        return (this.#url instanceof URL);
    }

    /**
     * Returns:
     * - '1' if refs deploy addresses are equal
     * - '0' if refs deploy addresses are different
     * - '-1' if cannot be solved
     * @param {(string | null | {address?:(string | null)})=} objRef 
     */
    compareAddress(objRef) {
        if (!this.#address || !objRef) {
            return UNDETERMINED;
        }
        if (typeof objRef === 'string') {
            if (objRef.length === 0) {
                return UNDETERMINED;
            }
            return (this.#address === objRef) ? EQUAL : NOT_EQUAL;
        }
        if (!objRef.address || objRef.address.length === 0) {
            return UNDETERMINED;
        }
        return (this.#address === objRef.address) ? EQUAL : NOT_EQUAL;
    }

    /**
     * Returns:
     * - '1' if refs contract names are equal
     * - '0' if refs contract names are different
     * - '-1' if cannot be solved
     * @param {(string | null | {contractName?:(string | null)})=} objRef 
     */
    compareContractName(objRef) {
        if (!this.#contractName || !objRef) {
            return UNDETERMINED;
        }
        if (typeof objRef === 'string') {
            if (objRef.length === 0) {
                return UNDETERMINED;
            }
            return (this.#contractName === objRef) ? EQUAL : NOT_EQUAL;
        }
        if (!objRef.contractName || objRef.contractName.length === 0) {
            return UNDETERMINED;
        }
        return (this.#contractName === objRef.contractName) ? EQUAL : NOT_EQUAL;
    }

    /**
     * Returns:
     * - '1' if refs deploy addresses are equal
     * - '0' if refs deploy addresses are different
     * - '-1' if cannot be solved
     * @param {(URL | string | null | {url?:(URL | string | null)})=} urlRef 
     */
    compareURL(urlRef) {
        if (!urlRef) {
            return (this.#url) ? UNDETERMINED : EQUAL;
        } else if (typeof urlRef === 'string') {
            if (urlRef.length === 0) {
                return (this.#url) ? UNDETERMINED : EQUAL;
            } else if (!this.#url) {
                return UNDETERMINED;
            } else {
                return (this.#url.toString() === urlRef) ? EQUAL : NOT_EQUAL;
            }
        } else if (urlRef instanceof URL) {
            if (!this.#url) {
                return UNDETERMINED;
            } else {
                return (this.#url.toString() === urlRef.toString()) ? EQUAL : NOT_EQUAL;
            }
        } else if (!urlRef.url) {
            return (this.#url) ? UNDETERMINED : EQUAL;
        } else if (typeof urlRef.url === 'string') {
            if (urlRef.url.length === 0) {
                return (this.#url) ? UNDETERMINED : EQUAL;
            } else if (!this.#url) {
                return UNDETERMINED;
            } else {
                return (this.#url.toString() === urlRef.url) ? EQUAL : NOT_EQUAL;
            }
        } else if (urlRef.url instanceof URL) {
            if (!this.#url) {
                return UNDETERMINED;
            } else {
                return (this.#url.toString() === urlRef.url.toString()) ? EQUAL : NOT_EQUAL;
            }
        }
        return UNDETERMINED;
    }

    /**
     * Returns:
     * - 'true' if refs addresses are determined and equal
     * - 'false' otherwise (undetermined or not)
     * @param {(string | null | {address?:(string | null)})=} objRef 
     */
    eqAddress(objRef) {
        return this.compareAddress(objRef) === EQUAL;
    }

    /**
     * Returns:
     * - 'true' if refs addresses are determined and different
     * - 'false' otherwise (undetermined or not)
     * @param {(string | null | {address?:(string | null)})=} objRef 
     */
    notEqAddress(objRef) {
        return this.compareAddress(objRef) === NOT_EQUAL;
    }

    /**
     * Returns:
     * - '1' if refs chainid and address are equal
     * - '0' if refs chainid and address are different
     * - '-1' if cannot be solved
     * @param {?types.ContractRefLike=} objRef 
     */
    compare(objRef) {
        if (!objRef) {
            return NOT_EQUAL;
        }
        if (this.#chainid !== objRef.chainid) {
            return NOT_EQUAL;
        }

        const eqAddr = this.compareAddress(objRef);

        if (eqAddr === NOT_EQUAL) {
            return NOT_EQUAL;
        }

        if (eqAddr === EQUAL) {
            const eqURL = this.compareURL(objRef);
            if (eqURL === NOT_EQUAL) {
                return NOT_EQUAL;
            }
            const eqContractName = this.compareContractName(objRef);
            if (eqContractName === NOT_EQUAL) {
                return NOT_EQUAL;
            }
            return EQUAL;
        }

        return UNDETERMINED;
    }

    /**
     * Returns:
     * - 'true' if refs are determined and equal
     * - 'false' otherwise (undetermined or not)
     * @param {?types.ContractRefLike=} objRef 
     */
    eq(objRef) {
        return this.compare(objRef) === EQUAL;
    }

    /**
     * Field by field equality
     * @param {?types.ContractRefLike=} objRef 
     */
    eqStrict(objRef) {
        if (!objRef) { return false; }
        if (objRef.chainid !== this.#chainid) { return false; }
        if (objRef.address !== this.#address) { return false; }
        if (objRef.contractName !== this.#contractName) { return false; }
        if (objRef.url?.toString() !== this.#url?.toString()) { return false; }
        return true;
    }

    /**
     * Returns:
     * - 'true' if refs are determined and different
     * - 'false' otherwise (undetermined or not)
     * @param {?types.ContractRefLike=} objRef 
     */
    notEq(objRef) {
        return this.compare(objRef) === NOT_EQUAL;
    }

    toJSON() {
        return {
            chainid: this.#chainid,
            contractName: this.#contractName,
            address: this.#address,
            url: this.#url
        }
    }
}

/* -------------------------------------------------------------------------- */
/*                                                                            */
/*                           Class DevContractRef                             */
/*                                                                            */
/* -------------------------------------------------------------------------- */


export class DevContractRef extends ContractRef {

    /** @type {string=} */
    #deployConfigName;

    /**
     * @param {types.DevContractRefLike} args 
     */
    constructor(args) {
        super(args);

        if (args.deployConfigName) {
            throwIfNotJsVarString(args.deployConfigName);
            this.#deployConfigName = args.deployConfigName;
        }
    }

    get deployConfigName() {
        return this.#deployConfigName;
    }

    get hasDeployConfigName() {
        return !isNullishOrEmptyString(this.#deployConfigName);
    }

    get resolved() {
        if (!this.hasDeployConfigName) {
            return false;
        }
        return super.resolved;
    }

    get resolvable() {
        if (!this.hasAddress && !this.hasDeployConfigName) {
            return false;
        }
        return true;
    }

    /**
     * - Returns a string : `<chainid>.<deployConfigName>`
     */
    hubAlias() {
        assert(this.hasDeployConfigName);
        return this.chainid.toString() + '.' + this.deployConfigName;
    }

    /**
     * @param {string} hubAlias 
     */
    static fromHubAlias(hubAlias) {
        if (isNullishOrEmptyString(hubAlias)) {
            throw new CodeError('Invalid config string argument');
        }
        assert(hubAlias);
        const i = hubAlias.indexOf('.');
        if (i < 0) {
            throw new CodeError('Invalid config string argument');
        }
        const chainid = stringToPositiveInteger(hubAlias.substring(0, i));
        if (chainid === undefined) {
            throw new CodeError('Invalid config string argument');
        }
        const deployConfigName = hubAlias.substring(i + 1).trim();
        if (deployConfigName.length === 0) {
            throw new CodeError('Invalid config string argument');
        }
        return new DevContractRef({ chainid, deployConfigName });
    }

    /**
     * - Throws an error if failed
     * @param {string | DevContractRef | types.DevContractRefLike} hubLike 
     */
    static toHubAlias(hubLike) {
        if (typeof hubLike === 'string') {
            // Throw error if failed
            const c = DevContractRef.fromHubAlias(hubLike);
            assert(c.deployConfigName);
            return c.hubAlias();
        }
        if (!hubLike.deployConfigName) {
            throw new CodeError('Invalid hub argument, missing deployConfigName property');
        }
        return hubLike.chainid + "." + hubLike.deployConfigName;
    }

    /**
     * Returns:
     * - '1' if refs deploy config names are equal
     * - '0' if refs deploy config names are different
     * - '-1' if cannot be solved
     * @param {(string | null | { deployConfigName?: string })=} objRef 
     */
    compareDeployConfigName(objRef) {
        if (!this.#deployConfigName || !objRef) {
            return UNDETERMINED;
        }
        if (typeof objRef === 'string') {
            if (objRef.length === 0) {
                return UNDETERMINED;
            }
            return (this.#deployConfigName === objRef) ? EQUAL : NOT_EQUAL;
        }
        if (!objRef.deployConfigName || objRef.deployConfigName.length === 0) {
            return UNDETERMINED;
        }
        return (this.#deployConfigName === objRef.deployConfigName) ? EQUAL : NOT_EQUAL;
    }

    /**
     * Returns:
     * - 'true' if refs deploy config names are determined and equal
     * - 'false' otherwise (undetermined or not)
     * @param {(string | null | { deployConfigName?: string })=} objRef 
     */
    eqDeployConfigName(objRef) {
        return this.compareDeployConfigName(objRef) === EQUAL;
    }

    /**
     * Returns:
     * - 'true' if refs deploy config names are determined and different
     * - 'false' otherwise (undetermined or not)
     * @param {(string | null | { deployConfigName?: string })=} objRef 
     */
    notEqDeployConfigName(objRef) {
        return this.compareDeployConfigName(objRef) === NOT_EQUAL;
    }

    /**
     * Returns:
     * - '1' if refs chainid and address are equal
     * - '0' if refs chainid and address are different
     * - '-1' if cannot be solved
     * @param {?types.DevContractRefLike=} objRef 
     */
    compare(objRef) {
        if (!objRef) {
            return NOT_EQUAL;
        }
        if (this.chainid !== objRef.chainid) {
            return NOT_EQUAL;
        }

        const eqAddr = this.compareAddress(objRef);
        if (eqAddr === NOT_EQUAL) {
            return NOT_EQUAL;
        }

        const eqConf = this.compareDeployConfigName(objRef);
        if (eqConf === NOT_EQUAL) {
            return NOT_EQUAL;
        }

        if (eqAddr === UNDETERMINED && eqConf === UNDETERMINED) {
            return UNDETERMINED;
        }

        const eqURL = this.compareURL(objRef);
        if (eqURL === NOT_EQUAL) {
            return NOT_EQUAL;
        }

        const eqContractName = this.compareContractName(objRef);
        if (eqContractName === NOT_EQUAL) {
            return NOT_EQUAL;
        }

        return EQUAL;
    }

    /**
     * Field by field equality
     * @param {?types.DevContractRefLike=} objRef 
     */
    eqStrict(objRef) {
        if (!super.eqStrict(objRef)) { return false; }
        assert(objRef);
        if (objRef.deployConfigName !== this.#deployConfigName) { return false; }
        return true;
    }

    /**
     * @param {string} key 
     */
    static fromKey(key) {
        return new DevContractRef(parseKey(key));
    }

    /**
     * @param {string | types.DevContractRefLike} value 
     */
    static from(value) {
        throwIfNullish(value);
        if (typeof value === 'string') {
            try {
                return DevContractRef.fromKey(value);
            } catch { }

            // key = <chainid>.<addr> | <chainid>.<deployConfig>
            return new DevContractRef(parseStringArg(value));
        }

        return new DevContractRef({
            chainid: value.chainid,
            contractName: value.contractName,
            address: value.address,
            url: value.url,
            deployConfigName: value.deployConfigName
        });
    }
}

/* -------------------------------------------------------------------------- */
/*                                                                            */
/*                           Class PoCoContratRef                             */
/*                                                                            */
/* -------------------------------------------------------------------------- */

export class PoCoContractRef extends DevContractRef {

    /**
     * @param {types.PoCoContractRefLike} args
     */
    constructor(args) {
        super(args);
    }

    /**
     * @param {string} name 
     */
    static isPoCoContractName(name) {
        return (
            name === 'ERC1538Proxy' ||
            name === 'RLC' ||
            name === 'ERLCTokenSwap' ||
            name === 'AppRegistry' ||
            name === 'DatasetRegistry' ||
            name === 'WorkerpoolRegistry' ||
            name === 'PublicResolver' ||
            name === 'ENSRegistry');
    }

    /** @returns {types.PoCoContractName} */
    get contractName() {
        const c = super.contractName;
        assert(c && PoCoContractRef.isPoCoContractName(c));
        // @ts-ignore
        return c;
    }

    /**
     * @param {string} key 
     * @returns {PoCoContractRef}
     */
    static fromKey(key) {
        throw pureVirtualError('PoCoContractRef.fromKey');
    }

    /**
     * @param {string | types.PoCoContractRefLike} value 
     * @returns {PoCoContractRef}
     */
    static from(value) {
        throw pureVirtualError('PoCoContractRef.from');
    }
}

/* -------------------------------------------------------------------------- */
/*                                                                            */
/*                             Class PoCoHubRef                               */
/*                                                                            */
/* -------------------------------------------------------------------------- */

export class PoCoHubRef extends PoCoContractRef {

    /** @type {('Token' | 'Native')} */
    #asset;
    /** @type {boolean=} */
    #kyc;
    /** @type {boolean=} */
    #uniswap;

    /**
     * @param {types.PoCoHubRefLike} args
     */
    constructor(args) {
        assert(args.contractName === 'ERC1538Proxy');
        assert(args.asset === 'Token' || args.asset === 'Native');
        super(args);

        this.#asset = args.asset;
        this.#kyc = args.kyc;
        this.#uniswap = args.uniswap;

        assert(!(this.#uniswap === true && this.#asset === 'Native'));
        assert(!(this.#kyc === true && this.#asset === 'Native'));
        assert(!(this.#kyc === true && this.#uniswap === true));
    }

    /** @returns {'ERC1538Proxy'} */
    get contractName() {
        const c = super.contractName;
        assert(c === 'ERC1538Proxy');
        return c;
    }

    get asset() {
        return this.#asset;
    }
    get kyc() {
        return this.#kyc;
    }
    get uniswap() {
        return this.#uniswap;
    }
    get hasKyc() {
        return (typeof this.#kyc === 'boolean');
    }
    get hasUniswap() {
        return (typeof this.#uniswap === 'boolean');
    }

    get resolved() {
        if (!this.hasKyc) {
            return false;
        }
        if (!this.hasUniswap) {
            return false;
        }
        return super.resolved
    }

    /**
     * @param {string} key 
     */
    static fromKey(key) {
        const u = new URL(key);
        const url = u.protocol + '//' + u.host;
        const p = u.pathname;
        const address = path.basename(p);
        const chainid = stringToPositiveInteger(path.basename(path.dirname(p)), { strict: true });
        assert(chainid);
        assert(!isNullishOrEmptyString(address));

        const sp = u.searchParams;
        const assetStr = sp.get('asset');
        const kycStr = sp.get('kyc');
        const uniswapStr = sp.get('uniswap');

        assert(assetStr === 'Token' || assetStr === 'Native');
        assert(chainid);

        let kyc;
        if (kycStr === 'true') {
            kyc = true;
        } else if (kycStr === 'false') {
            kyc = false;
        }

        let uniswap;
        if (uniswapStr === 'true') {
            uniswap = true;
        } else if (uniswapStr === 'false') {
            uniswap = false;
        }

        return new PoCoHubRef({
            chainid: chainid,
            url: url,
            contractName: 'ERC1538Proxy',
            address: address,
            asset: assetStr,
            uniswap: uniswap,
            kyc: kyc
        });
    }

    /**
     * string values can be one of the following:
     * - PoCoHubRef.key
     * @param {string | types.PoCoHubRefLike} value 
     */
    static from(value) {
        throwIfNullish(value);
        if (typeof value === 'string') {
            return PoCoHubRef.fromKey(value);
        }
        if (value.contractName !== 'ERC1538Proxy') {
            throw new CodeError('Incompatible contract ref');
        }
        return new PoCoHubRef({
            chainid: value.chainid,
            contractName: value.contractName,
            address: value.address,
            url: value.url,
            deployConfigName: value.deployConfigName,
            asset: value.asset,
            kyc: value.kyc,
            uniswap: value.uniswap
        });
    }

    get isNative() { return this.#asset === 'Native'; }
    get isStandard() { return (this.#asset === 'Token' && this.#kyc === false); }
    get isEnterprise() { return (this.#asset === 'Token' && this.#kyc === true); }
    get isUniswap() { return (this.#asset === 'Token' && this.#uniswap === true); }

    get key() {
        const key = super.key;
        if (key.length === 0) {
            return '';
        }
        const k = key + "?" +
            "asset=" + (this.asset ?? "undefined") + "&" +
            "uniswap=" + (this.uniswap?.toString() ?? "undefined") + "&" +
            "kyc=" + (this.kyc?.toString() ?? "undefined");
        return k;
    }

    toHRString(includeAddress = true) {
        let s = this.chainid.toString();
        if (!isNullishOrEmptyString(this.deployConfigName)) {
            return s + "." + this.deployConfigName;
        }
        if (this.isNative) {
            s = s + ".native";
        }
        if (this.isEnterprise) {
            s = s + ".enterprise";
        }
        if (this.isStandard) {
            s = s + ".standard";
        }
        if (this.isUniswap) {
            s = s + ".uniswap";
        }
        if (includeAddress && !isNullishOrEmptyString(this.address)) {
            s = s + "." + this.address;
        }
        return s;
    }

    toContractRef() {
        return new PoCoContractRef({
            chainid: this.chainid,
            address: this.address,
            contractName: this.contractName,
            deployConfigName: this.deployConfigName,
            url: this.url,
        });
    }

    /**
     * Field by field equality
     * @param {?types.PoCoHubRefLike=} objRef 
     */
    eqStrict(objRef) {
        if (!super.eqStrict(objRef)) { return false; }
        assert(objRef);
        if (objRef.asset !== this.#asset) { return false; }
        if (objRef.kyc !== this.#kyc) { return false; }
        if (objRef.uniswap !== this.#uniswap) { return false; }
        return true;
    }
}