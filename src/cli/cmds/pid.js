import * as srvTypes from '../../services/services-types.js';
import assert from 'assert';
import { Cmd } from "../Cmd.js";
import { Inventory } from '../../services/Inventory.js';
import { AbstractService, ServerService } from '../../common/service.js';
import { IpfsService } from '../../ipfs/IpfsService.js';
import { PoCoHubRef } from '../../common/contractref.js';
import { Market } from '../../services/Market.js';
import { SmsService } from '../../services/Sms.js';
import { GanachePoCoService } from '../../poco/GanachePoCoService.js';
import { ResultProxyService } from '../../services/ResultProxy.js';
import { CoreService } from '../../services/Core.js';
import { BlockchainAdapterService } from '../../services/BlockchainAdapter.js';
import { WorkerService } from '../../services/Worker.js';
import { PROD_NAME } from '../../common/consts.js';
import { Service } from '../../common/service.js';
import { MongoService } from '../../services/MongoService.js';
import { RedisService } from '../../services/RedisService.js';
import { SpringHubServerService, SpringMongoServerService } from '../../services/spring-serverservice.js';
import { GanacheService } from '../../common/ganache.js';

/**
 * @param {string} s 
 * @param {string} property 
 * @param {any} obj 
 */
function updateMaxLen(s, property, obj) {
    if (s.length > obj[property].len) {
        obj[property].len = s.length;
    }
}

const PID_COL = 5;
const SERVICE_TYPE_COL = 25;
const PAD = 25;
export default class PidCmd extends Cmd {

    static cmdname() { return 'pid'; }

    /** 
     * @type {{ 
     *      type: string, 
     *      pid: string, 
     *      host: string, 
     *      name: string, 
     *      configFile: string 
     *      hub: string 
     *      shared: string[]
     * }[]}
     */
    #pids = [];

    #cols = {
        type: { len: 0 },
        pid: { len: 0 },
        host: { len: 0 },
        name: { len: 0 },
        hub: { len: 0 },
        configFile: { len: 0 },
    }

    /**
     * @param {string} cliDir 
     * @param {srvTypes.ServiceType | 'all'} type 
     * @param {{ 
    *      hub?:string 
    *      chainid?:string 
    * }} options 
    */
    async cliExec(cliDir, type, options) {
        try {
            /** @type {Inventory=} */
            let inventory;
            try {
                const configDir = this.resolveConfigDir(cliDir);
                // Load inventory from config json file
                inventory = await Inventory.fromConfigFile(configDir);
            } catch { }

            /**
             * @type {{
             *      [serviceType:string]: ?{ 
             *          pid: number, 
             *          configFile: string, 
             *          service: ?AbstractService
             *      }[]
             * }}
             */
            let runningServices = {};

            if (type === 'ganache' ||
                type === 'ipfs' ||
                type === 'mongo' ||
                type === 'redis' ||
                type === 'market' ||
                type === 'sms' ||
                type === 'resultproxy' ||
                type === 'blockchainadapter' ||
                type === 'core' ||
                type === 'docker' ||
                type === 'worker'
            ) {
                runningServices = (await Inventory.running(type));
            } else if (type === 'all') {
                runningServices = await Inventory.running('all');
            }

            const entries = Object.entries(runningServices);
            for (const [st, pis] of entries) {
                if (!pis) {
                    this.#pids.push({
                        type: st,
                        pid: '???',
                        host: '???',
                        configFile: '???',
                        name: st,
                        hub: '???',
                        shared: [],
                    });
                    continue;
                }
                for (const pi of pis) {
                    if (pi.service instanceof Market) {
                        const marketpi = Market.toMarketPidInfo(pi);
                        const market = pi.service;
                        const api = market.api;

                        const mongoPID = (await marketpi.service.mongo.getPID())?.toString() ?? '???';
                        const redisPID = (await marketpi.service.redis.getPID())?.toString() ?? '???';
                        const shared = [];
                        if (mongoPID !== '???') {
                            shared.push(mongoPID);
                        }
                        if (redisPID !== '???') {
                            shared.push(redisPID);
                        }

                        this.#pids.push({
                            type: 'market.api',
                            pid: marketpi.api.pid?.toString() ?? '???',
                            host: (api) ? (api.hostname + ':' + api.port) : '???',
                            configFile: pi.configFile,
                            name: 'market.api',
                            hub: (api) ? api.hubs.map(h => h.toHRString(false)).join(',') : '???',
                            shared: [...shared]
                        });

                        for (let i = 0; i < marketpi.watchers.length; ++i) {
                            const w = marketpi.watchers[i];
                            const ws = market.getWatcherFromHub(w.hub);

                            this.#pids.push({
                                type: 'market.watcher',
                                pid: w.pid.toString(),
                                host: (ws) ? ws.hostname : '???',
                                configFile: pi.configFile,
                                name: 'market.watcher',
                                hub: w.hub.toHRString(false),
                                shared: [...shared]
                            });
                        }
                    }

                    const o = {
                        type: st,
                        pid: pi.pid.toString(),
                        host: '???',
                        configFile: pi.configFile,
                        name: st,
                        hub: '',
                        shared: [],
                    };

                    if (pi.service instanceof ServerService) {
                        o.host = pi.service.hostname + ':' + pi.service.port.toString()
                    } else if (pi.service instanceof Service) {
                        o.host = pi.service.hostname;
                    }

                    if (pi.service instanceof SpringHubServerService) {
                        const hub = pi.service.hub;
                        o.hub = (hub) ? hub.toHRString(false) : '???';
                    }
                    if (pi.service instanceof CoreService) {
                        o.name = 'core (wallet #' + pi.service.walletIndex + ')';
                    }
                    if (pi.service instanceof GanacheService) {
                        o.hub = pi.service.chainid.toString();
                    }

                    if (pi.service instanceof WorkerService) {
                        if (pi.service.coreUrl) {
                            const cu = new URL(pi.service.coreUrl);
                            const coreIndex = this.#pids.findIndex((p, i, o) => {
                                return (p.host === cu.host);
                            });
                            if (coreIndex >= 0) {
                                o.hub = this.#pids[coreIndex].hub;
                            }
                        }
                        o.name = 'worker (wallet #' + pi.service.walletIndex + ')';
                    }

                    if (st === 'ipfs') {
                        o.hub = '';
                    }

                    if (st === 'docker') {
                        o.hub = '';
                        if (inventory) {
                            const h = inventory._inv.getDockerHost();
                            o.host = h.hostname + ':' + h.port;
                            o.configFile = inventory._inv.rootDir;
                        }
                    }

                    this.#pids.push(o);
                }
            }

            const mongoSrvTypes = [
                'resultproxy',
                'blockchainadapter',
                'core'
            ];
            for (let i = 0; i < this.#pids.length; ++i) {
                const springMongoServices = runningServices[mongoSrvTypes[i]];
                if (springMongoServices) {
                    for (let j = 0; j < springMongoServices.length; ++j) {
                        const s = springMongoServices[j];
                        assert(s.service instanceof SpringMongoServerService);
                        if (s.service.mongo) {
                            const mongoHost = s.service.mongo.hostname + ':' + s.service.mongo.port;
                            const mongoIndex = this.#pids.findIndex((p, i, o) => {
                                return (p.host === mongoHost);
                            });
                            if (mongoIndex >= 0) {
                                const serviceIndex = this.#pids.findIndex((p, i, o) => {
                                    return (p.pid === s.pid.toString());
                                });
                                this.#pids[serviceIndex].shared.push(this.#pids[mongoIndex].pid.toString());
                                this.#pids[mongoIndex].shared.push(s.pid.toString());
                            }
                        }
                    }
                }
            }

            for (let i = 0; i < this.#pids.length; ++i) {
                const pi = this.#pids[i];
                const pid0 = pi.pid;
                for (let j = 0; j < pi.shared.length; ++j) {
                    const pid1 = pi.shared[j];
                    if (pid1 === '???') {
                        continue;
                    }
                    const serviceIndex = this.#pids.findIndex((p, i, o) => {
                        return (p.pid === pid1);
                    });
                    assert(this.#pids[serviceIndex].pid === pid1);
                    assert(serviceIndex >= 0);
                    const k = this.#pids[serviceIndex].shared.indexOf(pid0);
                    if (k < 0) {
                        this.#pids[serviceIndex].shared.push(pid0);
                    }
                }
            }

            for (const pi of this.#pids) {
                Object.entries(pi).forEach(([col, s]) => {
                    if (typeof s === 'string') {
                        updateMaxLen(s, col, this.#cols);
                    }
                });
            }

            for (const pi of this.#pids) {
                const cols = Object.keys(pi);
                for (let i = 0; i < cols.length; i++) {
                    const c = cols[i];
                    // @ts-ignore
                    const s = pi[c];
                    if (typeof s !== 'string') {
                        continue;
                    }
                    // @ts-ignore
                    const len = this.#cols[c].len;
                    // @ts-ignore
                    pi[c] = s.concat(' '.repeat(len - s.length));
                }
            }

            for (let i = 0; i < this.#pids.length; ++i) {
                const pi = this.#pids[i];
                if (pi.type.trim() === 'market') {
                    continue;
                }

                console.log(`${pi.pid}  ${pi.host}  ${pi.name}  ${pi.hub}  ${pi.configFile}  ${pi.shared.join(',')}`);
            }
        } catch (err) {
            this.exit(options, err);
        }
    }

    /**
     * @param {string} cliDir 
     * @param {srvTypes.ServiceType | 'all'} type 
     * @param {{ 
     *      hub?:string 
     *      chainid?:string 
     * }} options 
     */
    async cliExec2(cliDir, type, options) {
        try {
            /** @type {Inventory=} */
            let inventory;
            try {
                const configDir = this.resolveConfigDir(cliDir);
                // Load inventory from config json file
                inventory = await Inventory.fromConfigFile(configDir);
            } catch { }

            // some funcs are async
            const printFunc = {
                'ipfs': printIpfsPid,
                'ganache': printGanachePid,
                'docker': printDockerPid,
                'mongo': printServerServicePid,
                'redis': printServerServicePid,
                'market': printMarketPid,
                'sms': printSmsPid,
                'resultproxy': printSpringHubServicePid,
                'blockchainadapter': printSpringHubServicePid,
                'core': printSpringHubServicePid,
                'worker': printWorkerPid,
            }

            const promises = [];

            if (type === 'ganache' ||
                type === 'ipfs' ||
                type === 'mongo' ||
                type === 'redis' ||
                type === 'market' ||
                type === 'sms' ||
                type === 'resultproxy' ||
                type === 'blockchainadapter' ||
                type === 'core' ||
                type === 'docker' ||
                type === 'worker'
            ) {
                const pids = (await Inventory.running(type))?.[type];
                if (pids) {
                    for (let i = 0; i < pids.length; ++i) {
                        const pidInfo = pids[i];
                        const p = printFunc[type](type, pidInfo, inventory);
                        promises.push(p);
                    }
                }
            } else if (type === 'all') {
                const runningServices = await Inventory.running('all');
                if (runningServices) {
                    const serviceTypes = Object.keys(runningServices);
                    for (let i = 0; i < serviceTypes.length; ++i) {
                        /** @type {srvTypes.ServiceType} */
                        // @ts-ignore
                        const serviceType = serviceTypes[i];
                        const rsArray = runningServices[serviceType];
                        if (!rsArray || rsArray.length === 0) {
                            continue;
                        } else {
                            for (let j = 0; j < rsArray.length; j++) {
                                const rs = rsArray[j];
                                const p = printFunc[serviceType](serviceType, rs, inventory);
                                promises.push(p);
                            }
                        }
                    }
                }
            }

            const lines = await Promise.all(promises);
            let s = '';
            if (lines && lines.length > 0) {
                s = lines.join('').trim();
            }
            if (s.length === 0) {
                if (type !== 'all') {
                    s = `No ${type} service is running.`;
                } else {
                    s = `No service is running.`;
                }
            }
            console.log(s);
        } catch (err) {
            this.exit(options, err);
        }
    }
}

/**
 * @param {string} type 
 * @param {{pid:number, configFile: string, service:?AbstractService}} pidInfo 
 * @param {Inventory=} inventory 
 */
async function printIpfsPid(type, pidInfo, inventory) {
    const service = pidInfo.service;
    const pid = pidInfo.pid;
    if (!service) {
        if (pidInfo.configFile) {
            return `${pid}\t???.???\t${type} (config=${pidInfo.configFile})\n`;
        }
        return `${pid}\t???:???\t${type}\n`;
    }
    assert(service instanceof IpfsService);
    const b = `${service.typename()}`;
    return `${pid}\t${service.hostname}:${service.apiPort}\t${b.concat(' '.repeat(PAD - b.length))} (config=${pidInfo.configFile})\n`;
}

/**
 * @param {string} type 
 * @param {{pid:number, configFile: string, service:?AbstractService}} pidInfo 
 * @param {Inventory=} inventory 
 */
function printDockerPid(type, pidInfo, inventory) {
    // Not supported
    return '';
}

/**
 * @param {string} type 
 * @param {{pid:number, configFile: string, service:?AbstractService}} pidInfo 
 * @param {Inventory=} inventory 
 */
function printServerServicePid(type, pidInfo, inventory) {
    const service = pidInfo.service;
    const pid = pidInfo.pid;
    if (!service) {
        return `${pid}\t???:???\t${type}\n`;
    }
    assert(service instanceof ServerService);
    const name = (inventory) ?
        inventory._inv.configNameFromHost(service.url) :
        `${service.typename()}`;
    const isShared = (name && inventory) ? inventory._inv.isShared(name) : false;
    if (isShared) {
        const b = `${service.typename()}`;
        return `${pid}\t${service.hostname}:${service.port}\t${b.concat(' '.repeat(PAD - b.length))} (config=${pidInfo.configFile})\n`;
    }
    return '';
}

/**
 * @param {string} type 
 * @param {{
 *      pid: number, 
 *      service: ?AbstractService, 
 *      configFile: string
 *      api?: { pid:number | null }, 
 *      watchers?: {
 *          pid: number,
 *          hub: PoCoHubRef
 *      }[]
 * }} pidInfo 
 * @param {Inventory=} inventory 
 */
async function printMarketPid(type, pidInfo, inventory) {
    assert(pidInfo.api);
    assert(pidInfo.watchers);

    const market = pidInfo.service;
    assert(market instanceof Market);

    const api = market.api;

    let name = 'market.???';
    if (api) {
        if (inventory) {
            name = inventory._inv.configNameFromHost(api.url) ?? name;
        }
    }

    const mongo = market.mongo;
    const redis = market.redis;
    const dbPIDs = await Promise.all([mongo.getPID(), redis.getPID()]);

    const a = `mongo.${market.typename()}`;
    const c = `redis.${market.typename()}`;
    const d = `api.${market.typename()}`;
    const e = `watcher.${market.typename()}`;

    let s = '';

    s += `${dbPIDs[0]}\t${mongo.hostname}:${mongo.port}\t${a.concat(' '.repeat(PAD - a.length))} (config=${pidInfo.configFile})\n`;
    s += `${dbPIDs[1]}\t${redis.hostname}:${redis.port}\t${c.concat(' '.repeat(PAD - c.length))} (config=${pidInfo.configFile})\n`;

    s += `${pidInfo.api.pid}\t${api?.hostname}:${api?.port}\t${d.concat(' '.repeat(PAD - d.length))} (config=${pidInfo.configFile})\n`;
    for (let j = 0; j < pidInfo.watchers.length; ++j) {
        const watcher = market.getWatcherFromHub(pidInfo.watchers[j].hub);
        s += `${pidInfo.watchers[j].pid}\t${watcher?.hostname}\t${e.concat(' '.repeat(PAD - e.length))} (hub=${watcher?.hub.toHRString(false)}, config=${pidInfo.configFile})\n`;
    }

    return s;
}

/**
 * @param {string} type 
 * @param {{pid:number, configFile: string, service:?AbstractService}} pidInfo 
 * @param {Inventory=} inventory 
 */
function printSmsPid(type, pidInfo, inventory) {
    const pid = pidInfo.pid;
    const service = pidInfo.service;
    if (!service) {
        return `${pid}\t???:???\t${type}\n`;
    }
    assert(service instanceof SmsService);
    const hubStr = service.hub?.toHRString(false) ?? '???';
    const b = `${service.typename()}`;
    return `${pid}\t${service.hostname}:${service.port}\t${b.concat(' '.repeat(PAD - b.length))} (hub=${hubStr}, config=${pidInfo.configFile})\n`;
}

/**
 * @param {string} type 
 * @param {{pid:number, configFile: string, service:?AbstractService}} pidInfo 
 * @param {Inventory=} inventory 
 */
function printGanachePid(type, pidInfo, inventory) {
    const ganache = pidInfo.service;
    const pid = pidInfo.pid;
    if (!ganache) {
        return `${pid}\t???:???\t${type} (config=${pidInfo.configFile})\n`;
    }
    assert(ganache instanceof GanachePoCoService);
    const b = `${ganache.typename()}`;
    return `${pid}\t${ganache.hostname}:${ganache.port}\t${b.concat(' '.repeat(PAD - b.length))} (chainid=${ganache.chainid}, config=${pidInfo.configFile})\n`;
}

/**
  * @param {string} type 
  * @param {{pid:number, configFile: string, service:?AbstractService}} pidInfo 
  * @param {Inventory=} inventory 
  */
async function printSpringHubServicePid(type, pidInfo, inventory) {
    const pid = pidInfo.pid;
    const service = pidInfo.service;
    if (!service) {
        return `${pid}\t???:???\t${type}\n`;
    }
    assert(service instanceof ResultProxyService ||
        service instanceof CoreService ||
        service instanceof BlockchainAdapterService);
    const hubStr = service.hub?.toHRString(false) ?? '???';
    const a = `mongo.${service.typename()}`;
    const b = `${service.typename()}`;
    let s = '';
    const mongo = service.mongo;
    if (!mongo) {
        s += `???\t???:???\t${a.concat(' '.repeat(PAD - a.length))} (hub=${hubStr}, config=${pidInfo.configFile})\n`;
    } else {
        const mongoPID = await mongo.getPID();
        const mongoPIDStr = (mongoPID === undefined) ? '???' : mongoPID.toString();

        s += `${mongoPIDStr}\t${mongo.hostname}:${mongo.port}\t${a.concat(' '.repeat(PAD - a.length))} (hub=${hubStr}, config=${pidInfo.configFile})\n`;
    }
    s += `${pid}\t${service.hostname}:${service.port}\t${b.concat(' '.repeat(PAD - b.length))} (hub=${hubStr}, config=${pidInfo.configFile})\n`;
    return s;
}

/**
  * @param {string} type 
  * @param {{pid:number, configFile: string, service:?AbstractService}} pidInfo 
  * @param {Inventory=} inventory 
  */
function printWorkerPid(type, pidInfo, inventory) {
    const worker = pidInfo.service;
    const pid = pidInfo.pid;
    if (!worker) {
        return `${pid}\t???:???\t${type} (hub=???, config=${pidInfo.configFile})\n`;
    }
    assert(worker instanceof WorkerService);
    const b = `${worker.name}`;
    return `${pid}\t${worker.hostname}:${worker.port}\t${b.concat(' '.repeat(PAD - b.length))} (hub=???, config=${pidInfo.configFile})\n`;
}
