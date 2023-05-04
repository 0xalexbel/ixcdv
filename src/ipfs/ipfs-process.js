// Dependencies
// ../common
import { CodeError, fail } from '../common/error.js';
import { dirExists, errorDirDoesNotExist } from '../common/fs.js';
import { childProcessSpawn } from '../common/process.js';
import * as ERROR_CODES from "../common/error-codes.js";
import * as types from '../common/common-types.js';

/**
 * @param {!string} dir 
 * @param {!string[]} args 
 * @param {?Object.<string,string>} env 
 * @param {types.Strict=} options
 * @returns {types.PromiseResultOrCodeError<string>}
 */
export async function ipfsGet(dir, args, env, options = { strict: true }) {
    if (!dirExists(dir)) {
        return fail(errorDirDoesNotExist(dir), options);
    }

    /** @type {any} */
    const opts = {
        mergeProcessEnv: true,
            stdout: {
            trim: false,
            return: true
        },
        stderr: {
            return: true
        },
        spawnOptions: {
            cwd: dir,
        }
    };
    if (env) {
        opts.spawnOptions['env'] = env;
    }

    const ipfsResult = await childProcessSpawn('ipfs', args, opts);

    if (ipfsResult.code === 0) {
        return { ok: true, result: ipfsResult.stdout.out ?? '' }
    }

    const err = new CodeError((ipfsResult.stderr.out ?? ''), ERROR_CODES.IPFS_ERROR);

    if (options?.strict) {
        throw err;
    }
    return { ok: false, error: err };
}

/**
 * @param {!string} dir 
 * @param {!string[]} args 
 * @param {?Object.<string,string>} env 
 * @param {types.Strict=} options
 * @returns {types.PromiseOkOrCodeError}
 */
export async function ipfsProgress(dir, args, env, options = { strict: true }) {
    if (!dirExists(dir)) {
        return fail(errorDirDoesNotExist(dir), options);
    }

    /** @type {any} */
    const opts = {
        mergeProcessEnv: true,
        stdout: {
            return: false,
            print: true
        },
        stderr: {
            return: false,
            print: true
        },
        spawnOptions: {
            cwd: dir
        }
    };

    if (env) {
        opts.spawnOptions.env = env;
    }

    const truffleResult = await childProcessSpawn('ipfs', args, opts);

    if (truffleResult.code === 0) {
        return { ok: true }
    }

    return fail(
        new CodeError((truffleResult.stderr.out ?? ''), ERROR_CODES.IPFS_ERROR), 
        options);
}
