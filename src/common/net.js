import * as types from './types.js';
import assert from 'assert';
import { isNullishOrEmptyString } from "./string.js";
import * as nodeUtil from 'util';
import { exec as childProcessExec } from 'child_process';

const exec_promise = nodeUtil.promisify(childProcessExec);

/**
 * @param {?types.positiveInteger=} port 
 */
export async function isPortInUse(port) {
    try {
        if (port === null || port === undefined) {
            return false;
        }
        assert(typeof port === 'number');
        const { stdout, stderr } = await exec_promise(`lsof -i -P -n | grep LISTEN | grep ':${port.toString()}'`);
        const something = stdout.trim();
        return !isNullishOrEmptyString(something);
    } catch (err) {
        return false;
    }
}
