import assert from 'assert';
import * as http from 'http'
import * as https from 'https'
import { urlToHttpOptions } from 'url';
import { CodeError } from './error.js';
import { isNullishOrEmptyString } from './string.js';

/**
 * @param {*} url
 * @return {string}
 */
export function toURLString(url) {
    assert(url);

    /** @type {string} */
    let urlStr;
    if (url instanceof URL) {
        urlStr = url.toString();
    } else if (typeof url === 'string') {
        urlStr = url;
    } else {
        assert(false);
    }
    assert(urlStr);
    assert(!isNullishOrEmptyString(urlStr));
    return urlStr;
}

/**
 * @param {string | URL} url
 * @return {Promise<string>}
 */
export function httpGET(url) {

    /** @type {string} */
    const urlStr = toURLString(url);

    // return new pending promise
    return new Promise((resolve, reject) => {
        // select http or https module, depending on reqested url
        const lib = urlStr.startsWith('https') ? https : http;
        const request = lib.get(urlStr, (response) => {
            assert(response.statusCode);
            // handle http errors
            if (response.statusCode < 200 || response.statusCode > 299) {
                const errobj = { statusCode: response.statusCode };
                reject(new CodeError(
                    JSON.stringify(errobj),
                    response.statusCode.toString()));
            }
            // temporary data holder
            /** @type {any[]} */
            const body = [];
            // on every content chunk, push it to the data array
            response.on('data', (chunk) => body.push(chunk));
            // we are done, resolve promise with those joined chunks
            response.on('end', () => resolve(body.join('')));
        });
        // handle connection errors of the request
        request.on('error', (err) => reject(err))
    });
}

/**
 * @param {string | URL} url
 * @return {Promise<Buffer>}
 */
export function httpGETBinary(url) {

    /** @type {string} */
    const urlStr = toURLString(url);

    // return new pending promise
    return new Promise((resolve, reject) => {
        // select http or https module, depending on reqested url
        const lib = urlStr.startsWith('https') ? https : http;
        const request = lib.get(urlStr, (response) => {
            response.setEncoding('binary');
            assert(response.statusCode);
            // handle http errors
            if (response.statusCode < 200 || response.statusCode > 299) {
                const errobj = { statusCode: response.statusCode };
                reject(new CodeError('httpGETBinary failed',
                    response.statusCode.toString()));
            }
            // temporary data holder
            /** @type {any[]} */
            const binaryBody = [];
            // on every content chunk, push it to the data array
            response.on('data', (chunk) => binaryBody.push(Buffer.from(chunk, 'binary')));
            // we are done, resolve promise with those joined chunks
            response.on('end', () => resolve(Buffer.concat(binaryBody)));
        });
        // handle connection errors of the request
        request.on('error', (err) => reject(err))
    });
}

/**
 * @param {string | URL} url 
 * @return {Promise<number | undefined>}
 */
export function httpGETStatusCode(url) {

    /** @type {string} */
    const urlStr = toURLString(url);
    const urlOpts = urlToHttpOptions(new URL(urlStr));

    // return new pending promise
    return new Promise((resolve, reject) => {
        // select http or https module, depending on reqested url
        const lib = urlStr.startsWith('https') ? https : http;
        // const request = lib.get(urlStr, (response) => {
        //     resolve(response.statusCode);
        // });
        const request = lib.get({ ...urlOpts, agent: false }, (response) => {
            resolve(response.statusCode);
        });
        // handle connection errors of the request
        request.on('error', (err) => {
            reject(err);
        });
        request.end();
    });
}

/**
 * @param {string | URL} url
 * @return {Promise<number | undefined>}
 */
export function httpHEAD(url) {

    /** @type {string} */
    let urlStr = toURLString(url);

    // return new pending promise
    return new Promise((resolve, reject) => {
        // select http or https module, depending on reqested url
        const lib = urlStr.startsWith('https') ? https : http;

        const aa = "http://ixcdv-node1:13300/secrets/web2?ownerAddress=0x2F136F42D301179C3Bb7e4F5c0A7DE53Ed94C660&secretName=iexec-result-iexec-ipfs-token";
        if (urlStr === aa) {
            urlStr = "http://127.0.0.1:13300/secrets/web2?ownerAddress=0x2F136F42D301179C3Bb7e4F5c0A7DE53Ed94C660&secretName=iexec-result-iexec-ipfs-token";
        }

        const req_options = { method: 'HEAD', agent: false };
        const request = lib.request(urlStr, req_options, (response) => {
            resolve(response.statusCode);
            //response.on('data', (chunk) => {});
        });
        request.on('error', (err) => reject(err));
        request.end();
    });
}

/**
 * @param {string | URL} url
 * @param {string} headerName
 * @param {string} headerValue
 * @param {string} outputHeaderName
 * @return {Promise<string | string[] | undefined>}
 */
export function httpGETHeader(
    url,
    headerName,
    headerValue,
    outputHeaderName) {

    /** @type {string} */
    const urlStr = toURLString(url);

    // return new pending promise
    return new Promise((resolve, reject) => {
        // select http or https module, depending on reqested url
        const lib = urlStr.startsWith('https') ? https : http;
        const headers = {
            [headerName]: headerValue
        };
        const req_options = { method: 'GET', headers: headers };
        const request = lib.request(urlStr, req_options, (response) => {
            assert(response.statusCode);
            if (response.statusCode < 200 || response.statusCode > 299) {
                const errobj = { statusCode: response.statusCode };
                reject(new Error(JSON.stringify(errobj)));
            }
            const headers = response.headers;
            if (headers && headers[outputHeaderName]) {
                resolve(headers[outputHeaderName]);
            } else {
                reject(`No such header ${outputHeaderName}`);
            }
        });
        request.on('error', (err) => reject(err))
        request.end();
    });
}

/**
 * @param {string | URL} url 
 * @param {?string} path 
 * @param {?object} headers 
 * @param {object | string} body 
 * @return {Promise<string | any>}
 */
export function httpPOST(url, path, headers, body) {

    /** @type {string} */
    const urlStr = toURLString(url);

    // return new pending promise
    return new Promise((resolve, reject) => {
        // select http or https module, depending on reqested url
        const u = new URL(urlStr);
        const protocol = u.protocol;
        assert(protocol === 'http:' || protocol === 'https:');
        const lib = urlStr.startsWith('https') ? https : http;

        //const host = '127.0.0.1'; //u.hostname;
        const host = u.hostname;
        const port = u.port;

        const contentType = (typeof body === 'string') ?
            'text/plain' :
            'application/json';
        const bodyStr = (typeof body === 'string') ?
            body :
            JSON.stringify(body);
        const _headers = {
            'Content-Type': contentType,
            'Content-Length': Buffer.byteLength(bodyStr),
            ...headers
        };
        const request = lib.request({
            host: host,
            port: port,
            path: path,
            method: "POST",
            headers: _headers,
        }, (response) => {
            /** @type {string} */
            let str = '';
            response.setEncoding('utf8');
            assert(response.statusCode);
            if (response.statusCode < 200 || response.statusCode > 299) {
                const errobj = { statusCode: response.statusCode };
                reject(new CodeError(
                    JSON.stringify(errobj),
                    response.statusCode.toString()));
            }
            response.on('data', (chunk) => {
                str += chunk;
            });
            response.on('end', () => {
                let result = null;
                try {
                    result = JSON.parse(str);
                } catch (e) {
                    result = str;
                }
                resolve(result);
            });
            response.on('error', (err) => {
                reject(err);
            });
        });
        request.on('error', (err) => {
            reject(err);
        });
        request.write(bodyStr);
        request.end();
    });
}

/**
 * @param {string | URL} url 
 * @param {string} path 
 * @param {object} headers 
 * @param {object | string} body 
 * @return {Promise<string | object>}
 */
export function httpPUT(url, path, headers, body) {

    /** @type {string} */
    const urlStr = toURLString(url);

    // return new pending promise
    return new Promise((resolve, reject) => {
        // select http or https module, depending on reqested url
        const lib = urlStr.startsWith('https') ? https : http;

        const u = new URL(urlStr);
        assert(u.protocol === 'http:' || u.protocol === 'https:');
        assert(u.hostname === 'localhost');
        const host = '127.0.0.1'; //u.hostname;
        //const host = u.hostname;
        const port = u.port;

        const contentType = (typeof body === 'string') ?
            'text/plain' :
            'application/json';
        const bodyStr = (typeof body === 'string') ?
            body :
            JSON.stringify(body);
        const _headers = {
            'Content-Type': contentType,
            'Content-Length': Buffer.byteLength(bodyStr),
            ...headers
        };
        const request = lib.request({
            host: host,
            port: port,
            path: path,
            method: "PUT",
            headers: _headers,
        }, (response) => {
            let str = '';
            response.setEncoding('utf8');
            assert(response.statusCode);
            if (response.statusCode < 200 || response.statusCode > 299) {
                const errobj = { statusCode: response.statusCode };
                reject(new CodeError(
                    JSON.stringify(errobj),
                    response.statusCode.toString()));
            }
            response.on('data', (chunk) => {
                str += chunk;
            });
            response.on('end', () => {
                let result = null;
                try {
                    result = JSON.parse(str);
                } catch (e) {
                    result = str;
                }
                resolve(result);
            });
            response.on('error', (err) => {
                reject(err);
            });
        });
        request.on('error', (err) => {
            reject(err);
        });
        request.write(bodyStr);
        request.end();
    });
}
