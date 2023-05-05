// Dependencies
// ../common
import * as types from '../common/common-types.js';
import { ipfsGet } from './ipfs-process.js';

/**
 * Executes ipfs init
 * - `ipfs init ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {?Object.<string,string>} env 
 * @param {types.Strict=} options
 * @returns {types.PromiseOkOrCodeError}
 */
export async function init(dir, args, env, options) {
    return ipfsGet(dir, ["init", ...args], env, options);
}

/**
 * Executes ipfs bootstrap
 * - `ipfs bootstrap ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {?Object.<string,string>} env 
 * @param {types.Strict=} options
 * @returns {types.PromiseOkOrCodeError}
 */
export async function bootstrap(dir, args, env, options) {
    return ipfsGet(dir, ["bootstrap", ...args], env, options);
}

/**
 * Executes ipfs add
 * - `ipfs add ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {?Object.<string,string>} env 
 * @param {types.Strict=} options
 * @returns {types.PromiseResultOrCodeError<string>}
 */
export async function add(dir, args, env, options) {
    return ipfsGet(dir, ["add", ...args], env, options);
}
