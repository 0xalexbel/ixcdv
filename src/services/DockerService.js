import { CodeError } from '../common/error.js';
import { AbstractService } from '../common/service.js';
import * as types from '../common/common-types.js';
import * as srvTypes from './services-types-internal.js';
import { isDockerDesktopRunning, startDockerDesktop } from '../docker/docker-api.js';

export class DockerService extends AbstractService {

    /** 
     * @override
     * @returns {typeof DockerService} 
     */
    theClass() { return DockerService; }

    static typename() { return 'docker'; }
    typename() { return 'docker'; }

    /**
     * @param {*=} args 
     */
    constructor(args) {
        super(args); //compiler
    }

    /** 
     * @param {srvTypes.DockerConfig} config 
     * @param {boolean} resolvePlaceholders
     * @param {string=} relativeToDirectory
     */
    static async deepCopyConfig(config, resolvePlaceholders, relativeToDirectory) {
        const newConf = { ...config };
        return newConf;
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
     * @returns {Promise<{pid: number, service:(DockerService | null)}[] | null>} 
     */
    static async running(filters) {
        // Not supported
        return null;
    }

    static async newInstance() {
        return new DockerService();
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