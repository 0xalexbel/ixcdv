import assert from 'assert';
import * as srvTypes from './services-types-internal.js';
import * as types from '../common/common-types.js';
import * as pocoTypes from '../poco/poco-types.js';
import { Inventory } from './Inventory.js';
import path from 'path';
import { helperAbstractServiceToPackage } from './spring-serverservice.js';
import { Market } from './Market.js';
import { ENV_FILE_BASENAME } from './base-internal.js';
import { fromServiceType } from './InventoryDB.js';
import { dirExists, fileExists, fileExistsInDir, mkDirP, readObjectFromJSONFile, saveToFile, saveToFileSync, toRelativePath } from '../common/fs.js';
import { ensureSuffix, isNullishOrEmptyString, removePrefix } from '../common/string.js';
import { parseSettingsDotGradleFile } from '../common/iexec/spring.js';
import { toPackage } from '../pkgmgr/pkg.js';
import { getGradleWrapperVersion } from '../common/gradlew.js';
import { CodeError } from '../common/error.js';
import { PROD_BIN, PROD_VAR_PREFIX } from '../common/consts.js';
import { genTruffleConfigJs } from '../truffle/truffle-api.js';
import { GANACHE_CHAIN_ASYNCREQUESTPROCESSING, GANACHE_CHAIN_HARDFORK, GANACHE_MINER_CALLGASLIMIT, GANACHE_MINER_DEFAULTTRANSACTIONGASLIMIT } from '../common/ganache.js';

const MAIN_PROJECT_NAME = 'chain';

/**
 * @param {Inventory} inventory 
 * @param {string} destDir 
 * @param {boolean} save 
 * @param {boolean} override 
 */
export async function generateAllChainsVSCodeWorkspaces(inventory, destDir, save = false, override = false) {
    const chains = inventory._inv.getChains();
    const promises = [];
    const allFlags = {
        'market': true,
        'sms': true,
        'resultproxy': true,
        'blockchainadapter': true,
        'core': true,
        'worker': true,
        'iexecsdk': true,
        'PoCo': false,
    };
    const allFlagsKeys = Object.keys(allFlags);

    for (let i = 0; i < chains.length; ++i) {
        const destDirname = path.join(destDir, chains[i].name);

        let skip = false;
        /** @type {string | undefined} */
        let saveToBasename = undefined;
        if (save) {
            saveToBasename = 'all.' + chains[i].name + '.code-workspace';
            if (!override) {
                if (fileExistsInDir(destDirname, saveToBasename)) {
                    console.log(`File ${destDirname}/${saveToBasename} already exists.`);
                    skip = true;
                }
            }
        }

        if (!skip) {
            const p = generateChainVSCodeWorkspace(
                inventory,
                destDirname,
                chains[i].name,
                chains[i].chain.hubAlias,
                allFlags,
                saveToBasename).then((v) => {
                    //console.log('OK');
                }, (reason) => {
                    //console.log('FAILED all');
                });
            promises.push(p);
        }

        for (let j = 0; j < allFlagsKeys.length; ++j) {
            if (save) {
                saveToBasename = allFlagsKeys[j] + '.' + chains[i].name + '.code-workspace';
                if (!override) {
                    if (fileExistsInDir(destDirname, saveToBasename)) {
                        console.log(`File ${destDirname}/${saveToBasename} already exists.`);
                        continue;
                    }
                }
            }

            const p = generateChainVSCodeWorkspace(
                inventory,
                destDirname,
                chains[i].name,
                chains[i].chain.hubAlias,
                { [allFlagsKeys[j]]: true },
                saveToBasename).then((v) => {
                    //console.log('OK');
                }, (reason) => {
                    //console.log('FAILED ' + allFlagsKeys[j]);
                    //console.log(reason);
                });

            promises.push(p);
        }

    }
    return await Promise.all(promises);
}

/**
 * @param {string | types.Package} repository 
 */
function toRepoDir(repository) {
    if (typeof repository === 'string') {
        return repository;
    }
    return repository.directory;
}

/**
 * @param {Inventory} inventory 
 * @param {*} vscodeWorkspace 
 * @param {*} vscodeWorkspaceDir 
 * @param {string} chainName 
 * @param {string} chainHub 
 * @param {srvTypes.SpringServiceConfig} config 
 * @param {*} settings 
 */
function addService(inventory, vscodeWorkspace, vscodeWorkspaceDir, chainName, chainHub, config, settings) {
    assert(path.isAbsolute(vscodeWorkspaceDir));
    assert(path.isAbsolute(config.springConfigLocation));
    assert(typeof config.repository !== 'string');

    const relPath = toRelativePath(config.repository.directory, config.springConfigLocation);
    assert(relPath);
    assert(!relPath.startsWith('/'));
    assert(relPath.startsWith('./') || relPath.startsWith('../'));

    const taskRelPath = toRelativePath(vscodeWorkspaceDir, inventory._inv.rootDir);
    assert(taskRelPath);
    assert(!taskRelPath.startsWith('/'));
    assert(taskRelPath.startsWith('./') || taskRelPath.startsWith('../'));

    const projectName = settings.rootProjectName + '-' + settings.version;
    const type = config.type;
    const launchCwd = "${workspaceFolder:" + projectName + "}";
    const taskCwd = "${workspaceFolder:" + MAIN_PROJECT_NAME + "}/" + taskRelPath;

    const appYmlLocWithTrailingSlash = launchCwd + "/" + ensureSuffix('/', relPath);

    const taskName = `${PROD_BIN}: PreLaunch-${projectName}`;
    vscodeWorkspace.tasks.tasks.push({
        "label": taskName,
        "type": "shell",
        "options": {
            "cwd": taskCwd
        },
        "command": `${PROD_BIN} vscode prelaunchtask --type ${type} --chain ${chainName} --hub ${chainHub}`
    });

    vscodeWorkspace.launch.configurations.push(
        {
            "type": "java",
            "name": "Launch " + projectName,
            "request": "launch",
            "env": {
                "logstash-gelf.skipHostnameResolution": "true"
            },
            "envFile": appYmlLocWithTrailingSlash + ENV_FILE_BASENAME,
            "mainClass": fromServiceType[type].CLASSNAME(),
            // WARNING !! projectName === gradle project name
            "projectName": settings.uniqueRootProjectName,
            "cwd": launchCwd,
            "vmArgs": "-Dspring.config.location=" + appYmlLocWithTrailingSlash,
            "preLaunchTask": taskName
        }
    );
}

/**
 * @param {Inventory} inventory 
 * @param {*} vscodeWorkspace 
 * @param {*} vscodeWorkspaceDir 
 * @param {string} projectName 
 * @param {string} chainName 
 * @param {string} chainHub 
 * @param {srvTypes.MarketConfig} config 
 * @param {string} configName 
 */
function addMarketService(inventory, vscodeWorkspace, vscodeWorkspaceDir, projectName, chainName, chainHub, config, configName) {
    assert(config.directory);
    assert(path.isAbsolute(vscodeWorkspaceDir));
    assert(path.isAbsolute(config.directory));
    assert(typeof config.repository !== 'string');

    const relPath = toRelativePath(config.repository.directory, config.directory);
    assert(relPath);
    assert(!relPath.startsWith('/'));
    assert(relPath.startsWith('./') || relPath.startsWith('../'));

    const taskRelPath = toRelativePath(vscodeWorkspaceDir, inventory._inv.rootDir);
    assert(taskRelPath);
    assert(!taskRelPath.startsWith('/'));
    assert(taskRelPath.startsWith('./') || taskRelPath.startsWith('../'));

    const type = config.type;
    const launchCwd = "${workspaceFolder:" + projectName + "}";
    const taskCwd = "${workspaceFolder:" + MAIN_PROJECT_NAME + "}/" + taskRelPath;

    const envFileDirname = launchCwd + "/" + ensureSuffix('/', relPath);

    const watcherHubs = Market.watcherHubs(config);

    /*
        - task : "ixcdv: PreLaunch-iexec-market-api-v5.3.1-api"
        - task : "ixcdv: PreLaunch-iexec-market-api-v5.3.1-watcher.1337.standard"
        - task : "ixcdv: PreLaunch-iexec-market-api-v5.3.1-watcher.1338.standard"
    */

    const taskName = `${PROD_BIN}: PreLaunch-${projectName}`;
    vscodeWorkspace.tasks.tasks.push({
        "label": taskName,
        "type": "shell",
        "options": {
            "cwd": taskCwd
        },
        "command": `${PROD_BIN} vscode prelaunchtask --type ${type} --chain ${chainName} --hub ${chainHub}`
    });

    vscodeWorkspace.launch.configurations.push(
        {
            "type": "node",
            "name": "Launch " + projectName + " api",
            "request": "launch",
            "envFile": envFileDirname + 'run/api/' + ENV_FILE_BASENAME,
            "cwd": launchCwd,
            "skipFiles": [
                "<node_internals>/**"
            ],
            "console": "integratedTerminal",
            "program": "${workspaceFolder:" + projectName + "}/api/src/server.js",
            "args": [],
            "preLaunchTask": taskName
        }
    );

    for (let i = 0; i < watcherHubs.length; ++i) {
        const h = watcherHubs[i];
        vscodeWorkspace.launch.configurations.push(
            {
                "type": "node",
                "name": "Launch " + projectName + " watcher." + h,
                "request": "launch",
                "envFile": envFileDirname + 'run/watcher.' + h + "/" + ENV_FILE_BASENAME,
                "cwd": launchCwd,
                "skipFiles": [
                    "<node_internals>/**"
                ],
                "console": "integratedTerminal",
                "program": "${workspaceFolder:" + projectName + "}/watcher/src/index.js",
                "args": [],
                "preLaunchTask": taskName
            }
        );
    }
}

/**
 * @param {Inventory} inventory 
 * @param {*} vscodeWorkspace 
 * @param {*} vscodeWorkspaceDir 
 * @param {string} projectName 
 * @param {string} chainName 
 * @param {string} chainHub 
 * @param {srvTypes.IExecSdkConfig} config 
 */
async function addIExecSdk(inventory, vscodeWorkspace, vscodeWorkspaceDir, projectName, chainName, chainHub, config) {
    assert(path.isAbsolute(vscodeWorkspaceDir));
    assert(typeof config.repository !== 'string');

    const relPath = toRelativePath(config.repository.directory, config.chainsJsonLocation);
    assert(relPath);
    assert(!relPath.startsWith('/'));
    assert(relPath.startsWith('./') || relPath.startsWith('../'));

    const pkgJson = path.join(config.repository.directory, 'package.json');
    assert(fileExists(pkgJson));
    const pkgObj = await readObjectFromJSONFile(pkgJson, { strict: true });

    assert(pkgObj.bin);
    assert(!isNullishOrEmptyString(pkgObj.bin.iexec));
    const cliBin = removePrefix('./', pkgObj.bin.iexec);
    assert(!path.isAbsolute(cliBin));
    const srcDir = path.join(config.repository.directory, 'src');
    assert(dirExists(srcDir));
    const pos = cliBin.indexOf('/cli/');
    const launchProgram = "${workspaceFolder:" + projectName + "}/src" + cliBin.substring(pos);

    const taskRelPath = toRelativePath(vscodeWorkspaceDir, inventory._inv.rootDir);
    assert(taskRelPath);
    assert(!taskRelPath.startsWith('/'));
    assert(taskRelPath.startsWith('./') || taskRelPath.startsWith('../'));

    const type = config.type;
    const launchCwd = "${workspaceFolder:" + projectName + "}/" + relPath;
    const taskCwd = "${workspaceFolder:" + MAIN_PROJECT_NAME + "}/" + taskRelPath;

    const { PoCoHubRef: hubRef, service: ganache } = await inventory._inv.resolve(chainHub);
    assert(hubRef.deployConfigName);
    const walletsPassword = ganache.walletsPassword;
    const walletsRel = toRelativePath(config.chainsJsonLocation, ganache.walletsDir);
    const workerpool = ganache.workerpool(hubRef.deployConfigName);
    assert(workerpool);

    const appWalletIndex = inventory.getDefaultWalletIndex('app');
    const appWalletKeys = ganache.walletKeysAtIndex(appWalletIndex);

    const datasetWalletIndex = inventory.getDefaultWalletIndex('dataset');;
    const datasetWalletKeys = ganache.walletKeysAtIndex(datasetWalletIndex);

    const taskName = `${PROD_BIN}: PreLaunch-${projectName}`;
    vscodeWorkspace.tasks.tasks.push({
        "label": taskName,
        "type": "shell",
        "options": {
            "cwd": taskCwd
        },
        "command": `${PROD_BIN} vscode prelaunchtask --type ${type} --chain ${chainName} --hub ${chainHub}`
    });

    vscodeWorkspace.launch.configurations.push(
        {
            "type": "node",
            "name": "iexec-sdk info",
            "request": "launch",
            "cwd": launchCwd,
            "skipFiles": [
                "<node_internals>/**"
            ],
            "console": "integratedTerminal",
            "program": launchProgram,
            "args": [
                "info"
            ],
            "preLaunchTask": taskName
        }
    );

    vscodeWorkspace.launch.configurations.push(
        {
            "type": "node",
            "name": "iexec-sdk workerpool show 0",
            "request": "launch",
            "cwd": launchCwd,
            "skipFiles": [
                "<node_internals>/**"
            ],
            "console": "integratedTerminal",
            "program": launchProgram,
            "args": [
                "workerpool", "show", "--raw",
                "--wallet-file", path.join(walletsRel, `wallet${workerpool.accountIndex}.json`),
                "--keystoredir", "local",
                "--password", walletsPassword,
                "0"
            ],
            "preLaunchTask": taskName
        }
    );

    vscodeWorkspace.launch.configurations.push(
        {
            "type": "node",
            "name": "iexec-sdk app show 0",
            "request": "launch",
            "cwd": launchCwd,
            "skipFiles": [
                "<node_internals>/**"
            ],
            "console": "integratedTerminal",
            "program": launchProgram,
            "args": [
                "app", "show", "--raw",
                "--wallet-file", path.join(walletsRel, `wallet${appWalletIndex}.json`),
                "--keystoredir", "local",
                "--password", walletsPassword,
                "--user", `${appWalletKeys.address}`,
                "0"
            ],
            "preLaunchTask": taskName
        }
    );

    vscodeWorkspace.launch.configurations.push(
        {
            "type": "node",
            "name": "iexec-sdk dataset show 0",
            "request": "launch",
            "cwd": launchCwd,
            "skipFiles": [
                "<node_internals>/**"
            ],
            "console": "integratedTerminal",
            "program": launchProgram,
            "args": [
                "dataset", "show", "--raw",
                "--wallet-file", path.join(walletsRel, `wallet${datasetWalletIndex}.json`),
                "--keystoredir", "local",
                "--password", walletsPassword,
                "--user", `${datasetWalletKeys.address}`,
                "0"
            ],
            "preLaunchTask": taskName
        }
    );
}

/**
 * @param {Inventory} inventory 
 * @param {*} vscodeWorkspace 
 * @param {*} vscodeWorkspaceDir 
 * @param {string} projectName 
 * @param {string} chainName 
 * @param {string} chainHub 
 * @param {pocoTypes.GanachePoCoServiceConfig} config 
 */
async function addPoCo(inventory, vscodeWorkspace, vscodeWorkspaceDir, projectName, chainName, chainHub, config) {
    assert(path.isAbsolute(vscodeWorkspaceDir));
    assert(config.config.PoCo);
    assert(typeof config.config.PoCo === 'object');

    const host = config.hostname ?? 'localhost';
    const port = config.port;

    // Generate truffle-config.js in 'vscodeWorkspaceDir'
    const truffleConfigFile = await genTruffleConfigJs(
        host,
        port,
        vscodeWorkspaceDir,
        { strict: true });
    assert(truffleConfigFile);
    assert(path.isAbsolute(truffleConfigFile));

    const truffleConfigRelPath = toRelativePath(config.config.PoCo.directory, vscodeWorkspaceDir);
    assert(truffleConfigRelPath);
    assert(!truffleConfigRelPath.startsWith('/'));
    assert(truffleConfigRelPath.startsWith('./') || truffleConfigRelPath.startsWith('../'));

    const pkgJson = path.join(config.config.PoCo.directory, 'package.json');
    assert(fileExists(pkgJson));
    const pkgObj = await readObjectFromJSONFile(pkgJson, { strict: true });

    // PoCo embedded truffle cli : node ./node_modules/truffle/build/cli.bundled.js
    const launchCwd = "${workspaceFolder:" + projectName + "}";

    vscodeWorkspace.launch.configurations.push(
        {
            "type": "node",
            "name": "truffle compile",
            "request": "launch",
            "cwd": launchCwd,
            "skipFiles": [
                "<node_internals>/**",
                "!**/node_modules/truffle/**"
            ],
            "console": "integratedTerminal",
            "program": `${launchCwd}/node_modules/truffle/build/cli.bundled.js`,
            "args": [
                "compile",
                "--config",
                path.join(truffleConfigRelPath, path.basename(truffleConfigFile))
            ]
        }
    );

    vscodeWorkspace.launch.configurations.push(
        {
            "type": "node",
            "name": "truffle migrate",
            "request": "launch",
            "cwd": launchCwd,
            "skipFiles": [
                "<node_internals>/**",
                "!**/node_modules/truffle/**"
            ],
            "console": "integratedTerminal",
            "program": `${launchCwd}/node_modules/truffle/build/cli.bundled.js`,
            "args": [
                "migrate",
                "--config",
                path.join(truffleConfigRelPath, path.basename(truffleConfigFile))
            ]
        }
    );

    vscodeWorkspace.launch.configurations.push(
        {
            "type": "node",
            "name": "truffle test",
            "request": "launch",
            "cwd": launchCwd,
            "skipFiles": [
                "<node_internals>/**",
                "!**/node_modules/truffle/**"
            ],
            "console": "integratedTerminal",
            "program": `${launchCwd}/node_modules/truffle/build/cli.bundled.js`,
            "args": [
                "test",
                "--config",
                path.join(truffleConfigRelPath, path.basename(truffleConfigFile))
            ]
        }
    );

    vscodeWorkspace.tasks.tasks.push({
        "label": `startGanacheModule`,
        "type": "shell",
        "options": {
            "cwd": "${workspaceFolder:" + projectName + "}",
        },
        "command": "node",
        "args": [
            "./node_modules/ganache/dist/node/cli.js",
            "--chain.chainId", `${config.config.chainid}`,
            "--chain.networkId", `${config.config.chainid}`,
            "--server.host", host,
            "--server.port", `${port}`,
            "--mnemonic", config.config.mnemonic,
            "--miner.callGasLimit", GANACHE_MINER_CALLGASLIMIT,
            "--miner.defaultTransactionGasLimit", GANACHE_MINER_DEFAULTTRANSACTIONGASLIMIT,
            "--chain.asyncRequestProcessing", GANACHE_CHAIN_ASYNCREQUESTPROCESSING,
            "--chain.vmErrorsOnRPCResponse", "true", // make sure `truffle test` runs properly
            "--logging.debug", "true"
        ]
    });

    vscodeWorkspace.tasks.tasks.push({
        "label": `clean`,
        "type": "shell",
        "options": {
            "cwd": "${workspaceFolder:" + projectName + "}"
        },
        "command": "rm",
        "args": [
            "-rf", "./build",
        ]
    });
}

/**
 * @param {Inventory} inventory 
 * @param {*} vscodeWorkspace 
 * @param {*} vscodeWorkspaceDir 
 * @param {string} chainName 
 * @param {string} chainHub 
 * @param {number} index 
 * @param {srvTypes.WorkerConfig} config 
 * @param {*} settings 
 */
function addWorkerService(inventory, vscodeWorkspace, vscodeWorkspaceDir, chainName, chainHub, index, config, settings) {
    assert(path.isAbsolute(vscodeWorkspaceDir));
    assert(path.isAbsolute(config.springConfigLocation));
    assert(path.isAbsolute(config.directory));
    assert(typeof config.repository !== 'string');

    const relPath = toRelativePath(config.repository.directory, config.springConfigLocation);
    assert(relPath);
    assert(!relPath.startsWith('/'));
    assert(relPath.startsWith('./') || relPath.startsWith('../'));

    const taskRelPath = toRelativePath(vscodeWorkspaceDir, inventory._inv.rootDir);
    assert(taskRelPath);
    assert(!taskRelPath.startsWith('/'));
    assert(taskRelPath.startsWith('./') || taskRelPath.startsWith('../'));

    const projectName = settings.rootProjectName + '-' + settings.version;
    const type = config.type;
    const launchCwd = "${workspaceFolder:" + projectName + "}";
    const taskCwd = "${workspaceFolder:" + MAIN_PROJECT_NAME + "}/" + taskRelPath;

    const appYmlLocWithTrailingSlash = launchCwd + "/" + ensureSuffix('/', relPath);

    const taskName = `${PROD_BIN}: PreLaunch-${projectName}-#${index}`;
    vscodeWorkspace.tasks.tasks.push({
        "label": taskName,
        "type": "shell",
        "options": {
            "cwd": taskCwd
        },
        "command": `${PROD_BIN} vscode prelaunchtask --type ${type} --worker-index ${index} --chain ${chainName} --hub ${chainHub}`
    });

    vscodeWorkspace.launch.configurations.push(
        {
            "type": "java",
            "name": `Launch ${projectName} #${index}`,
            "request": "launch",
            "env": {
                "logstash-gelf.skipHostnameResolution": "true"
            },
            "envFile": appYmlLocWithTrailingSlash + ENV_FILE_BASENAME,
            "mainClass": fromServiceType[type].CLASSNAME(),
            // WARNING !! projectName === gradle project name
            "projectName": settings.uniqueRootProjectName,
            "cwd": launchCwd,
            "vmArgs": "-Dspring.config.location=" + appYmlLocWithTrailingSlash,
            "preLaunchTask": taskName
        }
    );
}

/**
 * @param {Inventory} inventory 
 * @param {string} destDirname 
 * @param {string} chainName 
 * @param {string} chainHub 
 * @param {{
 *      'market'?: boolean
 *      'sms'?: boolean
 *      'resultproxy'?: boolean
 *      'blockchainadapter'?: boolean
 *      'core'?: boolean
 *      'worker'?: boolean
 *      'iexecsdk'?: boolean
 *      'PoCo'?: boolean
 * }} types 
 * @param {string=} saveToBasename 
 */
export async function generateChainVSCodeWorkspace(
    inventory,
    destDirname,
    chainName,
    chainHub,
    types,
    saveToBasename
) {

    /** @type {Map<string,Map<string, any>>} */
    const typesMap = new Map();
    /** @type {{path:string, name:string}[]} */
    const srcDirs = [];

    /** @type {any} */
    const vscodeWorkspace = {
        folders: srcDirs,
        settings: {},
        tasks: {
            version: "2.0.0",
            tasks: []
        },
        launch: {
            version: "0.2.0",
            configurations: []
        }
    };

    const hasSms = (types['sms'] === true);
    const hasResultProxy = (types['resultproxy'] === true);
    const hasBlockchainAdapter = (types['blockchainadapter'] === true);
    const hasCore = (types['core'] === true);
    const hasWorker = (types['worker'] === true);
    const hasMarket = (types['market'] === true);
    const hasIExecSdk = (types['iexecsdk'] === true);
    const hasPoCo = (types['PoCo'] === true);
    let hasGradle = false;

    const ganacheConf = inventory._inv.getConfigFromHub('ganache', chainHub)?.resolved;
    assert(ganacheConf);
    assert(ganacheConf.type === 'ganache');

    /* -------------------------------------------- */
    // Add Services in dependency order
    /* -------------------------------------------- */

    // market
    if (hasMarket) {
        const marketIConf = inventory._inv.getConfigFromHub('market', chainHub);
        const marketConf = marketIConf?.resolved;
        assert(marketIConf);
        assert(marketConf);
        assert(marketConf.type === 'market');
        const marketPkg = await helperAbstractServiceToPackage(Market, marketConf);
        const marketProjetName = marketPkg.gitHubRepoName + "-" + marketPkg.commitish;
        assert(marketProjetName);
        const marketDir = toRepoDir(marketConf.repository);
        srcDirs.push({
            path: toRelativePath(destDirname, marketDir),
            name: marketProjetName
        });

        addMarketService(
            inventory,
            vscodeWorkspace,
            destDirname,
            marketProjetName,
            chainName,
            chainHub,
            marketConf,
            marketIConf.name);
    }

    // sms
    if (hasSms) {
        hasGradle = true;
        const smsConf = inventory._inv.getConfigFromHub('sms', chainHub)?.resolved;
        assert(smsConf);
        assert(smsConf.type === 'sms');
        const smsDir = toRepoDir(smsConf.repository);
        const smsSettings = parseSettingsDotGradleFile(smsDir, { typesMap, recursive: true });

        addService(
            inventory,
            vscodeWorkspace,
            destDirname,
            chainName,
            chainHub,
            smsConf,
            smsSettings);
    }

    // result proxy
    if (hasResultProxy) {
        hasGradle = true;
        const resultproxyConf = inventory._inv.getConfigFromHub('resultproxy', chainHub)?.resolved;
        assert(resultproxyConf);
        assert(resultproxyConf.type === 'resultproxy');
        const resultproxyDir = toRepoDir(resultproxyConf.repository);
        const resultproxySettings = parseSettingsDotGradleFile(resultproxyDir, { typesMap, recursive: true });

        addService(
            inventory,
            vscodeWorkspace,
            destDirname,
            chainName,
            chainHub,
            resultproxyConf,
            resultproxySettings);
    }

    // blockchain adapter
    if (hasBlockchainAdapter) {
        hasGradle = true;
        const blockchainadapterConf = inventory._inv.getConfigFromHub('blockchainadapter', chainHub)?.resolved;
        assert(blockchainadapterConf);
        assert(blockchainadapterConf.type === 'blockchainadapter');
        const blockchainadapterDir = toRepoDir(blockchainadapterConf.repository);
        const blockchainadapterSettings = parseSettingsDotGradleFile(blockchainadapterDir, { typesMap, recursive: true });

        addService(
            inventory,
            vscodeWorkspace,
            destDirname,
            chainName,
            chainHub,
            blockchainadapterConf,
            blockchainadapterSettings);
    }

    // core
    if (hasCore) {
        hasGradle = true;
        const coreConf = inventory._inv.getConfigFromHub('core', chainHub)?.resolved;
        assert(coreConf);
        assert(coreConf.type === 'core');
        const coreDir = toRepoDir(coreConf.repository);
        const coreSettings = parseSettingsDotGradleFile(coreDir, { typesMap, recursive: true });

        addService(
            inventory,
            vscodeWorkspace,
            destDirname,
            chainName,
            chainHub,
            coreConf,
            coreSettings);
    }

    // workers
    if (hasWorker) {
        hasGradle = true;
        const workers = [];
        const nWorkers = 4;
        for (let i = 0; i < nWorkers; ++i) {
            const ic = inventory._inv.getWorkerConfig(chainHub, i);
            assert(ic.resolved);
            assert(ic.resolved.type === 'worker');
            workers.push(ic);
        }
        assert(workers.length > 0);
        const workerDir = toRepoDir(workers[0].resolved.repository);
        const workerSettings = parseSettingsDotGradleFile(workerDir, { typesMap, recursive: true });

        for (let i = 0; i < workers.length; ++i) {
            addWorkerService(
                inventory,
                vscodeWorkspace,
                destDirname,
                chainName,
                chainHub,
                workers[i].index,
                workers[i].resolved,
                workerSettings);
        }
    }

    // iexec-sdk
    if (hasIExecSdk) {
        const iexecsdkIConf = inventory._inv.getIExecSdkConfig();
        if (iexecsdkIConf) {
            const iexecsdkConf = iexecsdkIConf.resolved;
            assert(iexecsdkIConf);
            assert(iexecsdkConf);
            assert(iexecsdkConf.type === 'iexecsdk');
            const iexecsdkPkg = toPackage(iexecsdkConf.repository);
            const iexecsdkProjetName = iexecsdkPkg.gitHubRepoName + "-" + iexecsdkPkg.commitish;
            assert(iexecsdkProjetName);
            const iexecsdkDir = toRepoDir(iexecsdkConf.repository);
            srcDirs.push({
                path: toRelativePath(destDirname, iexecsdkDir),
                name: iexecsdkProjetName
            });

            await addIExecSdk(
                inventory,
                vscodeWorkspace,
                destDirname,
                iexecsdkProjetName,
                chainName,
                chainHub,
                iexecsdkConf);
        }
    }

    // PoCo
    if (hasPoCo) {
        assert(ganacheConf.config.PoCo);
        // must be a Package
        assert(typeof ganacheConf.config.PoCo === 'object');
        const PoCoPkg = ganacheConf.config.PoCo;
        let PoCoProjetName = PoCoPkg.gitHubRepoName;
        if (PoCoPkg.commitish) {
            PoCoProjetName += "-" + PoCoPkg.commitish;
        }
        assert(PoCoProjetName);
        const PoCoDir = ganacheConf.config.PoCo.directory;
        srcDirs.push({
            path: toRelativePath(destDirname, PoCoDir),
            name: PoCoProjetName
        });

        await addPoCo(
            inventory,
            vscodeWorkspace,
            destDirname,
            PoCoProjetName,
            chainName,
            chainHub,
            ganacheConf);
    }

    /** @type {string | null} */
    let gradleVersion = null;
    /** @type {string} */
    let gradleVersionFirstProject;

    typesMap.forEach((map, gitRepoName) => {
        map.forEach((settings, directory) => {
            assert(settings.rootProjectName === gitRepoName);
            // Check for potential gradlew version conflict
            const _gradleVersion = getGradleWrapperVersion(path.join(directory, 'gradle/wrapper'));
            if (!gradleVersion) {
                gradleVersion = _gradleVersion;
                gradleVersionFirstProject = settings.rootProjectName;
            } else {
                if (gradleVersion !== _gradleVersion) {
                    throw new CodeError(`Conflicting gradle wrapper versions. ${gradleVersionFirstProject}=${gradleVersion}, ${settings.rootProjectName}=${_gradleVersion}`);
                }
            }
            srcDirs.push({
                path: toRelativePath(destDirname, directory),
                name: settings.rootProjectName + '-' + settings.version
            });
        });
    });

    srcDirs.push({
        path: ".",
        name: MAIN_PROJECT_NAME
    });

    if (hasGradle) {
        vscodeWorkspace.settings["gradle.javaDebug.cleanOutput"] = false;
        vscodeWorkspace.settings["java.configuration.updateBuildConfiguration"] = "automatic";
        vscodeWorkspace.settings["java.import.gradle.version"] = gradleVersion;
        vscodeWorkspace.settings["java.settings.url"] = path.join(destDirname, 'java-settings.prefs');
        vscodeWorkspace.settings["java.test.config"] = {
            name: `${PROD_VAR_PREFIX}-java-test-config`,
            envFile: path.join(destDirname, 'java-test-settings-env-vars')
        };
        vscodeWorkspace.settings["java.test.defaultConfig"] = `${PROD_VAR_PREFIX}-java-test-config`;

        // -------------------------------------------------------------------------------------
        // CRUCIAL !! iexec-worker (and may be other projects as well) build will FAIL without
        // the 'org.eclipse.jdt.core.compiler.codegen.methodParameters=generate' configured
        // using ${workspaceFolder} variables does not seem to work
        // -------------------------------------------------------------------------------------

        const javaSettingsPrefs = "org.eclipse.jdt.core.compiler.codegen.methodParameters=generate";
        saveToFileSync(javaSettingsPrefs, destDirname, 'java-settings.prefs');

        const javaTestSettingsEnvVars = `# Define below all the environment variables required to perform the tests
    
# docker.io username and password required to perform the iexec-common docker tests
# DOCKER_IO_USER="my-dummy-docker-io-username"
# DOCKER_IO_PASSWORD="my-dummy-docker-io-password"
`;
        saveToFileSync(javaTestSettingsEnvVars, destDirname, 'java-test-settings-env-vars');
    }

    const taskRelPath = toRelativePath(destDirname, inventory._inv.rootDir);
    vscodeWorkspace.tasks.tasks.push({
        "label": `${PROD_BIN} stop all`,
        "type": "shell",
        "options": {
            "cwd": "${workspaceFolder:" + MAIN_PROJECT_NAME + "}/" + taskRelPath
        },
        "command": `${PROD_BIN} stop all`
    });
    vscodeWorkspace.tasks.tasks.push({
        "label": `${PROD_BIN} kill all`,
        "type": "shell",
        "options": {
            "cwd": "${workspaceFolder:" + MAIN_PROJECT_NAME + "}/" + taskRelPath
        },
        "command": `${PROD_BIN} kill all`
    });
    vscodeWorkspace.tasks.tasks.push({
        "label": `${PROD_BIN} test`,
        "type": "shell",
        "options": {
            "cwd": "${workspaceFolder:" + MAIN_PROJECT_NAME + "}/" + taskRelPath
        },
        "command": `${PROD_BIN} test`
    });

    const out = {
        chain: chainName,
        hub: chainHub,
        workspace: vscodeWorkspace,
        dirname: destDirname,
        basename: ''
    };

    //console.log(JSON.stringify(vscodeWorkspace, null, 2));
    if (!isNullishOrEmptyString(saveToBasename)) {
        assert(saveToBasename);
        if (!dirExists(destDirname)) {
            mkDirP(destDirname);
        }
        console.log(`Generate file : ${destDirname}/${saveToBasename}`);
        await saveToFile(JSON.stringify(vscodeWorkspace, null, 2), destDirname, saveToBasename);
        out.basename = saveToBasename;
    }

    return out;
}

