import assert from 'assert';
import { CodeError } from '../common/error.js';
import { AbstractService } from '../common/service.js';
import * as types from '../common/common-types.js';
import * as srvTypes from './services-types-internal.js';
import { dockerPrivateLocalRegistryStart, isDockerDesktopRunning, isDockerPrivateLocalRegistryRunning, startDockerDesktop } from '../docker/docker-api.js';
import { throwIfNotStrictlyPositiveInteger } from '../common/number.js';
import { isNullishOrEmptyString, placeholdersPropertyReplace } from '../common/string.js';

export class DockerService extends AbstractService {

    /** 
     * @override
     * @returns {typeof DockerService} 
     */
    theClass() { return DockerService; }

    static typename() { return 'docker'; }
    typename() { return 'docker'; }

    /** @type {string} */
    #hostname;
    /** @type {number} */
    #port;

    /**
     * @param {*=} args 
     */
    constructor(args) {
        throwIfNotStrictlyPositiveInteger(args.port);

        const hostname = (isNullishOrEmptyString(args.hostname)) ? 'localhost' : args.hostname;
        assert(hostname);

        super(args); //compiler

        this.#port = args.port;
        this.#hostname = hostname;
    }

    get port() { return this.#port; }

    /** 
     * @param {srvTypes.DockerConfig} config 
     * @param {boolean} resolvePlaceholders
     * @param {{[varname:string]: string}} placeholders
     * @param {string=} relativeToDirectory
     */
    static async deepCopyConfig(config, resolvePlaceholders, placeholders, relativeToDirectory) {
        const configCopy = { ...config };
        assert(configCopy.type === 'docker');

        if (!configCopy.hostname && placeholders) {
            configCopy.hostname = placeholders["${defaultHostname}"];
        }

        if (resolvePlaceholders) {
            ["hostname"].forEach((v) => {
                placeholdersPropertyReplace(configCopy, v, placeholders)
            });
        }
        return configCopy;
    }

    static async install() {
        return;
    }

    /**
     * @returns {Promise<number | undefined>} 
     */
    async getPID() {
        throw new CodeError('Not supported');
    }

    /** 
     * @param {any=} filters 
     * @returns {Promise<{pid: number, configFile: string, service:(DockerService | null)}[] | null>} 
     */
    static async running(filters) {
        // Not supported
        return null;
    }

    /**
     * @param {types.ServerServiceArgs} options 
     * @param {srvTypes.InventoryLike=} inventory
     */
    static async newInstance(options, inventory) {
        return new DockerService(options);
    }

    /**
     * @param {types.StopOptionsWithContext=} options
     * @returns {Promise<types.StopReturn>}
     */
    async stop(options) {
        const strict = options?.strict ?? false;
        return { ok: true, context: options?.context };
    }
    /**
     * @param {types.StartOptionsWithContext=} options
     * @returns {Promise<types.StartReturn>}
     */
    async start(options) {
        const mySelf = this;
        const typename = this.typename();

        if (! await isDockerDesktopRunning()) {
            if (! await startDockerDesktop({
                ...options,
                ... (options?.progressCb && {
                    progressCb: (args) => {
                        options.progressCb?.({
                            ...args,
                            value: {
                                state: 'starting',
                                type: typename,
                                service: mySelf,
                                context: options.context
                            }
                        });
                    }
                })
            })) {
                return { ok: false, error: new CodeError('Unable to start Docker Desktop for MacOS.') };
            }
        }

        const dockerRegistryUrl = `http://${this.#hostname}:${this.#port}`;

        // Make sure Docker private registry is running
        if (! await isDockerPrivateLocalRegistryRunning(dockerRegistryUrl)) {
            if (! await dockerPrivateLocalRegistryStart(dockerRegistryUrl,{
                ...options,
                ... (options?.progressCb && {
                    progressCb: (args) => {
                        options.progressCb?.({
                            ...args,
                            value: {
                                state: 'starting',
                                type: typename,
                                service: mySelf,
                                context: options.context
                            }
                        });
                    }
                })
            })) {
                return { ok: false, error: new CodeError('Unable to start docker registry.') };
            }
            if (! await isDockerPrivateLocalRegistryRunning(dockerRegistryUrl)) {
                return { ok: false, error: new CodeError('Unable to start docker registry.') };
            }
        }

        options?.progressCb?.({
            count: 100,
            total: 100,
            value: {
                state: 'ready',
                type: this.typename,
                service: mySelf,
                context: options.context
            }
        });

        return { ok: true, context: options?.context };
    }
}