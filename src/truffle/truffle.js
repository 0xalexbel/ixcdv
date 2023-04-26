import * as types from '../common/common-types.js';
import { truffleGet, truffleProgress } from './truffle-process.js';

/**
 * Executes truffle compile
 * - `truffle compile ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {?Object.<string,string>} env 
 * @param {types.Strict=} options
 * @returns {types.PromiseOkOrCodeError}
 */
export async function compile(dir, args, env, options) {
    return truffleProgress(dir, ["compile", ...args], env, options);
}

/**
 * Executes truffle migrate
 * - `truffle migrate ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {?Object.<string,string>} env 
 * @param {types.Strict=} options
 * @returns {types.PromiseOkOrCodeError}
 */
export async function migrate(dir, args, env, options) {
    return truffleProgress(dir, ["migrate", ...args], env, options);
}

/**
 * Executes truffle networks
 * - `truffle networks ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {?Object.<string,string>} env 
 * @param {types.Strict=} options
 * @returns {types.PromiseResultOrCodeError<string>}
 */
export async function networks(dir, args, env, options) {
    return truffleGet(dir, ["networks", ...args], env, options);
}

