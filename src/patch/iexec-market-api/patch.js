import * as path from 'path';
import * as types from '../../common/common-types.js';
import * as pkgTypes from '../../pkgmgr/pkgmgr-types.js';
import * as ERROR_CODES from '../../common/error-codes.js'
import { commitAll } from '../../git/git-api.js';
import { CodeError, fail } from '../../common/error.js';
import { replaceInFileUsingSed } from '../../common/fs.js';
import { PROD_NAME } from '../../common/consts.js';

/**
 * @param {types.Strict=} strict
 * @returns {types.FailedCodeError}
 */
function patchFail(strict) {
    return fail(
        new CodeError('iexec-market-api patch failed.', ERROR_CODES.PKGMGR_ERROR),
        strict);
}

/**
 * @param {!string} dir 
 * @param {pkgTypes.Setup} setup 
 * @param {types.Strict=} options
 * @returns {types.PromiseOkOrCodeError}
 */
export async function patch(dir, setup, options = { strict: false }) {
    const gitHubRepo = setup.directories[dir].pkgArg.gitHubRepoName;
    console.log(`Patch ${gitHubRepo} !!! at=` + dir);

    let ok;

    try {
        ok = await replaceInFileUsingSed(
            '? `mongodb://${MONGO_HOST}:27017/`',
            '? `mongodb://${MONGO_HOST}/`',
            path.join(dir, 'api/src/config.js'),
            '#');
        if (!ok) { 
            throw null; 
        }

        ok = await replaceInFileUsingSed(
            '? `mongodb://${MONGO_HOST}:27017/`',
            '? `mongodb://${MONGO_HOST}/`',
            path.join(dir, 'watcher/src/config.js'),
            '#');
        if (!ok) { 
            throw null; 
        }

        await commitAll(dir, `${PROD_NAME} install patch commit`, { strict: true });
    } catch (err) {
        return patchFail(options);
    }

    return { ok: true };
}