import * as types from './types.js'
import { assertNonEmptyString, isNullishOrEmptyString, stringToPositiveInteger, throwIfNullishOrEmptyString } from './string.js';
import * as timersPromises from 'timers/promises';
import * as pathlib from 'path';
import assert from 'assert';
import { CodeError } from './error.js';
import { dirExists } from './fs.js';
import { assertIsStrictlyPositiveInteger, throwIfNotStrictlyPositiveInteger } from './number.js';

import * as nodeUtil from 'util';
import { exec as childProcessExec } from 'child_process';
import { parseSingleEnvVar } from './utils.js';
const exec_promise = nodeUtil.promisify(childProcessExec);

/**
 * Executes `lsof -p <pid>`
 * @param {number} pid 
 */
export async function getPIDCWD(pid) {
    try {
        const { stdout, stderr } = await exec_promise(`lsof -p ${pid.toString()} | awk '$4=="cwd" {print $9}'`);
        const dir = stdout.trim();
        // some checking 
        assert(pathlib.isAbsolute(dir));
        assert(dirExists(dir));
        return dir;
    } catch (err) {
        return /* undefined */;
    }
}

/**
 * Executes `ps -p <pid>`
 * @param {number} pid 
 */
export async function psp(pid) {
    assertIsStrictlyPositiveInteger(pid);

    try {
        // Will throw an error if pid does not exist
        const { stdout, stderr } = await exec_promise("ps -p " + pid.toString());
        // Otherwise, stdout contains process info 
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * - Mac BSD : `-E` = print env vars (does exist in ps Ubuntu)
 * - Mac + Ubuntu : `ps e` (no dash) = print env vars 
 * - v1 (macos only): Executes `ps -E -o command= -p <pid>`
 * - v2 (macos + ubuntu): Executes `ps e -o command= -p <pid>`
 * @param {number} pid 
 */
export async function pspWithArgsAndEnv(pid) {
    assertIsStrictlyPositiveInteger(pid);

    try {
        // Will throw an error if pid does not exist

        // Version 1, using `-E` option, only works on MacOS
        // `ps -E -o command= -p <pid>`
        // const { stdout, stderr } = await exec_promise("ps -E -o command= -p " + pid.toString());

        // Version 2, using `e` suffix, works on MacOS + Ubuntu
        // `ps e -o command= -p <pid>`
        const { stdout, stderr } = await exec_promise("ps e -o command= -p " + pid.toString());

        // Otherwise, stdout contains process info 
        const s = stdout.trim();
        if (isNullishOrEmptyString(s)) {
            return; /* undefined */
        }
        return s;
    } catch (err) {
        return; /* undefined */
    }
}

/**
 * Executes : ps -o pid= -o command= | grep -v grep | grep -E '<pattern>' 
 * @param {string} grepPattern 
 */
export async function psGrepPIDAndArgs(grepPattern) {
    assertNonEmptyString(grepPattern);

    try {
        const { stdout, stderr } = await exec_promise(`ps -A -o pid= -o command= | grep -v grep | grep -E \'${grepPattern}\'`);
        if (isNullishOrEmptyString(stdout)) {
            return /* undefined */
        }
        const lines = stdout.trim().split('\n');
        const pids = [];
        for (let i = 0; i < lines.length; ++i) {
            const l = lines[i].trim();
            const j = l.indexOf(' ');
            if (j < 0) {
                continue;
            }
            const pidStr = l.substring(0, j).trim();
            const pid = stringToPositiveInteger(pidStr, { strict: true });
            assert(pid);
            if (pid) {
                pids.push({ pid, args: l.substring(j + 1).trim() });
            }
        }
        if (pids.length === 0) {
            return /* undefined */
        }
        return pids;
    } catch (err) {
        let h = 0;
    }
    return; /* undefined */
}

/**
 * @param {string} grepPattern 
 */
export async function psGrepPID(grepPattern) {
    assertNonEmptyString(grepPattern);

    try {
        const { stdout, stderr } = await exec_promise(`ps -Af | grep -v grep | grep -E \'${grepPattern}\' | awk '{ print $2 }'`);
        if (isNullishOrEmptyString(stdout)) {
            return /* undefined */
        }
        const lines = stdout.trim().split('\n');
        const pids = [];
        for (let i = 0; i < lines.length; ++i) {
            const pid = stringToPositiveInteger(lines[i], { strict: true });
            assert(pid);
            if (pid) {
                pids.push(pid);
            }
        }
        if (pids.length === 0) {
            return /* undefined */
        }
        return pids;
    } catch (err) {
        if (err instanceof Error) {
            console.log(err.stack);
        }
    }
    return; /* undefined */
}

/**
 * @param {string} grepPattern 
 */
export async function psGrepPIDAndEnv(grepPattern) {
    assertNonEmptyString(grepPattern);
    // v1 (mac only): ps -A -E -o pid= -o command=
    // v2 (mac+linux): ps e -A -o pid= -o command=
    try {
        //Version 1 (mac only)
        //const { stdout, stderr } = await exec_promise(`ps -A -E -o pid= -o command= | grep -v grep | grep -E \'${grepPattern}\'`);

        //Version 2 (mac+Ubuntu)
        const { stdout, stderr } = await exec_promise(`ps e -A -o pid= -o command= | grep -v grep | grep -E \'${grepPattern}\'`);
        if (isNullishOrEmptyString(stdout)) {
            return /* undefined */
        }
        const lines = stdout.trim().split('\n');
        const pids = [];
        for (let i = 0; i < lines.length; ++i) {
            // must trim all lines individually
            const l = lines[i].trim();
            const j = l.indexOf(' ');
            if (j < 0) {
                continue;
            }

            const pid = stringToPositiveInteger(
                l.substring(0, j),
                { strict: true });
            assert(pid);
            if (pid) {
                pids.push({ pid, command: l.substring(j + i) });
            }
        }
        if (pids.length === 0) {
            return /* undefined */
        }
        return pids;
    } catch { }
    return; /* undefined */
}

/**
 * Executes : `ps -o args= <pid>`
 * @param {number | number[]} pid
 */
export async function psGetArgs(pid) {
    let pidStr;
    if (!Array.isArray(pid)) {
        assertIsStrictlyPositiveInteger(pid);
        pidStr = pid.toString();
    } else {
        for (let i = 0; i < pid.length; ++i) {
            assertIsStrictlyPositiveInteger(pid[i]);
        }
        pidStr = pid.join(' ');
    }
    if (isNullishOrEmptyString(pidStr)) {
        return /* undefined */
    }
    try {
        const { stdout, stderr } = await exec_promise(`ps -o args= ${pidStr}`);
        return stdout.trim().split('\n');
    } catch { }
    return; /* undefined */
}


/**
 * @param {number} pid
 * @param {string} envName
 */
export async function psGetEnv(pid, envName) {
    throwIfNotStrictlyPositiveInteger(pid);
    throwIfNullishOrEmptyString(envName);
    try {
        //v1 (mac only) : `-E` option
        //const { stdout, stderr } = await exec_promise(`ps -o command= -E -p ${pid.toString()} | grep -v grep | grep '${envName}='`);
        //v2 (mac+Ubuntu) : `ps e`
        const { stdout, stderr } = await exec_promise(`ps e -o command= -p ${pid.toString()} | grep -v grep | grep '${envName}='`);
        return parseSingleEnvVar(envName, stdout);
    } catch { }
    return; /* undefined */
}

/**
 * Immediatly sends a kill signal then waits until the process is fully terminated.
 * Throws an exception if failed.
 * @param {number} pid The process id to kill
 * @param {object} options
 * @param {number=} options.killSignal the kill signal to send (default = SIGTERM)
 * @param {number=} options.waitBeforeFirstCheckMS the amount of time to wait in ms before the first `ps -p` call
 * @param {number=} options.waitBetweenPIDChecksMS the amount of time to wait in ms between 2 `ps -p` calls
 * @param {number=} options.maxPIDChecks maximum number of `ps -p` calls (default 20)
 * @param {string=} options.progressMessage when provided, used as a prefix to display a progress message. If not provided, does not display any progress message.
 * @param {types.progressCallback=} options.progressCb 
 * @param {AbortSignal=} options.abortSignal when provided the corresponding `AbortController` can be used to cancel the operation.
 */
export async function killPIDAndWaitUntilFullyStopped(pid, options = {
    waitBeforeFirstCheckMS: 100,
    waitBetweenPIDChecksMS: 1000,
    maxPIDChecks: 20
}) {
    /*
        By default:
        - send a first kill SIGTERM signal
        - wait <waitBeforeFirstCheckMS>
        - check if the process is still alive
          - if the process has been killed successfully -> exit
          - if the process is still alive, repeat <maxPIDChecks> times : 
            - every <waitBetweenPIDChecksMS> millisecs, check if the process is still alive
            - after <maxPIDChecks>/4 checks (25%), sends a SIGABRT signal
    */
    if (!options.waitBeforeFirstCheckMS || options.waitBeforeFirstCheckMS < 100) {
        options.waitBeforeFirstCheckMS = 100;
    }
    if (!options.waitBetweenPIDChecksMS) {
        // 1s between two 'kill' calls
        options.waitBetweenPIDChecksMS = 1000;
    }
    if (!options.maxPIDChecks) {
        options.maxPIDChecks = 20;
    }

    if (options.abortSignal) {
        if (!(options.abortSignal instanceof AbortSignal)) {
            throw new TypeError('options.abortSignal is not an AbortSignal object');
        }
    }
    assertIsStrictlyPositiveInteger(pid);
    assertIsStrictlyPositiveInteger(options.waitBeforeFirstCheckMS);
    assertIsStrictlyPositiveInteger(options.waitBetweenPIDChecksMS);
    if (options.killSignal) {
        assertIsStrictlyPositiveInteger(options.killSignal);
    }

    const SIGABRT = 6;
    let SIGABRT_sent = false;

    // Send the first kill signal (default = SIGTERM)
    if (options.killSignal == null) {
        // send SIGTERM
        processKill(pid, undefined);
    } else {
        if (options.killSignal === SIGABRT) {
            SIGABRT_sent = true;
        }
        processKill(pid, options.killSignal);
    }

    // After having sent the first kill signal
    // wait at least 100ms before checking weither
    // the process is still alive or not.
    await timersPromises.setTimeout(
        options.waitBeforeFirstCheckMS,
        null,
        { signal: options.abortSignal });

    // Execute `ps -p`
    let pidExists = await psp(pid);
    if (!pidExists) {
        // pid does not exists, consider the process as stopped.
        // kill succeeded
        return;
    }

    // Before launching the next timer
    if (options.abortSignal?.aborted) {
        throw new CodeError(`kill process ${pid} aborted`, 'ABORT');
    }

    const messagePrefix = (isNullishOrEmptyString(options.progressMessage)) ? null : options.progressMessage;

    if (messagePrefix) {
        //console.log(`${messagePrefix} 0%`);
    }
    if (options.progressCb) {
        options.progressCb({ count: 0, total: 100, value: null });
    }

    const abortSignal = options.abortSignal;

    // Since the process is still running, we start to wait
    // and print a progress message
    let checkCount = 0;
    for await (const maxCheckCount of timersPromises.setInterval(
        options.waitBetweenPIDChecksMS,
        options.maxPIDChecks,
        { signal: options.abortSignal })) {
        checkCount++;

        if (abortSignal?.aborted) {
            throw new CodeError(`kill process ${pid} aborted`, 'ABORT');
        }

        let pidExists = await psp(pid);
        if (!pidExists) {
            // pid does not exists, consider the process as stopped.
            // kill succeeded
            return;
        }

        const perc = Math.floor(100 * checkCount / maxCheckCount);
        if (messagePrefix) {
            //console.log(`${messagePrefix} ${perc}%`);
        }
        if (options.progressCb) {
            options.progressCb({ count: perc, total: 100, value: null });
        }

        if (checkCount >= maxCheckCount) {
            break;
        }

        // kill had no effect
        // Check if we must send a SIGABRT signal
        if (!SIGABRT_sent) {
            if (checkCount >= maxCheckCount / 4) {
                // send SIGABRT
                // this is required in the following situation
                // - spring service
                // - Ctr+C during start (may kill ganache)
                // - spring service is stuck
                // - only ABORT can stop it.
                SIGABRT_sent = true;
                processKill(pid, SIGABRT);
            }
        }
    }

    throw new CodeError(`kill process ${pid} timeout`, 'TIMEOUT');
}

/**
 * - Handle Error 'ESRCH'
 * @param {number} pid 
 * @param {string | number | undefined} signal 
 */
function processKill(pid, signal) {
    try {
        process.kill(pid, signal);
    } catch (err) {
        /** @type {any} */
        const anyErr = err;
        if (anyErr.code === 'ESRCH') {
            // ignore 
            // Man ESRCH : No process or process group can be found corresponding to that specified by pid.
        } else {
            throw err;
        }
    }
}