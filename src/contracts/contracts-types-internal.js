// Dependencies
// ../common
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
    trust: types.uint256,
    category: types.uint256,
    tag: types.bytes32string,
    requester: types.checksumaddress,
    beneficiary: types.checksumaddress,
    callback: types.checksumaddress,
    params: string,
    startTime: types.uint256,
    botFirst: types.uint256,
    botSize: types.uint256,
    workerStake: types.uint256,
    schedulerRewardRatio: types.uint256,
}} DealRpc
*/

/**
@typedef {0 | 1 | 2 | 3 | 4} TaskStatusEnumInt
*/

/**
@typedef {{
    status: TaskStatusEnumInt,
    dealid: types.bytes32string,
    idx: types.uint256,
    timeref: types.uint256,
    contributionDeadline: types.uint256,
    revealDeadline: types.uint256,
    finalDeadline: types.uint256,
    consensusValue: types.bytes32string,
    revealCounter: types.uint256,
    winnerCounter: types.uint256,
    contributors: types.checksumaddress[],
    resultDigest: types.bytes32string,
    results: string,
    resultsTimestamp: types.uint256,
    resultsCallback: string
    }} TaskRpc
*/

/* ---------------------------- Public types -------------------------------- */

export * from './contracts-types.js'