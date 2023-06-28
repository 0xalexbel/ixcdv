/* package.json, 'bin' entry */
export const PROD_BIN = 'ixcdv';
/* package.json, 'name' entry */
export const PROD_NAME = 'ixcdv';
export const PROD_VERSION = '1.0.0';
export const PROD_DIRNAME = 'ixcdv';
export const PROD_FILE_EXT = 'ixcdv';
export const PROD_VAR_PREFIX = 'ixcdv';
export const PROD_FILE_PREFIX = 'ixcdv';
export const PROD_COMMITISH_PREFIX = 'ixcdv';
export const PROD_CONFIG_BASENAME = `${PROD_FILE_PREFIX}-config.json`;
export const PROD_DBSIG_BASENAME = `${PROD_FILE_PREFIX}-signature.json`;
export const PROD_TMP_DIR = `/tmp/${PROD_DIRNAME}`;
export const PROD_PRIVATE_LOCAL_DOCKER_REGISTRY_NAME = 'ixcdv-registry';

export const WORKERPOOL_NAME = 'default.pools.iexec.eth';
export const WORKERPOOL_URL_TEXT_RECORD_KEY = 'iexec:workerpool-api:url';

const PROD_DOCKERNAME = 'ixcdv';
const PROD_ENV_VAR_PREFIX = 'IXCDV'; 

/** @param {string} s */
export function envVarName(s) {
    return PROD_ENV_VAR_PREFIX + '_' + s.toUpperCase();
}
