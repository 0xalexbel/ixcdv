import assert from 'assert';
import * as gitTypes from '../git/git-types.js';
import * as semver from 'semver';
import { isNullishOrEmptyString } from '../common/string.js';
import { isGitHash } from '../git/git-api.js';
import { PROD_COMMITISH_PREFIX } from '../common/consts.js';

/**
 * @param {?(string | Date)=} commitish1 
 * @param {?(string | Date)=} commitish2
 */
export function commitishEq(commitish1, commitish2) {
    if (commitish1 === commitish2) {
        return true;
    }
    if (!commitish1 && !commitish2) {
        return true;
    }
    if (!commitish1 || !commitish2) {
        return false;
    }
    if (typeof commitish1 !== typeof commitish2) {
        return false;
    }
    if (commitish1 instanceof Date) {
        assert(commitish2 instanceof Date);
        return commitish1.getTime() === commitish2.getTime();
    }
    return false;
}

/**
 * @param {!(string | Date)} commitish 
 */
export function commitishToString(commitish) {
    assert(commitish);
    if (commitish instanceof Date) {
        let s = commitish.toISOString();
        s = s.replaceAll(':', '_');
        return s;
    }
    assert(!isNullishOrEmptyString(commitish));

    let sv;
    try {
        sv = new semver.SemVer(commitish);
    } catch { }

    assert(sv);
    return "v" + sv.version;
}

/**
 * @param {*} commitish 
 */
export function validCommitish(commitish) {
    if (!commitish) {
        return false;
    }
    if (commitish instanceof Date) {
        if (commitish.toString() === 'Invalid Date') {
            return false;
        }
        return true;
    }
    if (commitish === 'latest') {
        return true;
    }
    if (!semver.valid(commitish)) {
        return false;
    }
    return true;
}

/**
 * @param {!(string | semver.SemVer | Date | gitTypes.GitCommitInfo)} commitish 
 * @param {!string} hash
 */
export function commitishToPrivateTag(commitish, hash) {
    if (!isGitHash(hash, hash.length)) {
        throw new TypeError('Invalid hash argument');
    }
    let s;
    if (commitish instanceof Date) {
        s = commitish.toISOString();
        if (s === 'Invalid Date') {
            throw new TypeError('Invalid commitish argument');
        }
        s = s.replaceAll(':', '_');
    } else if (commitish instanceof semver.SemVer) {
        s = commitish.toString();
    } else if (commitish === 'latest') {
        s = 'latest';
    } else if (typeof commitish === 'object') {
        if (!commitish.hash || !commitish.date) {
            throw new TypeError('Invalid commitish argument');
        }
        assert(commitish.hash === hash);
        if (commitish.ref === 'origin/HEAD') {
            s = 'latest';
        } else if (commitish.semver) {
            s = 'v' + commitish.semver.toString();
        } else if (commitish.date) {
            s = commitish.date.toISOString();
            if (s === 'Invalid Date') {
                throw new TypeError('Invalid commitish argument');
            }
            s = s.replaceAll(':', '_');
        } else {
            throw new TypeError('Invalid commitish argument');
        }
    } else {
        throw new TypeError('Invalid commitish argument');
    }

    const shortHash = hash.substring(0, 12);
    s = PROD_COMMITISH_PREFIX + "-" + s + "-" + shortHash;
    return s;
}

/**
 * @param {string} privateTag 
 * @returns {{
 *      commitish:('latest' | Date | semver.SemVer),
 *      shortHash:string
 * }?}
 */
export function commitishFromPrivateTag(privateTag) {
    if (isNullishOrEmptyString(privateTag)) {
        return null;
    }

    const prefix = PROD_COMMITISH_PREFIX + '-';
    if (!privateTag.startsWith(prefix)) {
        return null;
    }

    let s = privateTag.substring(prefix.length);
    if (s.charAt(s.length - 13) !== '-') {
        return null;
    }

    const shortHash = s.substring(s.length - 12);
    if (!isGitHash(shortHash, 12)) {
        return null;
    }

    const tagLen = s.length - shortHash.length - 1;
    s = s.substring(0, tagLen);

    if (s === 'latest') {
        return { commitish: 'latest', shortHash: shortHash };
    }

    if (s.startsWith('v')) {
        let sv = null;
        try {
            sv = new semver.SemVer(s);
            return { commitish: sv, shortHash: shortHash };
        } catch { }
        return null;
    }

    let d = new Date(s.replaceAll('_', ':'));
    if (d.toString() === 'Invalid Date') {
        return null;
    }

    return { commitish: d, shortHash: shortHash };
}
