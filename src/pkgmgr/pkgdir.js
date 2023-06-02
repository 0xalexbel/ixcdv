import * as path from 'path';
import * as types from '../common/common-types.js';
import * as pkgTypes from '../pkgmgr/pkgmgr-types.js';
import * as gitTypes from '../git/git-types.js';
import * as gitApi from '../git/git-api.js';
import * as git from '../git/git.js';
import assert from 'assert';
import { alreadyCloning, clone, cloneFailed, setAlreadyCloned } from './clone.js';
import { commitishEq, validCommitish } from './commitish.js';
import { packageDependencyEq } from './pkg.js';
import { isNullishOrEmptyString, placeholdersReplace } from '../common/string.js';
import { CodeError } from '../common/error.js';
import { dirExists, parsePathnameOrUrl, resolveAbsolutePath } from '../common/fs.js';
import { guessRepositoryFromSibling } from '../git/git-api.js';
import { parseGradleDotProperties } from '../common/iexec/spring.js';
import { typeEquals } from '../common/utils.js';

/**
 * @param {pkgTypes.PkgDir} pkgDir
 * @param {pkgTypes.Setup} setup 
 */
export async function installPkgDir(pkgDir, setup) {
    await installPkgDirCore(pkgDir, setup);
}

/**
 * @param {types.Package} mainPkgArg
 * @param {string=} defaultDirectoryDirname
 * @returns {pkgTypes.Setup}
 */
export function initSetup(mainPkgArg, defaultDirectoryDirname) {
    if (isNullishOrEmptyString(mainPkgArg.directory)) {
        throw new CodeError(`Missing package directory`);
    }
    if (isNullishOrEmptyString(mainPkgArg.gitHubRepoName)) {
        throw new CodeError(`Missing package git hub repo name`);
    }

    const mainPkgArgDir = resolveAbsolutePath(mainPkgArg.directory, { onlyPOSIXPortable: false });
    const mainDirBasename = path.basename(mainPkgArgDir);
    const mainDirDirname = path.dirname(mainPkgArgDir);

    if (mainDirBasename === 'libs') {
        throw new CodeError(`'libs' is a reserved basename (package.directory = '${mainPkgArg.directory}')`);
    }

    /** @type {pkgTypes.Setup} */
    const setup = {
        mainDir: mainPkgArg.directory,
        defaultDirectoryDirname: defaultDirectoryDirname ?? mainDirDirname,
        directories: {}
    };

    if (!mainPkgArg.clone) {
        mainPkgArg.clone = 'ifmissing';
    }
    if (!mainPkgArg.cloneRepo) {
        mainPkgArg.cloneRepo = "https://github.com/iExecBlockchainComputing/" + mainPkgArg.gitHubRepoName + ".git";
    }
    if (!mainPkgArg.commitish) {
        mainPkgArg.commitish = 'latest';
    }
    if (isNullishOrEmptyString(mainPkgArg.commitish)) {
        throw new CodeError(`Missing package commitish`);
    }

    mainPkgArg.patch ??= false;

    initPkgDir(mainPkgArg, setup, false);

    // save resolved dirs (placeholders)
    setup.mainDir = mainPkgArg.directory;
    //keep placeholders : setup.defaultDirectoryDirname = path.dirname(mainPkgArg.directory);

    return setup;
}

/**
 * - Called recursively
 * @param {types.Package} pkgArg 
 * @param {pkgTypes.Setup} setup 
 * @param {boolean} register
 */
function initPkgDir(pkgArg, setup, register) {
    assert(pkgArg.clone);
    /** @type {pkgTypes.PkgDir} */
    const pkgDir = {
        pkgArg: pkgArg
    }

    const pathOrUrl = parsePathnameOrUrl(pkgArg.cloneRepo);
    const pkgCloneRepo = (pathOrUrl?.url ?? pathOrUrl?.directory);
    assert(pkgCloneRepo);

    // Determine github repo name
    if (!pkgArg.gitHubRepoName) {
        if (!pathOrUrl?.url) {
            throw new CodeError(`Missing GitHub repo name`);
        }
        const url = pathOrUrl.url;
        if (url.hostname !== 'github.com') {
            throw new CodeError(`Missing GitHub repo name`);
        }
        const parsedPath = path.parse(url.pathname);
        pkgArg.gitHubRepoName = parsedPath.name;
    }

    if (pathOrUrl?.url) {
        const url = pathOrUrl.url;
        if (url.hostname === 'github.com') {
            const parsedPath = path.parse(url.pathname);
            if (parsedPath.name !== pkgArg.gitHubRepoName) {
                throw new CodeError(`Inconsistent GitHub repo name. url='${url.toString()}, GitHub repo name='${pkgArg.gitHubRepoName}'`);
            }
        }
    }

    if (pkgArg.commitish) {
        if (!validCommitish(pkgArg.commitish)) {
            throw new CodeError(`Invalid package commitish (='${pkgArg.commitish}'), expecting Date or semver.`);
        }
    }

    assert(pkgArg.commitish);
    assert(pkgArg.gitHubRepoName);

    // Must be absolute
    if (!path.isAbsolute(pkgArg.directory)) {
        throw new CodeError(`Invalid package directory (='${pkgArg.directory}'), expecting absolute path.`);
    }

    // Resolve placeholders
    pkgArg.directory = placeholdersReplace(pkgArg.directory,
        {
            '${version}': pkgArg.commitish?.toString(),
            '${repoName}': pkgArg.gitHubRepoName
        });

    // Make sure resolved directory is POSIX portable
    pkgArg.directory = resolveAbsolutePath(pkgArg.directory);

    // If directory is already listed, make sure it is compatible
    if (setup.directories[pkgArg.directory]) {
        const existingPkgDir = setup.directories[pkgArg.directory];
        checkPkgDirConflict(existingPkgDir, pkgDir);
        return;
    }

    if (register) {
        setup.directories[pkgArg.directory] = pkgDir;
    }

    if (!pkgArg.dependencies) {
        return;
    }

    const deps = Object.keys(pkgArg.dependencies);
    for (let i = 0; i < deps.length; ++i) {
        const depGitHubRepoName = deps[i];
        const depPkgOrDir = pkgArg.dependencies[depGitHubRepoName];
        if (!depPkgOrDir) {
            continue;
        }
        /** @type {types.Package} */
        let depPkgArg;
        if (typeof depPkgOrDir === 'string') {
            const depDir = depPkgOrDir;
            depPkgArg = {
                directory: depDir,
                gitHubRepoName: depGitHubRepoName,
                clone: 'never',
                patch: false
            }
            if (isNullishOrEmptyString(depPkgArg.directory)) {
                throw new CodeError(`Synthax error, missing repo directory`);
            }
        } else {
            depPkgArg = depPkgOrDir;
            if (isNullishOrEmptyString(depPkgArg.directory)) {
                throw new CodeError(`Synthax error, missing repo directory`);
            }
            if (!depPkgArg.gitHubRepoName) {
                depPkgArg.gitHubRepoName = depGitHubRepoName;
            } else if (depPkgArg.gitHubRepoName !== depGitHubRepoName) {
                throw new CodeError(`Synthax error, inconsistent GitHub repo names '${depGitHubRepoName}' !== '${depPkgArg.gitHubRepoName}'`);
            }
            if (!depPkgArg.clone) {
                depPkgArg.clone = 'ifmissing';
            }

            depPkgArg.patch ??= false;
        }
        assert(depPkgArg.clone);
        if (!depPkgArg.cloneRepo) {
            depPkgArg.cloneRepo = guessRepositoryFromSibling(depGitHubRepoName, pkgCloneRepo).toString();
        }
        initPkgDir(depPkgArg, setup, true);
    }
}

/**
 * @param {pkgTypes.PkgDir} pkgDir
 * @param {pkgTypes.Setup} setup 
 */
async function installPkgDirCore(pkgDir, setup) {

    // 3 Steps algorithm
    // =================
    // STEP 1 : clone repo if it does not exist
    // STEP 2 : compute data using the cloned repo
    // STEP 3 : compute dependencies
    // -----> : recursive call on each dependency

    assert(pkgDir.pkgArg);

    // if commitishArg == null
    // - the repository is undefined. The user keeps the whole responsibility.
    // if commitishArg != null
    // - it must be either a Date or a version
    const commitishArg = pkgDir.pkgArg.commitish;
    // Always defined. Non-empty valid path
    const dirArg = pkgDir.pkgArg.directory;
    // Always defined. either 'ifmissing' or 'never'
    const cloneArg = pkgDir.pkgArg.clone;
    const cloneRepoArg = pkgDir.pkgArg.cloneRepo;
    // set to empty string if null or undefined
    const branchArg = pkgDir.pkgArg.branch ?? '';
    // Always defined.
    const gitHubRepoNameArg = pkgDir.pkgArg.gitHubRepoName;
    // Always defined. either 'true' or 'false'
    const patchArg = pkgDir.pkgArg.patch;

    assert(!commitishArg || validCommitish(commitishArg));
    assert(!isNullishOrEmptyString(dirArg));
    assert(cloneArg);
    assert(cloneRepoArg);
    assert(gitHubRepoNameArg);
    assert(pkgDir.pkgArg.dependencies !== null);
    assert(patchArg !== null && patchArg !== undefined);

    /* --------------------------------------------------------------------- */
    /*                                                                       */
    /*                         STEP 1 : Clone repo                           */
    /*                         ===================                           */
    /*                                                                       */
    /* --------------------------------------------------------------------- */

    /* ----------------------- Is Cloning underway ? ----------------------- */
    // Obviously, if repositories are being cloned, we can't go any further
    // Some other pkg install has already launched the out install. 
    // Also, if some previous attemps to clone our pkg failed, no need to 
    // pursue.
    /* --------------------------------------------------------------------- */

    if (alreadyCloning(dirArg, setup)) {
        return;
    }
    if (cloneFailed(dirArg, setup)) {
        return;
    }

    /* ----------------------- Is PkgDir registered ? ---------------------- */
    // If the pkgDir is not yet registered, register it.
    // If it is already registered by some other pkg install, make sure
    // the 2 pkg installs are asking for the same pkg settings.
    /* --------------------------------------------------------------------- */

    if (!setup.directories[dirArg]) {
        setup.directories[dirArg] = pkgDir;
    } else {
        // check compatibility
        const existingPkgDir = setup.directories[dirArg];
        if (existingPkgDir !== pkgDir) {
            if (!existingPkgDir.pkgArg.clone) {
                if (pkgDir.pkgArg.clone) {
                    existingPkgDir.pkgArg.clone = pkgDir.pkgArg.clone;
                }
            }
            if (!existingPkgDir.pkgArg.dependencies) {
                if (pkgDir.pkgArg.dependencies) {
                    existingPkgDir.pkgArg.dependencies = pkgDir.pkgArg.dependencies;
                }
            } else {
                if (pkgDir.pkgArg.dependencies) {
                    const deps = pkgDir.pkgArg.dependencies;
                    const existingDeps = existingPkgDir.pkgArg.dependencies;
                    const depNames = Object.keys(deps);
                    for (let i = 0; i < depNames.length; ++i) {
                        const name = depNames[i];
                        if (!existingDeps[name]) {
                            existingDeps[name] = deps[name];
                            continue;
                        }
                        assert(packageDependencyEq(existingDeps[name], deps[name]));
                    }
                }
            }
            checkPkgDirConflict(existingPkgDir, pkgDir);
            pkgDir = existingPkgDir;
        }
    }

    /* ----------------------- Is Clone Needed ? --------------------------- */
    // Determine if the repository refered to by the 'pkgDir' must be cloned, 
    // - If clone == 'never', skips 'git clone' 
    // - If clone == 'ifmissing', 
    //   - if directory does not exist then perform a 'git clone'
    //   - if directory already exist do nothing
    /* --------------------------------------------------------------------- */

    let cloneDir = dirArg;
    let mustClone = false;

    if (!dirExists(dirArg)) {
        if (cloneArg === 'never') {
            return;
        }
        mustClone = true;
    } else {
        setAlreadyCloned(dirArg, setup);
    }

    /* ---------------------------- git clone ------------------------------ */
    // Ready to execute the 'git clone' command
    /* --------------------------------------------------------------------- */

    if (mustClone) {
        // Throws an error if failed
        // `git clone <cloneRepoArg> <cloneDir> [--branch <branchArg>]`
        await clone(gitHubRepoNameArg, cloneRepoArg, cloneDir, branchArg, setup);
    }

    assert(dirExists(cloneDir));
    const assert_git = await gitApi.showTopLevel(cloneDir, { strict: false });
    // Happens when a previous clone failed.
    // Rm directory and re-install.
    assert(assert_git.ok, `git rev-parse --show-toplevel (dir=${cloneDir}) FAILED`);

    /* --------------------------------------------------------------------- */
    /*                                                                       */
    /*                       STEP 2 : Compute data                           */
    /*                       =====================                           */
    /*   At this stage :                                                     */
    /*       - the repository is cloned.                                     */
    /*       - the repository exists locally.                                */
    /*       - we can go further and solve pkg hash & date                   */
    /* --------------------------------------------------------------------- */

    // If, no 'commit' info has been specified, we cannot compute any
    // data on the cloned git repository. (there is no starting point)
    if (!commitishArg) {
        return;
    }

    /* ---------------------- Solve pkg hash & date ------------------------ */
    // Given the pkgDir 'commitish' info, try to determine the corresponding
    // git hash as well as its date. This is required to later determine 
    // any package dependency hash & date.
    // Warning: 'commitish' must always be defined at this stage.
    /* --------------------------------------------------------------------- */

    if (!pkgDir.pkgArgCommitInfo) {
        let out = await gitApi.resolveCommitish(
            cloneDir,
            branchArg,
            commitishArg,
            { strict: true });

        assert(out.ok);
        assert(out.result);

        pkgDir.pkgArgCommitInfo = out.result;
    }
    const commitInfo = pkgDir.pkgArgCommitInfo;

    /* ------------------ Are there any dependencies ? --------------------- */
    // Only spring java apps rely on separated dependencies.
    // Check the presence of 'gradle.properties' file in order to determine.
    // Do do so, we must first retrieve the requested version of 'gradle.properties'
    // using the git hash value calculated earlier.
    /* --------------------------------------------------------------------- */

    if (!pkgDir.pkgArgGradleVersions) {
        const out_show = await git.show(
            cloneDir,
            [commitInfo.hash + ":" + 'gradle.properties'],
            { strict: false });

        if (!out_show.ok) {
            // There is no 'gradle.properties' file
            // at the requested git hash value.
            // We will not identify any dependency.
            return
        }
        assert(out_show.result);

        const gradleVers = parseGradleDotProperties(
            gitHubRepoNameArg,
            out_show.result,
            { strict: false });

        /* ------------- Parse the requested 'gradle.properties' --------------- */
        // Parse 'gradle.properties' at the desired git commit hash value
        // in order to determine the list of dependencies and their respective
        // required versions
        /* --------------------------------------------------------------------- */

        if (!gradleVers) {
            throw new CodeError(`Failed to parse file 'gradle.properties' (dir=${dirArg})`);
        }

        // store it in 'pkgArgGradleVersions' as it is the 'requested' data
        // not the current data.
        pkgDir.pkgArgGradleVersions = gradleVers;
    }

    const gradleVersions = pkgDir.pkgArgGradleVersions;

    /* --------------------------------------------------------------------- */
    /*                                                                       */
    /*                   STEP 3 : Compute dependencies                       */
    /*                   =============================                       */
    /*                                                                       */
    /* --------------------------------------------------------------------- */

    const depPkgDirs = [];
    const deps = Object.keys(gradleVersions.dependencies);

    /* ----------- Compute each dependency's requested settings ------------ */
    // For each dependency, compute :
    // - the requested install directory
    // - the requested clone settings
    // - etc.
    /* --------------------------------------------------------------------- */

    for (let i = 0; i < deps.length; ++i) {
        const depGitHubRepo = deps[i];

        // Build depDir for each dependency
        let depDir;
        /** @type {'ifmissing' | 'never'} */
        let depClone;
        /** @type {string | null | undefined} */
        let depCommitish;
        /** @type {string | null | undefined} */
        let depBranch;
        /** @type {gitTypes.GitCommitInfo=} */
        let depCommitInfo;
        /** @type {pkgTypes.PkgDir=} */
        let depPkgDir;
        /** @type {boolean} */
        let depPatch;

        // Look if the gradle dependency was specified in the package arguments
        // check in 'pkgArg' to determine the dependency's directory
        const depDirOrPkg = pkgDir.pkgArg.dependencies?.[depGitHubRepo];
        if (depDirOrPkg) {
            if (typeof depDirOrPkg === 'string') {
                depDir = depDirOrPkg;
                depClone = 'never';
                depPatch = false;
                depBranch = undefined;
            } else {
                depDir = depDirOrPkg.directory;
                depClone = depDirOrPkg.clone ?? 'ifmissing';
                depCommitish = depDirOrPkg.commitish;
                depPatch = depDirOrPkg.patch ?? false;
                depBranch = depDirOrPkg.branch;
            }
            assert(!isNullishOrEmptyString(depDir));
            assert(depClone);
        } else {
            // Compute dependency's directory
            // the gradle dependency is not listed in the package arguments.
            // We must compute the install directory.

            // inherit clone setting
            depClone = cloneArg;
            // inherit patch setting
            depPatch = patchArg;
            // undefined branch
            depBranch = undefined;

            /** @type {Object.<string,string>} */
            const depsDict = gradleVersions.dependencies;

            /** @type {string} */
            const depVersion = depsDict[depGitHubRepo];
            assert(depVersion);

            if (depVersion.endsWith('-NEXT-SNAPSHOT')) {
                depCommitish = commitishArg;
                assert(depCommitish === 'latest');
                depDir = computeDepDir(setup.defaultDirectoryDirname, depGitHubRepo, 'latest');
            } else {
                depDir = computeDepDir(setup.defaultDirectoryDirname, depGitHubRepo, depVersion);
                depCommitish = depVersion;
            }
            assert(depDir);
            assert(depCommitish);
            assert(depClone);

            const existingDepPkgDir = findPkgDir(
                depGitHubRepo,
                depCommitish,
                computeDepDir(setup.defaultDirectoryDirname, depGitHubRepo, depVersion),
                setup);

            if (existingDepPkgDir) {
                if (!existingDepPkgDir.pkgArg.clone) {
                    existingDepPkgDir.pkgArg.clone = depClone;
                }
                existingDepPkgDir.pkgArg.patch ??= depPatch;

                depPkgDir = existingDepPkgDir;
                depClone = existingDepPkgDir.pkgArg.clone;
                depPatch = existingDepPkgDir.pkgArg.patch;
                depDir = existingDepPkgDir.pkgArg.directory;
            }
        }

        if (!depPkgDir) {
            const depCloneRepo = guessRepositoryFromSibling(depGitHubRepo, cloneRepoArg).toString();
            assert(depCloneRepo);
            assert(depPatch != null);

            depPkgDir = {
                pkgArg: {
                    directory: depDir,
                    commitish: depCommitish,
                    branch: depBranch,
                    clone: depClone,
                    cloneRepo: depCloneRepo,
                    gitHubRepoName: depGitHubRepo,
                    patch: depPatch
                }
            };

            if (depCommitInfo) {
                depPkgDir.pkgArgCommitInfo = depCommitInfo;
            }

            const existingDepPkgDir = setup.directories[depDir];
            if (existingDepPkgDir) {
                assert(existingDepPkgDir.pkgArg);
                if (depPkgDir.pkgArgCommitInfo) {
                    assert(existingDepPkgDir.pkgArgCommitInfo);
                    assert(depPkgDir.pkgArgCommitInfo.hash === existingDepPkgDir.pkgArgCommitInfo.hash);
                }
                checkPkgDirConflict(existingDepPkgDir, depPkgDir);
            }
        }

        depPkgDirs.push(depPkgDir);

        if (!pkgDir.gradleDependencies) {
            pkgDir.gradleDependencies = {};
        }
        pkgDir.gradleDependencies[depGitHubRepo] = depPkgDir.pkgArg.directory;
    }

    const promises = [];
    for (let i = 0; i < depPkgDirs.length; ++i) {
        const p = installPkgDirCore(depPkgDirs[i], setup);
        promises.push(p);
    }
    await Promise.all(promises);
}

/**
 * @param {!string} dirname 
 * @param {!string} gitHubRepoName 
 * @param {!string} version 
 * @param {string=} suffix 
 */
function computeDepDir(dirname, gitHubRepoName, version, suffix) {
    if (version !== 'latest') {
        version = 'v' + version;
    }

    dirname = placeholdersReplace(dirname,
        {
            '${version}': version,
            '${repoName}': gitHubRepoName
        });

    if (suffix) {
        return path.join(dirname, gitHubRepoName + '_' + suffix);
    } else {
        return path.join(dirname, gitHubRepoName);
    }
}

/**
 * @param {!string} gitHubRepoName 
 * @param {!(string | Date)} commitish 
 * @param {!string} dirnameStartsWith 
 * @param {!pkgTypes.Setup} setup 
 */
function findPkgDir(gitHubRepoName, commitish, dirnameStartsWith, setup) {
    const dirs = Object.keys(setup.directories);
    for (let i = 0; i < dirs.length; ++i) {
        const dir = dirs[i];
        const pkgDir = setup.directories[dir];
        if (pkgDir.pkgArg.gitHubRepoName !== gitHubRepoName) {
            continue;
        }

        //Special case for 'latest'
        if (commitish === 'latest') {
            if (dir === dirnameStartsWith) {
                return pkgDir;
            }
            continue;
        }

        if (!dir.startsWith(dirnameStartsWith)) {
            continue;
        }
        if (commitishEq(commitish, pkgDir.pkgArg.commitish)) {
            return pkgDir;
        }
    }
    return null;
}

// /**
//  * @param {types.Setup} setup 
//  */
// function renamePkgDirs(setup) {
//     const dirs = Object.keys(setup.directories);
//     for (let i = 0; i < dirs.length; ++i) {
//         const d = dirs[i];
//         const pkgDir = setup.directories[d];
//         // TODO change 'indexOf' arg
//         if (d.indexOf('-NEXT-SNAPSHOT/before-') >= 0) {
//             assert(pkgDir.pkgArgCommitInfo);
//             const dirname = pkgDir.pkgArgCommitInfo.date.toISOString().replaceAll(':', '_');
//             pkgDir.pkgArg.directory = path.join(path.dirname(d), dirname);
//             if (setup.directories[pkgDir.pkgArg.directory]) {
//                 const _pkgDir = setup.directories[pkgDir.pkgArg.directory];
//                 assert(_pkgDir.pkgArgCommitInfo?.hash === pkgDir.pkgArgCommitInfo.hash);
//                 continue;
//             }
//             setup.directories[pkgDir.pkgArg.directory] = pkgDir;
//             setup.directories[d] = { pkgArg: { directory: "" } };
//             delete setup.directories[d];
//         }
//     }
// }

// /**
//  * @param {types.Setup} setup 
//  */
// function copyMissingPkgDirs(setup) {
//     const dirs = Object.keys(setup.directories);
//     const promises = [];
//     for (let i = 0; i < dirs.length; ++i) {
//         const d = dirs[i];
//         const pkgDir = setup.directories[d];
//         if (dirExists(d)) {
//             continue;
//         }
//         if (pkgDir.pkgArg.clone !== 'ifmissing') {
//             continue;
//         }
//         const gitHubRepoName = pkgDir.pkgArg.gitHubRepoName;
//     }
// }

/**
 * @param {pkgTypes.PkgDir?} pkgDir1 
 * @param {pkgTypes.PkgDir?} pkgDir2 
 */
function checkPkgDirConflict(pkgDir1, pkgDir2) {
    if (pkgDir1 === pkgDir2) {
        return;
    }
    if (!typeEquals(pkgDir1, pkgDir2)) {
        throw new CodeError(`Package conflict`);
    }

    assert(pkgDir1);
    assert(pkgDir2);

    const keys = [
        "dir",
        "clone",
    ];

    // compiler
    /** @type {any} */
    const anypkgDir1 = pkgDir1;
    /** @type {any} */
    const anypkgDir2 = pkgDir2;

    for (let i = 0; i < keys.length; ++i) {
        if (anypkgDir1[keys[i]] !== anypkgDir2[keys[i]]) {
            throw new CodeError(`Package property conflict: property='${keys[i]}' ('${anypkgDir1[keys[i]]}' != '${anypkgDir2[keys[i]]}')`);
        }
    }
    checkPkgConflict(pkgDir1.pkgArg ?? null, pkgDir2.pkgArg ?? null);
}

/**
 * @param {types.Package?} pkg1 
 * @param {types.Package?} pkg2 
 */
function checkPkgConflict(pkg1, pkg2) {
    if (pkg1 === pkg2) {
        return;
    }
    if (!typeEquals(pkg1, pkg2)) {
        throw new CodeError(`Package property conflict`);
    }

    assert(pkg1);
    assert(pkg2);

    const keys = [
        "directory",
        "clone",
        "cloneRepo",
        "gitHubRepoName"
    ];

    if (pkg1.commitish && pkg2.commitish) {
        if (!commitishEq(pkg1.commitish, pkg2.commitish)) {
            throw new CodeError(`Package property conflict: property='commitish' ('${pkg1.commitish}' != '${pkg2.commitish}')`);
        }
    }

    /** @type {any} */
    const anypkg1 = pkg1;
    /** @type {any} */
    const anypkg2 = pkg2;
    for (let i = 0; i < keys.length; ++i) {
        if (anypkg1[keys[i]] !== anypkg2[keys[i]]) {
            throw new CodeError(`Package property conflict: property='${keys[i]}' ('${anypkg1[keys[i]]}' != '${anypkg2[keys[i]]}')`);
        }
    }

    if (pkg1.dependencies === pkg2.dependencies) {
        return;
    }
    if (!pkg1.dependencies || !pkg2.dependencies) {
        return;
    }
    if (!typeEquals(pkg1.dependencies, pkg2.dependencies)) {
        throw new CodeError(`Package property conflict`);
    }

    assert(pkg1.dependencies);
    assert(pkg2.dependencies);

    const deps1 = Object.keys(pkg1.dependencies);
    const deps2 = Object.keys(pkg2.dependencies);
    if (deps1.length !== deps2.length) {
        throw new CodeError(`Package property conflict: property='dependencies.length' ('${deps1.length}' != '${deps2.length}')`);
    }
    for (let i = 0; i < deps1.length; ++i) {
        const d1 = deps1[i];
        const p1 = pkg1.dependencies[d1];
        const p2 = pkg2.dependencies[d1];

        if (p1 === p2) {
            continue;
        }
        if (!typeEquals(p1, p2)) {
            throw new CodeError(`Package property conflict at dependency[${d1}]`);
        }

        assert(p1);
        assert(p2);

        if (typeof p1 === 'string') {
            throw new CodeError(`Package dependency conflict (dependency='${d1}')`);
        }

        assert(typeof p1 === 'object');
        assert(typeof p2 === 'object');
        checkPkgConflict(p1, p2);
    }
}
