import * as types from '../common/common-types.js';
import * as gitTypes from './git-types.js';
import { GitError } from './git-error.js';
import { dirExists } from '../common/fs.js';
import { childProcessSpawn } from '../common/process.js';

/**
 * @param {!string} dir 
 * @param {!string[]} args 
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function gitGet(dir, args, options = { strict: true }) {
    if (!dirExists(dir)) {
        const err = new GitError(`directory '${dir}' does not exist`, null, null);
        if (options?.strict) {
            throw err;
        }
        return { ok: false, error: err };
    }

    const gitResult = await childProcessSpawn('git', args, {
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

    if (gitResult.code === 0) {
        return { ok: true, result: (gitResult.stdout.out ?? '') }
    }

    const err = new GitError(
        (gitResult.stderr.out ?? ''), 
        (gitResult.code ?? null), 
        (gitResult.signal ?? null));

    if (options?.strict) {
        throw err;
    }
    return { ok: false, error: err };
}

/**
 * @param {!string} dir 
 * @param {!string[]} args 
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function gitProgress(dir, args, options = { strict: true }) {
    if (!dirExists(dir)) {
        const err = new GitError(`director ${dir} does not exist`, null, null);
        if (options?.strict) {
            throw err;
        }
        return { ok: false, error: err };
    }

    const gitResult = await childProcessSpawn('git', args, {
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
    });

    if (gitResult.code === 0) {
        return { ok: true, result: '' }
    }

    const err = new GitError(
        (gitResult.stderr.out ?? ''), 
        (gitResult.code ?? null), 
        (gitResult.signal ?? null));

    if (options?.strict) {
        throw err;
    }
    return { ok: false, error: err };
}

/**
 * @param {object} args 
 * @param {!string} args.message 
 * @param {!GitError=} args.error
 * @param {types.Strict=} options
 * @returns {types.FailedError<GitError>}
 */
export function gitFail({message, error = undefined}, options) {
    error ??= new GitError(message, null, null);
    if (options?.strict) {
        throw error;
    }
    return { ok: false, error: error };
}

/**
 * @param {!string} varName
 * @param {types.Strict=} options
 * @returns {types.FailedError<GitError>}
 */
export function gitFailNullOrEmptyString(varName, options) {
    const error = new GitError(`'${varName}' is null, undefined, not a string or empty string.`, null, null);
    if (options?.strict) {
        throw error;
    }
    return { ok: false, error: error };
}

/**
 * @param {!string=} message
 * @param {!number=} code
 * @param {!string=} signal
 */
export function throwGitError(message, code, signal) {
    throw new GitError((message ?? ''), (code ?? null), (signal ?? null));
}

/**
 * @param {!gitTypes.ResultOrGitError<string>} strRes 
 * @returns {gitTypes.ResultOrGitError<boolean>}
 */
export function stringToBooleanGitResult(strRes) {
    if (strRes.ok) {
        if (strRes.result === 'true') {
            return { ok: true, result: true }
        }
        return { ok: true, result: false }
    }

    const error = strRes.error ?? new GitError('git call failed.', null, null);
    return { ok: false, error: error };
}

