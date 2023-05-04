// Dependencies
// ../common
import * as types from '../common/common-types.js';
import * as cTypes from './contracts-types-internal.js';
import assert from 'assert';
import { BigNumber } from "ethers";
import { Order, OrderConstructorGuard } from './Order.js';
import { tagArrayToTagBytes32String } from './tags.js';
import { RequestParams } from './RequestParams.js';
import { defaultAbiCoder, keccak256 } from "ethers/lib/utils.js";
import { EIP712Domain } from './EIP712Domain.js';
import { NULL_ADDRESS, toUint256 } from '../common/ethers.js';

export const RequestOrderConstructorGuard = { value: false };

/**
 * @param {cTypes.RequestOrder} requestorder 
 */
export function newRequestOrder(requestorder) {
    assert(!RequestOrderConstructorGuard.value);
    RequestOrderConstructorGuard.value = true;
    let o = null;
    try {
        o = new RequestOrder(requestorder);
    } catch (err) {
        RequestOrderConstructorGuard.value = false;
        throw err;
    }
    RequestOrderConstructorGuard.value = false;
    return o;
}

export class RequestOrder extends Order {

    /** @type {cTypes.RequestOrder} */
    #properties = {
        app: NULL_ADDRESS,
        appmaxprice: BigNumber.from(0),
        dataset: NULL_ADDRESS,
        datasetmaxprice: BigNumber.from(0),
        workerpool: NULL_ADDRESS,
        workerpoolmaxprice: BigNumber.from(0),
        requester: NULL_ADDRESS,
        volume: BigNumber.from(0),
        tag: [],
        category: 0,
        trust: 0,
        beneficiary: NULL_ADDRESS,
        callback: NULL_ADDRESS,
        params: {}
    };

    /** @type {RequestParams} */
    #params;

    /**
     * @param {cTypes.RequestOrder} requestorder 
     */
    constructor(requestorder) {
        if (!RequestOrderConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }

        assert(!OrderConstructorGuard.value);
        OrderConstructorGuard.value = true;
        super();
        OrderConstructorGuard.value = false;
        this.#properties = requestorder;
        this.#params = RequestParams.fromJson( requestorder.params );
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
            params: this.#params.abiEncodableProperties(),
        };
        return ep;
    }

    /*
    function hash(RequestOrder memory _requestorder)
    public pure returns (bytes32 requesthash)
    {
         return keccak256(abi.encodePacked(
            abi.encode(
                REQUESTORDER_TYPEHASH
            ,	_requestorder.app
            ,	_requestorder.appmaxprice
            ,	_requestorder.dataset
            ,	_requestorder.datasetmaxprice
            ,	_requestorder.workerpool
            ,	_requestorder.workerpoolmaxprice
            ),
            abi.encode(
                _requestorder.requester
            ,	_requestorder.volume
            ,	_requestorder.tag
            ,	_requestorder.category
            ,	_requestorder.trust
            ,	_requestorder.beneficiary
            ,	_requestorder.callback
            ,	keccak256(bytes(_requestorder.params))
            ,	_requestorder.salt
            )
        ));
    }
    struct RequestOrder
    {
        address app;
        uint256 appmaxprice;
        address dataset;
        uint256 datasetmaxprice;
        address workerpool;
        uint256 workerpoolmaxprice;
        address requester;
        uint256 volume;
        bytes32 tag;
        uint256 category;
        uint256 trust;
        address beneficiary;
        address callback;
        string  params;
        bytes32 salt;
        bytes   sign;
    }
    */
    static abiOrderedTypes() {
        return {
            RequestOrder: [
                { name: 'app', type: 'address' }, // do not change order
                { name: 'appmaxprice', type: 'uint256' }, // do not change order
                { name: 'dataset', type: 'address' }, // do not change order
                { name: 'datasetmaxprice', type: 'uint256' }, // do not change order
                { name: 'workerpool', type: 'address' }, // do not change order
                { name: 'workerpoolmaxprice', type: 'uint256' }, // do not change order
                { name: 'requester', type: 'address' }, // do not change order
                { name: 'volume', type: 'uint256' }, // do not change order
                { name: 'tag', type: 'bytes32' }, // do not change order
                { name: 'category', type: 'uint256' }, // do not change order
                { name: 'trust', type: 'uint256' }, // do not change order
                { name: 'beneficiary', type: 'address' }, // do not change order
                { name: 'callback', type: 'address' }, // do not change order
                { name: 'params', type: 'string' }, // do not change order
            ]
        };
    }
    abiOrderedTypes() { return RequestOrder.abiOrderedTypes(); }

    /* ----------------------- Begin Getters / Setters ---------------------- */

    get app() { return this.#properties.app; }
    get appmaxprice() { return this.#properties.appmaxprice; }
    get dataset() { return this.#properties.dataset; }
    get datasetmaxprice() { return this.#properties.datasetmaxprice; }
    get workerpool() { return this.#properties.workerpool; }
    get workerpoolmaxprice() { return this.#properties.workerpoolmaxprice; }
    get requester() { return this.#properties.requester; }
    get volume() { return this.#properties.volume; }
    get tag() { return this.#properties.tag.slice(); }
    get category() { return this.#properties.category; }
    get trust() { return this.#properties.trust; }
    get beneficiary() { return this.#properties.beneficiary; }
    get callback() { return this.#properties.callback; }

    /* ------------------------ End Getters / Setters ----------------------- */

    /**
     * @param {string} requestOrderHash 
     * @param {types.uint256like} idx 
     */
    static computeDealId(requestOrderHash, idx) {
        const idxBN = toUint256(idx);
        const encodedTypes = ['bytes32', 'uint256'];
        const values = [requestOrderHash, idxBN];
        const encoded = defaultAbiCoder.encode(encodedTypes, values);
        const dealid = keccak256(encoded);
        return dealid;
    }

    /**
     * @param {EIP712Domain} domain 
     * @param {types.bytes32string} salt 
     * @param {types.uint256like} idx 
     */
    computeDealId(domain, salt, idx) {
        const requestOrderHash = this.hash(domain, salt);
        return RequestOrder.computeDealId(requestOrderHash, idx);
    }
}
