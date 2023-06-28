// Dependencies
// ../common
// ../docker
import assert from 'assert';
import * as cTypes from '../contracts/contracts-types-internal.js';
import path from 'path';
import { fileExists, fileExistsInDir, getTemplatesDir, replaceInFile, throwIfDirDoesNotExist, throwIfFileDoesNotExist } from '../common/fs.js';
import { CodeError } from '../common/error.js';
import { isNullishOrEmptyString, removePrefix, stringIsPOSIXPortable, throwIfNullishOrEmptyString } from '../common/string.js';
import { dockerGetPrivateLocalImageChecksum, dockerImageBuild, dockerImageRemove, dockerImageRun, dockerPrivateLocalRegistryGetRepositoryChecksum, dockerPrivateLocalRegistryPush, dockerPrivateLocalRegistryStart, isDockerPrivateLocalRegistryRunning } from '../docker/docker-api.js';
import { autoDetectNPMPackage } from '../common/npm.js';
import { copyFileSync } from 'fs';

/**
 * @param {string} dockerfile
 * @param {string} dockerRepository 
 * @param {string} dockerTag 
 * @param {string} dockerRegistryUrl 
 * @param {string[]} buildArgs 
 * @param {boolean} rebuildDockerImage 
 * @returns {Promise<{ checksum: string, multiaddr: string }>}
 */
export async function computeDockerChecksumAndMultiaddr(
    dockerfile,
    dockerRepository,
    dockerTag,
    dockerRegistryUrl,
    buildArgs,
    rebuildDockerImage) {
    throwIfNullishOrEmptyString(dockerRegistryUrl);

    if (!fileExists(dockerfile)) {
        throw new CodeError(`Invalid app directory. Missing Dockerfile : '${dockerfile}'.`);
    }

    const imgRepo = dockerRepository;
    if (isNullishOrEmptyString(imgRepo)) { throw new CodeError('Invalid docker image repository'); }
    const imgTag = dockerTag;
    if (isNullishOrEmptyString(imgTag)) { throw new CodeError('Invalid docker image tag'); }

    const imgName = imgRepo + ":" + imgTag;

    const u = new URL(dockerRegistryUrl);
    const dockerRegistryHost = u.hostname + ':' + u.port;

    // -------------------------------------------
    // STEP 1 : Launch Docker Private Local Registry
    // -------------------------------------------

    // Make sure Docker private registry is running
    if (! await isDockerPrivateLocalRegistryRunning(dockerRegistryUrl)) {
        if (! await dockerPrivateLocalRegistryStart(dockerRegistryUrl)) {
            throw new CodeError(`Unable to start docker registry.`);
        }
        if (! await isDockerPrivateLocalRegistryRunning(dockerRegistryUrl)) {
            throw new CodeError(`Unable to start docker registry.`);
        }
    }

    // -------------------------------------------
    // STEP 2 : Check whether or not the Dockerfile 
    // is already published in the registry
    // - Post a request on the private registry and
    // retrieve the checksum
    // -------------------------------------------

    // check if the registry already contains the same docker repository + tag
    let checksum = await dockerPrivateLocalRegistryGetRepositoryChecksum(dockerRegistryUrl, imgRepo, imgTag);
    const currentChecksum = checksum;

    // -------------------------------------------
    // Do we have to re - build the Dockerfile ?
    // -------------------------------------------
    if (isNullishOrEmptyString(checksum) || rebuildDockerImage) {
        if (isNullishOrEmptyString(checksum)) {
            console.log(`Must build docker image. Docker repository '${dockerRegistryHost}/${imgName}' does not exist.`);
        }

        // -------------------------------------------
        // STEP 3 : Build Dockerfile
        // -------------------------------------------

        // reset checksum
        checksum = "";

        // Build the local image
        console.log(`Docker: image build '${imgName}'`);
        if (!await dockerImageBuild(imgName, dockerfile, buildArgs)) {
            throw new CodeError(`Docker: docker image build failed. dockerfile='${dockerfile} image='${imgName}'`);
        }

        // -------------------------------------------
        // STEP 4 : Push the newly compiled Docker image
        // on the private registry
        // and retrieve the new checksum. (can stay the same
        // if the Docker image has already been published)
        // -------------------------------------------

        // Push the built image to the registry
        console.log(`Docker: push image '${imgName}'`);
        if (!await dockerPrivateLocalRegistryPush(dockerRegistryUrl, imgRepo, imgTag, imgRepo, imgTag)) {
            throw new CodeError(`Docker: docker push failed. dockerfile='${dockerfile}' image='${imgName}'`);
        }

        // Retrieve the checksum and make sure it is successfully pushed
        const newChecksum = await dockerPrivateLocalRegistryGetRepositoryChecksum(dockerRegistryUrl, imgRepo, imgTag);
        if (isNullishOrEmptyString(newChecksum)) {
            throw new CodeError(`Docker: unable to push docker repository '${dockerRegistryHost}/${imgName}' to the private local registry.`);
        }
        assert(newChecksum);
        checksum = newChecksum

        // -------------------------------------------
        // STEP 5 : Now that the Docker image has been
        // published on the registry, we can delete the 
        // the local version of the Docker image
        // -------------------------------------------

        // delete local image
        await dockerImageRemove('', '', imgName);

        // make sure there is nothing left
        const removedImageChecksum = await dockerGetPrivateLocalImageChecksum(dockerRegistryUrl, imgRepo, imgTag);
        if (!isNullishOrEmptyString(removedImageChecksum)) {
            throw new CodeError(`Docker: docker image remove failed. Image name = '${imgName}'.`);
        }
    }

    if (isNullishOrEmptyString(checksum)) {
        assert(false, "checksum == null or empty");
        throw new CodeError(`Docker: internal error.`);
    }
    assert(checksum);

    if (currentChecksum != checksum) {
        console.log(`=======================================================`);
        console.log(`App checksum has changed:`);
        console.log(`old checksum:${currentChecksum}`);
        console.log(`new checksum:${checksum}`);
        console.log(`=======================================================`);
    }

    // -------------------------------------------
    // STEP 6 : Generate the iexec.json
    // file using the desired checksum
    // -------------------------------------------

    const multiaddr = `${dockerRegistryHost}/${imgName}`

    return {
        checksum: checksum,
        multiaddr: multiaddr
    };
}

/**
 * @param {string} dockerRepo
 */
export function graminizeDockerRepo(dockerRepo) {
    return `${dockerRepo}-gramine`;
}
/**
 * @param {string} appName
 */
export function graminizeAppName(appName) {
    return `${appName}-gramine`;
}

/**
 * @param {{
 *      dockerfile: string,
 *      dockerRepo: string,
 *      dockerTag: string
 *  }} params
 * @param {boolean} rebuildDockerImage 
 * @returns {Promise<cTypes.MREnclave>}
 */
export async function computeMREnclave(
    {
        dockerfile,
        dockerRepo,
        dockerTag
    },
    rebuildDockerImage) {

    throwIfFileDoesNotExist(dockerfile);

    const gramineDockerRepo = dockerRepo;
    const gramineImage = `${dockerRepo}:${dockerTag}`;
    const gramineDockerfile = dockerfile;

    if (!fileExists(gramineDockerfile)) {
        throw new CodeError(`Invalid app directory. Missing Gramine Dockerfile : '${gramineDockerfile}'.`);
    }

    if (rebuildDockerImage) {
        const ok = await dockerImageBuild(gramineImage, gramineDockerfile, []);
        if (!ok) {
            throw new CodeError(`Docker build failed (image=${gramineImage}, dockerfile=${gramineDockerfile}).`);
        }
    }

    // Run the following command:
    // docker run 
    //      --rm 
    //      --entrypoint ""
    //      --security-opt seccomp=unconfined  
    //      <img> 
    //      /graphene/python/graphene-sgx-get-token -output /entrypoint.token -sig /entrypoint.sig
    const mrenclaveData = await dockerImageRun(gramineImage, "", "unconfined",
        [
            "/graphene/python/graphene-sgx-get-token",
            "-output",
            "/entrypoint.token",
            "-sig",
            "/entrypoint.sig",
        ]);

    // Attributes:
    //      mr_enclave:  3359a665b347361701d01b8ae7b51bccca3a3e746dfa8cab4e131d5b848b2cae
    //      mr_signer:   613c31216e2ad90cc8b9070c49aed4991692ef8a7de57fb2b1327af262d0b85e
    //      isv_prod_id: 0
    //      isv_svn:     0
    //      attr.flags:  0600000000000000
    //      attr.xfrm:   0700000000000000
    //      misc_select: 00000000
    //      misc_mask:   00000000
    //      modulus:     31bc09e66d44001e430747a6e2a5d779...
    //      exponent:    3
    //      signature:   81ad5320900ac0713a385b0a23042377...
    //      date:        2023-06-26
    console.log(mrenclaveData);

    const lines = mrenclaveData.split('\n');
    for (let i = 0; i < lines.length; ++i) {
        const l = lines[i].trim();
        if (l.startsWith('mr_enclave:')) {
            const mr_enclave = removePrefix('mr_enclave:', l).trim();
            return {
                framework: "GRAMINE",
                version: "v0",
                fingerprint: mr_enclave
            }
        }
    }

    throw new CodeError(`Compute MREnclave failed (image=${gramineImage}, dockerfile=${gramineDockerfile}).`);
}

/**
 * @param {string} appDir 
 * @param {string} appOwner 
 * @param {{
 *       tee?: boolean,
 *       name?: string,
 *       dockerfile?: string,
 *       dockerRepo?: string,
 *       dockerRepoDir?: string,
 *       dockerTag?: string,
 *       dockerUrl: string
 * }} options 
 * @param {boolean} rebuildDockerImage
 * @returns {Promise<cTypes.App>}
 */
export async function computeIExecAppEntry(appDir, appOwner, options, rebuildDockerImage) {
    const appDockerInfo = await computeAppDockerInfo(appDir, options);

    /** @type {cTypes.App=} */
    let iExecAppEntry;

    if (options.tee !== true) {
        // compute app multiaddr & checksum
        const appMC = await computeDockerChecksumAndMultiaddr(
            appDockerInfo.dockerfile, /* app dockerfile */
            appDockerInfo.dockerRepo, /* app docker repo */
            appDockerInfo.dockerTag, /* app docker tag */
            options.dockerUrl, /* docker registry url */
            [], /* buildArgs */
            rebuildDockerImage ?? false /* rebuild docker image */
        );

        /** @type {cTypes.App} */
        iExecAppEntry = {
            owner: appOwner,
            name: appDockerInfo.name,
            type: "DOCKER",
            checksum: appMC.checksum,
            multiaddr: appMC.multiaddr,
        };
    } else {
        if (!appDockerInfo.dockerfileGramine) {
            throw new CodeError(`Unable to determine app tee Dockerfile`);
        }
        assert(appDockerInfo.dockerRepoGramine);
        assert(appDockerInfo.nameGramine);

        const appTeeMC = await computeDockerChecksumAndMultiaddr(
            appDockerInfo.dockerfileGramine, /* app dockerfile */
            appDockerInfo.dockerRepoGramine, /* app docker repo */
            appDockerInfo.dockerTag, /* app docker tag */
            options.dockerUrl, /* docker registry url */
            [], /* buildArgs */
            rebuildDockerImage ?? false /* rebuild docker image */
        );

        const appTeeMREnclave = await computeMREnclave(
            { 
                dockerRepo: appDockerInfo.dockerRepoGramine,
                dockerfile: appDockerInfo.dockerfileGramine,
                dockerTag: appDockerInfo.dockerTag,
            },
            rebuildDockerImage ?? false /* rebuild docker image */
        );

        iExecAppEntry = {
            owner: appOwner,
            name: appDockerInfo.nameGramine,
            type: "DOCKER",
            checksum: appTeeMC.checksum,
            multiaddr: appTeeMC.multiaddr,
            mrenclave: appTeeMREnclave
        };
    }

    return iExecAppEntry;
}

/**
 * @param {string} appDir 
 * @param {{
 *       name?: string,
 *       dockerfile?: string,
 *       dockerRepo?: string,
 *       dockerRepoDir?: string,
 *       dockerTag?: string,
 *       dockerUrl?: string,
 * }} options 
 * @returns {Promise<{
 *      entry: string
 *      name: string
 *      version: string
 *      dockerfile: string
 *      dockerRepo: string
 *      dockerTag: string
 *      dockerfileIgnore?: string
 *      nameGramine?: string
 *      dockerfileGramine?: string
 *      dockerfileGramineIgnore?: string
 *      dockerRepoGramine?: string
 *      dockerUrl?: string
 * }>}
 */
export async function computeAppDockerInfo(appDir, options) {

    const npmPkg = await autoDetectNPMPackage(appDir);

    if (npmPkg) {
        if (isNullishOrEmptyString(npmPkg.main)) {
            throw new CodeError(`Missing 'main' property in '${appDir}/package.json'`);
        }
        if (isNullishOrEmptyString(npmPkg.version)) {
            throw new CodeError(`Missing 'version' property in '${appDir}/package.json'`);
        }
        if (isNullishOrEmptyString(npmPkg.name)) {
            throw new CodeError(`Missing 'name' property in '${appDir}/package.json'`);
        }
    }

    const appVersion = npmPkg?.version;
    const appEntry = npmPkg?.main;
    if (!isNullishOrEmptyString(appEntry)) {
        const absAppEntry = path.join(appDir, appEntry);
        throwIfFileDoesNotExist(absAppEntry);
    }

    let appName = isNullishOrEmptyString(options.name) ? npmPkg?.name : options.name;
    if (isNullishOrEmptyString(appName)) {
        throw new CodeError(`Missing app name. Use the '--name' option or specify the 'name' entry in 'package.json'`);
    }
    assert(appName);

    if (!stringIsPOSIXPortable(appName)) {
        throw new CodeError(`Invalid app name '${appName}'`);
    }

    let dockerRepo;
    let dockerTag;

    if (options.dockerRepo) {
        throwIfNullishOrEmptyString(options.dockerRepo);
        dockerRepo = options.dockerRepo;
    } else if (options.dockerRepoDir) {
        throwIfNullishOrEmptyString(options.dockerRepoDir);
        dockerRepo = `${options.dockerRepoDir}/${appName}`;
    } else {
        throw new CodeError(`Missing app docker repository (directory=${appDir})`);
    }

    if (isNullishOrEmptyString(dockerRepo)) {
        throw new CodeError(`Missing app docker repository (directory=${appDir})`);
    }

    if (options.dockerTag) {
        throwIfNullishOrEmptyString(options.dockerTag);
        dockerTag = options.dockerTag;
    } else {
        dockerTag = appVersion;
    }

    if (isNullishOrEmptyString(dockerTag)) {
        throw new CodeError(`Missing app docker tag (directory=${appDir})`);
    }

    if (!options.dockerfile) {
        if (fileExistsInDir(appDir, 'Dockerfile')) {
            options.dockerfile = 'Dockerfile';
        }
    }

    if (options.dockerfile) {
        throwIfNullishOrEmptyString(options.dockerfile);

        let dockerfile = path.join(appDir, options.dockerfile);
        if (!fileExists(dockerfile)) {
            throw new CodeError(`Unable to locate app dockerfile '${dockerfile}'`);
        }
        return {
            entry: appEntry,
            name: appName,
            version: appVersion,
            dockerfile,
            dockerRepo,
            dockerTag,
            dockerUrl: options.dockerUrl
        }
    }

    const genDockerfile = path.join(appDir, 'Dockerfile.ixcdv');
    const genDockerfileGramine = path.join(appDir, 'Dockerfile.ixcdv.gramine');
    const genDockerfileIgnore = path.join(appDir, 'Dockerfile.ixcdv.dockerignore');
    const genDockerfileGramineIgnore = path.join(appDir, 'Dockerfile.ixcdv.gramine.dockerignore');

    const templatesDir = getTemplatesDir();
    const varsArr = [
        "{{ node-major-version }}",
        "{{ app-entry }}",
        "{{ app-name }}",
    ];
    const valuesArr = [
        "19", //node version
        appEntry,
        appName
    ];

    if (!fileExists(genDockerfile)) {
        copyFileSync(path.join(templatesDir, 'nodejs-dockerfile.template'), genDockerfile);
        await replaceInFile(varsArr, valuesArr, genDockerfile);
    }
    if (!fileExists(genDockerfileIgnore)) {
        copyFileSync(path.join(templatesDir, 'nodejs-dockerfile-ignore.template'), genDockerfileIgnore);
    }
    if (!fileExists(genDockerfileGramine)) {
        copyFileSync(path.join(templatesDir, 'nodejs-gramine-dockerfile.template'), genDockerfileGramine);
        await replaceInFile(varsArr, valuesArr, genDockerfileGramine);
    }
    if (!fileExists(genDockerfileGramineIgnore)) {
        copyFileSync(path.join(templatesDir, 'nodejs-gramine-dockerfile-ignore.template'), genDockerfileGramineIgnore);
    }

    return {
        entry: appEntry,
        name: appName,
        nameGramine: graminizeAppName(appName),
        version: appVersion,
        dockerfile: genDockerfile,
        dockerfileIgnore: genDockerfileIgnore,
        dockerfileGramine: genDockerfileGramine,
        dockerfileGramineIgnore: genDockerfileGramineIgnore,
        dockerRepo,
        dockerRepoGramine: graminizeDockerRepo(dockerRepo),
        dockerTag,
        dockerUrl: options.dockerUrl
    }
}
