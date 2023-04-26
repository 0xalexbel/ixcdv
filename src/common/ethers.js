import * as types from './types.js'
import assert from 'assert';
import { BigNumber, utils, Wallet } from 'ethers';
import { utils as ethersutils } from 'ethers';
import { entropyToMnemonic, isValidMnemonic } from '@ethersproject/hdnode';
import { randomBytes } from 'crypto';

const BN_MAX_BYTES32 = BigNumber.from('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
const NULL_BYTES = '0x';
export const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';
export const NULL_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

export function genRandomSalt() {
    return `0x${Buffer.from(randomBytes(32)).toString('hex')}`;
}

/**
- is NOT case-sensitive
- Returns true if:
    - is a string 
    - starts with '0x'
    - only case-insensitive hex chars [0-9A-Fa-f]
- Ex:
    - ethersIsHexString(null) => false
    - ethersIsHexString('0x') => true
    - ethersIsHexString('0x1') => true
    - ethersIsHexString('0x01') => true
    - ethersIsHexString('abcdef') => false
    - ethersIsDataHexString(any_number) => false
    - ethersIsDataHexString(any_object) => false
  @param {*} value
*/
function ethersIsHexString(value) {
    return ethersutils.isHexString(value);
}

/**
 * @param {string} mnemonic 
 */
export function ethersIsValidMnemonic(mnemonic) {
    return isValidMnemonic(mnemonic)
}

export function createRandomMnemonic() {
    return entropyToMnemonic(randomBytes(16));
}

/**
- Returns true if:
    - value != null 
    AND
    - value is Uint8Array OR value.length > 0 && 0 <= value[i] <= 255
- Ex:
    - ethers.utils.isBytes(null) => false
    - ethers.utils.isBytes(any_Uint8Array) => true
    - ethers.utils.isBytes([1,2,3,4]) => true
    - ethers.utils.isBytes([1,2,3456]) => false
    - ethers.utils.isBytes(any_number) => false
    - ethers.utils.isBytes(any_string) => false
  @param {*} value
*/
function ethersIsBytes(value) {
    return ethersutils.isBytes(value);
}

/**
- is NOT case-sensitive
- Returns true if:
    - ethers.utils.isBytes(value)
    - OR
    - is a DataHexString 
- Ex:
    - ethers.utils.isByteslike(null) => false
    - ethers.utils.isByteslike(a_Uint8Array) => true
    - ethers.utils.isByteslike([1,2,3,4]) => true 
    - ethers.utils.isByteslike([1234,456]) => false 
    - ethers.utils.isByteslike('0x1234') => true (length is even)
    - ethers.utils.isByteslike('0x123') => false (length is odd)
    - ethers.utils.isByteslike('1') => false
    - ethers.utils.isByteslike(any_number) => false
  @param {*} value
*/
function ethersIsBytesLike(value) {
    return ethersutils.isBytesLike(value);
}

/**
- is NOT case-sensitive
- Returns true if:
    - ethers.utils.isHexString(value) => true
    - AND
    - value.length is EVEN
- Ex:
    - ethersIsDataHexString(null) => false
    - ethersIsDataHexString('0x01') => true (length is even)
    - ethersIsDataHexString('0x1') => false (length is odd)
    - ethersIsDataHexString('1') => false
    - ethersIsDataHexString(any_number) => false
    - ethersIsDataHexString(any_object) => false
  @param {*} value
*/
export function isDataHexString(value) {
    return (ethersutils.isHexString(value) && !(value.length % 2));
}

/**
 * @param {*} value 
 */
function isBytes32(value) {
    return (ethersutils.isBytes(value) && value.length == 32);
}

/** 
Returns address as a Checksum Address.
If address is an invalid 40-nibble HexString or if it contains mixed case 
and the checksum is invalid, an INVALID_ARGUMENT Error is thrown.
The value of address may be any supported address format.
  @param {!string} value
*/
export function toChecksumAddress(value) {
    return ethersutils.getAddress(value);
}

/** 
 * @param {!string} value 
 */
export function isValidAddress(value) {
    try {
        /* throws an error if address is invalid.
           - invalid hex
           - invalid checksum (if mixed case) 
        */
        const checksum_addr = ethersutils.getAddress(value);
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Returns true if `value` is a 40-nibble HexString
 * @param {*} value 
 */
export function isHexString40(value) {
    if (value == null || value == undefined) {
        return false;
    }
    if (typeof value !== 'string' || value.length != 42) {
        return false;
    }
    const regex = /^0x[0-9a-fA-F]{40}/g;
    const found = value.match(regex);
    return (found != null);
}

/**
- is NOT case-sensitive
- Returns true if:
    - is a DataHexString
    - AND
    - length = 2 + 2*32 = 66
  @param {*} value 
*/
export function isBytes32String(value) {
    return (isDataHexString(value) && ((value.length - 2) == 2 * 32));
}

/**
- is NOT case-sensitive
- Returns true if:
    - is a DataHexString and length = 2 + 2*32 = 66
    - OR
    - ethers.utils.isBytes(value) and length = 32
  @param {*} value 
*/
function isBytes32Like(value) {
    return (isBytes32String(value) || (ethersutils.isBytes(value) && value.length == 32));
}

/**
- Returns true if `value` can be converted to a bytes32
- is NOT case-sensitive
- Returns true if:
    - is a DataHexString and length <= 2 + 2*32 = 66
    - OR
    - ethers.utils.isBytes(value) and length <= 32
  @param {*} value 
*/
function isBytes32able(value) {
    return (isDataHexString(value) && ((value.length - 2) <= 2 * 32)) || (ethersutils.isBytes(value) && value.length <= 32);
}

/**
 * @param { number | number[] | Uint8Array | types.DataHexString | types.Hexable } value 
 */
export function toBytes(value) {
    return ethersutils.arrayify(value);
}

// /**
//  * @param { number | number[] | Uint8Array | DataHexString | Hexable } value 
//  */
// function toBytes32(value) {
//     if (!isBytes32able(value)) {
//         throw Error("Value out of range");
//     }
//     return ethersutils.arrayify(value);
// }

// /**
//  * @param { number | number[] | Uint8Array | DataHexString | Hexable } value 
//  */
// function toBytes32BigNumber(value) {
//     if (!isBytes32able(value)) {
//         throw Error("Value out of range");
//     }
//     const hex_lower_case = ethersutils.hexlify(value).toLowerCase();
//     return BigNumber.from(hex_lower_case.toLowerCase());
// }

// /**
//  * @param { number | number[] | Uint8Array | DataHexString | Hexable } value 
//  */
// function toBytes32BN(value) {
//     if (!isBytes32able(value)) {
//         throw Error("Value out of range");
//     }
//     const hex_lower_case = ethersutils.hexlify(value).toLowerCase();
//     return new BN(hex_lower_case.toLowerCase());
// }

// /**
//  * @param { number | number[] | Uint8Array | DataHexString | Hexable } value 
//  */
// function toBytes32String(value) {
//     if (!isBytes32able(value)) {
//         throw Error("Value out of range");
//     }
//     const hex_lower_case = ethersutils.hexlify(value).toLowerCase();
//     return ethersutils.hexZeroPad(hex_lower_case, 32);
// }

/**
 * @param {*} value
 */
export function toBytesString(value) {
    if (!ethersIsBytesLike(value)) {
        throw Error("Value out of range");
    }
    return ethersutils.hexlify(value).toLowerCase();
}

const MAX_UINT256_BIG_NUMBER = BigNumber.from("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
const ZERO_BIG_NUMBER = BigNumber.from(0);
const ONE_BIG_NUMBER = BigNumber.from(1);
const TWO_BIG_NUMBER = BigNumber.from(2);

/**
 * @param { number | number[] | Uint8Array | types.DataHexString | types.Hexable } value 
 */
export function toUint256(value) {
    let v = BigNumber.from(value);
    if (v.lt(ZERO_BIG_NUMBER) || v.gt(MAX_UINT256_BIG_NUMBER)) {
        throw new Error('Value out of bounds');
    }
    v = v.toTwos(32).mask(32);
    return v;
}

/**
 * @param {*} value
 */
function encodeUint256(value) {
    return ethersutils.defaultAbiCoder.encode(['uint256'], [value]);
}

/**
 * @param {*} value
 */
function isEIP712Domain(value) {
    if (!value) {
        return false;
    }
    if (typeof value !== 'object') { return false; }
    if (typeof value.name !== 'string') { return false; }
    if (typeof value.version !== 'string') { return false; }
    if (!(value.chainId instanceof BigNumber)) { return false; }
    if (!isValidAddress(value.verifyingContract)) { return false; }
    return true;
}

/**
 * @param {*} value
 */
export function isRawSignature65(value) {
    return (isDataHexString(value) && ((value.length - 2) == 2 * 65));
}

// /**
//  * @param {checksumaddress} address 
//  * @param {bytes32string} hash
//  * @param {RawSignature65} rawSig65 
//  */
// function verifyRawSignature65(address, hash, rawSig65) {
//     const checksum_addr = toChecksumAddress(address);
//     if (!isBytes32String(hash)) {
//         throw Error('Invalid hash');
//     }
//     if (!isRawSignature65(rawSig65)) {
//         throw Error('Invalid signature');
//     }
//     const recovered_checksum_address = ethersutils.recoverAddress(hash, rawSig65);
//     return (recovered_checksum_address === checksum_addr);
// }

/**
 * @param {!string} str 
 */
function stringSha256(str) {
    const buffer = Buffer.from(str, "utf8");
    return ethersutils.sha256(buffer);
}

/**
 * @param {!string} str 
 */
export function generateDeterministicSalt(str) {
    if (typeof str !== 'string') {
        throw Error(`Invalid salt key. Expecting alphanumeric string of maximum length 64.`);
    }
    if (str.length == 0) {
        throw Error("empty salt key.");
    }
    if (str.length > 64) {
        throw Error("salt key too long. Max length is 64.");
    }

    const regex = /^[-_0-9a-zA-Z]{1,64}$/g;
    const found = str.match(regex);
    if (!found) {
        throw Error(`Invalid salt key '${str}'. Expecting alphanumeric string of maximum length 64.`);
    }

    return stringSha256(str);
}

/**
 * @param {string} pubKey 
 */
function pubKeyToAddress(pubKey) {
    if (pubKey == null || typeof pubKey !== 'string') {
        throw new TypeError("'pubKey' argument must be a string");
    }
    if (!pubKey.startsWith('0x04')) {
        throw new TypeError("invalid 'pubKey' argument. Missing prefix 0x04");
    }
    if (!isRawSignature65(pubKey)) {
        throw new TypeError('invalid hex 65 argument');
    }
    // remove '0x04' prefix
    const pubKey_no_prefix = pubKey.substring(4);
    const hash = ethersutils.hexlify(ethersutils.keccak256('0x' + pubKey_no_prefix));
    const a = '0x' + hash.substring(hash.length - 40, hash.length);
    return toChecksumAddress(a);
}

/** 
 * @param {BigNumber} tokenId 
 */
export function ERC721TokenIdToAddress(tokenId) {
    const hexTokenId = tokenId.toHexString().substring(2);
    const addr = NULL_ADDRESS.substring(
        0,
        42 - hexTokenId.length,
    ).concat(hexTokenId);
    return utils.getAddress(addr);
}

/*
function contractAddress(owner,nonce) {
    // sender : 0x6ac7ea33f8831ea9dcc53393aaa88b25a785dbf0
    // nonce0= "0xcd234a471b72ba2f1ccf0a70fcaba648a5eecd8d"
    // nonce1= "0x343c43a37d37dff08ae8c4a11544c718abb4fcf8"
    // nonce2= "0xf778b86fa74e846c4f0a1fbd1335fe81c00a0c91"
    // nonce3= "0xfffd933a0bc612844eaf0c6fe3e5b8e9b6c1d19c"

    if (!isHexString40(owner)) {
        throw new TypeError("'owner' argument must be a 40-nibbles long hexadecimal string");
    }
    if (!isPositiveInteger(nonce)) {
        throw new TypeError("'nonce' argument must be positive integer");
    }

    // Convert owner address to bytes
    const owner_bytes = ethersutils.arrayify(owner);
    // Convert nonce integer to bytes
    const nonce_bn = BigNumber.from(nonce);
    const nonce_bytes = ethersutils.stripZeros(ethersutils.arrayify(nonce_bn.toHexString()));
    // RLP encode the pair (owner,nonce)
    const rlp = ethersutils.RLP.encode([owner_bytes, nonce_bytes]);
    // Keccak the whole stuff
    const hash = ethersutils.keccak256(rlp);
    // Keep the last 40-nibbles 
    const hash_40 = ethersutils.hexDataSlice(hash,12);
    return toChecksumAddress(hash_40);
}
*/

/**
 * @param  {...string} hexaStringArray 
 */
export function arrayifyConcatenateAndHash(...hexaStringArray) {
    const buffer = Buffer.concat(
        hexaStringArray.map((hexString) => Buffer.from(ethersutils.arrayify(hexString))),
    );
    return ethersutils.keccak256(buffer);
};
