import * as types from './types.js';
import * as ERROR_CODES from './error-codes.js';
import path from 'path';
import assert from 'assert';
import { isDeepStrictEqual } from 'util';
import { randomUUID } from 'crypto';
import { CodeError } from './error.js';
import { PROD_DBSIG_BASENAME } from './consts.js';
import { isNullishOrEmptyString, throwIfNullishOrEmptyString } from './string.js';
import { dirExists, dirIsEmptySync, fileExists, mkDirP, parentDirExists, readFileSync, readObjectFromJSONFile, resolveAbsolutePath, saveToFileSync, throwIfDirAlreadyExists, throwIfDirDoesNotExist, throwIfParentDirDoesNotExist } from './fs.js';

const DBUUID_BASENAME = 'DBUUID';

/* -------------------- DBDirectory Class ----------------------- */

export class DBDirectory {

    /** @type {boolean} */
    static #guardConstructing = false;

    /** @type {string} */
    #directory;

    /** @type {string=} */
    #DBUUID;

    /** @type {types.DBSignatureDict=} */
    #signatureDict;

    /** @type {'mongo' | 'redis' | 'h2'} */
    #dbType;

    /** @type {string=} */
    #dbFilename;

    /**
     * @typedef {{
     *      type: ('mongo' | 'redis'),
     *      directory: string,
     * }} DBDirectoryArgs
     *
     * @typedef {{
     *      type: ('h2'),
     *      directory: string,
     *      filename: string
     * }} DBDirectoryH2Args
     */

    /**
     * @param {DBDirectoryArgs | DBDirectoryH2Args} args
     * @throws {Error}
     */
    constructor(args) {
        if (!DBDirectory.#guardConstructing) {
            throw new TypeError('class constructor is not accessible');
        }

        throwIfNullishOrEmptyString(args.directory);
        assert(args.type === 'h2' || args.type === 'mongo' || args.type === 'redis');

        if (args.type === 'h2') {
            if (isNullishOrEmptyString(args.filename)) {
                throw new CodeError('Missing h2 db filename.', ERROR_CODES.DBDIR_ERROR);
            }
        }

        this.#dbType = args.type;
        this.#directory = resolveAbsolutePath(args.directory);

        if (args.type === 'h2') {
            this.#dbFilename = args.filename;
        }
    }

    get DBType() {
        return this.#dbType;
    }
    get directory() {
        return this.#directory;
    }
    get signatureDict() {
        return this.#signatureDict;
    }
    get DBUUID() {
        return this.#DBUUID;
    }
    get DBDir() {
        // remote
        if (!this.#DBUUID) {
            return undefined;
        }
        assert(this.#DBUUID);
        return path.join(this.#directory, this.#DBUUID);
    }
    get DBFileNoExt() {
        // remote
        if (!this.DBDir) {
            return undefined;
        }
        assert(this.#dbFilename);
        return path.join(this.DBDir, this.#dbFilename);
    }

    /**
     * @param {types.DBSignatureArg | null | undefined} sigArg 
     */
    isSigCompatible(sigArg) {
        if (!this.#signatureDict) {
            return true;
        }
        if (!sigArg) {
            return true;
        }

        const sig1 = { serviceType: sigArg.serviceType, signature: sigArg.signature };
        const sig2 = this.#signatureDict[sigArg.name];

        if (!sig2) {
            return true;
        }
        return isDeepStrictEqual(sig1, sig2);
    }

    /**
     * Throws an exception if save sig failed.
     * @param {types.DBSignatureArg | null | undefined} sigArg 
     */
    addSig(sigArg) {
        if (!sigArg) {
            return true;
        }

        assert(!isNullishOrEmptyString(sigArg.name));

        if (!this.#signatureDict) {
            this.#signatureDict = {};
        }

        const sig1 = { serviceType: sigArg.serviceType, signature: sigArg.signature };
        const sig2 = this.#signatureDict[sigArg.name];

        if (!sig2) {
            this.#signatureDict[sigArg.name] = sig1;
            DBDirectory.#saveSignatureDictSync(this.#directory, this.#signatureDict);
            return true;
        }

        return isDeepStrictEqual(sig1, sig2);
    }

    /**
     * Throws an exception if save sig failed.
     * @param {string} sigName 
     */
    getSig(sigName) {
        if (isNullishOrEmptyString(sigName)) {
            return null;
        }

        if (!this.#signatureDict) {
            return null;
        }

        return this.#signatureDict[sigName];
    }

    /**
     * @param {string} serviceType 
     */
    usedByServiceType(serviceType) {
        if (!this.#signatureDict) {
            return false;
        }
        const names = Object.keys(this.#signatureDict);
        for (let i = 0; i < names.length; ++i) {
            const sig = this.#signatureDict[names[i]];
            if (sig.serviceType === serviceType) {
                return true;
            }
        }
        return false;
    }

    toJSON() {
        /** @type {any} */
        const json = {
            directory: this.#directory,
            type: this.#dbType
        };
        if (this.#DBUUID) { json['DBUUID'] = this.#DBUUID; }
        if (this.#signatureDict) { json['signatureDict'] = this.#signatureDict; }
        if (this.#dbFilename) { json['filename'] = this.#dbFilename; }
        return json;
    }

    /** 
     * @param {string} dir 
     * @param {string=} DBUUID 
     */
    static #computeDBDir(dir, DBUUID) {
        const _DBUUID = DBUUID ?? DBDirectory.#readDBUUID(dir);
        if (!_DBUUID) {
            return;
        }
        return path.join(dir, _DBUUID);
    }

    /** @param {string} dir */
    static #readDBUUID(dir) {
        return readFileSync(
            DBDirectory.#getDBUUIDFile(dir),
            { strict: false });
    }

    /** 
     * @param {string} dir 
     * @param {string} dbFilename 
     */
    static #isValidH2Dir(dir, dbFilename) {
        if (!dir) {
            return false;
        }
        if (dirIsEmptySync(dir)) {
            return true;
        }
        if (!fileExists(path.join(dir, dbFilename + '.mv.db'))) { return false; }
        return true;
    }

    /** @param {string} dir */
    static #isValidMongoDir(dir) {
        if (!dir || isNullishOrEmptyString(dir)) {
            return false;
        }
        if (dirIsEmptySync(dir)) {
            return true;
        }
        return true;
    }

    /** @param {string} dir */
    static #isValidRedisDir(dir) {
        if (!dir || isNullishOrEmptyString(dir)) {
            return false;
        }
        if (dirIsEmptySync(dir)) {
            return true;
        }
        return true;
    }

    /** 
     * @param {('mongo' | 'redis' | 'h2')} dbType
     * @param {string} dir 
     * @param {?string=} dbFilename 
     */
    static #isValidDBDir(dbType, dir, dbFilename) {
        if (dbType === 'h2') {
            if (!dbFilename) {
                return false;
            }
            return DBDirectory.#isValidH2Dir(dir, dbFilename);
        }
        if (dbType === 'mongo') { return DBDirectory.#isValidMongoDir(dir); }
        if (dbType === 'redis') { return DBDirectory.#isValidRedisDir(dir); }

        throw new CodeError(`Unknown dbType argument ${dbType}`)
    }

    /**
     * @param {string} dir 
     */
    static #getSignatureFile(dir) {
        return path.join(dir, PROD_DBSIG_BASENAME);
    }
    /**
     * @param {string} dir 
     */
    static #getDBUUIDFile(dir) {
        return path.join(dir, DBUUID_BASENAME);
    }

    /**
     * Throws an exception if failed
     * @param {string} directory
     * @param {types.DBSignatureDict=} signatureDict
     */
    static async #install(directory, signatureDict) {
        throwIfDirAlreadyExists(directory);

        mkDirP(directory, { strict: true });

        const DBUUID = randomUUID({ disableEntropyCache: true }).replaceAll('-', '');
        saveToFileSync(DBUUID, directory, DBUUID_BASENAME, { strict: true });

        const dbDir = DBDirectory.#computeDBDir(directory, DBUUID);
        assert(dbDir);

        mkDirP(dbDir, { strict: true });

        // Save signature if any
        DBDirectory.#saveSignatureDictSync(directory, signatureDict);

        return DBUUID;
    }

    /**
     * Throws an exception if failed
     * @param {string} directory
     * @param {types.DBSignatureDict=} signatureDict
     */
    static #saveSignatureDictSync(directory, signatureDict) {
        const sigFile = DBDirectory.#getSignatureFile(directory);

        if (signatureDict) {
            saveToFileSync(
                JSON.stringify(signatureDict, null, 2),
                path.dirname(sigFile),
                path.basename(sigFile),
                { strict: true });
        }
    }

    /**
     * Throws an exception if failed
     * @param {{
     *      type: ('mongo' | 'redis' | 'h2'),
     *      directory: string,
     *      filename?: string,
     *      signature?: types.DBSignatureArg 
   * }} params
     */
    static async install({ type, directory, filename, signature }) {
        assert(type === 'h2' || type === 'mongo' || type === 'redis');
        throwIfNullishOrEmptyString(directory);
        if (type === 'h2') {
            throwIfNullishOrEmptyString(filename);
        }

        directory = resolveAbsolutePath(directory);
        throwIfDirAlreadyExists(directory);
        if (!parentDirExists(directory)) {
            mkDirP(path.dirname(directory));
        }
        throwIfParentDirDoesNotExist(directory);

        /** @type {types.DBSignatureDict=} */
        let sig;
        if (signature) {
            sig = {
                [signature.name]: signature.signature
            }
        }

        const DBUUID = await DBDirectory.#install(directory, sig);
        assert(!isNullishOrEmptyString(DBUUID));

        let o = null;
        DBDirectory.#guardConstructing = true;
        try {
            if (type === 'h2') {
                // compiler
                assert(filename);
                o = new DBDirectory({
                    type: 'h2',
                    directory: directory,
                    filename: filename,
                });
            } else {
                o = new DBDirectory({
                    type: type,
                    directory: directory,
                });
            }
            o.#DBUUID = DBUUID;
            o.#signatureDict = sig;
        } catch (err) {
            DBDirectory.#guardConstructing = false;
            throw err;
        }
        DBDirectory.#guardConstructing = false;

        return o;
    }

    /**
     * @param {string} h2URL 
     */
    static async loadH2URL(h2URL) {
        const prefix = 'jdbc:h2:file:';
        if (!h2URL.startsWith(prefix)) {
            return null;
        }
        const h2Path = h2URL.substring(prefix.length);
        const dbDirectory = path.dirname(h2Path);
        const dbFilename = path.basename(h2Path);

        return await DBDirectory.load({
            type: 'h2',
            directory: dbDirectory,
            filename: dbFilename
        });
    }

    /**
     * Throws an exception if failed
     * @param {{
     *      type: ('mongo' | 'redis' | 'h2'),
     *      directory: string,
     *      requestedDBSignature?: types.DBSignatureArg 
     *      filename?: string
     * }} params
     */
    static async load({ type, directory, filename, requestedDBSignature }) {
        assert(type === 'h2' || type === 'mongo' || type === 'redis');
        if (type === 'h2') {
            throwIfNullishOrEmptyString(filename);
        }
        throwIfNullishOrEmptyString(directory);

        directory = resolveAbsolutePath(directory);
        const remote = !dirExists(directory);
        if (!remote) {
            throwIfDirDoesNotExist(directory);
        }

        const DBUUIDFile = DBDirectory.#getDBUUIDFile(directory);
        if (!fileExists(DBUUIDFile) && !remote) {
            throw new CodeError(`Invalid ${type} directory. DBUUID file '${DBUUIDFile}' does not exist`, ERROR_CODES.DBDIR_ERROR);
        }

        const DBUUID = DBDirectory.#readDBUUID(directory);
        if (isNullishOrEmptyString(DBUUID) && !remote) {
            throw new CodeError(`Invalid ${type} directory. Invalid DBUUID file '${DBUUIDFile}'`, ERROR_CODES.DBDIR_ERROR);
        }

        /** @type {types.DBSignatureDict=} */
        let signatureDict;

        if (!remote) {
            assert(DBUUID);

            const dbDir = DBDirectory.#computeDBDir(directory, DBUUID);
            assert(dbDir);

            // is it a valid db directory ?
            if (!this.#isValidDBDir(type, dbDir, filename)) {
                throw new CodeError(`Invalid ${type} db directory`, ERROR_CODES.DBDIR_ERROR);
            }

            const sigFile = DBDirectory.#getSignatureFile(directory);
            if (fileExists(sigFile)) {
                /** @type {types.DBSignatureDict} */
                const loadedSignatureDict = await readObjectFromJSONFile(
                    sigFile,
                    { strict: true });
                assert(loadedSignatureDict);

                if (requestedDBSignature) {
                    /** @type {types.DBSignatureItem} */
                    const reqSig = {
                        serviceType: requestedDBSignature.serviceType,
                        signature: requestedDBSignature.signature
                    };

                    const loadedSig = loadedSignatureDict[requestedDBSignature.name];
                    if (loadedSig) {
                        if (!isDeepStrictEqual(reqSig, loadedSig)) {
                            throw new CodeError(
                                `Incompatible ${type} db directory '${directory}' (signature mismatch)`,
                                ERROR_CODES.SIGNATURE_CONFLICT_ERROR);
                        }
                    } else {
                        loadedSignatureDict[requestedDBSignature.name] = reqSig;
                        DBDirectory.#saveSignatureDictSync(directory, loadedSignatureDict);
                    }
                }
                signatureDict = loadedSignatureDict;
            } else {
                if (requestedDBSignature) {
                    signatureDict = {
                        [requestedDBSignature.name]: {
                            serviceType: requestedDBSignature.serviceType,
                            signature: requestedDBSignature.signature
                        }
                    }
                    DBDirectory.#saveSignatureDictSync(directory, signatureDict);
                }
            }
        }

        let o = null;
        DBDirectory.#guardConstructing = true;
        try {
            if (type === 'h2') {
                assert(filename);
                o = new DBDirectory({
                    type: 'h2',
                    directory: directory,
                    filename: filename,
                });
            } else {
                o = new DBDirectory({
                    type: type,
                    directory: directory,
                });
            }
            o.#signatureDict = signatureDict;
            o.#DBUUID = DBUUID ?? undefined;
        } catch (err) {
            DBDirectory.#guardConstructing = false;
            throw err;
        }
        DBDirectory.#guardConstructing = false;

        return o;
    }

    /**
     * @param {{
    *      type: ('mongo' | 'redis' | 'h2'),
    *      dbDir: string, 
    *      filename?: string
    * }} params
    */
    static async loadDBDir({ type, dbDir, filename }) {

        assert(type === 'h2' || type === 'mongo' || type === 'redis');
        throwIfNullishOrEmptyString(dbDir);
        if (type === 'h2') {
            throwIfNullishOrEmptyString(filename);
        }

        dbDir = resolveAbsolutePath(dbDir);

        const dirname = path.dirname(dbDir);
        const basename = path.basename(dbDir);

        const _dbDir = await DBDirectory.load({ type, directory: dirname, filename });

        if (basename !== _dbDir?.DBUUID) {
            throw new CodeError('Inconsistent DBUUID', ERROR_CODES.DBDIR_ERROR);
        }

        return _dbDir;
    }
}