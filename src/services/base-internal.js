import { CodeError } from '../common/error.js';
import * as srvTypes from './services-types-internal.js';

export const ENV_FILE_BASENAME = 'env.txt';

/** @type {srvTypes.ServiceType[]} */
export const ORDERED_SERVICE_TYPES = [
    'ganache', 'ipfs', 'docker', 'mongo', 'redis',
    'market',
    'sms', 'resultproxy', 'blockchainadapter',
    'core',
    'worker',
];

/** @type {srvTypes.ChainServiceType[]} */
export const CHAIN_SERVICE_TYPES = [
    'sms', 'resultproxy', 'blockchainadapter',
    'core'
];

/** @type {srvTypes.DBServiceType[]} */
export const DB_SERVICE_TYPES = [
    'ganache', 'ipfs', 'mongo', 'redis', 'market', 'sms'
];

// Hardcoded follows ORDERED_SERVICE_TYPES array
/** @type {srvTypes.ServiceTypes<number>} */
export const SERVICE_TYPE_INDICES = {
    'ganache': 0,
    'ipfs': 1,
    'docker': 2,
    'mongo': 3,
    'redis': 4,
    'market': 5,
    'sms': 6,
    'resultproxy': 7,
    'blockchainadapter': 8,
    'core': 9,
    'worker': 10,
};

/**
 * @template T
 * @param {T} value 
 * @returns 
 */
export function newServiceTypes(value) {
    return {
        'ganache': value,
        'ipfs': value,
        'docker': value,
        'mongo': value,
        'redis': value,
        'market': value,
        'sms': value,
        'resultproxy': value,
        'blockchainadapter': value,
        'core': value,
        'worker': value,
    };
}


/**
 * @param {srvTypes.ServiceType} type 
 */
export function isHubServiceType(type) {
    return (type === 'sms' ||
        type === 'resultproxy' ||
        type === 'blockchainadapter' ||
        type === 'core');
}

/**
 * @param {any} type 
 * @returns {srvTypes.ServiceType}
 */
export function asServiceType(type) {
    if (typeof type !== 'string') {
        throw new CodeError(`Invalid service type ${type}`);
    }
    if (type === 'worker' ||
        type === 'core' ||
        type === 'blockchainadapter' ||
        type === 'sms' ||
        type === 'resultproxy' ||
        type === 'mongo' ||
        type === 'redis' ||
        type === 'ganache' ||
        type === 'docker' ||
        type === 'ipfs') {
        return type;
    }
    throw new CodeError(`Invalid service type ${type}`);
}
