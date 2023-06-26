import { Cmd } from "../Cmd.js";
import * as types from '../../common/common-types.js';
import * as srvTypes from '../../services/services-types-internal.js';
import assert from 'assert';
import path from 'path';
import cliProgress from 'cli-progress';
import { Inventory } from "../../services/Inventory.js";
import { mkDirP, saveToFileSync, toAbsolutePath } from "../../common/fs.js";
import { generateAllChainsVSCodeWorkspaces } from "../../services/vscode.js";
import { CodeError } from "../../common/error.js";
import { DockerService } from "../../services/DockerService.js";
import { Market } from "../../services/Market.js";
import { SmsService } from "../../services/Sms.js";
import { ResultProxyService } from "../../services/ResultProxy.js";
import { BlockchainAdapterService } from "../../services/BlockchainAdapter.js";
import { CoreService } from "../../services/Core.js";
import { WorkerService } from "../../services/Worker.js";
import { psGrepPIDAndArgs } from "../../common/ps.js";
import { PROD_BIN, PROD_NAME } from "../../common/consts.js";

export default class VSCodeCmd extends Cmd {

    static cmdname() { return 'vscode'; }

    /** 
     @type {{
        [name:string]: cliProgress.SingleBar
     }} 
     */
    static progressBars;

    /** @type {cliProgress.MultiBar} */
    static multiBar;

    /**
     * @param {string} cliDir 
     * @param {string} subcmd 
     * @param {{
     *      force?: boolean
     *      type?: srvTypes.ServiceType | 'iexecsdk'
     *      hub?: string
     *      workerIndex?: number
     *      sgxDriverMode?: srvTypes.SgxDriverMode
     *      out?: string
     * }} options 
     */
    async cliExec(cliDir, subcmd, options) {
        try {
            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);

            const vars = this.parseVars(options);

            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir, vars);

            if (subcmd === 'install') {
                let vscodeDir = options.out ?? path.join(process.cwd());
                if (!path.isAbsolute(vscodeDir)) {
                    //vscodeDir = toAbsolutePath(configDir, vscodeDir);
                    vscodeDir = toAbsolutePath(process.cwd(), vscodeDir);
                }
                await generateAllChainsVSCodeWorkspaces(inventory, vscodeDir, true, options.force);
                return;
            }

            if (subcmd === 'prelaunchtask') {
                console.log("=================================================");
                console.log("Prelaunch stask cwd: '" + process.cwd() + "'");
                console.log("=================================================");

                const isRunning = await isPrelaunchtaskAlreadyRunning();
                if (isRunning) {
                    throw new CodeError(`A ${PROD_NAME} vscode prelaunch task is alreay running.`);
                }

                if (options.type === 'iexecsdk') {
                    /** @type {srvTypes.IExecSdkConfig=} */
                    const iexecsdkConf = inventory._inv.getIExecSdkConfig()?.resolved
                    if (iexecsdkConf) {
                        const chainsLoc = iexecsdkConf.chainsJsonLocation;
                        const chainsJson = await inventory._inv.getChainsJSON();
                        mkDirP(chainsLoc);
                        saveToFileSync(JSON.stringify(chainsJson, null, 2), chainsLoc, 'chain.json', { strict: true });
                    }
                    return;
                }

                const ic = inventory._inv.guessConfig(options);
                if (!ic) {
                    throw new CodeError(`No service to start`);
                }

                const instance = await inventory._inv.newInstanceFromInventoryConfig(ic);
                if (!instance) {
                    throw new CodeError(`No service to start`);
                }

                if (instance instanceof DockerService) {
                    throw new CodeError(`Docker service not supported`);
                }

                if (!(instance instanceof Market)) {
                    const pid = await instance.getPID();
                    if (pid) {
                        throw new CodeError(`Service is already running pid=${pid}`);
                    }
                }

                if (instance instanceof SmsService ||
                    instance instanceof ResultProxyService ||
                    instance instanceof BlockchainAdapterService ||
                    instance instanceof CoreService ||
                    instance instanceof WorkerService) {
                    assert(instance.springConfigLocation);
                    mkDirP(instance.springConfigLocation);
                    await instance.saveApplicationYml();
                    await instance.saveEnvFile({ filename: undefined, env: { marker: inventory._inv.rootDir } });
                }

                if (instance instanceof WorkerService) {
                    /** @type {WorkerService} */
                    const w = instance;
                    assert(w.directory);
                    mkDirP(w.directory);
                }

                if (ic.type === 'market') {
                    const marketConf = ic.resolved;
                    assert(marketConf);
                    assert(marketConf.type === 'market');
                    assert(marketConf.directory);
                    assert(instance instanceof Market);
                    await instance.saveEnvFile({ directory: marketConf.directory, env: { marker: inventory._inv.rootDir } });
                }

                if (instance instanceof WorkerService) {
                    assert(options.type === 'worker');
                    assert(options.workerIndex !== undefined);
                    assert(typeof options.workerIndex === 'number');
                    await inventory.startWorker({
                        hub: options.hub,
                        workerIndex: options.workerIndex,
                        sgxDriverMode: options.sgxDriverMode ?? 'none',
                        onlyDependencies: true,
                        progressCb: startProgress
                    });
                } else {
                    assert(options.type !== 'worker');
                    await inventory.start({
                        type: options.type,
                        hub: options.hub,
                        onlyDependencies: true,
                        progressCb: startProgress
                    });
                }
            }

            VSCodeCmd.multiBar?.stop();
        } catch (err) {
            this.exit(options, err);
        }
    }
}

/**
 * @param {{
*      count: number 
*      total: number 
*      value: any 
* }} args 
*/
function startProgress({ count, total, value }) {

    const name = value?.context?.name;
    if (!name) {
        return;
    }
    const type = value?.type;
    if (!type) {
        return;
    }
    /** @type {Object.<string,string>} */
    const formattedState = {
        'starting': 'starting',
        'started': 'started ',
        'ready': 'ready   ',
        'readying': 'readying',
    }
    const state = value?.state;
    if (!state) {
        return;
    }

    if (Cmd.JsonProgress) {
        console.log(JSON.stringify({ count, total, value:{ type, state, context:{ name } } }));
        return;
    }

    if (!VSCodeCmd.multiBar) {
        VSCodeCmd.multiBar = new cliProgress.MultiBar({
            hideCursor: true,
            synchronousUpdate: true,
            clearOnComplete: true,
            autopadding: true,
            format: ' {bar} | {percentage}% | {state} | {name}',
        }, cliProgress.Presets.shades_classic);
        assert(!VSCodeCmd.progressBars);
        VSCodeCmd.progressBars = {};
    }

    if (!VSCodeCmd.progressBars[name]) {
        VSCodeCmd.progressBars[name] = VSCodeCmd.multiBar.create(total, 0, { state: formattedState[state], name });
    }

    VSCodeCmd.progressBars[name].update(count, { state: formattedState[state], name });
    return;
}

// vscode launch configs are always running a dedicated prelaunch task.
// Rule : each vscode launch config must be fully completed before launching a new vscode config.
// Therefore, each time an prelaunch task is started, it will check that there is
// no existing prelaunch task already running.
async function isPrelaunchtaskAlreadyRunning() {
    const pids = await psGrepPIDAndArgs(`node.*${PROD_BIN}.* vscode prelaunchtask `);
    if (!pids || pids.length === 0) {
        return false;
    }
    for (let i = 0; i < pids.length; ++i) {
        if (pids[i].pid !== process.pid) {
            return true;
        }
    }
    return false;
}