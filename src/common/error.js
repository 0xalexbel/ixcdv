import * as types from './common-types.js';

export class CodeError extends Error {
    /**
     * @param {!string} message
     * @param {!string=} code
     * @param {*=} context
     */
    constructor(message, code, context) {
        super(message);
        this.name = "CodeError";
        this.code = code;
        this.context = context;
    }
}

/** @param {!string=} message */
export function throwTypeError(message) {
    throw new TypeError(message);
}

/**
 * @param {!number} expectedNumArgs 
 * @param {!number} numArgs 
 */
export function wrongNumArgs(expectedNumArgs, numArgs) {
    if (expectedNumArgs !== numArgs) {
        throwTypeError(`Wrong number of arguments num='${numArgs}', expecting='${expectedNumArgs}'`);
    }
}

/**
 * @param {!number} minArgs 
 * @param {!number} numArgs 
 */
export function wrongMinArgs(minArgs, numArgs) {
    if (numArgs < minArgs) {
        throwTypeError(`No enough arguments num='${numArgs}', min='${minArgs}'`);
    }
}

/**
 * Returns `value` if it is not `null` or `undefined`
 * @param {*} value 
 */
export function throwIfNullish(value) {
    if (value === null || value === undefined) {
        throwTypeError('value is null or undefined');
    }
    return value;
}

/**
 * Throws an error if :
 * - `object` is `null` or `undefined`
 * - `object[property]` is `null` or `undefined`
 * @param {!string} property 
 * @param {*} obj 
 */
export function throwIfNullishProperty(property, obj) {
    if (obj === null || obj === undefined || !Object.hasOwn(obj, property)) {
        throw new TypeError(`Missing property '${property}'`);
    }
    return Object.getOwnPropertyDescriptor(obj, property)?.value;
}

/**
 * Throws an error if :
 * - `value` is `null` or `undefined`
 * - `typeof value !== typeName`
 * @param {!string} typeName 
 * @param {*} value 
 */
export function throwIfNotTypeOf(typeName, value) {
    if (value === null || value === undefined) {
        throwTypeError('value is null or undefined');
    }
    if (typeof value !== typeName) {
        throwTypeError(`value is not a '${typeName}'`);
    }
    return value;
}

/**
 * Throws an error if :
 * - `value` is `null` or `undefined`
 * - `typeof value !== string`
 * @param {*} value 
 * @returns {string}
 */
export function throwIfNotString(value) {
    return throwIfNotTypeOf('string', value);
}

/**
 * Throws an error if :
 * - `!boolValue`
 * @param {!boolean} boolValue
 */
export function throwIfFailed(boolValue) {
    if (!boolValue) {
        throwTypeError('failed');
    }
}

/**
 * Throws an error to notify that `funcname` is a pure virtual class method
 * @param {!string} funcname
 */
export function throwPureVirtual(funcname) {
    throw pureVirtualError(funcname);
}

/**
 * Throws an error to notify that `funcname` is a pure virtual class method
 * @param {!string} funcname
 */
export function pureVirtualError(funcname) {
    return new TypeError(`${funcname} is a pure virtual method`);
}

/**
 * Utility function since can't use post-fix assert in JSDoc
 *  - Takes any union type and excludes `null`
 * @template T
 * @param {T} value
 * @returns {Exclude<T, null>}
 */
export function assertNotNull(value) {
    return /** @type {Exclude<T, null>} */ (value);
}

/**
 * @param {CodeError} error 
 * @param {types.StrictLike=} strictLike 
 * @returns {types.FailedCodeError}
 */
export function fail(error, strictLike) {
    const strict = (typeof strictLike === 'boolean') ?
        strictLike :
        !!(strictLike?.strict);

    if (strict) {
        throw error;
    }
    return { ok: false, error: error };
}

/**
 * @param {CodeError} error 
 * @param {types.StrictLike=} strictLike 
 * @returns {boolean}
 */
export function falseOrThrow(error, strictLike) {
    const strict = (typeof strictLike === 'boolean') ?
        strictLike :
        !!(strictLike?.strict);

    if (strict) {
        throw error;
    }
    return false;
}

/**
 * @param {any} error 
 * @param {types.StrictLike=} strictLike 
 * @returns {boolean}
 */
export function falseOrThrowAny(error, strictLike) {
    const strict = (typeof strictLike === 'boolean') ?
        strictLike :
        !!(strictLike?.strict);

    if (strict) {
        throw error;
    }
    return false;
}

/**
 * @param {any} error 
 * @param {types.StrictLike=} strictLike 
 */
export function nullOrThrowAny(error, strictLike) {
    const strict = (typeof strictLike === 'boolean') ?
        strictLike :
        !!(strictLike?.strict);

    if (strict) {
        throw error;
    }
    return null;
}
