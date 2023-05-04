// Dependencies
// ../common
import * as types from '../common/common-types.js';
import assert from "assert";
import { BigNumber, Wallet, ethers } from "ethers";
import BN from "BN.js";
import { getAddress as etherUtilsGetAddress } from 'ethers/lib/utils.js';
import { isBytes32String, isHexString40, NULL_ADDRESS } from '../common/ethers.js';
import { CodeError } from '../common/error.js';

/**
 * @param {*} uint256ish 
 */
export function toEthersArg_uint256(uint256ish) {
    if (uint256ish === null || uint256ish === undefined) {
        return BigNumber.from(new BN(0)).toHexString();
    }
    if (typeof uint256ish === 'string') {
        return BigNumber.from(uint256ish).toHexString();
    }
    if (typeof uint256ish === 'number') {
        return BigNumber.from(uint256ish).toHexString();
    }
    if (uint256ish instanceof BigNumber) {
        return uint256ish.toHexString();
    }
    if (uint256ish instanceof BN) {
        return BigNumber.from(uint256ish.toString()).toHexString();
    }
    const msg = `Unable to convert to uint256 argument : uint256ish='${uint256ish}'`;
    throw new TypeError(msg);
}

/**
 * @param {*} addressish 
 */
export function toEthAddress(addressish) {
    if (addressish === null || addressish === undefined) {
        return NULL_ADDRESS;
    }
    if (typeof addressish == 'string') {
        if (isHexString40(addressish)) {
            return addressish;
        }
        if (isBytes32String(addressish)) {
            return HexStringToEthAddress(addressish);
        }
    } else if (addressish instanceof BigNumber) {
        return HexStringToEthAddress(addressish.toHexString());
    } else if (addressish instanceof BN) {
        return HexStringToEthAddress(BigNumber.from(addressish.toString()).toHexString());
    }
    const msg = `Unable to convert to address : addressish='${addressish}'`;
    throw new TypeError(msg);
}

/**
 * @param {string} hexStr 
 */
export function HexStringToEthAddress(hexStr) {
    const hex = hexStr.substring(2);
    const addr = NULL_ADDRESS.substring(
        0,
        42 - hex.length,
    ).concat(hex);
    return etherUtilsGetAddress(addr);
}

