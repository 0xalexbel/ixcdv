import * as types from '../common/common-types.js';
import * as gitTypes from './git-types.js';
import { dirExists, mkDirP } from '../common/fs.js';
import { GitError } from './git-error.js';
import { gitGet, gitProgress } from './git-internal.js'

/**
 * Create an empty Git repository or reinitialize an existing one
 * - `git init ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {gitTypes.StrictGitInitOptions=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function init(dir, args, options) {
    let err = null;
    if (options?.createDir) {
        if (!mkDirP(dir, { strict: false })) {
            err = new GitError(`Could not create director ${dir}`, null, null);
        }
    } else {
        if (!dirExists(dir, { strict: false })) {
            err = new GitError(`director ${dir} does not exist`, null, null);
        }
    }
    if (err) {
        if (options?.strict) {
            throw err;
        }
        return { ok: false, error: err };
    }

    return gitGet(dir, ["init", ...args], options);
}

/**
 * - `git diff ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function diff(dir, args, options) {
    return gitGet(dir, ["diff", ...args], options);
}

/**
 * Record changes to the repository
 * - `git ...preArgs commit ...args`
 * @param {!string} dir 
 * @param {!string[]} preArgs
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function commit(dir, preArgs, args, options) {
    return gitGet(dir, [...preArgs, "commit", ...args], options);
}

/**
 * Add file contents to the index
 * - `git add ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function add(dir, args, options) {
    return gitGet(dir, ["add", ...args], options);
}

/**
 * Apply a patch to files and/or to the index
 * - `git apply ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function apply(dir, args, options) {
    return gitGet(dir, ["apply", ...args], options);
}

/**
 * List, create, or delete branches
 * - `git branch ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function branch(dir, args, options) {
    return gitGet(dir, ["branch", ...args], options);
}

/**
 * `git rev-parse ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function revparse(dir, args, options) {
    return gitGet(dir, ["rev-parse", ...args], options);
}

/**
 * Lists commit objects in reverse chronological order
 * - `git rev-list ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function revlist(dir, args, options) {
    return gitGet(dir, ["rev-list", ...args], options);
}

/**
 * Switch branches or restore working tree files
 * - `git checkout ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function checkout(dir, args, options) {
    return gitGet(dir, ["checkout", ...args], options);
}

/**
 * Clone a repository into a new directory
 * - `git clone ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function clone(dir, args, options) {
    console.log('clone ' + dir);
    return gitProgress(dir, ["clone", ...args], options);
}

/**
 * Find as good common ancestors as possible for a merge
 * - `git merge-base ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function mergbase(dir, args, options) {
    return gitGet(dir, ["merge-base", ...args], options);
}

/**
 * `git config ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function config(dir, args, options) {
    return gitGet(dir, ["config", ...args], options);
}

/**
 * Manage set of tracked repositories
 * - `git remote ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function remote(dir, args, options) {
    return gitGet(dir, ["remote", ...args], options);
}

/**
 * List references in a remote repository
 * - `git ls-remote ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function lsremote(dir, args, options) {
    return gitGet(dir, ["ls-remote", ...args], options);
}

/**
 * Ensures that a reference name is well formed
 * - `git check-ref-format ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function checkrefformat(dir, args, options) {
    return gitGet(dir, ["check-ref-format", ...args], options);
}

/**
 * Output information on each ref
 * - `git for-each-ref ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function foreachref(dir, args, options) {
    return gitGet(dir, ["for-each-ref", ...args], options);
}

/**
 * Show various types of objects
 * - `git show ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function show(dir, args, options) {
    return gitGet(dir, ["show", ...args], options);
}

/**
 * Create, list, delete or verify a tag object signed with GPG
 * - `git tag ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function tag(dir, args, options) {
    return gitGet(dir, ["tag", ...args], options);
}

