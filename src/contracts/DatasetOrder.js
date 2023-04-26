import * as cTypes from './contracts-types-internal.js';
import assert from 'assert';
import { BigNumber } from "ethers";
import { Order, OrderConstructorGuard } from './Order.js';
import { tagArrayToTagBytes32String } from './tags.js';
import { NULL_ADDRESS } from '../common/ethers.js';

export const DatasetOrderConstructorGuard = { value: false };

/**
 * @param {cTypes.DatasetOrder} datasetorder 
 */
export function newDatasetOrder(datasetorder) {
    assert(!DatasetOrderConstructorGuard.value);
    DatasetOrderConstructorGuard.value = true;
    let o = null;
    try {
        o = new DatasetOrder(datasetorder);
    } catch (err) {
        DatasetOrderConstructorGuard.value = false;
        throw err;
    }
    DatasetOrderConstructorGuard.value = false;
    return o;
}

export function newEmptyDatasetOrder() {
    return newDatasetOrder({
        dataset: NULL_ADDRESS,
        datasetprice: BigNumber.from(0),
        volume: BigNumber.from(0),
        tag: [],
        apprestrict: NULL_ADDRESS,
        workerpoolrestrict: NULL_ADDRESS,
        requesterrestrict: NULL_ADDRESS
    });
}

export class DatasetOrder extends Order {

    /** @type {cTypes.DatasetOrder} */
    #properties = {
        dataset: NULL_ADDRESS,
        datasetprice: BigNumber.from(0),
        volume: BigNumber.from(0),
        tag: [],
        apprestrict: NULL_ADDRESS,
        workerpoolrestrict: NULL_ADDRESS,
        requesterrestrict: NULL_ADDRESS,
    };

    /**
     * @param {cTypes.DatasetOrder} datasetorder 
     */
    constructor(datasetorder) {
        if (!DatasetOrderConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }

        assert(!OrderConstructorGuard.value);
        OrderConstructorGuard.value = true;
        super();
        OrderConstructorGuard.value = false;
        this.#properties = datasetorder;
        Object.freeze(this.#properties);
    }

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
    function hash(DatasetOrder memory _datasetorder)
    public pure returns (bytes32 datasethash)
    {
         return keccak256(abi.encode(
            DATASETORDER_TYPEHASH
        ,	_datasetorder.dataset
        ,	_datasetorder.datasetprice
        ,	_datasetorder.volume
        ,	_datasetorder.tag
        ,	_datasetorder.apprestrict
        ,	_datasetorder.workerpoolrestrict
        ,	_datasetorder.requesterrestrict
        ,	_datasetorder.salt
        ));
    }
    */
    static abiOrderedTypes() {
        return {
            DatasetOrder: [
                { name: 'dataset', type: 'address' }, // do not change order
                { name: 'datasetprice', type: 'uint256' }, // do not change order
                { name: 'volume', type: 'uint256' }, // do not change order
                { name: 'tag', type: 'bytes32' }, // do not change order
                { name: 'apprestrict', type: 'address' }, // do not change order
                { name: 'workerpoolrestrict', type: 'address' }, // do not change order
                { name: 'requesterrestrict', type: 'address' }, // do not change order
            ]
        };
    }

    abiOrderedTypes() { return DatasetOrder.abiOrderedTypes(); }

    get dataset() { return this.#properties.dataset; }
    get datasetprice() { return this.#properties.datasetprice; }
    get volume() { return this.#properties.volume; }
    get tag() { return this.#properties.tag.slice(); }
    get apprestrict() { return this.#properties.apprestrict; }
    get workerpoolrestrict() { return this.#properties.workerpoolrestrict; }
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