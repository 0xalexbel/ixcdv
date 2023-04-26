import * as ERROR_CODES from "../common/error-codes.js";
import assert from 'assert';
import * as yaml from 'js-yaml';
import * as pathlib from 'path';
import { CodeError } from '../common/error.js';
import { readFile, saveToFile, shasum256 } from '../common/fs.js';
import { isNullishOrEmptyString, stringIsPositiveInteger, stringToPositiveInteger } from '../common/string.js';


/** @param {string | null | undefined} springConfigLocation */
export async function computeApplicationYmlHash(springConfigLocation) {
    if (isNullishOrEmptyString(springConfigLocation)) {
        return '';
    }
    assert(springConfigLocation);
    try {
        const sha = await shasum256(pathlib.join(springConfigLocation, 'application.yml'));
        return (isNullishOrEmptyString(sha)) ? '' : sha;
    } catch { }

    return '';
}

/**
 * @param {any} ymlObj 
 */
export async function dumpApplicationYml(ymlObj) {
    const ymlStr = yaml.dump(ymlObj, { indent: 2 });
    if (isNullishOrEmptyString(ymlStr)) {
        throw new CodeError(
            'empty application.yml content.',
            ERROR_CODES.YML_PARSE_ERROR);
    }
    assert(ymlStr);

    return ymlStr;
}

/**
 * Returns application.yml hash
 * @param {string} springConfigLocation 
 * @param {any} ymlObj 
 */
export async function saveApplicationYml(springConfigLocation, ymlObj) {
    const ymlStr = await dumpApplicationYml(ymlObj);
    if (isNullishOrEmptyString(ymlStr)) {
        throw new CodeError(`Empty yml data.`, ERROR_CODES.YML_PARSE_ERROR);
    }
    await saveToFile(ymlStr, springConfigLocation, 'application.yml', { strict: true });
    return computeApplicationYmlHash(springConfigLocation);
}

/**
 * @param {string} springConfigLocation 
 * @param {{ profile?: string, keepEnv?: boolean, merge?: any }} options 
 */
export async function parseApplicationYmlFile(springConfigLocation, { profile = '', keepEnv = false, merge = null } = {}) {
    let ymlStr;
    if (!isNullishOrEmptyString(profile)) {
        ymlStr = await readFile(
            pathlib.join(springConfigLocation, `application-${profile}.yml`),
            { strict: true });
    } else {
        ymlStr = await readFile(
            pathlib.join(springConfigLocation, 'application.yml'),
            { strict: true });
    }

    if (!ymlStr) {
        throw new CodeError(
            'empty application.yml content.',
            ERROR_CODES.YML_PARSE_ERROR);
    }

    return parseApplicationYml(ymlStr, { keepEnv, merge });
}

/**
 * @param {string} str 
 * @param {{ keepEnv?: boolean, merge?: any }} options 
 */
export async function parseApplicationYml(str, { keepEnv = false, merge = null } = {}) {
    try {
        if (isNullishOrEmptyString(str)) {
            throw null;
        }
        const ymlObj = yaml.load(str);
        if (!ymlObj || typeof ymlObj !== 'object') {
            throw null;
        }

        if (keepEnv !== true) {
            keepEnv = false;
        }
        if (merge && typeof merge !== 'object') {
            merge = null;
        }

        /** 
         * @param {any} src 
         * @param {any} dst 
         * @param {any} merge 
         */
        const __recursiveParseAndFill = (src, dst, merge) => {
            const properties = Object.keys(src);
            for (let p of properties) {
                const v = src[p];
                const m = merge?.[p];
                if (v === null || v === undefined) {
                    continue;
                } else if (typeof v === 'object' && v != null) {
                    dst[p] = {};
                    __recursiveParseAndFill(v, dst[p], m);
                } else if (typeof v === 'string') {
                    /** @type {string | number | boolean | undefined} */
                    let _v = v;
                    let _e = null;
                    if (v.startsWith('${') && v.endsWith('}')) {
                        const index = v.indexOf(':');
                        assert(index >= 0);
                        _e = v.substring(2, index);
                        _v = v.substring(index + 1, v.length - 1);
                    }
                    if (stringIsPositiveInteger(_v)) {
                        _v = stringToPositiveInteger(_v);
                    } else if (_v === 'true') {
                        _v = true;
                    } else if (_v === 'false') {
                        _v = false;
                    }
                    assert(_v !== null && _v !== undefined);
                    dst[p] = (keepEnv) ? { env: _e, value: _v } : _v;
                } else if (typeof v === 'number') {
                    dst[p] = (keepEnv) ? { env: null, value: v } : v;
                } else if (typeof v === 'boolean') {
                    dst[p] = (keepEnv) ? { env: null, value: v } : v;
                } else {
                    console.error(`parseApplicationYml() property=${p} : Unsupported type`);
                    assert(false);
                }
                if (m !== null && m !== undefined) {
                    assert(typeof m === typeof dst[p]);
                    dst[p] = m;
                }
            }
        }

        /** @type {any} */
        const o = {};
        __recursiveParseAndFill(ymlObj, o, merge);

        return o;
    } catch (err) {
        if (err instanceof Error) {
            console.log(err.stack);
        }
        throw new CodeError(
            'parse application.yml content failed.',
            ERROR_CODES.YML_PARSE_ERROR);
    }
}

