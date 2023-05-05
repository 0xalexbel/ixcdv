import * as types from '../../common/common-types.js';
import * as pkgTypes from '../../pkgmgr/pkgmgr-types.js';
import * as ERROR_CODES from '../../common/error-codes.js'
import { commitAll } from '../../git/git-api.js';
import { patchBuildInfoIfNeeded, patchSettingsDotGradle } from '../patcher.js';
import { CodeError, fail } from '../../common/error.js';
import { PROD_NAME } from '../../common/consts.js';

/**
 * @param {types.Strict=} strict
 * @returns {types.FailedCodeError}
 */
function patchFail(strict) {
    return fail(
        new CodeError('iexec-blockchain-adapter-api patch failed.', ERROR_CODES.PKGMGR_ERROR),
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
        ok = await patchSettingsDotGradle(dir, setup);
        if (!ok) {
            throw null;
        }

        await patchBuildInfoIfNeeded(dir, setup, 'src/main/java/com/iexec/blockchain/version/VersionService.java');

        await commitAll(dir, `${PROD_NAME} install patch commit`, { strict: true });
    } catch (err) {
        return patchFail(options);
    }

    return { ok: true };
}