import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as pathlib from 'path'
import assert from 'assert';
import * as types from './types.js'
import * as ERROR_CODES from './error-codes.js'
import { fail, throwTypeError, CodeError, falseOrThrow, falseOrThrowAny, nullOrThrowAny } from './error.js'
import { assertNonEmptyString, errorNullishOrEmptyString, isNullishOrEmptyString, stringIsPositiveInteger, throwIfNullishOrEmptyString } from './string.js'
import fsext from 'fs-extra';
import { isPositiveInteger } from './number.js'
import { randomUUID } from 'crypto';
import { PROD_FILE_EXT, PROD_TMP_DIR } from './consts.js';

import * as nodeUtil from 'util';
import { exec as childProcessExec } from 'child_process';
import { fileURLToPath } from 'url';
const exec_promise = nodeUtil.promisify(childProcessExec);

const { moveSync: fsextmoveSync, move: fsextmove } = fsext;

/**
 * @private
 * @param {*} msgOrErr 
 */
function log(msgOrErr) {
    if (msgOrErr instanceof Error) {
        console.trace(msgOrErr);
    } else {
        console.log(msgOrErr);
    }
}

/**
 * - adds './' if missing
 * @param {string | null | undefined} absoluteFrom 
 * @param {string} absoluteTo 
 */
export function toRelativePath(absoluteFrom, absoluteTo) {
    throwIfNullishOrEmptyString(absoluteTo);
    if (!pathlib.isAbsolute(absoluteTo)) {
        throw new TypeError(`Path is not absolute (path=${absoluteTo}). `);
    }
    if (isNullishOrEmptyString(absoluteFrom)) {
        return absoluteTo;
    }
    assert(absoluteFrom);
    if (!pathlib.isAbsolute(absoluteFrom)) {
        throw new TypeError(`Path is not absolute (path=${absoluteFrom}). `);
    }
    const rel = pathlib.relative(absoluteFrom, absoluteTo);
    if (rel.startsWith('./') || rel.startsWith('../')) {
        return rel;
    }
    return "./" + pathlib.relative(absoluteFrom, absoluteTo);
}

/**
 * - POSIX portable characters are: [0-9],[a-z],[A-Z],-,_,.
 * @param {?string=} path 
 */
export function pathIsPOSIXPortable(path) {
    if (path == null || path == undefined) {
        return false;
    }
    if (typeof path !== 'string' || path.length == 0) {
        return false;
    }
    const regex = /^[-._0-9a-zA-Z\/]*$/g;
    const found = path.match(regex);
    return (found?.length === 1);
}

/**
 * - POSIX portable characters are: $,{,},[0-9],[a-z],[A-Z],-,_,.
 * @param {?string=} path 
 */
export function pathIsPOSIXPortableWithPlaceholders(path) {
    if (path == null || path == undefined) {
        return false;
    }
    if (typeof path !== 'string' || path.length == 0) {
        return false;
    }
    const regex = /^[}{$-._0-9a-zA-Z\/]*$/g;
    const found = path.match(regex);
    return (found?.length === 1);
}

/**
 * @param {string} from 
 * @param {string} to 
 * @param {object} options
 * @param {!boolean=} options.onlyPOSIXPortableWithPlaceholders
 * @param {!boolean=} options.onlyPOSIXPortable
 * @param {!boolean=} options.noWhiteSpace
 * @param {!boolean=} options.realpath
 */
export function toAbsolutePath(from, to, options = {}) {
    const d = pathlib.resolve(from, to);
    return resolveAbsolutePath(d, options);
}

/**
 * @param {string} from 
 * @param {string} to 
 */
export function toAbsolutePathWithPlaceholders(from, to) {
    const d = pathlib.resolve(from, to);
    return resolveAbsolutePath(d, { onlyPOSIXPortable: false });
}

/**
 * - `absolutePath` is null, undefined, empty or not a string : returns `cwd`
 * - if `onlyPOSIXPortable == true` throws an error if `absolutePath` contains
 * any non-POSIX-portable character.
 * - POSIX portable characters are: [0-9],[a-z],[A-Z],-,_,.
 * @param {!string} absolutePath 
 * @param {object} options
 * @param {!boolean=} options.onlyPOSIXPortableWithPlaceholders
 * @param {!boolean=} options.onlyPOSIXPortable
 * @param {!boolean=} options.noWhiteSpace
 * @param {!boolean=} options.realpath
 */
export function resolveAbsolutePath(absolutePath,
    {
        noWhiteSpace = true,
        onlyPOSIXPortableWithPlaceholders = true,
        onlyPOSIXPortable = true,
        realpath = false
    } = {}) {
    const np = pathlib.normalize(absolutePath);
    let rp = pathlib.resolve(np);
    if (realpath) {
        rp = fs.realpathSync(rp);
    }

    if (onlyPOSIXPortable) {
        if (!pathIsPOSIXPortable(rp)) {
            throwTypeError(`path is not POSIX portable (path='${rp}')`);
        }
    }
    if (noWhiteSpace) {
        if (rp.indexOf(' ') >= 0) {
            throwTypeError(`path contains white spaces (path='${rp}')`);
        }
    }
    if (onlyPOSIXPortableWithPlaceholders) {
        if (!pathIsPOSIXPortableWithPlaceholders(rp)) {
            throwTypeError(`path is not POSIX portable with placeholders (path='${rp}')`);
        }
    }
    return rp;
}

/**
 * If `strict = false` : 
 * - returns `true` if `path` is an existing directory
 * - returns `false` otherwise. Never throws an error
 * If `strict = true` : 
 * - returns `true` if `path` is an existing directory
 * - always throws an error otherwise
 * @param {!string} path 
 * @param {types.Strict=} options
 */
export function dirExists(path, options = { strict: false }) {
    try {
        if (isNullishOrEmptyString(path)) {
            throw null;
        }
        const dir = pathlib.resolve(path);
        const s = fs.statSync(dir);
        if (!s.isDirectory()) {
            throw null;
        }
        return true;
    } catch (err) {
        return falseOrThrow(errorDirDoesNotExist(path), options);
    }
}

/**
 * @see dirExists
 * @param {!string} path 
 * @param {types.Strict=} options
 */
export function parentDirExists(path, options = { strict: false }) {
    try {
        const parentDir = pathlib.dirname(path);
        return dirExists(parentDir, options);
    } catch (err) {
        return falseOrThrow(errorDirDoesNotExist(path), options);
    }
}

/**
 * Checks if something exists at `path`
 * If `strict = false` : 
 * - returns `true` if `path` exists
 * - returns `false` otherwise. Never throws an error
 * If `strict = true` : 
 * - returns `true` if `path` exists
 * - always throws an error otherwise
 * @param {!string} path 
 * @param {types.Strict=} options
 */
export function exists(path, options = { strict: false }) {
    try {
        if (isNullishOrEmptyString(path)) {
            throw null;
        }
        const p = pathlib.resolve(path);
        const s = fs.statSync(p);
        // in fact, s is always non-null according to the specs.
        return (s != null);
    } catch (err) {
        return falseOrThrow(errorFs(`'${path}' does not exist`), options);
    }
}

/**
 * Asynchronous.
 * If directory is empty:
 * - returns `true`
 * - returns `false` otherwise
 * - never throws an error
 * @param {!string} path 
 */
export async function dirIsEmpty(path) {
    try {
        const directory = await fsPromises.opendir(path);
        const entry = await directory.read();
        await directory.close();
        return entry === null;
    } catch (err) {
        return false;
    }
}

/**
 * Asynchronous.
 * If directory is empty:
 * - returns `true`
 * - returns `false` otherwise
 * - never throws an error
 * @param {!string} path 
 * @param {!string} exceptFile 
 */
export async function dirIsEmptyExcept(path, exceptFile) {
    try {
        const content = await fsPromises.readdir(path);
        if (!content || content.length !== 1) {
            return false;
        }
        return (content[0] === exceptFile);
    } catch (err) {
        return false;
    }
}

/**
 * Synchronous.
 * If directory is empty:
 * - returns `true`
 * - returns `false` otherwise
 * - never throws an error
 * @param {!string} path 
 */
export function dirIsEmptySync(path) {
    try {
        const directory = fs.opendirSync(path);
        const entry = directory.readSync();
        directory.closeSync();
        return entry === null;
    } catch (err) {
        return false;
    }
}

/**
 * - If `strict = false` : 
 *      - returns `true` if `path` is an existing file
 *      - returns `false` otherwise. Never throws an error
 * - If `strict = true` : 
 *      - returns `true` if `path` is an existing file
 *      - always throws an error otherwise
 * @param {!string} path 
 * @param {types.Strict} options
 */
export function fileExists(path, options = { strict: false }) {
    try {
        if (isNullishOrEmptyString(path)) {
            throw null;
        }
        let file = pathlib.resolve(path);
        let s = fs.statSync(file);
        if (!s.isFile()) {
            throw null;
        }
        return true;
    } catch (err) {
        return falseOrThrow(errorFileDoesNotExist(path), options);
    }
}

/**
 * - If `strict = false` : 
 *      - returns `true` if `path` is an existing symbolic link
 *      - returns `false` otherwise. Never throws an error
 * - If `strict = true` : 
 *      - returns `true` if `path` is an existing symbolic link
 *      - always throws an error otherwise
 * @param {!string} path 
 * @param {types.Strict} options
 */
export function isSymLinkSync(path, options = { strict: false }) {
    try {
        if (isNullishOrEmptyString(path)) {
            throw null;
        }
        let file = pathlib.resolve(path);
        let s = fs.lstatSync(file);
        if (!s.isSymbolicLink()) {
            throw null;
        }
        return true;
    } catch (err) {
        return falseOrThrow(errorFileDoesNotExist(path), options);
    }
}

/**
 * Checks if a file defined by its relative pathname exists
 * in a specified directory.
 * - If `strict = false` : 
 *      - returns `true` if `dir/relPath` is an existing file
 *      - returns `false` otherwise. Never throws an error
 * - If `strict = true` : 
 *      - returns `true` if `dir/relPath` is an existing file
 *      - always throws an error otherwise
 * @param {!string} dir 
 * @param {!string} relPath 
 * @param {types.Strict=} options
 */
export function fileExistsInDir(dir, relPath, options = { strict: false }) {
    if (isNullishOrEmptyString(dir)) {
        return falseOrThrow(errorNullishOrEmptyString(dir), options);
    }
    return fileExists(pathlib.join(dir, relPath), options);
}

/**
 * Synchronous equivalent to `rm <file>`
 * - returns `true` if `file` is not a string, empty, null or undefined
 * - returns `true` if `file` is not an existing file
 * - returns `true` if `file` was successfully deleted
 * - returns `false` if any error was raised
 * @param {!string} file 
 */
export function rmFileSync(file) {
    if (!fileExists(file)) {
        return true;
    }
    try {
        fs.rmSync(file);
    } catch (e) {
        return false;
    }
    return true;
}

/**
 * Asynchronous equivalent to `rm <file>`
 * - returns `true` if `file` is not a string, empty, null or undefined
 * - returns `true` if `file` is not an existing file
 * - returns `true` if `file` was successfully deleted
 * - returns `false` if any error was raised
 * @param {!string} file 
 */
export async function rmFile(file) {
    if (!fileExists(file)) {
        return true;
    }
    try {
        await fsPromises.rm(file);
    } catch (e) {
        return false;
    }
    return true;
}

/**
 * Asynchronous equivalent to `rm -rf <path>`
 * - If `strict = false` : 
 *      - returns `true` if `rm -rf` succeeded
 *      - returns `false` otherwise
 * - If `strict = true` : 
 *      - returns `true` if `rm -rf` succeeded
 *      - throws an error otherwise
 * @param {!string} path 
 * @param {types.Strict=} options
 */
export async function rmrf(path, options = { strict: false }) {
    if (options.strict) {
        return fsPromises.rm(path, { recursive: true, force: true })
            .then((value) => {
                return true;
            });
    } else {
        return fsPromises.rm(path, { recursive: true, force: true })
            .then((value) => {
                return true;
            }, (reason) => {
                log(reason);
                return false;
            });
    }
}

/**
 * Asynchronous equivalent to `rm -rf <dir>`
 * - If `strict = false` : 
 *      - returns `false` if `dir` is not a directory
 *      - returns `true` if `rm -rf` succeeded
 *      - returns `false` otherwise
 * - If `strict = true` : 
 *      - throws an error if `dir` is not a directory
 *      - returns `true` if `rm -rf` succeeded
 *      - throws an error otherwise
 * @param {!string} dir 
 * @param {types.Strict=} options
 */
export async function rmrfDir(dir, options = { strict: false }) {
    if (!dirExists(dir, options)) {
        return false;
    }
    return rmrf(dir, options);
}

/**
 * @param {!string} srcDir 
 * @param {!string} dstDir 
 * @param {types.Strict=} options
 */
export function moveDirSync(srcDir, dstDir, options = { strict: false }) {
    if (!dirExists(srcDir, options)) {
        return false;
    }
    if (!parentDirExists(dstDir, options)) {
        return false;
    }
    try {
        fsextmoveSync(srcDir, dstDir);
        return true;
    } catch (err) {
        return falseOrThrowAny(err, options);
    }
}

/**
 * @param {!string} srcDir 
 * @param {!string} dstDir 
 * @param {types.Strict=} options
 */
export async function moveDir(srcDir, dstDir, options = { strict: false }) {
    if (!dirExists(srcDir, options)) {
        return false;
    }
    if (!parentDirExists(dstDir, options)) {
        return false;
    }
    try {
        await fsextmove(srcDir, dstDir);
        return true;
    } catch (err) {
        return falseOrThrowAny(err, options);
    }
}

/**
 * @param {!string} srcFile
 * @param {!string} dstFile 
 * @param {types.Strict=} options
 */
export async function moveFileSync(srcFile, dstFile, options = { strict: false }) {
    if (!fileExists(srcFile, options)) {
        return false;
    }
    if (fileExists(dstFile, options)) {
        return false;
    }
    if (!parentDirExists(dstFile, options)) {
        return false;
    }
    try {
        fsextmoveSync(srcFile, dstFile);
        return true;
    } catch (err) {
        return falseOrThrowAny(err, options);
    }
}

/**
 * Synchronous equivalent to 'mkdir -p'
 * - If `strict = false` : 
 *      - returns `true` if directory already exists
 *      - returns `true` if new directory was successfully created
 *      - returns `false` otherwise
 * - If `strict = true` : 
 *      - returns `true` if directory already exists
 *      - returns `true` if new directory was successfully created
 *      - always throws an error otherwise
 * @param {string} path 
 * @param {types.Strict=} options
 */
export function mkDirP(path, options = { strict: false }) {
    try {
        const dir = pathlib.resolve(path);
        if (fs.existsSync(path)) {
            const s = fs.statSync(dir);
            if (s.isDirectory()) {
                return true;
            }
            return falseOrThrow(
                errorFs(`create directory at ${path} failed.`),
                options);
        }
        fs.mkdirSync(path, { recursive: true });
        return true;
    } catch (err) {
        return falseOrThrowAny(err, options);
    }
}

/**
 * Synchronous equivalent to 'mkdir'
 * - If `strict = false` : 
 *      - returns `true` if directory already exists
 *      - returns `true` if new directory was successfully created
 *      - returns `false` otherwise
 * - If `strict = true` : 
 *      - returns `true` if directory already exists
 *      - returns `true` if new directory was successfully created
 *      - always throws an error otherwise
 * @param {string} path 
 * @param {types.Strict=} options
 */
export function mkDir(path, options = { strict: false }) {
    try {
        const dir = pathlib.resolve(path);
        if (fs.existsSync(dir)) {
            const isDir = dirExists(dir);
            if (isDir) {
                return true;
            }
            return falseOrThrow(
                errorFs(`create directory at ${path} failed.`),
                options);
        }
        fs.mkdirSync(dir);
        return true;
    } catch (err) {
        return falseOrThrowAny(err, options);
    }
}

/**
 * Asynchronously executes `cp -R <src> <dst>`
 * @param {!string} srcDir 
 * @param {!string} dstDir 
 */
export async function cprfDir(srcDir, dstDir) {
    assertNonEmptyString(srcDir);
    assertNonEmptyString(dstDir);

    if (!dirExists(srcDir)) {
        return false;
    }
    if (exists(dstDir)) {
        return false;
    }

    try {
        const { stdout, stderr } = await exec_promise(`cp -R '${srcDir}' '${dstDir}'`);
        return true;
    } catch { }
    return false;
}

/**
 * Synchronously parse a json file an always returns a non-null js `object`
 * - If `strict = false` : 
 *      - returns a non-null `object` if json file has been successfully parsed
 *      - returns `null` if json file does not exist
 *      - returns `null` if parsing failed or is not an object
 * - If `strict = true` : 
 *      - returns a non-null `object` if json file has been successfully parsed
 *      - always throws an error otherwise
 * @param {!string} file 
 * @param {types.Strict=} options
 */
export function readObjectFromJSONFileSync(file, options = { strict: false }) {
    if (!fileExists(file, options)) {
        return null;
    }
    try {
        const json = fs.readFileSync(file, { encoding: 'utf8' });
        const obj = JSON.parse(json);
        if (!obj || typeof obj !== 'object') {
            throw new TypeError(`json convertion is not an object`);
        }
        return obj;
    } catch (err) {
        return nullOrThrowAny(err, options);
    }
}

/**
 * Asynchronously parse a json file an always returns a non-null js `object`
 * - If `strict = false` : 
 *      - returns a non-null `object` if json file has been successfully parsed
 *      - returns `null` if json file does not exist
 *      - returns `null` if parsing failed or is not an object
 * - If `strict = true` : 
 *      - returns a non-null `object` if json file has been successfully parsed
 *      - always throws an error otherwise
 * @param {!string} file 
 * @param {types.Strict=} options
 */
export async function readObjectFromJSONFile(file, options = { strict: false }) {
    if (!fileExists(file, options)) {
        return null;
    }
    try {
        const json = await fsPromises.readFile(file, { encoding: 'utf8' });
        const obj = JSON.parse(json);
        if (!obj || typeof obj !== 'object') {
            throw new TypeError(`json convertion is not an object`);
        }
        return obj;
    } catch (err) {
        return nullOrThrowAny(err, options);
    }
}

/**
 * Synchronously read a file and returns an array of string.
 * {one line / one string} entry in the array.
 * - If `strict = false` : 
 *      - returns a non-null `array` if file has been successfully parsed
 *      - returns `null` if file does not exist
 *      - returns `null` if parsing failed
 * - If `strict = true` : 
 *      - returns a non-null `array` if file file has been successfully parsed
 *      - always throws an error otherwise
 * @param {!string} file 
 * @param {types.Strict=} options
 */
export function readFileLineByLineSync(file, options = { strict: false }) {
    if (!fileExists(file, options)) {
        return null;
    }
    try {
        const str = fs.readFileSync(file, { encoding: 'utf8' });
        return str.split('\n');
        //return str.split('/\r?\n/');
    } catch (err) {
        return nullOrThrowAny(err, options);
    }
}

/**
 * Synchronously read a file and returns its content as a string.
 * - If `strict = false` : 
 *      - returns a non-null `string` if file has been successfully read
 *      - returns `null` if file does not exist
 *      - returns `null` if reading failed
 * - If `strict = true` : 
 *      - returns a non-null `string` if file file has been successfully read
 *      - always throws an error otherwise
 * @param {!string} file 
 * @param {types.Strict=} options
 */
export function readFileSync(file, options = { strict: false }) {
    if (!fileExists(file, options)) {
        return null;
    }
    try {
        return fs.readFileSync(file, { encoding: 'utf8' });
    } catch (err) {
        return nullOrThrowAny(err, options);
    }
}

/**
 * Asynchronously read a file and returns its content as a string.
 * - If `strict = false` : 
 *      - returns a non-null `string` if file has been successfully read
 *      - returns `null` if file does not exist
 *      - returns `null` if reading failed
 * - If `strict = true` : 
 *      - returns a non-null `string` if file file has been successfully read
 *      - always throws an error otherwise
 * @param {!string} file 
 * @param {types.Strict=} options
 */
export async function readFile(file, options = { strict: false }) {
    if (!fileExists(file, options)) {
        return null;
    }
    try {
        return fsPromises.readFile(file, { encoding: 'utf8' });
    } catch (err) {
        return nullOrThrowAny(err, options);
    }
}

/**
 * Asynchronously appends `str` to `file`. 
 * Does not create `file` if it does not exist.
 * Equivalent to `echo "${str}" >> "${file}"`
 * - If `strict = false` : 
 *      - returns `true` if `str` was successfully appended to `file`
 *      - returns `false` if `file` does not exist
 *      - returns `false` if operation failed
 * - If `strict = true` : 
 *      - returns `true` if `str` was successfully appended to `file`
 *      - throws an error if `file` does not exist
 *      - throws an error if failed
 * @param {!string} file 
 * @param {!string} str 
 * @param {types.Strict=} options
 */
export async function appendExistingFile(file, str, options = { strict: false }) {
    if (!fileExists(file, options)) {
        return false;
    }
    try {
        fsPromises.appendFile(file, str)
        return true;
    } catch (err) {
        return falseOrThrowAny(err, options);
    }
}

/**
 * Synchronously save file 
 * - If `strict = false` : 
 *      - returns `true` if the file has been saved successfully.
 *      - returns `false` otherwise
 * - If `strict = true` : 
 *      - returns `true` if the file has been saved successfully.
 *      - always throws an error otherwise
 * @param {!string} str 
 * @param {!string} directory 
 * @param {!string} filename 
 * @param {types.Strict} options
 */
export function saveToFileSync(str, directory, filename, options = { strict: false }) {
    try {
        throwIfNullishOrEmptyString(str);
        throwIfNullishOrEmptyString(filename);

        if (!dirExists(directory, options)) {
            return false;
        }

        const path = directory + '/' + filename;
        fs.writeFileSync(path, str, { encoding: 'utf8' });
        return true;
    } catch (err) {
        return falseOrThrowAny(err, options);
    }
}

/**
 * Asynchronously parse a json file an always returns a non-null js `object`
 * - If `strict = false` : 
 *      - returns `true` if the file has been saved successfully.
 *      - returns `false` otherwise
 * - If `strict = true` : 
 *      - returns `true` if the file has been saved successfully.
 *      - always throws an error otherwise
 * @param {!string} str 
 * @param {!string} directory 
 * @param {!string} filename 
 * @param {types.Strict} options
 */
export async function saveToFile(
    str,
    directory,
    filename,
    options = { strict: false }
) {
    try {
        throwIfNullishOrEmptyString(str);
        throwIfNullishOrEmptyString(filename);

        if (!dirExists(directory, options)) {
            return false;
        }

        const path = directory + '/' + filename;
        await fsPromises.writeFile(path, str, { encoding: 'utf8' });
        return true;
    } catch (err) {
        return falseOrThrowAny(err, options);
    }
}

/**
 * Asynchronously parse a json file an always returns a non-null js `object`
 * - If `strict = false` : 
 *      - returns `true` if the file has been saved successfully.
 *      - returns `false` otherwise
 * - If `strict = true` : 
 *      - returns `true` if the file has been saved successfully.
 *      - always throws an error otherwise
 * @param {!Buffer} buffer 
 * @param {!string} directory 
 * @param {!string} filename 
 * @param {types.Strict} options
 */
export async function saveToBinaryFile(
    buffer,
    directory,
    filename,
    options = { strict: false }
) {
    try {
        throwIfNullishOrEmptyString(filename);

        if (!dirExists(directory, options)) {
            return false;
        }

        const path = directory + '/' + filename;
        await fsPromises.writeFile(path, buffer, { encoding: 'binary' });
        return true;
    } catch (err) {
        return falseOrThrowAny(err, options);
    }
}

/**
 * @param {!string} path 
 */
export function readPidFile(path) {
    try {
        const lines = readFileLineByLineSync(path);
        if (lines == null || lines.length == 0) {
            return; /* undefined */
        }
        const str = lines[0].trim();
        if (stringIsPositiveInteger(str)) {
            const pid = Number.parseInt(str);
            assert(isPositiveInteger(pid));
            return pid;
        }
        return; /* undefined */
    }
    catch (err) { }
    return; /* undefined */
}

/**
 * Synchronously executes `chmod u+x` on the specified file.
 * @param {!string} filename 
 * @param {types.Strict} options
 */
export function chmodUXSync(filename, options = { strict: false }) {
    if (!fileExists(filename, options)) {
        return false;
    }
    try {
        fs.chmodSync(filename, 0o740);
        return true;
    } catch (err) {
        return falseOrThrowAny(err, options);
    }
}

/**
 * Executes : `which <programName>`
 * - Returns `undefined` if failed.
 * @param {string} programName 
 */
export async function which(programName) {
    assertNonEmptyString(programName);

    try {
        const { stdout, stderr } = await exec_promise(`which '${programName}'`);
        return stdout.trim();
    } catch { }
    return; /* undefined */
}

/**
 * Takes anything as input and try to identify 
 * if refers to a local file, a local directory or an url
 * - If `value` refers to a directory
 *     - `url` = file:///path/to/directory
 *     - `pathname` = /path/to/directory
 *     - `directory` = /path/to/directory
 * - If `value` refers to a file
 *     - `url` = file:///path/to/file
 *     - `pathname` = /path/to/file
 *     - `file` = /path/to/file
 * - If `value` refers to a `file://` URL
 *     - `url` = file:///path/to/something
 *     - `pathname` = /path/to/something
 *     - if `pathname` is a directory
 *          - `directory` = /path/to/something
 *     - if `pathname` is a file
 *          - `file` = /path/to/something
 * - If `value` refers to a `http://` URL
 *     - `url` = http://...
 * @param {*} value
 * @returns {?{raw:!(string | URL), url?:!URL, pathname?:!string, file?:!string, directory?:!string }} 
 */
export function parsePathnameOrUrl(value) {
    if (!value) {
        return null;
    }

    let pathname;
    let url;

    if (!(value instanceof URL)) {
        try { url = new URL(value); } catch { }
        if (url) {
            value = url;
        } else {
            pathname = value;
        }
    }

    if (value instanceof URL) {
        if (value.protocol === 'file:') {
            pathname = value.pathname;
            url = value;
        } else {
            return { raw: value, url: value };
        }
    }

    if (isNullishOrEmptyString(pathname)) {
        return null;
    }

    pathname = resolveAbsolutePath(pathname);
    if (!url) {
        url = new URL("file://" + pathname);
    }

    let fsStats;
    try { fsStats = fs.statSync(pathname); } catch { }
    if (fsStats?.isDirectory()) {
        return { raw: value, url: url, pathname: pathname, directory: pathname };
    }
    if (fsStats?.isFile()) {
        return { raw: value, url: url, pathname: pathname, file: pathname };
    }
    return null;
}

/**
 * @param {string[]} strArr 
 * @param {string[]} replaceArr
 * @param {string} file 
 */
export async function replaceInFile(strArr, replaceArr, file) {
    if (!strArr || strArr.length == 0) {
        return true;
    }
    assert(replaceArr.length === strArr.length);

    file = resolveAbsolutePath(file);
    if (!fileExists(file)) {
        return false;
    }

    let fileStr;
    try {
        fileStr = await fsPromises.readFile(file, { encoding: 'utf8' });
    } catch (err) {
        return false;
    }

    let fileStrReplaced = fileStr;
    for (let i = 0; i < strArr.length; ++i) {
        const str = strArr[i];
        const replace = replaceArr[i];
        if (fileStr.indexOf(str) < 0) {
            continue;
        }
        try {
            fileStrReplaced = fileStrReplaced.replaceAll(str, replace);
        } catch (err) {
            return false;
        }
    }

    try {
        await fsPromises.writeFile(file, fileStrReplaced, { encoding: 'utf8' });
    } catch (err) {
        return false;
    }

    return true;
}

/**
 * @param {string} str 
 * @param {string} replace 
 * @param {string} file 
 * @param {string=} separator 
 */
export async function replaceInFileUsingSed(str, replace, file, separator) {
    if (isNullishOrEmptyString(str)) {
        return true;
    }
    file = resolveAbsolutePath(file);
    if (!fileExists(file)) {
        return false;
    }
    if (separator) {
        assert(!isNullishOrEmptyString(separator));
        assert(separator.length === 1);
    } else {
        separator = '/';
    }

    const bakext = `.${PROD_FILE_EXT}bak`;
    const bakFile = file + bakext;

    let ok = true;
    try {
        // Do not use the '-i' option ! Not POSIX !
        // Executes : `sed -e <pattern> <file> > <file.bak>`
        const { stdout, stderr } = await exec_promise(`sed -e 's${separator}${str}${separator}${replace}${separator}g' ${file} > ${bakFile}`);
    } catch (err) {
        ok = false;
    }

    if (!ok) {
        // something went wrong, delete replaced-file
        await rmFile(bakFile);
        return false;
    }

    if (fileExists(bakFile)) {
        // delete existing file
        if (!await rmFile(file)) {
            return false;
        }
        // replace by new file
        if (!moveFileSync(bakFile, file, { strict: false })) {
            return false;
        }
    }

    return true;
}

/**
 * Throws an exception if failed.
 * @param {string} file 
 */
export async function shasum256(file) {
    throwIfFileDoesNotExist(file);

    const { stdout, stderr } = await exec_promise(`shasum -a 256 ${file}`);
    const i = stdout.indexOf(' ');
    if (i < 0) {
        assert(stdout.length === 64);
        return stdout;
    } else {
        const s = stdout.substring(0, i);
        assert(s.length === 64);
        return s;
    }
}

/**
 * @param {string} sourceFile 
 * @param {string} linkName 
 */
export async function lns(sourceFile, linkName) {
    if (exists(linkName)) {
        throw new CodeError(`Destination already exists ${linkName}`);
    }
    if (fileExists(sourceFile)) {
        await fsPromises.symlink(sourceFile, linkName, 'file');
        return;
    }
    if (dirExists(sourceFile)) {
        await fsPromises.symlink(sourceFile, linkName, 'dir');
        return;
    }
    throw new CodeError(`Unsupported source file type ${sourceFile} (not a file, not a directory)`);
}

export function getTmpDir() {
    return PROD_TMP_DIR;
}

export function getTemplatesDir() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = pathlib.dirname(__filename);

    const dir = pathlib.join(__dirname, "../../scripts");
    assert(dirExists(dir));
    return dir;
}

/**
 * @param {string=} prefix 
 */
export async function generateTmpPathname(prefix) {
    const uuid = randomUUID().replaceAll('-', '');
    if (!prefix || isNullishOrEmptyString(prefix)) {
        return pathlib.join(PROD_TMP_DIR, uuid);
    }
    return pathlib.join(PROD_TMP_DIR, prefix + uuid);
}

/** @param {*} file */
export function throwIfFileDoesNotExist(file) {
    if (!fileExists(file, { strict: false })) {
        throw errorFileDoesNotExist(file);
    }
}

/** @param {*} file */
export function throwIfFileAlreadyExists(file) {
    if (fileExists(file, { strict: false })) {
        throw errorFileAlreadyExists(file);
    }
}

/** @param {*} dir */
export function throwIfDirDoesNotExist(dir) {
    if (!dirExists(dir, { strict: false })) {
        throw errorDirDoesNotExist(dir);
    }
}

/** @param {*} dir */
export function throwIfParentDirDoesNotExist(dir) {
    if (!parentDirExists(dir, { strict: false })) {
        throw errorDirDoesNotExist(pathlib.dirname(dir));
    }
}

/** @param {*} dir */
export function throwIfDirAlreadyExists(dir) {
    if (dirExists(dir, { strict: false })) {
        throw errorDirAlreadyExists(dir);
    }
}

/** @param {*} path */
export function throwIfNotAbsolutePath(path) {
    if (!pathlib.isAbsolute(path)) {
        throw errorNotAbsolutePath(path);
    }
}

/**
 * @param {object} args
 * @param {*} args.dir 
 * @param {types.StrictLike=} args.strict
 */
export function failDirDoesNotExist({ dir, strict }) {
    return fail(errorDirDoesNotExist(dir), strict);
}

/**
 * @param {object} args
 * @param {*} args.dir 
 * @param {types.StrictLike=} args.strict
 */
export function failDirAlreadyExists({ dir, strict }) {
    return fail(errorDirAlreadyExists(dir), strict);
}

/**
 * @param {object} args
 * @param {*} args.file 
 * @param {types.StrictLike=} args.strict
 */
export function failFileDoesNotExist({ file, strict }) {
    return fail(errorFileDoesNotExist(file), strict);
}

/**
 * @param {object} args
 * @param {*} args.file 
 * @param {types.StrictLike=} args.strict
 */
export function failFileAlreadyExists({ file, strict }) {
    return fail(errorFileAlreadyExists(file), strict);
}

/** @param {*} dir */
export function errorDirDoesNotExist(dir) {
    return new CodeError(
        `directory '${dir}' does not exist`,
        ERROR_CODES.DIRECTORY_DOES_NOT_EXIST
    );
}

/** @param {*} path */
export function errorNotAbsolutePath(path) {
    return new CodeError(
        `path '${path}' is not absolute`,
        ERROR_CODES.FS_ERROR
    );
}

/** @param {*} dir */
export function errorDirAlreadyExists(dir) {
    return new CodeError(
        `directory '${dir}' already exists`,
        ERROR_CODES.DIRECTORY_ALREADY_EXISTS
    );
}

/** @param {*} file */
export function errorFileDoesNotExist(file) {
    return new CodeError(
        `file '${file}' does not exist`,
        ERROR_CODES.FILE_DOES_NOT_EXIST
    );
}

/** @param {*} file */
export function errorFileAlreadyExists(file) {
    return new CodeError(
        `file '${file}' already exists`,
        ERROR_CODES.FILE_ALREADY_EXIST
    );
}

/** @param {string} msg */
export function errorFs(msg) {
    return new CodeError(
        msg,
        ERROR_CODES.FS_ERROR
    );
}
