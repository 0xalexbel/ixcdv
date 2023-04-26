import * as types from './types.js'
import * as ERROR_CODES from "./error-codes.js";
import assert from 'assert'
import { CodeError, fail, throwTypeError } from './error.js'

/**
 * Returns true if `num` is an integer `number`
 * @param {*} num 
 */
export function isInteger(num) {
    return (typeof num === "number" && num == num && (num % 1) === 0);
}

/**
 * Returns true if `num` is a positive or zero integer `number`
 * @param {*} num 
 */
export function isPositiveInteger(num) {
    return (isInteger(num) && num >= 0);
}

/**
 * Returns true if `num` is a strictly positive integer `number`
 * @param {*} num 
 */
export function isStrictlyPositiveInteger(num) {
    return (isInteger(num) && num > 0);
}

/** @param {*} value */
export function assertIsStrictlyPositiveInteger(value) {
    const cond = (isStrictlyPositiveInteger(value));
    assert(cond);
}

/** @param {*} value */
export function assertIsPositiveInteger(value) {
    const cond = (isPositiveInteger(value));
    assert(cond);
}

/** @param {*} value */
export function throwIfNotStrictlyPositiveInteger(value) {
    if (!isStrictlyPositiveInteger(value)) {
        throw errorNotStrictlyPositiveInteger(value);
    }
}

/** @param {*} value */
export function throwIfNotPositiveInteger(value) {
    if (!isPositiveInteger(value)) {
        throw errorNotStrictlyPositiveInteger(value);
    }
}

/**
 * @param {object} args
 * @param {*} args.int 
 * @param {types.StrictLike=} args.options
 */
export function failNotStrictlyPositiveInteger({ int, options }) {
    return fail(
        errorNotStrictlyPositiveInteger(int),
        options
    )
}

/**
 * @param {*} int
 */
export function errorNotStrictlyPositiveInteger(int) {
    return new CodeError(
        `value '${int}' is not a strictly positive integer`,
        ERROR_CODES.NOT_STRICT_POSITVE_INT);
}

/**
 * @param {*} int
 */
export function errorNotPositiveInteger(int) {
    return new CodeError(
        `value '${int}' is not a positive integer`,
        'NOT_POSITVE_INT');
}
