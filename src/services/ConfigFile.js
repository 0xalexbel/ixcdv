import * as srvTypes from './services-types-internal.js';
import * as types from '../common/common-types.js';
import path from 'path';
import assert from 'assert';
import { Market } from './Market.js';
import { CoreService } from './Core.js';
import { ORDERED_SERVICE_TYPES, SERVICE_TYPE_INDICES, CHAIN_SERVICE_TYPES } from './base-internal.js';
import { InventoryDB, fromServiceType, resolveAndAddSortedConfigsToInventory } from './InventoryDB.js';
import { PORT_RANGE } from './default-ports.js';
import { DEFAULT_CONFIG } from './default-config.js';
import { DEFAULT_VERSIONS } from './default-versions.js';
import { newInventory } from './Inventory.js';
import { DockerService } from './DockerService.js';
import { MongoService } from './MongoService.js';
import { RedisService } from './RedisService.js';
import { fileExists, readObjectFromJSONFile, resolveAbsolutePath, toAbsolutePathWithPlaceholders, toRelativePath } from '../common/fs.js';
import { CodeError } from '../common/error.js';
import { isNullishOrEmptyString, removePrefix, removeSuffix, stringToHostnamePort } from '../common/string.js';
import { createRandomMnemonic, ethersIsValidMnemonic } from '../common/ethers.js';
import { IpfsService } from '../ipfs/IpfsService.js';
import { GanachePoCoService } from '../poco/GanachePoCoService.js';
import { throwIfNotStrictlyPositiveInteger } from '../common/number.js';
import { PROD_CONFIG_BASENAME } from '../common/consts.js';
import { deepCopyPackage } from '../pkgmgr/pkgmgr-deepcopy.js';
import { AbstractMachine, QemuMachine } from '../common/machine.js';

/**
 * @param {string} propertyName 
 * @param {string=} path 
 */
function errorMissingProperty(propertyName, path) {
    if (path) {
        return `${PROD_CONFIG_BASENAME} : Missing '${propertyName}' property (path=${path}).`;
    }
    return `${PROD_CONFIG_BASENAME} : Missing '${propertyName}' property.`;
}

/**
 * @param {string} propertyName 
 * @param {string=} path 
 */
function errorInvalidProperty(propertyName, path) {
    if (path) {
        return `${PROD_CONFIG_BASENAME} : Invalid '${propertyName}' property (path=${path}).`;
    }
    return `${PROD_CONFIG_BASENAME} : Invalid '${propertyName}' property.`;
}

/*
    /root/chains/dev/run
    /root/chains/dev/db

    /root/shared/ipfs/
    /root/shared/ganache.1337/
    /root/shared/ganache.1338/

    /root/sdk/

    /root/src/sms/libs
    /root/src/sms/iexec-sms
    /root/src/core/...

    /root/vscode ?
*/

/**
 * - `<root>/src/${version}/${repoName}`
 * - Ex: /Users/foo/my-workspace/src/v6.0.0/iexec-common
 * - Ex: /Users/foo/my-workspace/src/v7.1.0/iexec-sms
 * @param {string} root 
 */
function computeSrcDir(root) {
    //return path.join(root, 'src', name);
    return path.join(root, 'src/${version}/${repoName}');
}

/**
 * - `<root>/shared/run/<name>`
 * - Ex: /Users/foo/my-workspace/shared/run/ganache.1337
 * @param {string} root 
 * @param {string} name 
 */
function computeSharedRunDir(root, name) {
    // <root>/shared/run/<name>
    // Ex: /Users/foo/my-workspace/shared/run/ganache.1337
    return path.join(root, 'shared', 'run', name);
}

/**
 * - `<root>/shared/db/<name>`
 * - Ex: /Users/foo/my-workspace/shared/db/ganache.1337
 * @param {string} root 
 * @param {string} name 
 */
function computeSharedDBDir(root, name) {
    return path.join(root, 'shared', 'db', name);
}

/**
 * - `<root>/chains/<chain>/run/<type>`
 * - Ex: /Users/foo/my-workspace/chains/dev/run/sms
 * @param {string} root 
 * @param {string} chain 
 * @param {srvTypes.ServiceType} type 
 */
function computeChainRunDir(root, chain, type) {
    return path.join(root, 'chains', chain, 'run', type);
}

/**
 * - `<root>/chains/<chain>/db/<type>`
 * - Ex: /Users/foo/my-workspace/chains/dev/db/sms
 * @param {string} root 
 * @param {string} chain 
 * @param {srvTypes.ServiceType} type 
 */
function computeChainDBDir(root, chain, type) {
    return path.join(root, 'chains', chain, 'db', type);
}

export class ConfigFile {

    /**
     * @param {string} dir 
     * @param {{[varname:string]: string}} globalPlaceholders
     */
    static async loadFile(dir, globalPlaceholders) {
        assert(dir);
        dir = resolveAbsolutePath(dir);

        const configFile = path.join(dir, PROD_CONFIG_BASENAME);
        if (!fileExists(configFile)) {
            throw new CodeError(`Config file '${configFile}' does not exist`);
        }

        const configJson = await readObjectFromJSONFile(configFile, { strict: true });

        if (!configJson.chains || typeof configJson.chains !== 'object') {
            throw new CodeError(errorMissingProperty('chains', configFile));
        }
        if (!configJson.shared || typeof configJson.shared !== 'object') {
            throw new CodeError(errorMissingProperty('shared', configFile));
        }
        if (!configJson.vars) {
            configJson.vars = {
                "defaultHostname": "${master}",
                "localHostname": "${master}",
                "master": "localhost"
            }
        }
        if (typeof configJson.vars !== 'object') {
            throw new CodeError(errorInvalidProperty('vars', configFile));
        }
        if (isNullishOrEmptyString(configJson.default)) {
            const chainNames = Object.keys(configJson.chains);
            configJson.default = chainNames[0];
        }
        return ConfigFile.load(configJson, dir, globalPlaceholders);
    }

    /**
     * @param {number} firstChainId
     * @param {number} countChainIds 
     * @param {(string | string[])=} mnemonics 
     */
    static default(firstChainId, countChainIds, mnemonics) {
        throwIfNotStrictlyPositiveInteger(firstChainId);
        throwIfNotStrictlyPositiveInteger(countChainIds);
        mnemonics = mnemonics ?? [];
        if (Array.isArray(mnemonics)) {
            if (mnemonics.length !== 0 && mnemonics.length < countChainIds) {
                throw new CodeError(`Not enough mnemonics, expecting ${countChainIds}, got ${mnemonics.length}`);
            }
        } else if (typeof mnemonics === 'string') {
            // all chainids are sharing the same mnemonic
            const m = (mnemonics === 'new') ? createRandomMnemonic() : mnemonics;
            mnemonics = [];
            for (let i = 0; i < countChainIds; ++i) {
                mnemonics.push(m);
            }
        }

        const _mnemonics = [...mnemonics];
        for (let i = 0; i < _mnemonics.length; ++i) {
            if (_mnemonics[i] === 'new') {
                _mnemonics[i] = createRandomMnemonic();
            } else {
                if (!ethersIsValidMnemonic(_mnemonics[i])) {
                    throw new CodeError(`Invalid mnemonic '${_mnemonics[i]}'`);
                }
            }
        }

        assert(_mnemonics.length >= countChainIds || _mnemonics.length === 0);
        return DEFAULT_CONFIG(firstChainId, countChainIds, _mnemonics);
    }

    static basename() {
        return PROD_CONFIG_BASENAME;
    }

    /**
     * @param {string} p 
     * @param {{[varname:string]: string}} placeholders
     */
    static #verifyPlaceholder(p, placeholders) {
        assert(p.startsWith('${') && p.endsWith('}'));
        const pp = placeholders[p];
        if (!pp) {
            throw new CodeError(`Unknown variable '${p}'`);
        }
        // is it a var ?
        if (!pp.startsWith('${')) {
            return;
        }
        assert(pp.endsWith('}'));
        if (!placeholders[pp]) {
            throw new CodeError(`Unknown variable '${pp}'`);
        }
    }
    /**
     * @param {{[varname:string]: string}} placeholders
     */
    static #initGlobalplaceholders(placeholders) {
        const has_defaultHostname = !!placeholders["${defaultHostname}"];
        const has_localHostname = !!placeholders["${localHostname}"];
        const has_master = !!placeholders["${master}"];

        if (has_defaultHostname) {
            this.#verifyPlaceholder("${defaultHostname}", placeholders);
        }
        if (has_localHostname) {
            this.#verifyPlaceholder("${localHostname}", placeholders);
        }
        if (has_master) {
            this.#verifyPlaceholder("${master}", placeholders);
        }

        if (!has_defaultHostname &&
            !has_localHostname) {
            if (!has_master) {
                placeholders["${master}"] = 'localhost';
            }
            placeholders["${defaultHostname}"] = "${master}";
            placeholders["${localHostname}"] = "${master}";
            return;
        }

        if (!has_defaultHostname &&
            has_localHostname) {
            placeholders["${defaultHostname}"] = placeholders["${localHostname}"];
            return;
        }

        if (has_defaultHostname &&
            !has_localHostname) {
            placeholders["${localHostname}"] = placeholders["${defaultHostname}"];
            return;
        }
    }

    /**
     * @param {{
     *      vars?: {[varname:string]: string}
     *      machines?: {[varname:string]: any}
     *      iexecsdk: {
     *          type: 'iexecsdk'
     *          chainsJsonLocation?: string
     *      }
     *      teeworkerprecompute: {
     *          type: 'teeworkerprecompute',
     *          repository?: string | types.Package
     *      }
     *      teeworkerpostcompute: {
     *          type: 'teeworkerpostcompute',
     *          repository?: string | types.Package
     *      }
     *      shared: any
     *      default: string
     *      chains: {
     *          [chainName:string]: {
     *              hub: string,
     *              sms?: srvTypes.SmsConfig,
     *              resultproxy?: srvTypes.ResultProxyConfig,
     *              blockchainadapter?: srvTypes.BlockchainAdapterConfig,
     *              core?: srvTypes.CoreConfig,
     *          }
     *      }
     * }} configJson
     * @param {string} dir 
     * @param {{[varname:string]: string}} vars
     */
    static async load(configJson, dir, vars) {
        assert(typeof configJson === 'object');
        assert(configJson);
        assert(dir);
        dir = resolveAbsolutePath(dir);
        const theDir = dir; //compiler + forEach

        /** @type {{[varname:string]: string}} */
        const globalPlaceholders = {};

        if (configJson.vars) {
            Object.entries(configJson.vars).forEach(([key, value]) => {
                if (key.indexOf("$") >= 0 || key.indexOf("{") >= 0 || key.indexOf("}") >= 0) {
                    throw new CodeError(`Invalid var name ${key}`);
                }
                globalPlaceholders["${" + key + "}"] = value;
            });
        }
        Object.entries(vars).forEach(([key, value]) => {
            if (key.indexOf("$") >= 0 || key.indexOf("{") >= 0 || key.indexOf("}") >= 0) {
                throw new CodeError(`Invalid var name ${key}`);
            }
            globalPlaceholders["${" + key + "}"] = value;
        });

        // Definitions:
        // ${defaultHostname} : the value used when any service 'hostname' property is undefined
        // ${localHostname} : name of the machine where the `ixcdv-config.json` is located
        // ${master} : default name of the master machine.

        // Default values:
        // const globalPlaceholders = {
        //     "${defaultHostname}": "${master}",
        //     "${localHostname}": "${master}",
        //     "${master}": "localhost"
        // }

        // Example:
        // const globalPlaceholders = {
        //     "${defaultHostname}": "${node0}",
        //     "${localHostname}": "${node0}",
        //     "${node0}": "localhost",
        //     "${node1}": "10.0.2.2"
        // }
        // Explanation:
        // - We are running on manchine 'node0' ("${localHostname}": "${node0}")
        // - address of machine 'node0' is resolved as 'localhost' ("${node0}": "localhost")
        // - any service where the hostname property is left undefined are considering
        //   to be running on 'node0' ("${defaultHostname}": "${node0}")

        this.#initGlobalplaceholders(globalPlaceholders);

        const defaultHostname = globalPlaceholders["${defaultHostname}"];

        /** @type {AbstractMachine[]} */
        const allMachines = [];

        // Machines (also fill globalPlaceholders with machine name)
        if (configJson.machines) {
            const machineNames = Object.keys(configJson.machines);
            for (let i = 0; i < machineNames.length; ++i) {
                const machineName = machineNames[i];
                const machineConfig = configJson.machines[machineName];
                if (machineConfig.type === 'qemu') {
                    const machine = new QemuMachine(theDir, machineConfig);
                    allMachines.push(machine);
                    if (!globalPlaceholders["${" + machineName + "}"]) {
                        throw new CodeError(`Missing machine host variable \${${machineName}}`);
                    }
                }
            }
        }

        const inventoryDB = new InventoryDB(
            theDir,
            configJson.default,
            allMachines,
            globalPlaceholders);

        // First pass : enumerate all chains specified ports
        // Second pass : fill all the missing ports 
        const __allLocalhostPorts = new Set();
        const chainNames = Object.keys(configJson.chains);
        for (let i = 0; i < chainNames.length; ++i) {
            const chainName = chainNames[i];
            const chain = configJson.chains[chainName];

            Object.entries(chain).forEach(([k, v]) => {
                if (typeof v === 'string') {
                    assert(k === 'hub');
                    return;
                }
                const p = v.port;
                const h = v.hostname ?? defaultHostname;
                if (p) {
                    this.#addPort(__allLocalhostPorts, { hostname: h, port: p });
                }
            });
        }

        const shared = configJson.shared;
        // configs are duplicated
        const sharedTypes = await sortConfigsDictBySharedServiceTypes(shared);
        assert(sharedTypes.length === ORDERED_SERVICE_TYPES.length);

        // If ipfs is missing, add new empty ipfs
        if (!sharedTypes[SERVICE_TYPE_INDICES.ipfs] ||
            sharedTypes[SERVICE_TYPE_INDICES.ipfs].length === 0) {
            if (shared.ipfs) {
                throw new CodeError('Duplicate shared ipfs service')
            }
            shared.ipfs = { name: 'ipfs', config: { type: 'ipfs' } };
            sharedTypes[SERVICE_TYPE_INDICES.ipfs] = [shared.ipfs];
        }

        // If docker is missing, add new empty docker
        if (!sharedTypes[SERVICE_TYPE_INDICES.docker] ||
            sharedTypes[SERVICE_TYPE_INDICES.docker].length === 0) {
            if (shared.docker) {
                throw new CodeError('Duplicate shared docker service')
            }
            shared.docker = { name: 'docker', config: { type: 'docker' } };
            sharedTypes[SERVICE_TYPE_INDICES.docker] = [shared.docker];
        }

        // Pass 1 : fill directories + register user-defined ports
        for (let i = 0; i < sharedTypes.length; ++i) {
            const sharedTypeArray = sharedTypes[i];
            if (!sharedTypeArray || sharedTypeArray.length === 0) {
                continue;
            }

            const type = ORDERED_SERVICE_TYPES[i];
            assert(sharedTypeArray[0].config.type === type);

            if (type === 'ipfs') {
                sharedTypeArray.forEach(t => this.#fillIpfsConf(__allLocalhostPorts, t, theDir));
            } else if (type === 'ganache') {
                sharedTypeArray.forEach(t => this.#fillGanacheConf(__allLocalhostPorts, t, theDir));
            } else if (type === 'market') {
                sharedTypeArray.forEach(t => this.#fillMarketConf(__allLocalhostPorts, t, theDir));
            } else if (type === 'mongo') {
                sharedTypeArray.forEach(t => this.#fillMongoConf(__allLocalhostPorts, t, theDir));
            } else if (type === 'redis') {
                sharedTypeArray.forEach(t => this.#fillRedisConf(__allLocalhostPorts, t, theDir));
            } else if (type === 'docker') {
                sharedTypeArray.forEach(t => this.#fillDockerConf(__allLocalhostPorts, t, theDir));
            } else {
                throw new CodeError(`type ${type} cannot be shared`);
            }
        }

        // Pass 2 : fill missing ports
        for (let i = 0; i < sharedTypes.length; ++i) {
            const sharedType = sharedTypes[i];
            if (!sharedType || sharedType.length === 0) {
                continue;
            }

            const type = ORDERED_SERVICE_TYPES[i];
            assert(sharedType[0].config.type === type);

            if (type === 'ipfs') {
                sharedType.forEach(t => this.#fillIpfsPorts(__allLocalhostPorts, t, theDir));
            } else if (type === 'ganache') {
                sharedType.forEach(t => this.#fillGanachePorts(__allLocalhostPorts, t, theDir));
            } else if (type === 'market') {
                sharedType.forEach(t => this.#fillMarketPorts(__allLocalhostPorts, t, theDir));
            } else if (type === 'mongo') {
                sharedType.forEach(t => this.#fillMongoPorts(__allLocalhostPorts, t, theDir));
            } else if (type === 'redis') {
                sharedType.forEach(t => this.#fillRedisPorts(__allLocalhostPorts, t, theDir));
            } else if (type === 'docker') {
                sharedType.forEach(t => this.#fillDockerPorts(__allLocalhostPorts, t, theDir));
            } else {
                throw new CodeError(`type ${type} cannot be shared`);
            }
        }

        await resolveAndAddSortedConfigsToInventory(
            inventoryDB,
            sharedTypes,
            globalPlaceholders);

        /* ---------------------------------- */
        // tee-worker-pre-compute
        /* ---------------------------------- */
        /** @type {any} */
        const teeworkerprecomputeConf = configJson.teeworkerprecompute;
        if (teeworkerprecomputeConf) {
            // turns teeworkerprecomputeConf.repository into a types.Package object
            ConfigFile.#fillRepository(teeworkerprecomputeConf, theDir);
            assert(typeof teeworkerprecomputeConf.repository === 'object');
            teeworkerprecomputeConf.repository.gitHubRepoName = 'tee-worker-pre-compute';

            await inventoryDB.resolveAndAddTeeWorkerPreCompute(
                { config: teeworkerprecomputeConf },
                globalPlaceholders);
        }

        /* ---------------------------------- */
        // tee-worker-post-compute
        /* ---------------------------------- */
        /** @type {any} */
        const teeworkerpostcomputeConf = configJson.teeworkerpostcompute;
        if (teeworkerpostcomputeConf) {
            // turns teeworkerpostcomputeConf.repository into a types.Package object
            ConfigFile.#fillRepository(teeworkerpostcomputeConf, theDir);
            assert(typeof teeworkerpostcomputeConf.repository === 'object');
            teeworkerpostcomputeConf.repository.gitHubRepoName = 'tee-worker-post-compute';

            await inventoryDB.resolveAndAddTeeWorkerPostCompute(
                { config: teeworkerpostcomputeConf },
                globalPlaceholders);
        }

        /* ---------------------------------- */
        // iexec-sdk
        /* ---------------------------------- */
        /** @type {any} */
        const iexecsdkConf = configJson.iexecsdk;
        if (iexecsdkConf) {
            // turns iexecsdkConf.repository into a types.Package object
            ConfigFile.#fillRepository(iexecsdkConf, theDir);
            assert(typeof iexecsdkConf.repository === 'object');
            iexecsdkConf.repository.gitHubRepoName = 'iexec-sdk';
            iexecsdkConf.chainsJsonLocation =
                computeSharedRunDir(theDir, iexecsdkConf.repository.gitHubRepoName);

            await inventoryDB.resolveAndAddIExecSdk(
                { config: iexecsdkConf },
                globalPlaceholders);
        }

        //const ipfsApiHost = inventoryDB.getIpfsApiHost();
        //const ipfsHost = ipfsApiHost.hostname + ":" + ipfsApiHost.port.toString();

        // add chain services in type order
        for (let i = 0; i < chainNames.length; ++i) {
            const chainName = chainNames[i];
            const chain = configJson.chains[chainName];
            const hub = chain.hub;
            if (isNullishOrEmptyString(hub)) {
                throw new CodeError(errorMissingProperty(`chains.${chainName}.hub`, dir));
            }
            inventoryDB.addChain(chainName, hub);

            const maxWorkers = (PORT_RANGE.workers.to - PORT_RANGE.workers.from + 1);
            const nWorkers = Math.floor(maxWorkers / chainNames.length);
            const firstWorker = PORT_RANGE.workers.from + i * nWorkers;
            /** @type {any} */
            const workersConf = {
                type: 'worker', // needed by #fillRepository
                hub,
                directory: computeChainRunDir(theDir, chainName, 'worker'),
                portRange: { from: firstWorker, to: firstWorker + nWorkers - 1, size: PORT_RANGE.workers.size }
            };
            // Fill-up directories and files:
            // - keep placeholders unsolved
            // - convert to absolute path
            ConfigFile.#fillRepository(workersConf, theDir);
            // Add config to inventory
            // - resolve placeholders
            await inventoryDB.resolveAndAddWorkers(workersConf, globalPlaceholders);

            const ganacheConf = inventoryDB.getGanacheConfigFromHubAlias(hub);
            if (!ganacheConf) {
                throw new CodeError(errorMissingProperty(`No ganache service associated with hub=${hub}`, dir));
            }
            const seq = inventoryDB.getGanacheDeploySequenceFromHubAlias(hub);
            if (!seq) {
                throw new CodeError(errorMissingProperty(`No ganache service associated with hub=${hub}`, dir));
            }
            // const marketApiUrl = inventoryDB.getMarketApiUrlFromHubAlias(hub);

            /* ---------------------------------- */
            // sms
            /* ---------------------------------- */
            /** @type {any} */
            let smsConf;
            if (!chain.sms) {
                // Generates a minimal config (only port)
                smsConf = this.#genSmsConf(__allLocalhostPorts);
            } else {
                smsConf = await fromServiceType['sms'].deepCopyConfig(
                    chain.sms,
                    false /* keep unresolved */,
                    globalPlaceholders);
            }
            if (!smsConf.port) {
                throw new CodeError(errorMissingProperty(`chains.${chainName}.sms.port`, dir));
            }
            // Fill-up directories and files:
            // - keep placeholders unsolved
            // - convert to absolute path
            this.#fillSmsConf(__allLocalhostPorts, chainName, hub, smsConf, dir);
            // Add config to inventory
            // - resolve placeholders
            const smsConfName = await inventoryDB.resolveAndAddSms(
                { config: smsConf },
                globalPlaceholders);
            const smsIC = inventoryDB.getConfig(smsConfName);
            assert(smsIC.type === 'sms');
            // When resolved, do not specify `defaultHostname`
            // const resolvedSmsUrl = "http://" + hostnamePortToString(smsIC.resolved, undefined);

            /* ---------------------------------- */
            // resultproxy
            /* ---------------------------------- */
            /** @type {any} */
            let resultproxyConf;
            if (!chain.resultproxy) {
                resultproxyConf = this.#genResultProxyConf(__allLocalhostPorts);
            } else {
                resultproxyConf = await fromServiceType['resultproxy'].deepCopyConfig(
                    chain.resultproxy,
                    false /* keep unresolved */,
                    globalPlaceholders);
            }
            if (!resultproxyConf.port) {
                throw new CodeError(errorMissingProperty(`chains.${chainName}.resultproxy.port`, dir));
            }
            // type, repository, hub, springConfigLocation, logFile
            this.#fillResultProxyConf(__allLocalhostPorts, chainName, hub, resultproxyConf, dir);

            // Use shared ipfs instead !
            // if (!resultproxyConf.ipfsHost) {
            //     resultproxyConf.ipfsHost = ipfsHost;
            // }

            // mongoHost
            let newResultProxyMongoConf;
            const sharedResultProxyMongoConf = inventoryDB.configFromHost(resultproxyConf.mongoHost);
            if (!sharedResultProxyMongoConf) {
                newResultProxyMongoConf = this.#genResultProxyMongoConf(
                    __allLocalhostPorts,
                    defaultHostname,
                    chainName,
                    resultproxyConf,
                    dir);
                assert(newResultProxyMongoConf.type === 'mongo');
            } else {
                if (!resultproxyConf.mongoDBName) {
                    throw new CodeError(errorMissingProperty(`chains.${chainName}.resultproxy.mongoDBName`, dir));
                }
            }

            // Add config to inventory
            // - resolve placeholders
            const resultproxyConfName = await inventoryDB.resolveAndAddResultProxy(
                {
                    config: resultproxyConf,
                    mongoConfig: newResultProxyMongoConf
                },
                globalPlaceholders);
            const resultproxyIC = inventoryDB.getConfig(resultproxyConfName);
            assert(resultproxyIC.type === 'resultproxy');
            // When resolved, do not specify `defaultHostname`
            // const resolvedResultproxyUrl = "http://" + hostnamePortToString(resultproxyIC.resolved, undefined);

            /* ---------------------------------- */
            // blockchainadapter
            /* ---------------------------------- */
            /** @type {any} */
            let blockchainadapterConf;
            if (!chain.blockchainadapter) {
                blockchainadapterConf = this.#genBlockchainAdapterConf(__allLocalhostPorts);
            } else {
                blockchainadapterConf = await fromServiceType['blockchainadapter'].deepCopyConfig(
                    chain.blockchainadapter,
                    false /* keep unresolved */,
                    globalPlaceholders);
            }
            if (!blockchainadapterConf.port) {
                throw new CodeError(errorMissingProperty(`chains.${chainName}.blockchainadapter.port`, dir));
            }
            // type, repository, hub, springConfigLocation, logFile
            this.#fillBlockchainAdapterConf(__allLocalhostPorts, chainName, hub, blockchainadapterConf, dir);
            // mongoHost
            let newBlockchainAdapterMongoConf;
            const sharedBlockchainAdapterMongoConf = inventoryDB.configFromHost(blockchainadapterConf.mongoHost);
            if (!sharedBlockchainAdapterMongoConf) {
                newBlockchainAdapterMongoConf = this.#genBlockchainAdapterMongoConf(
                    __allLocalhostPorts,
                    defaultHostname,
                    chainName,
                    blockchainadapterConf,
                    dir);
                assert(newBlockchainAdapterMongoConf.type === 'mongo');
            } else {
                if (!blockchainadapterConf.mongoDBName) {
                    throw new CodeError(errorMissingProperty(`chains.${chainName}.blockchainadapter.mongoDBName`, dir));
                }
            }
            // Use shared value instead
            // if (!blockchainadapterConf.marketApiUrl && marketApiUrl) {
            //     blockchainadapterConf.marketApiUrl = marketApiUrl;
            // }
            // walletIndex
            if (blockchainadapterConf.walletIndex === undefined) {
                blockchainadapterConf.walletIndex = seq.WorkerpoolAccountIndex;
            }
            const blockchainadapterConfName = await inventoryDB.resolveAndAddBlockchainAdapter(
                {
                    config: blockchainadapterConf,
                    mongoConfig: newBlockchainAdapterMongoConf
                },
                globalPlaceholders);
            const blockchainadapterIC = inventoryDB.getConfig(blockchainadapterConfName);
            assert(blockchainadapterIC.type === 'blockchainadapter');
            // When resolved, do not specify `defaultHostname`
            // const blockchainadapterUrl = "http://" + hostnamePortToString(blockchainadapterIC.resolved, undefined);

            /* ---------------------------------- */
            // core
            /* ---------------------------------- */
            /** @type {any} */
            let coreConf;
            if (!chain.core) {
                coreConf = this.#genCoreConf(__allLocalhostPorts);
            } else {
                coreConf = await fromServiceType['core'].deepCopyConfig(
                    chain.core,
                    false /* keep unresolved */,
                    globalPlaceholders);
            }
            if (!coreConf.port) {
                throw new CodeError(errorMissingProperty(`chains.${chainName}.core.port`, dir));
            }
            // type, repository, hub, springConfigLocation, logFile
            this.#fillCoreConf(__allLocalhostPorts, chainName, hub, coreConf, dir);
            // mongoHost
            let newCoreMongoConf;
            const sharedCoreMongoConf = inventoryDB.configFromHost(coreConf.mongoHost);
            if (!sharedCoreMongoConf) {
                newCoreMongoConf = this.#genCoreMongoConf(
                    __allLocalhostPorts,
                    defaultHostname,
                    chainName,
                    coreConf,
                    dir);
                assert(newCoreMongoConf.type === 'mongo');
            } else {
                if (!coreConf.mongoDBName) {
                    throw new CodeError(errorMissingProperty(`chains.${chainName}.core.mongoDBName`, dir));
                }
            }
            // walletIndex
            if (coreConf.walletIndex === undefined) {
                coreConf.walletIndex = seq.WorkerpoolAccountIndex;
            }
            // // ipfsHost
            // if (!coreConf.ipfsHost) {
            //     coreConf.ipfsHost = ipfsHost;
            // }
            // // smsUrl
            // if (!coreConf.smsUrl) {
            //     coreConf.smsUrl = resolvedSmsUrl;
            // }
            // // resultProxyUrl
            // if (!coreConf.resultProxyUrl) {
            //     coreConf.resultProxyUrl = resolvedResultproxyUrl;
            // }
            // // blockchainAdapterUrl
            // if (!coreConf.blockchainAdapterUrl) {
            //     coreConf.blockchainAdapterUrl = blockchainadapterUrl;
            // }
            await inventoryDB.resolveAndAddCore(
                {
                    config: coreConf,
                    mongoConfig: newCoreMongoConf
                },
                globalPlaceholders);
        }

        // When everything is setup, resolve the machine ports forwading
        inventoryDB.setupMachineHostFwdPorts();

        const inventory = newInventory();
        inventory._inv = inventoryDB;

        return inventory;
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     * @param {object} params 
     * @param {string=} params.hostname 
     * @param {any=} params.port 
     */
    static #addPort(allLocalhostPorts, { hostname, port } = {}) {
        if (hostname && hostname !== 'localhost' && !hostname.startsWith('${')) {
            return;
        }
        if (port === undefined) {
            return;
        }
        if (port >= PORT_RANGE.workers.from && port <= PORT_RANGE.workers.to) {
            throw new CodeError(`Unauthorized service port ${port} (range=[${PORT_RANGE.workers.from}:${PORT_RANGE.workers.to}] is reserved to worker services)`);
        }
        if (allLocalhostPorts.has(port)) {
            throw new CodeError(`Duplicate service port ${port}`);
        }
        allLocalhostPorts.add(port);
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     * @param {object} params 
     * @param {string} params.name 
     * @param {any} params.config 
     * @param {string} dir 
     */
    static #fillIpfsConf(allLocalhostPorts, { name, config }, dir) {
        config.type = 'ipfs';
        const runDir = computeSharedRunDir(dir, name);
        const dbDir = computeSharedDBDir(dir, name);

        config.directory = (!config.directory) ? dbDir : toAbsolutePathWithPlaceholders(dir, config.directory);
        config.logFile = (!config.logFile) ? path.join(runDir, `${config.type}.log`) : toAbsolutePathWithPlaceholders(dir, config.logFile);
        assert(!config.pidFile);

        this.#addPort(allLocalhostPorts, { port: config.apiPort });
        this.#addPort(allLocalhostPorts, { port: config.gatewayPort });
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     * @param {object} params 
     * @param {string} params.name 
     * @param {any} params.config 
     * @param {string} dir 
     */
    static #fillIpfsPorts(allLocalhostPorts, { name, config }, dir) {
        if (config.apiPort === undefined) {
            const apiPort = this.#findNextFreePort(
                allLocalhostPorts,
                PORT_RANGE.shared.ipfs.api);
            if (!apiPort) {
                throw new CodeError(`Unable to compute 'shared.${name}' api port (path=${dir})`);
            }
            config.apiPort = apiPort;

            assert(!allLocalhostPorts.has(apiPort));
            allLocalhostPorts.add(apiPort);
        }
        assert(allLocalhostPorts.has(config.apiPort));

        if (config.gatewayPort === undefined) {
            const gatewayPort = this.#findNextFreePort(
                allLocalhostPorts,
                PORT_RANGE.shared.ipfs.gateway);
            if (!gatewayPort) {
                throw new CodeError(`Unable to compute 'shared.${name}' gateway port (path=${dir})`);
            }
            config.gatewayPort = gatewayPort;

            assert(!allLocalhostPorts.has(gatewayPort));
            allLocalhostPorts.add(gatewayPort);
        }
        assert(allLocalhostPorts.has(config.gatewayPort));
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     * @param {object} params 
     * @param {string} params.name 
     * @param {any} params.config 
     * @param {string} dir 
     */
    static #fillGanacheConf(allLocalhostPorts, { name, config }, dir) {
        config.type = 'ganache';
        const runDir = computeSharedRunDir(dir, name);
        const dbDir = computeSharedDBDir(dir, name);

        config.directory = (!config.directory) ? dbDir : toAbsolutePathWithPlaceholders(dir, config.directory);
        config.logFile = (!config.logFile) ? path.join(runDir, `${config.type}.log`) : toAbsolutePathWithPlaceholders(dir, config.logFile);
        config.pidFile = (!config.pidFile) ? path.join(runDir, `${config.type}.pid`) : toAbsolutePathWithPlaceholders(dir, config.pidFile);

        assert(config.config);
        if (!config.config.PoCo) {
            config.config.PoCo = computeSrcDir(dir);
        } else if (typeof config.config.PoCo === 'string') {
            config.config.PoCo = toAbsolutePathWithPlaceholders(dir, config.config.PoCo);
        } else {
            assert(typeof config.config.PoCo === 'object');
            assert(typeof config.config.PoCo.directory === 'string');
            config.config.PoCo.directory = toAbsolutePathWithPlaceholders(dir, config.config.PoCo.directory);
        }

        this.#addPort(allLocalhostPorts, config);
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     * @param {object} params 
     * @param {string} params.name 
     * @param {any} params.config 
     * @param {string} dir 
     */
    static #fillGanachePorts(allLocalhostPorts, { name, config }, dir) {
        const type = 'ganache';
        if (config.port === undefined) {
            const port = this.#findNextFreePort(
                allLocalhostPorts,
                PORT_RANGE.shared[type]);
            if (!port) {
                throw new CodeError(`Unable to compute 'shared.${name}' port (path=${dir})`);
            }
            config.port = port;

            assert(!allLocalhostPorts.has(port));
            allLocalhostPorts.add(port);
        }

        assert(allLocalhostPorts.has(config.port));
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     * @param {object} params 
     * @param {string} params.name 
     * @param {any} params.config 
     * @param {string} dir 
     */
    static #fillMongoConf(allLocalhostPorts, { name, config }, dir) {
        config.type = 'mongo';
        const runDir = computeSharedRunDir(dir, name);
        const dbDir = computeSharedDBDir(dir, name);

        config.directory = (!config.directory) ? dbDir : toAbsolutePathWithPlaceholders(dir, config.directory);
        config.logFile = (!config.logFile) ? path.join(runDir, `${config.type}.log`) : toAbsolutePathWithPlaceholders(dir, config.logFile);
        config.pidFile = (!config.pidFile) ? path.join(runDir, `${config.type}.pid`) : toAbsolutePathWithPlaceholders(dir, config.pidFile);

        this.#addPort(allLocalhostPorts, config);
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     * @param {object} params 
     * @param {string} params.name 
     * @param {any} params.config 
     * @param {string} dir 
     */
    static #fillMongoPorts(allLocalhostPorts, { name, config }, dir) {
        const type = 'mongo';
        if (config.port === undefined) {
            const port = this.#findNextFreePort(
                allLocalhostPorts,
                PORT_RANGE.shared[type]);
            if (!port) {
                throw new CodeError(`Unable to compute 'shared.${name}' port (path=${dir})`);
            }
            config.port = port;

            assert(!allLocalhostPorts.has(port));
            allLocalhostPorts.add(port);
        }
        assert(allLocalhostPorts.has(config.port));
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     * @param {object} params 
     * @param {string} params.name 
     * @param {any} params.config 
     * @param {string} dir 
     */
    static #fillRedisConf(allLocalhostPorts, { name, config }, dir) {
        config.type = 'redis';
        const runDir = computeSharedRunDir(dir, name);
        const dbDir = computeSharedDBDir(dir, name);

        config.directory = (!config.directory) ? dbDir : toAbsolutePathWithPlaceholders(dir, config.directory);
        config.logFile = (!config.logFile) ? path.join(runDir, `${config.type}.log`) : toAbsolutePathWithPlaceholders(dir, config.logFile);
        config.pidFile = (!config.pidFile) ? path.join(runDir, `${config.type}.pid`) : toAbsolutePathWithPlaceholders(dir, config.pidFile);

        this.#addPort(allLocalhostPorts, config);
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     * @param {object} params 
     * @param {string} params.name 
     * @param {any} params.config 
     * @param {string} dir 
     */
    static #fillRedisPorts(allLocalhostPorts, { name, config }, dir) {
        const type = 'redis';
        if (config.port === undefined) {
            const port = this.#findNextFreePort(
                allLocalhostPorts,
                PORT_RANGE.shared[type]);
            if (!port) {
                throw new CodeError(`Unable to compute 'shared.${name}' port (path=${dir})`);
            }
            config.port = port;

            assert(!allLocalhostPorts.has(port));
            allLocalhostPorts.add(port);
        }
        assert(allLocalhostPorts.has(config.port));
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     * @param {object} params 
     * @param {string} params.name 
     * @param {any} params.config 
     * @param {string} dir 
     */
    static #fillDockerConf(allLocalhostPorts, { name, config }, dir) {
        config.type = 'docker';

        this.#addPort(allLocalhostPorts, config);
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     * @param {object} params 
     * @param {string} params.name 
     * @param {any} params.config 
     * @param {string} dir 
     */
    static #fillDockerPorts(allLocalhostPorts, { name, config }, dir) {
        const type = 'docker';
        if (config.port === undefined) {
            const port = this.#findNextFreePort(
                allLocalhostPorts,
                PORT_RANGE.shared[type]);
            if (!port) {
                throw new CodeError(`Unable to compute 'shared.${name}' port (path=${dir})`);
            }
            config.port = port;

            assert(!allLocalhostPorts.has(port));
            allLocalhostPorts.add(port);
        }
        assert(allLocalhostPorts.has(config.port));
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     * @param {object} params 
     * @param {string} params.name 
     * @param {any} params.config 
     * @param {string} dir 
     */
    static #fillMarketConf(allLocalhostPorts, { name, config }, dir) {
        config.type = 'market';
        const gitHubRepoName = Market.gitHubRepoName;
        const runDir = computeSharedRunDir(dir, name);
        const dbDir = computeSharedDBDir(dir, name);

        ConfigFile.#fillRepository(config, dir);

        config.directory = (!config.directory) ? path.join(dir, 'shared/markets', name) : toAbsolutePathWithPlaceholders(dir, config.directory);

        this.#addPort(allLocalhostPorts, config.mongo);
        this.#addPort(allLocalhostPorts, config.redis);
        this.#addPort(allLocalhostPorts, config.api);
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     * @param {object} params 
     * @param {string} params.name 
     * @param {any} params.config 
     * @param {string} dir 
     */
    static #fillMarketPorts(allLocalhostPorts, { name, config }, dir) {
        const apiHostname = config.api.hostname;
        if (apiHostname &&
            apiHostname !== 'localhost' &&
            !apiHostname.startsWith('${')) {
            return;
        }
        /** @type {number=} */
        let mongoPort = config.mongo?.port;
        if (mongoPort === undefined) {
            mongoPort = this.#findNextFreePort(
                allLocalhostPorts,
                PORT_RANGE.shared.market.mongo);
            if (!mongoPort) {
                throw new CodeError(`Unable to compute market ${name} mongo port`)
            }

            assert(!allLocalhostPorts.has(mongoPort));
            allLocalhostPorts.add(mongoPort);

            if (!config.mongo) {
                config.mongo = { port: mongoPort };
            } else {
                config.mongo.port = mongoPort;
            }
        }
        assert(allLocalhostPorts.has(mongoPort));

        /** @type {number=} */
        let redisPort = config.redis?.port;
        if (redisPort === undefined) {
            redisPort = this.#findNextFreePort(
                allLocalhostPorts,
                PORT_RANGE.shared.market.redis);
            if (!redisPort) {
                throw new CodeError(`Unable to compute market ${name} redis port`)
            }

            assert(!allLocalhostPorts.has(redisPort));
            allLocalhostPorts.add(redisPort);

            if (!config.redis) {
                config.redis = { port: redisPort };
            } else {
                config.redis.port = redisPort;
            }
        }
        assert(allLocalhostPorts.has(redisPort));

        if (!config.api) {
            throw new CodeError(errorMissingProperty(`shared.${name}.api`, dir))
        }
        if (config.api.port === undefined) {
            const apiPort = this.#findNextFreePort(
                allLocalhostPorts,
                PORT_RANGE.shared.market.api);
            if (!apiPort) {
                throw new CodeError(`Unable to compute market ${name} api port`)
            }
            config.api.port = apiPort;

            assert(!allLocalhostPorts.has(apiPort));
            allLocalhostPorts.add(apiPort);
        }
        assert(allLocalhostPorts.has(config.api.port));
    }

    /**
     * - Fill `repository`, `hub`, `type`, `springConfigLocation`, `logFile`
     * @param {Set<number>} allLocalhostPorts 
     * @param {string} chain 
     * @param {string} hub 
     * @param {srvTypes.SmsConfig} config 
     * @param {string} dir 
     */
    static #fillSmsConf(allLocalhostPorts, chain, hub, config, dir) {
        config.type = 'sms';
        const dbDir = computeChainDBDir(dir, chain, config.type);
        config.dbDirectory = (!config.dbDirectory) ? dbDir : toAbsolutePathWithPlaceholders(dir, config.dbDirectory);
        ConfigFile.#fillHubServiceConf(allLocalhostPorts, chain, hub, config, dir);
    }

    /**
     * - Fill `repository`, `hub`, `type`, `springConfigLocation`, `logFile`
     * @param {Set<number>} allLocalhostPorts 
     * @param {string} chain 
     * @param {string} hub 
     * @param {srvTypes.ResultProxyConfig} config 
     * @param {string} dir 
     */
    static #fillResultProxyConf(allLocalhostPorts, chain, hub, config, dir) {
        config.type = 'resultproxy';
        ConfigFile.#fillHubServiceConf(allLocalhostPorts, chain, hub, config, dir);
    }

    /**
     * - Fill `repository`, `hub`, `type`, `springConfigLocation`, `logFile`
     * @param {Set<number>} allLocalhostPorts 
     * @param {string} chain 
     * @param {string} hub 
     * @param {srvTypes.BlockchainAdapterConfig} config 
     * @param {string} dir 
     */
    static #fillBlockchainAdapterConf(allLocalhostPorts, chain, hub, config, dir) {
        config.type = 'blockchainadapter';
        ConfigFile.#fillHubServiceConf(allLocalhostPorts, chain, hub, config, dir);
    }

    /**
     * - Fill `repository`, `hub`, `type`, `springConfigLocation`, `logFile`
     * @param {Set<number>} allLocalhostPorts 
     * @param {string} chain 
     * @param {string} hub 
     * @param {srvTypes.CoreConfig} config 
     * @param {string} dir 
     */
    static #fillCoreConf(allLocalhostPorts, chain, hub, config, dir) {
        config.type = 'core';
        ConfigFile.#fillHubServiceConf(allLocalhostPorts, chain, hub, config, dir);
    }

    /**
     * @param {{
     *      type: srvTypes.ServiceType | 'iexecsdk'
     *      repository: string | types.Package
     * }} config 
     * @param {string} dir 
     */
    static #fillRepository(config, dir) {
        assert(config.type !== 'ganache');
        assert(config.type !== 'ipfs');
        assert(config.type !== 'docker');
        assert(config.type !== 'mongo');
        assert(config.type !== 'redis');
        if (!config.repository || config.repository === '') {
            config.repository = {
                directory: computeSrcDir(dir),
                commitish: DEFAULT_VERSIONS[config.type],
                patch: true
            };
        } else {
            if (typeof config.repository === 'string') {
                const pkgDir = toAbsolutePathWithPlaceholders(dir, config.repository);
                config.repository = {
                    directory: pkgDir,
                    commitish: DEFAULT_VERSIONS[config.type],
                    patch: true
                };
            } else {
                const pkg = config.repository;
                if (!pkg.directory) {
                    pkg.directory = computeSrcDir(dir);
                } else {
                    pkg.directory = toAbsolutePathWithPlaceholders(dir, pkg.directory);
                }
                if (!pkg.commitish && isNullishOrEmptyString(pkg.branch)) {
                    pkg.commitish = DEFAULT_VERSIONS[config.type];
                }
                if (typeof pkg.patch !== 'boolean') {
                    pkg.patch = true;
                }
            }
        }
    }

    /**
     * - Fill `repository`, `hub`, `type`, `springConfigLocation`, `logFile`
     * @param {Set<number>} allLocalhostPorts 
     * @param {string} chain 
     * @param {string} hub 
     * @param {srvTypes.CoreConfig | srvTypes.BlockchainAdapterConfig | srvTypes.ResultProxyConfig | srvTypes.SmsConfig | srvTypes.WorkerConfig} config 
     * @param {string} dir 
     */
    static #fillHubServiceConf(allLocalhostPorts, chain, hub, config, dir) {
        const gitHubRepoName = CoreService.gitHubRepoName;
        const runDir = computeChainRunDir(dir, chain, config.type);
        const dbDir = computeChainDBDir(dir, chain, config.type);

        ConfigFile.#fillRepository(config, dir);

        config.springConfigLocation = (!config.springConfigLocation) ? runDir : toAbsolutePathWithPlaceholders(dir, config.springConfigLocation);
        config.logFile = (!config.logFile) ? path.join(runDir, `${config.type}.log`) : toAbsolutePathWithPlaceholders(dir, config.logFile);
        assert(!config.pidFile);

        // Worker does not have the 'hub' property
        if (config.type !== 'worker') {
            if (!config.hub) { config.hub = hub; }
        }
        if (!config.hostname || config.hostname === 'localhost') {
            // Must already be registered
            assert(allLocalhostPorts.has(config.port));
        }
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     * @param {string} defaultHostname 
     * @param {string} chain 
     * @param {srvTypes.ResultProxyConfig} resultproxyConf 
     * @param {string} dir 
     */
    static #genResultProxyMongoConf(allLocalhostPorts, defaultHostname, chain, resultproxyConf, dir) {
        assert(!isNullishOrEmptyString(defaultHostname));

        const runDir = computeChainRunDir(dir, chain, resultproxyConf.type);
        const dbDir = computeChainDBDir(dir, chain, resultproxyConf.type);

        let mongoHostname = defaultHostname;
        // management = resultproxyConf.port + 1
        let mongoPort = resultproxyConf.port + 2;
        assert(!allLocalhostPorts.has(mongoPort));

        if (resultproxyConf.mongoHost) {
            const { hostname, port } = stringToHostnamePort(resultproxyConf.mongoHost);
            if (!hostname) {
                throw new CodeError(`Invalid chains.${chain}.resultproxy.mongoHost property.`);
            }
            if (!port) {
                throw new CodeError(`Invalid chains.${chain}.resultproxy.mongoHost property.`);
            }
            mongoHostname = hostname;
            mongoPort = port;
        } else {
            resultproxyConf.mongoHost = mongoHostname + ':' + mongoPort.toString();
        }

        /** @type {srvTypes.MongoConfig} */
        const mongoConf = {
            type: "mongo",
            hostname: mongoHostname,
            // management = conf.port + 1
            port: mongoPort,
            directory: path.join(dbDir, 'mongo'),
            logFile: path.join(runDir, 'mongo.log'),
            pidFile: path.join(runDir, 'mongo.pid'),
        };
        return mongoConf;
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     * @param {string} defaultHostname 
     * @param {string} chain 
     * @param {srvTypes.BlockchainAdapterConfig} blockchainadapterConf 
     * @param {string} dir 
     */
    static #genBlockchainAdapterMongoConf(allLocalhostPorts, defaultHostname, chain, blockchainadapterConf, dir) {
        assert(!isNullishOrEmptyString(defaultHostname));

        const runDir = computeChainRunDir(dir, chain, blockchainadapterConf.type);
        const dbDir = computeChainDBDir(dir, chain, blockchainadapterConf.type);

        let mongoHostname = defaultHostname;
        // management = blockchainadapterConf.port + 1
        let mongoPort = blockchainadapterConf.port + 2;
        assert(!allLocalhostPorts.has(mongoPort));

        if (blockchainadapterConf.mongoHost) {
            const { hostname, port } = stringToHostnamePort(blockchainadapterConf.mongoHost);
            if (!hostname) {
                throw new CodeError(`Invalid chains.${chain}.blockchainadapter.mongoHost property.`);
            }
            if (!port) {
                throw new CodeError(`Invalid chains.${chain}.blockchainadapter.mongoHost property.`);
            }
            mongoHostname = hostname;
            mongoPort = port;
        } else {
            blockchainadapterConf.mongoHost = mongoHostname + ':' + mongoPort.toString();
        }

        /** @type {srvTypes.MongoConfig} */
        const mongoConf = {
            type: "mongo",
            hostname: mongoHostname,
            // management = conf.port + 1
            port: mongoPort,
            directory: path.join(dbDir, 'mongo'),
            logFile: path.join(runDir, 'mongo.log'),
            pidFile: path.join(runDir, 'mongo.pid'),
        };
        return mongoConf;
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     * @param {string} defaultHostname 
     * @param {string} chain 
     * @param {srvTypes.CoreConfig} coreConf 
     * @param {string} dir 
     */
    static #genCoreMongoConf(allLocalhostPorts, defaultHostname, chain, coreConf, dir) {
        assert(!isNullishOrEmptyString(defaultHostname));

        const runDir = computeChainRunDir(dir, chain, coreConf.type);
        const dbDir = computeChainDBDir(dir, chain, coreConf.type);

        let mongoHostname = defaultHostname;
        // management = conf.port + 1
        let mongoPort = coreConf.port + 2;
        assert(!allLocalhostPorts.has(mongoPort));

        if (coreConf.mongoHost) {
            const { hostname, port } = stringToHostnamePort(coreConf.mongoHost);
            if (!hostname) {
                throw new CodeError(`Invalid chains.${chain}.core.mongoHost property.`);
            }
            if (!port) {
                throw new CodeError(`Invalid chains.${chain}.core.mongoHost property.`);
            }
            mongoHostname = hostname;
            mongoPort = port;
        } else {
            coreConf.mongoHost = mongoHostname + ':' + mongoPort.toString();
        }

        /** @type {srvTypes.MongoConfig} */
        const mongoConf = {
            type: "mongo",
            hostname: mongoHostname,
            // management = conf.port + 1
            port: mongoPort,
            directory: path.join(dbDir, 'mongo'),
            logFile: path.join(runDir, 'mongo.log'),
            pidFile: path.join(runDir, 'mongo.pid'),
        };
        return mongoConf;
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     * @param {{from:number, to?:number, size?:number}} fromToSize 
     */
    static #findNextFreePort(allLocalhostPorts, fromToSize) {
        const sz = fromToSize.size ?? 1;
        const to = fromToSize.to ?? 65000;
        let port = fromToSize.from;
        while (port <= to) {
            // Free slot ?
            let isFree = true;
            for (let i = 0; i < sz; ++i) {
                if (allLocalhostPorts.has(port + i)) {
                    isFree = false;
                    break;
                }
            }
            if (isFree) {
                return port;
            }
            // Goto next slot
            port += sz;
        }
        return undefined;
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     */
    static #genSmsConf(allLocalhostPorts) {
        const type = 'sms';
        const port = this.#findNextFreePort(
            allLocalhostPorts,
            PORT_RANGE.chains[type]);
        assert(port);
        this.#addPort(allLocalhostPorts, { port });
        // Minimal sms config
        return { port };
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     */
    static #genResultProxyConf(allLocalhostPorts) {
        const type = 'resultproxy';
        const port = this.#findNextFreePort(
            allLocalhostPorts,
            PORT_RANGE.chains[type]);
        assert(port);
        this.#addPort(allLocalhostPorts, { port });
        // Minimal resultproxy config
        return { port };
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     */
    static #genBlockchainAdapterConf(allLocalhostPorts) {
        const type = 'blockchainadapter';
        const port = this.#findNextFreePort(
            allLocalhostPorts,
            PORT_RANGE.chains[type]);
        assert(port);
        this.#addPort(allLocalhostPorts, { port });
        // Minimal blockchainadapter config
        return { port };
    }

    /**
     * @param {Set<number>} allLocalhostPorts 
     */
    static #genCoreConf(allLocalhostPorts) {
        const type = 'core';
        const port = this.#findNextFreePort(
            allLocalhostPorts,
            PORT_RANGE.chains[type]);
        assert(port);
        this.#addPort(allLocalhostPorts, { port });
        // Minimal core config
        return { port };
    }
}

/**
 * @param {InventoryDB} inventory 
 * @param {string} dir 
 */
export async function inventoryToConfigFile(inventory, dir) {

    /** @type {{[varname:string]: string}} */
    const vars = {};

    const g = inventory.globalPlaceholders;
    Object.entries(g).forEach(([key, value]) => {
        assert(key.startsWith('${') && key.endsWith('}'));
        const name = removePrefix('${', removeSuffix('}', key));
        vars[name] = value;
    });

    /** @type {any} */
    const machines = {};
    const allMachines = inventory.allMachines;
    allMachines.forEach((machine, name) => {
        machines[name] = machine.toJSON();        
    });

    /** 
     * @type {{ 
     *      vars?: {[varname:string]: string},
     *      machines?: {[varname:string]: any},
     *      default:string, 
     *      shared: any, 
     *      chains: any
     *      iexecsdk: any
     *      teeworkerprecompute: any
     *      teeworkerpostcompute: any
     * }} 
     */
    const conf = {
        vars,
        default: inventory.defaultChainName,
        shared: {},
        chains: {},
        iexecsdk: {},
        teeworkerprecompute: {},
        teeworkerpostcompute: {}
    }

    if (machines) {
        conf.machines = machines;
    }

    /** @type {{[varname:string]: string}} */
    const globalPlaceholders = {}; /* keep it empty, we want to save an unresolved JSON file */
    const resolvePlaceholders = false; /* keep unsolved */

    const ipfsConf = inventory.getIpfsConfig();
    assert(ipfsConf);
    conf.shared.ifps = await IpfsService.deepCopyConfig(
        ipfsConf.unsolved,
        resolvePlaceholders,
        globalPlaceholders,
        dir);

    const dockerConf = inventory.getDockerConfig();
    assert(dockerConf);
    conf.shared.docker = await DockerService.deepCopyConfig(
        dockerConf.unsolved,
        resolvePlaceholders,
        globalPlaceholders,
        dir);

    const ganacheConfs = inventory.getConfigsByType('ganache');
    if (ganacheConfs) {
        const n = ganacheConfs.length;
        for (let i = 0; i < n; ++i) {
            const ic = ganacheConfs[i];
            // keep unresolved
            assert(ic.type === 'ganache');
            assert(ic.resolved);
            assert(ic.unsolved);
            assert(ic.unsolved.type === 'ganache');
            conf.shared[ic.name] = await GanachePoCoService.deepCopyConfig(
                ic.unsolved,
                resolvePlaceholders,
                globalPlaceholders,
                dir);
        }
    }

    const mongoConfs = inventory.getConfigsByType('mongo');
    if (mongoConfs) {
        const n = mongoConfs.length;
        for (let i = 0; i < n; ++i) {
            const ic = mongoConfs[i];
            // keep unresolved
            assert(ic.type === 'mongo');
            assert(ic.resolved);
            assert(ic.unsolved);
            assert(ic.unsolved.type === 'mongo');
            if (inventory.isShared(ic.name)) {
                // keep unresolved
                conf.shared[ic.name] = await MongoService.deepCopyConfig(
                    ic.unsolved,
                    resolvePlaceholders,
                    globalPlaceholders,
                    dir);
            }
        }
    }

    const redisConfs = inventory.getConfigsByType('redis');
    if (redisConfs) {
        const n = redisConfs.length;
        for (let i = 0; i < n; ++i) {
            const ic = redisConfs[i];
            // keep unresolved
            assert(ic.type === 'redis');
            assert(ic.resolved);
            assert(ic.unsolved);
            assert(ic.unsolved.type === 'redis');
            if (inventory.isShared(ic.name)) {
                // keep unresolved
                conf.shared[ic.name] = await RedisService.deepCopyConfig(
                    ic.unsolved,
                    resolvePlaceholders,
                    globalPlaceholders,
                    dir);
            }
        }
    }

    const marketConfs = inventory.getConfigsByType('market');
    if (marketConfs) {
        const n = marketConfs.length;
        for (let i = 0; i < n; ++i) {
            const ic = marketConfs[i];
            // keep unresolved
            assert(ic.type === 'market');
            assert(ic.resolved);
            assert(ic.unsolved);
            assert(ic.unsolved.type === 'market');
            if (inventory.isShared(ic.name)) {
                // keep unresolved
                conf.shared[ic.name] = await Market.deepCopyConfig(
                    ic.unsolved,
                    resolvePlaceholders,
                    globalPlaceholders,
                    dir);
            }
        }
    }

    // keep unsolved
    const chains = inventory.getChains();
    for (let i = 0; i < chains.length; ++i) {
        const chain = chains[i];
        const hub = chain.chain.hubAlias;
        if (!conf.chains[chain.name]) {
            conf.chains[chain.name] = {
                hub
            };
        }
        for (let j = 0; j < CHAIN_SERVICE_TYPES.length; ++j) {
            const type = CHAIN_SERVICE_TYPES[j];
            const ic = inventory.getConfigFromHub(type, hub);
            if (ic) {
                assert(ic.unsolved.type === type);
                // Compiler cannot handle the situation below
                conf.chains[chain.name][type] =
                    await fromServiceType[type].deepCopyConfig(
                        // @ts-ignore
                        ic.unsolved  /* keep unsolved */,
                        resolvePlaceholders,
                        globalPlaceholders,
                        dir);
            }
        }
    }

    const teeworkerprecomputeIConf = inventory.getTeeWorkerPreComputeConfig();
    if (teeworkerprecomputeIConf) {
        // keep unresolved
        assert(teeworkerprecomputeIConf.type === 'teeworkerprecompute');
        assert(teeworkerprecomputeIConf.resolved);
        assert(teeworkerprecomputeIConf.unsolved);
        assert(teeworkerprecomputeIConf.resolved.type === 'teeworkerprecompute');
        assert(teeworkerprecomputeIConf.unsolved.type === 'teeworkerprecompute');

        /** @type {srvTypes.TeeWorkerPreComputeConfig} */
        const teeworkerprecomputeConf = (resolvePlaceholders) ? teeworkerprecomputeIConf.resolved : teeworkerprecomputeIConf.unsolved;

        conf.teeworkerprecompute = {
            ...teeworkerprecomputeConf,
            repository: deepCopyPackage(teeworkerprecomputeConf.repository, dir)
        }
    }

    const teeworkerpostcomputeIConf = inventory.getTeeWorkerPostComputeConfig();
    if (teeworkerpostcomputeIConf) {
        // keep unresolved
        assert(teeworkerpostcomputeIConf.type === 'teeworkerpostcompute');
        assert(teeworkerpostcomputeIConf.resolved);
        assert(teeworkerpostcomputeIConf.unsolved);
        assert(teeworkerpostcomputeIConf.resolved.type === 'teeworkerpostcompute');
        assert(teeworkerpostcomputeIConf.unsolved.type === 'teeworkerpostcompute');

        /** @type {srvTypes.TeeWorkerPostComputeConfig} */
        const teeworkerpostcomputeConf = (resolvePlaceholders) ? teeworkerpostcomputeIConf.resolved : teeworkerpostcomputeIConf.unsolved;

        conf.teeworkerpostcompute = {
            ...teeworkerpostcomputeConf,
            repository: deepCopyPackage(teeworkerpostcomputeConf.repository, dir)
        }
    }

    const iexecsdkIConf = inventory.getIExecSdkConfig();
    if (iexecsdkIConf) {
        assert(iexecsdkIConf.type === 'iexecsdk');
        assert(iexecsdkIConf.resolved);
        assert(iexecsdkIConf.unsolved);
        assert(iexecsdkIConf.unsolved.type === 'iexecsdk');
        assert(iexecsdkIConf.resolved.type === 'iexecsdk');

        /** @type {srvTypes.IExecSdkConfig} */
        const iexecsdkConf = (resolvePlaceholders) ? iexecsdkIConf.resolved : iexecsdkIConf.unsolved;
        if (iexecsdkConf.chainsJsonLocation) {
            iexecsdkConf.chainsJsonLocation =
                toRelativePath(dir, iexecsdkConf.chainsJsonLocation);
        }
        conf.iexecsdk = {
            ...iexecsdkConf,
            repository: deepCopyPackage(iexecsdkConf.repository, dir)
        }
    }

    return conf;
}

/**
 * - Configs are duplicated
 * @param {{ [name:string]: { type: srvTypes.SharedServiceType} }} obj 
 * @returns {Promise<{name: string, config:{ type: srvTypes.SharedServiceType }}[][]>}
 */
export async function sortConfigsDictBySharedServiceTypes(obj) {
    /** @type {{name: string, config:{ type: srvTypes.SharedServiceType }}[][]} */
    const types = Array(ORDERED_SERVICE_TYPES.length).fill(null);
    const names = Object.keys(obj);
    for (let i = 0; i < names.length; ++i) {
        const name = names[i];
        const config = obj[name];
        // @ts-ignore
        assert(config.type !== 'worker');
        if (SERVICE_TYPE_INDICES[config.type] === undefined) {
            throw new CodeError(`Unknown service type ${config.type}`);
        }
        const index = SERVICE_TYPE_INDICES[config.type];
        // @ts-ignore
        const configCopy = await fromServiceType[config.type].deepCopyConfig(config, false);
        if (!types[index]) {
            // @ts-ignore
            types[index] = [{ name, config: configCopy }];
        } else {
            // @ts-ignore
            types[index].push({ name, config: configCopy });
        }
    }
    return types;
}
