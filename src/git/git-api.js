import * as types from '../common/common-types.js';
import * as gitTypes from './git-types.js';
import * as path from 'path';
import { valid as semverValid } from "semver";
import { SemVer } from 'semver';
import { GitError } from './git-error.js';
import { gitFail, gitFailNullOrEmptyString, stringToBooleanGitResult } from './git-internal.js'
import * as git from './git.js';

import * as nodeUtil from 'node:util';
import { exec as childProcessExec } from 'child_process';
import assert from 'assert';
import { isPositiveInteger } from '../common/number.js';
import { dirExists, fileExists, fileExistsInDir, mkDirP, parsePathnameOrUrl, readFileSync, resolveAbsolutePath } from '../common/fs.js';
import { ensureSuffix, isNullishOrEmptyString, removeSuffix } from '../common/string.js';
import { CodeError } from '../common/error.js';
import { parseGitUrl } from '../common/utils.js';

const exec = nodeUtil.promisify(childProcessExec);

/**
 * Returns true if `value` is a 40-nibble HexString
 * @param {*} value 
 * @param {number=} len 
 */
export function isGitHash(value, len) {
    if (value == null || value == undefined) {
        return false;
    }
    len = len ?? 40;
    if (!isPositiveInteger(len)) {
        len = 40;
    }
    if (len > 40 || len <= 0) {
        return false;
    }
    if (typeof value !== 'string' || value.length != len) {
        return false;
    }
    const regex = new RegExp(`^[0-9a-fA-F]{${len}}`, 'g');
    //const regex = /^[0-9a-fA-F]{40}/g;
    const found = value.match(regex);
    return (found != null);
}

/**
 * `git add <relPath>`
 * @param {!string} dir 
 * @param {!string} relPath
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function addFile(dir, relPath, options) {
    if (!fileExistsInDir(dir, relPath, { strict: false })) {
        const err = new GitError(`file '${relPath}' does not exist in directory '${dir}'`, null, null);
        if (options?.strict) {
            throw err;
        }
        return { ok: false, error: err };
    }
    return git.add(dir, [relPath], options);
}

/**
 * `git rev-parse --abbrev-ref HEAD`
 * @param {!string} dir 
 * @param {import('../common/types.js').Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function HEADName(dir, options) {
    return git.revparse(dir, ["--abbrev-ref", "HEAD"], options);
}

/**
 * `git rev-parse HEAD`
 * @param {!string} dir 
 * @param {import('../common/types.js').Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function HEADHash(dir, options) {
    return git.revparse(dir, ["HEAD"], options);
}

/**
 * `git rev-parse HEAD^`
 * @param {!string} dir 
 * @param {import('../common/types.js').Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function HEADFistParentHash(dir, options) {
    return git.revparse(dir, ["HEAD^"], options);
}

/**
 * `git for-each-ref --format="%(if)%(HEAD)%(then)%(objectname) %(refname)%(end)" --points-at=HEAD refs/heads/`
 * @param {!string} dir 
 * @param {import('../common/types.js').Strict=} options
 * @returns {gitTypes.PromiseResultOrGitError<{name:string, hash:string}>}
 */
export async function HEADNameAndHash(dir, options) {
    const out = await git.foreachref(dir,
        [
            "--format=%(if)%(HEAD)%(then)%(objectname) %(refname)%(end)",
            "--points-at=HEAD",
            "refs/heads/"
        ],
        options);
    if (out.ok) {
        const s = out.result.trim();
        const hash = s.substring(0, 40) ?? '';
        const name = s.substring(41) ?? '';
        return { ok: true, result: { name: name, hash: hash } };
    }
    return out;
}

/**
 * `git rev-parse origin/HEAD`
 * @param {!string} dir 
 * @param {import('../common/types.js').Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function originHEADHash(dir, options) {
    return git.revparse(dir, ["origin/HEAD"], options);
}

/**
 * `git rev-parse refs/heads/<branch>`
 * @param {!string} dir 
 * @param {!string} branch 
 * @param {import('../common/types.js').Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function branchHash(dir, branch, options = { strict: true }) {
    if (isNullishOrEmptyString(branch)) {
        return gitFailNullOrEmptyString('branch', options);
    }
    return git.revparse(dir, ["refs/heads/" + branch], options);
}

/**
 * `git rev-list -n 1 refs/tags/<tag>`
 * @param {!string} dir 
 * @param {!string} tag 
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function tagHash(dir, tag, options = { strict: true }) {
    if (isNullishOrEmptyString(tag)) {
        return gitFailNullOrEmptyString('tag', options);
    }
    // Do not use 'rev-parse' ! 
    /*
        https://stackoverflow.com/questions/1862423/how-to-tell-which-commit-a-tag-points-to-in-git#comment68771463_1862542
        if you have annotated tags, that is created with git tag -a 
        or git tag -s, then git rev-parse <tag> would give you SHA-1 
        of a tag object itself, while git rev-list -1 <tag> would 
        give SHA-1 of commit (revision) it points to, same as git 
        rev-parse <tag>^{commit}   
    */
    return git.revlist(dir, ["-n", "1", "refs/tags/" + tag], options);
}

/**
 * `git rev-parse <gitObject>`
 * @param {!string} dir 
 * @param {!string} gitObject 
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function objectHash(dir, gitObject, options = { strict: true }) {
    if (isNullishOrEmptyString(gitObject)) {
        return gitFailNullOrEmptyString('gitObject', options);
    }
    return git.revparse(dir, [gitObject], options);
}

/**
 * `git rev-parse --abbrev-ref <hash>`
 * @param {!string} dir 
 * @param {!string} hash 
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function hashToName(dir, hash, options = { strict: true }) {
    if (!isGitHash(hash)) {
        return gitFail({ message: "'hash' is not a valid git hash" }, options);
    }
    return git.revparse(dir, ["--abbrev-ref", hash], options);
}

/**
 * `git rev-parse --is-inside-work-tree`
 * @param {!string} dir 
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseResultOrGitError<boolean>}
 */
export async function isInsideWorkTree(dir, options = { strict: true }) {
    const out = await git.revparse(dir, ["--is-inside-work-tree"], options);
    return stringToBooleanGitResult(out);
}

/**
 * `git rev-parse --show-toplevel`
 * @param {!string} dir 
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function showTopLevel(dir, options = { strict: true }) {
    return await git.revparse(dir, ["--show-toplevel"], options);
}

/**
 * `git rev-parse --verify <tag>/<branch>/<shortid>`
 * @param {!string} dir 
 * @param {!string} gitObject 
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function verifyObject(dir, gitObject, options = { strict: true }) {
    if (isNullishOrEmptyString(gitObject)) {
        return gitFailNullOrEmptyString('gitObject', options);
    }
    return git.revparse(dir, ["--verify", gitObject], options);
}

/**
 * `git checkout -b <newBranchName>`
 * @param {!string} dir 
 * @param {!string} newBranch 
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function newBranchAndCheckout(dir, newBranch, options = { strict: true }) {
    if (isNullishOrEmptyString(newBranch)) {
        return gitFailNullOrEmptyString('newBranch', options);
    }
    return git.checkout(dir, ["-b", newBranch], options);
}

/**
 * `git checkout tags/<tag>`
 * @param {!string} dir 
 * @param {!string} tag
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function checkoutTag(dir, tag, options = { strict: true }) {
    if (isNullishOrEmptyString(tag)) {
        return gitFailNullOrEmptyString('tag', options);
    }
    return git.checkout(dir, ["tags/" + tag], options);
}

/**
 * `git checkout <branch>`
 * @param {!string} dir 
 * @param {!string} branch
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function checkoutBranch(dir, branch, options = { strict: true }) {
    if (isNullishOrEmptyString(branch)) {
        return gitFailNullOrEmptyString('branch', options);
    }
    return git.checkout(dir, ["branch"], options);
}

/**
 * `git merge-base --is-ancestor <hash1> <hash2>`
 * Check if the first <hash1> is an ancestor of the second <hash2>, 
 * and exit with status 0 if true, or with status 1 if not. 
 * Errors are signaled by a non-zero status that is not 1.
 * @param {!string} dir 
 * @param {!string} hash1 
 * @param {!string} hash2 
 * @returns {gitTypes.PromiseResultOrGitError<boolean>}
 */
export async function isAncestor(dir, hash1, hash2, options = { strict: true }) {
    if (isNullishOrEmptyString(hash1)) {
        return gitFailNullOrEmptyString('hash1', options);
    }
    if (isNullishOrEmptyString(hash2)) {
        return gitFailNullOrEmptyString('hash2', options);
    }
    const out = await git.mergbase(dir, ["--is-ancestor", hash1, hash2], { strict: false });
    if (out.ok) {
        return { ok: true, result: true };
    }

    const code = out.error.code;
    if (code === 1) {
        return { ok: true, result: false };
    }
    if (options?.strict) {
        throw out.error;
    }
    return { ok: false, error: out.error };
}

/**
 * `git config --get <key>`
 * @param {!string} dir 
 * @param {!string} key 
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function configGet(dir, key, options = { strict: true }) {
    if (isNullishOrEmptyString(key)) {
        return gitFailNullOrEmptyString('key', options);
    }
    return git.config(dir, ['--get', key], options);
}

/**
 * `git remote show`
 * @param {!string} dir 
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function remoteShow(dir, options = { strict: true }) {
    return git.remote(dir, ["show"], options);
}

/**
 * `git clone <src> <dst>/<dstDirname>`
 * - Use the `createDir` option if `dst` does not exist
 * - Fails if:
 * - `dst/dstDirname` already exists
 * - `dst/dstDirname` is inside any existing git repository
 * @param {!string} src 
 * @param {!string} dst 
 * @param {!string} dstDirname 
 * @param {!gitTypes.GitCloneSafeOptions=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function cloneSafe(src, dst, dstDirname, options = { strict: true, createDir: false }) {
    if (isNullishOrEmptyString(src)) {
        return gitFail({ message: `'src' is null, empty or not a string` }, options);
    }
    if (isNullishOrEmptyString(dst)) {
        return gitFail({ message: `'dst' is null, empty or not a string` }, options);
    }
    if (isNullishOrEmptyString(dstDirname)) {
        return gitFail({ message: `'dstDirname' is null, empty or not a string` }, options);
    }

    /* the new repository should not already exist */
    const dstDir = path.join(dst, dstDirname);
    if (dirExists(dstDir)) {
        return gitFail({ message: `directory '${dstDir}' already exist` }, options);
    }
    if (dirExists(dst)) {
        /* is `dst` inside an existing git repository ? */
        const out = await showTopLevel(dst, { strict: false });
        if (out.ok) {
            /* yes : for safety reasons, we would rather avoid this situation. */
            return gitFail({ message: `directory '${dst}' is inside an existing git repository` });
        }
    } else {
        /* fails if we were not instructed to create a new directory */
        if (!options.createDir) {
            return gitFail({ message: `directory '${dst}' does not exist` }, options);
        }
        if (!mkDirP(dst, { strict: false })) {
            return gitFail({ message: `could not create directory '${dst}'` }, options);
        }
    }

    return git.clone(dst, [src, dstDir], options);
}

/**
 * @param {!string} dir 
 * @returns {gitTypes.PromiseResultOrGitError<{
 *      origin: string, 
 *      raw: !(string | URL),
 *      url?: !URL, 
 *      pathname?: !string, 
 *      file?: !string, 
 *      directory?: !string 
 * }>}
 */
export async function getRemoteOriginUrl(dir) {

    /** @type {types.FailedError<GitError>} */
    const nullResult = {
        ok: false,
        error: new GitError('Unable to determine remote origin.', null, null)
    };

    if (!dirExists(dir, { strict: false })) {
        return nullResult;
    }

    let out_conf = await configGet(dir, "remote.origin.url", { strict: false });
    if (out_conf.ok) {
        assert(out_conf.result);
        if (isNullishOrEmptyString(out_conf.result)) {
            return nullResult;
        }
        const o = parsePathnameOrUrl(out_conf.result);
        if (!o) {
            return nullResult;
        }
        return { ok: true, result: { origin: 'origin', ...o } };
    }

    // Maybe it is not a git directory ?
    let out_isgit = await showTopLevel(dir, { strict: false });
    if (!out_isgit.ok) {
        return { ok: false, error: out_isgit.error };
    }

    // 1. `dir` is a git repository
    // 2. `dir` has no `remote.origin.url`
    // Look for another remote name : remote.<something>.url
    let out_show = await remoteShow(dir, { strict: false });
    if (!out_show.ok) {
        return { ok: false, error: out_show.error };
    }
    assert(out_show.result);

    const origin = out_show.result;
    if (!isNullishOrEmptyString(origin)) {
        return nullResult;
    }

    if (origin.indexOf('\n') >= 0) {
        // multiple origins
        return nullResult;
    }

    out_conf = await configGet(dir, "remote." + origin + ".url", { strict: false });
    if (out_conf.ok) {
        assert(out_conf.result);
        if (isNullishOrEmptyString(out_conf.result)) {
            return nullResult;
        }
        const o = parsePathnameOrUrl(out_conf.result);
        if (!o) {
            return nullResult;
        }
        return { ok: true, result: { origin: origin, ...o } };
    }

    return { ok: false, error: out_conf.error };
}

/**
 * @typedef { GitRecursiveRemoteOrigin & {gitHubURL?:URL, gitHubRepo?:string, gitHubUser?:string} } GitHubOrigin
 */

/**
 * Walks a chain of local `remote.orgin.url` recursively to 
 * determine the actual remote github.com repository.
 * - Fails if it does not lead to a github.com repository
 * - Otherwise returns the github user and repo
 * @param {!string} dir 
 * @returns {gitTypes.PromiseResultOrGitError<GitHubOrigin>}
 */
export async function getGitHubOrigin(dir) {
    const out = await recursiveRemoteOrigin(dir);
    if (!out.ok) {
        return out;
    }
    if (out.result?.rootURL?.host !== 'github.com') {
        return { ok: false, error: new GitError('Origin repository does not refer to github.com', null, null) };
    }

    const p = path.parse(out.result.rootURL.pathname);
    const gitHubUser = path.basename(p.dir);
    const gitHubRepo = p.name;

    return {
        ok: true,
        result: {
            ...out.result,
            gitHubURL: out.result.rootURL,
            gitHubRepo: gitHubRepo,
            gitHubUser: gitHubUser
        }
    };
}

/**
 * @typedef GitRecursiveRemoteOrigin
 * @type {object}
 * @property {!string=} rootDir
 * @property {!URL=} rootURL
 * @property {!string=} remoteOriginDir
 * @property {!URL=} remoteOriginURL
 */

/**
 * Walks a chain of local `remote.orgin.url` recursively to 
 * determine the actual remote repository.
 * @param {!string} dir 
 * @returns {gitTypes.PromiseResultOrGitError<GitRecursiveRemoteOrigin>}
 */
export async function recursiveRemoteOrigin(dir) {
    /** @type {types.FailedError<GitError>} */
    const nullResult = {
        ok: false,
        error: new GitError('Unable to determine remote origin.', null, null)
    };
    if (!dirExists(dir, { strict: false })) {
        return nullResult;
    }
    let guard = 0; //infinite loop guard
    let d = dir;
    let firstOriginDir = null;
    let firstOriginURL = null;
    while (guard < 10) {
        guard++;
        let out = await configGet(d, "remote.origin.url", { strict: false });
        let fileOrUrl = (out.ok) ? out.result : null;
        /* add `!fileOrUrl` for the compiler */
        if (!fileOrUrl || isNullishOrEmptyString(fileOrUrl)) {
            // 1. `d` is not a git repository
            // 2. `d` has no remote `origin` (check if remote `another-name`)
            let out2 = await showTopLevel(d, { strict: false });
            if (!out2.ok) {
                // 1. `d` is not a git repository
                return nullResult;
            } else {
                // 1. `d` is a git repository
                // 2. `d` has no `remote.origin.url`
                // Look for another remote name : remote.<something>.url
                let out3 = await remoteShow(dir, { strict: false });
                if (!out3.ok) {
                    // `d` has no remote... whatsoever
                    return {
                        ok: true,
                        result: {
                            rootDir: d,
                            rootURL: undefined,
                            remoteOriginDir: (firstOriginDir) ? firstOriginDir : undefined,
                            remoteOriginURL: (firstOriginURL) ? firstOriginURL : undefined,
                        }
                    };
                }
                // here is the other 'origin' name
                const newOriginName = out3.result ?? '';
                if (isNullishOrEmptyString(newOriginName)) {
                    // theoretically : this should never happen
                    return nullResult;
                }
                // execute the `git config --get ...` command
                let out4 = await configGet(d, "remote." + newOriginName + ".url", { strict: false });
                fileOrUrl = (out4.ok) ? out4.result : null;
                if (!fileOrUrl || isNullishOrEmptyString(fileOrUrl)) {
                    return nullResult;
                }
            }
        }
        // Walk the chain 
        if (dirExists(fileOrUrl)) {
            if (!firstOriginDir) {
                firstOriginDir = fileOrUrl;
            }
            continue;
        }
        // is it a URL ? (should be)
        try {
            const url = new URL(fileOrUrl);
            if (!firstOriginDir) {
                firstOriginURL = url;
            }
            return {
                ok: true,
                result: {
                    rootDir: d,
                    rootURL: url,
                    remoteOriginDir: (firstOriginDir) ? firstOriginDir : undefined,
                    remoteOriginURL: (firstOriginURL) ? firstOriginURL : undefined,
                }
            };
        } catch (err) {
            // Can't handle this case
            return nullResult;
        }
    }
    return nullResult;
}

/**
 * `git ls-remote --exit-code [--refs] [--heads] [--tags] <repository> <refPattern>`
 * - Returns a Map with the following keys and values
 *      - key='refs/heads/{head name}'
 *      - key='refs/tags/{tag name}'
 *      - value={hash}
 * @param {!string} repository
 * @param {gitTypes.StrictGitLsRemoteOptions=} options
 * @returns {gitTypes.PromiseResultOrGitError<Map<string,string>>}
 * Git algo : 
 * - performs a server query to retrieve ALL the refs that starts with prefix
 * "refs/tags/" (--tags) or "refs/heads/" (--heads)
 * - once the git recieved the server response with ALL the refs, it applies the given pattern to filter the ouput.
 * - performance-wise, there is zero difference between fetching 100 results and 1 result.
 * - only the '--heads' and '--tags' options have an impact (server-side filtering).
 */
export async function remoteRefsHeadsAndTags(repository, options = { strict: false, refs: true }) {
    if (isNullishOrEmptyString(repository)) {
        return gitFail({ message: 'invalid repository' }, options);
    }

    let patterns = options.patterns;
    if (!patterns || patterns.length === 0) {
        //return { ok: true, result: new Map() };
        patterns = [];
    }

    const args = ["--exit-code"];
    if (options.refs) { args.push("--refs"); }
    if (options.heads) { args.push("--heads"); }
    if (options.tags) { args.push("--tags"); }

    args.push(repository);

    const out = await git.lsremote(
        process.cwd(),
        args.concat(patterns),
        { strict: false });
    /*
        https://git-scm.com/docs/git-ls-remote
        Exit with status "2" when no matching refs are found 
        in the remote repository. Usually the command exits 
        with status "0" to indicate it successfully talked 
        with the remote repository, whether it 
        found any matching refs.
    */
    if (out.ok) {
        const array = out.result?.split('\n');
        const map = new Map();
        if (array) {
            for (let i = 0; i < array?.length; ++i) {
                const kv = array[i].split('\t');
                map.set(kv[1], kv[0]);
            }
        }
        return { ok: true, result: map };
    }

    if (out.error?.code === 2) {
        return { ok: true, result: new Map() };
    }

    return gitFail({ message: "git ls-remote failed", error: out.error }, options)
}

/**
 * `git ls-remote --exit-code [--refs] [--heads] [--tags] <repository> <refPattern>`
 * - Returns a Map with the following keys and values
 *      - key='refs/heads/{head name}'
 *      - key='refs/tags/{tag name}'
 *      - value={hash}
 * @param {!string} repository
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseResultOrGitError<string>}
 * Git algo : 
 * - performs a server query to retrieve ALL the refs that starts with prefix
 * "refs/tags/" (--tags) or "refs/heads/" (--heads)
 * - once the git recieved the server response with ALL the refs, it applies the given pattern to filter the ouput.
 * - performance-wise, there is zero difference between fetching 100 results and 1 result.
 * - only the '--heads' and '--tags' options have an impact (server-side filtering).
 */
export async function lastRemoteTag(repository, options = { strict: false }) {
    if (isNullishOrEmptyString(repository)) {
        return gitFail({ message: 'invalid repository' }, options);
    }

    const args = ["--exit-code", "--refs", "--tags"];
    args.push(repository);

    const out = await git.lsremote(
        process.cwd(),
        args,
        { strict: false });
    /*
        https://git-scm.com/docs/git-ls-remote
        Exit with status "2" when no matching refs are found 
        in the remote repository. Usually the command exits 
        with status "0" to indicate it successfully talked 
        with the remote repository, whether it 
        found any matching refs.
    */
    if (out.ok) {
        const array = out.result?.split('\n');
        if (array) {
            for (let i = array.length - 1; i >= 0; --i) {
                const s = array[i].trim();
                if (s === '') {
                    continue;
                }
                const kv = s.split('\t');

                // format : 'refs/tags/v1.2.3'
                const reftag = kv[1];
                return { ok: true, result: reftag.replace('refs/tags/', '') };
            }
        }
        return { ok: true, result: '' };
    }

    if (out.error?.code === 2) {
        return { ok: true, result: '' };
    }

    return gitFail({ message: "git ls-remote failed", error: out.error }, options)
}

/**
 * @param {!string} repository
 */
export async function getLatestVersion(repository) {
    if (isNullishOrEmptyString(repository)) {
        return '';
    }
    const latestTag = await lastRemoteTag(repository, { strict: false });
    if (latestTag.ok) {
        if (!semverValid(latestTag.result)) {
            throw new CodeError(`Unable to retrieve repository latest version (repo=${repository})`);
        }
        return latestTag.result;
    } else {
        throw new CodeError(`Unable to retrieve repository latest version (repo=${repository})`);
    }
}

/**
 * - Throws an exception if failed.
 * @param {{
 *     cloneRepo?: string | null
 *     commitish?: string | null
 *     gitHubRepoName?: string | null
 * }} overrides
 * @param {string | URL} defaultGitUrl
 * @param {string} defaultGitHubRepoName
 */
 export async function getGitHubRepo(overrides, defaultGitUrl, defaultGitHubRepoName) {
    const gitRepo = { cloneRepo: '', commitish: '', gitHubRepoName: '' };
    if (overrides.cloneRepo) {
        gitRepo.cloneRepo = overrides.cloneRepo;
    }
    if (overrides.commitish) {
        gitRepo.commitish = overrides.commitish;
    }
    if (overrides.gitHubRepoName) {
        gitRepo.gitHubRepoName = overrides.gitHubRepoName;
    }

    if (isNullishOrEmptyString(gitRepo.cloneRepo)) {
        const parsedUrl = parseGitUrl(defaultGitUrl);
        gitRepo.cloneRepo = parsedUrl.url;
        if (!gitRepo.commitish) {
            gitRepo.commitish = parsedUrl.commitish;
        }
    }

    if (isNullishOrEmptyString(gitRepo.commitish)) {
        let version = overrides.commitish;
        if (version) {
            if (!semverValid(version)) {
                throw new CodeError(`Invalid service version='${version}'`)
            }
        } else {
            // Throws exception if failed
            version = await getLatestVersion(defaultGitUrl.toString());
        }
        gitRepo.commitish = version;
    }

    if (isNullishOrEmptyString(gitRepo.gitHubRepoName)) {
        gitRepo.gitHubRepoName = defaultGitHubRepoName;
    }

    assert(gitRepo.cloneRepo);
    assert(gitRepo.commitish);
    assert(gitRepo.gitHubRepoName);

    return gitRepo;
}

/**
 * Returns `true` if `branchName` is a string whose synthax 
 * respects git's accepted branch name synthax. Synthax checking
 * ignores any existing git repository.
 * @param {!string} branchName 
 */
export async function isValidBranchNameSynthax(branchName) {
    if (isNullishOrEmptyString(branchName)) {
        return false;
    }
    // do not use '--branch' option if we want to take any existing git repository into account.
    let out = await git.checkrefformat(process.cwd(), ["--branch", branchName], { strict: false });
    return out.ok;
}

/**
 * Returns `true` if `hash` belongs to the first-parent  
 * hierarchy line of `branchName` 
 * @param {!string} dir 
 * @param {!string} branchName 
 * @param {!string} hash 
 */
export async function isHashInFirstParentBranch(dir, branchName, hash) {
    if (isNullishOrEmptyString(branchName)) {
        return false;
    }
    if (!isGitHash(hash)) {
        return false;
    }
    try {
        const { stdout, stderr } = await exec(`git rev-list ${branchName} --first-parent | grep ${hash}`, { cwd: dir });
        return (stdout.trim() === hash);
    } catch (err) {
        return false;
    }
}

/**
 * `git show -s --format=%ci <hash>`
 * Returns date of a given `hash`  
 * @param {!string} dir 
 * @param {!string} hash 
 */
export async function hashDate(dir, hash) {
    if (!isGitHash(hash)) {
        return null;
    }
    /*
        -s : suppress diff output
        %ci committer date, ISO 8601-like format
        %cI committer date, strict ISO 8601 format
        %cs committer date, short format (YYYY-MM-DD)
        %ct committer date, UNIX timestamp
        %cD committer date, RFC2822 style
    */
    let out = await git.show(dir, ["-s", "--format=%cI", hash], { strict: false });
    if (!out.ok || !out.result) {
        return null;
    }
    let d = new Date(out.result);
    if (d.toString() === 'Invalid Date') {
        // may be it is a tag
        // take the last line
        const i = out.result.lastIndexOf('\n');
        d = new Date(out.result.substring(i + 1).trim());
        if (d.toString() === 'Invalid Date') {
            return null;
        }
    }
    return d;
}

/**
 * Returns first `hash` before a given date 
 * in the first-parent hierarchy line of `branchName` 
 * @param {!string} dir 
 * @param {!string} branchName 
 * @param {!Date} before 
 */
export async function firstHashInFirstParentBranchBefore(dir, branchName, before) {
    if (isNullishOrEmptyString(branchName)) {
        return null;
    }
    if (!before || !(before instanceof Date)) {
        return null;
    }
    //git rev-list origin/develop --first-parent --before="2022-12-20" -n 1
    let out = await git.revlist(dir, [branchName, "--first-parent", "--before=" + before.toISOString(), "-n", "1"]);
    if (!out.ok || !out.result || !isGitHash(out.result)) {
        return null;
    }
    return out.result;
}

/**
  @typedef GitFileHistory
  @type {object}
  @property {!string=} hash
  @property {!Date=} date
  @property {!string=} ref
  @property {!string} content
 */

/**
 * Returns content of a given `file` located in `repoDir`, `file` must
 * be relative.
 * - `hash` can have only to values:
 *   - `undefined` : `file` is read directly in `repoDir` 
 *      - `date` is `undefined`
 *      - `ref` is `undefined`
 *   - a valid Git Hash : `file` is read directly in `repoDir` 
 *      - `date` is a valid date
 *      - `ref` is a valid git ref or `undefined` (ex: tag name)
 * @param {!string} file 
 * @param {!string} repoDir 
 * @param {string | Date | null | undefined} commitish 
 * @param {types.Strict=} options 
 * @returns {gitTypes.PromiseResultOrGitError<GitFileHistory>}
 */
export async function getRepoFileAt(file, repoDir, commitish = null, options = { strict: false }) {
    if (isNullishOrEmptyString(file)) {
        return gitFail({ message: `file argument is invalid` }, options);
    }
    if (isNullishOrEmptyString(repoDir)) {
        return gitFail({ message: `repoDir argument is invalid` }, options);
    }
    if (path.isAbsolute(file)) {
        return gitFail({ message: `file must be relative (file=${file})` }, options);
    }
    if (!dirExists(repoDir)) {
        return gitFail({ message: `dir=${repoDir} does not exist` }, options);
    }

    // check if commitish is version
    let sv;
    if (commitish && !(commitish instanceof Date)) {
        try { sv = new SemVer(commitish); } catch { }
    }

    let content;
    let hash;
    let ref;
    let date;

    if (commitish instanceof Date) {
        const h = await firstHashInFirstParentBranchBefore(repoDir, 'origin/HEAD', commitish);
        if (!h) {
            return gitFail({ message: `Could not find any hash prior to '${commitish.toString()}' (dir=${repoDir})` }, options);
        }
        date = commitish;
        hash = h;
        const out = await git.show(repoDir, [hash + ":" + file], { strict: false });
        if (!out.ok) {
            return gitFail({ message: `No 'gradle.properties' file prior to ${date.toString()}. '${hash}:gradle.properties' does not exist (dir=${repoDir})` }, options);
        }
        assert(out.result);
        content = out.result;
    } else if (sv) {
        const is_next = sv.raw.endsWith('-NEXT-SNAPSHOT');
        if (is_next) {
            return gitFail({ message: `Unsupported version='${commitish}' (dir=${repoDir})` }, options);
        }

        // Try with 'v' prefix : tags/vX.Y.Z
        let tag = "tags/v" + sv.version;
        const out_v = await git.show(repoDir, [tag + ":" + file], { strict: false });
        if (out_v.ok) {
            assert(out_v.result);
            content = out_v.result;
            ref = "refs/" + tag;
        } else {
            // Try without 'v' prefix : tags/X.Y.Z
            tag = "tags/" + sv.version;
            const out_no_v = await git.show(repoDir, [tag + ":" + file], { strict: false });
            if (!out_no_v.ok) {
                return gitFail({ message: `Unknown version='${commitish}' (dir=${repoDir})` }, options);
            }
            assert(out_no_v.result);
            content = out_no_v.result;
            ref = "refs/" + tag;
        }
    } else if (isNullishOrEmptyString(commitish)) {
        // commitish is 'origin/HEAD'
        const out = await git.show(repoDir, ["origin/HEAD:" + file], { strict: false });
        if (!out.ok) {
            const f = resolveAbsolutePath(path.join(repoDir, file));
            if (!fileExists(f, { strict: false })) {
                return gitFail({ message: `Neither 'origin/HEAD:${file}' nor '${f}' exist (dir=${repoDir})` }, options);
            }
            content = readFileSync(f, { strict: false });
            if (content === null || content === undefined) {
                return gitFail({ message: `Neither 'origin/HEAD:${file}' nor '${f}' exist (dir=${repoDir})` }, options);
            }
        } else {
            assert(out.result);
            ref = 'origin/HEAD';
            content = out.result;
        }
    } else {
        // commitish is a git ref object, 
        // Ex: 'af33b2dd319cf00e0f7ffa49e642ab93a27c17be', 'tags/myTag', 'heads/my-branch'  
        const out = await git.show(repoDir, [commitish + ":" + file], { strict: false });
        if (!out.ok) {
            return gitFail({ message: `'${commitish}:${file}' does not exist (dir=${repoDir})` }, options);
        }
        assert(out.result);
        if (commitish) {
            ref = commitish;
        }
        content = out.result;
    }

    // Resolve hash if needed
    if (ref && !hash) {
        const out_hash = await objectHash(repoDir, ref);
        if (!out_hash.ok || !out_hash.result) {
            return gitFail({ message: `Unable to retrieve hash of '${ref}' (dir=${repoDir})` }, options);
        }
        hash = out_hash.result;
    }

    // Resolve date if needed
    if (hash && !date) {
        date = await hashDate(repoDir, hash);
        if (!date) {
            return gitFail({ message: `Unable to determine hash date (hash=${hash}, dir=${repoDir})` }, options);
        }
    }

    return {
        ok: true,
        result: {
            ref: ref,
            hash: hash,
            date: date,
            content: content
        }
    };
}

/**
 * @param {!string} repoDir 
 * @param {string | null} branch
 * @param {string | Date | null} commitish 
 * @param {types.Strict=} options 
 * @returns {gitTypes.PromiseResultOrGitError<gitTypes.GitCommitInfo>}
 */
export async function resolveCommitish(repoDir, branch, commitish, options = { strict: false }) {
    if (isNullishOrEmptyString(repoDir)) {
        return gitFail({ message: `repoDir argument is invalid` }, options);
    }
    if (!dirExists(repoDir)) {
        return gitFail({ message: `dir=${repoDir} does not exist` }, options);
    }

    if (isNullishOrEmptyString(branch)) {
        branch = null;
    }
    if (commitish === 'latest') {
        commitish = null;
    }

    // check if commitish is version
    let sv;
    if (commitish && !(commitish instanceof Date)) {
        try { sv = new SemVer(commitish); } catch { }
    }

    let hash;
    let ref;
    let date;

    if (commitish instanceof Date) {
        // branch not yet supported (see below)
        assert(branch === null);
        const h = await firstHashInFirstParentBranchBefore(repoDir, 'origin/HEAD', commitish);
        if (!h) {
            return gitFail({ message: `Could not find any hash prior to '${commitish.toString()}' (dir=${repoDir})` }, options);
        }
        //date = commitish;
        hash = h;
        assert(hash);
    } else if (sv) {
        const is_next = sv.raw.endsWith('-NEXT-SNAPSHOT');
        if (is_next) {
            return gitFail({ message: `Unsupported version='${commitish}' (dir=${repoDir})` }, options);
        }

        assert(sv.version);

        // Try with 'v' prefix : tags/vX.Y.Z
        let tag = "v" + sv.version;
        const out_v = await tagHash(repoDir, tag, { strict: false });
        if (out_v.ok) {
            assert(out_v.result);
            hash = out_v.result;
            ref = "refs/" + tag;
        } else {
            // Try without 'v' prefix : tags/X.Y.Z
            tag = sv.version;
            const out_no_v = await tagHash(repoDir, tag, { strict: false });
            if (!out_no_v.ok) {
                return gitFail({ message: `Unknown version='${commitish}' (dir=${repoDir})` }, options);
            }
            assert(out_no_v.result);
            hash = out_no_v.result;
            ref = "refs/" + tag;
        }
        assert(hash);
        assert(ref);
    } else if (isNullishOrEmptyString(commitish)) {
        if (branch) {
            assert(branch !== 'latest');
            ref = `origin/${branch}`;
        } else {
            ref = 'origin/HEAD';
        }
    } else {
        // commitish is a git ref object, 
        // Ex: 'af33b2dd319cf00e0f7ffa49e642ab93a27c17be', 'tags/myTag', 'heads/my-branch'  
        assert(commitish);
        ref = commitish;
    }

    // Resolve hash if needed
    if (!hash) {
        if (!ref) {
            return gitFail({ message: `Unable to retrieve hash (dir=${repoDir})` }, options);
        }
        const out_hash = await objectHash(repoDir, ref);
        if (!out_hash.ok) {
            return gitFail({ message: `Unable to retrieve hash of '${ref}' (dir=${repoDir})` }, options);
        }
        assert(out_hash.result);
        hash = out_hash.result;
    }

    // Resolve date if needed
    if (!date) {
        date = await hashDate(repoDir, hash);
        if (!date) {
            return gitFail({ message: `Unable to determine hash date (hash=${hash}, dir=${repoDir})` }, options);
        }

    }

    return {
        ok: true,
        result: {
            hash: hash,
            date: date,
            ref: ref,
            semver: sv
        }
    };
}

/**
 * Given :
 * - `iexec-common` + `https://github.com/iExecBlockchainComputing/iexec-sms.git`
 *      - returns `https://github.com/iExecBlockchainComputing/iexec-common.git`
 * - `iexec-common` + `file:///path/to/some-dir/iexec-sms`
 *      - returns `/path/to/some-dir/iexec-common`
 * - `iexec-common` + `/path/to/some-dir/iexec-sms`
 *      - returns `/path/to/some-dir/iexec-common`
 * @param {!string} repoName 
 * @param {!string | !URL} siblingRepository 
 */
export function guessRepositoryFromSibling(repoName, siblingRepository) {
    let u, ru;
    try {
        if (siblingRepository instanceof URL) {
            u = siblingRepository;
        } else {
            u = new URL(siblingRepository);
        }
    } catch { }
    if (u) {
        if (u.protocol !== 'file:') {
            // http://
            if (u.pathname.endsWith('.git')) {
                try { ru = new URL(ensureSuffix('.git', repoName), u); } catch { }
                if (ru) {
                    return ru;
                }
            }
        } else {
            // file://
            const candidate = path.join(path.dirname(u.pathname), removeSuffix('.git', repoName));
            if (dirExists(candidate)) {
                return candidate;
            }
        }
    } else {
        assert(typeof siblingRepository === 'string');
        if (dirExists(siblingRepository)) {
            const candidate = path.join(path.dirname(siblingRepository), removeSuffix('.git', repoName));
            if (dirExists(candidate)) {
                return candidate;
            }
        }
    }
    return new URL(ensureSuffix('.git', repoName), 'https://github.com/iExecBlockchainComputing/');
}

/**
 * - `git diff --quiet`
 * - `git commit -am <message>`
 * @param {!string} dir 
 * @param {!string} message 
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function commitAll(dir, message, options = { strict: true }) {
    if (isNullishOrEmptyString(message)) {
        return gitFail({ message: `Missing commit message.` }, options);
    }
    // return code === 0 if unchanged
    // return code === 1 if changed
    const out = await git.diff(dir, ["--quiet"], { strict: false });

    const unchanged = out.ok;
    if (unchanged) {
        return { ok: true, result: '' };
    }

    return git.commit(dir, ["-am", message], options);
}
