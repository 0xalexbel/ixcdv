#!/usr/bin/env node

import { Command } from 'commander';
import { processEndActiveSockets } from '../common/process.js';
import { stringToPositiveInteger } from '../common/string.js';
import { DEFAULT_MNEMONIC } from '../services/default-config.js';
import { PROD_BIN, PROD_CONFIG_BASENAME, PROD_NAME, PROD_VERSION } from '../common/consts.js';

const program = new Command();

/**
 * @param {string} cmd 
 * @param  {...any} args 
 */
async function execCmd(cmd, ...args) {
    const jsFile = `./cmds/${cmd}.js`;
    const opts = program.optsWithGlobals();
    // --debug option
    const debugMode = (opts.debug === true);
    // --config option
    const dir = (opts.config) ? opts.config : process.cwd();
    let cmdModule = null;
    try { cmdModule = await import(jsFile); } catch (err) {
        if (err instanceof Error) {
            console.log(err.stack);
        }
    }
    if (cmdModule) {
        const command = new cmdModule.default();
        if (command.debugMode !== undefined) {
            command.debugMode = debugMode;
        }
        const out = await command.cliExec(dir, ...args);

        // For some yet unknown reasons, sockets behing http requests on 
        // docker private registry server are not closing properly, 
        // preventing node from closing. This case appeared with node v19. 
        // Is it due to node ? vscode ? docker server ? 
        // To solve the problem, we must loop through the active sockets and
        // end them manually one after the other.
        await processEndActiveSockets();

        return out;
    }
}

/** @param {Command} cmd */
function addChainAndHubOptions(cmd) {
    return cmd
        .option('--chain <name>', `Chain name. Type '${PROD_BIN} show chains' to list all available chain names.`)
        .option('--hub <hubAlias>', `Hub alias. Type '${PROD_BIN} show hubs' to list all available hub aliases.`);
}

let cmd;

program
    .name(PROD_NAME)
    .description(`${PROD_NAME} v${PROD_VERSION} - a development framework for iexec`)
    .version(PROD_VERSION);

program.configureHelp({
    helpWidth: 120
});

const initCmd = program.command('init');
const configCmd = program.command('config');
const installCmd = program.command('install');
const uninstallCmd = program.command('uninstall');
const testCmd = program.command('test');
const pingCmd = program.command('ping');
const machineCmd = program.command('machine');
const vscodeCmd = program.command('vscode');

const startCmd = program.command('start');
const stopCmd = program.command('stop');
const resetCmd = program.command('reset');
const killCmd = program.command('kill');
const pidCmd = program.command('pid');
const showCmd = program.command('show');

const appCmd = program.command('app');
const datasetCmd = program.command('dataset');
const workerpoolCmd = program.command('workerpool');
const dealCmd = program.command('deal');
const taskCmd = program.command('task');
const kycCmd = program.command('kyc');
const sdkCmd = program.command('sdk');

/* ------------- init -------------- */

initCmd.description(`Creates a new '${PROD_CONFIG_BASENAME}' file in the current working directory.
The saved config file can be manually edited. Once ready, type '${PROD_BIN} install' to locally deploy the ${PROD_NAME} workspace as configured.`)
    .summary(`Creates a new '${PROD_CONFIG_BASENAME}' file in the current working directory.`)
    .argument('[directory]', `Folder where the newly created '${PROD_CONFIG_BASENAME}' file should be saved. The command will fail if <directory> does not exist. If unspecified, use the current working directory.`)
    .option('--force', `Overrides any existing '${PROD_CONFIG_BASENAME}' file.`)
    .option('--first-chainId <id>', 'id of the first chain (id of the second chain = <id> + 1 etc.).', "1337")
    .option('--count-chainIds <num>', 'Number of independent chains. By default 1 chainid (1337) will be configured.', "1")
    .option("-m, --mnemonic <mnemonic|new...>", `Specifies a list of mnemonics used to generate all wallets.
If a single mnemonic is specified (or a new random one using the 'new' keyword), it will be shared among all chainIds.
Otherwise, the command is expecting one mnemonic per chainId.
Use the 'new' keyword to specify a random mnemonic.
By default all the chainids are sharing the same following mnemonic: "${DEFAULT_MNEMONIC}"`)
    .action((directory, options) => {
        execCmd('init', directory, options);
    });

/* ------------- install -------------- */

installCmd.description(`Installs a new ${PROD_NAME} workspace in the current working directory (or in the folder specified using the global '--config' option). The command will fail if the install directory does contain a valid '${PROD_CONFIG_BASENAME}' file. Use the '${PROD_BIN} init' command to generate a new config file.`)
    .summary(`Installs a new ${PROD_NAME} workspace.`)
    .option('--type <type>', 'Only installs configs with a specific type <"all"|"iexecsdk">')
    .option('--vars <vars...>', 'Specify key/value pairs <key>=<value>')
    .action((options) => {
        execCmd('install', options);
    });

/* ------------- ping -------------- */

pingCmd.description('Performs a ping-like network command on a specified service.\n ');
addChainAndHubOptions(pingCmd);
pingCmd.argument('<type>', 'Service type')
    .action((type, options) => {
        execCmd('ping', type, options);
    });

/* ------------- config -------------- */

machineCmd.description('Machine related commands.\n ');
cmd = machineCmd.command('generate-scripts');
cmd.description("Generate the scripts to install the specified machine.")
    .argument('<name>', 'Machine name')
    .action((name, options) => {
        execCmd('machine', 'generate-scripts', { name, options });
    });
cmd = machineCmd.command('install-tools');
cmd.description("Install all the necessary software tools on the specified machine.")
    .argument('<name>', 'Machine name')
    .action((name, options) => {
        execCmd('machine', 'install-tools', { name, options });
    });
cmd = machineCmd.command('print-config');
cmd.description("Print the remote machine 'ixcdv-config.json' file.")
    .argument('<name>', 'Machine name')
    .action((name, options) => {
        execCmd('machine', 'print-config', { name, options });
    });
cmd = machineCmd.command('upload-config');
cmd.description("Upload 'ixcdv-config.json' file to the specified machine.")
    .argument('<name>', 'Machine name')
    .action((name, options) => {
        execCmd('machine', 'print-config', { name, options: { ...options, upload : true } });
    });
cmd = machineCmd.command('start');
cmd.description("Boot the specified machine.")
    .argument('<name>', 'Machine name')
    .action((name, options) => {
        execCmd('machine', 'start', { name, options });
    });
cmd = machineCmd.command('shutdown');
cmd.description("Power-off the specified machine.")
    .argument('<name>', 'Machine name')
    .action((name, options) => {
        execCmd('machine', 'shutdown', { name, options });
    });

/* ------------- install -------------- */

uninstallCmd.description(`Uninstalls a ${PROD_NAME} workspace in the current working directory (or in the folder specified using the global '--config' option). The command will fail if the install directory does contain a valid '${PROD_CONFIG_BASENAME}' file.`)
    .summary(`Uninstalls an existing ${PROD_NAME} workspace.`)
    .option('--keep-ganache', 'Uninstalls everything except the ganache dbs (which take time to initialize)')
    .action((options) => {
        execCmd('uninstall', options);
    });

/* ------------- test -------------- */

addChainAndHubOptions(testCmd);
testCmd.description('Runs a test app on the specified chain.')
    .option('--restart', "Restart all services before launching the test.")
    .option('--reset', "Reset before launching the test.")
    .option('--dataset-file <file>', "Run the test using a custom dataset file.")
    .option('--dataset-name <name>', "Run the test using a custom dataset name.")
    .option('--input-file <urls...>', "Specify custom input file request parameter. (Variadic option)")
    .action((options) => {
        execCmd('test', options);
    });

/* ------------- vscode -------------- */

vscodeCmd.description('vscode related commands.\n ');

cmd = vscodeCmd.command('install');
cmd.description("Generates vscode '.code-workspace' files (one for each chain).")
    .option('--out <out>', "Output root directory")
    .option('--force', 'Overrides any existing file')
    .action((options) => {
        execCmd('vscode', 'install', options);
    });

cmd = vscodeCmd.command('prelaunchtask', { hidden: true });
addChainAndHubOptions(cmd);
cmd.description("Generates a vscode '.code-workspace' file.")
    .option('--type <type>', 'Service type')
    .option('--worker-index <workerindex>', 'Worker index')
    .action((options) => {
        if (options.workerIndex) {
            options.workerIndex = stringToPositiveInteger(options.workerIndex);
        }
        execCmd('vscode', 'prelaunchtask', options);
    });

/* ------------- show -------------- */

showCmd.description(`Prints infos related to the ${PROD_NAME} config.\n `);

cmd = showCmd.command('chains');
cmd.description('List all chain names.')
    .action((options) => {
        execCmd('show', 'chains', options);
    });

cmd = showCmd.command('hubs');
cmd.description('List all hubs.')
    .action((options) => {
        execCmd('show', 'hubs', options);
    });

cmd = showCmd.command('wallets');
cmd.description('List all wallets.')
    .action((options) => {
        execCmd('show', 'wallets', options);
    });

cmd = showCmd.command('sysreq');
cmd.description('List all system requirements.')
    .action((options) => {
        execCmd('show', 'sysreq', options);
    });

cmd = showCmd.command('keystoredir');
addChainAndHubOptions(cmd);
cmd.description('Prints the wallets keystore directory.')
    .option('--chainid <chainid>', 'Chain id')
    .action((options) => {
        execCmd('show', 'keystoredir', options);
    });

/* ------------- kyc -------------- */

kycCmd.description("Manages 'kyc' roles (enterprise only)");

cmd = kycCmd.command('show');
addChainAndHubOptions(cmd);
cmd.description("Prints 'true' if 'address' has been granted 'kyc' role.\nThis command only runs on an enterprise chain or hub.")
    .argument('<address>', 'Account address')
    .action((address, options) => {
        execCmd('kyc', 'show', address, options);
    });

cmd = kycCmd.command('grant');
addChainAndHubOptions(cmd);
cmd.description("Grants 'kyc' role to address.\nThis command only runs on an enterprise chain or hub.")
    .argument('<address>', 'Account address')
    .action((address, options) => {
        execCmd('kyc', 'grant', address, options);
    });

cmd = kycCmd.command('revoke');
addChainAndHubOptions(cmd);
cmd.description("Revokes 'kyc' role from address.\nThis command only runs on an enterprise chain or hub.")
    .argument('<address>', 'Account address')
    .action((address, options) => {
        execCmd('kyc', 'revoke', address, options);
    });

/* ------------- app -------------- */

appCmd.description('Apps related commands.');

cmd = appCmd.command('run');
addChainAndHubOptions(cmd);
cmd.description(`Runs an app within the ${PROD_NAME} 'local' microservices architecture. The command will perform the following operations:
  - Build & publish the app docker image on ${PROD_NAME} 'local' docker registry.
  - Deploy the app
  - If needed, add the <datasetFile> to ${PROD_NAME} 'local' private ipfs node.
  - Deploy the dataset
  - Compute the necessary orders and request the app execution.
  - Wait for final result.`)
    .summary(`Runs an app within the ${PROD_NAME} 'local' microservices architecture.`)
    .argument('<directory>', "The folder containing the app's Dockerfile to execute.")
    .requiredOption('--name <app name>', "The app name (required).")
    .option('--dataset <datasetFile>', 'A dataset file.')
    .option('--args <args>', 'App arguments.')
    .action((directory, options) => {
        execCmd('app/run', directory, options);
    });

cmd = appCmd.command('init');
addChainAndHubOptions(cmd);
cmd.description(`Given a <directory> containing an app's 'Dockerfile' as input, generates or updates the associated 'app' entry in an 'iexec.json' file. The command will perform the following operations:
  - Build & publish the docker image on ${PROD_NAME} 'local' docker registry.
  - Compute the app checksum and multiaddr fields.
  - Update the iexec.json file.
The command will also generate the corresponding 'chain.json' file.
Both files are required to execute any command using the official 'iexec' sdk cli.`)
    .summary("Generates/updates the 'app' entry in an 'iexec.json' file.")
    .argument('<directory>', "The folder where the app's 'Dockerfile' is located.")
    .requiredOption('--name <app name>', "The app name (required).")
    .option('--out <directory>', "The folder where both 'iexec.json' and 'chain.json' files will be generated or updated.\n(default: current working directory)")
    .option('--force', "- Creates missing directories\n- If 'iexec.json' file already exists, overrides any existing 'app' entry.")
    .action((directory, options) => {
        execCmd('app/init', directory, options);
    });

/* ------------- dataset -------------- */

datasetCmd.description('Datasets related commands.');

cmd = datasetCmd.command('init');
addChainAndHubOptions(cmd);
cmd.description(`Given a <datasetFile> as input, generates or updates the associated 'dataset' entry in an 'iexec.json' file. The command will perform the following operations:
  - Add the <datasetFile> to ${PROD_NAME} 'local' private ipfs node.
  - Compute the dataset checksum and multiaddr fields.
  - Update the iexec.json file.
The command will also generate the corresponding 'chain.json' file.
Both files are required to execute any command using the official 'iexec' sdk cli.`)
    .summary("Generates/updates the 'dataset' entry in an 'iexec.json' file.")
    .argument('<datasetFile>', 'The dataset file.')
    .option('--out <directory>', "The folder where both 'iexec.json' and 'chain.json' files will be generated or updated. (default: current working directory)")
    .option('--force', "- Creates missing directories\n- If 'iexec.json' file already exists, overrides any existing 'dataset' entry.")
    .action((datasetFile, options) => {
        execCmd('dataset/init', datasetFile, options);
    });

/* ------------- dataset -------------- */

workerpoolCmd.description('Workerpools related commands.');

cmd = workerpoolCmd.command('show');
addChainAndHubOptions(cmd);
cmd.description(`Displays infos about the pre-installed workerpool.`)
    .action((options) => {
        execCmd('workerpool/show', options);
    });

/* ------------- deal -------------- */

dealCmd.description('Deals related commands.');

cmd = dealCmd.command('show');
addChainAndHubOptions(cmd);
cmd.description('Show deals.')
    .argument('[dealid]', 'a dealid. If unspecified, lists all existing dealids.')
    .action((dealid, options) => {
        execCmd('deal', dealid, options);
    });

/* ------------- task -------------- */

taskCmd.description('Tasks related commands.');

cmd = taskCmd.command('show');
addChainAndHubOptions(cmd);
cmd.description('Show tasks.')
    .argument('[taskid]', 'a taskid. If unspecified, lists all existing taskids')
    .action((dealid, options) => {
        execCmd('task', dealid, options);
    });

/* ------------- stop -------------- */

stopCmd.description('Stops services.');

cmd = stopCmd.command('all');
cmd.description('Stops all running services.')
    .action((options) => {
        execCmd('stopAll', 'all', false, options);
    });

cmd = stopCmd.command('worker');
cmd.description('Stops all running workers.')
    .action((options) => {
        execCmd('stopAll', 'worker', false, options);
    });

/* ------------- stop -------------- */

killCmd.description('Kills services.');

cmd = killCmd.command('all');
cmd.description('Kills all running services.')
    .action((options) => {
        execCmd('stopAll', 'all', true, options);
    });

cmd = killCmd.command('worker');
cmd.description('Kills all running workers.')
    .action((options) => {
        execCmd('stopAll', 'worker', true, options);
    });

/* ------------- reset -------------- */

resetCmd.description('Stops and resets services.');

cmd = resetCmd.command('all');
cmd.description('Stops and resets all services.')
    .action((options) => {
        execCmd('resetAll', options);
    });

/* ------------- start -------------- */

startCmd.description('Starts services.');

cmd = startCmd.command('ganache');
addChainAndHubOptions(cmd);
cmd.description('Starts a ganache PoCo service.')
    .option('--chainid <chainid>', 'Chain id.')
    .action((options) => {
        execCmd('start', 'ganache', options);
    });

cmd = startCmd.command('ipfs');
cmd.description('Starts the ipfs service.')
    .action((options) => {
        execCmd('start', 'ipfs', options);
    });

cmd = startCmd.command('market');
addChainAndHubOptions(cmd);
cmd.description('Starts a new Market service.')
    .option('--chainid <chainid>', 'Chain id.')
    .action((options) => {
        execCmd('start', 'market', options);
    });

cmd = startCmd.command('sms');
addChainAndHubOptions(cmd);
cmd.description('Starts a new Sms service.')
    .option('--no-dependencies', "Do not start any service dependency")
    .action((options) => {
        execCmd('start', 'sms', options);
    });

cmd = startCmd.command('resultproxy');
addChainAndHubOptions(cmd);
cmd.description('Starts a new Result Proxy service.')
    .action((options) => {
        execCmd('start', 'resultproxy', options);
    });

cmd = startCmd.command('blockchainadapter');
addChainAndHubOptions(cmd);
cmd.description('Starts a new Blockchain Adapter service.')
    .action((options) => {
        execCmd('start', 'blockchainadapter', options);
    });

cmd = startCmd.command('core');
addChainAndHubOptions(cmd);
cmd.description('Starts a new Core service.')
    .action((options) => {
        execCmd('start', 'core', options);
    });

cmd = startCmd.command('worker');
addChainAndHubOptions(cmd);
cmd.description('Starts a given number of Worker services.')
    .option('--count <count>', 'Number of workers to start (default=1)')
    .action((options) => {
        execCmd('start', 'worker', options);
    });

cmd = startCmd.command('iexecsdk');
addChainAndHubOptions(cmd);
cmd.description('Starts the minimum services to execute iexec sdk commands.')
    .option('--count <count>', 'Number of workers to start (default=1)')
    .action((options) => {
        execCmd('start', 'iexecsdk', options);
    });

cmd = startCmd.command('docker');
addChainAndHubOptions(cmd);
cmd.description('Starts Docker Desktop.')
    .action((options) => {
        execCmd('start', 'docker', options);
    });

/* ------------- pid -------------- */

pidCmd.description('Displays all running services.')
    .action((options) => {
        execCmd('pid', 'all', options);
    });

pidCmd.command('ganache')
    .description('Displays the ganache PoCo service pids.')
    .action((options) => {
        execCmd('pid', 'ganache', options);
    });

pidCmd.command('ipfs')
    .description('Displays the ipfs service pids.')
    .action((options) => {
        execCmd('pid', 'ipfs', options);
    });

pidCmd.command('market')
    .description('Displays the Market service pids.')
    .action((options) => {
        execCmd('pid', 'market', options);
    });

pidCmd.command('sms')
    .description('Displays the Sms service pids.')
    .action((options) => {
        execCmd('pid', 'sms', options);
    });

pidCmd.command('resultproxy')
    .description('Displays the Result Proxy service pids.')
    .action((options) => {
        execCmd('pid', 'resultproxy', options);
    });

pidCmd.command('blockchainadapter')
    .description('Displays the Blockchain Adapter service pids.')
    .action((options) => {
        execCmd('pid', 'blockchainadapter', options);
    });

pidCmd.command('core')
    .description('Displays the Core service pids.')
    .action((options) => {
        execCmd('pid', 'core', options);
    });

pidCmd.command('worker')
    .description('Displays the Worker service pids.')
    .action((options) => {
        execCmd('pid', 'worker', options);
    });

/* ------------- sdk -------------- */

sdkCmd.description('iExec CLI helpers.');

const sdkWalletCmd = sdkCmd.command('wallet');
cmd = sdkWalletCmd.command('print-cli-opts');
addChainAndHubOptions(cmd);
cmd.description(`Helper, prints the wallet options required to run 'iexec' cli commands.
Example: iexec app count \`${PROD_BIN} sdk wallet print-cli-opts --type app\``)
    .summary(`Helper, prints out the 'iexec' cli wallet options.`)
    .option('--local', `Sets --keystoredir to 'local'.`)
    .option('--relative', `Compute relative paths.`)
    .option('--type <type>', '<"admin"|"app"|"dataset"|"workerpool"|"requester">')
    .action((options) => {
        execCmd('sdk/wallet/printCliOpts', options);
    });

cmd = sdkCmd.command('init');
addChainAndHubOptions(cmd);
cmd.description(`Helper, generates the iExec sdk files : 'chain.json', 'iexec.json' and 'deployed.json'.
These files are required by the iExec sdk. If 'chain.json' or 'iexec.json' is missing, the sdk will raise and error.`)
    .summary(`Helper, generates iExec sdk files : 'chain.json', 'iexec.json' and 'deployed.json'.`)
    .option('--out <directory>', "The folder where files will be generated or updated.\n(default: current working directory)")
    .option('--force', "- Creates missing directories")
    .action((options) => {
        execCmd('sdk/init', options);
    });

program.option('--config <directory>', `Folder where the '${PROD_CONFIG_BASENAME}' file is located.\nThis option is ignored when used in conjonction with the 'init' command.`);
program.option('--debug', `Enable ${PROD_NAME} debug mode (development only).`);
program.parse();
