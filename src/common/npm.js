import path from 'path';
import { CodeError } from './error.js';
import { dirExists, fileExistsInDir, readObjectFromJSONFile } from './fs.js';
import { childProcessSpawn } from './process.js';
import * as types from './common-types.js';
import { isNullishOrEmptyString } from './string.js';

/**
 * @param {*} directory 
 */
export async function autoDetectNPMPackage(directory) {
    if (isNullishOrEmptyString(directory)) {
        return undefined;
    }
    if (!fileExistsInDir(directory, 'package.json')) {
        return undefined;
    }
    const pkg = await readObjectFromJSONFile(path.join(directory, 'package.json'));
    return pkg;
}

/**
 * Executes npm install
 * - `npm install ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {types.PromiseResultOrCodeError<string>}
 */
export async function install(dir, args, options) {
    return npmProgress(dir, ["install", ...args], null, options);
}

/**
 * Executes npm run
 * - `npm run ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {types.PromiseResultOrCodeError<string>}
 */
export async function run(dir, args, options) {
    return npmProgress(dir, ["run", ...args], null, options);
}

/**
 * Executes npm version
 * - `npm version ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {types.PromiseResultOrCodeError<string>}
 */
export async function version(dir, args, options) {
    return npmGet(dir, ["version", ...args], null, options);
}


/**
 * @param {!string} dir 
 * @param {!string[]} args 
 * @param {?Object.<string,string>} env 
 * @param {types.Strict=} options
 * @returns {types.PromiseResultOrCodeError<string>}
 */
async function npmGet(dir, args, env, options = { strict: true }) {
    if (!dirExists(dir)) {
        const err = new CodeError(`directory '${dir}' does not exist`);
        if (options?.strict) {
            throw err;
        }
        return { ok: false, error: err };
    }

    /** @type {any} */
    const opts = {
        mergeProcessEnv: true,
            stdout: {
            return: true
        },
        stderr: {
            return: true
        },
        spawnOptions: {
            cwd: dir
        }
    };
    if (env) {
        opts.spawnOptions.env = env;
    }

    const npmResult = await childProcessSpawn('npm', args, opts);

    if (npmResult.code === 0) {
        return { ok: true, result: (npmResult.stdout.out ?? '') }
    }

    const err = new CodeError((npmResult.stderr.out ?? ''));

    if (options?.strict) {
        throw err;
    }
    return { ok: false, error: err };
}

/**
 * @param {!string} dir 
 * @param {!string[]} args 
 * @param {?Object.<string,string>} env 
 * @param {types.Strict=} options
 * @returns {types.PromiseResultOrCodeError<string>}
 */
async function npmProgress(dir, args, env, options = { strict: true }) {
    if (!dirExists(dir)) {
        const err = new CodeError(`director ${dir} does not exist`);
        if (options?.strict) {
            throw err;
        }
        return { ok: false, error: err };
    }

    /** @type {any} */
    const opts = {
        mergeProcessEnv: true,
        stdout: {
            return: false,
            print: true
        },
        stderr: {
            return: false,
            print: true
        },
        spawnOptions: {
            cwd: dir
        }
    };

    if (env) {
        opts.spawnOptions.env = env;
    }

    const npmResult = await childProcessSpawn('npm', args, opts);

    if (npmResult.code === 0) {
        return { ok: true, result: '' }
    }

    const err = new CodeError((npmResult.stderr.out ?? ''));

    if (options?.strict) {
        throw err;
    }
    return { ok: false, error: err };
}
