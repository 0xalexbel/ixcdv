import * as types from '../common/common-types.js';
import { CodeError, fail } from '../common/error.js';
import * as ERROR_CODES from "../common/error-codes.js";
import { dirExists, errorDirDoesNotExist } from '../common/fs.js';
import { childProcessSpawn } from '../common/process.js';

/**
 * @param {!string} dir 
 * @param {!string[]} args 
 * @param {types.Strict=} options
 * @returns {types.PromiseResultOrCodeError<string>}
 */
export async function dockerGet(dir, args, options = { strict: true }) {
    if (!dirExists(dir)) {
        return fail(errorDirDoesNotExist(dir), options);
    }

    const out = await childProcessSpawn('docker', args, {
        mergeProcessEnv: true,
        stdout: {
            return: true
        },
        stderr: {
            return: true
        },
        spawnOptions: {
            cwd: dir
        }
    });

    if (out.code === 0) {
        return { ok: true, result: (out.stdout.out ?? '') }
    }

    return fail(
        new CodeError((out.stderr.out ?? ''), ERROR_CODES.DOCKER_ERROR), 
        options);
}

/**
 * @param {!string} dir 
 * @param {!string[]} args 
 * @param {?Object.<string,string>} env 
 * @param {types.Strict=} options
 * @returns {types.PromiseOkOrCodeError}
 */
export async function dockerProgress(dir, args, env, options = { strict: true }) {
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

    const out = await childProcessSpawn('docker', args, opts);

    if (out.code === 0) {
        return { ok: true }
    }

    return fail(
        new CodeError((out.stderr.out ?? ''), ERROR_CODES.DOCKER_ERROR), 
        options);
}
