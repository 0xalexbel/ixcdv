import * as cTypes from './contracts-types-internal.js';
import assert from 'assert';
import { BigNumber } from "ethers";
import { defaultAbiCoder, keccak256 } from "ethers/lib/utils.js";
import { RequestParams } from './RequestParams.js';
import { toTagArray } from './tags.js';
import { isBytes32String, NULL_ADDRESS, toUint256 } from '../common/ethers.js';
import { CodeError } from '../common/error.js';

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
export const DealConstructorGuard = { value: false };

/** 
 * @param {cTypes.bytes32string} dealid 
 * @param {cTypes.Deal} deal 
 */
function newDeal(dealid, deal) {
    assert(!DealConstructorGuard.value);
    DealConstructorGuard.value = true;
    let o = null;
    try {
        o = new Deal(dealid, deal);
    } catch (err) {
        DealConstructorGuard.value = false;
        throw err;
    }
    DealConstructorGuard.value = false;
    return o;
}

/**
 * @param {cTypes.bytes32string} dealid 
 * @param {cTypes.DealRpc} dealRpc 
 */
export function newDealFromRPC(dealid, dealRpc) {
    /** @type {cTypes.Deal} */
    const d = {
        app: {
            pointer: dealRpc.app.pointer,
            owner: dealRpc.app.owner,
            price: dealRpc.app.price
        },
        dataset: {
            pointer: dealRpc.dataset.pointer,
            owner: dealRpc.dataset.owner,
            price: dealRpc.dataset.price
        },
        workerpool: {
            pointer: dealRpc.workerpool.pointer,
            owner: dealRpc.workerpool.owner,
            price: dealRpc.workerpool.price
        },
        trust: dealRpc.trust,
        category: dealRpc.category,
        tag: toTagArray(dealRpc.tag),
        requester: dealRpc.requester,
        beneficiary: dealRpc.beneficiary,
        callback: dealRpc.callback,
        params: RequestParams.from(dealRpc.params),
        startTime: dealRpc.startTime,
        botFirst: dealRpc.botFirst,
        botSize: dealRpc.botSize,
        workerStake: dealRpc.workerStake,
        schedulerRewardRatio: dealRpc.schedulerRewardRatio
    };
    return newDeal(dealid, d);
}

export class Deal {

    /** @type {cTypes.bytes32string} */
    #id;

    /** @type {cTypes.Deal} */
    #properties = {
        app: {
            pointer: NULL_ADDRESS,
            owner: NULL_ADDRESS,
            price: BigNumber.from(0)
        },
        dataset: {
            pointer: NULL_ADDRESS,
            owner: NULL_ADDRESS,
            price: BigNumber.from(0)
        },
        workerpool: {
            pointer: NULL_ADDRESS,
            owner: NULL_ADDRESS,
            price: BigNumber.from(0)
        },
        trust: BigNumber.from(0),
        category: BigNumber.from(0),
        tag: [],
        requester: NULL_ADDRESS,
        beneficiary: NULL_ADDRESS,
        callback: NULL_ADDRESS,
        //@ts-ignore
        params: undefined,
        startTime: BigNumber.from(0),
        botFirst: BigNumber.from(0),
        botSize: BigNumber.from(0),
        workerStake: BigNumber.from(0),
        schedulerRewardRatio: BigNumber.from(0)
    };

    /**
     * @param {cTypes.bytes32string} dealid 
     * @param {cTypes.Deal} deal 
     */
    constructor(dealid, deal) {
        if (!DealConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }

        assert(deal.params instanceof RequestParams);
        
        this.#id = dealid;
        this.#properties = deal;
        
        Object.freeze(this.#properties.tag);
    }

    get id() { return this.#id; }

    get app() { return this.#properties.app.pointer; }
    get appprice() { return this.#properties.app.price; }
    get appowner() { return this.#properties.app.owner; }

    get dataset() { return this.#properties.dataset.pointer; }
    get datasetprice() { return this.#properties.dataset.price; }
    get datasetowner() { return this.#properties.dataset.owner; }

    get workerpool() { return this.#properties.workerpool.pointer; }
    get workerpoolprice() { return this.#properties.workerpool.price; }
    get workerpoolowner() { return this.#properties.workerpool.owner; }

    get trust() { return this.#properties.trust; }
    get category() { return this.#properties.category; }
    get tag() { return this.#properties.tag; }
    get params() { return this.#properties.params; }
    get requester() { return this.#properties.requester; }
    get beneficiary() { return this.#properties.beneficiary; }
    get callback() { return this.#properties.callback; }
    
    get startTime() { return this.#properties.startTime; }
    get botFirst() { return this.#properties.botFirst; }
    get botSize() { return this.#properties.botSize; }
    
    get workerStake() { return this.#properties.workerStake; }
    get schedulerRewardRatio() { return this.#properties.schedulerRewardRatio; }
      
    /**
     * @param {cTypes.bytes32string} dealid 
     * @param {cTypes.uint256} taskidx 
     */
    static #computeTaskId(dealid, taskidx) {
        if (!isBytes32String(dealid)) {
            throw new CodeError('Invalid dealid');
        }
        const idxBN = toUint256(taskidx);
        const encoded = defaultAbiCoder.encode(
            ['bytes32', 'uint256'], 
            [dealid, idxBN]);
        return keccak256(encoded);
    }

    /**
     * taskidx >= 0 && taskidx < botSize
     * @param {cTypes.uint256like} taskidx 
     */
    computeTaskId(taskidx) {
        const idxBN = toUint256(taskidx);
        if (idxBN.isNegative()) {
            throw new CodeError('Out of bounds task index');
        }
        if (idxBN.gte(this.botSize)) {
            throw new CodeError('Out of bounds task index');
        }
        return Deal.#computeTaskId(this.#id, this.botFirst.add(idxBN));
    }

    toJSON() {
        return { id:this.#id, ...this.#properties };
    }
}