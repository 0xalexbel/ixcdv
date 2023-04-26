/** 
@typedef {import('@ethersproject/bytes').Hexable} Hexable
*/

/**
 * @typedef {"app" | "dataset" | "workerpool" | "request"} iExecObjectType
 */

import { PoCoHubRef } from './contractref.js';

/**
 * @typedef {{ok:true}} Succeeded
 * @typedef {{ok:false}} Failed
 */

/**
 * @template R
 * @typedef {Succeeded & {result:R}} Result<R>
 */

/**
 * @template E
 * @typedef { Failed & {error:E}} FailedError<E>
 */

/**
 * @typedef {FailedError<import('./error.js').CodeError>} FailedCodeError
 */

/**
 *  { ok:true }
 *  { ok:false, error:E }
 * @template E
 * @typedef {Succeeded | FailedError<E>} OkOrError<E>
 */

/**
 * @typedef {OkOrError<import('./error.js').CodeError>} OkOrCodeError
 */


/**
 *  { ok:true, result:R }
 *  { ok:false, error:E }
 * @template R, E
 * @typedef {Result<R> | FailedError<E>} ResultOrError<R,E>
 */

/**
 * @template R
 * @typedef {ResultOrError<R,import('./error.js').CodeError>} ResultOrCodeError<R>
 */

/**
 * @template E 
 * @typedef {Promise<OkOrError<E>>} PromiseOkOrError<E>
 */

/**
 * @typedef {Promise<OkOrCodeError>} PromiseOkOrCodeError
 */

/**
 * @template R, E 
 * @typedef {Promise<ResultOrError<R,E>>} PromiseResultOrError<R,E>
 */

/**
 * @template R
 * @typedef {Promise<ResultOrCodeError<R>>} PromiseResultOrCodeError<R>
 */

/**
 * @typedef {{ strict?: boolean }} Strict
 */

/**
 * @typedef {(boolean | Strict)} StrictLike
 */

/**
 * @template T
 * @typedef {(Strict & T)} StrictOptions<T>
 */

/** @typedef {number} positiveInteger */

/**
An `Address` is a `DataHexString` of 20 bytes (40 nibbles),
with optional mixed case.

If the case is mixed, it is a `Checksum Address`, which uses 
a specific pattern of uppercase and lowercase letters within 
a given address to reduce the risk of errors introduced 
from typing an address or cut and paste issues.

All functions that return an `Address` will 
return a `Checksum Address`. 
@typedef {string} address
@typedef {string} checksumaddress
*/

/**
A Raw Signature is a common Signature format where 
the r, s and v are concatenated into a 65 bytes (130 nibble) 
DataHexString.
@typedef {DataHexString} RawSignature65
*/

/**
- Specs: 
    - `/^0x[0-9A-Fa-f]*$/` 
    - `/^0x[[:xdigit:]]*$/`
    - length = even 
- A DataHexstring is identical to a HexString except that it 
has an even number of nibbles, and therefore is a valid 
representation of binary data as a string.
@typedef {string} DataHexString
*/

/**
 * @typedef {{
 *      hostname?: string
 *      logFile?: string
 *      pidFile?: string
 * }} ServiceArgs
 *
 * @typedef {{
 *      hostname?: string
 *      port:number,
 *      protocol?:string,
 *      logFile?: string
 *      pidFile?: string
 * }} ServerServiceArgs
 *  
 *
 * @typedef {StartOptions & {strict?: boolean, context?:any}} StartOptionsWithContext 
 * @typedef {StopOptions & {strict?: boolean, context?:any}} StopOptionsWithContext
 * 
 * @typedef StartOptions
 * @type {object}
 * @property {boolean=} quiet
 * @property {boolean=} killIfFailed
 * @property {boolean=} createDir
 * @property {AbortSignal=} abortSignal
 * @property {progressCallback=} progressCb
 */

/**
    @typedef {{
        quiet?:boolean,
        abortSignal?: AbortSignal,
        reset?: boolean
        progressCb?: progressCallback 
    }} StopOptions
*/

/**
 * @typedef {(
 *      (Succeeded & {pid?:number, context?:any}) | FailedCodeError
 * )} StartReturn  
 * 
 * @typedef {(
 *      (Succeeded & {pid?:number, context?:any}) | FailedCodeError
 * )} StopReturn  
 *
 * @typedef IStoppable
* @type {object}
* @property {(options?:StopOptionsWithContext) => Promise<StopReturn>} stop
*
* @typedef {ServerServiceArgs & 
* {
*      mnemonic:string,
*      chainid:number,
*      dbPath:string
* }} GanacheServiceArgs
*/

/**
* @typedef {(
*         'ERC1538Proxy' | 
*         'RLC' |
*         'ERLCTokenSwap'|
*         'AppRegistry'|
*         'DatasetRegistry'|
*         'WorkerpoolRegistry'|
*         'ENSRegistry' |
*         'PublicResolver'
* )} PoCoContractName
*/

/**
 * @typedef {(
 *         'Workerpool'
 * )} ExtraPoCoContractName
 */
    
/**
 * @typedef ContractRefLike
 * @type {object}
 * @property {!number} chainid
 * @property {string=} address
 * @property {string=} contractName
 * @property {?(URL | string)=} url
 */

/**
 * @typedef {ContractRefLike & {deployConfigName?: string}} DevContractRefLike
 */

/**
 * @typedef PoCoContractRefLike
 * @type {object}
 * @property {!number} chainid
 * @property {string=} address
 * @property {PoCoContractName} contractName
 * @property {?(URL | string)=} url
 * @property {string=} deployConfigName
 */

/**
 * @typedef PoCoHubRefLike
 * @type {object}
 * @property {!number} chainid
 * @property {string=} address
 * @property {'ERC1538Proxy'} contractName
 * @property {?(URL | string)=} url
 * @property {string=} deployConfigName
 * @property {('Token' | 'Native')} asset
 * @property {boolean=} kyc
 * @property {boolean=} uniswap
 */

/**
 * @typedef ResolvedPoCoHub
 * @type {object}
 * @property {!number} chainid
 * @property {!string} address
 * @property {'ERC1538Proxy'} contractName
 * @property {!('Token' | 'Native')} asset
 * @property {!boolean} kyc
 * @property {!boolean} uniswap
 */

/**
 * @typedef {{
*      chainid: number,
*      deployConfigName?: string,
*      address?: string,
*      url?: string,
*      contractName?: PoCoContractName, 
* }} PoCoContractRefArgs
* 
* @typedef {PoCoContractRefArgs & 
* {
*      asset?: 'Token' | 'Native',
*      kyc?: boolean,
*      uniswap?: boolean,
* }} PoCoHubRefArgs
*
* @typedef {string | PoCoHubRefArgs | PoCoContractRefArgs } PoCoRefArgsLike 
*/

/**
 * @typedef {{
 *      ganacheDBUUID: string,
 *      hub: ResolvedPoCoHub,
 * }} DBHubSignature
 */

/**
 * @typedef {{[name:string]: {
 *   serviceType: string, 
 *   signature: any
 * }}} DBSignatureDict
 */

/**
 * @typedef {{ 
*      serviceType: string,
*      signature: any
*  }} DBSignatureItem
*/

/**
 * @typedef {{ 
 *      name: string, 
 *      serviceType: string,
 *      signature: any
 *  }} DBSignatureArg
 */

/**
 * @callback progressCallback
 * @param {{
 *      count: number 
 *      total: number 
 *      value: any 
 * }} args 
 * @returns {void}
 */

/**   
 * @typedef {{
*      type: 'ipfs',
*      hostname?: string,
*      directory?: string,
*      gatewayPort: number,
*      apiPort: number,
*      logFile?: string, 
* }} IpfsConfig
*/

/**
   @typedef Package
   @type {object}
     @property {!string} directory
     @property {!('never' | 'ifmissing')=} clone
     @property {!string=} cloneRepo
     @property {!boolean=} patch
     @property {!string=} gitHubRepoName
     @property {(string | null)=} commitish 
     @property {!Object<string, (string | Package)>=} dependencies
 */

// Does nothing but required for TypeScript to import this file.
export { }