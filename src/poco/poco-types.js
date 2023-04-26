import * as types from '../common/common-types.js';

/**
 * @typedef {{
 *      chainid:number
 *      host:string
 *      kyc: boolean,
 *      asset: 'Token' | 'Native',
 *      uniswap: boolean,
 *      contracts: PoCoContracts
 * }} PoCoHub
 */

/**
 * @typedef {{
 *          ERC1538Proxy?:string
 *          RLC?:string
 *          ERLCTokenSwap?:string  
 *          AppRegistry?:string
 *          DatasetRegistry?:string
 *          WorkerpoolRegistry?:string
 *          ENSRegistry?:string
 *          PublicResolver?:string
 * }} PoCoContracts
 */

/**
 * @typedef {{
 *          Workerpool?:string
 * }} ExtraPoCoContracts
 */

/**
 * @typedef { PoCoNativeConfig   | 
 *            PoCoStandardConfig | 
 *            PoCoUniswapConfig  | 
 *            PoCoEnterpriseConfig } PoCoConfig
 */

/**
* @typedef {{
*      asset: 'Token' | 'Native',
*      kyc?: boolean,
*      uniswap?: boolean,
*      AppRegistry?: string,
*      DatasetRegistry?: string,
*      WorkerpoolRegistry?: string,
*      salt?: string
*      proxySalt?: string
* }} PoCoConfigBase
*/

/**
* @typedef {PoCoConfigBase & {
*      asset: 'Native',
*      kyc?: false,
*      uniswap?: false,
* }} PoCoNativeConfig
*/

/**
* @typedef {PoCoConfigBase & {
*      asset: 'Token',
*      token?: string
* }} PoCoTokenConfig
*/

/**
* @typedef {PoCoTokenConfig & {
*      kyc?: false,
*      uniswap?: false,
*      etoken?: undefined
* }} PoCoStandardConfig
*/

/**
* @typedef {PoCoTokenConfig & {
*     kyc?: false 
*     uniswap: true
*     etoken?: undefined
* }} PoCoUniswapConfig
*/

/**
* @typedef {PoCoTokenConfig & {
*      kyc: true,
*      uniswap?: false,
*      etoken?: string
* }} PoCoEnterpriseConfig
*/

/**
 * - proxySalt value must be unique
 * - Same salt value => same Registry addresses
 * @typedef {{
 *      name: string,
 *      asset: 'Token' | 'Native',
 *      kyc?: boolean,
 *      uniswap?: boolean,
 *      token?: string,
 *      etoken?: string,
 *      AppRegistry?: string,
 *      DatasetRegistry?: string,
 *      WorkerpoolRegistry?: string,
 *      salt?: string
 *      proxySalt?: string
 *      WorkerpoolAccountIndex: number, 
 *      WorkerpoolDescription: string
 *      Workerpool?: string 
 * }} PoCoDeployConfig
 */

/**
 * @typedef {{
 *      PoCo?: string | types.Package,
 *      mnemonic: string,
 *      chainid: number,
 *      deploySequence: PoCoDeployConfig[],
 *      addresses?: {
 *          [configName:string]: PoCoContracts
 *      }
 *      extraaddresses?: {
 *          [configName:string]: ExtraPoCoContracts
 *      }
 * }} PoCoChainConfig
 * 
 * @typedef {types.ServiceArgs & 
 * {
 *      storageDir: string,
 *      PoCoDir: string,
 *      config: PoCoChainConfig,
 * }} GanachePoCoServiceOptions
 */

/**
  @typedef {types.ServerServiceArgs & 
    {
        type: "ganache",
        directory: string,
        config: {
            PoCo?: string | types.Package,
            mnemonic: string,
            chainid: number,
            deploySequence: PoCoDeployConfig[],
        }
   }} GanachePoCoServiceConfig
*/

// Does nothing but required for TypeScript to import this file.
export { }