import * as srvTypes from '../../services/services-types.js';
import assert from 'assert';
import { Cmd } from "../Cmd.js";
import { Inventory } from '../../services/Inventory.js';
import { AbstractService, ServerService } from '../../common/service.js';
import { Market } from '../../services/Market.js';
import { CoreService } from '../../services/Core.js';
import { WorkerService } from '../../services/Worker.js';
import { Service } from '../../common/service.js';
import { SpringHubServerService, SpringMongoServerService } from '../../services/spring-serverservice.js';
import { GanacheService } from '../../common/ganache.js';

/**
 * @param {string} s 
 * @param {string} property 
 * @param {any} obj 
 */
function updateMaxLen(s, property, obj) {
    if (obj[property].len === 0) {
        obj[property].len = obj[property].header.length;
    }
    if (s.length > obj[property].len) {
        obj[property].len = s.length;
    }
}

/**
 @typedef {{
    type: string,
    pid: string,
    host: string,
    configFile: string,
    name: string,
    hub: string,
    shared: string[],
 }} PidLine
 */

const UNKNOWN = '??';
export default class PidCmd extends Cmd {

    static cmdname() { return 'pid'; }

    /** 
     * @type {PidLine[]}
     */
    #pids = [];

    #cols = {
        type: { len: 0, header: 'TYPE' },
        pid: { len: 0, header: 'PID' },
        host: { len: 0, header: 'HOST' },
        name: { len: 0, header: 'NAME' },
        hub: { len: 0, header: 'CHAINID/HUB' },
        configFile: { len: 0, header: 'CONFIG DIR' },
        shared: { len: 0, header: 'DEPS' },
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

            // Compute running services infos
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

            let countIExecServices = 0;
            const entries = Object.entries(runningServices);
            for (const [st, pis] of entries) {
                if (!pis) {
                    // empty service = no running services of a given type
                    this.#pids.push({
                        type: st,
                        pid: UNKNOWN,
                        host: UNKNOWN,
                        configFile: UNKNOWN,
                        name: st,
                        hub: UNKNOWN,
                        shared: [],
                    });
                    continue;
                }

                for (const pi of pis) {
                    countIExecServices++;
                    // Special case for market
                    // - handle mongo + redis
                    // - handle api service
                    // - handle watcher services
                    if (pi.service instanceof Market) {
                        const marketpi = Market.toMarketPidInfo(pi);
                        const market = pi.service;
                        const api = market.api;

                        const mongoPID = (await marketpi.service.mongo.getPID())?.toString() ?? UNKNOWN;
                        const redisPID = (await marketpi.service.redis.getPID())?.toString() ?? UNKNOWN;
                        const shared = [];
                        if (mongoPID !== UNKNOWN) {
                            shared.push(mongoPID);
                        }
                        if (redisPID !== UNKNOWN) {
                            shared.push(redisPID);
                        }

                        this.#pids.push({
                            type: 'market.api',
                            pid: marketpi.api.pid?.toString() ?? UNKNOWN,
                            host: (api) ? (api.hostname + ':' + api.port) : UNKNOWN,
                            configFile: pi.configFile,
                            name: 'market.api',
                            hub: (api) ? api.hubs.map(h => h.toHRString(false)).join(',') : UNKNOWN,
                            shared: [...shared]
                        });

                        for (let i = 0; i < marketpi.watchers.length; ++i) {
                            const w = marketpi.watchers[i];
                            const ws = market.getWatcherFromHub(w.hub);

                            this.#pids.push({
                                type: 'market.watcher',
                                pid: w.pid.toString(),
                                host: (ws) ? ws.hostname : UNKNOWN,
                                configFile: pi.configFile,
                                name: 'market.watcher',
                                hub: w.hub.toHRString(false),
                                shared: [...shared]
                            });
                        }
                        continue;
                    }

                    // Compute :
                    // - host
                    // - hub
                    // - name

                    /**
                     * @type {PidLine}
                     */
                    const o = {
                        type: st,
                        pid: pi.pid.toString(),
                        host: UNKNOWN,
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
                        o.hub = (hub) ? hub.toHRString(false) : UNKNOWN;
                    }
                    if (pi.service instanceof CoreService) {
                        o.name = 'core (wallet #' + pi.service.walletIndex + ')';
                    }
                    if (pi.service instanceof GanacheService) {
                        o.hub = pi.service.chainid.toString();
                    }

                    // Special case for worker
                    // - compute wallet index 
                    // - compute 
                    if (pi.service instanceof WorkerService) {
                        if (pi.service.coreUrl) {
                            const cu = new URL(pi.service.coreUrl);
                            const coreIndex = this.#pids.findIndex((p, i, o) => {
                                return (p.host === cu.host);
                            });
                            if (coreIndex >= 0) {
                                o.hub = this.#pids[coreIndex].hub;
                                o.shared.push(this.#pids[coreIndex].pid);
                            }
                        }
                        o.name = 'worker (wallet #' + pi.service.walletIndex + ')';
                    }

                    if (st === 'ipfs') {
                        o.hub = '';
                    }

                    if (st === 'docker') {
                        // ignore docker as a 'relevant' iexec service
                        countIExecServices--;
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

            if (countIExecServices === 0) {
                console.log('No service is running.');
                return;
            }

            // Compute shared PIDs
            // - resultproxy <-> mongo
            // - blockchainadapter <-> mongo
            // - core <-> mongo
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

            // Compute reflexive shared PIDs
            // - Deps(PID0) = PID1
            // - Deps(PID1) = PID0
            for (let i = 0; i < this.#pids.length; ++i) {
                const pi = this.#pids[i];
                const pid0 = pi.pid;
                for (let j = 0; j < pi.shared.length; ++j) {
                    const pid1 = pi.shared[j];
                    if (pid1 === UNKNOWN) {
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

            // Convert arrays to strings
            for (const pi of this.#pids) {
                Object.entries(pi).forEach(([col, s]) => {
                    if (typeof s !== 'string') {
                        assert(Array.isArray(s));
                        // @ts-ignore
                        pi.shared = s.join(',')
                    }
                });
            }

            // Compute column width
            for (const pi of this.#pids) {
                Object.entries(pi).forEach(([col, s]) => {
                    if (typeof s === 'string') {
                        updateMaxLen(s, col, this.#cols);
                    }
                });
            }

            // Format column headers
            Object.entries(this.#cols).forEach(([type, col]) => {
                const s = col.header;
                col.header = s.concat(' '.repeat(col.len - s.length));
            });
            // Print column headers
            console.log(`${this.#cols.pid.header}  ${this.#cols.host.header}  ${this.#cols.name.header}  ${this.#cols.hub.header}  ${this.#cols.configFile.header}  ${this.#cols.shared.header}`);

            // Format strings (fill with whitespaces)
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

            // Print lines
            for (let i = 0; i < this.#pids.length; ++i) {
                const pi = this.#pids[i];
                // Do not print 'market', only 'market.api' + 'market.watcher'
                if (pi.type.trim() === 'market') {
                    continue;
                }

                console.log(`${pi.pid}  ${pi.host}  ${pi.name}  ${pi.hub}  ${pi.configFile}  ${pi.shared}`);
            }
        } catch (err) {
            this.exit(options, err);
        }
    }
}

