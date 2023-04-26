import * as srvTypes from '../../services/services-types.js';
import assert from 'assert';
import { Cmd } from "../Cmd.js";
import { Inventory } from '../../services/Inventory.js';
import { fileExistsInDir } from '../../common/fs.js';
import { ConfigFile } from '../../services/ConfigFile.js';
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

export default class PidCmd extends Cmd {

    static cmdname() { return 'pid'; }

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
            if (fileExistsInDir(cliDir, ConfigFile.basename())) {
                // Load inventory from config json file
                inventory = await Inventory.fromConfigFile(cliDir);
            }

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
 * @param {{pid:number, service:?AbstractService}} pidInfo 
 * @param {Inventory=} inventory 
 */
function printIpfsPid(type, pidInfo, inventory) {
    const service = pidInfo.service;
    const pid = pidInfo.pid;
    if (!service) {
        return `${pid}\t???:???\t${type}\n`;
    }
    assert(service instanceof IpfsService);
    return `${pid}\t${service.hostname}:${service.apiPort}\t${service.typename()}\n`;
}

/**
 * @param {string} type 
 * @param {{pid:number, service:?AbstractService}} pidInfo 
 * @param {Inventory=} inventory 
 */
function printDockerPid(type, pidInfo, inventory) {
    // Not supported
    return '';
}

/**
 * @param {string} type 
 * @param {{pid:number, service:?AbstractService}} pidInfo 
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
        `${service.typename()}.AAABBB`;
    const isShared = (name && inventory) ? inventory._inv.isShared(name) : false;
    if (isShared) {
        return `${pid}\t${service.hostname}:${service.port}\t${service.typename()}\n`;
    }
    return '';
}

/**
 * @param {string} type 
 * @param {{
 *      pid: number, 
 *      service: ?AbstractService, 
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

    let s = '';

    s += `${dbPIDs[0]}\t${mongo.hostname}:${mongo.port}\tmongo.${name}\n`;
    s += `${dbPIDs[1]}\t${redis.hostname}:${redis.port}\tredis.${name}\n`;

    s += `${pidInfo.api.pid}\t${api?.hostname}:${api?.port}\tapi.${name}\n`;
    for (let j = 0; j < pidInfo.watchers.length; ++j) {
        const watcher = market.getWatcherFromHub(pidInfo.watchers[j].hub);
        s += `${pidInfo.watchers[j].pid}\t${watcher?.hostname}\twatcher.${name} (hub=${watcher?.hub.hubAlias()})\n`;
    }

    return s;
}

/**
 * @param {string} type 
 * @param {{pid:number, service:?AbstractService}} pidInfo 
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
    const name = (inventory) ?
        inventory._inv.configNameFromHost(service.url) :
        `${service.typename()}.${hubStr}`;
    return `${pid}\t${service.hostname}:${service.port}\t${name}\n`;
}

/**
 * @param {string} type 
 * @param {{pid:number, service:?AbstractService}} pidInfo 
 * @param {Inventory=} inventory 
 */
function printGanachePid(type, pidInfo, inventory) {
    const ganache = pidInfo.service;
    const pid = pidInfo.pid;
    if (!ganache) {
        return `${pid}\t???:???\t${type}\n`;
    }
    assert(ganache instanceof GanachePoCoService);
    return `${pid}\t${ganache.hostname}:${ganache.port}\tganache (chainid=${ganache.chainid})\n`;
}

/**
  * @param {string} type 
  * @param {{pid:number, service:?AbstractService}} pidInfo 
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
    const name = (inventory) ?
        inventory._inv.configNameFromHost(service.url) :
        `${service.typename()}.${hubStr}`;
    const mongo = service.mongo;
    let s = '';
    if (!mongo) {
        s += `???\t???:???\tmongo.${name}\n`;
    } else {
        const mongoPID = await mongo.getPID();
        const mongoPIDStr = (mongoPID === undefined) ? '???' : mongoPID.toString();
        s += `${mongoPIDStr}\t${mongo.hostname}:${mongo.port}\t${mongo.typename()}.${name}\n`;
    }
    s += `${pid}\t${service.hostname}:${service.port}\t${name}\n`;
    return s;
}

/**
  * @param {string} type 
  * @param {{pid:number, service:?AbstractService}} pidInfo 
  * @param {Inventory=} inventory 
  */
function printWorkerPid(type, pidInfo, inventory) {
    const worker = pidInfo.service;
    const pid = pidInfo.pid;
    if (!worker) {
        return `${pid}\t???:???\t${type}\n`;
    }
    assert(worker instanceof WorkerService);
    return `${pid}\t${worker.hostname}:${worker.port}\t${worker.name}\n`;
}
