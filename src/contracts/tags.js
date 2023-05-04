// Dependencies
// ../common
import * as cTypes from './contracts-types-internal.js';
import assert from 'assert';

export const TAG_NONE_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
export const TAG_TEE_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000001';
export const TAG_GPU_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000100';
export const TAG_TEE_GPU_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000101';

export const TAG_NONE_INT = 0;
export const TAG_TEE_INT = 1;
export const TAG_GPU_INT = 4;
export const TAG_TEE_GPU_INT = 5; //TAG_TEE_INT | TAG_GPU_INT;
assert(TAG_TEE_GPU_INT === (TAG_TEE_INT | TAG_GPU_INT));

export const TAG_NONE_ARG = 'none';
export const TAG_TEE_ARG = 'tee';
export const TAG_GPU_ARG = 'gpu';
export const TAG_TEE_GPU_ARG = 'tee-gpu';

/**
 * @typedef { 'none' | 'tee' | 'gpu' | 'tee-gpu' } TagArg
 */

/**
 * @typedef { 0 | 1 | 4 | 5 } TagInt
 */

// 4 = 0x100 - GPU
// 1 = 0x001 - TEE
// 5 = 0x101 - TEE+GPU
// TEE     = "0x0000000000000000000000000000000000000000000000000000000000000001"
// GPU     = "0x0000000000000000000000000000000000000000000000000000000000000100"
// TEE+GPU = "0x0000000000000000000000000000000000000000000000000000000000000101"

/**
 * @param {TagArg} t 
 * @returns {TagInt}
 */
export function tagArgToTagInt(t) {
    switch (t) {
        case TAG_NONE_ARG: return TAG_NONE_INT;
        case TAG_TEE_ARG: return TAG_TEE_INT;
        case TAG_GPU_ARG: return TAG_GPU_INT;
        case TAG_TEE_GPU_ARG: return TAG_TEE_GPU_INT;
        default: throw new TypeError(`Invalid tag arg ${t}`);
    }
}

/**
 * @param {string} t 
 * @returns {cTypes.tag}
 */
export function tagArgToTagArray(t) {
    switch (t) {
        case TAG_NONE_ARG: return [];
        case TAG_TEE_ARG: return [TAG_TEE_ARG];
        case TAG_GPU_ARG: return [TAG_GPU_ARG];
        case TAG_TEE_GPU_ARG: return [TAG_TEE_ARG, TAG_GPU_ARG];
        default: throw new TypeError(`Invalid tag arg ${t}`);
    }
}

/**
 * @param {string} t 
 * @returns {TagInt}
 */
function tagBytes32ToTagInt(t) {
    switch (t) {
        case TAG_NONE_BYTES32: return TAG_NONE_INT;
        case TAG_TEE_BYTES32: return TAG_TEE_INT;
        case TAG_GPU_BYTES32: return TAG_GPU_INT;
        case TAG_TEE_GPU_BYTES32: return TAG_TEE_GPU_INT;
        default: throw new TypeError(`Invalid tag bytes32 ${t}`);
    }
}

/**
 * @param {TagInt} t 
 */
function tagIntToTagBytes32(t) {
    switch (t) {
        case TAG_NONE_INT: return TAG_NONE_BYTES32;
        case TAG_TEE_INT: return TAG_TEE_BYTES32;
        case TAG_GPU_INT: return TAG_GPU_BYTES32;
        case TAG_TEE_GPU_INT: return TAG_TEE_GPU_BYTES32;
        default: throw new TypeError(`Invalid tag int ${t}`);
    }
}

/**
 * @param {TagInt} t 
 * @returns {cTypes.tag}
 */
function tagIntToTagArray(t) {
    switch (t) {
        case TAG_NONE_INT: return [];
        case TAG_TEE_INT: return [TAG_TEE_ARG];
        case TAG_GPU_INT: return [TAG_GPU_ARG];
        case TAG_TEE_GPU_INT: return [TAG_TEE_ARG, TAG_GPU_ARG];
        default: throw new TypeError(`Invalid tag int ${t}`);
    }
}

/**
 * @param {cTypes.tag} t 
 * @returns {TagInt}
 */
export function tagArrayToTagInt(t) {
    if (t === null || t === undefined) {
        return TAG_NONE_INT;
    }
    if (typeof t !== 'object' || !Array.isArray(t) || t.length === 0) {
        return TAG_NONE_INT;
    }
    if (t.length === 1) {
        if (t[0] === TAG_GPU_ARG) { return TAG_GPU_INT; }
        if (t[0] === TAG_TEE_ARG) { return TAG_TEE_INT; }
        return TAG_NONE_INT;
    }
    if (t.length === 2) {
        if ((t[0] === TAG_GPU_ARG || t[1] === TAG_GPU_ARG) &&
            (t[0] === TAG_TEE_ARG || t[1] === TAG_TEE_ARG)) {
            return TAG_TEE_GPU_INT;
        }
    }
    return TAG_NONE_INT;
}

/**
 * @param {string} t 
 * @returns {cTypes.tag}
 */
function tagBytes32ToTagArray(t) {
    switch (t) {
        case TAG_NONE_BYTES32: return [];
        case TAG_TEE_BYTES32: return [TAG_TEE_ARG];
        case TAG_GPU_BYTES32: return [TAG_GPU_ARG];
        case TAG_TEE_GPU_BYTES32: return [TAG_TEE_ARG, TAG_GPU_ARG];
        default: throw new TypeError(`Invalid tag bytes32 ${t}`);
    }
}

/**
 * @param {cTypes.tag} t 
 */
export function tagArrayToTagBytes32String(t) {
    if (t === null || t === undefined) {
        return TAG_NONE_BYTES32;
    }
    if (typeof t !== 'object' || !Array.isArray(t) || t.length === 0) {
        return TAG_NONE_BYTES32;
    }
    if (t.length === 1) {
        if (t[0] === TAG_GPU_ARG) { return TAG_GPU_BYTES32; }
        if (t[0] === TAG_TEE_ARG) { return TAG_TEE_BYTES32; }
        return TAG_NONE_BYTES32;
    }
    if (t.length === 2) {
        if ((t[0] === TAG_GPU_ARG || t[1] === TAG_GPU_ARG) &&
            (t[0] === TAG_TEE_ARG || t[1] === TAG_TEE_ARG)) {
            return TAG_TEE_GPU_BYTES32;
        }
    }
    return TAG_NONE_BYTES32;
}

/**
 * @param {string | cTypes.tag} t 
 * @param {*} options 
 * @returns {cTypes.tag}
 */
export function toTagArray(t, { strict = true } = {}) {
    if (Array.isArray(t)) {
        if (!checkTagArray(t)) {
            if (strict) { throw new TypeError('Invalid tag array'); } else { return []; }
        }
        return t.slice();
    } else if (typeof t === 'string') {
        // try tag arg
        try {
            return tagArgToTagArray(t);
        } catch { }
        // try tag bytes 32 string
        try {
            return tagBytes32ToTagArray(t);
        } catch { }
        if (strict) { throw new TypeError('Invalid tag'); } else { return []; }
    } else {
        if (strict) { throw new TypeError('Invalid tag'); } else { return []; }
    }
}

/**
 * @param {*} t 
 */
export function checkTagArray(t) {
    if (t === null || t === undefined) {
        return true;
    }
    if (typeof t !== 'object' || !Array.isArray(t)) {
        return false;
    }
    if (t.length > 2) {
        return false;
    }
    if (t.length === 0) {
        return true;
    }
    if (t.length === 1) {
        if (t[0] === TAG_GPU_ARG) { return true; }
        if (t[0] === TAG_TEE_ARG) { return true; }
        return false;
    }
    if (t.length === 2) {
        if ((t[0] === TAG_GPU_ARG || t[1] === TAG_GPU_ARG) &&
            (t[0] === TAG_TEE_ARG || t[1] === TAG_TEE_ARG)) {
            return true;
        }
        return false;
    }
    return false;
}

/**
 * @param {TagInt} t1 
 * @param {TagInt} t2 
 * @returns {TagInt}
 */
export function tagIntOr(t1, t2) {
    // @ts-ignore
    return (t1 | t2);
}
/**
 * @param {TagInt} t1 
 * @param {TagInt} t2 
 * @returns {TagInt}
 */
export function tagIntAnd(t1, t2) {
    // @ts-ignore
    return (t1 & t2);
}
/**
 * @param {string} t1 
 * @param {string} t2 
 */
function tagBytes32And(t1, t2) {
    return tagIntToTagBytes32(tagIntAnd(tagBytes32ToTagInt(t1), tagBytes32ToTagInt(t2)));
}
/**
 * @param {string} t1 
 * @param {string} t2 
 */
function tagBytes32Or(t1, t2) {
    return tagIntToTagBytes32(tagIntOr(tagBytes32ToTagInt(t1), tagBytes32ToTagInt(t2)));
}
/**
 * @param {cTypes.tag} t1 
 * @param {cTypes.tag} t2 
 */
function tagArrayOr(t1, t2) {
    return tagIntToTagArray(tagIntOr(tagArrayToTagInt(t1), tagArrayToTagInt(t2)));
}
/**
 * @param {cTypes.tag} t1 
 * @param {cTypes.tag} t2 
 */
function tagArrayAnd(t1, t2) {
    return tagIntToTagArray(tagIntAnd(tagArrayToTagInt(t1), tagArrayToTagInt(t2)));
}

