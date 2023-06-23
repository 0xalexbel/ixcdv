import assert from 'assert';
import { Cmd } from "../Cmd.js";
import path from 'path';
import StopAllCmd from './stopAll.js';
import ResetAllCmd from './resetAll.js';
import StartCmd from './start.js';
import cliProgress from 'cli-progress';
import { getTmpDir, mkDirP, readFile, rmrfDir, saveToFileSync } from '../../common/fs.js';
import { Inventory } from '../../services/Inventory.js';
import { runIexecApp, waitUntilTaskCompleted } from '../../services/Exec.js';
import { CodeError } from '../../common/error.js';
import { downloadAndUnzipZipFile } from '../../common/zip.js';
import { Task } from '../../contracts/Task.js';
import { dockerAppName } from '../../common/consts.js';
import { isNullishOrEmptyString } from '../../common/string.js';
import * as cTypes from '../../contracts/contracts-types-internal.js';

export default class TestCmd extends Cmd {

    static cmdname() { return 'test'; }

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
     * @param {*} options 
     */
    async cliExec(cliDir, options) {
        try {
            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);

            const vars = this.parseVars(options);

            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir, vars);

            // Generate temporary test app
            const appName = dockerAppName('test');
            const appDir = path.join(getTmpDir(), "/test/app");
            await generateTmpTestApp(appDir);

            let datasetFile;
            if (!isNullishOrEmptyString(options.datasetFile)) {
                if (path.isAbsolute(options.datasetFile)) {
                    datasetFile = options.datasetFile;
                } else {
                    datasetFile = path.join(process.cwd(), options.datasetFile);
                }
            } else {
                // Generate temporary test dataset
                datasetFile = path.join(getTmpDir(), "/test/dataset/hello.txt");
                await generateTmpHelloDataset(datasetFile);
            }

            // hubAlias = <chainid>.<deployConfigName>
            const hubAlias = inventory._inv.guessHubAlias(options);

            /* -------------------------------------------------------------- */
            /*                                                                */
            /*            STEP 1: Stop, Reset, Start all services             */
            /*                                                                */
            /* -------------------------------------------------------------- */

            if (options.reset) {
                await ResetAllCmd.exec(inventory, null);
            } else if (options.restart) {
                await StopAllCmd.exec(false, null);
            }
            // Start 1 worker + all the default chain
            await StartCmd.exec(inventory, 'worker', { count: 1, hub: hubAlias });

            let inputFiles = [
                "https://gist.githubusercontent.com/0xalexbel/e45c442a044d5c56669936e33f344a79/raw/18b97677eea153671e7f81a33155a4a233a749db/helloworld.txt"
            ];
            // let inputFiles = [
            //     "https://gist.githubusercontent.com/0xalexbel/e45c442a044d5c56669936e33f344a79/raw/?ok=true"
            // ];
            if (options.inputFile) {
                if (Array.isArray(options.inputFile)) {
                    inputFiles = options.inputFile;
                } else {
                    inputFiles = [];
                }
            }

            /* -------------------------------------------------------------- */
            /*                                                                */
            /*            STEP 2: Run app in the iexec environment            */
            /*                                                                */
            /* -------------------------------------------------------------- */

            
            /** @type {cTypes.MREnclave=} */
            const appMREnclave = undefined;
            // const appMREnclave = {
            //     provider: "GRAMINE",
            //     //framework: "GRAMINE",
            //     entrypoint: "python /app/app.py",
            //     version: "v5",
            //     heapSize: 1073741824,
            //     //./graphene-sgx-get-token --sig ../../entrypoint.sig
            //     fingerprint: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
            // };

            const outRun = await runIexecApp(inventory, {
                hub: hubAlias,
                trust: 1,
                args: "'do stuff' do stuff \"do stuff\"",
                inputFiles,
                appDir,
                appName,
                appMREnclave,
                datasetName: options.datasetName,
                datasetFile,
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

            TestCmd.multiBar?.stop();

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

            const resultsTmpDir = path.join(getTmpDir(), "/test/results");
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

            // Retrieve TaskID from stdout.txt (see 'generateTmpTestApp' function)
            // the script is supposed to echo the taskid
            const tastIdPattern = 'IEXEC_TASK_ID=';
            const i0 = stdout.indexOf(tastIdPattern);
            if (i0 < 0) {
                console.log('Test FAILED.');
                throw new CodeError("Test Failed. Missing IEXEC_TASK_ID.");
            }
            const i1 = stdout.indexOf('\n', i0);
            const taskId = stdout.substring(i0 + tastIdPattern.length, i1);

            if (taskId === task.id) {
                console.log(`
####################################
#                                  #
# Test App was run successfully !! #
#                                  #
####################################
                `);
            }
        } catch (err) {
            TestCmd.multiBar?.stop();

            this.exit(options, err);
        }
    }
}

/**
 * Generates `test.sh` + `Dockerfile`
 * @param {string} testDir 
 */
async function generateTmpTestApp(testDir) {

    mkDirP(testDir, { strict: true });

    const testDotShSrc = `#!/bin/sh
i=0
echo "args count=\${#}" >> "\${IEXEC_OUT}/result.txt"
while [ $# -gt 0 ]; do
    echo "ARG[$((i))]=\${1}" >> "\${IEXEC_OUT}/result.txt" 
    i=$((i+1))
    shift
done      
echo "IEXEC_IN=\${IEXEC_IN}" >> "\${IEXEC_OUT}/result.txt"
echo "IEXEC_OUT=\${IEXEC_OUT}" >> "\${IEXEC_OUT}/result.txt"
echo "IEXEC_DATASET_FILENAME=\${IEXEC_DATASET_FILENAME}" >> "\${IEXEC_OUT}/result.txt"
echo "IEXEC_TASK_ID=\${IEXEC_TASK_ID}" >> "\${IEXEC_OUT}/result.txt"
echo "IEXEC_DATASET_ADDRESS=\${IEXEC_DATASET_ADDRESS}" >> "\${IEXEC_OUT}/result.txt"
echo "IEXEC_BOT_SIZE=\${IEXEC_BOT_SIZE}" >> "\${IEXEC_OUT}/result.txt"
echo "IEXEC_BOT_FIRST_INDEX=\${IEXEC_BOT_FIRST_INDEX}" >> "\${IEXEC_OUT}/result.txt"
echo "IEXEC_BOT_TASK_INDEX=\${IEXEC_BOT_TASK_INDEX}" >> "\${IEXEC_OUT}/result.txt"
echo "IEXEC_INPUT_FILES_FOLDER=\${IEXEC_INPUT_FILES_FOLDER}" >> "\${IEXEC_OUT}/result.txt"
echo "IEXEC_INPUT_FILES_NUMBER=\${IEXEC_INPUT_FILES_NUMBER}" >> "\${IEXEC_OUT}/result.txt" 
i=1
while [ "\${i}" -lt "\${IEXEC_INPUT_FILES_NUMBER}" ]; do          
    varname="IEXEC_INPUT_FILE_NAME_\${i}"
    echo "\${varname}=\${!varname}" >> "\${IEXEC_OUT}/result.txt" 
    i=$((i+1))
done      
echo "{ \\"deterministic-output-path\\": \\"\${IEXEC_OUT}/result.txt\\" }" > "\${IEXEC_OUT}/computed.json"
cat "\${IEXEC_OUT}/result.txt"

if [ -f "\${IEXEC_IN}/\${IEXEC_DATASET_FILENAME}" ]; then
echo ""
echo "=================================================================="
echo "Dataset file path = \${IEXEC_IN}/\${IEXEC_DATASET_FILENAME}"
cat "\${IEXEC_IN}/\${IEXEC_DATASET_FILENAME}"
fi

if [ -f "\${IEXEC_INPUT_FILES_FOLDER}/\${IEXEC_INPUT_FILE_NAME_1}" ]; then
    echo ""
    echo "=================================================================="
    echo "Input file #1 path = \${IEXEC_INPUT_FILES_FOLDER}/\${IEXEC_INPUT_FILE_NAME_1}"
    cat "\${IEXEC_INPUT_FILES_FOLDER}/\${IEXEC_INPUT_FILE_NAME_1}"
fi
`;

    const testDotSh = 'test.sh';

    saveToFileSync(testDotShSrc, testDir, testDotSh);

    const dockerfileSrc = `FROM alpine
RUN mkdir -p /test
WORKDIR /test
COPY ${testDotSh} test.sh
ENTRYPOINT ["sh", "test.sh"]
`;

    saveToFileSync(dockerfileSrc, testDir, 'Dockerfile');
}

/**
 * @param {string} helloFile 
 */
async function generateTmpHelloDataset(helloFile) {

    const helloDir = path.dirname(helloFile);
    mkDirP(helloDir, { strict: true });

    const helloStr = `Hello from dataset!`;

    saveToFileSync(helloStr, helloDir, path.basename(helloFile));
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

    if (!TestCmd.multiBar) {
        TestCmd.multiBar = new cliProgress.MultiBar({
            hideCursor: true,
            synchronousUpdate: true,
            clearOnComplete: true,
            autopadding: true,
            format: ' {bar} | {percentage}% | {state} | {name}',
        }, cliProgress.Presets.shades_classic);
        assert(!TestCmd.progressBars);
        TestCmd.progressBars = {};
    }

    if (!TestCmd.progressBars[name]) {
        TestCmd.progressBars[name] = TestCmd.multiBar.create(total, 0, { state: formattedState[state], name });
    }

    TestCmd.progressBars[name].update(count, { state: formattedState[state], name });
}