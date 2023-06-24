import * as types from './types.js';
import * as pathlib from 'path';
import { valid as semverValid } from "semver";
import assert from 'assert';
import EventEmitter from 'events';
import {
    dirExists,
    fileExists,
    saveToFileSync,
    mkDirP,
    mkDir,
    rmFileSync,
    chmodUXSync,
    readPidFile,
} from './fs.js';
import {
    isNullishOrEmptyString,
    stringIsPositiveInteger,
    stringToPositiveInteger,
    assertNonEmptyString,
    throwIfNullishOrEmptyString
} from './string.js';
import { Wallet, utils as ethersutils } from 'ethers';
import { isPositiveInteger, throwIfNotStrictlyPositiveInteger } from './number.js';
import { isPortInUse } from './net.js';
import { CodeError, pureVirtualError, throwPureVirtual } from './error.js';
import * as ERROR_CODES from './error-codes.js';
import { psp, killPIDAndWaitUntilFullyStopped, getPIDCWD } from './ps.js';
import { repeatCallUntil } from './repeat-call-until.js';
import { generateTmpPathname } from './fs.js';
import * as nodeUtil from 'util';
import {
    exec as childProcessExec,
    execFile as childProcessExecFile
} from 'child_process';
import { toChecksumAddress } from './ethers.js';
import { httpGET } from './http.js';
import { parseGitUrl } from './utils.js';
const exec_promise = nodeUtil.promisify(childProcessExec);

/* ----------------------- Service Class -------------------------- */

export class AbstractService extends EventEmitter {

    /** 
     * @virtual
     * @returns {typeof AbstractService} 
     */
    theClass() { return AbstractService; }

    /**
     * @hideconstructor
     * @param {*=} args
     */
    constructor(args) {
        // args : for compiler
        super();
    }

    /** 
     * @virtual
     * @returns {Set<string>} 
     */
    static runDependencies() {
        return new Set();
    }

    /** @returns {string} */
    static typename() { throw pureVirtualError('AbstractService.typename()'); }

    /** @returns {string} */
    typename() {
        // @ts-ignore
        return this.constructor.typename();
    }

    static get defaultGitUrl() { return ''; }
    static get gitHubRepoName() { return ''; }

    /** @returns {Promise<string>} */
    static async latestVersion() { throw pureVirtualError('AbstractService.latestVersion()'); }

    /**
     * - Throws an exception if failed.
     * @param {{
     *     cloneRepo?: string | null
     *     commitish?: string | null
     *     gitHubRepoName?: string | null
     * }} overrides
     */
    static async getGitHubRepo(overrides) {
        const gitRepo = { cloneRepo: '', commitish: '', gitHubRepoName: '' };
        if (overrides.cloneRepo) {
            gitRepo.cloneRepo = overrides.cloneRepo;
        }
        if (overrides.commitish) {
            gitRepo.commitish = overrides.commitish;
        }
        if (overrides.gitHubRepoName) {
            gitRepo.gitHubRepoName = overrides.gitHubRepoName;
        }

        if (isNullishOrEmptyString(gitRepo.cloneRepo)) {
            const parsedUrl = parseGitUrl(this.defaultGitUrl);
            gitRepo.cloneRepo = parsedUrl.url;
            if (!gitRepo.commitish) {
                gitRepo.commitish = parsedUrl.commitish;
            }
        }

        if (isNullishOrEmptyString(gitRepo.commitish)) {
            let version = overrides.commitish;
            if (version) {
                if (!semverValid(version)) {
                    throw new CodeError(`Invalid service version='${version}'`)
                }
            } else {
                // Throws exception if failed
                version = await this.latestVersion();
            }
            gitRepo.commitish = version;
        }

        if (isNullishOrEmptyString(gitRepo.gitHubRepoName)) {
            gitRepo.gitHubRepoName = this.gitHubRepoName;
        }

        assert(gitRepo.cloneRepo);
        assert(gitRepo.commitish);
        assert(gitRepo.gitHubRepoName);

        return gitRepo;
    }

    /** 
     * @param {any=} filters 
     * @returns {Promise<{pid: number, configFile: string, service:(AbstractService | null)}[] | null>} 
     */
    static async running(filters) {
        throw pureVirtualError('AbstractService.running()');
    }

    /** 
     * @param {any} filters 
     * @param {types.StopOptionsWithContext} options 
     */
    static async killAll(filters, options) {
        throw pureVirtualError('AbstractService.killAll()');
    }

    /** 
     * @param {any} config 
     * @param {boolean} resolvePlaceholders
     * @param {{[varname:string]: string}} placeholders
     * @param {string=} relativeToDirectory
     * @returns {Promise<any>}
     */
    static async deepCopyConfig(config, resolvePlaceholders, placeholders, relativeToDirectory) {
        throw pureVirtualError('AbstractService.deepCopyConfig()');
    }
}

/* ----------------------- Service Class -------------------------- */

export class Service extends AbstractService {

    /** @type {string} */
    #hostname;
    /** @type {string=} */
    #logFile;
    /** @type {string=} */
    #pidFile;

    #flags = {
        inStart: false,
        inStop: false,
        inAPIStart: false,
        inAPIStop: false,
    }

    /** @type {any=} */
    #context;

    /** 
     * @override
     * @returns {typeof Service} 
     */
    theClass() { return Service; }

    /**
     * @hideconstructor
     * @param {types.ServiceArgs} args
     */
    constructor(args) {
        assert(args);
        assert(args.hostname);
        const hostname = (isNullishOrEmptyString(args.hostname)) ? 'localhost' : args.hostname;
        assert(hostname);
        super(); //compiler
        this.#hostname = hostname;
        if (args.logFile) {
            throwIfNullishOrEmptyString(args.logFile);
            assert(args.logFile && pathlib.isAbsolute(args.logFile));
            this.#logFile = args.logFile;
        }
        if (args.pidFile) {
            throwIfNullishOrEmptyString(args.pidFile);
            assert(args.pidFile && pathlib.isAbsolute(args.pidFile));
            this.#pidFile = args.pidFile;
        }
    }

    get hostname() { return this.#hostname; }
    get pidFile() { return this.#pidFile; }
    get logFile() { return this.#logFile; }

    toJSON() {
        /** @type {any} */
        const json = {
            hostname: this.hostname
        };
        if (this.#pidFile) { json.pidFile = this.#pidFile; }
        if (this.#logFile) { json.logFile = this.#logFile; }
        return json;
    }

    /** 
     * @return {boolean} 
     */
    isLocal() {
        // const h = this.#hostname;
        // return (h === 'localhost' || h === '127.0.0.1');
        return true;
    }

    /** @virtual */
    get canStart() {
        if (!this.isLocal()) {
            return false;
        }
        return true;
    }

    /** @virtual */
    get canStop() {
        return this.canStart;
    }

    /**
     * @protected
     * @param {?number=} pid 
     */
    _msgPrfx(pid) {
        return (pid)
            ? `${this.typename()} (${this.hostname}, pid=${pid.toString()}) : `
            : `${this.typename()} (${this.hostname}) : `
    }

    /**
     * @protected
     * @param {!string} msg
     * @param {?number=} pid 
     */
    _msgFmt(msg, pid) { return this._msgPrfx(pid) + msg; }

    /* ------------------------------------------------------------------- */
    /*                                                                     */
    /*                                API                                  */
    /*                                                                     */
    /* ------------------------------------------------------------------- */

    /** 
     * @abstract
     * @returns {Promise<number | undefined>} 
     */
    async getPID() {
        throwPureVirtual('getPID');
        return;
    }

    /** 
     * @protected
     * @abstract
     */
    async isBusyOverride() {
        throwPureVirtual('isBusyOverride');
    }

    // /**
    //  * Helper
    //  * @protected
    //  * @param {!string} grepPattern 
    //  * @param {string=} cwd 
    //  */
    // async getPIDUsingPsefPipeGrep(grepPattern, cwd) {
    //     assertNonEmptyString(grepPattern);
    //     try {
    //         if (!this.canStart) {
    //             return; /* undefined */
    //         }
    //         const { stdout, stderr } = await exec_promise(`ps -Af | grep -v grep | grep -E \'${grepPattern}\' | awk '{ print $2 }'`);
    //         /* pid  number or undefined */
    //         const pid = stringToPositiveInteger(stdout);
    //         if (pid) {
    //             if (!isNullishOrEmptyString(cwd)) {
    //                 // Check that we are dealing with the same storage directory
    //                 // Grep the process cwd to identify the storage dir.
    //                 const pidCwd = await getPIDCWD(pid);
    //                 if (pidCwd !== cwd) {
    //                     console.error(`Another instance of '${grepPattern}' is already running!`);
    //                     throw new CodeError(`Another instance of '${grepPattern}' is already running!`);
    //                 }
    //             }
    //             return pid;
    //         }
    //     } catch (err) {
    //         if (err instanceof CodeError) {
    //             throw err;
    //         }
    //     }
    //     return; /* undefined */
    // }

    /* ------------------------------------------------------------------- */
    /*                                                                     */
    /*                                ERRORS                               */
    /*                                                                     */
    /* ------------------------------------------------------------------- */

    #errorAlreadyStarting() {
        return new CodeError(
            this._msgFmt('service already starting.'),
            ERROR_CODES.ALREADY_STARTING,
            this.#context);
    }

    #errorAlreadyStopping() {
        return new CodeError(
            this._msgFmt('service already starting.'),
            ERROR_CODES.ALREADY_STOPPING,
            this.#context);
    }

    /** @param {{pid?:number}=} args */
    #errorStartCancelled(args) {
        return new CodeError(
            this._msgFmt('service start cancelled.', args?.pid),
            ERROR_CODES.CANCELLED,
            this.#context);
    }

    #errorStopCancelled() {
        return new CodeError(
            this._msgFmt('service stop cancelled.'),
            ERROR_CODES.CANCELLED,
            this.#context);
    }

    #errorCannotStart() {
        return new CodeError(
            this._msgFmt('service cannot be started.'),
            ERROR_CODES.CANNOT_START,
            this.#context);
    }

    #errorCannotStop() {
        return new CodeError(
            this._msgFmt('service cannot be stopped.'),
            ERROR_CODES.CANNOT_STOP,
            this.#context);
    }

    #errorBusy() {
        return new CodeError(
            this._msgFmt(`start failed another concurrent service is already running`),
            ERROR_CODES.BUSY_ERROR,
            this.#context);
    }

    #errorPidFile() {
        return new CodeError(
            this._msgFmt(`service cannot be started, 'pidFile' dirname does not exist (pidFile='${this.#pidFile}')`),
            ERROR_CODES.PID_FILE_ERROR,
            this.#context);
    }

    #errorLogFile() {
        return new CodeError(
            this._msgFmt(`service cannot be started, 'logFile' dirname does not exist (logFile='${this.#logFile}')`),
            ERROR_CODES.LOG_FILE_ERROR,
            this.#context);
    }

    #errorSavePid() {
        return new CodeError(
            this._msgFmt(`save pid file failed (pidFile='${this.#pidFile}')`),
            ERROR_CODES.PID_FILE_ERROR,
            this.#context);
    }

    #errorBashScriptGen() {
        return new CodeError(
            this._msgFmt('Bash script generation failed.'),
            ERROR_CODES.BASH_SCRIPT_GEN_ERROR,
            this.#context);
    }

    /** @param {{msg?:string, pid?:number}=} args */
    #errorBashScriptExec(args) {
        return new CodeError(
            (args?.msg) ?
                this._msgFmt(args.msg, args?.pid) :
                this._msgFmt('Bash script run failed.', args?.pid),
            ERROR_CODES.BASH_SCRIPT_EXEC_ERROR,
            this.#context);
    }

    /** @param {{msg?:string, pid?:number}=} args */
    #errorKilled(args) {
        return new CodeError(
            (args?.msg) ?
                this._msgFmt(args.msg, args?.pid) :
                this._msgFmt('service killed.', args?.pid),
            ERROR_CODES.PROCESS_KILLED,
            this.#context);
    }

    /** @param {{msg?:string, pid?:number}=} args */
    #errorNotReady(args) {
        return new CodeError(
            (args?.msg) ?
                this._msgFmt(args.msg, args?.pid) :
                this._msgFmt('service not ready.', args?.pid),
            ERROR_CODES.NOT_READY,
            this.#context);
    }

    /**
     * @param {Error} error 
     * @return {types.FailedCodeError}
     */
    #okErr(error) {
        let e;
        if (error instanceof CodeError) {
            if (!error.context) {
                error.context = this.#context;
            }
            assert(!this.#context || error.context === this.#context);
            e = error;
        } else {
            e = new CodeError(error.message, '', this.#context);
        }
        //console.error(e.message);
        return { ok: false, error: e };
    }

    /**
     * @param {CodeError} codeErr
     * @param {boolean=} strict `true` throws an error if failed.
     * @returns {{ ok: false, error: CodeError }}
     */
    #failed(codeErr, strict) {
        if (strict) {
            throw codeErr;
        }
        return { ok: false, error: codeErr };
    }

    /**
     * @param {'ready' | 'startError' | 'stopped' | 'stopError'} event 
     * @param {!any} eventArg 
     * @param {boolean} delay 
     */
    #emitFinalEvent(event, eventArg, delay) {
        if (!delay) {
            // emit before exiting
            this.emit(event, eventArg);
        } else {
            // emit after exiting ?
            // sends the event from the next node microtask.
            new Promise((resolve, reject) => {
                resolve(eventArg);
            }).then((value) => {
                this.emit(event, value);
            });
        }
    }

    /* ------------------------------------------------------------------- */
    /*                                                                     */
    /*                                START                                */
    /*                                                                     */
    /* ------------------------------------------------------------------- */

    /**
     * @todo `killIfFailed` ? disable if already running ?
     * @param {types.StartOptionsWithContext=} options
     * @returns {Promise<types.StartReturn>}
     */
    async start(options) {
        const strict = options?.strict ?? false;

        // Start re-entrance not yet supported
        if (this.#flags.inAPIStart) {
            const err = this.#errorAlreadyStarting();
            // context may differ !
            err.context = options?.context;
            return this.#failed(err, strict);
        }
        // Stop re-entrance not yet supported
        if (this.#flags.inAPIStop) {
            const err = this.#errorAlreadyStopping();
            // context may differ !
            err.context = options?.context;
            return this.#failed(err, strict);
        }

        if (options?.abortSignal?.aborted) {
            throw this.#errorStartCancelled();
        }

        this.#flags.inAPIStart = true;
        const emitFinalEventAfterFuncExit = true;
        const startReturn = await this.#start(
            emitFinalEventAfterFuncExit,
            options);
        this.#flags.inAPIStart = false;

        return startReturn;
    }

    /**
     * @param {boolean} emitFinalEventAfterFuncExit
     * @param {types.StartOptionsWithContext=} options
     * @returns {Promise<types.StartReturn>}
     */
    async #start(emitFinalEventAfterFuncExit, options) {
        const killIfFailed = options?.killIfFailed ?? false;
        const strict = options?.strict ?? false;
        const quiet = options?.quiet ?? false;

        // Start re-entrance not yet supported
        if (this.#flags.inStart) {
            const err = this.#errorAlreadyStarting();
            // context may differ !
            err.context = options?.context;
            return this.#failed(err, strict);
        }
        // Stop re-entrance not yet supported
        if (this.#flags.inStop) {
            const err = this.#errorAlreadyStopping();
            // context may differ !
            err.context = options?.context;
            return this.#failed(err, strict);
        }

        /** @type {CodeError} */
        let startError;

        try {
            assert(!this.#context);
            this.#context = options?.context;

            this.#flags.inStart = true;

            // Copy options! make sure the caller will not
            // interfere with the provided option values.
            const { pid, alreadyStarted } = await this.#startCore({ ...options });

            // unlock API call re-entrance
            // event listeners can call 'start' or 'stop'
            this.#flags.inStart = false;

            // Sends final 'ready' event (after or before api call)
            this.#emitFinalEvent('ready', pid, emitFinalEventAfterFuncExit);

            try {
                await this.onReadyOverride(pid, alreadyStarted);
            } catch { }

            return {
                ok: true,
                pid: pid,
                ...(this.#context && { context: this.#context })
            };
        } catch (err) {
            // @ts-ignore
            // console.log(err.stack);
            assert(err instanceof CodeError);
            startError = err;
        }

        try {
            await this.onStartFailedOverride(startError);
        } catch { }

        assert(startError);
        assert(startError instanceof CodeError);
        assert(startError.context === this.#context);

        // unlock API call re-entrance
        // event listeners can call 'start' or 'stop'
        this.#flags.inStart = false;

        if (killIfFailed) {
            if (!this.#flags.inStop) {
                // call stop
                // without abort signal.
                // Since the failure may be due to the abort signal itself!
                /** @type {types.StopOptionsWithContext} */
                const stopOptions = {
                    strict: true,
                    quiet: quiet
                    // Do not include abort signal
                };

                let stopError;
                try {
                    // 'false' : emit final event BEFORE 
                    // the 'this.#stop' function exit
                    await this.#stop(false, stopOptions);
                } catch (err) {
                    stopError = err;
                }
            }
        }

        // Sends final 'startError' event (after or before api call)
        this.#emitFinalEvent('startError', startError, emitFinalEventAfterFuncExit);

        if (strict) {
            throw startError;
        }
        return this.#okErr(startError);
    }

    /**
     * Throws an exception if failed.
     * @param {types.StartOptions=} options
     * @returns {Promise<{ pid:number, alreadyStarted:boolean }>}
     */
    async #startCore(options) {

        // Check if the service is 'startable'
        // For example : if url is not local, 
        // the service cannot start. 
        if (!this.canStart) {
            throw this.#errorCannotStart();
        }

        const mySelf = this;
        const typename = this.typename();

        let alreadyStarted = false;

        // is the process already running ?
        let pid = await this.getPID();
        if (pid) {
            alreadyStarted = true;
            // Check that the saved pid is the same
            // as the one we just retrieved using shell 'ps'
            // command.
            const read_pid = this.readPID();
            assert(this.#pidFile == null || !read_pid || read_pid === pid);
            if (!options?.quiet) {
                //console.log(this._msgFmt("service already started", pid));
            }
            options?.progressCb?.({
                count: 100,
                total: 100,
                value: {
                    state: 'started',
                    type: typename,
                    service: mySelf,
                    context: this.#context
                }
            });
        } else {
            // check if another concurrent service is blocking

            try {
                await this.isBusyOverride();
            } catch (err) {
                assert(err instanceof CodeError);
                err.context = this.#context;
                throw err;
            }

            // Create pidFile parent directory if needed
            if (this.#pidFile) {
                const pidFileDirname = pathlib.dirname(this.#pidFile);
                if (!dirExists(pidFileDirname)) {
                    let ok = false;
                    if (options?.createDir) {
                        ok = mkDirP(pidFileDirname, { strict: false });
                    }
                    if (!ok) {
                        throw this.#errorPidFile();
                    }
                }
            }

            // Create logFile parent directory if needed
            if (this.#logFile) {
                const logFileDirname = pathlib.dirname(this.#logFile);
                if (!dirExists(logFileDirname)) {
                    let ok = false;
                    if (options?.createDir) {
                        ok = mkDirP(logFileDirname, { strict: false });
                    }
                    if (!ok) {
                        throw this.#errorLogFile();
                    }
                }
            }

            if (!options?.quiet) {
                //console.log(this._msgFmt("service starting..."));
            }
            options?.progressCb?.({
                count: 0,
                total: 100,
                value: {
                    state: 'starting',
                    type: typename,
                    service: mySelf,
                    context: this.#context
                }
            });

            // Listeners are called synchronously
            // Send 'starting' event
            this.emit('starting');

            // - if succeeded : returns process pid
            // - if failed : throws an error
            pid = await this.#startProcessViaBashScript(
                {
                    env: { ...options?.env },
                    bashScriptTimeoutMS: 5000,
                    fast: false,
                    quiet: false,
                    ... (options?.abortSignal && {
                        abortSignal: options.abortSignal
                    }),
                    ... (options?.progressCb && {
                        progressCb: (args) => {
                            options.progressCb?.({
                                ...args,
                                value: {
                                    state: 'starting',
                                    type: typename,
                                    service: mySelf,
                                    context: this.#context
                                }
                            });
                        }
                    })
                });

            if (!options?.quiet) {
                //console.log(this._msgFmt("service started.", pid));
            }
            options?.progressCb?.({
                count: 100,
                total: 100,
                value: {
                    state: 'started',
                    type: typename,
                    service: mySelf,
                    context: this.#context
                }
            });
        }

        assert(pid);

        if (options?.abortSignal?.aborted) {
            throw this.#errorStartCancelled({ pid });
        }

        // Listeners are called synchronously
        // Send 'started' event
        this.emit('started', pid);

        // Succeeds or throws an exception if :
        // - not ready
        // - timeout
        // - abort
        // - etc.
        await this.waitUntilReadyOverride(pid,
            {
                ...options,
                ... (options?.progressCb && {
                    progressCb: (args) => {
                        options?.progressCb?.({
                            ...args,
                            value: {
                                state: 'readying',
                                type: typename,
                                service: mySelf,
                                context: this.#context
                            }
                        });
                    }
                })
            });

        if (!options?.quiet) {
            //console.log(this._msgFmt("service is ready", pid));
        }
        options?.progressCb?.({
            count: 100,
            total: 100,
            value: {
                state: 'ready',
                type: typename,
                service: mySelf,
                context: this.#context
            }
        });

        return { pid, alreadyStarted };
    }

    /**
     * @protected
     * @param {number} pid 
     * @param {boolean} alreadyStarted 
     */
    async onReadyOverride(pid, alreadyStarted) {
        // do nothing by default        
    }

    /**
     * @protected
     * @param {number | undefined} pid 
     * @param {types.StopOptionsWithContext=} options
     */
    async onStoppedOverride(pid, options) {
        // do nothing by default        
    }

    /**
     * @protected
     * @param {CodeError} startError 
     */
    async onStartFailedOverride(startError) {
        // do nothing by default        
    }

    /* ------------------------- #startProcess --------------------------- */

    /**
     * - if succeeded : returns the service pid
     * - if failed : always throws an exception
     * @param {object} options
     * @param {!types.positiveInteger=} options.bashScriptTimeoutMS 
     * @param {!boolean=} options.fast 
     * @param {!boolean=} options.quiet 
     * @param {!{[envName:string] : string}} options.env 
     * @param {!AbortSignal=} options.abortSignal
     * @param {types.progressCallback=} options.progressCb
     * @returns {Promise<number>}
     */
    async #startProcessViaBashScript(options =
        {
            bashScriptTimeoutMS: 5000,
            fast: false,
            quiet: false,
            env: {}
        }) {

        if (options.abortSignal?.aborted) {
            throw this.#errorStartCancelled();
        }

        // Delete log file
        if (this.#logFile) {
            rmFileSync(this.#logFile);
        }
        // Delete pid file
        if (this.#pidFile) {
            rmFileSync(this.#pidFile);
        }
        // Prepare bash start script
        const tmpStartBashScriptFile = await this.#saveTmpStartBashScript(true, options.env ?? {});
        if (!tmpStartBashScriptFile) {
            throw this.#errorBashScriptGen();
        }

        // Spring specific :
        // If we want to use the same GradleDaemon : add the LANG env var
        // May not be necessary ?
        /** @type {NodeJS.ProcessEnv} */
        const env = {};
        Object.assign(env, process.env);
        env['LANG'] = 'en_GB.UTF-8';

        // logstash : network address resolution is super slow on MacOS
        // ============================================================
        // - Super slow on Mac (at least on BigSur). 
        // - By default, resolution order is = "network, localhost" (1 minute at least)
        // - Change it to = "localhost, network" (ms only)
        env["logstash-gelf.resolutionOrder"] = "localhost,network";
        env["logstash-gelf.skipHostnameResolution"] = "true";

        // Run the bash script 
        const result = await new Promise((resolve, reject) => {
            const childproc = childProcessExecFile(
                tmpStartBashScriptFile, [],
                {
                    timeout: options.bashScriptTimeoutMS,
                    env: env
                },
                (error, stdout, stderr) => {
                    // Delete the tmp bash script
                    rmFileSync(tmpStartBashScriptFile);
                    if (error) {
                        resolve({ ok: false, stderr: error.message });
                    } else {
                        const pid_str = (stdout) ? stdout.trim() : '';
                        let pid = null;
                        if (stringIsPositiveInteger(pid_str)) {
                            pid = stringToPositiveInteger(pid_str);
                        }
                        resolve({
                            ok: (childproc.exitCode == 0),
                            stderr: stderr,
                            stdout: stdout,
                            pid: pid
                        });
                    }
                });
        });

        // if bash script exited with code != 0
        if (!result.ok) {
            throw this.#errorBashScriptExec({ msg: result.stderr });
        }

        // The Bash script is in charge of launching an external process
        // It will try to return its pid.
        // In some situations :
        // - it is not possible for Bash to return the requested pid.
        // - the returned pid is NOT the pid we are looking for (ex: gradle)
        const bashScriptOutPid = result.pid;
        if (bashScriptOutPid != null) {
            // check the pid is still alive
            const pidExists = await psp(bashScriptOutPid);
            if (!pidExists) {
                throw this.#errorBashScriptExec();
            }
        }

        if (options.abortSignal?.aborted) {
            throw this.#errorStartCancelled();
        }

        // Now, we will try to fetch our pid.
        // May differ from 'bashScriptOutPid'
        const resultCallUntil = await repeatCallUntil(
            this.getPID.bind(this),
            null,
            {
                waitBeforeFirstCall: (options.fast) ? 0 : 100,
                waitBetweenCallsMS: (options.fast) ? 0 : 1000,
                maxCalls: (options.fast) ? 10 : 200,
                ... ((options.quiet !== true) && {
                    progressMessage: this._msgFmt('waiting for pid...')
                }),
                ... (options.abortSignal && {
                    abortSignal: options.abortSignal
                }),
                ... (options.progressCb && {
                    progressCb: options.progressCb
                })
            });

        if (!resultCallUntil.ok) {
            assert(resultCallUntil.error);
            throw resultCallUntil.error;
        }

        if (options.progressCb) {
            options.progressCb({ count: 100, total: 100, value: null });
        }

        assert(resultCallUntil.result);
        assert(isPositiveInteger(resultCallUntil.result));

        const pid = resultCallUntil.result;

        // Save pid if pid file does not yet exist
        // some bash scripts do not save the pid
        if (this.#pidFile && !isNullishOrEmptyString(this.#pidFile)) {
            if (!fileExists(this.#pidFile)) {
                const ok = saveToFileSync(
                    pid.toString(),
                    pathlib.dirname(this.#pidFile),
                    pathlib.basename(this.#pidFile),
                    { strict: false });
                if (!ok) {
                    throw this.#errorSavePid();
                }
            }
        }

        return pid;
    }

    /* ------------------------------------------------------------------- */
    /*                                                                     */
    /*                                STOP                                 */
    /*                                                                     */
    /* ------------------------------------------------------------------- */

    /**
     * @param {types.StopOptionsWithContext=} options
     * @returns {Promise<types.StopReturn>}
     */
    async stop(options) {
        const strict = options?.strict ?? false;

        // Start re-entrance not yet supported
        if (this.#flags.inAPIStart) {
            const err = this.#errorAlreadyStarting();
            // context may differ !
            err.context = options?.context;
            return this.#failed(err, strict);
        }
        // Stop re-entrance not yet supported
        if (this.#flags.inAPIStop) {
            const err = this.#errorAlreadyStopping();
            // context may differ !
            err.context = options?.context;
            return this.#failed(err, strict);
        }

        if (options?.abortSignal?.aborted) {
            throw this.#errorStopCancelled();
        }

        this.#flags.inAPIStop = true;
        const emitFinalEventAfterFuncExit = true;
        const stopReturn = await this.#stop(
            emitFinalEventAfterFuncExit,
            options);
        this.#flags.inAPIStop = false;

        return stopReturn;
    }

    /**
     * @param {boolean} emitFinalEventAfterFuncExit
     * @param {types.StopOptionsWithContext=} options
     * @returns {Promise<types.StopReturn>}
     */
    async #stop(emitFinalEventAfterFuncExit, options) {
        const strict = options?.strict ?? false;

        // Start re-entrance not yet supported
        if (this.#flags.inStart) {
            const err = this.#errorAlreadyStarting();
            // context may differ !
            err.context = options?.context;
            return this.#failed(err, strict);
        }
        // Stop re-entrance not yet supported
        if (this.#flags.inStop) {
            const err = this.#errorAlreadyStopping();
            // context may differ !
            err.context = options?.context;
            return this.#failed(err, strict);
        }

        /** @type {CodeError} */
        let stopError;

        try {
            assert(!this.#context);
            this.#context = options?.context;

            this.#flags.inStop = true;

            // Copy options! make sure the caller will not
            // interfere with the provided option values.
            const pid = await this.#stopCore({ ...options });

            // unlock API call re-entrance
            // event listeners can call 'start' or 'stop'
            this.#flags.inStop = false;

            if (pid) {
                if (!options?.quiet) {
                    //console.log(this._msgFmt("service stopped ...", pid));
                }

                // Sends final 'stopped' event (after or before api call)
                this.#emitFinalEvent('stopped', pid, emitFinalEventAfterFuncExit);
            }

            try {
                await this.onStoppedOverride(pid, options);
            } catch { }

            return {
                ok: true,
                ...(pid && { pid: pid }),
                ...(this.#context && { context: this.#context })
            };
        } catch (err) {
            if (err instanceof Error && !(err instanceof CodeError)) {
                console.log(err.stack);
            }
            assert(err instanceof CodeError);
            stopError = err;
        }

        assert(stopError);
        assert(stopError instanceof CodeError);
        assert(stopError.context === this.#context);

        // unlock API call re-entrance
        // event listeners can call 'start' or 'stop'
        this.#flags.inStop = false;

        // Sends final 'stopError' event (after or before api call)
        this.#emitFinalEvent('stopError', stopError, emitFinalEventAfterFuncExit);

        if (strict) {
            throw stopError;
        }
        return this.#okErr(stopError);
    }

    /**
     * Throws an exception if failed.
     * @param {types.StopOptions=} options
     * @returns {Promise<number | undefined>}
     */
    async #stopCore(options) {

        // Check if the service is 'stoppable'
        // For example : if url is not local, 
        // the service cannot be stopped. 
        if (!this.canStop) {
            throw this.#errorCannotStop();
        }

        // is the service still running ?
        const pid = await this.getPID();
        if (!pid) {
            return;
        }

        if (!options?.quiet) {
            //console.log(this._msgFmt("service stopping ...", pid));
        }

        // Listeners are called synchronously
        // Send 'stopping' event
        this.emit('stopping', pid);

        // Throws an exception if failed
        // override
        await this.stopOverride(pid, options);

        return pid;
    }

    /* --------------------------- stopOverride -------------------------- */

    /** 
     * Throws an exception if failed.
     * @protected 
     * @param {number} pid
     * @param {types.StopOptions=} options
     */
    async stopOverride(pid, options) {
        // Throws an exception if failed
        await killPIDAndWaitUntilFullyStopped(pid,
            {
                ... (options?.quiet && {
                    progressMessage: this._msgFmt(
                        "waiting for service to be stopped ...", pid)
                }),
                ... (options?.abortSignal && {
                    abortSignal: options.abortSignal
                }),
            });
    }

    /* ------------------------------ Ready ------------------------------ */

    /** Returns saved process id */
    readPID() {
        if (!this.#pidFile) {
            return; /* undefined */
        }
        return readPidFile(this.#pidFile);
    }

    /** 
     * @returns {Promise<boolean>}
     */
    async isReady() {
        return this.isReadyOverride();
    }

    /** 
     * Default implementation : determine if the service is ready or not
     * by parsing the log file.
     * @protected 
     * @returns {Promise<boolean>}
     */
    async isReadyOverride() {
        // True if the service is ready to go.
        // Behaviour is undetermined if 'isReadyOverride' is called
        // during the course of a 'Stop' action.
        assert(!this.#flags.inStop);
        assert(!this.#flags.inStop);
        try {
            const pid = await this.getPID();
            if (!pid) {
                return false;
            }
            let ORANDSuccess = this.getSuccessORANDPatterns(pid);
            if (ORANDSuccess && ORANDSuccess.length === 0) {
                ORANDSuccess = null;
            }
            let ORANDFailure = this.getFailureORANDPatterns(pid);
            if (ORANDFailure && ORANDFailure.length === 0) {
                ORANDFailure = null;
            }
            let ExcludeFailure = this.getFailureExcludePatterns(pid);
            if (ExcludeFailure && ExcludeFailure.length === 0) {
                ExcludeFailure = null;
            }
            // Matchers are empty, consider the service as ready
            if (!ORANDSuccess && !ORANDFailure) {
                return true;
            }
            // No log file, consider the service as ready
            if (!this.#logFile) {
                return true;
            }
            // No log file, consider the service as ready
            if (!fileExists(this.#logFile, { strict: false })) {
                return true;
            }

            // result.ok == false : the service status is not 
            // determined (start underway).
            const out = await this.#parseLogsAndGetStatus(
                null,
                ORANDSuccess,
                ORANDFailure,
                ExcludeFailure);
            return (out.ok && (out.result.status === 'succeeded'));
        } catch (err) { }
        return false;
    }

    /** 
     * @protected 
     * @param {number} pid 
     * @param {{
     *      abortSignal?: AbortSignal
     *      progressCb?: types.progressCallback
     * }=} options
     */
    async waitUntilReadyOverride(pid, options) {
        // here 'await' is mendatory !
        await this.#waitUntilReadyUsingLogs(pid, options);
    }

    /**
     * @param {number} pid 
     * @param {{
     *      abortSignal?: AbortSignal
     *      progressCb?: types.progressCallback
     * }=} options
     */
    async #waitUntilReadyUsingLogs(pid, options) {
        let ORANDSuccess = this.getSuccessORANDPatterns(pid);
        if (ORANDSuccess && ORANDSuccess.length === 0) {
            ORANDSuccess = null;
        }
        let ORANDFailure = this.getFailureORANDPatterns(pid);
        if (ORANDFailure && ORANDFailure.length === 0) {
            ORANDFailure = null;
        }
        let ExcludeFailure = this.getFailureExcludePatterns(pid);
        if (ExcludeFailure && ExcludeFailure.length === 0) {
            ExcludeFailure = null;
        }

        let shouldParseLogs = true;

        // No log file ?
        if (!this.#logFile) {
            shouldParseLogs = false;
        } else {
            // No log file ?
            if (!fileExists(this.#logFile, { strict: false })) {
                shouldParseLogs = false;
            } else {
                // Nothing to parse in the log file ?
                if (!ORANDSuccess && !ORANDFailure) {
                    shouldParseLogs = false;
                }
            }
        }

        // No log to parse, just check if pid is still valid
        if (!shouldParseLogs) {
            const pidExists = await psp(pid);
            if (pidExists) {
                return;
            }
            throw this.#errorKilled({ pid: pid });
        }

        /* -------------------------------------------------- */
        //            Wait for service to be ready
        /* -------------------------------------------------- */

        const repeat = await repeatCallUntil(
            this.#parseLogsAndGetStatus.bind(this),
            [pid, ORANDSuccess, ORANDFailure, ExcludeFailure],
            {
                waitBeforeFirstCall: 200,
                waitBetweenCallsMS: 400,
                maxCalls: 200,
                progressMessage: this._msgFmt(
                    "waiting for service to be ready ...",
                    pid),
                ... (options?.abortSignal && { abortSignal: options.abortSignal }),
                ... (options?.progressCb && { progressCb: options.progressCb }),
            });

        if (!repeat.ok) {
            assert(repeat.error);
            throw repeat.error;
        }

        assert(repeat.result);

        /** @type {LogsFailed | LogsSucceeded} */
        const logsStatus = repeat.result;

        if (logsStatus.status === 'succeeded') {
            return;
        }

        assert(
            logsStatus.status === 'failed' ||
            logsStatus.status === 'killed');

        const errMsg = this.logLineToErrorMessage(logsStatus.logLine);

        if (logsStatus.status === 'killed') {
            throw this.#errorKilled({ msg: errMsg });
        } else {
            throw this.#errorNotReady({ msg: errMsg });
        }
    }

    /**
     * @abstract
     * @param {?string=} logLine 
     * @returns {!string}
     */
    logLineToErrorMessage(logLine) {
        if (isNullishOrEmptyString(logLine)) {
            return '';
        }
        return logLine ?? '';
    }

    /** 
     * @abstract 
     * @param {{
     *      logFile?: string
     *      pidFile?: string
     *      env?: {[envName:string] : string}
     * }=} options
     * @returns {Promise<string?>}
     */
    async getStartBashScript(options) {
        throw pureVirtualError('getStartBashScript');
    }

    /**
     * Returns the generated bash script pathname
     * @param {boolean} force override any existing file
     * @param {{[envName:string] : string}} env env var marker
     * @returns generated bash script pathname or `null` if failed
     */
    async #saveTmpStartBashScript(force, env) {
        if (!this.canStart) {
            return null;
        }

        const tmpScriptPathname = await generateTmpPathname();
        const tmpScriptDirname = pathlib.dirname(tmpScriptPathname);
        const tmpScriptBasename = pathlib.basename(tmpScriptPathname);

        let ok;

        if (!dirExists(tmpScriptDirname)) {
            ok = mkDir(tmpScriptDirname, { strict: false });
            if (!ok) {
                return null;
            }
        }

        if (!force) {
            // Should never happen, since pathname is a random value
            assert(false);
            if (fileExists(tmpScriptPathname)) {
                return tmpScriptPathname;
            }
        }

        if (this.#logFile) {
            assert(pathlib.isAbsolute(this.#logFile));
        }
        if (this.#pidFile) {
            assert(pathlib.isAbsolute(this.#pidFile));
        }

        // generate Bash script
        const script_src = await this.getStartBashScript({
            logFile: this.#logFile,
            pidFile: this.#pidFile,
            env
        });

        if (isNullishOrEmptyString(script_src)) {
            return null;
        }
        assert(script_src);

        // Save Bash script in a tmp file
        ok = saveToFileSync(
            script_src,
            tmpScriptDirname,
            tmpScriptBasename);
        if (!ok) {
            return null;
        }

        // chmod u+x <Bash script>
        ok = chmodUXSync(tmpScriptPathname, { strict: false });
        if (!ok) {
            rmFileSync(tmpScriptPathname);
            return null;
        }

        return tmpScriptPathname;
    }

    /** @typedef {string[]} ANDPatterns */
    /** @typedef {ANDPatterns[]} ORANDPatterns */

    /**
     * @protected
     * @param {number} pid 
     * @returns {ORANDPatterns?}
     */
    getSuccessORANDPatterns(pid) {
        return null;
    }

    /**
     * @protected
     * @param {number} pid 
     * @returns {ORANDPatterns?}
     */
    getFailureORANDPatterns(pid) {
        return null;
    }

    /**
     * @protected
     * @param {number} pid 
     * @returns {string[] | null}
     */
    getFailureExcludePatterns(pid) {
        return null;
    }

    /**
     * @typedef LogsFailed
     * @type {object}
     * @property {'failed'|'killed'} status
     * @property {string=} logLine the log line
     */

    /**
     * @typedef LogsSucceeded
     * @type {object}
     * @property {'succeeded'} status
     */

    /**
     * @typedef LogsUndetermined
     * @type {object}
     * @property {'starting'|'unknown'} status
     */

    //@returns {Promise<LogsSucceeded | LogsFailed |LogsUndetermined>}

    /**
     * Warning : the function is called repeatedly to 
     * check whether the service is running or failed
     * This is achieved by parsing the logs
     * Performance: The following implementation is not optimal.
     * On each iteration, the whole log file is re-parsed from the beginning.
     * @param {number?} pid
     * @param {ORANDPatterns?} ORANDSuccessPatterns
     * @param {ORANDPatterns?} ORANDFailurePatterns
     * @param {string[]?} ExcludeFailurePatterns
     * @returns {types.PromiseResultOrCodeError<{status:string, logLine?:string}>}
     */
    async #parseLogsAndGetStatus(
        pid,
        ORANDSuccessPatterns,
        ORANDFailurePatterns,
        ExcludeFailurePatterns
    ) {
        // pid === null means : skip `ps -p <pid>`
        // consider that pid exists.
        const pidExists = (pid) ? await psp(pid) : true;

        try {
            // cat result-proxy.log | 
            // awk '/Started Application in/ && /com.iexec.resultproxy.Application/'
            const logs = this.#logFile;
            // Build OR('AND patterns')
            // ============================
            // [ [and] or [and] ]
            // [ [and11, and12], [and21, and22] ]
            // (and11 && and12) or (and21 && and22)
            const awk_failure_pattern = ORANDFailurePatterns?.map(
                (p) => p.map(
                    (v) => `/${v}/`).join(' && ')).join(' || ');
            const awk_success_pattern = ORANDSuccessPatterns?.map(
                (p) => p.map(
                    (v) => `/${v}/`).join(' && ')).join(' || ');

            let awk_args = '';
            let awk_sep = '';
            if (awk_success_pattern) {
                awk_args += awk_success_pattern;
                awk_sep = ' || ';
            }
            if (awk_failure_pattern) {
                awk_args += awk_sep + awk_failure_pattern;
            }
            if (isNullishOrEmptyString(awk_args)) {
                return {
                    ok: true,
                    result: { status: (!pidExists) ? 'killed' : 'succeeded' }
                };
            }

            let pipeGrepV = '';
            if (ExcludeFailurePatterns) {
                pipeGrepV = "| grep -v '" + ExcludeFailurePatterns.join("' | grep -v '") + "'";
            }
            const log_success_or_failure =
                await exec_promise(`cat ${logs} ${pipeGrepV} |  awk '${awk_args}'`);
            if (log_success_or_failure.stdout.length === 0) {
                return (!pidExists) ?
                    { ok: true, result: { status: 'killed' } } :
                    { ok: false, error: new CodeError('starting', 'starting') };
            }

            // Check if one line matches one of the failure ANDPatterns
            if (ORANDFailurePatterns && ORANDFailurePatterns.length > 0) {
                const lines = log_success_or_failure.stdout.split('\n');
                for (let i = 0; i < lines.length; ++i) {
                    const l = lines[i];
                    // 'Task :bootRun FAILED'
                    for (let j = 0; j < ORANDFailurePatterns.length; j++) {
                        const ANDPatterns = ORANDFailurePatterns[j];
                        let failed = true;
                        for (let k = 0; k < ANDPatterns.length; ++k) {
                            // if the line does not contain one of the 
                            // ANDPatterns then the condition is not fullfilled.
                            if (l.indexOf(ANDPatterns[k]) < 0) {
                                failed = false;
                                break;
                            }
                        }
                        if (failed) {
                            return {
                                ok: true,
                                result: {
                                    logLine: l,
                                    status: (pidExists) ? 'failed' : 'killed'
                                }
                            };
                        }
                    }
                }
            }

            // if it is not a failure, then it must be a success
            return {
                ok: true,
                result: { status: (pidExists) ? 'succeeded' : 'killed' }
            };
        }
        catch (err) {
            return (!pidExists) ?
                { ok: true, result: { status: 'killed' } } :
                { ok: false, error: new CodeError('unknown', 'unknown') };
        }
    }

    /** 
     * @override
     * @param {any=} filters 
     * @returns {Promise<{pid: number, configFile: string, service:(Service | null)}[] | null>} 
     */
    static async running(filters) {
        throw pureVirtualError('Service.running()');
    }

    /** 
     * @param {any} filters 
     * @param {types.StopOptionsWithContext} options 
     */
    static async stopAll(filters, options) {
        // should not be 'null', would prevent from obj destructuring
        const all = await this.running(filters ?? undefined);
        if (!all) {
            return true;
        }
        return Service.groupStop({
            services: all.map(s => s.service),
            options
        });
    }

    /** 
     * @param {any} filters 
     * @param {types.StopOptionsWithContext} options 
     */
    static async killAll(filters, options) {
        // should not be 'null', would prevent from obj destructuring
        const all = await this.running(filters ?? undefined);
        if (!all) {
            return;
        }
        return this.groupKill({
            pids: all.map(s => s.pid),
            options
        });
    }

    /**
     * @param {{
     *      services?: (types.IStoppable | null)[] 
     *      options?: types.StopOptionsWithContext 
     * }} args
     */
    static async groupStop({ services, options }) {
        if (!services || services.length === 0) {
            return true;
        }

        const promises = [];
        for (let i = 0; i < services.length; i++) {
            const s = services[i];
            if (!s) {
                continue;
            }
            const p = s.stop(options);
            promises.push(p);
        }

        let ok = true;
        const results = await Promise.all(promises);
        for (let i = 0; i < results.length; ++i) {
            const r = results[i];
            if (r.ok) {
                continue;
            }
            ok = false;
            console.log(r.error.message);
        }
        return ok;
    }

    /**
     * @param {{
    *      pids: number[] 
    *      options?: types.StopOptionsWithContext 
    * }} args
    */
    static async groupKill({ pids, options }) {
        if (!pids || pids.length === 0) {
            return;
        }

        const context = options?.context;
        const typename = this.typename();
        const promises = [];
        for (let i = 0; i < pids.length; i++) {
            const pid = pids[i];
            if (!isPositiveInteger(pid)) {
                continue;
            }
            const p = killPIDAndWaitUntilFullyStopped(pid,
                {
                    ... (options?.abortSignal && {
                        abortSignal: options.abortSignal
                    }),
                    ... (options?.progressCb && {
                        progressCb: (args) => {
                            options.progressCb?.({
                                ...args,
                                value: {
                                    state: 'kill',
                                    type: typename,
                                    pid,
                                    context
                                }
                            });
                        }
                    })
                });
            promises.push(p);
        }
    }
}

/**
 * @param {types.ServerServiceArgs} args
 */
export class ServerService extends Service {

    /** @type {string=} */
    #protocol;
    /** @type {number} */
    #port;

    /** 
     * @override
     * @returns {typeof ServerService} 
     */
    theClass() { return ServerService; }

    /**
     * @param {types.ServerServiceArgs} args 
     */
    constructor(args) {
        throwIfNotStrictlyPositiveInteger(args.port);

        super(args);

        this.#port = args.port;
        if (args.protocol) {
            this.#protocol = args.protocol;
        }

        // Check url validity
        const u = this.url;
        assert(u.port === this.#port.toString());
        assert(u.hostname === this.hostname);
    }

    get port() { return this.#port; }
    get protocol() { return this.#protocol; }
    get url() {
        return new URL(this.urlString);
    }
    get urlString() {
        const protocol = this.#protocol ?? 'http:';
        const port = (this.#port) ? ':' + this.#port.toString() : '';
        return protocol + '//' + this.hostname + port;
    }
    get urlv4String() {
        const protocol = this.#protocol ?? 'http:';
        const port = (this.#port) ? ':' + this.#port.toString() : '';
        if (this.hostname === 'localhost') {
            return protocol + '//127.0.0.1' + port;
        }
        return protocol + '//' + this.hostname + port;
    }

    toJSON() {
        const json = {
            ...super.toJSON(),
            port: this.#port,
            protocol: this.#protocol,
        };
        return json;
    }

    /** 
     * @protected
     * @abstract
     */
    async isBusyOverride() {
        // check if port in use
        const portInUse = await isPortInUse(this.port);
        if (portInUse) {
            throw new CodeError(
                this._msgFmt(`port ${this.port} already in use.`),
                ERROR_CODES.PORT_IN_USE_ERROR);
        }
    }

    /**
     * @protected
     * @param {?number=} pid 
     */
    _msgPrfx(pid) {
        return (pid)
            ? `${this.typename()} (${this.hostname}:${this.port}, pid=${pid.toString()}) : `
            : `${this.typename()} (${this.hostname}:${this.port}) : `
    }


    /**
     * @param {string} endpoint 
     * @param {number} chainid 
     * @param {Wallet} signer 
     */
    async getAuthorization(endpoint, chainid, signer) {
        throwIfNullishOrEmptyString(endpoint);
        throwIfNotStrictlyPositiveInteger(chainid);

        try {
            const address = toChecksumAddress(await signer.getAddress());
            const query = "chainId=" + chainid + "&address=" + address;
            const url = new URL(endpoint + "?" + query, this.url);

            const challengeResponse = await httpGET(url);
            const challenge = JSON.parse(challengeResponse);
            if (!challenge) {
                return null;
            }
            if (challenge.hasOwnProperty('ok')) {
                if (!challenge.ok) {
                    return null;
                }
            }

            /*
            Challenge format:
            =================

            {
                ok: true,
                data: {
                    types: {
                        EIP712Domain: [
                            { name: "name", type: "string", },
                            { name: "version", type: "string", },
                            { name: "chainId", type: "uint256", },
                        ],
                        Challenge: [
                            { name: "challenge", type: "string", },
                        ],
                    },
                    domain: { name: "iExec Gateway", version: "1", chainId: "1337", },
                    primaryType: "Challenge",
                    message: {
                        challenge: "Sign this message to log into iExec Gateway: cjOuBp3mAPpnvTe9Y8uULBOWzIRkCFOe",
                    },
                },
            }
            */

            const data = (challenge.data) ? challenge.data : challenge;
            const domain = data.domain;
            const message = data.message;

            const { EIP712Domain, ...types } = data.types;
            if (!domain || !types || !message) {
                throw new TypeError('Unexpected challenge format');
            }

            let rawSignature65 = null;
            try {
                if (signer._signTypedData && typeof signer._signTypedData === 'function') {
                    rawSignature65 = await signer._signTypedData(domain, types, message);
                } else {
                    /** @type {any} */
                    const _signer = signer;
                    if (_signer.signTypedData && typeof _signer.signTypedData === 'function') {
                        rawSignature65 = await _signer.signTypedData(domain, types, message);
                    } else {
                        throw new TypeError('internal error');
                    }
                }
            } catch (err) {
                if (err instanceof Error) {
                    console.log(err.stack);
                }
                throw err;
            }

            let hash = null;
            try {
                if (ethersutils._TypedDataEncoder && (typeof ethersutils._TypedDataEncoder.hash === 'function')) {
                    hash = ethersutils._TypedDataEncoder.hash(domain, types, message);
                } else {
                    /** @type {any} */
                    const _ethersutils = ethersutils;
                    if (_ethersutils.TypedDataEncoder && (typeof _ethersutils.TypedDataEncoder.hash === 'function')) {
                        hash = _ethersutils.TypedDataEncoder.hash(domain, types, message);
                    } else {
                        throw new TypeError('internal error');
                    }
                }
            } catch (err) {
                if (err instanceof Error) {
                    console.log(err.stack);
                }
                throw err;
            }

            assert(hash);
            assert(rawSignature65);

            return hash + '_' + rawSignature65 + '_' + address;
        } catch (err) {
            return null;
        }
    }
}
