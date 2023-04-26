import * as cTypes from './contracts-types-internal.js';
import assert from 'assert';
import { BigNumber } from "ethers";
import { Order, OrderConstructorGuard } from './Order.js';
import { tagArrayToTagBytes32String } from './tags.js';
import { NULL_ADDRESS } from '../common/ethers.js';

export const AppOrderConstructorGuard = { value: false };

/**
 * @param {cTypes.AppOrder} apporder 
 */
export function newAppOrder(apporder) {
    assert(!AppOrderConstructorGuard.value);
    AppOrderConstructorGuard.value = true;
    let o = null;
    try {
        o = new AppOrder(apporder);
    } catch (err) {
        AppOrderConstructorGuard.value = false;
        throw err;
    }
    AppOrderConstructorGuard.value = false;
    return o;
}

export class AppOrder extends Order {

    /** @type {cTypes.AppOrder} */
    #properties = {
        app: NULL_ADDRESS,
        appprice: BigNumber.from(0),
        volume: BigNumber.from(0),
        tag: [],
        datasetrestrict: NULL_ADDRESS,
        workerpoolrestrict: NULL_ADDRESS,
        requesterrestrict: NULL_ADDRESS,
    };

    /**
     * @param {cTypes.AppOrder} apporder 
     */
    constructor(apporder) {
        if (!AppOrderConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }

        assert(!OrderConstructorGuard.value);
        OrderConstructorGuard.value = true;
        super();
        OrderConstructorGuard.value = false;
        this.#properties = apporder;
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
    function hash(AppOrder memory _apporder)
    public pure returns (bytes32 apphash)
    {
         return keccak256(abi.encode(
            APPORDER_TYPEHASH
        ,	_apporder.app
        ,	_apporder.appprice
        ,	_apporder.volume
        ,	_apporder.tag
        ,	_apporder.datasetrestrict
        ,	_apporder.workerpoolrestrict
        ,	_apporder.requesterrestrict
        ,	_apporder.salt
        ));
    }
    */
    static abiOrderedTypes() {
        return {
            AppOrder: [
                { name: 'app', type: 'address' }, // do not change order
                { name: 'appprice', type: 'uint256' }, // do not change order
                { name: 'volume', type: 'uint256' }, // do not change order
                { name: 'tag', type: 'bytes32' }, // do not change order
                { name: 'datasetrestrict', type: 'address' }, // do not change order
                { name: 'workerpoolrestrict', type: 'address' }, // do not change order
                { name: 'requesterrestrict', type: 'address' }, // do not change order
            ]
        };
    }
    abiOrderedTypes() { return AppOrder.abiOrderedTypes(); }

    get app() { return this.#properties.app; }
    get appprice() { return this.#properties.appprice; }
    get volume() { return this.#properties.volume; }
    get tag() { return this.#properties.tag.slice(); }
    get datasetrestrict() { return this.#properties.datasetrestrict; }
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

