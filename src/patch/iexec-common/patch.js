import * as types from '../../common/common-types.js';
import * as pkgTypes from '../../pkgmgr/pkgmgr-types.js';
import * as ERROR_CODES from '../../common/error-codes.js'
import { CodeError, fail } from '../../common/error.js';

/**
 * @param {types.Strict=} strict
 * @returns {types.FailedCodeError}
 */
function patchFail(strict) {
    return fail(
        new CodeError('iexec-common patch failed.', ERROR_CODES.PKGMGR_ERROR),
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

    // const isMain = (dir === setup.mainDir);
    // if (!isMain) {
    //     // Replace project root name if not main project
    //     // rootProject.name = <dep-name> by rootProject.name = <dep-name>-<main-name>
    //     // Ex: rootProject.name = 'iexec-sms' by rootProject.name = 'iexec-sms-core'
    //     // Ex: rootProject.name = 'iexec-common' by rootProject.name = 'iexec-common-sms'
    //     let ok = await patchSettingsDotGradle(dir, setup);
    //     assert(ok);
    // }

    return { ok: true };
}