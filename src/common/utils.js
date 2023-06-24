import assert from 'assert';
import { isNullishOrEmptyString, removePrefix, stringToPositiveInteger } from './string.js';
import { isPositiveInteger } from './number.js';
import { readFileLineByLineSync, readFileSync, saveToFileSync } from './fs.js';
import { CodeError } from './error.js';

/**
 * @param {*} v1 
 * @param {*} v2 
 */
export function typeEquals(v1, v2) {
    if (v1 === v2) {
        return true;
    }
    if (v1 === undefined || v1 === null) {
        return false;
    }
    return (typeof v1 === typeof v2);
}

/**
 * @param {*} obj 
 * @param {!string} property 
 */
export function getObjectOwnPropertyValue(obj, property) {
    if (!obj) {
        return; //undefined
    }
    if (typeof obj !== 'object') {
        return; //undefined
    }
    if (!obj.hasOwnProperty(property)) {
        return; //undefined
    }
    const descriptor = Object.getOwnPropertyDescriptor(obj, property);
    return descriptor?.value;
}

/**
 * @param {string[]} varNames 
 * @param {string} str 
 */
export function parseEnvVars(varNames, str) {
    assert(Array.isArray(varNames));
    /** @type {Object.<string, string>} */
    const o = {};
    for (let k = 0; k < varNames.length; ++k) {
        const varName = varNames[k];
        const s = ' ' + varName + '=';
        const j0 = str.indexOf(s);
        if (j0 < 0) {
            continue;
        }
        const j1 = str.indexOf(' ', j0 + s.length);
        const varValue = (j1 < 0) ?
            str.substring(j0 + s.length) :
            str.substring(j0 + s.length, j1);
        o[varName] = varValue;
    }
    return o;
}

/**
 * @param {string} s 
 * @param {number} i 
 */
function _findNextEq(s, i) {
    if (i === s.length - 1) {
        return -1;
    }
    while (true) {
        const nextEq = s.indexOf('=', i + 1);
        if (nextEq < 0) {
            return -1;
        }
        if (nextEq === s.length - 1) {
            return -1;
        }
        if (s.charAt(nextEq - 1) === '=') {
            i = nextEq;
            continue;
        }
        if (s.charAt(nextEq - 1) === ' ') {
            i = nextEq;
            continue;
        }
        return nextEq;
    }
}

/**
 * @param {string} s 
 * @param {number} i 
 */
function _isValidWhiteSpace(s, i) {
    assert(s.charAt(i) === ' ');
    const nextWS = s.indexOf(' ', i + 1);
    const nextEq = _findNextEq(s, i + 1);
    if (nextWS < 0) {
        if (nextEq < 0) {
            return false;
        }
        return true;
    }
    if (nextWS < nextEq) {
        return false;
    }
    return true;
}

/**
 * @param {string} varName
 * @param {string} str 
 */
export function parseSingleEnvVar(varName, str) {
    let s = str.trim();
    if (isNullishOrEmptyString(s)) {
        return; /* undefined */
    }

    const i0 = s.indexOf(' ' + varName + '=');
    assert(i0 >= 0);
    let i = i0 + 2 + varName.length;
    while (true) {
        const j = s.indexOf(' ', i);
        if (j < 0) {
            return s.substring(i0 + 2 + varName.length);
        }
        if (_isValidWhiteSpace(s, j)) {
            return s.substring(i0 + 2 + varName.length, j);
        }
        i = j + 1;
    }
}

/**
 * @param {string | URL} gitUrl 
 */
export function parseGitUrl(gitUrl) {
    const u = (typeof gitUrl === 'string') ? new URL(gitUrl) : gitUrl;
    if (u instanceof URL) {
        let commitish = removePrefix('#', u.hash);
        commitish = removePrefix('v', commitish);

        if (commitish.trim() !== '') {
            commitish = "v" + commitish;
        }

        u.hash = '';
        return { url: u.toString(), commitish };
    }
    throw new TypeError(`Invalid gitUrl=${gitUrl}`);
}

/**
 * @param {number} ms 
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @param {string} repoName 
 */
export function getRepoServiceType(repoName) {
    switch (repoName) {
        case 'iexec-sms': return "sms";
        case 'iexec-result-proxy': return "resultproxy";
        case 'iexec-core': return "core";
        case 'iexec-worker': return "worker";
        case 'iexec-blockchain-adapter-api': return "blockchainadapter";
        default: assert(false);
    }
}

/**
 * @param {*} v 
 */
export function toPositiveInteger(v) {
    if (v === null || v === undefined) {
        return undefined;
    }
    if (typeof v === 'number') {
        if (!isPositiveInteger(v)) {
            return undefined;
        }
    }
    if (typeof v === 'string') {
        return stringToPositiveInteger(v);
    }
    return undefined;
}

/**
 * @param {string[]} hostnames 
 * @param {string[]} ips 
 */
export function addToEtcHostsFile(hostnames, ips) {
    assert(hostnames.length === ips.length);

    const etchostsStr = readFileSync("/etc/hosts", { strict: true });
    if (!etchostsStr) {
        throw new CodeError("Unable to read '/etc/hosts'");
    }
    const new_etchostsStr = addToEtcHostsStr(hostnames, ips, etchostsStr);
    if (!etchostsStr) {
        throw new CodeError("Unable to read '/etc/hosts'");
    }
    assert(new_etchostsStr.length >= etchostsStr.length);
    saveToFileSync(new_etchostsStr, "/etc", "hosts");
}

/**
 * @param {string[]} hostnames 
 * @param {string[]} ips 
 * @param {string} etchostsStr 
 */
export function addToEtcHostsStr(hostnames, ips, etchostsStr) {
    if (!hostnames || hostnames.length === 0) {
        return etchostsStr;
    }
    if (!ips || ips.length === 0) {
        return etchostsStr;
    }
    if (hostnames.length !== ips.length) {
        throw new CodeError('Invalid args');
    }
    const lines = etchostsStr.split('\n');
    assert(lines);
    let addHostnames = [];
    let addIps = [];
    for (let i = 0; i < hostnames.length; ++i) {
        const hostname = hostnames[i];
        const ip = ips[i];
        let found = false;
        for (let j = 0; j < lines.length; ++j) {
            const line = lines[j].trim();

            let hasIp = false;
            let hasHostname = false;

            // look for ip
            let pos = line.indexOf(ip + " ");
            if (pos === 0) {
                hasIp = true;
            }

            pos = line.indexOf(" ");
            // remainings 
            let str = line.substring(pos).trim();
            pos = str.indexOf(hostname);
            if (pos < 0 || pos > 0 || str.length > hostname.length) {
                hasHostname = false;
            } else {
                hasHostname = true;
            }

            if (hasHostname && hasIp) {
                found = true;
                break;
            }

            if (hasHostname && !hasIp) {
                throw new CodeError(`Could not automatically add '${ip} ${hostname}' to /etc/hosts. Please add the line manually.`);
            }
        }
        if (!found) {
            addHostnames.push(hostname);
            addIps.push(ip);
        }
    }
    if (addHostnames.length === 0) {
        return etchostsStr;
    }
    lines.push("# Added by ixcdv");
    for (let i = 0; i < addHostnames.length; ++i) {
        lines.push(`${addIps[i]} ${addHostnames[i]}`);
    }
    lines.push("# End of section");
    return lines.join('\n');
}