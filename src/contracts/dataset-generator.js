import * as cTypes from './contracts-types-internal.js';
import assert from 'assert';
import path from 'path';
import { fileExists, resolveAbsolutePath, shasum256 } from '../common/fs.js';
import { CodeError } from '../common/error.js';
import { ipfsGetFileMultiAddr } from '../ipfs/ipfs-api.js';
import { isBytes32String } from '../common/ethers.js';

/**
 * - multiaddr : `/p2p/<ipfs hash>`
 * - checksum : `sha256 <file>`
 * @param {string} file 
 * @param {string} ipfsDir 
 * @returns {Promise<{ checksum: string, multiaddr: string }>}
 */
export async function computeIpfsChecksumAndMultiaddr(file, ipfsDir) {
    file = resolveAbsolutePath(file);
    if (!fileExists(file)) {
        throw new CodeError(`Datatset file '${file}' does not exist`);
    }

    // Profile : a bit costly 350/400 ms
    // can run even if ipfs process is not running
    const multiaddr = await ipfsGetFileMultiAddr(ipfsDir, file);
    if (!multiaddr) {
        throw new CodeError(`Unable to generate ipfs hash from file='${file}'`);
    }

    const sha = await shasum256(file);
    const checksum = '0x' + sha;

    if (!isBytes32String(checksum)) {
        throw new CodeError(`Unable to compute sha256 from file='${file}'`)
    }

    return {
        checksum: checksum,
        multiaddr: multiaddr
    };
}

// /**
//  * @param {types.checksumaddress} owner 
//  * @param {string} file 
//  * @param {string} ipfsDir 
//  * @returns {Promise<types.Dataset>}
//  */
// export async function generateDatasetIExecJson(owner, file, ipfsDir) {
//     owner = toChecksumAddress(owner);

//     file = resolveAbsolutePath(file);
//     if (!fileExists(file)) {
//         throw new CodeError(`Datatset file '${file}' does not exist`);
//     }
//     const filename = path.basename(file);

//     // Profile : a bit costly 350/400 ms
//     // can run even if ipfs process is not running
//     const multiaddr = await ipfsGetFileMultiAddr(ipfsDir, file);
//     if (!multiaddr) {
//         throw new CodeError(`Unable to generate ipfs hash from file='${file}'`);
//     }

//     const sha = await shasum256(file);
//     const checksum = '0x' + sha;

//     if (!isBytes32String(checksum)) {
//         throw new CodeError(`Unable to compute sha256 from file='${file}'`)
//     }

//     return {
//         owner: owner,
//         checksum: checksum,
//         multiaddr: multiaddr,
//         name: filename,
//     };
// }
