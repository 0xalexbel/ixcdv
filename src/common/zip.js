import { assertNonEmptyString, isNullishOrEmptyString } from './string.js';
import * as pathlib from 'path';
import { dirExists, generateTmpPathname, mkDirP, rmrfDir, saveToBinaryFile, throwIfDirDoesNotExist, throwIfFileDoesNotExist } from './fs.js';

import * as nodeUtil from 'util';
import { exec as childProcessExec } from 'child_process';
import { CodeError } from './error.js';
import { httpGETBinary } from './http.js';
const exec_promise = nodeUtil.promisify(childProcessExec);

/**
 * @param {string} zipFile 
 * @param {string} extractDir 
 */
export async function unzip(zipFile, extractDir) {
    assertNonEmptyString(zipFile);
    assertNonEmptyString(extractDir);

    throwIfFileDoesNotExist(zipFile);
    throwIfDirDoesNotExist(extractDir);

    try {
        const { stdout, stderr } = await exec_promise(`unzip ${zipFile} -d ${extractDir}`);
        if (isNullishOrEmptyString(stdout)) {
            return /* undefined */
        }
        const lines = stdout.trim().split('\n');
        for (let i = 0; i < lines.length; ++i) {
            console.log(lines[i]);
        }
        return lines;
    } catch (err) { 
        if (err instanceof Error) {
            console.log(err.stack);
        }
    }
    return; /* undefined */
}

/**
 * @param {URL} zipFileURL
 * @param {string} outDir 
 */
export async function downloadAndUnzipZipFile(zipFileURL, outDir) {

    const parentDir = pathlib.dirname(outDir);
    if (!dirExists(parentDir)) {
        throw new CodeError(`Unzip task results failed. Directory '${parentDir}' does not exist`);
    }

    const tmpZipDir = await generateTmpPathname('zip-');

    await rmrfDir(tmpZipDir);

    // Cleanup previous downloads
    await rmrfDir(outDir);
    mkDirP(outDir);

    try {
        mkDirP(tmpZipDir);
        const buffer = await httpGETBinary(zipFileURL);
        await saveToBinaryFile(buffer, tmpZipDir, "results.zip");
        await unzip(pathlib.join(tmpZipDir, "results.zip"), outDir);
    } catch (err) {
        await rmrfDir(tmpZipDir);
        await rmrfDir(outDir);
        throw err;
    }

    await rmrfDir(tmpZipDir);
}
