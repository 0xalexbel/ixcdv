import * as types from '../common/common-types.js';
import * as gitTypes from './git-types.js';
import * as path from 'path';
import assert from 'assert';
import { gitFail, throwGitError } from './git-internal.js'
import * as git from './git.js'
import { isGitHash, remoteRefsHeadsAndTags, HEADName, isValidBranchNameSynthax, HEADHash } from './git-api.js';
import { GitError } from './git-error.js';
import { isNullishOrEmptyString } from '../common/string.js';
import { dirExists, mkDirP, resolveAbsolutePath, rmrf } from '../common/fs.js';
import { throwIfNotString } from '../common/error.js';

/**
 * - If `dstDirectory` already exists, do nothing.
 * - If `dstCreateDir === true`:
 *      - `mkdir -p basename(<dstDirectory>)`
 * - Then git clone (with or without --branch)
 *      - `git clone <srcRepository> <dstDirectory>`
 *      - `git clone <srcRepository> <dstDirectory> --branch <srcBranch>`
 * - If `dstNewBranchName` is defined:
 *      - `git checkout -b newBranchName newBranchStartPoint`  (if `newBranchStartPoint` is defined)
 *      - `git checkout -b newBranchName`
@typedef GitCloneArgs
@type {object}
    @property {!string} srcRepository repository to clone
    @property {!string} dstDirectory new cloned repository directory
    @property {!boolean=} dstCreateDir create missing directories if needed (default:false)
    @property {!string=} srcBranch `--branch` argument
    @property {!string=} dstNewBranchName name of the new branch to create 
    @property {!string=} dstNewBranchStartPoint can be tag/hash/branch 
*/

/**
 * @deprecated
 * @param {!GitCloneArgs} cloneArgs 
 * @param {types.Strict=} options
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
export async function cloneAndCheckout(cloneArgs, options = { strict: true }) {
    if (isNullishOrEmptyString(cloneArgs.srcRepository)) {
        return gitFail({ message: "Missing property 'srcRepository'" }, options);
    }
    if (isNullishOrEmptyString(cloneArgs.dstDirectory)) {
        return gitFail({ message: "Missing property 'dstDirectory'" }, options);
    }
    const dstDir = resolveAbsolutePath(cloneArgs.dstDirectory);
    const dstCreateDir = (cloneArgs.dstCreateDir ?? false);
    const dstParentDir = path.dirname(dstDir);

    // Git hash are not supported
    if (cloneArgs.dstNewBranchStartPoint) {
        if (isGitHash(cloneArgs.dstNewBranchStartPoint)) {
            return gitFail({ message: `property 'dstNewBranchStartPoint' cannot be a git hash` }, options);
        }
    }

    let rmDstDirIfFailed = false;
    if (dirExists(dstDir, { strict: false })) {
        return gitFail({ message: `directory '${dstDir}' already exist` }, options);
    }
    if (dstCreateDir) {
        if (!dirExists(dstParentDir, { strict: false })) {
            if (!mkDirP(dstParentDir, { strict: false })) {
                return gitFail({ message: `create directory '${dstParentDir}' failed` }, options);
            } else {
                rmDstDirIfFailed = true;
            }
        }
    } else {
        if (!dirExists(dstParentDir, { strict: false })) {
            return gitFail({ message: `directory '${dstParentDir}' does not exist` }, options);
        }
    }

    try {
        return cloneAndCheckoutCore(dstParentDir, cloneArgs);
    } catch (error) {
        if (rmDstDirIfFailed) {
            await rmrf(dstDir);
        }
        assert(error instanceof GitError);
        return gitFail({ message: error.message, error: error }, options);
    }
}

/**
 * @private
 * @param {!string} dir
 * @param {!GitCloneArgs} cloneArgs 
 * @returns {gitTypes.PromiseStringResultOrGitError}
 */
async function cloneAndCheckoutCore(dir, cloneArgs) {
    let srcBranch = (cloneArgs.srcBranch ?? '');
    let startPoint = (cloneArgs.dstNewBranchStartPoint ?? '');
    let dstBranch = (cloneArgs.dstNewBranchName ?? '');

    srcBranch = throwIfNotString(srcBranch);
    startPoint = throwIfNotString(startPoint);
    dstBranch = throwIfNotString(dstBranch);

    if (startPoint.length > 0 && (dstBranch.length === 0)) {
        throwGitError(`Missing property 'dstNewBranchName', because property 'dstNewBranchStartPoint' has been specified.`);
    }

    const useDefaultBranch = (isNullishOrEmptyString(dstBranch));

    let testBranchNameSynthax = dstBranch;

    // if dstBranch refers to a dynamic branch name
    // Ex: dstBranch = '<productName>-${HEADName}' 
    let dynDstBranch = null;

    const hasHEADName = (dstBranch.indexOf("${HEADName}") >= 0);
    const hasHash = (dstBranch.indexOf("${hash}") >= 0);
    const hasShortHash = (dstBranch.indexOf("${shortHash}") >= 0);

    if (hasHEADName || hasHash || hasShortHash) {
        dynDstBranch = dstBranch;

        testBranchNameSynthax = dstBranch;
        if (hasHEADName) {
            testBranchNameSynthax = testBranchNameSynthax.replaceAll("${HEADName}", "master");
        }
        if (hasShortHash) {
            testBranchNameSynthax = testBranchNameSynthax.replaceAll("${shortHash}", "deadbeef");
        }
        if (hasHash) {
            testBranchNameSynthax = testBranchNameSynthax.replaceAll("${hash}", "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
        }

        dstBranch = '';
    }

    if (!useDefaultBranch) {
        // performs a git branch name synthax check
        if (!await isValidBranchNameSynthax(testBranchNameSynthax)) {
            throwGitError(`Synthax error: '${dstBranch}' is not a valid git branch name.`);
        }
    }

    const args = [];
    if (cloneArgs.srcBranch) {
        args.push("--branch");
        args.push(cloneArgs.srcBranch);
    }
    args.push(cloneArgs.srcRepository);
    args.push(cloneArgs.dstDirectory);

    /** @type {string[]} */
    const patterns = [];
    if (srcBranch.length > 0) { patterns.push(srcBranch); }
    if (dstBranch.length > 0) { patterns.push(dstBranch); }
    if (startPoint.length > 0) { patterns.push(startPoint); }

    let out;
    let theRemoteRefsHeadsAndTags = null;
    let startHash = null;

    /*
        No need to start a 'heavy' clone if
        - 'srcBranch' does not exist
        - 'dstBranch' already exists
        - 'startPoint' does not exist
    */
    if (patterns.length > 0) {
        // we only need the tags if 'startPoint' is defined.
        const fetchRemoteTags = (startPoint.length > 0);
        out = await remoteRefsHeadsAndTags(cloneArgs.srcRepository, {
            strict: true,
            patterns: patterns,
            heads: true,
            tags: fetchRemoteTags
        });

        assert(out.ok);
        theRemoteRefsHeadsAndTags = out.result;

        if (srcBranch.length > 0) {
            const srcBranchHash = theRemoteRefsHeadsAndTags?.get('refs/heads/' + srcBranch);
            if (!srcBranchHash) {
                throwGitError(`srcBranch='${srcBranch}' does not exist`);
            }
            startHash = srcBranchHash;
        }

        if (dstBranch.length > 0) {
            if (theRemoteRefsHeadsAndTags?.has('refs/heads/' + dstBranch)) {
                throwGitError(`dstNewBranchName='${dstBranch}' already exist`);
            }
        }

        if (startPoint.length > 0) {
            if (startPoint.startsWith('heads/')) {
                startPoint = 'refs/' + startPoint;
            }
            if (startPoint.startsWith('tags/')) {
                startPoint = 'refs/' + startPoint;
            }
            if (startPoint.startsWith('refs/')) {
                const startPointHash = theRemoteRefsHeadsAndTags?.get(startPoint);
                if (!startPointHash) {
                    throwGitError(`dstNewBranchStartPoint='${startPoint}' does not exist`);
                }
                startHash = startPointHash;
            } else {
                const headStartPoint = 'refs/heads/' + startPoint;
                const tagStartPoint = 'refs/tags/' + startPoint;
                const headStartPointHash = theRemoteRefsHeadsAndTags?.get(headStartPoint);
                const tagStartPointHash = theRemoteRefsHeadsAndTags?.get(tagStartPoint);
                if (headStartPointHash && tagStartPointHash) {
                    throwGitError(`dstNewBranchStartPoint='${startPoint}' is ambiguous`);
                }
                if (headStartPointHash) {
                    startPoint = headStartPoint;
                    startHash = headStartPointHash;
                } else if (tagStartPointHash) {
                    startPoint = tagStartPoint;
                    startHash = tagStartPointHash;
                }
            }
        }
    }

    // strict = true to throw an error if needed
    let clone_out = await git.clone(dir, args, { strict: true });

    // If 'dstBranch' is dynamically constructed using 
    // the remote default branch name, 
    if (dynDstBranch) {
        // determine remote HEAD default branch name
        // Just after clone, it is equal to the current branch name
        //git for-each-ref --format="%(if)%(HEAD)%(then)%(refname) %(objectname)%(end)" refs/heads/

        // current branch name + commitId
        // compare commitd with branchname !!
        //git for-each-ref --format="%(if)%(HEAD)%(then)%(refname) %(objectname)%(end)" --points-at=HEAD refs/heads/
        let theHEADName = null;
        if (hasHEADName) {
            out = await HEADName(cloneArgs.dstDirectory, { strict: true });
            assert(out.ok);
            theHEADName = (out.result ?? '');
            if (isNullishOrEmptyString(theHEADName)) {
                throwGitError('Unable to determine HEAD name');
            }
            dstBranch = dynDstBranch.replaceAll("${HEADName}", theHEADName);
        }

        if (hasHash || hasShortHash) {
            if (!startHash) {
                out = await HEADHash(cloneArgs.dstDirectory, { strict: true });
                assert(out.ok);
                const theHEADHash = (out.result ?? '');
                startHash = theHEADHash;
            }
            if (!isGitHash(startHash)) {
                throwGitError('Unable to determine start hash');
            }
            if (hasHash) {
                dstBranch = dynDstBranch.replaceAll("${hash}", startHash);
            }
            if (hasShortHash) {
                dstBranch = dynDstBranch.replaceAll("${shortHash}", startHash.substring(0, 8));
            }
        }
    }

    if (dstBranch.length > 0) {
        if (startPoint.length > 0) {
            // strict = true to throw an error if needed
            return git.checkout(cloneArgs.dstDirectory, ["-b", dstBranch, startPoint], { strict: true });
        } else {
            // strict = true to throw an error if needed
            return git.checkout(cloneArgs.dstDirectory, ["-b", dstBranch], { strict: true });
        }
    }

    return clone_out;
}