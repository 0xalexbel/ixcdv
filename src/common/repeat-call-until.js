import * as types from './types.js'
import {
    assertIsPositiveInteger,
    assertIsStrictlyPositiveInteger
} from './number.js';
import { isNullishOrEmptyString } from './string.js';
import * as timersPromises from 'timers/promises';
import { CodeError } from './error.js';
import { assertIsFunction } from './assert-strict.js';
import { getObjectOwnPropertyValue } from './utils.js';

/**
 * Repeatedly call a callback function
 * @param {function} cb the callback function
 * @param {?(any[])} cbArgs the callback arguments
 * @param {object} options
 * @param {number=} options.waitBeforeFirstCall the amount of time to wait in ms before the first callback call
 * @param {number=} options.waitBetweenCallsMS the amount of time to wait in ms between 2 callback calls
 * @param {number=} options.maxCalls maximum number of callback calls (default 20)
 * @param {string=} options.progressMessage when provided, used as a prefix to display a progress message. If not provided, does not display any progress message.
 * @param {types.progressCallback=} options.progressCb 
 * @param {AbortSignal=} options.abortSignal when provided the corresponding `AbortController` can be used to cancel the operation.
 * @returns {Promise<types.ResultOrCodeError<any>>}
 */
export async function repeatCallUntil(cb, cbArgs, options = {
    waitBeforeFirstCall: 100,
    waitBetweenCallsMS: 1000,
    maxCalls: 20
}) {
    if (!options.waitBeforeFirstCall) {
        options.waitBeforeFirstCall = 100;
    }
    if (!options.waitBetweenCallsMS) {
        options.waitBetweenCallsMS = 1000;
    }
    if (!options.maxCalls) {
        options.maxCalls = 20;
    }

    if (options.abortSignal) {
        if (!(options.abortSignal instanceof AbortSignal)) {
            throw new TypeError('options.abortSignal is not an AbortSignal object');
        }
    }

    assertIsFunction(cb);
    assertIsPositiveInteger(options.waitBeforeFirstCall);
    assertIsStrictlyPositiveInteger(options.waitBetweenCallsMS);

    // Before launching the next timer
    if (options.abortSignal?.aborted) {
        return { ok: false, error: new CodeError('operation aborted', 'ABORT') };
    }

    try {
        // If needed, wait a given time before executing the first call
        if (options.waitBeforeFirstCall > 0) {
            await timersPromises.setTimeout(
                options.waitBeforeFirstCall,
                null,
                { signal: options.abortSignal });
        }

        let callOut;
        try {
            callOut = (cbArgs) ? await cb(...cbArgs) : await cb();
        } catch {
            callOut = false;
        }

        // 'undefined' is interpreted as a failure
        if (callOut !== undefined) {
            if (typeof callOut === 'boolean') {
                if (callOut) {
                    return { ok: true, result: true };
                } else {
                    // out === false
                    // continue (for readability)
                }
            } else if (typeof callOut === 'object') {
                if (callOut.ok === true) {
                    return callOut;
                } else if (callOut.ok === false) {
                    // object = { ok:false, ... }
                    // continue (for readability)
                } else {
                    return { ok: true, result: callOut };
                }
            } else {
                return { ok: true, result: callOut };
            }
        }

        // Before launching the next timer
        if (options.abortSignal?.aborted) {
            return { ok: false, error: new CodeError('operation aborted', 'ABORT') };
        }

        const messagePrefix = (isNullishOrEmptyString(options.progressMessage)) ? null : options.progressMessage;

        if (messagePrefix) {
            //console.log(`${messagePrefix} 0%`);
        }
        if (options.progressCb) {
            options.progressCb({ count: 0, total: 100, value: null });
        }

        const abortSignal = options.abortSignal;

        let callCount = 0;
        for await (const maxCallCount of timersPromises.setInterval(
            options.waitBetweenCallsMS,
            options.maxCalls,
            { signal: options.abortSignal })) {
            callCount++;

            if (abortSignal?.aborted) {
                return { ok: false, error: new CodeError('operation aborted', 'ABORT') };
            }

            try {
                callOut = (cbArgs) ? await cb(...cbArgs) : await cb();
            } catch {
                callOut = false;
            }

            // 'undefined' is interpreted as a failure
            if (callOut !== undefined) {
                if (typeof callOut === 'boolean') {
                    if (callOut) {
                        return { ok: true, result: true };
                    } else {
                        // out === false
                        // continue (for readability)
                    }
                } else if (typeof callOut === 'object') {
                    if (callOut.ok === true) {
                        return callOut;
                    } else if (callOut.ok === false) {
                        // object = { ok:false, ... }
                        // continue (for readability)
                    } else {
                        return { ok: true, result: callOut };
                    }
                } else {
                    return { ok: true, result: callOut };
                }
            }

            const perc = Math.floor(100 * callCount / maxCallCount);
            if (messagePrefix) {
                //console.log(`${messagePrefix} ${perc}%`);
            }
            if (options.progressCb) {
                options.progressCb({ count: perc, total: 100, value: null });
            }

            if (callCount >= maxCallCount) {
                break;
            }
        }

        return { ok: false, error: new CodeError('operation timeout', 'TIMEOUT') };
    } catch (err) {
        const code = getObjectOwnPropertyValue(err, 'code');
        if (code === 'ABORT_ERR') {
            return { ok: false, error: new CodeError('operation aborted', 'ABORT') };
        }
        return { ok: false, error: new CodeError('operation interrupted', 'UNKNOWN') };
    }
}
