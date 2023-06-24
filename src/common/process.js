import * as child_process from 'child_process'
import { Socket } from 'net';
import { WriteStream as ttyWriteStream, ReadStream as ttyReadStream } from 'tty';
import { throwIfNullishOrEmptyString } from './string.js';
import { sleep } from './utils.js';

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
 * Either 'code', 'signal' or 'error' is not null
@typedef ChildProcessOutput
@type {object}
    @property {ChildProcessStreamOutput} stdout
    @property {ChildProcessStreamOutput} stderr
    @property {?number=} code can be null
    @property {?string=} signal can be null
    @property {!Error=} error
    @property {boolean=} spawned
    @property {boolean=} closed
    @property {boolean=} exited
    @property {boolean=} disconnected
*/

/**
@typedef ChildProcessStreamOutput
@type {object}
    @property {!string=} out
    @property {!Error=} error
    @property {boolean=} closed
    @property {boolean=} ended
    @property {Error=} error
    @property {number} dataLength
*/

/**
 * @typedef ChildProcessSpawnOptions
 * @type {object}
 * @property {ChildProcessStreamOptions=} stdout
 * @property {ChildProcessStreamOptions=} stderr
 * @property {boolean=} mergeProcessEnv
 * @property {boolean=} logEvents
 * @property {child_process.SpawnOptions=} spawnOptions
 */

/**
 * @typedef ChildProcessStreamOptions
 * @type {object}
 * @property {boolean=} return
 * @property {boolean=} print
 * @property {boolean=} trim
 * @property {((s:string) => void)=} callback
 * @property {('default' | 'stdout' | 'stderr' | 'dev/null')=} redirect
 */

/** @type {ChildProcessStreamOptions} */
const DEFAULT_CHILD_PROCESS_STREAM_OPTIONS = {
    return: true,
    print: false,
    trim: true,
    redirect: 'default'
}

// ----------------------------- SpawnOptions ---------------------------------
// - 'cwd'           : <string> | <URL> Current working directory of the child process.
// - 'env'           : <Object> Environment key-value pairs. Default: process.env.
// - 'argv0'         : <string> Explicitly set the value of argv[0] sent to the child 
//                     process. This will be set to command if not specified.
// - 'stdio'         : <Array> | <string> Child's stdio configuration (see options.stdio).
// - 'detached'      : <boolean>
// - 'uid'           : <number> Sets the user identity of the process (see setuid(2)).
// - 'gid'           : <number> Sets the group identity of the process (see setgid(2)).
// - 'serialization' : <string> Specify the kind of serialization used for sending messages
//                     between processes. Possible values are 'json' and 'advanced'. 
//                     See Advanced serialization for more details. Default: 'json'.
// - shell           : <boolean> | <string> If true, runs command inside of a shell. 
//                     Uses '/bin/sh' on Unix, and process.env.ComSpec on Windows.
//                     A different shell can be specified as a string. See Shell requirements
//                     and Default Windows shell. Default: false (no shell).
// - 'signal'        : <AbortSignal> allows aborting the child process using an AbortSignal. 
// - 'timeout'       : <number> In milliseconds the maximum amount of time the process 
//                     is allowed to run. Default: undefined.
// - 'killSignal'    : <string> | <integer> The signal value to be used when the spawned
//                     process will be killed by timeout or abort signal. Default: 'SIGTERM'.
//
// - 'windowsVerbatimArguments' : <boolean> No quoting or escaping of arguments is 
//                                done on Windows. Ignored on Unix. This is set to 
//                                true automatically when shell is specified and 
//                                is CMD. Default: false.
// - 'windowsHide'              : <boolean> Hide the subprocess console window 
//                                that would normally be created on Windows systems. 
//                                Default: false.
// ----------------------------------------------------------------------------

/**
 * @param {!string} command 
 * @param {!string[]} args 
 * @param {ChildProcessSpawnOptions=} options 
 * @returns {Promise<ChildProcessOutput>} either 'code', 'signal' or 'error' is not null
 */
export function childProcessSpawn(command, args, options) {
    return new Promise((resolve, reject) => {
        const argsStr = args.join(' ').trim();
        const cli = (argsStr.length > 0) ? command + ' ' + argsStr : command;
        const cliShort = (cli.length > 64) ? cli.substring(61) + '...' : cli;

        /**
         * Some events can be called multiple times.
         * Therefore, to avoid mutliple calls of 'resolve' or 'reject'
         * promise function, we use the 'guard' property.
         */
        const processExec = {
            /** @type {boolean} */
            guard: false,
            /** @type {ChildProcessOutput} */
            output: {
                stdout: { out: '', dataLength: 0 },
                stderr: { out: '', dataLength: 0 }
            },
            options: {
                logEvents: false,
                /** @type {ChildProcessStreamOptions} */
                stdout: { ...DEFAULT_CHILD_PROCESS_STREAM_OPTIONS, ...options?.stdout },
                /** @type {ChildProcessStreamOptions} */
                stderr: { ...DEFAULT_CHILD_PROCESS_STREAM_OPTIONS, ...options?.stderr },
            }
        };

        if (!options) {
            options = {}
        }
        if (!options.spawnOptions) {
            options.spawnOptions = {};
        }

        // env
        if (!options.hasOwnProperty('mergeProcessEnv')) {
            options.mergeProcessEnv = true;
        }
        if (options.mergeProcessEnv) {
            /** @type {NodeJS.ProcessEnv} */
            const env = {};
            Object.assign(env, process.env);
            Object.assign(env, options.spawnOptions.env);
            options.spawnOptions.env = env;
        }

        // stdio
        /** @type {child_process.StdioOptions} */
        let stdio = ['pipe', 'inherit', 'inherit'];
        if (!options.spawnOptions.stdio) {
            stdio = ['pipe', 'inherit', 'inherit'];
        } else if (!Array.isArray(options.spawnOptions.stdio)) {
            const enumStr = options.spawnOptions.stdio;
            throwIfNullishOrEmptyString(enumStr);
            stdio = [enumStr, enumStr, enumStr];
        } else {
            stdio = options.spawnOptions.stdio;
        }

        const returnStdout = processExec.options.stdout.return;
        const printStdout = processExec.options.stdout.print;
        const callbackStdout = !!processExec.options.stdout.callback;
        if ((returnStdout === true) || (callbackStdout === true)) {
            // 'pipe' is the only available way to intercept the process output
            stdio[1] = 'pipe';
        } else if (printStdout !== undefined) {
            if (printStdout) {
                // must print
                if (stdio[1] !== 'pipe' && stdio[1] !== 'inherit') {
                    stdio[1] = 'inherit';
                }
            } else {
                // must not print
                if (stdio[1] === 'inherit') {
                    stdio[1] = 'ignore';
                }
            }
        }

        const returnStderr = processExec.options.stderr.return;
        const printStderr = processExec.options.stdout.print;
        if (returnStderr !== undefined && returnStderr) {
            // 'pipe' is the only available way to intercept the process output
            stdio[2] = 'pipe';
        } else if (printStderr !== undefined) {
            if (printStderr) {
                // must print
                if (stdio[2] !== 'pipe' && stdio[2] !== 'inherit') {
                    stdio[2] = 'inherit';
                }
            } else {
                // must not print
                if (stdio[2] === 'inherit') {
                    stdio[2] = 'ignore';
                }
            }
        }
        options.spawnOptions.stdio = stdio;

        processExec.options.logEvents = !!(options.logEvents);

        const child = child_process.spawn(command, args, options.spawnOptions);

        // ----------------------- stream events --------------------------
        // - close
        // - data
        // - end
        // - error
        // - pause
        // - readable 
        // - resume 
        // ---------------------------------------------------------------

        // ----------------------- child.stdout --------------------------
        // A Readable Stream that represents the child process's stdout.
        // If the child was spawned with stdio[1] set to anything other 
        // than 'pipe', then this will be null.
        // subprocess.stdout is an alias for subprocess.stdio[1]. 
        // Both properties will refer to the same value.
        // The subprocess.stdout property can be null if the child process
        // could not be successfully spawned.
        // ---------------------------------------------------------------

        // == null if options.stdio[1] !== 'pipe'
        if (child.stdout) {
            child.stdout.setEncoding('utf8');

            // --------------------- child.stdout.data --------------------
            // The 'data' event is emitted whenever the stream is 
            // relinquishing ownership of a chunk of data to a consumer. 
            // This may occur whenever the stream is switched in flowing 
            // mode by calling readable.pipe(), readable.resume(), or by 
            // attaching a listener callback to the 'data' event. The 'data' 
            // event will also be emitted whenever the readable.read() 
            // method is called and a chunk of data is available to be 
            // returned.
            // Attaching a 'data' event listener to a stream that has 
            // not been explicitly paused will switch the stream into 
            // flowing mode. Data will then be passed as soon as it is 
            // available. The listener callback will be passed the 
            // chunk of data as a string if a default encoding has been
            // specified for the stream using the readable.setEncoding() 
            // method; otherwise the data will be passed as a Buffer.
            // ------------------------------------------------------------

            child.stdout.on('data', function (data) {
                processExec.output.stdout.dataLength += data?.length;
                if (processExec.options.logEvents) {
                    log(cliShort + ' : STDOUT.DATA (' + data?.length + '/' + processExec.output.stdout.dataLength + ')');
                }

                const optPrint = processExec.options.stdout.print;
                const optReturn = processExec.options.stdout.return;
                const optRedirect = processExec.options.stdout.redirect;
                const optCallback = processExec.options.stdout.callback;

                let s = '';
                if (optReturn || optPrint || optCallback) {
                    s = data.toString();
                }
                if (optPrint) {
                    if (optRedirect === 'stdout' || optRedirect === 'default') {
                        process.stdout.write(s);
                    } else if (optRedirect === 'stderr') {
                        process.stderr.write(s);
                    }
                }
                if (optReturn) {
                    processExec.output.stdout.out += s;
                }
                if (optCallback) {
                    optCallback(s);
                }
            });

            // --------------------- child.stdout.close -------------------
            // The 'close' event is emitted when the stream and any of its 
            // underlying resources (a file descriptor, for example) have 
            // been closed. The event indicates that no more events will 
            // be emitted, and no further computation will occur.
            // A Readable stream will always emit the 'close' event if 
            // it is created with the emitClose option.
            // ------------------------------------------------------------

            if (options.logEvents) {
                child.stdout.on('close', function () {
                    log(cliShort + ' : STDOUT.CLOSE');
                    processExec.output.stdout.closed = true;
                });
            }

            // --------------------- child.stdout.end ---------------------
            // The 'end' event is emitted when there is no more data to be 
            // consumed from the stream.
            // The 'end' event will not be emitted unless the data is 
            // completely consumed. This can be accomplished by switching 
            // the stream into flowing mode, or by calling stream.read() 
            // repeatedly until all data has been consumed.
            // ------------------------------------------------------------

            if (options.logEvents) {
                child.stdout.on('end', function () {
                    log(cliShort + ' : STDOUT.END');
                    processExec.output.stdout.ended = true;
                });
            }

            // --------------------- child.stdout.error -------------------
            // The 'error' event may be emitted by a Readable implementation 
            // at any time. Typically, this may occur if the underlying 
            // stream is unable to generate data due to an underlying internal 
            // failure, or when a stream implementation attempts to push an 
            // invalid chunk of data.
            // The listener callback will be passed a single Error object.
            // ------------------------------------------------------------

            if (options.logEvents) {
                child.stdout.on('error', function (error) {
                    log(cliShort + ' : STDOUT.ERROR');
                    processExec.output.stdout.error = error;
                });
            }

            // -------------------- child.stdout.readable -----------------
            // The 'readable' event is emitted when there is data available 
            // to be read from the stream or when the end of the stream has 
            // been reached. Effectively, the 'readable' event indicates 
            // that the stream has new information. If data is available, 
            // stream.read() will return that data.
            // ------------------------------------------------------------

            if (options.logEvents) {
                /*
                    Listening to the 'readable' event may cause side effects.
                    Some events are impacted including : 'data', 'close' and 'end'
                */
                /*
                child.stdout.on('readable', function () {
                    log(cliShort + ' : STDOUT.READABLE');
                });
                */
            }

            // --------------------- child.stdout.pause -------------------
            // The 'pause' event is emitted when stream.pause() is called 
            // and readableFlowing is not false.
            // ------------------------------------------------------------

            if (options.logEvents) {
                child.stdout.on('pause', function () {
                    log(cliShort + ' : STDOUT.PAUSE');
                });
            }

            // --------------------- child.stdout.resume ------------------
            // The 'resume' event is emitted when stream.resume() is called 
            // and readableFlowing is not true.
            // ------------------------------------------------------------

            if (options.logEvents) {
                child.stdout.on('resume', function () {
                    log(cliShort + ' : STDOUT.RESUME');
                });
            }
        }

        // ----------------------- child.stderr --------------------------
        // A Readable Stream that represents the child process's stderr.
        // If the child was spawned with stdio[2] set to anything other 
        // than 'pipe', then this will be null.
        // subprocess.stderr is an alias for subprocess.stdio[2].
        // Both properties will refer to the same value.
        // The subprocess.stderr property can be null if the child process 
        // could not be successfully spawned.
        // ---------------------------------------------------------------

        // == null if options.stdio[2] !== 'pipe'
        if (child.stderr) {
            child.stderr.setEncoding('utf8');

            // --------------------- child.stderr.data --------------------

            child.stderr.on('data', function (data) {
                processExec.output.stderr.dataLength += data?.length;
                if (processExec.options.logEvents) {
                    log(cliShort + ' : STDERR.DATA (' + data?.length + '/' + processExec.output.stderr.dataLength + ')');
                }
                const optPrint = processExec.options.stderr.print;
                const optReturn = processExec.options.stderr.return;
                const optRedirect = processExec.options.stderr.redirect;
                const optCallback = processExec.options.stderr.callback;

                let s = '';
                if (optReturn || optPrint) {
                    s = data.toString();
                    const a = 'Debugger attached.\n';
                    if (s.startsWith(a)) {
                        s = s.substring(a.length);
                    }

                    const b = 'Waiting for the debugger to disconnect...\n';
                    if (s.endsWith(b)) {
                        s = s.substring(0, s.length - b.length);
                        if (s.endsWith(b)) {
                            s = s.substring(0, s.length - b.length);
                        }
                    }

                    if (s.length === 0) {
                        return;
                    }
                }

                if (optPrint) {
                    if (optRedirect === 'stderr' || optRedirect === 'default') {
                        process.stderr.write(s);
                    } else if (optRedirect === 'stdout') {
                        process.stdout.write(s);
                    }
                }
                if (optReturn) {
                    processExec.output.stderr.out += s;
                }
                if (optCallback) {
                    optCallback(s);
                }
            });

            // --------------------- child.stderr.close -------------------

            if (options.logEvents) {
                child.stderr.on('close', function () {
                    log(cliShort + ' : STDERR.CLOSE');
                    processExec.output.stderr.closed = true;
                });
            }

            // --------------------- child.stderr.end ---------------------

            if (options.logEvents) {
                child.stderr.on('end', function () {
                    log(cliShort + ' : STDERR.END');
                    processExec.output.stderr.ended = true;
                });
            }

            // --------------------- child.stderr.error -------------------

            if (options.logEvents) {
                child.stderr.on('error', function (error) {
                    log(cliShort + ' : STDERR.ERROR');
                    processExec.output.stderr.error = error;
                });
            }

            // -------------------- child.stderr.readable -----------------

            if (options.logEvents) {
                /*
                    Listening to the 'readable' event may cause side effects.
                    Some events are impacted including : 'data', 'close' and 'end'
                */
                /*
                child.stderr.on('readable', function () {
                    log(cliShort + ' : STDERR.READABLE');
                });
                */
            }

            // --------------------- child.stderr.pause -------------------

            if (options.logEvents) {
                child.stderr.on('pause', function () {
                    log(cliShort + ' : STDERR.PAUSE');
                });
            }

            // --------------------- child.stderr.resume ------------------

            if (options.logEvents) {
                child.stderr.on('resume', function () {
                    log(cliShort + ' : STDERR.RESUME');
                });
            }
        }

        // ----------------------- child events --------------------------
        // - spawn (first)
        // - exit
        // - disconnect
        // - message
        // - close (last)
        // - error 
        // ---------------------------------------------------------------

        // ------------------------- spawn -------------------------------
        // The 'spawn' event is emitted once the child process has spawned 
        // successfully. If the child process does not spawn successfully, 
        // the 'spawn' event is not emitted and the 'error' event is emitted 
        // instead.
        // If emitted, the 'spawn' event comes before all other events and 
        // before any data is received via stdout or stderr.
        // The 'spawn' event will fire regardless of whether an error occurs 
        // within the spawned process. For example, if bash some-command 
        // spawns successfully, the 'spawn' event will fire, though bash may 
        // fail to spawn some-command. This caveat also applies when 
        // using { shell: true }.
        // ---------------------------------------------------------------

        if (options.logEvents) {
            child.on('spawn', function () {
                log(cliShort + ' : SPAWN');
                processExec.output.spawned = true;
            });
        }

        // ------------------------- exit -------------------------------
        // The 'exit' event is emitted after the child process ends. 
        // If the process exited, code is the final exit code of the process,
        // otherwise null. If the process terminated due to receipt of a signal,
        // signal is the string name of the signal, otherwise null. 
        // One of the two will always be non-null.
        // ---------------------------------------------------------------

        if (options.logEvents) {
            child.on('exit', function (code, signal) {
                log(cliShort + ' : EXIT code=' + code + ' signal=' + signal);
                processExec.output.exited = true;
            });
        }

        // ------------------------- disconnect -------------------------------
        // The 'disconnect' event is emitted after calling the 
        // subprocess.disconnect() method in parent process or 
        // process.disconnect() in child process. After disconnecting it is 
        // no longer possible to send or receive messages, and the subprocess.
        // connected property is false.
        // ---------------------------------------------------------------

        if (options.logEvents) {
            child.on('disconnect', function () {
                log(cliShort + ' : DISCONNECT');
                processExec.output.disconnected = true;
            });
        }

        // --------------------------- message --------------------------------
        // The 'message' event is triggered when a child process uses 
        // process.send() to send messages.
        // The message goes through serialization and parsing. The resulting 
        // message might not be the same as what is originally sent.
        // If the serialization option was set to 'advanced' used when spawning 
        // the child process, the message argument can contain data that JSON 
        // is not able to represent. See Advanced serialization for more details.
        // ---------------------------------------------------------------

        if (options.logEvents) {
            child.on('message', function (message, sendHandle) {
                log(cliShort + ' : MESSAGE');
            });
        }

        // ------------------------- close -------------------------------
        // The 'close' event is emitted after a process has ended and 
        // the stdio streams of a child process have been closed. 
        // This is distinct from the 'exit' event, since multiple processes 
        // might share the same stdio streams. 
        // The 'close' event will always emit after 'exit' was already 
        // emitted, or 'error' if the child failed to spawn.
        // ---------------------------------------------------------------

        child.on('close', function (code, signal) {
            if (processExec.guard) {
                if (processExec.options.logEvents) {
                    log(cliShort + ' : CLOSE (ignored) code=' + code + ' signal=' + signal);
                }
                // 'alreadypassed'
                return;
            }

            if (processExec.options.logEvents) {
                log(cliShort + ' : CLOSE code=' + code + ' signal=' + signal);
            }

            processExec.output.closed = true;
            processExec.output.code = code;
            processExec.output.signal = signal;

            if (processExec.options.stdout.return &&
                processExec.options.stdout.trim) {
                processExec.output.stdout.out = processExec.output.stdout.out?.trim();
            }

            if (processExec.options.stderr.return &&
                processExec.options.stderr.trim) {
                processExec.output.stderr.out = processExec.output.stderr.out?.trim();
            }

            processExec.guard = true;
            resolve(processExec.output);
        });

        // ------------------------- error -------------------------------
        // The 'error' event is emitted whenever:
        // - The process could not be spawned, or
        // - The process could not be killed, or
        // - Sending a message to the child process failed.
        // The 'exit' event may or may not fire after an error has occurred. 
        // When listening to both the 'exit' and 'error' events, guard against
        // accidentally invoking handler functions multiple times.
        // ---------------------------------------------------------------

        child.on('error', function (error) {
            if (processExec.guard) {
                if (processExec.options.logEvents) {
                    log(cliShort + ' : ERROR (ignored) error=' + error.toString());
                }
                // 'alreadypassed'
                return;
            }

            processExec.output.error = error;

            if (processExec.options.stdout.return &&
                processExec.options.stdout.trim) {
                processExec.output.stdout.out = processExec.output.stdout.out?.trim();
            }

            if (processExec.options.stderr.return &&
                processExec.options.stderr.trim) {
                processExec.output.stderr.out = processExec.output.stderr.out?.trim();
            }

            /*
                The current implementation will never call 'reject'
                The final result (success/failure) is always
                forwarded via the 'resolve' callback
            */
            processExec.guard = true;
            resolve(processExec.output);
        });
    });
}

export async function processEndActiveSockets() {
    /** @type {any} */
    const _process = process;
    if (_process._getActiveHandles && typeof _process._getActiveHandles === 'function') {
        const handles = _process._getActiveHandles();
        if (!handles || !Array.isArray(handles)) {
            return;
        }
        for (let i = 0; i < handles.length; ++i) {
            const h = handles[i];
            if (h instanceof ttyWriteStream) {
                continue;
            }
            if (h instanceof ttyReadStream) {
                continue;
            }
            if (h instanceof Socket) {
                h.end();
            }
        }
    }
}