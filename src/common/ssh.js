import assert from 'assert';
import path from 'path';
import { Client } from 'ssh2';
import * as sftp from 'ssh2-sftp-client';
import { isNullishOrEmptyString, removeSuffix, stringToPositiveInteger, throwIfNullishOrEmptyString } from './string.js';
import { CodeError, fail } from '../common/error.js';
import { dirExists, errorDirDoesNotExist, generateTmpPathname, rmrfDir, rmFileSync, saveToFile } from '../common/fs.js';
import { childProcessSpawn } from '../common/process.js';
import * as types from '../common/common-types.js';

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
 * @param {import('ssh2').ConnectConfig} connectConfig 
 */
export async function shutdown(connectConfig) {
    throwIfNullishOrEmptyString(connectConfig.privateKey);
    return _exec_node_ssh2(connectConfig, 'sudo shutdown -h now');
}

/**
 * @param {import('ssh2').ConnectConfig} connectConfig 
 * @param {string} remoteFile
 */
export async function rmrf(connectConfig, remoteFile) {
    throwIfNullishOrEmptyString(connectConfig.privateKey);
    return _exec_node_ssh2(connectConfig, `rm -rf ${remoteFile}`);
}

/**
 * @param {import('ssh2').ConnectConfig} connectConfig 
 */
export async function pwd(connectConfig) {
    throwIfNullishOrEmptyString(connectConfig.privateKey);
    const res = await _exec_shell_ssh_get(connectConfig, `pwd`);
    if (!res.ok) {
        return undefined;
    }
    return res.result.trim();
}

/**
 * @param {import('ssh2').ConnectConfig} connectConfig 
 * @param {string} remoteFile
 */
export async function cat(connectConfig, remoteFile) {
    throwIfNullishOrEmptyString(connectConfig.privateKey);
    const res = await _exec_shell_ssh_get(connectConfig, `cat ${remoteFile}`);
    if (!res.ok) {
        return undefined;
    }
    return res.result;
}

/**
 * @param {import('ssh2').ConnectConfig} connectConfig 
 * @param {string} remotePath
 */
export async function mkDirP(connectConfig, remotePath) {
    throwIfNullishOrEmptyString(connectConfig.privateKey);
    throwIfNullishOrEmptyString(remotePath);
    const res = await _exec_shell_ssh_get(connectConfig, `mkdir -p ${remotePath}`);
    return res.ok;
}

/**
 * @param {import('ssh2').ConnectConfig} connectConfig 
 * @param {string} cmd
 */
export async function exec(connectConfig, cmd) {
    throwIfNullishOrEmptyString(connectConfig.privateKey);
    throwIfNullishOrEmptyString(cmd);
    const res = await _exec_shell_ssh_get(connectConfig, cmd);
    return res.ok;
}

/**
 * @param {import('ssh2').ConnectConfig} connectConfig 
 * @param {string} cwd
 * @param {string[]} args
 * @param {types.progressCallback=} progressCb
 */
export async function ixcdv(connectConfig, cwd, args, progressCb) {
    if (!isNullishOrEmptyString(cwd)) {
        cwd = ` cd ${cwd} ;`
    } else {
        cwd = '';
    }
    const cmd = `source ~/.nvm/nvm.sh ;${cwd} ixcdv ${args.join(" ")}`;

    /** @type {((s:string) => void) | undefined} */
    let stdOutCallback = undefined;
    if (progressCb) {
        stdOutCallback = (s) => {
            const openPos = s.indexOf('{');
            const closePos = s.indexOf('}');
            if (openPos >= 0 && closePos >= 0 && openPos < closePos) {
                if (closePos === s.length - 1) {
                    s = s.substring(openPos);
                } else {
                    s = s.substring(openPos, closePos + 1);
                }
                const o = JSON.parse(s);
                const value = {
                    type: o.type,
                    state: o.state,
                    context: { name: o.name },
                }
                progressCb({ count: o.count, value, total: o.total })
            }
        }
    }

    // Must use shell ssh to get a readable output
    return _exec_shell_ssh_progress(connectConfig, cmd, stdOutCallback);
}

/**
 * @param {import('ssh2-sftp-client').ConnectOptions} connectConfig 
 * @param {string} str
 * @param {string} remoteFile
 */
export async function scpString(connectConfig, str, remoteFile) {
    const tmpFile = await generateTmpPathname("ssh-");
    try {
        const d = path.dirname(tmpFile);
        const f = path.basename(tmpFile);
        await saveToFile(str, d, f, { strict: true });
        await scp(connectConfig, tmpFile, remoteFile);
        rmFileSync(tmpFile);
    } catch (err) {
        rmFileSync(tmpFile);
        throw err;
    }
}

/**
 * @param {import('ssh2-sftp-client').ConnectOptions} connectConfig 
 * @param {string} localFile
 * @param {string} remoteFile
 */
export async function scp(connectConfig, localFile, remoteFile) {
    // Do not use the node module, it does not work!
    // using nodejs scp module
    const useNodeModule = false;
    if (useNodeModule) {
        const client = new sftp.default();
        try {
            await client.connect(connectConfig)
                .then(() => {
                    //client.fastPut(localFile, remoteFile);
                    client.put(localFile, remoteFile);
                })
            try { await client.end(); } catch { }
        } catch (err) {
            try { await client.end(); } catch { }
            throw err;
        }
    } else {
        await _exec_shell_scp_get(connectConfig, localFile, remoteFile);
    }
}

/**
 * @param {import('ssh2-sftp-client').ConnectOptions} connectConfig 
 * @param {string} remoteFile
 * @returns {Promise<{ exists: boolean, type?: 'file'|'dir'|'link' }>}
 */
export async function exists(connectConfig, remoteFile) {
    const client = new sftp.default();
    //client.debug = (message) => console.log(message);
    try {
        let result;
        await client.connect(connectConfig)
            .then(() => {
                return client.exists(remoteFile);
            })
            .then((data) => {
                result = data;
            });
        try { await client.end(); } catch { }
        if (result === false) {
            return { exists: false, type: undefined };
        }
        if (result === 'd') {
            return { exists: true, type: 'dir' };
        }
        if (result === 'l') {
            return { exists: true, type: 'link' };
        }
        return { exists: true, type: 'file' };
    } catch (err) {
        try { await client.end(); } catch { }
        throw err;
    }
}

/**
 * Execute ssh command using `ssh2` node module
 * @param {import('ssh2').ConnectConfig} connectConfig 
 * @param {string} cmd
 */
async function _exec_node_ssh2(connectConfig, cmd) {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        conn.on('error', (err) => {
            log(`'ssh ${cmd}': error ${err}`);
            reject(err);
        });
        conn.on('ready', () => {
            log(`'ssh ${cmd}': ready`);
            conn.exec(cmd, { pty: true }, (err, stream) => {
                log(`'ssh ${cmd}': started...`);
                stream.on('close', (/** @type {*} */code, /** @type {*} */signal) => {
                    log(`'ssh ${cmd}': exit code=${code}`);
                    conn.end();
                    resolve(true);
                }).on('data', (/** @type {*} */data) => {
                    log(`${data}`);
                }).stderr.on('data', (data) => {
                    log(`${data}`);
                });
            });
        });

        conn.connect(connectConfig);
    });
}

/**
 * Execute ssh command using `ssh` unix tool
 * @param {import('ssh2').ConnectConfig & { privateKeyFile?: string }} connectConfig 
 * @param {string} cmd
 */
export async function execProgress(connectConfig, cmd) {
    return _exec_shell_ssh_progress(connectConfig, cmd, undefined);
}
/**
* Execute ssh command using `ssh` unix tool
* @param {import('ssh2').ConnectConfig & { privateKeyFile?: string }} connectConfig 
* @param {string} cmd
* @param {((s:string) => void) | undefined} stdOutCallback
*/
async function _exec_shell_ssh_progress(connectConfig, cmd, stdOutCallback) {
    assert(connectConfig.username);
    assert(connectConfig.host);
    assert(connectConfig.port);
    assert(connectConfig.privateKeyFile);

    /** @type {?Object.<string,string>} */
    const env = {};

    return sshProgress(process.cwd(),
        [
            "-tt", /* MUST FORCE pseudo terminal allocation, -t is not enough */
            `${connectConfig.username}@${connectConfig.host}`,
            "-p", `${connectConfig.port}`,
            "-i", `${connectConfig.privateKeyFile}`,
            "-q",
            cmd
        ],
        env,
        stdOutCallback,
        { strict: true });
}

/**
 * Execute ssh command using `ssh` unix tool
 * @param {import('ssh2').ConnectConfig & { privateKeyFile?: string }} connectConfig 
 * @param {string} source
 * @param {string} target
 */
async function _exec_shell_scp_get(connectConfig, source, target) {
    assert(connectConfig.username);
    assert(connectConfig.host);
    assert(connectConfig.port);
    assert(connectConfig.privateKeyFile);

    /** @type {?Object.<string,string>} */
    const env = {};

    return scpGet(process.cwd(),
        [
            "-P", `${connectConfig.port}`,
            "-i", `${connectConfig.privateKeyFile}`,
            source,
            `${connectConfig.username}@${connectConfig.host}:${target}`
        ],
        env,
        { strict: true });
}

/**
 * Execute ssh command using `ssh` unix tool
 * @param {import('ssh2').ConnectConfig & { privateKeyFile?: string }} connectConfig 
 * @param {string} cmd
 */
async function _exec_shell_ssh_get(connectConfig, cmd) {
    assert(connectConfig.username);
    assert(connectConfig.host);
    assert(connectConfig.port);
    assert(connectConfig.privateKeyFile);

    /** @type {?Object.<string,string>} */
    const env = {};

    return sshGet(process.cwd(),
        [
            "-tt", /* MUST FORCE pseudo terminal allocation, -t is not enough */
            `${connectConfig.username}@${connectConfig.host}`,
            "-p", `${connectConfig.port}`,
            "-i", `${connectConfig.privateKeyFile}`,
            cmd
        ],
        env,
        { strict: true });
}

/**
* @param {!string} dir 
* @param {!string[]} args 
* @param {?Object.<string,string>} env 
* @param {((s:string) => void) | undefined} stdOutCallback
* @param {types.Strict=} options
* @returns {types.PromiseOkOrCodeError}
*/
async function sshProgress(dir, args, env, stdOutCallback, options = { strict: true }) {
    if (!dirExists(dir)) {
        return fail(errorDirDoesNotExist(dir), options);
    }

    /** @type {any} */
    const opts = {
        mergeProcessEnv: true,
        stdout: {
            return: false,
            print: true,
            callback: stdOutCallback
        },
        stderr: {
            return: false,
            print: true
        },
        spawnOptions: {
            cwd: dir
        }
    };

    if (stdOutCallback) {
        opts.stdout.print = false;
        opts.stderr.print = false;
    }

    if (env) {
        opts.spawnOptions.env = env;
    }

    const res = await childProcessSpawn('ssh', args, opts);

    if (res.code === 0) {
        return { ok: true }
    }

    return fail(
        new CodeError((res.stderr.out ?? '')),
        options);
}

/**
 * @param {!string} dir 
 * @param {!string[]} args 
 * @param {?Object.<string,string>} env 
 * @param {types.Strict=} options
 * @returns {types.PromiseResultOrCodeError<string>}
 */
export async function sshGet(dir, args, env, options = { strict: true }) {
    if (!dirExists(dir)) {
        return fail(errorDirDoesNotExist(dir), options);
    }

    /** @type {any} */
    const opts = {
        mergeProcessEnv: true,
        stdout: {
            trim: false,
            return: true
        },
        stderr: {
            return: true
        },
        spawnOptions: {
            cwd: dir,
        }
    };
    if (env) {
        opts.spawnOptions['env'] = env;
    }

    const res = await childProcessSpawn('ssh', args, opts);

    if (res.code === 0) {
        return { ok: true, result: res.stdout.out ?? '' }
    }

    const err = new CodeError((res.stderr.out ?? ''));

    if (options?.strict) {
        throw err;
    }
    return { ok: false, error: err };
}

/**
 * @param {!string} dir 
 * @param {!string[]} args 
 * @param {?Object.<string,string>} env 
 * @param {types.Strict=} options
 * @returns {types.PromiseResultOrCodeError<string>}
 */
export async function scpGet(dir, args, env, options = { strict: true }) {
    if (!dirExists(dir)) {
        return fail(errorDirDoesNotExist(dir), options);
    }

    /** @type {any} */
    const opts = {
        mergeProcessEnv: true,
        stdout: {
            trim: false,
            return: true
        },
        stderr: {
            return: true
        },
        spawnOptions: {
            cwd: dir,
        }
    };
    if (env) {
        opts.spawnOptions['env'] = env;
    }

    const res = await childProcessSpawn('scp', args, opts);

    if (res.code === 0) {
        return { ok: true, result: res.stdout.out ?? '' }
    }

    const err = new CodeError((res.stderr.out ?? ''));

    if (options?.strict) {
        throw err;
    }
    return { ok: false, error: err };
}
