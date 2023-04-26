import * as types from '../common/common-types.js';
import * as gitTypes from '../git/git-types.js';

/**
  @typedef Setup
  @type {object}
    @property {!string} mainDir
    @property {!string} defaultDirectoryDirname
    @property {!Object<string, PkgDir>} directories
*/

/**
  @typedef PkgDir
  @type {object}
    @property {!types.Package} pkgArg
    @property {!('cloning' | 'cloned' | 'failed')=} gitCloneStatus
    @property {!boolean=} alreadyCloned
    @property {!string=} gitBranch
    @property {!Error=} gitCloneError
    @property {?gitTypes.GitCommitInfo=} pkgArgCommitInfo
    @property {?types.iExecRepoVersions=} pkgArgGradleVersions
    @property {!Object<string, string>=} gradleDependencies
*/

/**
  @typedef CachePkgDir
  @type {object}
    @property {!('cloning' | 'cloned' | 'failed')=} gitCloneStatus
    @property {!boolean=} alreadyCloned
    @property {!Error=} gitCloneError
    @property {!string} directory
*/
