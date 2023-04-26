import * as types from "../common/common-types.js";
import * as cTypes from "./contracts-types.js";

// /* ---------------------------- Private types ------------------------------- */

/** @typedef {types.DataHexString} DataHexString */
/** @typedef {types.RawSignature65} RawSignature65 */

/**
@typedef {{
    app: cTypes.Resource,
    dataset: cTypes.Resource,
    workerpool: cTypes.Resource,
    trust: cTypes.uint256,
    category: cTypes.uint256,
    tag: cTypes.bytes32string,
    requester: types.checksumaddress,
    beneficiary: types.checksumaddress,
    callback: types.checksumaddress,
    params: string,
    startTime: cTypes.uint256,
    botFirst: cTypes.uint256,
    botSize: cTypes.uint256,
    workerStake: cTypes.uint256,
    schedulerRewardRatio: cTypes.uint256,
}} DealRpc
*/

/**
@typedef {0 | 1 | 2 | 3 | 4} TaskStatusEnumInt
*/

/**
@typedef {{
    status: TaskStatusEnumInt,
    dealid: cTypes.bytes32string,
    idx: cTypes.uint256,
    timeref: cTypes.uint256,
    contributionDeadline: cTypes.uint256,
    revealDeadline: cTypes.uint256,
    finalDeadline: cTypes.uint256,
    consensusValue: cTypes.bytes32string,
    revealCounter: cTypes.uint256,
    winnerCounter: cTypes.uint256,
    contributors: types.checksumaddress[],
    resultDigest: cTypes.bytes32string,
    results: string,
    resultsTimestamp: cTypes.uint256,
    resultsCallback: string
    }} TaskRpc
*/

/* ---------------------------- Public types -------------------------------- */

export * from './contracts-types.js'