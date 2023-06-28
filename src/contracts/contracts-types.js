// Dependencies
// ../common
import * as types from "../common/common-types.js";

/**
@typedef {'gpu' | 'tee'} tagEnum
@typedef {tagEnum[]} tag
*/

/**
@typedef {{
    app: types.checksumaddress,
    appprice: types.uint256,
    volume: types.uint256,
    tag: tag,
    datasetrestrict: types.checksumaddress,
    workerpoolrestrict: types.checksumaddress,
    requesterrestrict: types.checksumaddress,
}} AppOrder
*/

/**
@typedef {{
    app: import('./AppRegistryEntry.js').AppRegistryEntry | types.checksumaddress,
    appprice?: string | number | types.uint256,
    volume?: string | number | types.uint256,
    tag?: string | tag,
    datasetrestrict?: types.checksumaddress,
    workerpoolrestrict?: types.checksumaddress,
    requesterrestrict?: types.checksumaddress,
}} AppOrderLike
*/

/**
@typedef {{
    app: types.checksumaddress,
    appmaxprice: types.uint256,
    dataset: types.checksumaddress,
    datasetmaxprice: types.uint256,
    workerpool: types.checksumaddress,
    workerpoolmaxprice: types.uint256,
    requester: types.checksumaddress,
    volume: types.uint256,
    tag: tag,
    category: types.positiveInteger,
    trust: types.positiveInteger,
    beneficiary: types.checksumaddress,
    callback: types.checksumaddress,
    params: RequestParams,
}} RequestOrder
*/

/**
@typedef {{
    app: import('./AppRegistryEntry.js').AppRegistryEntry | types.checksumaddress,
    appmaxprice?: string | number | types.uint256,
    dataset?: import('./DatasetRegistryEntry.js').DatasetRegistryEntry | types.checksumaddress,
    datasetmaxprice?: string | number | types.uint256,
    workerpool: import('./WorkerpoolRegistryEntry.js').WorkerpoolRegistryEntry | types.checksumaddress,
    workerpoolmaxprice?: string | number | types.uint256,
    requester: types.checksumaddress,
    volume?: string | number | types.uint256,
    tag?: tag,
    category?: types.positiveInteger,
    trust?: types.positiveInteger,
    beneficiary?: types.checksumaddress,
    callback?: types.checksumaddress,
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
    iexec_secrets?: Object.<types.strictlyPositiveInteger,string>,
    iexec_result_encryption?: boolean,
    iexec_result_storage_provider?: 'ipfs' | 'dropbox', 
    iexec_result_storage_proxy?: string
    iexec_developer_logger?: boolean 
}} RequestParams

/**
@typedef {{
    workerpool: types.checksumaddress,
    workerpoolprice: types.uint256,
    volume: types.uint256,
    tag: tag,
    category: types.positiveInteger,
    trust: types.positiveInteger,
    apprestrict: types.checksumaddress,
    datasetrestrict: types.checksumaddress,
    requesterrestrict: types.checksumaddress,
}} WorkerpoolOrder
*/

/**
@typedef {{
    workerpool: import('./WorkerpoolRegistryEntry.js').WorkerpoolRegistryEntry | types.checksumaddress,
    workerpoolprice?: string | number | types.uint256,
    volume?: string | number | types.uint256,
    tag?: string | tag,
    category?: types.positiveInteger,
    trust?: types.positiveInteger,
    apprestrict?: types.checksumaddress,
    datasetrestrict?: types.checksumaddress,
    requesterrestrict?: types.checksumaddress,
}} WorkerpoolOrderLike
*/

/**
@typedef {{
    dataset: types.checksumaddress,
    datasetprice: types.uint256,
    volume: types.uint256,
    tag: tag,
    apprestrict: types.checksumaddress,
    workerpoolrestrict: types.checksumaddress,
    requesterrestrict: types.checksumaddress,
}} DatasetOrder
*/

/**
@typedef {{
    dataset:  import('./DatasetRegistryEntry.js').DatasetRegistryEntry | types.checksumaddress,
    datasetprice?: string | number | types.uint256,
    volume?: string | number | types.uint256,
    tag?: string | tag,
    apprestrict?: types.checksumaddress,
    workerpoolrestrict?: types.checksumaddress,
    requesterrestrict?: types.checksumaddress,
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
    chainId: types.uint256,
    verifyingContract: types.checksumaddress
}} EIP712DomainStruct

*/

/**
@typedef Category
@type {object}
    @property {types.checksumaddress} hub
    @property {types.uint256} id
    @property {string} name
    @property {string} description
    @property {types.uint256} workClockTimeRef
*/

/**
@typedef App
@type {object}
    @property {types.checksumaddress} owner
    @property {string} name
    @property {'DOCKER'} type
    @property {string} multiaddr
    @property {types.bytes32string} checksum
    @property {MREnclave=} mrenclave
*/

/**
@typedef Dataset
@type {object}
    @property {types.checksumaddress} owner
    @property {string} name
    @property {string} multiaddr
    @property {types.bytes32string} checksum
*/

/** 
@typedef Workerpool
@type {object}
    @property {types.checksumaddress} owner
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
    @property {('SCONE' | 'GRAMINE')} framework
    @property {string} version
    @property {string=} entrypoint
    @property {types.positiveInteger=} heapSize
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
    pointer: types.checksumaddress,
    owner: types.checksumaddress,
    price: types.uint256,
}} Resource
*/

/**
@typedef {{
    app: Resource,
    dataset: Resource,
    workerpool: Resource,
    trust: types.uint256,
    category: types.uint256,
    tag: tag,
    requester: types.checksumaddress,
    beneficiary: types.checksumaddress,
    callback: types.checksumaddress,
    params: import('./RequestParams.js').RequestParams,
    startTime: types.uint256,
    botFirst: types.uint256,
    botSize: types.uint256,
    workerStake: types.uint256,
    schedulerRewardRatio: types.uint256,
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
    dealid: types.bytes32string,
    idx: types.uint256,
    timeref: types.uint256,
    contributionDeadline: types.uint256,
    revealDeadline: types.uint256,
    finalDeadline: types.uint256,
    consensusValue: types.bytes32string,
    revealCounter: types.uint256;
    winnerCounter: types.uint256;
    contributors: types.checksumaddress[];
    resultDigest: types.bytes32string;
    results: any;
    resultsTimestamp: types.uint256;
    resultsCallback: any
}} Task
*/

// Does nothing but required for TypeScript to import this file.
export {}