import * as types from './types.js'
import assert from 'assert'
import { CodeError } from './error.js'
import { isNullishOrEmptyString } from './string.js';
import { Wallet } from 'ethers';
import { arrayifyConcatenateAndHash as arrayifyConcatAndHash, toChecksumAddress } from './ethers.js';
import { keccak256, arrayify } from "ethers/lib/utils.js";
import { httpHEAD, httpPOST, httpPUT } from './http.js';

/**
 * @param {URL} url
 * @param {types.checksumaddress} ownerAddress
 * @param {string} secretName 
 */
export async function checkSecret(url, ownerAddress, secretName) {
    if (isNullishOrEmptyString(secretName)) {
        throw new CodeError("Invalid secret name");
    }
    ownerAddress = toChecksumAddress(ownerAddress);

    //"${url}/secrets/web2?ownerAddress=${owner_addr}&secretName=iexec-result-iexec-ipfs-token"
    const u = new URL(
        '/secrets/web2?ownerAddress=' + ownerAddress + '&secretName=' + secretName,
        url);

    const statusCode = await httpHEAD(u);
    if (statusCode == 204) {
        return true;
    }
    if (statusCode == 404) {
        return false;
    }

    throw new CodeError('Check secret failed');
}

/**
 * 
 * @param {string} domain 
 * @param {types.checksumaddress} ownerAddress 
 * @param {string} secretKey 
 * @param {string} secretValue 
 * @returns 
 */
function genChallengeForSetWeb2Secret(domain, ownerAddress, secretKey, secretValue) {
    return arrayifyConcatAndHash(
        keccak256(Buffer.from(domain, 'utf8')),
        ownerAddress,
        keccak256(Buffer.from(secretKey, 'utf8')),
        keccak256(Buffer.from(secretValue, 'utf8')),
    );
}

/**
 * @param {URL} url 
 * @param {string} domain 
 * @param {Wallet} signer 
 * @param {string} secretName 
 * @param {string} secretValue 
 * @param {boolean} forceUpdate 
 */
export async function pushWeb2Secret(url, domain, signer, secretName, secretValue, forceUpdate) {
    if (signer == null || !(signer instanceof Wallet)) {
        throw new CodeError('Invalid signer');
    }
    if (isNullishOrEmptyString(domain)) {
        throw new CodeError('Invalid domain string');
    }
    if (isNullishOrEmptyString(secretName)) {
        throw new CodeError('Invalid secret name');
    }
    if (isNullishOrEmptyString(secretValue)) {
        throw new CodeError('Invalid secret value');
    }
    const ownerAddress = toChecksumAddress(await signer.getAddress());
    const exists = await checkSecret(url, ownerAddress, secretName);
    if (exists && !forceUpdate) {
        const msg = `Secret "${secretName}" already exists for ${ownerAddress}`;
        throw new CodeError(msg);
    }

    const challenge = genChallengeForSetWeb2Secret(
        domain,
        ownerAddress,
        secretName,
        secretValue,
    );

    const binaryChallenge = arrayify(challenge);
    const authorization = await signer.signMessage(binaryChallenge);

    const path = '/secrets/web2?ownerAddress=' + ownerAddress + '&secretName=' + secretName;
    const headers = { Authorization: authorization };
    const body = secretValue;

    let response = null;
    try {
        if (exists) {
            response = await httpPUT(url, path, headers, body);
        } else {
            response = await httpPOST(url, path, headers, body);
        }
    } catch (err) {
        throw Error(`Server at ${url.toString()} didn't answered`);
    }

    assert(typeof response === 'string');
    assert(response === '');

    return { isPushed: true, isUpdated: exists };
}