// Dependencies
// ../common
import * as cTypes from './contracts-types-internal.js';
import assert from 'assert';
import { BigNumber } from "ethers";
import { NULL_ADDRESS, toChecksumAddress } from '../common/ethers.js';

export const CategoryConstructorGuard = { value: false };

/**
 * @param {cTypes.Category} category 
 */
export function newCategory(category) {
    assert(!CategoryConstructorGuard.value);
    CategoryConstructorGuard.value = true;
    let o = null;
    try {
        o = new Category(category);
    } catch (err) {
        CategoryConstructorGuard.value = false;
        throw err;
    }
    CategoryConstructorGuard.value = false;
    return o;
}

export class Category {

    /** @type {cTypes.Category} */
    #properties = {
        id: BigNumber.from(0),
        hub: NULL_ADDRESS,
        name: '',
        workClockTimeRef: BigNumber.from(0),
        description: '',
    };

    /**
     * @param {cTypes.Category} category 
     */
    constructor(category) {
        if (!CategoryConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }

        this.#properties.id = BigNumber.from(category.id);
        this.#properties.hub = toChecksumAddress(category.hub);
        this.#properties.name = category.name;
        this.#properties.workClockTimeRef = BigNumber.from(category.workClockTimeRef);
        this.#properties.description = category.description;
        Object.freeze(this.#properties);
    }

    get id() { return this.#properties.id; }
    get hub() { return this.#properties.hub; }
    get name() { return this.#properties.name; }
    get workClockTimeRef() { return this.#properties.workClockTimeRef; }
    get description() { return this.#properties.description; }
}

