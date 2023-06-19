// Dependencies
// ../common
// ../docker
import assert from 'assert';
import path from 'path';
import { fileExists } from '../common/fs.js';
import { CodeError } from '../common/error.js';
import { isNullishOrEmptyString, throwIfNullishOrEmptyString } from '../common/string.js';
import { dockerGetPrivateLocalImageChecksum, dockerImageBuild, dockerImageRemove, dockerPrivateLocalRegistryGetRepositoryChecksum, dockerPrivateLocalRegistryPush, dockerPrivateLocalRegistryStart, isDockerPrivateLocalRegistryRunning } from '../docker/docker-api.js';

/**
 * @param {string} dockerfileLocation 
 * @param {string} dockerRepository 
 * @param {string} dockerTag 
 * @param {string} dockerRegistryUrl 
 * @param {string[]} buildArgs 
 * @param {boolean} rebuildDockerImage 
 * @returns {Promise<{ checksum: string, multiaddr: string }>}
 */
export async function computeDockerChecksumAndMultiaddr(
    dockerfileLocation, 
    dockerRepository, 
    dockerTag, 
    dockerRegistryUrl, 
    buildArgs,
    rebuildDockerImage) {
    throwIfNullishOrEmptyString(dockerRegistryUrl);

    if (!fileExists(path.join(dockerfileLocation, 'Dockerfile'))) {
        throw new CodeError(`Invalid app directory. Missing Dockerfile : '${dockerfileLocation}/Dockerfile'.`);
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
        if (!await dockerImageBuild(imgName, dockerfileLocation, buildArgs)) {
            throw new CodeError(`Docker: docker image build failed. dockerfile='${dockerfileLocation}/Dockerfile' image='${imgName}'`);
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
            throw new CodeError(`Docker: docker push failed. dockerfile='${dockerfileLocation}/Dockerfile' image='${imgName}'`);
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

