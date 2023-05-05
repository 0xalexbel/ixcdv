import * as ERROR_CODES from "../common/error-codes.js";
import * as types from '../common/common-types.js';
import * as pkgTypes from '../pkgmgr/pkgmgr-types.js';
import assert from 'assert';
import { initSetup, installPkgDir } from './pkgdir.js';
import { commitishEq, commitishToPrivateTag } from './commitish.js';
import path from 'path';
import * as npm from '../common/npm.js';
import { isNullishOrEmptyString } from '../common/string.js';
import { CodeError, fail } from '../common/error.js';
import { dirExists, fileExists, pathIsPOSIXPortableWithPlaceholders } from "../common/fs.js";
import { parseGitUrl } from "../common/utils.js";
import { patchRepo } from "../patch/patcher.js";
import { gradlewBuildNoTest, gradlewClean } from "../common/gradlew.js";
import * as gitApi from "../git/git-api.js";
import * as git from "../git/git.js";

/**
 * @param {*} value 
 */
export async function isPackageOrDirectory(value) {
    if (value === null || value === undefined) {
        return false;
    }
    if (typeof value === 'string') {
        return !isNullishOrEmptyString(value);
    }
    if (typeof value !== 'object') {
        return false;
    }
    return !isNullishOrEmptyString(value.directory);
}

/**
 * - If `repository` is a`string` :
 *      - `repository` is a directory path (abolute or relative) where the final package is located
 *      - `repository` must be POSIX portable including placeholders
 *      - `toPackage` will generate the corresponding `Package` structure.
 * - If `repository` is a`Package` :
 *      - `repository.directory` must be POSIX portable including placeholders
 *      - `toPackage` will do nothing, `repository` is left as-is.
 * - Throws an error if failed.
 * @param {string | types.Package} repository
 * @param {(string | URL)=} gitUrl
 */
export function toPackage(repository, gitUrl) {
    if (!repository || !isPackageOrDirectory(repository)) {
        throw new CodeError(
            'Invalid repository argument, expecting package or directory',
            ERROR_CODES.PKGMGR_ERROR);
    }

    if (gitUrl) {
        if (typeof gitUrl === 'string') {
            if (isNullishOrEmptyString(gitUrl)) {
                throw new CodeError(
                    'Missing git url argument, expecting a string or an URL object',
                    ERROR_CODES.PKGMGR_ERROR);
            }
        } else if (!(gitUrl instanceof URL)) {
            throw new CodeError(
                'Invalid git url argument, expecting a string or an URL object',
                ERROR_CODES.PKGMGR_ERROR);
        }
    }

    /** @type {types.Package} */
    let pkg;
    if (typeof repository === 'string') {
        if (!pathIsPOSIXPortableWithPlaceholders(repository)) {
            throw new TypeError(`path is not POSIX portable with placeholders (path='${repository}')`);
        }

        let cloneRepo;
        let commitish;
        if (gitUrl) {
            ({ url: cloneRepo, commitish } = parseGitUrl(gitUrl));
        }

        pkg = {
            cloneRepo,
            directory: repository,
            clone: "ifmissing",
            patch: true,
            commitish
        };
    } else if (typeof repository === 'object') {
        if (!pathIsPOSIXPortableWithPlaceholders(repository.directory)) {
            throw new TypeError(`Package directory is not POSIX portable with placeholders (path='${repository.directory}')`);
        }
        pkg = repository;
    } else {
        throw new CodeError('Invalid repository argument');
    }
    return pkg;
}

/**
 * - If `repository` is a`string` :
 *      - `repository` is a directory path (abolute or relative) where the final package is located
 *      - `repository` must be POSIX portable including placeholders
 *      - `toPackageDirectory` returns `repository`.
 * - If `repository` is a`Package` :
 *      - `repository.directory` is a directory path (abolute or relative) where the final package is located
 *      - `repository.directory` must be POSIX portable including placeholders
 *      - `toPackageDirectory` returns `repository.directory`.
 * - Throws an error if failed.
 * @param {string | types.Package} repository
 */
export function toPackageDirectory(repository) {
    if (!repository || !isPackageOrDirectory(repository)) {
        throw new CodeError(
            'Invalid repository argument, expecting package or directory',
            ERROR_CODES.PKGMGR_ERROR);
    }

    /** @type {types.Package} */
    let pkg;
    if (typeof repository === 'string') {
        if (!pathIsPOSIXPortableWithPlaceholders(repository)) {
            throw new TypeError(`path is not POSIX portable with placeholders (path='${repository}')`);
        }
        return repository;
    } else if (typeof repository === 'object') {
        if (!pathIsPOSIXPortableWithPlaceholders(repository.directory)) {
            throw new TypeError(`Package directory is not POSIX portable with placeholders (path='${repository.directory}')`);
        }
        return repository.directory;
    } else {
        throw new CodeError('Invalid repository argument');
    }
}

/**
 * @param {types.Package} pkg
 * @param {string=} defaultDirectoryDirname
 */
export async function installPackage(pkg, defaultDirectoryDirname) {

    const setup = initSetup(pkg, defaultDirectoryDirname);

    /** @type {pkgTypes.PkgDir} */
    const mainPkgDir = {
        pkgArg: pkg
    }
    await installPkgDir(mainPkgDir, setup);

    const mustCheckout = true;
    const mustApplyPatch = true
    const mustRunNpmInstall = true
    const mustRunGradleBuild = true

    if (mustCheckout) {
        const out = await checkoutSetup(setup, { strict: true });
        assert(out?.ok);
    }

    if (mustApplyPatch) {
        const out = await applyPatch(setup, { strict: true });
        assert(out?.ok);
    }

    if (mustRunNpmInstall) {
        const out = await npmInstallSetup(setup, { strict: true });
        assert(out?.ok);
    }

    if (mustRunGradleBuild) {
        const out = await gradleBuildSetup(setup, { strict: true });
        assert(out?.ok);
    }

    // const out = await generateVSCodeWorkspace(setup, { strict: true });
    // assert(out?.ok);
}

/**
 * @param {pkgTypes.Setup} setup 
 * @param {types.Strict=} strict
 * @returns {types.PromiseOkOrCodeError}
 */
async function applyPatch(setup, strict = { strict: false }) {

    let forceApplyPatch = false;
    // Debug
    // if (setup.mainDir.indexOf('iexec-worker') > 0) {
    //     //forceApplyPatch = true;
    // }

    // - 1. Replace project name
    // - 2. implementation "com.iexec.common:iexec-common:$iexecCommonVersion"
    const dirs = Object.keys(setup.directories);
    for (let i = 0; i < dirs.length; ++i) {
        const dir = dirs[i];
        assert(dirExists(dir));

        const pkgArg = setup.directories[dir].pkgArg;

        if (!forceApplyPatch) {
            // Patch only once!
            if (setup.directories[dir].alreadyCloned) {
                continue;
            }
        }

        if (pkgArg.patch === true) {
            const out = await patchRepo(dir, setup, strict);
            if (!out.ok) {
                return fail(out.error, strict);
            }
        }
    }

    return { ok: true };
}


/**
 * @param {pkgTypes.Setup} setup 
 * @param {types.Strict=} options
 * @returns {types.PromiseOkOrCodeError}
 */
async function npmInstallSetup(setup, options = { strict: false }) {

    const dirs = Object.keys(setup.directories);
    for (let i = 0; i < dirs.length; ++i) {
        const dir = dirs[i];
        assert(dirExists(dir));

        let npmPkgDirs = [dir];

        const pkgArg = setup.directories[dir].pkgArg;
        if (pkgArg.gitHubRepoName === 'iexec-market-api') {
            npmPkgDirs = [
                path.join(dir, 'api'),
                path.join(dir, 'watcher'),
            ]
        }

        for (let j = 0; j < npmPkgDirs.length; ++j) {
            // if 'package.json' file does not exist,
            // we are not dealing with a node pkg
            if (!fileExists(path.join(npmPkgDirs[j], 'package.json'))) {
                continue;
            }

            // if 'node_modules' already exists, skip install
            if (dirExists(path.join(npmPkgDirs[j], 'node_modules'))) {
                continue;
            }

            const out_ins = await npm.install(npmPkgDirs[j], [], { strict: false });
            if (!out_ins.ok) {
                return out_ins;
            }
        }

        if (pkgArg.gitHubRepoName === 'iexec-sdk') {
            const out_ins = await npm.run(dir, ['build'], { strict: false });
            if (!out_ins.ok) {
                return out_ins;
            }
        }
    }

    return { ok: true };
}

/**
 * @param {pkgTypes.Setup} setup 
 * @param {types.Strict=} options
 * @returns {types.PromiseOkOrCodeError}
 */
async function gradleBuildSetup(setup, options = { strict: false }) {
    //const dirs = Object.keys(setup.directories);
    const dirs = [setup.mainDir];
    for (let i = 0; i < dirs.length; ++i) {
        const dir = dirs[i];
        assert(dirExists(dir));

        const pkgArgGradleVersions = setup.directories[dir].pkgArgGradleVersions;
        if (!pkgArgGradleVersions) {
            continue;
        }

        // if 'build' directory already exists, do not re-build
        if (dirExists(path.join(dir, 'build'))) {
            continue;
        }

        // Does not clean any dependency
        const out_clean = await gradlewClean(dir, { strict: false });
        if (!out_clean.ok) {
            return out_clean;
        }

        // Build project & dependencies
        const out_build = await gradlewBuildNoTest(dir, { strict: false });
        if (!out_build.ok) {
            return out_build;
        }
    }

    return { ok: true };
}

/**
 * @param {pkgTypes.Setup} setup 
 * @param {types.Strict=} options
 * @returns {types.PromiseOkOrCodeError}
 */
async function checkoutSetup(setup, options = { strict: false }) {

    const dirs = Object.keys(setup.directories);
    for (let i = 0; i < dirs.length; ++i) {
        const dir = dirs[i];
        assert(dirExists(dir));

        const pkgDir = setup.directories[dir];
        const pkgArgCommitInfo = pkgDir.pkgArgCommitInfo;
        assert(pkgArgCommitInfo);

        // Packages with the 'clone' property equal to 'never'
        // are left as-is
        if (pkgDir.pkgArg.clone === 'never') {
            continue;
        }

        // computes the custom <productName> tag name:
        // - version : '<productName>-v1.2.3-<hash-12-long>'
        // - date : '<productName>-<date iso>-<hash-12-long>'
        // - latest : '<productName>-latest-<hash-12-long>'
        const privTagName = commitishToPrivateTag(
            pkgArgCommitInfo,
            pkgArgCommitInfo?.hash);

        // test if a branch having name == <productName>-vX.Y.Z-<hash>
        // or <productName>-<date>-<hash>
        // already exists
        const out_verif = await gitApi.verifyObject(
            dir,
            'refs/heads/' + privTagName,
            { strict: false });

        if (!out_verif.ok) {
            // branch does not exist
            // Create a new branch with our custom name '<productName>-...'
            // Checkout this new branch at the requested hash value
            const out_co = await git.checkout(
                dir,
                ["-b", privTagName, pkgArgCommitInfo.hash],
                { strict: false });

            if (!out_co.ok) {
                return fail(
                    new CodeError(`'${dir}' git checkout failed.`, ERROR_CODES.PKGMGR_ERROR),
                    options);
            }

            pkgDir.gitBranch = privTagName;
        } else {
            // Our custom '<productName>-...' branch already exists.
            // Before going any further:
            // 1- retrieve the current branch name
            // 2- retrieve the current hash value
            // The operation will immediately fail if:
            // - the current hash value is not equal the request hash value
            // - the current branch name is not equal the requested branch name
            const out = await gitApi.HEADNameAndHash(dir, { strict: false });
            if (!out.ok) {
                return fail(
                    new CodeError(out.error.message, ERROR_CODES.PKGMGR_ERROR),
                    { strict: false });
            }
            if (out.result.name !== "refs/heads/" + privTagName) {
                const out_br = await gitApi.branchHash(dir, privTagName, { strict: false });
                if (!out_br.ok) {
                    return fail(
                        new CodeError(`current package branch name is not equal to the requested branch name. (dir='${dir}').`, ERROR_CODES.PKGMGR_ERROR),
                        options);
                }
                if (out_br.result !== pkgArgCommitInfo.hash) {
                    return fail(
                        new CodeError(`current package branch name is not equal to the requested branch name. (dir='${dir}').`, ERROR_CODES.PKGMGR_ERROR),
                        options);
                }
                const out_co = await git.checkout(
                    dir,
                    [privTagName],
                    { strict: false });
                if (!out_co.ok) {
                    return fail(
                        new CodeError(`current package branch name is not equal to the requested branch name. (dir='${dir}').`, ERROR_CODES.PKGMGR_ERROR),
                        options);
                }
                pkgDir.gitBranch = privTagName;
                continue;
            }
            if (out.result.hash !== pkgArgCommitInfo.hash) {
                // last chance, check immediate parent hash
                // if package was patched.
                const out2 = await gitApi.HEADFistParentHash(dir, { strict: false });
                if (!out2.ok) {
                    return fail(
                        new CodeError(out2.error.message, ERROR_CODES.PKGMGR_ERROR),
                        { strict: false });
                }
                if (out2.result !== pkgArgCommitInfo.hash) {
                    return fail(
                        new CodeError(`current package hash is not equal to the requested hash. (dir='${dir}').`, ERROR_CODES.PKGMGR_ERROR),
                        options);
                }
            }
            pkgDir.gitBranch = privTagName;
        }
    }

    return { ok: true };
}

/**
 * @param {?(string | types.Package)=} pkgDep1 
 * @param {?(string | types.Package)=} pkgDep2 
 */
export function packageDependencyEq(pkgDep1, pkgDep2) {
    if (pkgDep1 === pkgDep2) {
        return true;
    }
    if (!pkgDep1 && !pkgDep2) {
        return true;
    }
    if (!pkgDep1 || !pkgDep2) {
        return false;
    }
    const t1 = typeof pkgDep1;
    if (t1 === 'string') {
        return false;
    }
    const t2 = typeof pkgDep1;
    if (t2 === 'string') {
        return false;
    }
    if (t1 !== 'object' || t2 !== 'object') {
        return false;
    }

    // compiler
    /** @type {any} */
    const anypkgDep1 = pkgDep1;
    /** @type {any} */
    const anypkgDep2 = pkgDep2;

    const keys1 = Object.keys(anypkgDep1);
    const keys2 = Object.keys(anypkgDep2);
    if (keys1.length !== keys2.length) {
        return false;
    }
    for (let i = 0; i < keys1.length; ++i) {
        const v1 = anypkgDep1[keys1[i]];
        const v2 = anypkgDep2[keys1[i]];
        if (!v1) {
            if (v1 !== v2) {
                return false;
            }
            continue;
        }
        if (keys1[i] === 'dependencies') {
            if (!packageDependencyEq(v1, v2)) {
                return false;
            }
            continue;
        }
        if (keys1[i] === 'commitish') {
            if (!commitishEq(v1, v2)) {
                return false;
            }
            continue;
        }
        if (v1 !== v2) {
            return false;
        }
    }
    return true;
}

