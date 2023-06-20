import assert from 'assert';
import path from 'path';
import { CodeError } from '../common/error.js';
import { dirExists, errorDirDoesNotExist, fileExists, fileExistsInDir, resolveAbsolutePath } from '../common/fs.js';
import { isNullishOrEmptyString } from '../common/string.js';
import { ConfigFile } from '../services/ConfigFile.js';
import { Inventory } from '../services/Inventory.js';
import { PROD_BIN } from '../common/consts.js';

export class Cmd {

    /** @type {boolean} */
    #debugMode = false;

    /**
     * @param {any} commandOptions 
     * @param {any} error 
     */
    exit(commandOptions, error) {
        if (!error) {
            process.exit(0);
        }
        
        if (this.#debugMode) {
            console.error(error.stack);
        }
        if (!isNullishOrEmptyString(error.message)) {
            console.error(error.message);
        }
        process.exit(1);
    }

    /**
     * @param {string} pathToFileOrDir 
     */
    resolveConfigDir(pathToFileOrDir) {
        const configBasename = ConfigFile.basename();
        if (fileExists(pathToFileOrDir)) {
            const dn = path.dirname(pathToFileOrDir);
            const bn = path.basename(pathToFileOrDir);
            if (bn !== configBasename) {
                throw new CodeError(`File '${pathToFileOrDir}' is not a valid ixcdv config file.`);
            }
            pathToFileOrDir = dn;
        } else {
            if (!dirExists(pathToFileOrDir)) {
                throw new CodeError(`File or directory '${pathToFileOrDir}' does not exist.`);
            }
        }
        let d = resolveAbsolutePath(pathToFileOrDir);
        while (true) {
            if (fileExistsInDir(d, configBasename)) {
                return d;
            }
            try {
                const parent = path.dirname(d);
                if (parent === d) {
                    throw new CodeError(`Unable to locate config file '${ConfigFile.basename()}' in directory '${pathToFileOrDir}' or any of its parent directories.`);
                }
                d = parent;
            } catch (err) {
                throw new CodeError(`Unable to locate config file '${ConfigFile.basename()}' in directory '${pathToFileOrDir}' or any of its parent directories.`);
            }
            if (isNullishOrEmptyString(d)) {
                throw new CodeError(`Unable to locate config file '${ConfigFile.basename()}' in directory '${pathToFileOrDir}' or any of its parent directories.`);
            }
        }
    }

    /**
     * @param {string} dir 
     */
    exitIfNoConfig(dir) {
        if (!fileExistsInDir(dir, ConfigFile.basename())) {
            throw new CodeError(`Config file '${dir}/${ConfigFile.basename()}' does not exist. Call '${PROD_BIN} init' to create a new default '${ConfigFile.basename()}'`);
        }
    }

    /**
     * @param {Inventory} inventory
     * @param {*} options 
     */
    resolveHubAlias(inventory, options) {
        if (isNullishOrEmptyString(options.hub)) {
            return inventory.getDefaultHubAlias();
        }
        assert(typeof options.hub === 'string');
        return options.hub;
    }
    /**
     * @param {Inventory} inventory
     * @param {*} options 
     */
    resolveChainName(inventory, options) {
        if (isNullishOrEmptyString(options.chain)) {
            return inventory.getDefaultChainName();
        }
        assert(typeof options.chain === 'string');
        return options.chain;
    }

    get debugMode() { return this.#debugMode; }
    set debugMode(value) {
        this.#debugMode = value;
    }
}