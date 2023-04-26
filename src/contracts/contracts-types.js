import * as types from "../common/common-types.js";

/**
@typedef {'gpu' | 'tee'} tagEnum
@typedef {tagEnum[]} tag
*/

/**
@typedef {import('ethers').BigNumber} uint256
@typedef { number | number[] | Uint8Array | types.DataHexString | types.Hexable } uint256like

@typedef {string} bytes
@typedef {string} signature
@typedef {string} checksumaddress
@typedef {number} positiveInteger
@typedef {number} strictlyPositiveInteger
*/

/**
 MUST be of length 32
 - '0x123' is not a bytes32 (but can be converted to a bytes32)
 - ethers always calls arrayify(bytes32_arg) during the function call process
 - bytes32 are case-insensitive. ('0xff' == '0xFF')
 @typedef {string} bytes32string
 @typedef {string | Uint8Array | number[]} bytes32like
 */

/**
@typedef {{
    wallet: import('ethers').Wallet,
    txOverrides?: {
        gasPrice?: uint256,
    }
    txConfirms?: positiveInteger,
}} TxArgs
*/

/**
@typedef { TxArgs | import('ethers').Wallet } TxArgsOrWallet
*/


/**
@typedef {{
    app: checksumaddress,
    appprice: uint256,
    volume: uint256,
    tag: tag,
    datasetrestrict: checksumaddress,
    workerpoolrestrict: checksumaddress,
    requesterrestrict: checksumaddress,
}} AppOrder
*/

/**
@typedef {{
    app: import('./AppRegistryEntry.js').AppRegistryEntry | checksumaddress,
    appprice?: string | number | uint256,
    volume?: string | number | uint256,
    tag?: string | tag,
    datasetrestrict?: checksumaddress,
    workerpoolrestrict?: checksumaddress,
    requesterrestrict?: checksumaddress,
}} AppOrderLike
*/

/**
@typedef {{
    app: checksumaddress,
    appmaxprice: uint256,
    dataset: checksumaddress,
    datasetmaxprice: uint256,
    workerpool: checksumaddress,
    workerpoolmaxprice: uint256,
    requester: checksumaddress,
    volume: uint256,
    tag: tag,
    category: positiveInteger,
    trust: positiveInteger,
    beneficiary: checksumaddress,
    callback: checksumaddress,
    params: RequestParams,
}} RequestOrder
*/

/**
@typedef {{
    app: import('./AppRegistryEntry.js').AppRegistryEntry | checksumaddress,
    appmaxprice?: string | number | uint256,
    dataset?: import('./DatasetRegistryEntry.js').DatasetRegistryEntry | checksumaddress,
    datasetmaxprice?: string | number | uint256,
    workerpool: import('./WorkerpoolRegistryEntry.js').WorkerpoolRegistryEntry | checksumaddress,
    workerpoolmaxprice?: string | number | uint256,
    requester: checksumaddress,
    volume?: string | number | uint256,
    tag?: tag,
    category?: positiveInteger,
    trust?: positiveInteger,
    beneficiary?: checksumaddress,
    callback?: checksumaddress,
    params?: RequestParams,
}} RequestOrderLike
*/

/**
 * - iexec_result_storage_proxy : result proxy service url 'http://my_result_proxy.com'
 * - iexec_input_files : array of valid urls ['http://foo1.org/myfile1.txt', 'http://foo2.org/myfile2.txt']
 * - iexec_secrets : only in 'tee' mode
@typedef {{
    iexec_args?: string,
    iexec_input_files?: string[],
    iexec_secrets?: Object.<strictlyPositiveInteger,string>,
    iexec_result_encryption?: boolean,
    iexec_result_storage_provider?: 'ipfs' | 'dropbox', 
    iexec_result_storage_proxy?: string
    iexec_developer_logger?: boolean 
}} RequestParams

/**
@typedef {{
    workerpool: checksumaddress,
    workerpoolprice: uint256,
    volume: uint256,
    tag: tag,
    category: positiveInteger,
    trust: positiveInteger,
    apprestrict: checksumaddress,
    datasetrestrict: checksumaddress,
    requesterrestrict: checksumaddress,
}} WorkerpoolOrder
*/

/**
@typedef {{
    workerpool: import('./WorkerpoolRegistryEntry.js').WorkerpoolRegistryEntry | checksumaddress,
    workerpoolprice?: string | number | uint256,
    volume?: string | number | uint256,
    tag?: string | tag,
    category?: positiveInteger,
    trust?: positiveInteger,
    apprestrict?: checksumaddress,
    datasetrestrict?: checksumaddress,
    requesterrestrict?: checksumaddress,
}} WorkerpoolOrderLike
*/

/**
@typedef {{
    dataset: checksumaddress,
    datasetprice: uint256,
    volume: uint256,
    tag: tag,
    apprestrict: checksumaddress,
    workerpoolrestrict: checksumaddress,
    requesterrestrict: checksumaddress,
}} DatasetOrder
*/

/**
@typedef {{
    dataset:  import('./DatasetRegistryEntry.js').DatasetRegistryEntry | checksumaddress,
    datasetprice?: string | number | uint256,
    volume?: string | number | uint256,
    tag?: string | tag,
    apprestrict?: checksumaddress,
    workerpoolrestrict?: checksumaddress,
    requesterrestrict?: checksumaddress,
}} DatasetOrderLike
*/

/**
@typedef {'app' | 'dataset' | 'workerpool' } iExecRegistrableObjectType
@typedef {'app' | 'dataset' | 'workerpool' | 'request' } iExecObjectType
@typedef {AppOrder | DatasetOrder | WorkerpoolOrder | RequestOrder} Order
*/

/**
 
PoCo/contracts/libs/IexecLibOrders_v5.sol
`struct EIP712Domain
{
    string  name;
    string  version;
    uint256 chainId;
    address verifyingContract;
}`

@typedef {{ 
    name: string,
    version: string,
    chainId: uint256,
    verifyingContract: checksumaddress
}} EIP712DomainStruct

*/

/**
@typedef Category
@type {object}
    @property {checksumaddress} hub
    @property {uint256} id
    @property {string} name
    @property {string} description
    @property {uint256} workClockTimeRef
*/

/**
@typedef App
@type {object}
    @property {checksumaddress} owner
    @property {string} name
    @property {'DOCKER'} type
    @property {string} multiaddr
    @property {bytes32string} checksum
    @property {MREnclave=} mrenclave
*/

/**
@typedef Dataset
@type {object}
    @property {checksumaddress} owner
    @property {string} name
    @property {string} multiaddr
    @property {bytes32string} checksum
*/

/** 
@typedef Workerpool
@type {object}
    @property {checksumaddress} owner
    @property {string} description
*/

/**
 *   MREnclave example (from lib.test.js)
 *   ------------------------------------
 * 
 *  {
 *      provider: 'SCONE', 
 *      version: 'v5', 
 *      entrypoint: 'python /app/app.py',
 *      heapSize: '1073741824', 
 *      fingerprint: 'eca3ace86f1e8a5c47123c8fd271319e9eb25356803d36666dc620f30365c0c1', 
 *  }
 */

/** 
@typedef MREnclave
@type {object}
    @property {string} provider
    @property {string} version
    @property {string} entrypoint
    @property {positiveInteger} heapSize
    @property {string} fingerprint
 */


/*
struct Resource
{
    address pointer;
    address owner;
    uint256 price;
}
struct Deal
{
    // Ressources
    Resource app;
    Resource dataset;
    Resource workerpool;
    uint256 trust;
    uint256 category;
    bytes32 tag;
    // execution details
    address requester;
    address beneficiary;
    address callback;
    string  params;
    // execution settings
    uint256 startTime;
    uint256 botFirst;
    uint256 botSize;
    // consistency
    uint256 workerStake;
    uint256 schedulerRewardRatio;
}
*/

/**
@typedef {{
    pointer: checksumaddress,
    owner: checksumaddress,
    price: uint256,
}} Resource
*/

/**
@typedef {{
    app: Resource,
    dataset: Resource,
    workerpool: Resource,
    trust: uint256,
    category: uint256,
    tag: tag,
    requester: checksumaddress,
    beneficiary: checksumaddress,
    callback: checksumaddress,
    params: import('./RequestParams.js').RequestParams,
    startTime: uint256,
    botFirst: uint256,
    botSize: uint256,
    workerStake: uint256,
    schedulerRewardRatio: uint256,
}} Deal
*/

/*
    enum TaskStatusEnum
	{
		UNSET,     // Work order not yet initialized (invalid address)
		ACTIVE,    // Marketed → constributions are open
		REVEALING, // Starting consensus reveal
		COMPLETED, // Consensus achieved
		FAILED     // Failed consensus
	}
	struct Task
	{
		TaskStatusEnum status;
		bytes32   dealid;
		uint256   idx;
		uint256   timeref;
		uint256   contributionDeadline;
		uint256   revealDeadline;
		uint256   finalDeadline;
		bytes32   consensusValue;
		uint256   revealCounter;
		uint256   winnerCounter;
		address[] contributors;
		bytes32   resultDigest;
		bytes     results;
		uint256   resultsTimestamp;
		bytes     resultsCallback; // Expansion - result separation
	}
*/

/**
@typedef {'UNSET' | 'ACTIVE' | 'REVEALING' | 'COMPLETED' | 'FAILED'} TaskStatusEnum
*/

/**
@typedef {{
    status: TaskStatusEnum,
    dealid: bytes32string,
    idx: uint256,
    timeref: uint256,
    contributionDeadline: uint256,
    revealDeadline: uint256,
    finalDeadline: uint256,
    consensusValue: bytes32string,
    revealCounter: uint256;
    winnerCounter: uint256;
    contributors: checksumaddress[];
    resultDigest: bytes32string;
    results: any;
    resultsTimestamp: uint256;
    resultsCallback: any
}} Task
*/

// Does nothing but required for TypeScript to import this file.
export {}