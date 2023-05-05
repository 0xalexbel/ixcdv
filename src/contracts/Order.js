// Dependencies
// ../common
import * as types from "../common/common-types.js";
import * as cTypes from './contracts-types-internal.js';
import assert from 'assert';
import { BigNumber, Wallet, utils as ethersutils } from 'ethers';
import { EIP712Domain } from './EIP712Domain.js';
import { toTagArray } from './tags.js';
import { pureVirtualError } from '../common/error.js';
import { isBytes32String, isRawSignature65 } from '../common/ethers.js';
import { stringIsPositiveInteger, stringIsStrictlyPositiveInteger } from '../common/string.js';
import { isPositiveInteger, isStrictlyPositiveInteger } from '../common/number.js';

export const OrderConstructorGuard = { value: false };

export class Order {

    constructor() {
        if (!OrderConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }
    }

    /** 
     * @abstract
     * @returns {any} 
     */
    abiOrderedTypes() { throw pureVirtualError('Order.abiOrderedTypes()'); }
    saltedAbiOrderedTypes() {
        const abiOrderedTypes = this.abiOrderedTypes();
        const keys = Object.keys(abiOrderedTypes);
        assert(keys.length === 1);
        abiOrderedTypes[keys[0]].push({ name: 'salt', type: 'bytes32' });
        return abiOrderedTypes;
    }

    /** 
     * @abstract
     * @returns {Record<string, any>}
     */
    abiEncodableProperties() { throw pureVirtualError('Order.abiEncodableProperties()'); }

    #abiOrderedCallArgs() {
        /*
        { <orderType>: [ { name: 'app', type: 'address' }, ... ] }
        */
        const orderedArgs = this.abiOrderedTypes();
        const values = this.abiEncodableProperties();

        /* orderName = 'AppOrder', 'DatasetOrder' etc. */
        const keys = Object.keys(orderedArgs);
        assert(keys.length === 1);
        const orderType = keys[0];

        const array = orderedArgs[orderType];
        assert(array instanceof Array);
        const callArgs = [];
        for (let i = 0; i < array.length; ++i) {
            /** @type {{name:string, type:string}} */
            const item = array[i];
            assert(values.hasOwnProperty(item.name));
            const value = values[item.name];
            assert(value !== null && value !== undefined);
            callArgs.push(value);
        }
        return callArgs;
    }

    /**
     * @param {EIP712Domain} domain 
     * @param {types.bytes32string} salt 
     * @param {import("@ethersproject/abstract-signer").TypedDataSigner | null} signer 
     */
    async computeMatchOrderArgs(domain, salt, signer) {
        /*
        For example:
        ============
        IexecLibOrders_v5.AppOrder is the following struct: 

            struct AppOrder
            {
                address app;
                uint256 appprice;
                uint256 volume;
                bytes32 tag;
                address datasetrestrict;
                address workerpoolrestrict;
                address requesterrestrict;
                bytes32 salt;
                bytes   sign;
            }

            converted into:
            [
                <address app>,
                <uint256 appprice>, 
                <uint256 volume>,
                <bytes32 tag>,
                <address datasetrestrict>,
                <address workerpoolrestrict>,
                <address requesterrestrict>,
                <bytes32 salt>,
                <bytes   sign>
            ]

        */

        const callArgs = this.#abiOrderedCallArgs();
        const signature = await this.rawSign(domain, salt, signer);
        // add salt
        callArgs.push(salt);
        // add signature
        callArgs.push(signature);
        return callArgs;
    }

    /**
     * @param {EIP712Domain} domain 
     * @param {types.bytes32string} salt 
     * @param {import("@ethersproject/abstract-signer").TypedDataSigner | null} signer 
     * @return {Promise<cTypes.RawSignature65>}
     */
    async rawSign(domain, salt, signer) {
        assert(domain);
        if (!isBytes32String(salt)) {
            throw Error('invalid salt bytes32')
        }
        if (!signer) {
            return '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
        }
        if (!(signer instanceof Wallet)) {
            throw Error('invalid signer')
        }

        // Keys order is important
        const order_salted_abi_ordered_types = this.saltedAbiOrderedTypes();
        // Order does not count
        const domain_abi_encodable_props = domain.abiEncodableProperties();
        // Order does not count
        const order_abi_encodable_props = this.abiEncodableProperties();

        // add missing 'salt' to the values
        const salted_order_abi_encodable_props = {
            ...order_abi_encodable_props,
            salt: salt, /* bytes32:string is case insensitive */
        };

        // const salted_order_abi_encodable_props =         {
        //     "app": "0x13232704f4B570c8a61760137B92a61E159d951A",
        //     "appprice": "0",
        //     "volume": "1000000",
        //     "tag": "0x0000000000000000000000000000000000000000000000000000000000000000",
        //     "datasetrestrict": "0x0000000000000000000000000000000000000000",
        //     "workerpoolrestrict": "0x0000000000000000000000000000000000000000",
        //     "requesterrestrict": "0x0000000000000000000000000000000000000000",
        //     "salt": "0x07255111083bc7d41297a528abaab173694b641daf88aecdc22eccc668fe2879",
        // };
/*
domain
{
  name: "iExecODB",
  version: "5.0.0",
  chainId: "1337",
  verifyingContract: "0x9065B215d9f212704138baA2d224672Da7055185",
}

types:
{
  AppOrder: [
    {
      name: "app",
      type: "address",
    },
    {
      name: "appprice",
      type: "uint256",
    },
    {
      name: "volume",
      type: "uint256",
    },
    {
      name: "tag",
      type: "bytes32",
    },
    {
      name: "datasetrestrict",
      type: "address",
    },
    {
      name: "workerpoolrestrict",
      type: "address",
    },
    {
      name: "requesterrestrict",
      type: "address",
    },
    {
      name: "salt",
      type: "bytes32",
    },
  ],
}
saltedOrder
{
  app: "0x13232704f4B570c8a61760137B92a61E159d951A",
  appprice: "0",
  volume: "1000000",
  tag: "0x0000000000000000000000000000000000000000000000000000000000000000",
  datasetrestrict: "0x0000000000000000000000000000000000000000",
  workerpoolrestrict: "0x0000000000000000000000000000000000000000",
  requesterrestrict: "0x0000000000000000000000000000000000000000",
  salt: "0x9b6be3ce27c0756384531378114cf58b6e1d6d692c8dcc2f2a2c1972d6867c01",
}
*/
        // No need to specify the 'primary type' since ethers will automatically guess it.
        // it should be the unique 'types tree' root.
        // - it checks for circular type references 
        // - uniqueness of the root 
        // use experiental ether Signer._signTypedData (to remove when signTypedData is included)
        // https://docs.ethers.io/v5/api/signer/#Signer-signTypedData
        
        let rawSignature65 = null;
        if (signer._signTypedData && typeof signer._signTypedData === 'function') {
            rawSignature65 = await signer._signTypedData(
                domain_abi_encodable_props,
                order_salted_abi_ordered_types,
                salted_order_abi_encodable_props);
        } else {
            /** @type {any} */
            const _signer = signer;
            if (_signer.signTypedData && typeof _signer.signTypedData === 'function') {
                rawSignature65 = await _signer.signTypedData(
                    domain_abi_encodable_props,
                    order_salted_abi_ordered_types,
                    salted_order_abi_encodable_props);
            } else {
                throw new TypeError('internal error');
            }
        }
        return rawSignature65;
    }

    /**
     * @param {EIP712Domain} domain 
     * @param {types.bytes32string} salt 
     * @return {types.bytes32string}
     */
    hash(domain, salt) {
        assert(domain);
        if (!isBytes32String(salt)) {
            throw Error('invalid salt bytes32')
        }

        // Keys order is important
        const order_salted_abi_ordered_types = this.saltedAbiOrderedTypes();

        // Order does not count
        const domain_abi_encodable_props = domain.abiEncodableProperties();
        // Order does not count
        const order_abi_encodable_props = this.abiEncodableProperties();

        // add missing 'salt' to the values
        /** @type {Record<string, any>} */
        const salted_order_abi_encodable_props = {
            ...order_abi_encodable_props,
            salt: salt, /* bytes32:string is case insensitive */
        };

        let hash = null;
        try {
            if (ethersutils._TypedDataEncoder && (typeof ethersutils._TypedDataEncoder.hash === 'function')) {
                hash = ethersutils._TypedDataEncoder.hash(
                    domain_abi_encodable_props,
                    order_salted_abi_ordered_types,
                    salted_order_abi_encodable_props);
            } else {
                /** @type {any} */
                const _ethersutils = ethersutils;
                if (_ethersutils.TypedDataEncoder && (typeof _ethersutils.TypedDataEncoder.hash === 'function')) {
                    hash = _ethersutils.TypedDataEncoder.hash(
                        domain_abi_encodable_props,
                        order_salted_abi_ordered_types,
                        salted_order_abi_encodable_props);
                } else {
                    throw new TypeError('internal error');
                }
            }
            return hash;
        } catch (err) {
            if (err instanceof Error) {
                console.log(err.stack);
            }
            throw err
        }
    }

    /**
     * @param {EIP712Domain} domain 
     * @param {types.bytes32string} salt 
     * @param {object} options 
     * @param {cTypes.RawSignature65?} options.signature 
     * @param {import("@ethersproject/abstract-signer").TypedDataSigner?} options.signer 
     * @param {types.bytes32string?} options.orderhash 
     */
    async verify(domain, salt, { signature = null, signer = null, orderhash = null }) {
        if (!isBytes32String(salt)) {
            throw Error('invalid salt bytes32')
        }
        const hasSignature = (signature != null);
        const hasSigner = (signer != null);
        const hasOrderhash = (orderhash != null);

        if (!hasSignature && !hasSigner && !hasOrderhash) {
            return false;
        }

        if (hasOrderhash) {
            if (!isBytes32String(orderhash)) {
                return false;
            }
            if (this.hash(domain, salt) !== orderhash) {
                return false;
            }
        }

        if (hasSignature || hasSigner) {
            if (!hasSignature) {
                throw Error('missing signature')
            }
            if (!hasSigner) {
                throw Error('missing signer')
            }
            if (!isRawSignature65(signature)) {
                return false;
            }
            const computedSignature = await this.rawSign(domain, salt, signer);
            if (computedSignature !== signature) {
                return false;
            }
        }

        return true;
    }

    // /**
    //  * @param {string} salt 
    //  * @returns {Array}
    //  */
    // getCallArgs(includeSign = false) {
    //     const sigTypesArray = this.getSignatureTypes();
    //     const array = [];
    //     for (let i = 0; i < sigTypesArray.length; ++i) {
    //         const t = sigTypesArray[i].name;
    //         const func = this[t];
    //         assert(func);
    //         assert(typeof func === 'function');
    //         const funcWithThis = func.bind(this);
    //         assert(funcWithThis);
    //         assert(typeof funcWithThis === 'function');
    //         let value = funcWithThis();
    //         if (value == undefined) {
    //             if (t === 'salt') {
    //                 value = CONSTS.NULL_BYTES32;
    //             }
    //         }
    //         if (value instanceof BN) {
    //             value = value.toString();
    //         }
    //         if (typeof value === 'number') {
    //             value = value.toString();
    //         }
    //         array.push(value);
    //     }
    //     if (includeSign) {
    //         if (this.#sign && (typeof this.#sign === 'string')) {
    //             array.push(this.#sign)
    //         } else {
    //             array.push(CONSTS.NULL_BYTES);
    //         }
    //     }
    //     return array;
    // }


    /** 
     * @param {string | types.strictlyPositiveInteger | BigNumber} price 
     * @param {'RLC' | 'nRLC'} rlcUnit 
     */
    static validatePrice(price, rlcUnit) {
        if (price === null || price === undefined) {
            throw new TypeError(`Invalid price=${price}`);
        }
        if (typeof price === 'string') {
            price = price.trim();
            const i = price.indexOf(' ');
            assert(i !== 0);
            let amount;
            /** @type {string} */
            let unit = rlcUnit;
            if (i > 0) {
                amount = price.substring(0, i);
                unit = price.substring(i + 1).trim();
            } else {
                amount = price;
            }
            if (unit !== 'RLC' && unit !== 'nRLC') {
                throw new TypeError(`Invalid price unit=${unit}`);
            }
            if (!stringIsPositiveInteger(amount)) {
                throw new TypeError(`Invalid price=${price}`);
            }
            const pow = (unit === 'RLC') ? 9 : 0;
            try {
                return ethersutils.parseUnits(amount, pow);
            } catch {
                throw new TypeError(`Invalid price=${price}`);
            }
        }
        if (typeof price === 'number') {
            if (!isPositiveInteger(price)) {
                throw new TypeError(`Negative price=${price.toString()}`);
            }
            price = BigNumber.from(price);
        }
        if (price instanceof BigNumber) {
            if (price.isNegative()) {
                throw new TypeError(`Negative price=${price.toString()}`);
            }
            return price;
        }

        throw new TypeError(`Invalid price=${price}`);
    }

    /** @param {string | types.strictlyPositiveInteger | BigNumber} volume */
    static validateVolume(volume) {
        if (volume === null || volume === undefined) {
            throw new TypeError(`Invalid volume=${volume}`);
        }
        if (typeof volume === 'string') {
            if (!stringIsStrictlyPositiveInteger(volume)) {
                throw new TypeError(`Invalid volume=${volume}`);
            }
            return BigNumber.from(volume);
        }
        if (typeof volume === 'number') {
            if (!isStrictlyPositiveInteger(volume)) {
                throw new TypeError(`Negative or null volume=${volume.toString()}`);
            }
            volume = BigNumber.from(volume);
        }
        if (volume instanceof BigNumber) {
            if (volume.isNegative() || volume.isZero()) {
                throw new TypeError(`Negative or null volume=${volume.toString()}`);
            }
            return volume;
        }
        throw new TypeError(`Invalid volume=${volume}`);
    }

    /** @param {*} tag */
    static validateTag(tag) {
        return toTagArray(tag);
    }

    /** @param {*} trust */
    static validateTrust(trust) {
        return trust;
    }

    /** @param {*} category */
    static validateCategory(category) {
        return category;
    }
}