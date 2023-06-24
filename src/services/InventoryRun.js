import * as types from '../common/common-types.js';
import * as srvTypes from './services-types-internal.js';
import assert from 'assert';
import { fromServiceType, InventoryDB } from "./InventoryDB.js";
import { Dependencies } from './Dependencies.js';
import { Market } from './Market.js';
import { WorkerService } from './Worker.js';
import { CoreService } from './Core.js';
import { BlockchainAdapterService } from './BlockchainAdapter.js';
import { SmsService } from './Sms.js';
import { ResultProxyService } from './ResultProxy.js';
import { MongoService } from './MongoService.js';
import { RedisService } from './RedisService.js';
import { DB_SERVICE_TYPES } from './base-internal.js';
import { CodeError } from '../common/error.js';
import { pathIsPOSIXPortable, rmFileSync } from '../common/fs.js';
import { hostnamePortToString, isNullishOrEmptyString } from '../common/string.js';
import { isPositiveInteger } from '../common/number.js';
import { GanachePoCoService } from '../poco/GanachePoCoService.js';
import { IpfsService } from '../ipfs/IpfsService.js';
import { PoCoHubRef } from '../common/contractref.js';
import { DockerService } from './DockerService.js';
import { WORKERPOOL_NAME, WORKERPOOL_URL_TEXT_RECORD_KEY } from '../common/consts.js';
import * as ssh from '../common/ssh.js';

/** @type {srvTypes.NonWorkerServiceType[][]} */
const ORDERED_SERVICE_TYPE_GROUPS = [
    ['ganache', 'ipfs', 'docker', 'mongo', 'redis'],
    ['market'],
    ['sms', 'resultproxy', 'blockchainadapter'],
    ['core']
];

export class InventoryRun {
    /** @type {InventoryDB} */
    _inv;

    /**
     * @param {InventoryDB} inventoryDB 
     */
    constructor(inventoryDB) {
        this._inv = inventoryDB;
    }

    /**
     * @param {string} name 
     * @param {{
     *      chain?: string
     *      progressCb?: types.progressCallback
     * }=} options
     */
    async #startByName(name, options) {
        assert(pathIsPOSIXPortable(this._inv.rootDir));
        if (!this._inv.isConfigNameRunningLocally(name)) {
            const machine = this._inv.getConfigNameRunningMachine(name);
            assert(machine);
            const ic = this._inv.getConfig(name);
            assert(ic.type === 'sms');
            const res = await ssh.ixcdv(
                machine.sshConfig,
                machine.ixcdvWorkspaceDirectory,
                ["start", ic.type, "--hub", ic.resolved.hub, "--no-dependencies"]);
            if (!res.ok) {
                throw res.error;
            }
            return { name, startReturn: { ok: true } };
        }
        
        const instance = await this._inv.newInstanceFromName(name);
        const startReturn = await instance.start({
            createDir: true,
            env: { marker: this._inv.rootDir },
            context: {
                name
            },
            progressCb: options?.progressCb
        });

        if (startReturn === false) {
            throw new CodeError(`Unable to start service ${name}`);
        }
        if (typeof startReturn === 'object' && !startReturn.ok) {
            throw new CodeError(`Unable to start service ${name} : ${startReturn.error.message}`);
        }

        if (instance instanceof GanachePoCoService) {
            await this.#ganachePostStart(instance, name, options?.chain ?? 'unknown');
        }

        return { name, instance, startReturn };
    }

    /**
     * 
     * @param {GanachePoCoService} ganacheService 
     * @param {string} configName 
     * @param {string} networkName 
     */
    async #ganachePostStart(ganacheService, configName, networkName) {
        assert(networkName);

        const hubAliases = ganacheService.hubAliases();
        for (let i = 0; i < hubAliases.length; ++i) {
            const hubAlias = hubAliases[i].hubAlias;
            const deployConfigName = hubAliases[i].deployConfigName;
            const workepool = ganacheService.workerpool(deployConfigName);
            if (!workepool) {
                throw new CodeError('Unable to retrieve workerpool');
            }

            const ensRegistry = ganacheService.getENSRegistry(deployConfigName, networkName);
            assert(ensRegistry.address);
            const wpWallet = ganacheService.newWalletAtIndex(
                workepool.accountIndex,
                {
                    ensAddress: ensRegistry.address,
                    networkName
                }
            );

            const coreURL = this._inv.getHubServiceURL('core', hubAlias);
            if (coreURL.hostname === 'localhost') {
                coreURL.hostname = '127.0.0.1';
            }
            await ensRegistry.setText(
                WORKERPOOL_NAME,
                WORKERPOOL_URL_TEXT_RECORD_KEY,
                coreURL.toString(),
                wpWallet);
        }
    }

    /**
     * @param {srvTypes.NonWorkerServiceType[]} types 
     * @param {Dependencies} dependencies 
     * @param {string?} excludeName 
     * @param {{
     *      progressCb?: types.progressCallback
     * }=} options
     */
    async #startNamesFromNonWorkerTypes(types, dependencies, excludeName, options) {
        const promises = [];
        for (let i = 0; i < types.length; ++i) {
            const serviceType = types[i];
            const names = dependencies.getConfigNamesArrayFromType(serviceType);
            if (!names) {
                continue;
            }
            for (let j = 0; j < names.length; ++j) {
                const name = names[j];
                if (name === excludeName) {
                    continue;
                }
                const p = this.#startByName(name, options);
                promises.push(p);
            }
        }
        return Promise.all(promises);
    }

    /**
     * @param {{
     *      name?: string,
     *      chainid?: number | string
     *      chain?: string
     *      hub?: string,
     *      type?: srvTypes.NonWorkerServiceType | 'iexecsdk',
     *      onlyDependencies?: boolean
     *      noDependencies?: boolean
     *      types?: srvTypes.OptionalServiceTypes<boolean>
     *      progressCb?: types.progressCallback
     * }} options  
     */
    async start(options) {
        if (options.type === 'iexecsdk') {
            const hub = this._inv.guessHubAlias(options);
            if (!hub) {
                throw new CodeError('Missing hub');
            }
            const dependencies = Dependencies.newIExecSDK(hub, this._inv);
            const allResults = [];
            for (let i = 0; i < ORDERED_SERVICE_TYPE_GROUPS.length; ++i) {
                // groups are sequential, NOT parallel
                const result = await this.#startNamesFromNonWorkerTypes(
                    ORDERED_SERVICE_TYPE_GROUPS[i],
                    dependencies,
                    null,
                    options);
                allResults.push(...result);
            }
            return allResults;
        }

        // Guess a single named service configuration
        const ic = this._inv.guessConfig(options);
        if (!ic) {
            throw new CodeError(`Unable to determine the service to start`);
        }
        assert(ic.type !== 'worker');
        const name = ic.name;

        const onlyDependencies = (options?.onlyDependencies === true);
        const noDependencies = (options?.noDependencies === true);
        if (onlyDependencies && noDependencies) {
            throw new CodeError('Conflicting options (onlyDependencies & noDependencies)');
        }

        const allResults = [];

        if (!noDependencies) {
            const dependencies = this._inv.dependencies(name);
            for (let i = 0; i < ORDERED_SERVICE_TYPE_GROUPS.length; ++i) {
                // exclude 'name' if --only-dependencies
                const excludeConfigName = (onlyDependencies) ? name : null;
                // groups are sequential, NOT parallel
                const result = await this.#startNamesFromNonWorkerTypes(
                    ORDERED_SERVICE_TYPE_GROUPS[i],
                    dependencies,
                    excludeConfigName,
                    options);
                allResults.push(...result);
            }
        } else {
            const res = await this.#startByName(name, options);
            allResults.push(res);
        }

        if (onlyDependencies) {
            const ic = this._inv.getConfig(name);
            if (ic.type === 'market') {
                // Special case for Market (a compound abstract service)
                const instance = await this._inv.newInstanceFromName(name);
                assert(instance instanceof Market);
                const startReturn = await instance.start({
                    env: { marker: this._inv.rootDir },
                    onlyDB: true
                });
                allResults.push({ name, instance, startReturn });
            }

            // To prevent error mis-detection in vscode prelaunch tasks
            // ========================================================
            // Problem occurs when starting 2 different debug sessions of 2 different services
            // in vscode. 
            // Remove previous log and pid files since
            // vscode does not output logs in the log file path specified in 
            // the config. Therefore, when prelaunch tasks are running, error detection 
            // is performed using previous log file content.
            this.#rmPidFile(ic.resolved);
            this.#rmLogFile(ic.resolved);
        }

        return allResults;
    }

    /**
     * @param {srvTypes.ServiceConfig} config
     */
    #rmPidFile(config) {
        if (config.type !== 'docker' &&
            config.type !== 'market' &&
            config.type !== 'ipfs') {
            if (config.pidFile) {
                rmFileSync(config.pidFile);
            }
        }
    }

    /**
     * @param {srvTypes.ServiceConfig} config
     */
    #rmLogFile(config) {
        if (config.type !== 'docker' &&
            config.type !== 'market') {
            if (config.logFile) {
                rmFileSync(config.logFile);
            }
        }
    }

    /**
     * @param {{
     *      machine?: string | 'local' | 'default',
     *      hub?: string,
     *      workerIndex: number,
     *      onlyDependencies?: boolean
     *      noDependencies?: boolean
     *      progressCb?: types.progressCallback
     * }} options  
     */
    async startWorker(options) {
        if (!options.machine) {
            options.machine = 'default';
        }
        const hub = this._inv.guessHubAlias(options);
        if (isNullishOrEmptyString(hub)) {
            throw new CodeError(`Invalid worker hub`);
        }
        if (options.workerIndex === undefined || !isPositiveInteger(options.workerIndex)) {
            throw new CodeError(`Invalid worker index`);
        }
        assert(options.workerIndex !== undefined);
        assert(hub !== undefined);

        const onlyDependencies = (options?.onlyDependencies === true);
        const noDependencies = (options?.noDependencies === true);
        if (onlyDependencies && noDependencies) {
            throw new CodeError('Conflicting options (onlyDependencies & noDependencies)');
        }

        const allResults = [];
        const workerName = InventoryDB.computeWorkerName(hub, options.workerIndex);
        if (!noDependencies) {
            const dependencies = this._inv.workerDependencies(
                options.machine, 
                hub, 
                options.workerIndex);
            for (let i = 0; i < ORDERED_SERVICE_TYPE_GROUPS.length; ++i) {
                // groups are sequential, NOT parallel
                const result = await this.#startNamesFromNonWorkerTypes(
                    ORDERED_SERVICE_TYPE_GROUPS[i],
                    dependencies,
                    null,
                    options);
                allResults.push(...result);
            }
        }

        if (!onlyDependencies) {
            const instance = await this._inv.newWorkerInstance(
                options.machine, 
                hub, 
                options.workerIndex);
            const startReturn = await instance.start({
                createDir: true,
                env: { marker: this._inv.rootDir },
                progressCb: options.progressCb,
                context: {
                    hub,
                    workerIndex: options.workerIndex,
                    name: workerName
                }
            });
            allResults.push({ name: workerName, instance, startReturn });
        } else {
            const ic = this._inv.getWorkerConfig(
                options.machine, 
                hub, 
                options.workerIndex);

            // To prevent error mis-detection in vscode prelaunch tasks
            // ========================================================
            // Problem occurs when starting 2 different debug sessions of 2 different services
            // in vscode. 
            // Remove previous log and pid files since
            // vscode does not output logs in the log file path specified in 
            // the config. Therefore, when prelaunch tasks are running, error detection 
            // is performed using previous log file content.
            this.#rmPidFile(ic.resolved);
            this.#rmLogFile(ic.resolved);
        }

        return allResults;
    }

    /**
     * @param {types.StopOptionsWithContext=} options 
     */
    async resetAll(options) {
        // Stops everything, including zombies
        await InventoryRun.stopAny('all', options);

        /** @type {any[]} */
        const promises = [];
        for (let i = 0; i < DB_SERVICE_TYPES.length; ++i) {
            const type = DB_SERVICE_TYPES[i];
            const configs = this._inv.getConfigsByType(type);
            if (!configs) {
                continue;
            }
            for (let j = 0; j < configs.length; ++j) {
                // @ts-ignore
                const resetDBFunc = fromServiceType[type].resetDB;
                if (typeof resetDBFunc === 'function') {
                    await resetDBFunc(configs[j].resolved);
                }
            }
        }

        await Promise.all(promises);
    }

    /**
     * @param {string} name 
     * @param {types.StopOptionsWithContext & {
     *      withDependencies?: boolean
     * }=} options 
     */
    async stop(name, options) {
        return this.#stop(name, options);
    }

    /**
     * @param {srvTypes.ServiceType | 'all'} type 
     * @param {types.StopOptionsWithContext=} options 
     */
    static async stopAny(type, options) {
        const cb = options?.progressCb;

        /** @type {srvTypes.ServiceType[]} */
        const types = [
            'worker',
            'core',
            'blockchainadapter',
            'sms',
            'resultproxy',
            'market',
            'mongo',
            'redis',
            'ganache',
            'ipfs',
        ];

        /**
         * @todo Quick and dirty
         * Not the right algorithm
         * type === 'worker' => types = ['worker']
         * type === 'core' => types = ['worker', 'core']
         * type === 'blockchainadapter' => types = ['worker', 'core', 'blockchainadapter']
         * etc.
         * Missing : should stop corresponding DBs
         */
        if (type !== 'all' && type !== types[types.length - 1]) {
            const pos = types.findIndex(t => t === type);
            if (pos < 0) {
                throw new CodeError(`Invalid type ${type}`);
            }
            types.splice(pos + 1, types.length - (pos + 1));
            assert(types[0] === type);
        }

        if (types.length === 0) {
            return;
        }

        let count = 0;
        const total = types.length;

        cb?.({ count, total, value: { type: types[0] } }); count++;
        for (let i = 0; i < types.length; ++i) {
            if (types[i] === 'docker') {
                continue;
            }
            const theClass = fromServiceType[types[i]];
            // @ts-ignore
            assert(typeof theClass.stopAll === 'function');
            // @ts-ignore
            await theClass.stopAll(null, options ?? {});
            cb?.({ count, total, value: { type: types[i] } }); count++;
        }
    }

    /**
     * @param {types.StopOptionsWithContext=} options 
     */
    static async killAny(options) {
        const cb = options?.progressCb;

        /** @type {srvTypes.ServiceType[]} */
        const types = [
            'worker',
            'core',
            'blockchainadapter',
            'sms',
            'resultproxy',
            'market',
            'mongo',
            'redis',
            'ganache',
            'ipfs',
        ];

        let count = 0;
        const total = types.length;

        cb?.({ count, total, value: { type: types[0] } }); count++;
        for (let i = 0; i < types.length; ++i) {
            if (types[i] === 'docker') {
                continue;
            }
            const theClass = fromServiceType[types[i]];
            await theClass.killAll(null, {});
            cb?.({ count, total, value: { type: types[i] } }); count++;
        }
    }

    /**
     * @param {{
     *      filters?: { 
     *          hub?: string | PoCoHubRef
     *      },
     *      options?: types.StopOptionsWithContext
     * }} args 
     */
    async stopAllWorkers({ filters, options }) {
        let workerFilters;
        // Build worker filters using filters argument
        if (filters?.hub) {
            const ic = this._inv.getConfigFromHub("core", filters.hub);
            if (!ic) {
                return true;
            }
            const coreConf = ic.resolved;
            assert(coreConf.type === 'core');
            assert(coreConf.hostname);
            const coreUrl = 'http://' + hostnamePortToString(coreConf, undefined);
            workerFilters = { coreUrl };
        }
        return WorkerService.stopAll(workerFilters, options ?? {});
    }

    /**
     * @param {string | 'local' | 'default'} machineName 
     * @param {string | PoCoHubRef} hub 
     * @param {number} index 
     * @param {types.StopOptionsWithContext=} options
     */
    async stopWorker(machineName, hub, index, options) {
        return this.#stopWorker(machineName, hub, index, { count: 0, total: 1 }, options);
    }

    /**
     * @param {string | 'local' | 'default'} machineName 
     * @param {string | PoCoHubRef} hub 
     * @param {number} index 
     * @param {{count:number, total:number}} counter
     * @param {types.StopOptionsWithContext=} options
     */
    async #stopWorker(machineName, hub, index, counter, options) {
        const instance = await this._inv.newWorkerInstance(machineName, hub, index);
        assert(instance);

        const workerName = InventoryDB.computeWorkerName(hub, index);
        const stopReturn = await instance.stop(options);

        counter.count++;

        // invoke progress callback
        options?.progressCb?.({
            count: counter.count,
            total: counter.total,
            value: {
                state: 'stopped',
                type: instance.typename(),
                service: instance,
                context: {
                    hub,
                    workerIndex: index,
                    name: workerName
                },
                succeeded: stopReturn.ok,
                error: (!stopReturn.ok) ? stopReturn.error.message : undefined
            }
        });
        return { hub, index, instance, stopReturn };
    }

    /**
     * @param {string} name 
     * @param {{count:number, total:number}} counter
     * @param {types.StopOptionsWithContext=} options
     */
    async #stopByName(name, counter, options) {
        const instance = await this._inv.newInstanceFromName(name);
        assert(instance);

        /** @type {types.StopReturn} */
        const stopReturn = await instance.stop(options);

        // // Reset DBs if needed
        // if (stopReturn.ok) {
        //     if (reset) {
        //         const conf = this._inv.getConfig(name);
        //         // @ts-ignore
        //         const resetDBFunc = fromServiceType[conf.type].resetDB;
        //         if (typeof resetDBFunc === 'function') {
        //             await resetDBFunc(conf.resolved);
        //         }
        //     }
        // }

        counter.count++;

        // invoke progress callback
        options?.progressCb?.({
            count: counter.count,
            total: counter.total,
            value: {
                state: 'stopped',
                type: instance.typename(),
                service: instance,
                context: {
                    name
                },
                succeeded: stopReturn.ok,
                error: (!stopReturn.ok) ? stopReturn.error.message : undefined
            }
        });

        return { name, instance, stopReturn };
    }

    /**
     * @param {string | null} name 
     * @param {types.StopOptionsWithContext & {
     *      withDependencies?: boolean
     * }=} options 
     */
    async #stop(name, options) {

        /** @type {Dependencies | null} */
        let dependencies = null;
        let counter = { count: 0, total: 0 };
        if (!name) {
            // stop all
            counter.total = this._inv.size;
        } else {
            if (options?.withDependencies === true) {
                dependencies = this._inv.dependencies(name);
                // dependencies include 'name' config
                counter.total = dependencies.size;
            } else {
                // only 'name' config
                counter.total = 1;
            }
        }
        assert(counter.total > 0);

        const cb = options?.progressCb;

        // invoke progress callback
        cb?.({
            count: counter.count,
            total: counter.total,
            value: {
                state: 'stopping',
                context: {
                    name
                }
            }
        });

        // No dependencies ? stop a single service
        if (name && !options?.withDependencies) {
            const result = await this.#stopByName(name, counter, options);
            return [result];
        }

        const allResults = [];
        for (let i = ORDERED_SERVICE_TYPE_GROUPS.length - 1; i >= 0; --i) {
            // groups are sequential, NOT parallel
            const result = await this.#stopNonWorkerTypes(
                ORDERED_SERVICE_TYPE_GROUPS[i],
                counter,
                dependencies,
                options);
            allResults.push(...result);
        }

        return allResults;
    }

    /**
     * @param {srvTypes.NonWorkerServiceType[]} types 
     * @param {{count:number, total:number}} counter
     * @param {Dependencies | null} dependencies 
     * @param {types.StopOptionsWithContext=} options 
     */
    async #stopNonWorkerTypes(types, counter, dependencies, options) {
        const promises = [];
        for (let i = 0; i < types.length; ++i) {
            const serviceType = types[i];
            let names;
            if (dependencies) {
                names = dependencies.getConfigNamesArrayFromType(serviceType);
            } else {
                names = this._inv.getConfigNamesFromType(serviceType);
            }
            if (!names) {
                continue;
            }
            for (let j = 0; j < names.length; ++j) {
                const p = this.#stopByName(names[j], counter, options);
                promises.push(p);
            }
        }
        return Promise.all(promises);
    }
}