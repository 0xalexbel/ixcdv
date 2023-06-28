import assert from 'assert';
import path from 'path';
import { Cmd } from "../../Cmd.js";
import cliProgress from 'cli-progress';
import { CodeError } from '../../../common/error.js';
import { Inventory } from '../../../services/Inventory.js';
import { dirExists, errorDirDoesNotExist, errorFileDoesNotExist, fileExists, getTmpDir, mkDirP, readFile, readFileSync, resolveAbsolutePath, rmrfDir, throwIfFileDoesNotExist } from '../../../common/fs.js';
import ResetAllCmd from '../resetAll.js';
import StopAllCmd from '../stopAll.js';
import StartCmd from '../start.js';
import { runIexecApp, waitUntilTaskCompleted } from '../../../services/Exec.js';
import { Task } from '../../../contracts/Task.js';
import { downloadAndUnzipZipFile } from '../../../common/zip.js';
import { isNullishOrEmptyString, stringIsPOSIXPortable } from '../../../common/string.js';
import { computeAppDockerInfo } from '../../../contracts/app-generator.js';

export default class AppRunCmd extends Cmd {

    static cmdname() { return 'app_run'; }

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
     * @param {string} directory 
     * @param {*} options 
     */
    async cliExec(cliDir, directory, options) {
        try {
            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);

            if (!dirExists(directory)) {
                throw errorDirDoesNotExist(directory);
            }
            directory = resolveAbsolutePath(directory);

            if (isNullishOrEmptyString(options.dockerRepo) &&
                isNullishOrEmptyString(options.dockerRepoDir)) {
                throw new CodeError("Missing option '--docker-repo' or '--docker-repo-dir'.")
            }

            const tee = (options.tee === true);
            const numWorkers = 1;
            const trust = 1;

            /** @type {string=} */
            let datasetFile = undefined;
            /** @type {string=} */
            let datasetKey = undefined;
            if (options.dataset) {
                datasetFile = resolveAbsolutePath(options.dataset);
                if (!fileExists(datasetFile)) {
                    throw errorFileDoesNotExist(datasetFile);
                }
                if (tee) {
                    if (isNullishOrEmptyString(options.datasetKey)) {
                        throw new CodeError("Missing --dataset-key option");
                    }
                    throwIfFileDoesNotExist(options.datasetKey);
                    datasetKey = readFileSync(options.datasetKey, { strict: true }) ?? undefined;
                    if (datasetKey) {
                        datasetKey = datasetKey.trim();
                    }
                }
            }

            /** @type {string=} */
            let args = undefined;
            if (options.args) {
                if (!isNullishOrEmptyString(options.args)) {
                    args = options.args;
                }
            }

            const vars = this.parseVars(options);

            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir, vars);

            const dockerUrl = inventory._inv.getDockerUrl();

            // The hubAlias = <chainid>.<deployConfigName>
            const hubAlias = inventory._inv.guessHubAlias(options);

            /* -------------------------------------------------------------- */
            /*                                                                */
            /*            STEP 1: Stop, Reset, Start all services             */
            /*                                                                */
            /* -------------------------------------------------------------- */

            if (options.reset) {
                await ResetAllCmd.exec(inventory, null);
            } else if (options.restart) {
                await StopAllCmd.exec(false, inventory, null);
            }
            // Start 'numWorkers' worker + all the specified chain services
            await StartCmd.exec(inventory, 'worker', { count: numWorkers, hub: hubAlias });

            /* -------------------------------------------------------------- */
            /*                                                                */
            /*            STEP 2: Run app in the iexec environment            */
            /*                                                                */
            /* -------------------------------------------------------------- */

            const appDir = directory;
            const appDockerInfo = await computeAppDockerInfo(
                appDir, /* app directory */
                { ...options, dockerUrl });

            // select the right dockerfile 
            const appDockerfile = (tee)
                ? appDockerInfo.dockerfileGramine
                : appDockerInfo.dockerfile;
            if (isNullishOrEmptyString(appDockerfile)) {
                throw new CodeError('Unable to determine app dockerfile');
            }
            assert(appDockerfile);

            // select the right app name:
            // - <name>
            // - <name>-gramine 
            const appName = (tee)
                ? appDockerInfo.nameGramine
                : appDockerInfo.name;
            if (isNullishOrEmptyString(appName)) {
                throw new CodeError('Unable to determine app name');
            }
            assert(appName);

            // select the right app docker repo:
            // - <repo>
            // - <repo>-gramine 
            const appDockerRepo = (tee)
                ? appDockerInfo.dockerRepoGramine
                : appDockerInfo.dockerRepo;
            if (isNullishOrEmptyString(appDockerRepo)) {
                throw new CodeError('Unable to determine app docker repository');
            }
            assert(appDockerRepo);

            // select the right app docker tag:
            const appDockerTag = appDockerInfo.dockerTag;
            if (isNullishOrEmptyString(appDockerTag)) {
                throw new CodeError('Unable to determine app docker tag');
            }
            assert(appDockerTag);

            const outRun = await runIexecApp(inventory, {
                hub: hubAlias,
                tee,
                trust,
                args,
                // inputFiles: [
                //     "https://<my-site>/helloworld.txt"
                // ],
                appDir,
                appName,
                appDockerRepo,
                appDockerTag,
                appDockerfile,
                datasetFile
            });

            /* -------------------------------------------------------------- */
            /*                                                                */
            /*                   STEP 3: Watch app run result                 */
            /*                                                                */
            /* -------------------------------------------------------------- */

            const task = await waitUntilTaskCompleted(
                outRun.hubContract,
                outRun.deal.dealid,
                0,
                testProgress);

            AppRunCmd.multiBar?.stop();

            if (task.status !== 'COMPLETED') {
                throw new CodeError(`Task failed`);
            }
            if (task.results.storage !== 'ipfs') {
                throw new CodeError(`Task failed`);
            }

            /* -------------------------------------------------------------- */
            /*                                                                */
            /*        STEP 4: Download & parse zip result from ipfs           */
            /*                                                                */
            /* -------------------------------------------------------------- */

            const ipfs = await inventory._inv.newIpfsInstance();
            assert(ipfs);

            const resultsTmpDir = path.join(getTmpDir(), `/${appDockerRepo}/results`);
            const zipURL = new URL(task.results.location, ipfs.urlString);

            // Throws an error if 'resultsDir' parent directory does not exist
            // Creates 'resultsDir' if needed
            mkDirP(resultsTmpDir);
            await downloadAndUnzipZipFile(zipURL, resultsTmpDir);

            // read inflated 'stdout.txt' 
            const stdout = await readFile(path.join(resultsTmpDir, "stdout.txt"));

            rmrfDir(resultsTmpDir);

            if (!stdout) {
                throw new CodeError("Test Failed. 'stdout.txt' file is empty")
            }

            console.log(stdout);

        } catch (err) {
            AppRunCmd.multiBar?.stop();

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
function testProgress({ count, total, value }) {
    /** @type {Object.<string, string>} */
    const formattedState = {
        'UNSET': 'UNSET    ',
        'ACTIVE': 'ACTIVE   ',
        'REVEALING': 'REVEALING',
        'COMPLETED': 'COMPLETED',
        'FAILED': 'FAILED   ',
    }

    if (!value) {
        return;
    }

    assert(value instanceof Task);

    const name = value.id;
    const state = value.status;

    if (Cmd.JsonProgress) {
        console.log(JSON.stringify({ count, total, value: { id: name, status: state } }));
        return;
    }

    if (!AppRunCmd.multiBar) {
        AppRunCmd.multiBar = new cliProgress.MultiBar({
            hideCursor: true,
            synchronousUpdate: true,
            clearOnComplete: true,
            autopadding: true,
            format: ' {bar} | {percentage}% | {state} | {name}',
        }, cliProgress.Presets.shades_classic);
        assert(!AppRunCmd.progressBars);
        AppRunCmd.progressBars = {};
    }

    if (!AppRunCmd.progressBars[name]) {
        AppRunCmd.progressBars[name] = AppRunCmd.multiBar.create(total, 0, { state: formattedState[state], name });
    }

    AppRunCmd.progressBars[name].update(count, { state: formattedState[state], name });
}