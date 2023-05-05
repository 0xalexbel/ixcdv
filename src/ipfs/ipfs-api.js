// Dependencies
// ../common
import * as types from '../common/common-types.js';
import * as ERROR_CODES from "../common/error-codes.js";
import * as path from 'path';
import assert from 'assert';
import { ipfsGet } from './ipfs-process.js';
import * as ipfs from './ipfs.js';
import { randomBytes } from 'crypto';
import { EOL } from 'os';
import { dirExists, errorDirDoesNotExist, errorFileDoesNotExist, fileExists, getTmpDir, mkDirP, readObjectFromJSONFile, rmrf, saveToFile, throwIfDirAlreadyExists } from '../common/fs.js';
import { CodeError, fail, falseOrThrow } from '../common/error.js';
import { errorNullishOrEmptyString, isNullishOrEmptyString } from '../common/string.js';
import { httpGET } from '../common/http.js';
import { throwIfNotStrictlyPositiveInteger } from '../common/number.js';

export const IPFS_LOCALHOST_IPV4 = '127.0.0.1';

/**
 * Executes ipfs --version
 * @param {types.Strict=} options
 * @returns {types.PromiseOkOrCodeError}
 */
export async function ipfsVersion(options) {
    return ipfsGet(process.cwd(), ["--version"], null, options);
}

export async function createSwarmKey() {
    const buf = randomBytes(32);
    return `/key/swarm/psk/1.0.0/${EOL}/base16/${EOL}${buf.toString('hex')}`;
}

/**
 * Executes ipfs bootstrap rm --all
 * @param {!string} dir 
 * @param {types.Strict=} options
 * @returns {types.PromiseOkOrCodeError}
 */
export async function ipfsBootstrapRmAll(dir, options) {
    if (!dirExists(dir)) {
        return fail(errorDirDoesNotExist(dir), options);
    }
    return ipfs.bootstrap(dir, ["rm", "--all"], { "IPFS_PATH": dir }, options);
}

/**
 * Executes ipfs bootstrap add <multiaddr>
 * @param {!string} dir 
 * @param {!string} multiaddr 
 * @param {types.Strict=} options
 * @returns {types.PromiseOkOrCodeError}
 */
export async function ipfsBootstrapAdd(dir, multiaddr, options) {
    if (!dirExists(dir)) {
        return fail(errorDirDoesNotExist(dir), options);
    }
    return ipfs.bootstrap(dir, ["add", multiaddr], { "IPFS_PATH": dir }, options);
}


/**
 * Executes ipfs add -q <filepath>
 * @param {!string} dir 
 * @param {!string} path 
 * @param {types.Strict=} options
 * @returns {types.PromiseResultOrCodeError<string>}
 */
export async function ipfsAddQ(dir, path, options) {
    if (!dirExists(dir)) {
        return fail(errorDirDoesNotExist(dir), options);
    }
    const out = await ipfs.add(dir, ["-q", path], { "IPFS_PATH": dir }, options);
    if (!out.ok) {
        assert(out.error);
        return out;
    }

    // hash
    const hash = out.result.trim();

    // hash value
    return { ok: true, result: hash };
}

/**
 * @param {string} dir 
 * @param {string} hash 
 * @param {types.Strict=} strict
 * @dev Profile : about 300/350ms
 */
export async function ipfsCat(dir, hash, strict) {
    if (!hash || isNullishOrEmptyString(hash)) {
        return fail(errorNullishOrEmptyString(hash), strict);
    }
    if (!dirExists(dir)) {
        return fail(errorDirDoesNotExist(dir), strict);
    }

    // ipfs --timeout 2s cat <hash>
    const out = await ipfsGet(
        dir,
        ["--timeout", "2s", "cat", hash],
        { "IPFS_PATH": dir },
        strict);

    if (!out.ok) {
        assert(out.error);
        return out;
    }

    return { ok: true, result: out.result };
}

/**
 * @param {!string} dir 
 * @param {(string | URL | null)=} gatewayURL 
 * @param {types.Strict=} strict
 * @returns {Promise<boolean>}
 */
export async function ipfsTestPublish(dir, gatewayURL, strict) {
    const tmpDir = getTmpDir();
    const longtempsTxt = `${tmpDir}/longtemps.txt`;
    const alwaysSameTxt = "longtemps je me suis couche de bonne heure.";

    try {
        if (!dirExists(dir)) {
            throw null;
        }
        if (!fileExists(longtempsTxt)) {
            await saveToFile(
                alwaysSameTxt,
                tmpDir, 'longtemps.txt',
                { strict: true });
        }

        const out1 = await ipfsAddQ(
            dir, longtempsTxt,
            { strict: true });

        assert(out1.ok);
        const hash = out1.result;

        const out2 = await ipfsCat(dir, hash, { strict: true });

        assert(out2.ok);
        const txt = out2.result;

        if (txt !== alwaysSameTxt) {
            throw null;
        }

        if (gatewayURL) {
            const u = new URL('ipfs/' + hash, gatewayURL);
            const res = await httpGET(u);
            if (res.trim() !== txt) {
                throw null;
            }
        }
    } catch {
        return falseOrThrow(
            new CodeError('Test ipfs publish failed', ERROR_CODES.IPFS_ERROR),
            strict);
    }

    return true;
}

/**
 * @param {string} dir 
 * @param {string} filePath 
 * @param {types.Strict=} strict
 * @dev Profile : about 300/350ms
 */
export async function ipfsGetFileMultiAddr(dir, filePath, strict) {
    const out = await ipfsGetFileHash(dir, filePath, strict);
    if (!out.ok) {
        assert(out.error);
        return null;
    }

    const hash = out.result.trim();

    // From 'multiaddr' node module : 'protocols-table.js'
    // ===================================================
    // `ipfs` is added before `p2p` for legacy support.
    // All text representations will default to `p2p`, but `ipfs` will
    // still be supported
    // [421, V, 'ipfs'],
    // `p2p` is the preferred name for 421, and is now the default

    return "/p2p/" + hash;
}

/**
 * @param {string} dir 
 * @param {string} filePath 
 * @param {types.Strict=} strict
 * @dev Profile : about 300/350ms
 */
export async function ipfsGetFileHash(dir, filePath, strict) {
    if (!dirExists(dir)) {
        return fail(errorDirDoesNotExist(dir), strict);
    }
    if (!fileExists(filePath)) {
        return fail(errorFileDoesNotExist(filePath), strict);
    }

    const out = await ipfs.add(
        dir,
        ["--only-hash", "-q", filePath],
        { "IPFS_PATH": dir },
        strict);

    if (!out.ok) {
        assert(out.error);
        return out;
    }

    assert(out.ok);

    const hash = out.result;
    assert(!isNullishOrEmptyString(hash));

    return out;
}

/** @param {?string=} dir */
export function isValidIpfsDir(dir) {
    if (!dir) {
        return false;
    }
    if (!fileExists(path.join(dir, 'swarm.key'))) { return false; }
    if (!fileExists(path.join(dir, 'config'))) { return false; }
    if (!dirExists(path.join(dir, 'datastore'))) { return false; }
    if (!dirExists(path.join(dir, 'keystore'))) { return false; }
    return true;
}

/**
 * @param {string} dir 
 * @param {number} gatewayPort 
 * @param {number} apiPort 
 */
export async function ipfsInit(dir, gatewayPort, apiPort) {
    throwIfDirAlreadyExists(dir);
    throwIfNotStrictlyPositiveInteger(gatewayPort);
    throwIfNotStrictlyPositiveInteger(apiPort);

    try {
        mkDirP(dir, { strict: true });

        // generates a new swarm key file
        const k = await createSwarmKey();
        if (! await saveToFile(k, dir, 'swarm.key', { strict: false })) {
            throw new CodeError(
                'Unable to generate swarm key file.',
                ERROR_CODES.IPFS_ERROR);
        }

        // Executes 'ipfs init'
        await ipfs.init(dir, [], { "IPFS_PATH": dir }, { strict: true });

        // Setup local host+ports
        const gatwayMultiAddr = `/ip4/${IPFS_LOCALHOST_IPV4}/tcp/${gatewayPort.toString()}`;
        const apiMultiAddr = `/ip4/${IPFS_LOCALHOST_IPV4}/tcp/${apiPort.toString()}`;

        const configFile = path.join(dir, 'config');
        // Load config and save the new mutliaddresses
        let config = await readObjectFromJSONFile(configFile);
        assert(config);
        assert(typeof config === 'object');

        if (!config.Addresses || typeof config.Addresses !== 'object') {
            throw new CodeError(
                'Invalid ipfs config file',
                ERROR_CODES.IPFS_ERROR);
        }

        config.Addresses['API'] = apiMultiAddr;
        config.Addresses['Gateway'] = gatwayMultiAddr;

        await saveToFile(
            JSON.stringify(config, null, 2),
            dir,
            'config',
            { strict: true });

        // Remove all bootstraps
        await ipfsBootstrapRmAll(dir, { strict: true });

        // Reload modified config
        config = await readObjectFromJSONFile(configFile, { strict: true });
        if (!config) {
            throw new CodeError(
                'Invalid ipfs config file',
                ERROR_CODES.IPFS_ERROR);
        }

        const peerID = config.Identity.PeerID;

        // Add local bootstrap
        const ipConf = IPFS_LOCALHOST_IPV4;
        const boostrapAddr = `/ip4/${ipConf}/tcp/4001/p2p/${peerID}`;
        await ipfsBootstrapAdd(dir, boostrapAddr, { strict: true });
    } catch (err) {
        await rmrf(dir);
        throw err;
    }
}
