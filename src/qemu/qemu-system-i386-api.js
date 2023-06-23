// Dependencies
// ../common
import * as types from '../common/common-types.js';
import * as path from 'path';
import assert from 'assert';
import { qemuSystemI386Get } from './qemu-system-i386-process.js';
import { dirExists, errorDirDoesNotExist, errorFileDoesNotExist, fileExists, getTmpDir, mkDirP, readObjectFromJSONFile, resolveAbsolutePath, rmrf, saveToFile, throwIfDirAlreadyExists, toAbsolutePath } from '../common/fs.js';
import { CodeError, fail, falseOrThrow } from '../common/error.js';
import { errorNullishOrEmptyString, isNullishOrEmptyString } from '../common/string.js';

import * as nodeUtil from 'util';
import { exec as childProcessExec } from 'child_process';
import { psGetArgs } from '../common/ps.js';
import { psGrepPIDAndArgs } from '../common/ps.js';
const exec_promise = nodeUtil.promisify(childProcessExec);

/**
 * Executes qemu-system-i386 --version
 * @param {types.Strict=} options
 * @returns {types.PromiseOkOrCodeError}
 */
export async function qemuSystemI386Version(options) {
    return qemuSystemI386Get(process.cwd(), ["--version"], null, options);
}

/**
 * @param {string} hda 
 * @param {string} cpu
 * @param {number} sshPort
 * @param {number[]} ports
 */
function get_qemu_cmd(hda, cpu, sshPort, ports) {
    let hostfwd = `hostfwd=tcp::${sshPort}-:22`;
    for (let i = 0; i < ports.length; ++i) {
        hostfwd += `,hostfwd=tcp::${ports[i]}-:${ports[i]}`;
    }
    const cmd = `qemu-system-x86_64 -hda ${hda} -cpu ${cpu} -machine accel=hvf -m 4G -display none -daemonize -netdev user,id=n0,${hostfwd} -device virtio-net-pci,netdev=n0`;
    return cmd;
}

/**
 * @param {string} hda 
 * @param {string} cpu 
 * @param {number} sshPort
 * @param {number[]} ports
 */
export async function qemuSystemI386IsRunning(hda, cpu, sshPort, ports) {
    if (!path.isAbsolute(hda)) {
        throw new CodeError('hda must be an absolute path');
    }
    hda = resolveAbsolutePath(hda);
    const cmd = get_qemu_cmd(hda, cpu, sshPort, ports);
    const pids = await psGrepPIDAndArgs(cmd);
    if (pids && pids.length > 0) {
        return true;
    }
    return false;
}

/**
 * @param {string} hda 
 * @param {string} cpu 
 * @param {number} sshPort
 * @param {number[]} ports
 */
export async function qemuSystemI386GetPID(hda, cpu, sshPort, ports) {
    if (!path.isAbsolute(hda)) {
        throw new CodeError('hda must be an absolute path');
    }
    hda = resolveAbsolutePath(hda);
    const cmd = get_qemu_cmd(hda, cpu, sshPort, ports);
    const pids = await psGrepPIDAndArgs(cmd);
    return pids;
}

/**
 * @param {string} hda 
 * @param {string} cpu 
 * @param {number} sshPort
 * @param {number[]} ports
 * @param {types.Strict=} strict
 * @returns {types.PromiseOkOrCodeError}
 */
export async function qemuSystemI386(hda, cpu, sshPort, ports, strict) {
    if (!fileExists(hda)) {
        return fail(errorFileDoesNotExist(hda), strict);
    }
    if (!path.isAbsolute(hda)) {
        return fail(new CodeError('hda must be an absolute path'), strict);
    }
    hda = resolveAbsolutePath(hda);
    
    const cmd = get_qemu_cmd(hda, cpu, sshPort, ports);

    try {
        // Use exec_promise instead of qemuSystemI386Get(...) which does not work...
        // args parse is failing.
        const { stdout, stderr } = await exec_promise(cmd);

        return { ok: true };
    } catch(err) {
        return fail(new CodeError(`${cmd} failed`), strict);
    }
}

/**
 * @param {string} hda 
 * @param {number} sshPort
 * @param {number[]} ports
 * @param {types.Strict=} strict
 * @returns {types.PromiseOkOrCodeError}
 */
export async function qemuSystemI386_2(hda, sshPort, ports, strict) {
    if (!fileExists(hda)) {
        return fail(errorFileDoesNotExist(hda), strict);
    }
    if (!path.isAbsolute(hda)) {
        return fail(new CodeError('hda must be an absolute path'), strict);
    }
    hda = resolveAbsolutePath(hda);
    let hostfwd = `hostfwd=tcp::${sshPort}-:22`;
    for (let i = 0; i < ports.length; ++i) {
        hostfwd += `,hostfwd=tcp::${ports[i]}-:${ports[i]}`;
    }

    const args = [
        "-hda", hda,
        "-cpu", "host",
        "-machine", "accel=hvf",
        "-device", "virtio-net-pci,netdev=n1",
        "-m", "4G",
        "-display", "none",
        "-daemonize",
        "-netdev", `user,id=n1,${hostfwd}`
    ];

    return qemuSystemI386Get(process.cwd(), args, null, strict);
}
