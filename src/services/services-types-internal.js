import * as types from '../common/common-types.js';
import * as pocoTypes from '../poco/poco-types.js';
import * as srvTypes from './services-types.js';

/**
 * @typedef {types.ServerServiceArgs & 
 * {
 *      repoDir?:string,
 *      ymlConfig?:any,
 *      applicationYmlHash?: string
 *      springConfigLocation?: string
 * }} SpringServerServiceConstructorArgs
 */

/**
 * @typedef {SpringServerServiceConstructorArgs & 
 * {
 *      hub?: import('../common/contractref.js').PoCoHubRef 
 *      DBUUID?: string
 * }} SpringHubServerServiceConstructorArgs
 */

/** 
 * @template T
 * @typedef {types.StrictOptions<T>} StrictOptions 
 */

/** @typedef {types.PromiseOkOrCodeError} PromiseOkOrCodeError */

/** 
 * @template R
 * @typedef {types.PromiseResultOrCodeError<R>} PromiseResultOrCodeError<R> 
 */

/** 
    @typedef { InventoryNonWorkerConfig | InventoryWorkerConfig } InventoryConfig
 */

/** 
    @typedef {InventoryIpfsConfig | 
        InventoryGanacheConfig | 
        InventoryDockerConfig | 
        InventoryRedisConfig | 
        InventoryMongoConfig |
        InventoryMarketConfig |
        InventorySmsConfig |
        InventoryResultProxyConfig |
        InventoryBlockchainAdapterConfig |
        InventoryCoreConfig
    } InventoryNonWorkerConfig
 */

/** 
 * @typedef {{ 
 *      name: string, 
 *      type: 'ganache', 
 *      unsolved: pocoTypes.GanachePoCoServiceConfig, 
 *      resolved: pocoTypes.GanachePoCoServiceConfig 
 * }} InventoryGanacheConfig
 */

/** 
 * @typedef {{ 
 *      name: string, 
 *      type: 'market', 
 *      unsolved: srvTypes.MarketConfig, 
 *      resolved: srvTypes.MarketConfig 
 * }} InventoryMarketConfig
 */

/** 
 * @typedef {{ 
 *      name: string, 
 *      type: 'ipfs', 
 *      unsolved: types.IpfsConfig, 
 *      resolved: types.IpfsConfig 
 * }} InventoryIpfsConfig
 */

/** 
    @typedef {{ 
        name: string, 
        type: 'mongo', 
        unsolved: srvTypes.MongoConfig, 
        resolved: srvTypes.MongoConfig 
    }} InventoryMongoConfig
 */

/** 
    @typedef {{ 
        name: string, 
        type: 'redis', 
        unsolved: srvTypes.RedisConfig, 
        resolved: srvTypes.RedisConfig 
    }} InventoryRedisConfig
 */

/** 
    @typedef {{ 
        name: string, 
        type: 'sms', 
        unsolved: srvTypes.SmsConfig, 
        resolved: srvTypes.SmsConfig 
    }} InventorySmsConfig
 */

/** 
    @typedef {{ 
        name: string, 
        type: 'resultproxy', 
        unsolved: srvTypes.ResultProxyConfig, 
        resolved: srvTypes.ResultProxyConfig 
    }} InventoryResultProxyConfig
 */

/** 
    @typedef {{ 
        name: string, 
        type: 'blockchainadapter', 
        unsolved: srvTypes.BlockchainAdapterConfig, 
        resolved: srvTypes.BlockchainAdapterConfig 
    }} InventoryBlockchainAdapterConfig
 */

/** 
    @typedef {{ 
        name: string, 
        type: 'core', 
        unsolved: srvTypes.CoreConfig, 
        resolved: srvTypes.CoreConfig 
    }} InventoryCoreConfig
 */

/** 
 * @typedef {{ 
 *      name: string, 
 *      type: 'docker', 
 *      unsolved: srvTypes.DockerConfig, 
 *      resolved: srvTypes.DockerConfig 
 * }} InventoryDockerConfig
 */

/** 
  * @typedef {{ 
  *      index: number, 
  *      hub: string,
  *      type: 'worker', 
  *      unsolved: srvTypes.WorkerConfig, 
  *      resolved: srvTypes.WorkerConfig 
  * }} InventoryWorkerConfig
  */

/** 
  * @typedef {{ 
  *      type: 'iexecsdk', 
  *      unsolved: srvTypes.IExecSdkConfig, 
  *      resolved: srvTypes.IExecSdkConfig 
  * }} InventoryIExecSdkConfig
  */

/** 
  * @typedef {{ 
  *     resolve: (refLike: string | types.DevContractRefLike) => Promise<{ PoCoHubRef: import('../common/contractref.js').PoCoHubRef, service: import('../poco/GanachePoCoService.js').GanachePoCoService }>
  *     newInstanceFromHost: (host: string) => Promise<any>
  *     newInstanceFromHub: (type: "ganache" | "market" | "sms" | "resultproxy" | "blockchainadapter" | "core", hub: string) => Promise<any>
  *     getDockerHost : () => { hostname: string, port: number }
  *     getIpfsApiHost : () => { hostname: string, port: number }
  *     getHubFromHost : (host: string | URL) => string
  *     getHubServiceURL: (type: 'ganache' | 'sms' | 'blockchainadapter' | 'resultproxy' | 'core' | 'market', hub: string | import('../common/contractref.js').PoCoHubRef) => URL
  *     getChainids: () => Promise<Map<number, import('../poco/GanachePoCoService.js').GanachePoCoService> | undefined>
  * }} InventoryLike
  */

export * from './services-types.js'