import * as types from '../common/common-types.js';
import * as srvTypes from './services-types-internal.js';
import path from 'path';
import assert from 'assert';
import { parseEnvVars as utilsParseEnvVars } from '../common/utils.js';
import { Wallet } from 'ethers';
import { inplaceResolveSpringServicePlaceholders, installServiceClassPackage, pidToSpringConstructorArgs, SpringHubServerService } from './spring-serverservice.js';
import { parseApplicationYmlFile } from './application-dot-yml.js';
import { DBDirectory } from '../common/db-directory.js';
import { getLatestVersion } from '../git/git-api.js';
import { dirExists, fileExists, resolveAbsolutePath, rmrfDir, throwIfDirDoesNotExist, throwIfNotAbsolutePath, toRelativePath } from '../common/fs.js';
import { toPackage, toPackageDirectory } from '../pkgmgr/pkg.js';
import { isNullishOrEmptyString, placeholdersPropertyReplace, throwIfNullishOrEmptyString } from '../common/string.js';
import { PoCoHubRef } from '../common/contractref.js';
import { checkSecret, checkWeb3Secret, pushWeb2Secret, pushWeb3Secret } from '../common/secrets.js';
import { GanachePoCoService } from '../poco/GanachePoCoService.js';
import { envVarName, PROD_VAR_PREFIX } from '../common/consts.js';

const SMS_DOMAIN = 'IEXEC_SMS_DOMAIN';
const SMS_DEFAULT_TEE_PROFILE = 'gramine';

/**
 * @typedef {srvTypes.SpringHubServerServiceConstructorArgs & 
 * {
 *      dbDirectory?: string
 *      dbDir?: DBDirectory
 * }} SmsServiceConstructorArgs
 */

/* -------------------------- SmsService Class ------------------------------ */

export class SmsService extends SpringHubServerService {

    /** 
     * @override
     * @returns {typeof SmsService} 
     */
    theClass() { return SmsService; }

    static typename() { return 'sms'; }

    static CLASSNAME() { return 'com.iexec.sms.' + SmsService.ENTRY(); }
    static ENTRY() { return 'App'; }

    CLASSNAME() { return SmsService.CLASSNAME(); }
    ENTRY() { return SmsService.ENTRY(); }

    /** @type {boolean} */
    static #guardConstructing = false;

    /** @type {string=} */
    #dbDirectory;
    /** @type {DBDirectory=} */
    #dbDir;

    /** @override */
    static get defaultGitUrl() {
        return 'https://github.com/iExecBlockchainComputing/iexec-sms.git';
    }
    /** @override */
    static get gitHubRepoName() { return 'iexec-sms'; }

    /** @type {string} */
    static #latestVersion;

    /** @override */
    static async latestVersion() {
        if (!SmsService.#latestVersion) {
            SmsService.#latestVersion = await getLatestVersion(this.defaultGitUrl);
        }
        return SmsService.#latestVersion;
    }

    /** @param {SmsServiceConstructorArgs} args */
    constructor(args) {
        if (!SmsService.#guardConstructing) {
            throw new TypeError('class constructor is not accessible');
        }

        super(args);

        this.#dbDirectory = args.dbDirectory;
        this.#dbDir = args.dbDir;
    }

    /** @param {SmsServiceConstructorArgs} args */
    static #newSmsService(args) {
        try {
            SmsService.#guardConstructing = true;
            const o = new SmsService(args);
            SmsService.#guardConstructing = false;
            return o;
        } catch (err) {
            SmsService.#guardConstructing = false;
            throw err;
        }
    }

    /** 
     * - if `resolvePlaceholders === true` : may retrieve repo latest version from github 
     * @param {srvTypes.SmsConfig} config 
     * @param {boolean} resolvePlaceholders
     * @param {{[varname:string]: string}} placeholders
     * @param {string=} relativeToDirectory
     */
    static async deepCopyConfig(config, resolvePlaceholders, placeholders, relativeToDirectory) {
        const configCopy = await super.deepCopyConfig(
            config,
            false, /* replace is performed below, because of extra properties */
            placeholders,
            relativeToDirectory);
        assert(configCopy.type === 'sms');

        if (!configCopy.hostname && placeholders) {
            configCopy.hostname = placeholders["${defaultHostname}"];
        }

        if (relativeToDirectory) {
            configCopy.dbDirectory = toRelativePath(relativeToDirectory, config.dbDirectory);
        }

        if (resolvePlaceholders) {
            // Warning : 'configCopy.repository' is calculated in 'super.deepCopyConfig(...)'
            // if needed, retrieves latest version on github
            const gitHubRepo = await this.getGitHubRepo(toPackage(configCopy.repository));
            inplaceResolveSpringServicePlaceholders(
                configCopy, ["dbDirectory"],
                {
                    ...placeholders,
                    "${version}": gitHubRepo.commitish,
                    "${repoName}": gitHubRepo.gitHubRepoName,
                });
        }

        return configCopy;
    }

    toJSON() {
        return {
            ... super.toJSON(),
            dbDirectory: this.#dbDirectory,
        };
    }

    /** @override */
    get DBUUID() {
        const dbuuid = super.DBUUID;
        if (this.#dbDir) {
            assert(dbuuid === this.#dbDir.DBUUID);
        }
        return dbuuid;
    }

    /** @override */
    get canStart() {
        if (!super.canStart) {
            return false;
        }
        if (isNullishOrEmptyString(this.#dbDir?.directory)) {
            return false;
        }
        return true;
    }

    /** 
     * @protected
     * @override 
     */
    async isBusyOverride() {
        /** @todo not yet implemented */
        await super.isBusyOverride();
    }

    /* -------------------------- Private ENV Vars -------------------------- */

    /**
     * @override
     * @param {string} str 
     */
    parseEnvVars(str) { return SmsService.parseEnvVars(str); }

    /**
     * @override
     * @param {string} str 
     * @returns {SmsServiceConstructorArgs}
     */
    static parseEnvVars(str) {
        const env = super.parseEnvVars(str);
        const varNames = [
            envVarName('DBDIRECTORY')
        ];
        const o = utilsParseEnvVars(varNames, str);
        return {
            ...env,
            dbDirectory: o[envVarName('DBDIRECTORY')],
        }
    }

    /**
     * @override
     * @param {{[envName:string] : string}} extras
     * @returns {Promise<{[envName:string] : string}>}
     */
    async getEnvVars(extras) {
        const env = await super.getEnvVars(extras);

        if (this.#dbDirectory) {
            env[envVarName('DBDIRECTORY')] = this.#dbDirectory;
        }

        return env;
    }

    /* ------------------------------ Reset ------------------------------- */

    /**
      * @override
      * @param {number | undefined} pid 
      * @param {types.StopOptionsWithContext=} options
      */
    async onStoppedOverride(pid, options) {
        if (options?.reset === true) {
            if (this.#dbDirectory) {
                SmsService.resetDB({ dbDirectory: this.#dbDirectory });
            }
        }
    }

    /**
     * Throws an exception if failed.
     * @param {{
    *      dbDirectory: string,
    * }} params
    */
    static async resetDB({
        dbDirectory,
    }) {
        throwIfNullishOrEmptyString(dbDirectory);

        dbDirectory = resolveAbsolutePath(dbDirectory);

        await rmrfDir(dbDirectory);
        await DBDirectory.install({ type: 'h2', directory: dbDirectory, filename: 'sms-h2' });
    }

    /* ------------------------------ Install ------------------------------- */

    /**
      * Throws an exception if failed.
      * @param {{
      *      repository: (string | types.Package),
      *      version?: string
      *      branch?: string
      *      dbDirectory: string,
      * }} params
      */
    static async install({
        repository,
        version,
        branch,
        dbDirectory,
    }) {
        await installServiceClassPackage(this, { repository, version, branch });

        const exists = dirExists(dbDirectory);

        // Throws exception if failed
        const dbDir = (exists) ?
            await DBDirectory.load({ type: 'h2', directory: dbDirectory, filename: 'sms-h2' }) :
            await DBDirectory.install({ type: 'h2', directory: dbDirectory, filename: 'sms-h2' });
    }

    /* ---------------------------- newInstance ----------------------------- */

    /**
     * Throws an exception if failed
     * @param {types.ServerServiceArgs & {
     *      repository: (string | types.Package),
     *      hub: (string | types.PoCoHubRefLike | PoCoHubRef),
     *      springConfigLocation: string
     *      ymlConfig: any
     *      dbDirectory: string
     * }} params
     * @param {srvTypes.InventoryLike=} inventory
     */
    static async newInstance({
        repository,
        springConfigLocation,
        dbDirectory,
        hub,
        ymlConfig,
        ...options
    }, inventory) {

        ymlConfig ??= {};

        // Does not resolve anything
        let repoDir = toPackageDirectory(repository);
        throwIfNotAbsolutePath(repoDir);

        throwIfNullishOrEmptyString(springConfigLocation);
        throwIfNullishOrEmptyString(dbDirectory);
        throwIfNotAbsolutePath(dbDirectory);
        throwIfNotAbsolutePath(springConfigLocation);

        // cleanup paths
        repoDir = resolveAbsolutePath(repoDir);
        springConfigLocation = resolveAbsolutePath(springConfigLocation);
        dbDirectory = resolveAbsolutePath(dbDirectory);

        throwIfDirDoesNotExist(repoDir);
        //throwIfDirDoesNotExist(dbDirectory);

        /** 
         * @type {{
        *      service: GanachePoCoService
        *      PoCoHubRef: PoCoHubRef
        *   }}
        */
        let resolved;
        if (inventory) {
            // Throws an exception if failed.
            resolved = await inventory.resolve(hub);
        } else {
            // Resolve by fetching a running ganache server
            // Throws an exception if failed.
            resolved = await GanachePoCoService.resolveHub(hub);
        }

        const resolvedHubRef = resolved.PoCoHubRef;
        const resolvedGanache = resolved.service;
        assert(resolvedGanache.DBUUID);

        /* -------------------- Compute Final Yml Config -------------------- */

        const ymlFileLocation = path.join(repoDir, 'src/main/resources');
        const ymlFullConfig = await parseApplicationYmlFile(ymlFileLocation, { merge: ymlConfig });

        /** @type {'scone' | 'gramine'} */
        const profile = SMS_DEFAULT_TEE_PROFILE; // 'scone' or 'gramine'
        let v7 = false;
        let v8 = false;

        // In v8, application.yml is splitted between a common set of properties and 
        // a tee-specific set of properties ('scone' or 'gramine')
        // As a workaround, we parse the 2 files and generate a full merge
        const gramineYmlConfigFile = path.join(ymlFileLocation, 'application-gramine.yml');
        const sconeYmlConfigFile = path.join(ymlFileLocation, 'application-scone.yml');
        let ymlFullTeeConfig = null;
        if (fileExists(sconeYmlConfigFile)) {
            assert(fileExists(gramineYmlConfigFile));
            v8 = true;
            ymlFullTeeConfig = await parseApplicationYmlFile(ymlFileLocation, { profile, merge: ymlConfig });
            assert(ymlFullTeeConfig);
            assert(ymlFullTeeConfig.tee);
        } else {
            v7 = true;
        }

        // v7.x.x
        // Property : ymlFullConfig.server.http.port is defined
        // v8.x.x
        // Property : ymlFullConfig.server.port is defined
        // Property : ymlFullConfig.server.http.port is NOT defined

        if (ymlFullConfig.server?.http?.port !== undefined) {
            ymlFullConfig.server.http.port = options.port;
        } else {
            ymlFullConfig.server.port = options.port;
        }

        if (ymlFullConfig.encryption?.aesKeyPath) {
            ymlFullConfig.encryption.aesKeyPath = path.join(springConfigLocation, 'iexec-sms-aes.key');
        }

        ymlFullConfig.blockchain.id = resolvedHubRef.chainid;
        ymlFullConfig.blockchain['node-address'] = resolvedHubRef.httpHost;
        ymlFullConfig.blockchain['hub-address'] = resolvedHubRef.address;
        ymlFullConfig.blockchain['is-sidechain'] = resolvedHubRef.isNative ?? false;

        if (ymlFullTeeConfig) {
            // v8
            assert(v8);
            const tee = ymlFullTeeConfig.tee;
            const worker = tee.worker;
            //@ts-ignore
            if (profile === 'scone') {
                const scone = tee.scone;
                // If not specified, set dummy values
                if (isNullishOrEmptyString(scone['las-image'])) {
                    scone['las-image'] = 'dummy-iexec-las:x.y.z';
                }
            } else if (profile === 'gramine') {
                /** @todo not yet implemented */
                //assert(false, 'TODO: not yet implemented');
            }

            if (isNullishOrEmptyString(worker['pre-compute'].image)) {
                //worker['pre-compute'].image = 'dummy-iexec-tee-worker-pre-compute-image:x.y.z';
                worker['pre-compute'].image = 'ubuntu:latest';
                worker['pre-compute'].entrypoint = '/bin/bash';
            }
            if (isNullishOrEmptyString(worker['pre-compute'].fingerprint)) {
                worker['pre-compute'].fingerprint = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
            }
            if (isNullishOrEmptyString(worker['post-compute'].image)) {
                //worker['post-compute'].image = 'dummy-iexec-tee-worker-post-compute-image:x.y.z';
                worker['post-compute'].image = 'ubuntu:latest';
                worker['post-compute'].entrypoint = '/bin/bash';
            }
            if (isNullishOrEmptyString(worker['post-compute'].fingerprint)) {
                worker['post-compute'].fingerprint = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
            }

            // setup the active profile (v8 only)
            assert(ymlFullConfig.spring.profiles);
            assert(ymlFullConfig.spring.profiles.active !== undefined);
            ymlFullConfig.spring.profiles.active = profile;

            // Merge the whole 'tee' section into the full yml config
            ymlFullConfig.tee = ymlFullTeeConfig.tee;
        } else {
            // v7
            assert(v7);
            //@ts-ignore
            assert(profile === 'scone');
            const tee = ymlFullConfig['tee.workflow'];
            assert(tee);
            if (tee) {
                // If not specified, set dummy values
                if (isNullishOrEmptyString(tee['las-image'])) {
                    tee['las-image'] = 'dummy-iexec-las:x.y.z';
                }
                if (isNullishOrEmptyString(tee['pre-compute'].image)) {
                    tee['pre-compute'].image = 'dummy-iexec-tee-worker-pre-compute-image:x.y.z';
                }
                if (isNullishOrEmptyString(tee['pre-compute'].fingerprint)) {
                    tee['pre-compute'].fingerprint = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
                }
                if (isNullishOrEmptyString(tee['post-compute'].image)) {
                    tee['post-compute'].image = 'dummy-iexec-tee-worker-post-compute-image:x.y.z';
                }
                if (isNullishOrEmptyString(tee['post-compute'].fingerprint)) {
                    tee['post-compute'].fingerprint = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
                }
            }
        }

        // Will be set when the final directory will be available
        ymlFullConfig.spring.datasource.url = '';

        /* ------------------------ Compute Signature ----------------------- */

        // Compute sms data signature
        // Postulate, signature mismatch if:
        // - ganache DB has changed
        // - sms is started on different hub 
        const requestedDBSignature = SmsService.#computeDBSignature({
            hubRef: resolvedHubRef,
            ganacheDBUUID: resolvedGanache.DBUUID,
            ymlConfig: ymlFullConfig
        });

        // Throws an exception if failed (or sig conflict)
        const dbDir = await DBDirectory.load({
            type: 'h2',
            directory: dbDirectory,
            filename: 'sms-h2',
            requestedDBSignature: requestedDBSignature
        });

        const dbFile = dbDir.DBFileNoExt;
        if (dbFile) {
            // Adujst yml config with the final pathname
            ymlFullConfig.spring.datasource.url = 'jdbc:h2:file:' + dbDir.DBFileNoExt;
        } else {
            // remote
            ymlFullConfig.spring.datasource.url = undefined;
        }

        return SmsService.#newSmsService({
            ...options,
            ymlConfig: ymlFullConfig,
            repoDir,
            hub: resolvedHubRef,
            dbDirectory,
            dbDir,
            DBUUID: dbDir.DBUUID,
            springConfigLocation
        });
    }

    /**
     * Throws an exception if failed.
     * @param {{
     *      hubRef: PoCoHubRef,
     *      ganacheDBUUID: string
     *      ymlConfig: any
     * }} params
     * @returns {types.DBSignatureArg}
     */
    static #computeDBSignature({
        hubRef,
        ganacheDBUUID,
        ymlConfig
    }) {
        assert(ganacheDBUUID);
        assert(hubRef);
        assert(hubRef.resolved);
        assert(hubRef.address);
        assert(hubRef.asset);
        assert(hubRef.kyc != null);
        assert(hubRef.uniswap != null);

        /** @type {types.DBSignatureArg} */
        const sig = {
            name: `${PROD_VAR_PREFIX}sms`,
            serviceType: SmsService.typename(),
            /** @type {types.DBHubSignature} */
            signature: {
                ganacheDBUUID: ganacheDBUUID,
                hub: {
                    chainid: hubRef.chainid,
                    contractName: hubRef.contractName,
                    address: hubRef.address,
                    asset: hubRef.asset,
                    kyc: hubRef.kyc,
                    uniswap: hubRef.uniswap
                }
            }
        };
        return sig;
    }

    /* ------------------------------ fromPID ------------------------------- */

    /**
     * @override
     * @param {number} pid 
     */
    static async fromPID(pid) {
        const args = await pidToSpringConstructorArgs(pid, this.parseEnvVars);

        if (!args) {
            return null;
        }
        if (!args.dbDirectory) {
            return null;
        }

        assert(args.port);
        assert(args.hub);

        // Verify yml config
        if (args.ymlConfig) {
            const ymlConfig = args.ymlConfig;
            const hub = args.hub;

            const ethURL = new URL(ymlConfig.blockchain['node-address']);
            const isNative = (ymlConfig.blockchain['is-sidechain'] === true);
            const asset = (isNative) ? 'Native' : 'Token';

            assert(ymlConfig.spring.datasource.url);
            assert(ymlConfig.spring.datasource.url.startsWith(`jdbc:h2:file:${args.dbDirectory}`));
            // Cannot perform such a check because ymlConfig is changing from version to version
            //assert(args.port === ymlConfig.server.http.port);
            assert(hub.chainid === ymlConfig.blockchain.id);
            assert(hub.address === ymlConfig.blockchain['hub-address']);
            assert(hub.asset === asset);
            assert(hub.url?.toString() === ethURL.toString());

            // A few asserts to make sure everything is consistant
            if (hub.isNative) {
                assert(ymlConfig.blockchain['is-sidechain'] === true);
            } else {
                assert(ymlConfig.blockchain['is-sidechain'] === false);
            }
        }

        // instanciate DB Object
        let dbDir;
        try {
            dbDir = await DBDirectory.load({
                type: 'h2',
                directory: args.dbDirectory,
                filename: 'sms-h2'
            });
        } catch { }

        if (dbDir) {
            if (args.DBUUID !== dbDir.DBUUID) {
                // - process was launched on an old db directory version
                // - process does not include the DBUUID env var
                dbDir = undefined;
            }
        } else {
            dbDir = undefined;
        }

        args.dbDir = dbDir;

        return SmsService.#newSmsService(args);
    }

    /**
     * @param {string} ownerAddress checksumaddress
     */
    async checkIpfsSecret(ownerAddress) {
        const ok = await this.checkWeb2Secret(ownerAddress, 'iexec-result-iexec-ipfs-token');
        return ok;
    }

    /**
     * @param {Wallet} signer
     * @param {string} secretValue 
     * @param {boolean} forceUpdate 
     */
    async pushIpfsSecret(signer, secretValue, forceUpdate) {
        return this.pushWeb2Secret(signer, 'iexec-result-iexec-ipfs-token', secretValue, forceUpdate);
    }

    /**
     * @param {string} datasetAddress checksumaddress
     */
    async checkDatasetSecret(datasetAddress) {
        const ok = await this.checkWeb3Secret(datasetAddress);
        return ok;
    }

    /**
     * @param {Wallet} signer
     * @param {string} datasetAddress 
     * @param {string} secretValue 
     */
    async pushDatasetSecret(signer, datasetAddress, secretValue) {
        return this.pushWeb3Secret(signer, datasetAddress, secretValue);
    }

    /**
     * @param {string} ownerAddress checksumaddress
     */
    async checkDropboxSecret(ownerAddress) {
        return this.checkWeb2Secret(ownerAddress, 'iexec-result-dropbox-token');
    }

    /**
     * @param {string} ownerAddress checksumaddress
     * @param {string} secretName 
     */
    async checkWeb2Secret(ownerAddress, secretName) {
        const ok = await checkSecret(this.url, ownerAddress, secretName);
        return ok;
    }

    /**
     * @param {string} secretAddress checksumaddress
     */
    async checkWeb3Secret(secretAddress) {
        const ok = await checkWeb3Secret(this.url, secretAddress);
        return ok;
    }

    /**
     * @param {Wallet} signer 
     * @param {string} secretName 
     * @param {string} secretValue 
     * @param {boolean} forceUpdate 
     */
    async pushWeb2Secret(signer, secretName, secretValue, forceUpdate) {
        return pushWeb2Secret(this.url, SMS_DOMAIN, signer, secretName, secretValue, forceUpdate);
    }

    /**
     * @param {Wallet} signer 
     * @param {string} secretAddress 
     * @param {string} secretValue 
     */
    async pushWeb3Secret(signer, secretAddress, secretValue) {
        return pushWeb3Secret(this.url, SMS_DOMAIN, signer, secretAddress, secretValue);
    }
}
