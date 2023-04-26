import * as types from "../common/common-types.js";
import * as pocoTypes from "../poco/poco-types.js";

/** 
 * @typedef { pocoTypes.GanachePoCoServiceConfig | 
 *      types.IpfsConfig | 
 *      DockerConfig | 
 *      MongoConfig | 
 *      RedisConfig | 
 *      MarketConfig | 
 *      SmsConfig     | 
 *      ResultProxyConfig       | 
 *      BlockchainAdapterConfig | 
 *      CoreConfig    | 
 *      WorkerConfig  
 * } ServiceConfig
 */

/** 
 * @typedef { pocoTypes.GanachePoCoServiceConfig | 
 *      types.IpfsConfig | 
 *      DockerConfig | 
 *      MongoConfig | 
 *      RedisConfig | 
 *      MarketConfig | 
 *      SmsConfig     | 
 *      ResultProxyConfig       | 
 *      BlockchainAdapterConfig | 
 *      CoreConfig
 * } NonWorkerServiceConfig
 */

/** 
 * @typedef { SmsConfig     | 
 *      ResultProxyConfig       | 
 *      BlockchainAdapterConfig | 
 *      CoreConfig    | 
 *      WorkerConfig  
 * } SpringServiceConfig
 */

/** 
 * @typedef { pocoTypes.GanachePoCoServiceConfig | 
 *      types.IpfsConfig | 
 *      DockerConfig | 
 *      MongoConfig | 
 *      RedisConfig | 
 *      MarketConfig
 * } SharedServiceConfig
 */

/** 
 * @typedef { MarketConfig |
 *      SpringServiceConfig
 * } RepositoryServiceConfig
 */

/** 
 * @typedef { 'ganache' | 
 *      'ipfs' | 
 *      'docker'  | 
 *      'mongo'   | 
 *      'redis'   | 
 *      'market'  | 
 *      'sms'     | 
 *      'resultproxy'       | 
 *      'blockchainadapter' | 
 *      'core'    | 
 *      'worker'  
 * } ServiceType
 */

/** 
 * @typedef { 'ganache' | 
 *      'ipfs' | 
 *      'docker'  | 
 *      'mongo'   | 
 *      'redis'   | 
 *      'market'  | 
 *      'sms'     | 
 *      'resultproxy'       | 
 *      'blockchainadapter' | 
 *      'core'
 * } NonWorkerServiceType
 */

/** 
 * @typedef { 'ganache' | 
 *      'ipfs' | 
 *      'docker'  | 
 *      'mongo'   | 
 *      'redis'   | 
 *      'market'
 * } SharedServiceType
 */

/** 
 * @typedef { 'sms' |
 *      'resultproxy'       | 
 *      'blockchainadapter' | 
 *      'core'    | 
 *      'worker'  
 * } SpringServiceType
 */

/** 
 * @typedef { 'ganache' |
 *      'ipfs' |
 *      'sms' |
 *      'market' |
 *      'mongo' |
 *      'redis'  
 * } DBServiceType
 */

/** 
 * @typedef { 'sms' |
 *      'resultproxy'       | 
 *      'blockchainadapter' | 
 *      'core'
 * } ChainServiceType
 */

/** @param {ServiceType} t */
export const toNonWorkerServiceType = t => /** @type {NonWorkerServiceType} */(/** @type {any} */ t);

/** 
 * @template T
 * @typedef {{
 *   ganache?: T
 *   ipfs?: T
 *   docker?: T
 *   mongo?: T
 *   redis?: T
 *   market?: T
 *   sms?: T
 *   resultproxy?: T
 *   blockchainadapter?: T
 *   core?: T
 *   worker?: T
 * }} OptionalServiceTypes<T>
 */

/** 
 * @template T
 * @typedef {{
 *   ganache: T
 *   ipfs: T
 *   docker: T
 *   mongo: T
 *   redis: T
 *   market: T
 *   sms: T
 *   resultproxy: T
 *   blockchainadapter: T
 *   core: T
 *   worker: T
 * }} ServiceTypes<T>
 */

/**   
 * @typedef {types.ServerServiceArgs & {
 *      type: 'mongo',
 *      directory?: string, 
 * }} MongoConfig
 */

/**   
 * @typedef {types.ServerServiceArgs & {
 *      type: 'redis',
 *      directory?: string, 
 * }} RedisConfig
 */

/**   
 * @typedef {types.ServerServiceArgs & {
 *      type: 'sms',
 *      repository: (string | types.Package),
 *      hub: string, 
 *      springConfigLocation: string,
 *      ymlConfig: any,
 *      dbDirectory: string, 
 * }} SmsConfig
 */

/**   
 * @typedef {types.ServerServiceArgs & {
 *      type: 'resultproxy',
 *      repository: (string | types.Package),
 *      hub: string, 
 *      springConfigLocation: string,
 *      ymlConfig: any,
 *      mongoHost: string
 *      mongoDBName: string
 *      ipfsHost: string
 * }} ResultProxyConfig
 */

/**   
 * @typedef {types.ServerServiceArgs & {
 *      type: 'blockchainadapter',
 *      repository: (string | types.Package),
 *      hub: string, 
 *      springConfigLocation: string,
 *      ymlConfig: any,
 *      mongoHost: string
 *      mongoDBName: string
 *      marketApiUrl: string
 *      walletIndex: number
 * }} BlockchainAdapterConfig
 */

/**   
 * - ipfsHost (optional: if undefined, pick a running service)
 * - smsUrl (optional: if undefined, pick a running service)
 * - resultproxyUrl (optional: if undefined, pick a running service)
 * - blockchainAdapterUrl (optional: if undefined, pick a running service)
 * - walletIndex (optional, if undefined, use workerpool default wallet)
 * @typedef {types.ServerServiceArgs & {
 *      type: 'core',
 *      repository: (string | types.Package),
 *      hub: string, 
 *      springConfigLocation: string,
 *      ymlConfig: any,
 *      mongoHost: string
 *      mongoDBName: string
 *      ipfsHost?: string
 *      smsUrl?: string
 *      resultProxyUrl?: string
 *      blockchainAdapterUrl?: string
 *      walletIndex?: number
 * }} CoreConfig
 */

/**   
 * - coreUrl (optional: if undefined, pick a running service)
 * @typedef {types.ServerServiceArgs & {
 *      type: 'worker',
 *      repository: (string | types.Package),
 *      springConfigLocation: string,
 *      ymlConfig: any,
 *      name: string
 *      directory: string
 *      coreUrl?: string
 *      dockerHost: string
 *      walletIndex: number
 * }} WorkerConfig
 */

/**   
 * @typedef {{
 *      type: 'docker',
 *      hostname?: string
 *      port: number
 * }} DockerConfig
 */

/**   
 * @typedef {{
 *      type: 'market',
 *      repository: (string | types.Package),
 *      directory?: string, 
 *      mongo: { hostname?: string, port: number, directory?: string }
 *      redis: { hostname?: string, port: number, directory?: string }
 *      api: { hostname?: string, port: number, chains:(string | import('../common/contractref.js').PoCoHubRef)[] }
 *      watchers?: (string | (string | types.PoCoHubRefLike | { logFile?: string, hub: types.PoCoHubRefLike })[]) 
 * }} MarketConfig
 */

/**   
 * @typedef {{
 *      type: 'iexecsdk',
 *      repository: string | types.Package,
 *      chainsJsonLocation: string,
 * }} IExecSdkConfig
 */

// Does nothing but required for TypeScript to import this file.
export { }