// Dependencies
// ../common
import * as cTypes from './contracts-types-internal.js';
import assert from 'assert';
import { BigNumber } from "ethers";
import { Order, OrderConstructorGuard } from './Order.js';
import { tagArrayToTagBytes32String } from './tags.js';
import { NULL_ADDRESS } from '../common/ethers.js';

export const WorkerpoolOrderConstructorGuard = { value: false };

/**
 * @param {cTypes.WorkerpoolOrder} workerpoolorder 
 */
export function newWorkerpoolOrder(workerpoolorder) {
    assert(!WorkerpoolOrderConstructorGuard.value);
    WorkerpoolOrderConstructorGuard.value = true;
    let o = null;
    try {
        o = new WorkerpoolOrder(workerpoolorder);
    } catch (err) {
        WorkerpoolOrderConstructorGuard.value = false;
        throw err;
    }
    WorkerpoolOrderConstructorGuard.value = false;
    return o;
}

export class WorkerpoolOrder extends Order {
    /** @type {cTypes.WorkerpoolOrder} */
    #properties = {
        workerpool: NULL_ADDRESS,
        workerpoolprice: BigNumber.from(0),
        volume: BigNumber.from(0),
        tag: [],
        category: 0,
        trust: 0,
        apprestrict: NULL_ADDRESS,
        datasetrestrict: NULL_ADDRESS,
        requesterrestrict: NULL_ADDRESS,
    };

    /**
     * @param {cTypes.WorkerpoolOrder} workerpoolorder 
     */
    constructor(workerpoolorder) {
        if (!WorkerpoolOrderConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }

        assert(!OrderConstructorGuard.value);
        OrderConstructorGuard.value = true;
        super();
        OrderConstructorGuard.value = false;
        this.#properties = workerpoolorder;
        Object.freeze(this.#properties);
    }

    /* ----------------------- Overrides ---------------------- */

    /**
     * Compute ready-to-abi-encode properties
     * keys order does not matter.
     */
    abiEncodableProperties() {
        const ep = {
            ...this.#properties,
            /* override tag */
            tag: tagArrayToTagBytes32String(this.#properties.tag),
        };
        return ep;
    }

    /*
    function hash(WorkerpoolOrder memory _workerpoolorder)
    public pure returns (bytes32 workerpoolhash)
    {
         return keccak256(abi.encode(
            WORKERPOOLORDER_TYPEHASH
        ,	_workerpoolorder.workerpool
        ,	_workerpoolorder.workerpoolprice
        ,	_workerpoolorder.volume
        ,	_workerpoolorder.tag
        ,	_workerpoolorder.category
        ,	_workerpoolorder.trust
        ,	_workerpoolorder.apprestrict
        ,	_workerpoolorder.datasetrestrict
        ,	_workerpoolorder.requesterrestrict
        ,	_workerpoolorder.salt
        ));
    }
    */
    static abiOrderedTypes() {
        return {
            WorkerpoolOrder: [
                { name: 'workerpool', type: 'address' }, // do not change order
                { name: 'workerpoolprice', type: 'uint256' }, // do not change order
                { name: 'volume', type: 'uint256' }, // do not change order
                { name: 'tag', type: 'bytes32' }, // do not change order
                { name: 'category', type: 'uint256' }, // do not change order
                { name: 'trust', type: 'uint256' }, // do not change order
                { name: 'apprestrict', type: 'address' }, // do not change order
                { name: 'datasetrestrict', type: 'address' }, // do not change order
                { name: 'requesterrestrict', type: 'address' }, // do not change order
            ]
        };
    }

    abiOrderedTypes() { return WorkerpoolOrder.abiOrderedTypes(); }

    get workerpool() { return this.#properties.workerpool; }
    get workerpoolprice() { return this.#properties.workerpoolprice; }
    get volume() { return this.#properties.volume; }
    get tag() { return this.#properties.tag.slice(); }
    get category() { return this.#properties.category; }
    get trust() { return this.#properties.trust; }
    get apprestrict() { return this.#properties.apprestrict; }
    get datasetrestrict() { return this.#properties.datasetrestrict; }
    get requesterrestrict() { return this.#properties.requesterrestrict; }
    
    toJSON() {
        /** @todo not yet implemented */
        assert(false);
        // /** @type {Object.<string,string>} */
        // const props = {};
        // const keys = Object.keys(this.#properties);
        // for (let i = 0; i < keys.length; ++i) {
        //     const k = keys[i];
        //     if (k !== 'tag') {
        //         //@ts-ignore
        //         props[k] = this.#properties[k].toString();
        //     }
        // }
        // return props;
    }
}
