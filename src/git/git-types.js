import * as types from '../common/common-types.js';
import { SemVer } from "semver";

/**
 * @template T
 * @typedef {types.PromiseResultOrError<T,import('./git-error.js').GitError>} PromiseResultOrGitError<T>
 */

/**
 * @template T
 * @typedef {types.ResultOrError<T,import('./git-error.js').GitError>} ResultOrGitError<T>
 */

/**
 * @typedef {{ createDir?:boolean }} GitInitOptions
 * @typedef {types.StrictOptions<GitInitOptions>} StrictGitInitOptions
 * @typedef {PromiseResultOrGitError<string>} PromiseStringResultOrGitError
 */

/** 
 * @typedef GitCloneSafeOptions 
 * @type {types.Strict & {createDir:boolean}} 
 */

/**
 * @typedef GitLsRemoteOptions
 * @type {object}
 * @property {boolean=} refs
 * @property {boolean=} heads
 * @property {boolean=} tags
 * @property {?string[]=} patterns
 */

/**
  @typedef GitCommitInfo
  @type {object}
  @property {!string} hash
  @property {!Date} date
  @property {!string=} ref
  @property {!SemVer=} semver
 */

/** @typedef {types.StrictOptions<GitLsRemoteOptions>} StrictGitLsRemoteOptions */


