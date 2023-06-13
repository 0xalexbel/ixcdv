import assert from 'assert';
import * as types from './types.js';
import * as ERROR_CODES from './error-codes.js';
import { CodeError, fail } from './error.js';
import { dirExists, errorDirDoesNotExist, fileExists, readFile, readFileLineByLineSync } from './fs.js';
import { childProcessSpawn } from './process.js';
import path from 'path';
import { isNullishOrEmptyString, removePrefix } from './string.js';

// Keep a cached value of the `./gradlew -q javaToolchains` call
/** @type {{value:Array<{name:string, properties:any}>}} */
const cacheJavaToolchains = { value: [] };

/**
 * @param {!string} dir 
 * @param {?Object.<string,string>} env 
 * @param {types.Strict=} strict
 * @returns {types.PromiseOkOrCodeError}
 */
export async function gradlewBuildNoTest(dir, env, strict) {
    return build(dir, ["-x", "test"], env, strict);
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
 * @param {?Object.<string,string>} env 
 * @param {types.Strict=} options
 * @returns {types.PromiseOkOrCodeError}
 */
async function build(dir, args, env, options) {
    return gradlewProgress(dir, ["build", ...args], env, options);
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
 * - Parse `<dir>/build.gradle` and look for `languageVersion.set(JavaLanguageVersion.of(<num>))`
 * - Not a good way to do that, should be rewritten
 * - Throws an exception if failed
 * @param {!string} dir 
 */
export async function autoDetectJDK(dir) {
    const buildDotGradle = path.join(dir, 'build.gradle');
    assert(fileExists(buildDotGradle));

    const s = await readFile(buildDotGradle, { strict: true });
    if (isNullishOrEmptyString(s)) {
        throw new CodeError(`Unable to read build.gradle file (${buildDotGradle})`);
    }
    assert(s);

    // SDK 11
    // Try to find the `languageVersion.set(JavaLanguageVersion.of(11/17))` line of
    // code inside the `build.gradle` file in order to guess the required SDK.
    // The method is quick and dirty and not reliable. 
    if (s.indexOf('languageVersion.set(JavaLanguageVersion.of(11))') >= 0) {
        const res = await queryJDK(11, dir, { strict: true });
        assert(res.ok);
        assert(dirExists(res.result));
        assert(fileExists(path.join(res.result, 'bin', 'java')));
        return res.result;
    }

    // SDK 17
    if (s.indexOf('languageVersion.set(JavaLanguageVersion.of(17))') >= 0) {
        const res = await queryJDK(17, dir, { strict: true });
        assert(res.ok);
        assert(dirExists(res.result));
        assert(fileExists(path.join(res.result, 'bin', 'java')));
        return res.result;
    }

    throw new CodeError(`Unable to auto detect JDK (${dir})`);
}

/**
 * @param {!number} version 
 * @param {!string} dir 
 * @param {types.Strict=} options
 * @returns {types.PromiseResultOrCodeError<string>}
 */
export async function queryJDK(version, dir, options) {
    const result = await queryJavaToolchains(dir, options);
    if (!result.ok) {
        return fail(result.error, options);
    }
    const javaToolchains = result.result;
    for (let i = 0; i < javaToolchains.length; ++i) {
        const properties = javaToolchains[i].properties;
        /** @type {any} Help compiler */
        const anyProps = properties;
        if (anyProps['languageversion'] === version.toString()) {
            const s = anyProps['location'];
            assert(typeof s === 'string');
            return { ok: true, result: s };
        }
    }

    return fail(new CodeError(`Unable to query JDK version ${version}`), options);
}

/**
 * @param {!string} dir 
 * @param {types.Strict=} options
 * @returns {types.PromiseResultOrCodeError<Array<{name:string, properties:Object<string,string>}>>}
 */
export async function queryJavaToolchains(dir, options) {
    // Keep a cache value, to speed-up a little bit
    if (cacheJavaToolchains.value.length > 0) {
        return { ok: true, result: cacheJavaToolchains.value };
    }

    // Executes
    // `./gradlew -q javaToolchains`
    const result = await gradlewGet(dir, ["-q", "javaToolchains"], {}, options);
    if (!result.ok) {
        return fail(result.error, options);
    }

    /*
    Output format:
    ==============

+ Options
     | Auto-detection:     Enabled
     | Auto-download:      Enabled

+ Eclipse Temurin JDK 11.0.19+7
     | Location:           /home/alex/.gradle/jdks/eclipse_adoptium-11-amd64-linux/jdk-11.0.19+7
     | Language Version:   11
     | Vendor:             Eclipse Temurin
     | Architecture:       amd64
     | Is JDK:             true
     | Detected by:        Auto-provisioned by Gradle

+ etc...
    */

    const lines = result.result.split('\n');
    const javaToolchains = [];
    for (let i = 0; i < lines.length; ++i) {
        const l = lines[i].trim();
        assert(l.length === 0 || l.startsWith('+ '));
        if (l.startsWith('+ ')) {
            const group = {
                name: '',
                /** @type {Object<string,string>} */
                properties: {}
            };
            javaToolchains.push(group);
            group.name = l.substring(2).trim();
            let j = i + 1;
            for (j = i + 1; j < lines.length; ++j) {
                const ll = lines[j].trim();
                if (ll.length === 0) {
                    continue;
                }
                // Enter new group:
                // Ex: `+ Eclipse Temurin JDK 11.0.19+7`
                if (ll.startsWith('+ ')) {
                    break;
                }
                // Read group property
                // Ex: `| Location:`
                const sep = ll.indexOf(':');
                if (sep < 0) {
                    continue;
                }
                const pname = ll.substring(0, sep).trim();
                const pvalue = ll.substring(sep + 1).trim();

                // - remove '|'
                // - turn to lower case
                // - remove white spaces
                const finalPName = removePrefix('|', pname)
                    .toLowerCase()
                    .replaceAll(' ', '');

                group.properties[finalPName] = pvalue;
            }
            if (j === lines.length) {
                break;
            }
            i = j - 1;
        }
    }

    // Save a cached value
    cacheJavaToolchains.value = javaToolchains;

    return { ok: true, result: cacheJavaToolchains.value };
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

    const result = await childProcessSpawn('./gradlew', args, opts);

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
