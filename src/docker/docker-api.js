// Dependencies
// ../common
import * as types from '../common/types.js';
import * as docker from './docker.js';
import assert from 'assert';
import path from 'path';
import { dockerGet, dockerProgress } from './docker-internal.js';
import { dirExists, fileExists } from '../common/fs.js';
import { repeatCallUntil } from '../common/repeat-call-until.js';
import { isNullishOrEmptyString, removeSuffix, stringToPositiveInteger, throwIfNullishOrEmptyString } from '../common/string.js';
import { httpGETHeader, httpGETStatusCode } from '../common/http.js';
import { CodeError } from '../common/error.js';
import * as ERROR_CODES from "../common/error-codes.js";
import { PROD_PRIVATE_LOCAL_DOCKER_REGISTRY_NAME } from '../common/consts.js';
import { psGrepPID } from '../common/ps.js';

import * as nodeUtil from 'util';
import { exec as childProcessExec } from 'child_process';
const exec_promise = nodeUtil.promisify(childProcessExec);

const OFFICIAL_DOCKER_REGISTRY_IMAGE_NAME = "registry:2";

export async function isDockerDesktopRunning() {
    // MacOS only : check if Docker.app is installed
    if (process.platform === 'darwin') {
        if (!dirExists("/Applications/Docker.app")) {
            return false;
        }
    }
    try {
        await exec_promise(`docker images`);
        return true;
    } catch (e) {
        // Even if installed, `docker images` may fail.
        // This usually happens when the user running docker does not have 
        // enough privileges. 
        // See issue below:
        // https://stackoverflow.com/questions/47854463/docker-got-permission-denied-while-trying-to-connect-to-the-docker-daemon-socke
        // Solution : `sudo usermod -a -G docker [user]`
        return false;
    }
}

export async function getDockerDesktopPids() {
    if (!dirExists("/Applications/Docker.app")) {
        return undefined;
    }
    try {
        return await psGrepPID('/Applications/Docker.app/Contents/MacOS/Docker Desktop.app/Contents/MacOS/Docker Desktop --name=tray');
    } catch (e) {
        return undefined;
    }
}

/**
 * @param {{
 *      abortSignal?: AbortSignal
 *      progressCb?: types.progressCallback
 * }=} options
 */
export async function startDockerDesktop(options) {
    if (process.platform !== 'darwin') {
        // returns always true when running on non-MacOS platforms
        return true;
    }
    // start Docker Desktop App (MacOS only)
    try {
        await exec_promise(`open -a Docker`);
    } catch (e) {
        return false;
    }
    // wait until Docker Desktop App is running
    const succeeded = await waitUntilDockerDesktopIsRunning(options);
    return (succeeded) ? true : false;
}

/**
 * @param {{
 *      abortSignal?: AbortSignal
 *      progressCb?: types.progressCallback
 * }=} options
 */
async function waitUntilDockerDesktopIsRunning(options) {
    const repeat = await repeatCallUntil(
        isDockerDesktopRunning,
        [],
        {
            waitBeforeFirstCall: 200,
            waitBetweenCallsMS: 2000,
            maxCalls: 120,
            progressMessage: "Starting Docker Desktop app, please wait ...",
            ... (options?.abortSignal && { abortSignal: options?.abortSignal }),
            ... (options?.progressCb && { progressCb: options?.progressCb }),
        });

    if (!repeat.ok) {
        assert(repeat.error);
        return false;
    }

    assert(repeat.result);
    return true;
}

/**
 * @param {string} url 
 * @param {{
 *      abortSignal?: AbortSignal
 *      progressCb?: types.progressCallback
 * }=} options
 */
async function waitUntilDockerPrivateLocalRegistryIsRunning(url, options) {
    const repeat = await repeatCallUntil(
        isDockerPrivateLocalRegistryRunning,
        [url],
        {
            waitBeforeFirstCall: 0,
            waitBetweenCallsMS: 100,
            maxCalls: 120,
            progressMessage: `Starting Docker private registry '${PROD_PRIVATE_LOCAL_DOCKER_REGISTRY_NAME}', please wait ...`,
            ... (options?.abortSignal && { abortSignal: options?.abortSignal }),
            ... (options?.progressCb && { progressCb: options?.progressCb }),
        });

    if (!repeat.ok) {
        assert(repeat.error);
        return false;
    }

    assert(repeat.result);
    return true;
}

/**
 * @param {string} imageName 
 */
export async function dockerImageLs(imageName) {
    const out = await docker.image(process.cwd(), ["ls", imageName, "-q"]);
    if (out.ok) {
        return out.result;
    }
    return null;
}

/**
 * @param {string} imgName 
 */
export async function dockerPull(imgName) {
    const out = await docker.pull(process.cwd(), [imgName]);
    return out.ok;
}

/**
 * @param {string} imgName 
 */
async function dockerImageInspect(imgName) {
    try {
        await exec_promise(`docker image inspect ${imgName}`);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * @param {string} registryHost 
 * @param {string} registryPort 
 * @param {string} imageName 
 */
export async function dockerImageRemove(registryHost, registryPort, imageName) {
    if (isNullishOrEmptyString(imageName)) {
        return true;
    }
    let img = imageName;
    if (!isNullishOrEmptyString(registryHost)) {
        if (isNullishOrEmptyString(registryPort)) {
            assert(false);
            return false;
        }
        img = registryHost + ':' + registryPort + '/' + imageName;
    }
    try {
        await exec_promise(`docker image remove ${img}`);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * @param {string} registryHost 
 * @param {string} registryPort 
 * @param {string} imgName 
 */
async function dockerPush(registryHost, registryPort, imgName) {
    throwIfNullishOrEmptyString(registryHost);
    throwIfNullishOrEmptyString(registryPort);
    throwIfNullishOrEmptyString(imgName);

    const out = await docker.push(process.cwd(),
        [
            registryHost + ':' + registryPort + '/' + imgName
        ]);
    return out.ok;
}

/**
 * - imageName = imgRepo:imgTag
 * - newImageName = newImgRepo:newImgTag
 * @param {string} srcImgName 
 * @param {string} registryHost 
 * @param {string} registryPort 
 * @param {string} targetImgName 
 */
async function dockerTag(srcImgName, registryHost, registryPort, targetImgName) {
    throwIfNullishOrEmptyString(srcImgName);
    throwIfNullishOrEmptyString(registryHost);
    throwIfNullishOrEmptyString(registryPort);
    throwIfNullishOrEmptyString(targetImgName);

    const arg = registryHost + ':' + registryPort + '/' + targetImgName;
    try {
        await exec_promise(`docker tag ${srcImgName} ${arg}`);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * @param {string} url 
 * @param {string} srcImgRepo 
 * @param {string} srcImgTag 
 * @param {string} dstImgRepo 
 * @param {string} dstImgTag 
 */
export async function dockerPrivateLocalRegistryPush(url, srcImgRepo, srcImgTag, dstImgRepo, dstImgTag) {
    throwIfNullishOrEmptyString(url);
    throwIfNullishOrEmptyString(srcImgRepo);
    throwIfNullishOrEmptyString(srcImgTag);
    throwIfNullishOrEmptyString(dstImgRepo);
    throwIfNullishOrEmptyString(dstImgTag);

    const u = new URL(url);
    const srcImgName = srcImgRepo + ':' + srcImgTag;
    const dstImgName = dstImgRepo + ':' + dstImgTag;

    // make sure source image exists
    if (! await dockerImageInspect(srcImgName)) {
        console.error(`Docker: Image '${srcImgName}' does not exist`);
        return false;
    }

    const dstChecksum = await dockerPrivateLocalRegistryGetRepositoryChecksum(url, dstImgRepo, dstImgTag);
    if (!isNullishOrEmptyString(dstChecksum)) {
        console.log(`Docker: destination docker image already published (name='${dstImgName}' checksum='${dstChecksum}').`)
    }

    const dockerRegistryHostPort = u.host;

    // Comments source: https://docs.docker.com/registry/deploying/

    // 2. Tag the image as localhost:5000/my-ubuntu.
    // This creates an additional tag for the existing image. 
    // When the first part of the tag is a hostname and port, 
    // Docker interprets this as the location of a registry, when pushing.
    //
    // $ docker tag ubuntu:16.04 localhost:5000/my-ubuntu
    //

    console.log(`Docker: docker tag ${srcImgName} ${dockerRegistryHostPort}/${dstImgName}`);
    if (!await dockerTag(srcImgName, u.hostname, u.port, dstImgName)) {
        console.error(`Docker: docker tag ${srcImgName} ${dockerRegistryHostPort}/${dstImgName} failed.`);
        return false;
    }

    // 3. Push the image to the local registry running at localhost:5000
    //
    // $ docker push localhost:5000/my-ubuntu

    console.log(`Docker: docker push image ${dockerRegistryHostPort}/${dstImgName}`);
    if (!await dockerPush(u.hostname, u.port, dstImgName)) {
        console.error(`Docker: docker push image ${dockerRegistryHostPort}/${dstImgName} failed.`);
        return false;
    }

    // 4. Remove the locally-cached ubuntu:16.04 and localhost:5000/my-ubuntu images, 
    // so that you can test pulling the image from your registry. 
    // This does not remove the localhost:5000/my-ubuntu image from your registry.
    //
    // $ docker image remove ubuntu:16.04
    // $ docker image remove localhost:5000/my-ubuntu

    console.log(`Docker: docker image remove ${dockerRegistryHostPort}/${dstImgName}`);
    if (!await dockerImageRemove(u.hostname, u.port, dstImgName)) {
        console.error(`Docker: docker image remove ${dockerRegistryHostPort}/${dstImgName}`);
        return false;
    }

    return true;
}

export async function dockerPrivateLocalRegistryInstall() {
    console.log(`docker: install image '${OFFICIAL_DOCKER_REGISTRY_IMAGE_NAME}'`);

    if (! await isDockerDesktopRunning()) {
        if (! await startDockerDesktop()) {
            console.error("Unable to start Docker Desktop for MacOS.");
            return false;
        }
    }

    const imgId = await dockerImageLs(OFFICIAL_DOCKER_REGISTRY_IMAGE_NAME);
    // already installed?
    if (!isNullishOrEmptyString(imgId)) {
        console.log(`docker: image '${OFFICIAL_DOCKER_REGISTRY_IMAGE_NAME}' already installed.`);
        return true;
    }

    console.log(`docker pull ${OFFICIAL_DOCKER_REGISTRY_IMAGE_NAME}`);
    const succeeded = await dockerPull(OFFICIAL_DOCKER_REGISTRY_IMAGE_NAME);
    if (!succeeded) {
        console.error("docker pull failed.");
    }
    return succeeded;
}

/**
 * @param {string} url 
 */
export async function isDockerPrivateLocalRegistryRunning(url) {
    const docker_registry_url = removeSuffix('/', url);
    const urlv2 = `${docker_registry_url}/v2/`;
    try {
        const statusCode = await httpGETStatusCode(urlv2);
        return (statusCode == 200);
    } catch (e) {
        // when the docker-registry service is not running
        // possible errors : ECONNREFUSED
        return false;
    }
}

export async function isDockerPrivateLocalRegistryStopped() {
    const state = await getDockerPrivateLocalRegistryState();
    assert(state != null);
    if (state == null) {
        // stopped
        return true;
    }
    return (state === 'exited' || state === 'created');
}

async function getDockerPrivateLocalRegistryState() {
    try {
        const { stdout /*, stderr */ } = await exec_promise(`docker ps -a --filter ancestor=${OFFICIAL_DOCKER_REGISTRY_IMAGE_NAME} --filter name=${PROD_PRIVATE_LOCAL_DOCKER_REGISTRY_NAME} --format "{{.State}}"`);
        const state = stdout.trim();
        return state;
    } catch (e) {
        return null;
    }
}

/**
 * @param {string} url 
 * @param {{
 *      abortSignal?: AbortSignal
 *      progressCb?: types.progressCallback
 * }=} options
 */
export async function dockerPrivateLocalRegistryStart(url, options) {
    const u = new URL(url);

    if (! await isDockerDesktopRunning()) {
        if (! await startDockerDesktop(options)) {
            throw new CodeError("Unable to start Docker Desktop for MacOS.", ERROR_CODES.DOCKER_ERROR);
        }
    }

    /** @todo check that port is the same ! */

    // returns null if docker is starting.
    const state = await getDockerPrivateLocalRegistryState();
    if (state === 'running') {
        return true;
    }

    if (state === 'exited' || state === 'created') {
        const out = await docker.start(process.cwd(),
            [PROD_PRIVATE_LOCAL_DOCKER_REGISTRY_NAME]);
        if (!out.ok) {
            return false;
        }
    } else {
        // if state is not empty, this means that such a container is still registed.
        // At this stage, there should be no such container named '${PROD_PRIVATE_LOCAL_DOCKER_REGISTRY_NAME}'
        // In this case, bug fix is expected. 
        if (!isNullishOrEmptyString(state)) {
            throw new CodeError(
                `Invalid Docker Container '${PROD_PRIVATE_LOCAL_DOCKER_REGISTRY_NAME}' state = '${state}' (Expecting empty state value).`,
                ERROR_CODES.DOCKER_ERROR);
        }

        // registry runs on port kTHIS_DEFAULT_DOCKER_REGISTRY_PORT
        // Within the container, the registry listens on port 5000 by default.
        const args = [
            "-d",
            "-e", "REGISTRY_STORAGE_DELETE_ENABLED=true",
            "-p", `${u.port}:5000`,
            "--restart=always",
            "--name", PROD_PRIVATE_LOCAL_DOCKER_REGISTRY_NAME,
            OFFICIAL_DOCKER_REGISTRY_IMAGE_NAME
        ];
        const out = await docker.runQuiet(process.cwd(), args);
        if (!out.ok) {
            return false;
        }
    }

    const succeeded = await waitUntilDockerPrivateLocalRegistryIsRunning(u.toString(), options);

    return succeeded;
}

export async function dockerPrivateRegistryPort() {
    try {
        const { stdout /*, stderr */ } = await exec_promise(`docker container port ${PROD_PRIVATE_LOCAL_DOCKER_REGISTRY_NAME} | grep '5000/tcp'`);
        const prefix = '5000/tcp -> ';
        const i = stdout.indexOf(prefix);
        if (i < 0) {
            return null;
        }
        const s = stdout.trim().substring(i + prefix.length);
        const j = s.indexOf(':');
        if (j < 0) {
            return null;
        }
        return stringToPositiveInteger(s.substring(j + 1), { strict: false });
        //5000/tcp -> 0.0.0.0:13456
    } catch { }
    return null;
}

/**
 * imageName = imgRepo + imgTag
 * @param {string} imageName 
 */
export async function dockerGetImageID(imageName) {
    // docker image ls --digests --format "{{.ID}}" <imageName>
    const out = await docker.image(process.cwd(), ["ls", "--digests", "--format", "{{.ID}}", imageName]);
    if (!out.ok) {
        return null;
    }
    return out.result;
}

/**
 * @param {string} imgTag 
 * @param {string} dockerfile 
 * @param {string[]} buildArgs 
 */
export async function dockerImageBuild(imgTag, dockerfile, buildArgs) {
    assert(fileExists(dockerfile));

    const args = [
        "image",
        "build",
        "-t",
        imgTag,
        "-f", dockerfile,
    ];
    if (buildArgs && buildArgs.length > 0) {
        for (let i = 0; i < buildArgs.length; ++i) {
            args.push("--build-arg");
            args.push(buildArgs[i]);
        }
    }
    args.push(".");

    console.log("===============================================");
    console.log("BUILD DOCKER IMAGE:");
    console.log("dockerfile: " + dockerfile);
    console.log("docker " + args.join(' '));
    console.log("===============================================");

    const out = await dockerProgress(path.dirname(dockerfile), args, {});

    return out.ok;
}

/**
 * Executes:
 * - docker run --rm --security-opt seccomp=<seccomp> --entrypoint <entrypoint> <imgTag> <args>
 * @param {string} imgTag 
 * @param {string | undefined} entrypoint 
 * @param {string | undefined} seccomp 
 * @param {string[]} args
 */
export async function dockerImageRun(imgTag, entrypoint, seccomp, args) {
    assert(imgTag);
    const _args = [
        "run",
        "--rm"
    ];
    if (entrypoint !== undefined) {
        _args.push("--entrypoint");
        _args.push(entrypoint);
    }
    if (seccomp !== undefined) {
        _args.push("--security-opt");
        _args.push(`seccomp=${seccomp}`);
    }
    _args.push(imgTag);
    _args.push(...args);

    const out = await dockerGet(process.cwd(), _args, {});
    if (out.ok) {
        return out.result;
    }

    throw out.error;
}

/**
 * @param {string} url 
 * @param {string} imgRepo 
 * @param {string} imgTag 
 */
export async function dockerPrivateLocalRegistryGetRepositoryChecksum(url, imgRepo, imgTag) {
    throwIfNullishOrEmptyString(url);
    throwIfNullishOrEmptyString(imgRepo);
    throwIfNullishOrEmptyString(imgTag);

    const docker_registry_url = removeSuffix('/', url);
    const urlv2 = `${docker_registry_url}/v2/${imgRepo}/manifests/${imgTag}`;

    try {
        //is the image published ?
        const statusCode = await httpGETStatusCode(urlv2);
        if (statusCode != 200) {
            return null;
        }
    } catch (e) {
        // when the docker-registry service is not running
        // possible errors : ECONNREFUSED
        return null;
    }

    //we can now safely retrieve the checksum 
    try {
        //is the image published ?
        const res = await httpGETHeader(urlv2,
            'Accept',
            'application/vnd.docker.distribution.manifest.v2+json',
            'docker-content-digest');
        return parseSha256Digest(res);
    } catch (e) {
        // when the docker-registry service is not running
        // possible errors : ECONNREFUSED
        return null;
    }
}

/**
 * @param {string} url 
 * @param {string} imgRepo 
 * @param {string} imgTag 
 */
export async function dockerGetPrivateLocalImageChecksum(url, imgRepo, imgTag) {
    throwIfNullishOrEmptyString(url);
    throwIfNullishOrEmptyString(imgRepo);
    throwIfNullishOrEmptyString(imgTag);

    const u = new URL(url);
    const imgName = u.host + '/' + imgRepo + ':' + imgTag;

    const imgID = await dockerGetImageID(imgName);
    if (isNullishOrEmptyString(imgID)) {
        return null;
    }

    try {
        const img = u.host + '/' + imgRepo;
        const { stdout /*, stderr */ } = await exec_promise(`docker image ls --digests --format '{{.ID}} {{.Digest}}' ${img} | grep ${imgID}`);
        const s = stdout.trim();
        const pos = s.indexOf('sha256:');
        if (pos < 0) {
            return null;
        }
        // sha256_checksum=$(docker image ls --digests "${docker_registry_host}:${docker_registry_port}/${img_repo}" | grep "${img_id}" | grep "sha256:" | awk -F "sha256:" '{ print $2 }' | awk '{ print $1 }' )
        return '0x' + s.substring(pos);
    } catch (e) {
        return null;
    }
}

/**
 * @param {*} value 
 */
export function parseSha256Digest(value) {
    if (typeof value !== 'string' || value.length != 71) {
        return null;
    }
    const regex = /^sha256:[0-9a-fA-F]{64}$/g;
    const found = value.match(regex);
    if (found == null) {
        return null;
    }
    return '0x' + value.substring(7);
}

/**
 * @param {string} url 
 * @param {string} imgRepo 
 * @param {string} imgTag 
 */
export function toDockerPrivateLocalRegistryMultiAddr(url, imgRepo, imgTag) {
    throwIfNullishOrEmptyString(url);
    throwIfNullishOrEmptyString(imgRepo);
    throwIfNullishOrEmptyString(imgTag);

    const u = new URL(url);
    return u.host + '/' + imgRepo + ':' + imgTag;
}
