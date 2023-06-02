import * as pkgTypes from './pkgmgr-types.js';
import assert from 'assert';
import * as path from 'path';
import { dirExists, mkDirP, rmrf } from '../common/fs.js';
import * as git from '../git/git.js';
import { isNullishOrEmptyString } from '../common/string.js';

/**
 * @param {'cloning' | 'cloned' | 'failed'} cloneStatus
 * @param {!string} cloneDir 
 * @param {pkgTypes.Setup} setup
 */
export function setCloneStatus(cloneStatus, cloneDir, setup) {
    const pkgDir = setup.directories[cloneDir];
    assert(pkgDir);
    assert(pkgDir.pkgArg.directory === cloneDir);
    assert(pkgDir.alreadyCloned === undefined);

    if (cloneStatus === 'cloning') {
        assert(!pkgDir.gitCloneStatus);
    } else if (cloneStatus === 'cloned') {
        assert(pkgDir.gitCloneStatus === 'cloning');
    } else if (cloneStatus === 'failed') {
        assert(pkgDir.gitCloneStatus === 'cloning');
    } else {
        assert(false);
    }
    pkgDir.gitCloneStatus = cloneStatus;
}

/**
 * @param {!Error} error
 * @param {!string} cloneDir 
 * @param {pkgTypes.Setup} setup
 */
export function setCloneFailed(error, cloneDir, setup) {
    const pkgDir = setup.directories[cloneDir];
    assert(pkgDir);
    assert(pkgDir.alreadyCloned === undefined);
    assert(pkgDir.pkgArg.directory === cloneDir);
    assert(!pkgDir.gitCloneError);
    assert(pkgDir.gitCloneStatus === 'cloning');
    pkgDir.gitCloneError = error;
    pkgDir.gitCloneStatus = 'failed';
}

/**
 * @param {!string} cloneDir 
 * @param {pkgTypes.Setup} setup
 */
export function setAlreadyCloned(cloneDir, setup) {
    const pkgDir = setup.directories[cloneDir];
    assert(pkgDir);
    assert(pkgDir.pkgArg.directory === cloneDir);
    if (pkgDir.alreadyCloned !== true) {
        assert(pkgDir.alreadyCloned === undefined);
    }
    assert(pkgDir.gitCloneStatus === undefined);
    assert(!pkgDir.gitCloneError);
    pkgDir.alreadyCloned = true;
}

/**
 * @param {!string} cloneDir
 * @param {pkgTypes.Setup} setup 
 */
export function alreadyCloning(cloneDir, setup) {
    const pkgDir = setup.directories[cloneDir];
    if (!pkgDir) {
        return false;
    }
    if (pkgDir.gitCloneStatus) {
        return (pkgDir.gitCloneStatus === 'cloning');
    }
    return false;
}

/**
 * @param {!string} cloneDir
 * @param {pkgTypes.Setup} setup 
 */
export function cloneFailed(cloneDir, setup) {
    const pkgDir = setup.directories[cloneDir];
    if (!pkgDir) {
        return false;
    }
    if (pkgDir.gitCloneStatus) {
        return (pkgDir.gitCloneStatus === 'failed');
    }
    return false;
}

/**
 * - Throws an error if failed
 * - Executes: 
 * `git clone <cloneRepo> <cloneDir> [--branch <cloneBranch>]`
 * @param {!string} gitHubRepo
 * @param {!string} cloneRepo
 * @param {!string} cloneDir
 * @param {!string} cloneBranch
 * @param {pkgTypes.Setup} setup 
 */
export async function clone(gitHubRepo, cloneRepo, cloneDir, cloneBranch, setup) {
    // Performs the actual git clone
    const parentCloneDir = path.dirname(cloneDir);
    let rmParentCloneDirIfFailed = false;
    try {
        if (!dirExists(parentCloneDir)) {
            mkDirP(parentCloneDir, { strict: true });
            rmParentCloneDirIfFailed = true;
        }
        setCloneStatus('cloning', cloneDir, setup);

        if (!isNullishOrEmptyString(cloneBranch)) {
            console.error("cloning : " + cloneDir);
            console.error(`git clone ${cloneRepo} ${cloneDir} --branch ${cloneBranch}`);
            await git.clone(parentCloneDir, [cloneRepo, cloneDir, "--branch", cloneBranch], { strict: true });
            console.error("cloned : " + cloneDir);
        } else {
            console.error("cloning : " + cloneDir);
            await git.clone(parentCloneDir, [cloneRepo, cloneDir], { strict: true });
            console.error("cloned : " + cloneDir);
        }

        setCloneStatus('cloned', cloneDir, setup);
    } catch (err) {
        assert(err instanceof Error);
        setCloneFailed(err, cloneDir, setup);
        if (rmParentCloneDirIfFailed) {
            await rmrf(parentCloneDir);
        }
        throw err;
    }
}
