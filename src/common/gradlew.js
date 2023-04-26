import * as types from './types.js';
import * as ERROR_CODES from './error-codes.js';
import { CodeError, fail } from './error.js';
import { dirExists, errorDirDoesNotExist, fileExists, readFileLineByLineSync } from './fs.js';
import { childProcessSpawn } from './process.js';
import path from 'path';

/**
 * @param {!string} dir 
 * @param {types.Strict=} strict
 * @returns {types.PromiseOkOrCodeError}
 */
export async function gradlewBuildNoTest(dir, strict) {
    return build(dir, ["-x", "test"], strict);
}

/**
 * @param {!string} dir 
 * @param {types.Strict=} strict
 * @returns {types.PromiseOkOrCodeError}
 */
export async function gradlewClean(dir, strict) {
    return clean(dir, [], strict);
}

/**
 * - `gradlew build ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {types.PromiseOkOrCodeError}
 */
async function build(dir, args, options) {
    return gradlewProgress(dir, ["build", ...args], {}, options);
}

/**
 * - `gradlew clean ...args`
 * @param {!string} dir 
 * @param {!string[]} args
 * @param {types.Strict=} options
 * @returns {types.PromiseOkOrCodeError}
 */
async function clean(dir, args, options) {
    return gradlewProgress(dir, ["clean", ...args], {}, options);
}

/**
 * @param {!string} dir 
 * @param {!string[]} args 
 * @param {?Object.<string,string>} env 
 * @param {types.Strict=} options
 * @returns {types.PromiseOkOrCodeError}
 */
async function gradlewProgress(dir, args, env, options = { strict: true }) {
    if (!dirExists(dir)) {
        return fail(errorDirDoesNotExist(dir), options);
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

    const result = await childProcessSpawn('./gradlew', args, opts);

    if (result.code === 0) {
        return { ok: true }
    }

    return fail(
        new CodeError((result.stderr.out ?? ''), ERROR_CODES.GRADLEW_ERROR), 
        options);
}

/**
 * @param {!string} dir 
 * @param {!string[]} args 
 * @param {?Object.<string,string>} env 
 * @param {types.Strict=} options
 * @returns {types.PromiseResultOrCodeError<string>}
 */
async function gradlewGet(dir, args, env, options = { strict: true }) {
    if (!dirExists(dir)) {
        return fail(errorDirDoesNotExist(dir), options);
    }

    /** @type {any} */
    const opts = {
        mergeProcessEnv: true,
            stdout: {
            trim: false,
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

    const result = await childProcessSpawn('gradlew', args, opts);

    if (result.code === 0) {
        return { ok: true, result: result.stdout.out ?? '' }
    }

    const err = new CodeError((result.stderr.out ?? ''), ERROR_CODES.GRADLEW_ERROR);

    if (options?.strict) {
        throw err;
    }
    return { ok: false, error: err };
}

/**
 * @param {string} gradleWrapperDir 
 */
export function getGradleWrapperVersion(gradleWrapperDir) {
    const gradleWrapperProperties = path.join(gradleWrapperDir, 'gradle-wrapper.properties');
    if (fileExists(gradleWrapperProperties)) {
        const prefix = `distributionUrl=https\\://services.gradle.org/distributions/gradle-`;
        const lines = readFileLineByLineSync(gradleWrapperProperties, { strict: false });
        if (!lines) {
            return null;
        }
        for (let i = 0; i < lines.length; ++i) {
            if (lines[i].startsWith(prefix)) {
                const elements = lines[i].substring(prefix.length).split('-');
                return elements[0];
            }
        }
    }
    return null;
}
