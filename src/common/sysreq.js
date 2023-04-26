import * as types from './common-types.js';
import { which } from "./fs.js";

import * as nodeUtil from 'util';
import { exec as childProcessExec } from 'child_process';
import { isNullishOrEmptyString } from "./string.js";
const exec_promise = nodeUtil.promisify(childProcessExec);

export class SystemRequirements {

    /** 
     * @type {{
     *      [bin:string]: { 
     *          url?: string
     *          brew?: string[]
     *          macOsInstallPage?: string,
     *          productUrl?: string
     *          productName?: string
     *          npm?: string
     *          gitRepo?: string
     *          version: string
     *          parsedVersion: string
     *          bin: string
     *          binPath: string
     *          getVersion: () => Promise<string>
     *          parseVersion: (version: string) => string
     *      }
     * }} 
     */
    #dependencies = {
        'git': {
            url: 'https://git-scm.com/',
            brew: ['brew install git'],
            version: '',
            parsedVersion: '',
            bin: 'git',
            binPath: '',
            getVersion: getGitVersion,
            parseVersion: parseGitVersion
        },
        'ipfs': {
            url: 'https://ipfs.io/',
            macOsInstallPage: 'https://docs.ipfs.tech/install/command-line/#macos',
            version: '',
            parsedVersion: '',
            bin: 'ipfs',
            binPath: '',
            getVersion: getIpfsVersion,
            parseVersion: parseIpfsVersion
        },
        'gradle': {
            url: 'https://gradle.org/',
            brew: ['brew install gradle'],
            version: '',
            parsedVersion: '',
            bin: 'gradle',
            binPath: '',
            getVersion: getGradleVersion,
            parseVersion: parseGradleVersion
        },
        'npm': {
            url: 'https://docs.npmjs.com/',
            version: '',
            parsedVersion: '',
            bin: 'npm',
            binPath: '',
            getVersion: getNpmVersion,
            parseVersion: (version) => version
        },
        'docker': {
            url: 'https://docker.com/',
            productUrl: 'https://www.docker.com/products/docker-desktop/',
            productName: 'Docker desktop for macos',
            version: '',
            parsedVersion: '',
            bin: 'docker',
            binPath: '',
            getVersion: getDockerVersion,
            parseVersion: parseDockerVersion
        },
        'mongo': {
            macOsInstallPage: 'https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-os-x/',
            brew: ["brew tap mongodb/brew", "brew update", "brew install mongodb-community@6.0"],
            version: '',
            parsedVersion: '',
            bin: 'mongod',
            binPath: '',
            getVersion: getMongoVersion,
            parseVersion: parseMongoVersion
        },
        'redis': {
            macOsInstallPage: 'https://redis.io/docs/getting-started/installation/install-redis-on-mac-os/',
            brew: ["brew install redis"],
            version: '',
            parsedVersion: '',
            bin: 'redis-server',
            binPath: '',
            getVersion: getRedisVersion,
            parseVersion: parseRedisVersion
        },
        'truffle': {
            gitRepo: 'https://github.com/trufflesuite/truffle',
            npm: "npm install -g truffle",
            version: '',
            parsedVersion: '',
            bin: 'truffle',
            binPath: '',
            getVersion: getTruffleVersion,
            parseVersion: parseTruffleVersion
        },
        'ganache': {
            gitRepo: 'https://github.com/trufflesuite/ganache',
            npm: "npm install -g ganache",
            version: '',
            parsedVersion: '',
            bin: 'ganache',
            binPath: '',
            getVersion: getGanacheVersion,
            parseVersion: parseGanacheVersion
        }
    }

    /** @type {string=} */
    #nodeVersion;

    /** @type {string=} */
    #javaPath;

    constructor() { }

    /**
     * @param {types.progressCallback=} progressCb 
     */
    async init(progressCb) {

        const countDeps = Object.keys(this.#dependencies).length;
        await Promise.all(Object.entries(this.#dependencies)
            .map(async (e) => {
                e[1].binPath = (await which(e[1].bin)) ?? '';
            }));

        this.#javaPath = await which('java');
        this.#nodeVersion = await getNodeVersion();

        let j = 0;
        await Promise.all(Object.entries(this.#dependencies)
            .map(async (e) => {
                e[1].version = (await e[1].getVersion()) ?? '';
                e[1].parsedVersion = e[1].parseVersion(e[1].version) ?? '';
                if (progressCb) {
                    progressCb({ count: j, total: countDeps, value: e });
                }
                j++;
            }));
    }

    /**
     * @param {string} bin 
     */
    #getMissingMsg(bin) {
        const msg = this.#dependencies[bin];
        const tab = ' '.repeat(4);
        let s = `'${bin}' is not installed on this machine:`;
        if (msg.url) {
            s += `\n${tab}- For more info about '${bin}' visit: ${msg.url}`;
        }
        if (msg.productName && msg.productUrl) {
            s += `\n${tab}- ${msg.productName} : ${msg.productUrl}`;
        }
        if (msg.gitRepo) {
            s += `\n${tab}- '${bin}' git repo: ${msg.gitRepo}`;
        }
        if (msg.macOsInstallPage) {
            s += `\n${tab}- MacOS specific install page: ${msg.macOsInstallPage}`;
        }
        if (msg.brew) {
            s += `\n${tab}- To install '${bin}' using Homebrew, run:`;
            for (let j = 0; j < msg.brew.length; ++j) {
                s += `\n${tab}  $ ${msg.brew[j]}`;
            }
        }
        if (msg.npm) {
            s += `\n${tab}- To install '${bin}' globally using npm, run:`;
            s += `\n${tab}  $ ${msg.npm}`;
        }
        return s;
    }

    countMissing() {
        const deps = Object.keys(this.#dependencies);
        let countMissing = 0;
        for (let i = 0; i < deps.length; ++i) {
            const d = this.#dependencies[deps[i]];
            const path = d.binPath;
            const version = d.parsedVersion;
            if (isNullishOrEmptyString(path) ||
                isNullishOrEmptyString(version)) {
                countMissing++;
            }
        }
        return countMissing;
    }

    toMessage() {
        const o = this.toJSON();
        const bins = Object.entries(o);
        let s = '';
        let prefix = '';

        let countMissing = 0;
        for (let i = 0; i < bins.length; ++i) {
            const path = bins[i][1].path;
            const version = bins[i][1].version;
            if (isNullishOrEmptyString(path) ||
                isNullishOrEmptyString(version)) {
                countMissing++;
            }
        }

        const countInstalled = bins.length - countMissing;

        if (countInstalled > 0) {
            s += '\n';
            s += 'Installed software tools:\n';
            s += '=========================\n';
            for (let i = 0; i < bins.length; ++i) {
                const bin = bins[i][0];
                const path = bins[i][1].path;
                const version = bins[i][1].version;
                if (isNullishOrEmptyString(path) ||
                    isNullishOrEmptyString(version)) {
                    continue;
                }
                s += `\n${bin}\t  version: ${version}`;
            }
            prefix = '\n';
        }

        if (countMissing > 0) {
            s += prefix + '\n';
            s += 'Missing software tools:\n';
            s += '=======================\n';
            for (let i = 0; i < bins.length; ++i) {
                const bin = bins[i][0];
                const path = bins[i][1].path;
                const version = bins[i][1].version;
                if (isNullishOrEmptyString(path) ||
                    isNullishOrEmptyString(version)) {
                    const m = this.#getMissingMsg(bin);
                    s += '\n' + m;
                }
            }
        }
        return s;
    }

    toJSON() {
        return Object.fromEntries(Object.entries(this.#dependencies)
            .map(([name, info]) => [name, { path: info.binPath, version: info.parsedVersion }]));
    }
}

    /**
     * @param {types.progressCallback=} progressCb 
     */
    export async function getSysReq(progressCb) {
    const sr = new SystemRequirements();
    await sr.init(progressCb);
    return sr;
}

async function getNodeVersion() {
    try {
        return (await exec_promise(`node --version`)).stdout.trim();
    } catch { }
    return '';
}

async function getNpmVersion() {
    try {
        return (await exec_promise(`npm --version`)).stdout.trim();
    } catch { }
    return '';
}

async function getMongoVersion() {
    try {
        return (await exec_promise(`mongod --version`)).stdout.trim();
    } catch { }
    return '';
}

async function getGitVersion() {
    try {
        return (await exec_promise(`git --version`)).stdout.trim();
    } catch { }
    return '';
}
/**
 * @param {string} v 
 */
function parseGitVersion(v) {
    const prefix = 'git version ';
    if (v.indexOf(prefix) >= 0) {
        return v.substring(prefix.length, v.indexOf(' ', prefix.length));
    }
    return '';
}

async function getRedisVersion() {
    try {
        return (await exec_promise(`redis-server -v`)).stdout.trim();
    } catch { }
    return '';
}
/**
 * @param {string} v 
 */
function parseRedisVersion(v) {
    const prefix = 'Redis server v=';
    if (v.indexOf(prefix) >= 0) {
        return v.substring(prefix.length, v.indexOf(' ', prefix.length));
    }
    return '';
}

async function getIpfsVersion() {
    try {
        return (await exec_promise(`ipfs --version`)).stdout.trim();
    } catch { }
    return '';
}

/**
 * @param {string} v 
 */
function parseIpfsVersion(v) {
    const prefix = 'ipfs version ';
    if (v.indexOf(prefix) >= 0) {
        return v.substring(prefix.length);
    }
    return '';
}

async function getDockerVersion() {
    try {
        return (await exec_promise(`docker --version`)).stdout.trim();
    } catch { }
    return '';
}
/**
 * @param {string} v 
 */
function parseMongoVersion(v) {
    const prefix = 'db version ';
    if (v.indexOf(prefix) >= 0) {
        return v.substring(prefix.length, v.indexOf('\n'));
    }
    return '';
}

/**
 * @param {string} v 
 */
function parseDockerVersion(v) {
    const prefix = 'Docker version ';
    if (v.indexOf(prefix) >= 0) {
        return v.substring(prefix.length, v.indexOf(','));
    }
    return '';
}

async function getTruffleVersion() {
    try {
        return (await exec_promise(`truffle version`)).stdout.trim();
    } catch { }
    return '';
}
/**
 * @param {string} v 
 */
function parseTruffleVersion(v) {
    const prefix = 'Truffle ';
    if (v.indexOf(prefix) >= 0) {
        return v.substring(prefix.length, v.indexOf(' ', prefix.length));
    }
    return '';
}

async function getGanacheVersion() {
    try {
        return (await exec_promise(`ganache --version`)).stdout.trim();
    } catch { }
    return '';
}
/**
 * @param {string} v 
 */
function parseGanacheVersion(v) {
    const prefix = 'ganache ';
    if (v.indexOf(prefix) >= 0) {
        return v.substring(prefix.length, v.indexOf(' ', prefix.length));
    }
    return '';
}

async function getGradleVersion() {
    try {
        return (await exec_promise(`gradle --version`)).stdout.trim();
    } catch { }
    return '';
}
/**
 * @param {string} v 
 */
function parseGradleVersion(v) {
    const prefix = 'Gradle ';
    const i = v.indexOf(prefix);
    if (i >= 0) {
        return v.substring(i + prefix.length, v.indexOf('\n', i + prefix.length));
    }
    return '';
}
