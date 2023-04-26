import * as types from './types.js'
import assert from 'assert';
import { isNullishOrEmptyString } from './string.js';
import {
    assertIsNullishOrArray,
    assertIsNullisOrObject,
    assertIsString,
    assertNotNullish
} from './assert-strict.js';

const BASH_NEW_LINE_TAB = ' \\\n    ';

/**
 * @param {string[]=} args 
 */
function argsToScript(args) {
    if (!args) {
        return '';
    }
    let args_str = '';
    for (let i = 0; i < args.length; ++i) {
        const arg = args[i];
        assertIsString(arg);

        if (arg.startsWith('-')) {
            // Ex: -h or --help
            args_str += BASH_NEW_LINE_TAB + arg;
        } else {
            if (arg.startsWith('"')) {
                // Ex: "/path/to/file"
                assert(arg.endsWith('"'))
                args_str += " " + arg;
            } else if (arg.startsWith("'")) {
                // Ex: '/path/to/file'
                assert(arg.endsWith("'"))
                args_str += " " + arg;
            } else {
                assert(arg.indexOf('"') < 0);
                assert(arg.indexOf("'") < 0);
                if (arg.indexOf(' ') < 0) {
                    args_str += " " + arg;
                } else {
                    //add double-quotes between arg 
                    args_str += " \"" + arg + "\"";
                }
            }
        }
    }
    return args_str;
}

/**
 * @param {Object.<string,string>=} envs 
 */
function envsToScript(envs) {
    if (!envs) {
        return '';
    }
    let envs_str = '';
    let sep = '';
    const envNames = Object.keys(envs);
    for (let i = 0; i < envNames.length; ++i) {
        const e_name = envNames[i];
        const e_value = envs[e_name];
        assertIsString(e_value);
        if (e_value.startsWith("'")) {
            assert(e_value.endsWith("'"));
            envs_str += sep + e_name + '=' + e_value;
        } else if (e_value.startsWith('"')) {
            assert(e_value.endsWith('"'));
            envs_str += sep + e_name + '=' + e_value;
        } else {
            assert(e_value.indexOf('"') < 0);
            assert(e_value.indexOf("'") < 0);
            if (e_value.indexOf(' ') < 0) {
                envs_str += sep + e_name + "='" + e_value + "'";
            } else {
                envs_str += sep + e_name + '="' + e_value + '"';
            }
        }
        sep = ' ';
    }
    return envs_str;
}

/**
 * WARNING !!! MUST GENERATE A 'bash -c' NON-INTERACTIVE SCRIPT !!!
 * DO NOT INCLUDE `&&`, `||`, between commands! 
 * IT WILL EXIT BUT NEVER CLOSE (the streams are kept alive)
 * @param {string} command
 * @param {object} options
 * @param {string=} options.dir
 * @param {string[]=} options.args
 * @param {string=} options.logFile
 * @param {string=} options.pidFile
 * @param {Object.<string,string>=} options.env
 */
export function genNohupBashScript(command, options) {

    assertNotNullish(command);
    assertIsNullishOrArray(options.args);
    assertIsNullisOrObject(options.env);

    const logs = (isNullishOrEmptyString(options.logFile)) ? '/dev/null' : options.logFile;

    let script = "#!/bin/bash\n\n";

    // cd <dir>
    if (!isNullishOrEmptyString(options.dir)) {
        script += `cd '${options.dir}'\n`;
    }

    const args_str = argsToScript(options.args);
    const env_str = envsToScript(options.env);

    script += env_str + ' ';
    script += "nohup " +
        command + args_str + BASH_NEW_LINE_TAB +
        "> '" + logs + "' 2>&1 &\n";

    script += "pid=$!\n"
    if (options.pidFile) {
        script += "echo $pid > '" + options.pidFile + "'\n";
    }
    script += "echo $pid";

    return script;
}

/**
 * (set -m ; node -r dotenv/config "./src/${entry}" "dotenv_config_path=${dotenv_txt}" > "${log_file}" 2>&1 &)
 * @param {string} command
 * @param {object} options
 * @param {string=} options.dir
 * @param {string[]=} options.args
 * @param {string=} options.logFile
 * @param {string=} options.pidFile
 * @param {number=} options.version
 * @param {Object.<string,string>=} options.env
 */
export function genSetMBashScript(command, options) {
    assert(command != null);

    assertNotNullish(command);
    assertIsNullishOrArray(options.args);
    assertIsNullisOrObject(options.env);

    const version = options.version ?? 1;
    const logs = (isNullishOrEmptyString(options.logFile)) ? '/dev/null' : options.logFile;

    let script = "#!/bin/bash\n\n";

    // cd <dir>
    if (!isNullishOrEmptyString(options.dir)) {
        script += `cd '${options.dir}'\n`;
    }

    const args_str = argsToScript(options.args);
    const env_str = envsToScript(options.env);

    if (version === 1) {
        script += "(set -m ; " +
            env_str + ' ' +
            command +
            args_str + "> '" + logs + "' 2>&1 &)\n";
    } else if (version === 4) {
        script += "pid=$(set -e ; set -m ; " + 
            env_str + ' ' +
            command +
            args_str + ' ' + "> '" + logs + "' 2>&1 & _pid=$! ; echo $_pid)\n" +
            "if (( $? )); then exit 1; fi\n" +
            "echo $pid\n";
    }

    return script;
}
