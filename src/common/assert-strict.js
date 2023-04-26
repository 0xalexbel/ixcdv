import assert from 'assert'

/** @param {*} value */
export function assertNotNullish(value) {
    const cond = (value !== null && value !== undefined);
    assert(cond);
}

/** @param {*} value */
export function assertIsNullishOrArray(value) {
    if (value !== null && value !== undefined) {
        const cond = (Array.isArray(value));
        assert(cond);
    }
}

/** @param {*} value */
export function assertIsArray(value) {
    const cond = (Array.isArray(value));
    assert(cond);
}

/** @param {*} value */
export function assertIsBoolean(value) {
    const cond = (typeof value === 'boolean');
    assert(cond);
}

/** @param {*} value */
export function assertIsString(value) {
    const cond = (typeof value === 'string');
    assert(cond);
}

/** @param {*} value */
export function assertIsFunction(value) {
    const cond = (typeof value === 'function');
    assert(cond);
}

/** @param {*} value */
export function assertIsObject(value) {
    const cond = (typeof value === 'object');
    assert(cond);
}

/** @param {*} value */
export function assertIsNullisOrObject(value) {
    if (value !== null && value !== undefined) {
        const cond = (typeof value === 'object');
        assert(cond);
    }
}
