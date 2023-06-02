import * as types from '../../common/common-types.js';
import * as pkgTypes from '../../pkgmgr/pkgmgr-types.js';
import path from 'path';
import * as ERROR_CODES from '../../common/error-codes.js'
import { applyPatch, commitAll } from '../../git/git-api.js';
import { CodeError, fail } from '../../common/error.js';
import { PROD_NAME } from '../../common/consts.js';
import { fileURLToPath } from 'url';

const COMMITID='5138f2d2'; //v5.3 git commit hash
const PATCHFILE=`PoCo-from-${COMMITID}.patch`;
/**
 * @param {types.Strict=} strict
 * @returns {types.FailedCodeError}
 */
function patchFail(strict) {
    return fail(
        new CodeError('PoCo patch failed.', ERROR_CODES.PKGMGR_ERROR),
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

    try {
        // find ./cli/src/patch/PoCo/patch.js absolute pathname
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const patchFilename = path.join(__dirname, PATCHFILE);
        await applyPatch(dir, patchFilename, { strict: true });
        await commitAll(dir, `${PROD_NAME} install patch commit`, { strict: true });
    } catch (err) {
        return patchFail(options);
    }

    return { ok: true };
}