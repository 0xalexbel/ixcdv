import * as ERROR_CODES from "../common/error-codes.js";
import * as types from '../common/common-types.js';
import * as pocoTypes from '../poco/poco-types.js';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as util from 'util';
import assert from 'assert';
import * as truffle from './truffle.js';
import { copyFile } from 'fs/promises';
import { dirExists, fileExists, mkDir, readObjectFromJSONFile, rmFileSync, rmrf, saveToFile, throwIfDirAlreadyExists, throwIfDirDoesNotExist, throwIfFileDoesNotExist, throwIfParentDirDoesNotExist, which } from '../common/fs.js';
import { isBytes32String, toChecksumAddress } from '../common/ethers.js';
import { ensureSuffix, throwIfNullishOrEmptyString } from '../common/string.js';
import { CodeError, fail, falseOrThrowAny, nullOrThrowAny } from '../common/error.js';
import { throwIfNotStrictlyPositiveInteger } from '../common/number.js';
import { POCO_CONTRACT_NAMES } from '../common/contractref.js';

export async function isTruffleInstalled() {
    const path = await which('truffle');
    return !!(path);
}

/**
 * Simply call `rm -rf <srcDir>/build` 
 * @param {string} srcDir 
 */
async function truffleClean(srcDir) {
    const builDir = path.join(srcDir, 'build');
    if (!dirExists(builDir)) {
        return;
    }
    rmrf(builDir);
}

/**
 * In <srcDir> : executes  `truffle compile --config <truffleConfigFile>`
 * Throws error if failed
 * @param {string} srcDir 
 * @param {string} truffleConfigFile 
 * @param {types.Strict=} options
 */
async function truffleCompile(srcDir, truffleConfigFile, options) {
    return truffle.compile(
        srcDir,
        ["--config", truffleConfigFile],
        null,
        options);
}

/**
 * In <srcDir> : executes  `truffle migrate --compile-none --config <truffleConfigFile>`
 * @param {string} srcDir 
 * @param {pocoTypes.PoCoConfig} PoCoConfig 
 * @param {string} truffleConfigFile 
 * @param {types.Strict=} options
 */
export async function trufflePoCoMigrate(
    srcDir,
    PoCoConfig,
    truffleConfigFile,
    options) {

    throwIfFileDoesNotExist(truffleConfigFile);

    /** @type {any} */
    let env = {
        "PATCH_SHANGHAI_FACTORY": 1
    };
    
    if (PoCoConfig.asset === 'Token') {
        if (PoCoConfig.kyc === true) {
            env ??= {};
            env["KYC"] = 1;
        }
    }
    if (PoCoConfig.salt) {
        assert(isBytes32String(PoCoConfig.salt));
        env ??= {};
        env["SALT"] = PoCoConfig.salt;
    }
    if (PoCoConfig.proxySalt != null) {
        assert(isBytes32String(PoCoConfig.proxySalt));
        env ??= {};
        env["PROXY_SALT"] = PoCoConfig.proxySalt;
    }

    const out = await truffle.migrate(
        srcDir,
        ["--compile-none", "--config", truffleConfigFile],
        env,
        options);

    assert(out.ok);
    return true;
}

/**
 * Throws error if failed
 * @param {string} PoCoDir 
 * @param {pocoTypes.PoCoConfig} PoCoConfig
 * @param {string} truffleConfigFile
 * @param {types.Strict & {
 *      quiet?: string,
 *      clean?: boolean
 *      compile?: boolean
 *      migrate?: boolean
 * }=} options 
 * @returns {types.PromiseOkOrCodeError}
 */
export async function trufflePoCoCompileAndMigrate(
    PoCoDir,
    PoCoConfig,
    truffleConfigFile,
    options = { strict: false }
) {
    // by default : clean === true
    const clean = (options.clean ?? true);
    const compile = (options.compile ?? true);
    const migrate = (options.migrate ?? true);
    try {
        // rm -rf <PoCoDir>/build
        if (clean) {
            await truffleClean(
                PoCoDir);
        }

        // cd <PoCoDir> && truffle compile --config <truffleConfigFile>
        if (compile) {
            await truffleCompile(
                PoCoDir,
                truffleConfigFile,
                { strict: true });
        }

        // cd <PoCoDir> && truffle migrate --config <truffleConfigFile>
        if (migrate) {
            await trufflePoCoMigrate(
                PoCoDir,
                PoCoConfig,
                truffleConfigFile,
                { strict: true });
        }
    } catch (err) {
        assert(err instanceof CodeError);
        return fail(err, options);
    }
    return { ok: true };
}

/**
 * Executes command `truffle networks`
 * - returns the command output if succeeded
 * - throws an error if failed, 
 * @param {!string} srcDir 
 * @param {!string} dstFile 
 */
async function truffleNetworks(srcDir, dstFile) {
    throwIfNullishOrEmptyString(dstFile);
    throwIfDirDoesNotExist(path.dirname(dstFile));

    const out = await truffle.networks(srcDir, [], null, { strict: true });

    assert(out.ok);
    assert(out.result);

    const networks = out.result;

    await saveToFile(
        networks,
        path.dirname(dstFile),
        path.basename(dstFile),
        { strict: true });

    return networks;
}

/**
 * Given a set of built contracts json files located in `srcContractsDir`,
 * generates a minified version in `dstMinContractsDir`.
 * - `dstMinContractsDir` parent directory must exist
 * - `dstMinContractsDir` must not exist
 * @param {string} srcContractsDir 
 * @param {string} dstMinContractsDir 
 * @param {types.Strict=} options
 */
export async function minifyContracts(
    srcContractsDir,
    dstMinContractsDir,
    options
) {
    try {
        throwIfDirDoesNotExist(srcContractsDir);
        throwIfParentDirDoesNotExist(dstMinContractsDir);
        throwIfDirAlreadyExists(dstMinContractsDir);

        // create folder if it does not yet exist
        // does not allow a recursive dir creation.
        mkDir(dstMinContractsDir, { strict: true });

        let files = await fsPromises.readdir(srcContractsDir);
        for (let i = 0; i < files.length; ++i) {
            const f = files[i];
            const fpath = path.join(srcContractsDir, f);
            const c = await readObjectFromJSONFile(fpath, { strict: true });
            assert(c.abi != null);
            assert(c.networks != null);
            // only keep abi + networks
            const c_min = { abi: c.abi, networks: c.networks };
            const json = JSON.stringify(c_min, null, 2);
            await saveToFile(json, dstMinContractsDir, f, { strict: true });
        }
        return true;
    } catch (err) {
        return falseOrThrowAny(err, options);
    }
}

/**
 * Generates `truffle-config.js` file in directory `truffleConfigJsDirname`.
 * Overrides any existing file.
 * - if succeeded : returns the generated file absolute pathname 
 * - if failed : returns `null` or throws an exception 
 * @param {string} host 
 * @param {number} port 
 * @param {string} truffleConfigJsDirname 
 * @param {types.Strict=} options
 */
export async function genTruffleConfigJs(
    host,
    port,
    truffleConfigJsDirname,
    options
) {
    try {
        throwIfNullishOrEmptyString(host);
        throwIfNotStrictlyPositiveInteger(port);
        throwIfDirDoesNotExist(truffleConfigJsDirname);

        const truffleConfig = await import('./truffle-config.js');
        truffleConfig.default.networks.development.host = host;
        truffleConfig.default.networks.development.port = port;
        let js_code = util.inspect(truffleConfig.default, { depth: 100 });
        js_code = ensureSuffix(';', js_code);

        const f = path.join(truffleConfigJsDirname, 'truffle-config.js');
        fs.writeFileSync(f, 'module.exports = ');
        fs.appendFileSync(f, js_code);

        return f;
    } catch (err) {
        return nullOrThrowAny(err, options);
    }
}

/*
asset : 'Token' | "Native"
etoken : <address> | null | undefined
token: null | <address> | undefined
uniswap: true, false (default = false)
KYC=1 | undefined (default = no)
SALT= 
PROXY_SALT=
usefactory= true
usekyc
if (deploymentOptions.v5.AppRegistry)        AppRegistry.address        = deploymentOptions.v5.AppRegistry;
if (deploymentOptions.v5.DatasetRegistry)    DatasetRegistry.address    = deploymentOptions.v5.DatasetRegistry;
if (deploymentOptions.v5.WorkerpoolRegistry) WorkerpoolRegistry.address = deploymentOptions.v5.WorkerpoolRegistry;
if (deploymentOptions.v5.usefactory)
*/

/**
 * Generates the `<PoCoDir>/config/config.json` file
 * @param {string} PoCoDir 
 * @param {pocoTypes.PoCoConfig} PoCoConfig 
 */
async function genPoCoConfigJson(PoCoDir, PoCoConfig) {
    assert(PoCoConfig);
    assert(typeof PoCoConfig === 'object');
    assert(PoCoConfig.asset === 'Token' || PoCoConfig.asset === 'Native');

    // Generates a backup file named 'config.json.bak'
    // So we can keep the 'PoCo' repository clean 
    // after the truffle operations.   
    const configJson = path.join(PoCoDir, 'config', 'config.json');
    const configJsonBak = path.join(PoCoDir, 'config', 'config.json.bak');
    if (!fileExists(configJsonBak)) {
        if (!fileExists(configJson)) {
            return false;
        }
        try { await copyFile(configJson, configJsonBak); }
        catch (err) { return false; }
    }

    // Loads the 'config.json.bak' file
    // Adds a bunch of asserts to make sure the file
    // is valid.
    const config = await readObjectFromJSONFile(configJsonBak, { strict: false });
    if (!config?.chains?.default) {
        return false;
    }

    config.chains.default.asset = PoCoConfig.asset;
    if (PoCoConfig.asset === 'Token') {
        config.chains.default.uniswap = (PoCoConfig.uniswap === true);
    }

    if (PoCoConfig.asset === 'Token' &&
        PoCoConfig.token) {
        config.chains.default.token =
            toChecksumAddress(PoCoConfig.token);
    } else {
        config.chains.default.token = null;
    }

    if (PoCoConfig.asset === 'Token' &&
        PoCoConfig.kyc === true &&
        PoCoConfig.etoken) {
        config.chains.default.etoken =
            toChecksumAddress(PoCoConfig.etoken);
    } else {
        assert(!config.chains.default.etoken);
    }

    if (PoCoConfig.AppRegistry) {
        config.chains.default.v5.AppRegistry =
            toChecksumAddress(PoCoConfig.AppRegistry);
    } else {
        assert(!config.chains.default.v5.AppRegistry);
    }
    if (PoCoConfig.DatasetRegistry) {
        config.chains.default.v5.DatasetRegistry =
            toChecksumAddress(PoCoConfig.DatasetRegistry);
    } else {
        assert(!config.chains.default.v5.DatasetRegistry);
    }
    if (PoCoConfig.WorkerpoolRegistry) {
        config.chains.default.v5.WorkerpoolRegistry =
            toChecksumAddress(PoCoConfig.WorkerpoolRegistry);
    } else {
        assert(!config.chains.default.v5.WorkerpoolRegistry);
    }

    assert(config.chains.default.v5.usefactory === true);

    const configJsonStr = JSON.stringify(config, null, 2);

    // Save to '<PoCoDir>/config/config.json'
    return await saveToFile(
        configJsonStr,
        path.dirname(configJson),
        path.basename(configJson),
        { strict: false });
}

/**
 * Restores `<PoCoDir>/config/config.json`
 * Deletes `<PoCoDir>/config/config.json.bak`
 * @param {string} PoCoDir 
 */
async function restorePoCoConfigJson(PoCoDir) {
    const configJson = path.join(PoCoDir, 'config', 'config.json');
    const configJsonBak = path.join(PoCoDir, 'config', 'config.json.bak');
    if (!fileExists(configJsonBak)) {
        return true;
    }

    try { await copyFile(configJsonBak, configJson); }
    catch (err) { return false; }

    return rmFileSync(configJsonBak);
}

/**
 * Ganache must be running
 * @param {number} chainid 
 * @param {string} truffleConfigFile 
 * @param {string} PoCoDir 
 * @param {pocoTypes.PoCoConfig} PoCoConfig 
 * @param {types.Strict & {
*      quiet?: string,
*      clean?: boolean
*      compile?: boolean
*      migrate?: boolean
* }=} options 
* @returns {types.PromiseResultOrCodeError<pocoTypes.PoCoContracts>}
*/
export async function trufflePoCo(
    chainid,
    truffleConfigFile,
    PoCoDir,
    PoCoConfig,
    options
) {
    // Generates the required PoCo 'config.json' file
    const ok = await genPoCoConfigJson(PoCoDir, PoCoConfig);

    if (!ok) {
        await restorePoCoConfigJson(PoCoDir);

        const err = new CodeError(
            `truffle operation failed. Unable to generate PoCo config.json`,
            ERROR_CODES.POCO_ERROR);
        return fail(err, options);
    }

    // Executes :
    // - rm -rf <PoCoDir>/build
    // - truffle compile 
    // - truffle migrate
    // Throws an error if failed
    const out = await trufflePoCoCompileAndMigrate(
        PoCoDir,
        PoCoConfig,
        truffleConfigFile,
        options);
    if (!out.ok) {
        assert(out.error);
        assert(!(options?.strict));
        return out;
    }

    // Retrieve the deployed addresses
    const deployedAddr = await genPoCoDeployedAddr(chainid, PoCoDir);

    // Restore the original PoCo 'config.json' file
    await restorePoCoConfigJson(PoCoDir);

    return { ok: true, result: deployedAddr };
}

/**
 * Parse each contract and retrieve the corresponding
 * deployed address.
 * @param {number} chainid 
 * @param {string} PoCoDir 
 */
async function genPoCoDeployedAddr(chainid, PoCoDir) {
    const PoCoContractsDir = path.join(PoCoDir, 'build/contracts');

    /** @type {pocoTypes.PoCoContracts} */
    const deployedAddresses = {};

    for (let j = 0; j < POCO_CONTRACT_NAMES.length; ++j) {
        const o = await readObjectFromJSONFile(
            path.join(PoCoContractsDir, POCO_CONTRACT_NAMES[j] + '.json'),
            { strict: false });
        if (o?.networks?.[chainid]) {
            deployedAddresses[POCO_CONTRACT_NAMES[j]] = o.networks[chainid].address;
        }
    }

    return deployedAddresses;
}
