import * as types from '../common-types.js';
import assert from 'assert';
import * as path from 'path';
import { dirExists, readFileLineByLineSync, toAbsolutePath } from "../fs.js";
import { assertIsArray } from '../assert-strict.js';
import { isNullishOrEmptyString, removePrefix, removeSuffix } from '../string.js';

const IXCDV_ROOT_NAME_SUFFIX = '-ixcdv-';

/**
 * @param {!string} repoName
 * @param {!string} dir 
 * @param {types.Strict=} options
 */
function parseGradleDotPropertiesFile(repoName, dir, options = { strict: false }) {
    const lines = readFileLineByLineSync(path.join(dir, 'gradle.properties'), options);
    if (!lines) {
        return null;
    }
    return parseGradleDotProperties(repoName, lines, options);
}

/**
 * @param {!string} repoName
 * @param {!string[] | !string} gradleDotPropertiesLines
 * @param {types.Strict=} options
 */
export function parseGradleDotProperties(repoName, gradleDotPropertiesLines, options = { strict: false }) {
    let linesArray = gradleDotPropertiesLines;
    if (typeof gradleDotPropertiesLines === 'string') {
        linesArray = gradleDotPropertiesLines.split('\n');
    }
    assertIsArray(linesArray);

    /** @type {types.iExecRepoVersions} */
    const versions = { name: repoName, dependencies: {} };

    const prefix_iexecCommonVersion = 'iexecCommonVersion=';
    const prefix_iexecBlockchainAdapterVersion = 'iexecBlockchainAdapterVersion=';
    const prefix_iexecResultVersion = 'iexecResultVersion=';
    const prefix_iexecSmsVersion = 'iexecSmsVersion=';

    for (let i = 0; i < linesArray.length; ++i) {
        if (linesArray[i].startsWith('version=')) {
            versions['version'] = linesArray[i].substring(8);
        }
        else if (linesArray[i].startsWith(prefix_iexecCommonVersion)) {
            versions.dependencies['iexec-common'] = linesArray[i].substring(prefix_iexecCommonVersion.length);
        }
        else if (linesArray[i].startsWith(prefix_iexecBlockchainAdapterVersion)) {
            versions.dependencies['iexec-blockchain-adapter-api'] = linesArray[i].substring(prefix_iexecBlockchainAdapterVersion.length);
        }
        else if (linesArray[i].startsWith(prefix_iexecResultVersion)) {
            versions.dependencies['iexec-result-proxy'] = linesArray[i].substring(prefix_iexecResultVersion.length);
        }
        else if (linesArray[i].startsWith(prefix_iexecSmsVersion)) {
            versions.dependencies['iexec-sms'] = linesArray[i].substring(prefix_iexecSmsVersion.length);
        } else if (linesArray[i].startsWith('iexec') && linesArray[i].indexOf('Version=') > 0) {
            console.debug(`Unknown package version property '${linesArray[i]}' in repo '${repoName}' (file=gradle.properties)`);
            if (options.strict) {
                throw new Error(`Unknown package version property '${linesArray[i]}' in repo '${repoName}' (file=gradle.properties)`);
            }
            return null;
        }
    }

    return versions;
}

/**
 * @param {!string} dir 
 * @param {(types.Strict & { 
 *      typesMap?: Map<string,Map<string, any>>
 *      recursive?: boolean
 * })=} options
 * @returns {{
 *      rootProjectName: string
 *      version: string
 *      directory: string
 *      dependencies: any[]
 * } | null}
 */
export function parseSettingsDotGradleFile(dir, options = { recursive: false, strict: false }) {
    return __parseSettingsDotGradleFile(dir, options);
}

/**
 * @param {!string} dir 
 * @param {(types.Strict & { 
 *      typesMap?: Map<string,Map<string, any>>
 *      recursive?: boolean
 * })=} options
 */
function __parseSettingsDotGradleFile(dir, options = { recursive: false, strict: false }) {
    const lines = readFileLineByLineSync(path.join(dir, 'settings.gradle'), options);
    if (!lines) {
        return null;
    }

    const settings = parseSettingsDotGradle(dir, lines, options);

    // if (options.typesMap) {
    //     let projects =options.typesMap.get(settings.rootProjectName);
    //     if (!projects) {
    //         projects = new Map();
    //         options.typesMap.set(settings.rootProjectName, projects);
    //     }
    //     if (!projects.has(settings.directory)) {
    //         projects.set(settings.directory, settings);
    //     }
    // }

    if (options.recursive === true) {
        for (let i = 0; i < settings.dependencies.length; ++i) {
            const s = settings.dependencies[i];

            const depSettings = __parseSettingsDotGradleFile(s, options);
            settings.dependencies[i] = depSettings;
        }
    }

    if (options.typesMap) {
        let projects = options.typesMap.get(settings.rootProjectName);
        if (!projects) {
            projects = new Map();
            options.typesMap.set(settings.rootProjectName, projects);
        }
        if (!projects.has(settings.directory)) {
            projects.set(settings.directory, settings);
        }
    }

    return settings;
}

/**
 * @param {string} line 
 */
export function parseSettingsRootProjectName(line) {
    line = line.trim();
    const prefix = 'rootProject.name';
    if (!line.startsWith(prefix)) {
        return undefined;
    }
    line = line.substring(prefix.length).trim();
    if (!line.startsWith('=')) {
        return undefined;
    }
    line = line.substring(1).trim();

    const quoteChar = "'";
    const doubleQuoteChar = '"';
    if (line.startsWith(quoteChar)) {
        if (!line.endsWith(quoteChar)) {
            return undefined;
        }
        line = removePrefix(quoteChar, line);
        line = removeSuffix(quoteChar, line);
    } else if (line.startsWith(doubleQuoteChar)) {
        if (!line.endsWith(doubleQuoteChar)) {
            return undefined;
        }
        line = removePrefix(doubleQuoteChar, line);
        line = removeSuffix(doubleQuoteChar, line);
    }

    const pos = line.indexOf(IXCDV_ROOT_NAME_SUFFIX);
    if (pos >= 0) {
        line = line.substring(0, pos);
    }
    return line;
}

/**
 * @param {string} projectName 
 * @param {string} version 
 */
export function toUniqueSettingsRootProjectName(projectName, version) {
    version = removePrefix('v', version.trim());
    return projectName + IXCDV_ROOT_NAME_SUFFIX + version;
}

/**
 * @param {!string} dir 
 * @param {!string[] | !string} settingsDotGradleLines
 * @param {types.Strict=} options
 */
function parseSettingsDotGradle(dir, settingsDotGradleLines, options = { strict: false }) {
    let linesArray = settingsDotGradleLines;
    if (typeof settingsDotGradleLines === 'string') {
        linesArray = settingsDotGradleLines.split('\n');
    }
    assertIsArray(linesArray);

    const settings = {
        rootProjectName: '',
        uniqueRootProjectName: '',
        version: '',
        directory: dir,
        dependencies: new Array()
    };

    for (let i = 0; i < linesArray.length; ++i) {
        if (linesArray[i].startsWith('rootProject.name')) {
            let name = parseSettingsRootProjectName(linesArray[i]);
            assert(name);
            assert(name.length > 0);
            settings.rootProjectName = name;
            continue;
        }
        if (!linesArray[i].startsWith("includeBuild ")) {
            continue;
        }
        let d = linesArray[i].substring("includeBuild ".length).trim();
        d = d.substring(1, d.length - 1);
        const depDir = toAbsolutePath(dir, d);
        settings.dependencies.push(depDir);
    }

    if (dirExists(dir) && !isNullishOrEmptyString(settings.rootProjectName)) {
        const versions = parseGradleDotPropertiesFile(settings.rootProjectName, dir, options);
        settings.version = versions?.version ?? '';
    }

    if (settings.version.length > 0) {
        const v = removePrefix('v', settings.version.trim()).trim();
        settings.uniqueRootProjectName = toUniqueSettingsRootProjectName(settings.rootProjectName, v);
    }

    return settings;
}
