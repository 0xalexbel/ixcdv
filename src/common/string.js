import assert from 'assert'
import * as types from './types.js'
import * as ERROR_CODES from "./error-codes.js";
import { CodeError, fail, throwTypeError } from './error.js'
import { throwIfNotStrictlyPositiveInteger } from './number.js';

/**
 * Returns `true` if:
 * - `str` is `null` or `undefined`
 * - `str` is not a string
 * - `str` is an empty string
 * @param {*} str 
 */
export function isNullishOrEmptyString(str) {
    if (str == null || str == undefined) {
        return true;
    }
    if (typeof str !== 'string' || str.length == 0) {
        return true;
    }
    return false;
}

/** @param {!string} str */
export function capitalizeFirstLetter(str) {
    throwIfNullishOrEmptyString(str);
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/** @param {!string} str */
export function removeTrailingSlash(str) {
    return str.replace(/\/$/, "");
}

/** 
 * Returns the modified string `str` so that:
 * - First letter is capitalize
 * - Ends with a '.'
 * - Always returns a non-null string
 * - Returns empty string if `str` is `null`, `undefined`, 
 * empty or only made of whitespace-like characters
 * @param {!string} str 
 */
export function spellingify(str) {
    if (str == null || str.length == 0) {
        return '';
    }
    let m = str.trim();
    if (m.length == 0) {
        return '';
    }
    m = m.substring(0, 1).toUpperCase() + m.substring(1);
    if (!m.endsWith('.')) {
        m += ".";
    }
    return m;
}

/**
 * Returns `true` if:
 * - `value` is a non-empty string without leading +/- sign
 * - `value` represents a positive integer
 * @param {?string=} str 
 */
export function stringIsPositiveInteger(str) {
    if (str == null || str == undefined) {
        return false;
    }
    if (typeof str !== 'string' || str.length == 0) {
        return false;
    }
    const regex = /^[0-9]*$/g;
    const found = str.match(regex);
    return (found != null);
}

/**
 * @param {?string=} str 
 */
export function stringRemoveLeadingZeros(str) {
    if (str == null || str.length == 0) {
        return '0';
    }
    str = str.replace(/^0+/, '');
    return (str.length > 0) ? str : '0';
}

/**
 * @param {?string=} str 
 */
export function stringIsStrictlyPositiveInteger(str) {
    str = stringRemoveLeadingZeros(str);
    const regex = /^[1-9]\d*$/;
    const found = str.match(regex);
    return (found != null);
}

/**
 * @param {?string=} str 
 */
export function stringIsPOSIXPortable(str) {
    if (str == null || str == undefined) {
        return false;
    }
    if (typeof str !== 'string' || str.length == 0) {
        return false;
    }
    const regex = /^[-._0-9a-zA-Z]*$/g;
    const found = str.match(regex);
    return (found?.length === 1);
}

/**
 * @param {?string=} str 
 */
export function stringIsJsVar(str) {
    if (str == null || str == undefined) {
        return false;
    }
    if (typeof str !== 'string' || str.length == 0) {
        return false;
    }
    if (str.match(/^\d/)) {
        return false;
    }
    const regex = /^[_0-9a-zA-Z]*$/g;
    const found = str.match(regex);
    return (found?.length === 1);
}

/**
 * @param {?string=} str 
 */
export function stringIsAlphanum(str) {
    if (str == null || str == undefined) {
        return false;
    }
    if (typeof str !== 'string' || str.length == 0) {
        return false;
    }
    if (str.match(/^\d/)) {
        return false;
    }
    const regex = /^[0-9a-zA-Z]*$/g;
    const found = str.match(regex);
    return (found?.length === 1);
}

/**
 * Returns a `number` as integer or `undefined`
 * @param {string} str 
 * @param {object} options
 * @param {boolean=} [options.strict=false]
 */
export function stringToPositiveInteger(str, options = { strict: false }) {
    if (str == null || (typeof str !== 'string')) {
        if (options.strict) {
            throwTypeError('string argument is null, undefined or not a string.')
        }
        return; /* undefined */
    }
    const s = str.trim();
    if (!stringIsPositiveInteger(s)) {
        if (options.strict) {
            throwTypeError('string is not a positive integer.')
        }
        return; /* undefined */
    }
    return Number.parseInt(s);
}

/**
 * Converts a string to an object as follow:
 * - `{hostname:<hostname>, port:<number>}`
 * - `null` if failed.
 * @param {string} str 
 * @returns {{ hostname?: string, port?: number }}
 */
export function stringToHostnamePort(str) {
    if (isNullishOrEmptyString(str)) {
        return { hostname: undefined, port: undefined };
    }

    const parts = str.split(':');
    if (parts.length === 0 || parts.length > 2) {
        return { hostname: undefined, port: undefined };
    }
    if (parts.length === 1) {
        return { hostname: parts[0], port:undefined };
    }
    try {
        const u = new URL('http://' + parts[0] + ':' + parts[1]);
        return { hostname: u.hostname, port: Number.parseInt(u.port) };
    } catch (err) { }

    return { hostname: undefined, port: undefined };
}

/**
 * @param {{
 *      hostname?: string
 *      port?: number
 * } | string | number | null | undefined } args
 */
export function hostnamePortToString(args) {
    if (args === null || args === undefined) {
        return 'localhost';
    }
    if (typeof args === 'string') {
        if (isNullishOrEmptyString(args)) {
            return 'localhost';
        }
        if (args.startsWith('http:') || args.startsWith('https:')) {
            const u = new URL(args);
            return u.host;
        }
        return new URL(args).host;
    } else if (typeof args === 'number') {
        throwIfNotStrictlyPositiveInteger(args);
        return 'localhost:' + args.toString();
    } else if (typeof args === 'object') {
        let hostname = args.hostname;
        let port = args.port;
        if (!hostname || isNullishOrEmptyString(hostname)) {
            hostname = 'localhost';
        }
        if (port === null || port === undefined) {
            return hostname;
        }
        throwIfNotStrictlyPositiveInteger(port);
        return hostname + ':' + port.toString();
    }
    assert(false);
}

/**
 * Replace in `str` all occurences of all the placeholder strings
 * specified by the `placeholders` object. 
 * - Always returns a non-null string
 * @example
 * const placeholders = { '${arg1}': 'hello', '${arg2}': 'world' };
 * const str="${args1}.${arg2}";
 * //newStr == "hello.world"
 * const newStr = placeholdersReplace(str,placeholders); 
 * @param {!string} str 
 * @param {!Object.<string,string>} placeholders keys:`"${<a-token-string>}"` values:`"<a-token-value>"`
 */
export function placeholdersReplace(str, placeholders) {
    if (isNullishOrEmptyString(str)) {
        return '';
    }
    return str.replace(/\${\w+}/g, function (all) {
        return placeholders[all] || all;
    });
}

/**
 * Performs an in-place string replace of `object[property]`
 * using the given `placeholders` keys and values.
 * @see placeholdersReplace
 * @param {any} object 
 * @param {!string} property 
 * @param {!Object.<string,string>} placeholders
 */
export function placeholdersPropertyReplace(object, property, placeholders) {
    if (object[property] && typeof object[property] === 'string') {
        object[property] = placeholdersReplace(object[property], placeholders);
    }
}

/**
 * If `str` does not start with `prefix`, prepend `prefix`
 * @param {!string} prefix 
 * @param {!string} str 
 */
export function ensurePrefix(prefix, str) {
    if (!str.startsWith(prefix)) {
        return prefix + str;
    }
    return str;
}

/**
 * If `str` does not ends with `suffix`, append `suffix`
 * @param {!string} suffix 
 * @param {!string} str 
 */
export function ensureSuffix(suffix, str) {
    if (!str.endsWith(suffix)) {
        return str + suffix;
    }
    return str;
}

/**
 * If `str` start with `prefix`, remove first instance of `prefix`
 * @param {!string} prefix 
 * @param {!string} str 
 */
export function removePrefix(prefix, str) {
    if (str.startsWith(prefix)) {
        return str.substring(prefix.length);
    }
    return str;
}

/**
 * If `str` ends with `suffix`, remove last instance of `suffix`
 * @param {!string} suffix
 * @param {!string} str 
 */
export function removeSuffix(suffix, str) {
    if (str.endsWith(suffix)) {
        return str.substring(0, str.length - suffix.length);
    }
    return str;
}

/**
 * If `str` ends with `suffix`, remove last instance of `suffix`
 * @param {*} value
 * @param {!number=} length 
 */
export function isHexString(value, length) {
    if (typeof (value) !== "string" || !value.match(/^0x[0-9A-Fa-f]*$/)) {
        return false
    }
    if (length && value.length !== 2 + 2 * length) { return false; }
    return true;
}

/**
 * Throws an error if :
 * - `str` is `null` or `undefined`
 * - `str` is not a string
 * - `str` is an empty string
 * - returns `str` otherwise
 * @param {*} str 
 * @returns {!string}
 */
export function throwIfNullishOrEmptyString(str) {
    if (isNullishOrEmptyString(str)) {
        throw new TypeError(`argument is null, undefined, not a string or an empty string`);
    }
    return str;
}

/**
 * Throws an error if :
 * - `str` is `null` or `undefined`
 * - `str` is not a string
 * - `str` is an empty string
 * - `str` contains characters other than '_', [0-9a-zA-Z]
 * @param {*} str 
 * @returns {!string}
 */
export function throwIfNotJsVarString(str) {
    if (!stringIsJsVar(str)) {
        throw new TypeError(`argument is not a valid non-empty string with [_0-9a-zA-Z] characters.`);
    }
    return str;
}

/** @param {*} value */
export function assertNonEmptyString(value) {
    const cond = ((typeof value === 'string') && (value.length > 0));
    assert(cond);
}

/**
 * @param {object} args
 * @param {*} args.str 
 * @param {types.StrictLike=} args.options
 */
export function failNullishOrEmptyString({ str, options }) {
    return fail(
        errorNullishOrEmptyString(str),
        options);
}

/**
 * @param {string} str
 */
export function errorNullishOrEmptyString(str) {
    return new CodeError(
        `string '${str}' is nullish or empty`,
        ERROR_CODES.NULLISH_OR_EMPTY_STRING);
}
