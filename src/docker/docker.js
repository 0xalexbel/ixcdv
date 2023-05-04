// Dependencies
// ../common
import * as types from '../common/common-types.js';
import { dockerProgress, dockerGet } from './docker-internal.js'

/**
 * - `docker push ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 */
export async function push(dir, args, options) {
    return dockerProgress(dir, ["push", ...args], {}, options);
}

/**
 * - `docker pull ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 */
export async function pull(dir, args, options) {
    return dockerProgress(dir, ["pull", ...args], {}, options);
}

/**
 * - `docker run ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 */
export async function run(dir, args, options) {
    return dockerProgress(dir, ["run", ...args], {}, options);
}

/**
 * - `docker start ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 */
export async function start(dir, args, options) {
    return dockerProgress(dir, ["start", ...args], {}, options);
}

/**
 * - `docker image ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 */
export async function image(dir, args, options) {
    return dockerGet(dir, ["image", ...args], options);
}

