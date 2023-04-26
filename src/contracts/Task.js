import * as cTypes from './contracts-types-internal.js';
import assert from 'assert';
import { CodeError } from '../common/error.js';
import { NULL_BYTES32 } from '../common/ethers.js';

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

export const TaskConstructorGuard = { value: false };

/** 
 * @param {cTypes.bytes32string} taskid 
 * @param {cTypes.Task} task 
 */
function newTask(taskid, task) {
    assert(!TaskConstructorGuard.value);
    TaskConstructorGuard.value = true;
    let o = null;
    try {
        o = new Task(taskid, task);
    } catch (err) {
        TaskConstructorGuard.value = false;
        throw err;
    }
    TaskConstructorGuard.value = false;
    return o;
}

/**
 * @param {*} taskStatusInt 
 * @returns {cTypes.TaskStatusEnum}
 */
function toTaskStatusEnum(taskStatusInt) {
    if (taskStatusInt === 0) {
        return 'UNSET';
    }
    if (taskStatusInt === 1) {
        return 'ACTIVE';
    }
    if (taskStatusInt === 2) {
        return 'REVEALING';
    }
    if (taskStatusInt === 3) {
        return 'COMPLETED';
    }
    if (taskStatusInt === 4) {
        return 'FAILED';
    }
    throw new CodeError('Invalid task status value');
}

/**
 * @param {cTypes.bytes32string} taskid 
 * @param {cTypes.TaskRpc} taskRpc 
 */
export function newTaskFromRPC(taskid, taskRpc) {
    /** @type {cTypes.Task} */
    const t = {
        status: toTaskStatusEnum(taskRpc.status),
        dealid: taskRpc.dealid,
        idx: taskRpc.idx,
        timeref: taskRpc.timeref,
        contributionDeadline: taskRpc.contributionDeadline,
        revealDeadline: taskRpc.revealDeadline,
        finalDeadline: taskRpc.finalDeadline,
        consensusValue: taskRpc.consensusValue,
        revealCounter: taskRpc.revealCounter,
        winnerCounter: taskRpc.winnerCounter,
        contributors: taskRpc.contributors,
        resultDigest: taskRpc.resultDigest,
        results: taskRpc.results,
        resultsTimestamp: taskRpc.resultsTimestamp,
        resultsCallback: taskRpc.resultsCallback
    };
    return newTask(taskid, t);
}

export class Task {

    /** @type {cTypes.bytes32string} */
    #id;

    /** @type {cTypes.Task} */
    #properties;

    /**
     * @param {cTypes.bytes32string} taskid 
     * @param {cTypes.Task} task 
     */
    constructor(taskid, task) {
        if (!TaskConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }

        this.#id = taskid;
        this.#properties = task;

        Object.freeze(this.#properties.contributors);
    }

    get id() { return this.#id; }
    get dealid() { return this.#properties.dealid; }
    get status() { return this.#properties.status; }
    get idx() { return this.#properties.idx; }

    /** @returns {{ storage:'ipfs', location:string } | { storage:'none' }} */
    get results() {
        if (this.#properties.results !== NULL_BYTES32) {
            const str = Buffer.from(this.#properties.results.substr(2), 'hex').toString('utf8');
            const o = JSON.parse(str);
            assert(o.storage !== undefined);
            assert(o.location !== undefined);
            assert(typeof o.storage === 'string');
            assert(typeof o.location === 'string');
            assert(o.storage === 'ipfs');
            /** @type {{ storage:'ipfs', location:string }} */
            return o;
        }
        return { storage: 'none' };
    }

    toJSON() {
        return { id: this.#id, ...this.#properties };
    }
}