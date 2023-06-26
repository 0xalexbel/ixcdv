// import assert from 'assert';
// import path from 'path';
// import { Cmd } from "../Cmd.js";
// import { Inventory } from "../../services/Inventory.js";
// import { CodeError } from "../../common/error.js";
// import { generateTmpPathname, mkDirP, readFileSync, rmrf, saveToFileSync } from "../../common/fs.js";
// import { qemuSystemI386, qemuSystemI386IsRunning, qemuSystemI386Version } from '../../qemu/qemu-system-i386-api.js';
// import * as ssh from '../../common/ssh.js';
// import { ConfigFile } from '../../services/ConfigFile.js';

// export default class SetConfigCmd extends Cmd {

//     static cmdname() { return 'set-config'; }

//     /**
//      * @param {string} cliDir 
//      * @param {*} options 
//      */
//     async cliExec(cliDir, options) {
//         try {
//             const vars = this.parseVars(options);
//             const hasVars = Object.keys(vars).length;

//             const configDir = this.resolveConfigDir(cliDir);
//             this.exitIfNoConfig(configDir);

//             // Load inventory from config json file
//             const inventory = await Inventory.fromConfigFile(configDir, vars);

            
//             /** 
//              * @type { import('ssh2').ConnectConfig & 
//              *    { 
//              *      remoteMachineType: 'qemu' | 'docker' | 'default'
//              *      qemuHda: string
//              *      qemuCpu: string
//              *      port: number
//              *      privateKeyFile: string 
//              *      remoteWorkingDirectory: string,
//              *      remoteGatewayIp: string
//              *      remoteMachineName: string
//              *    }
//              * } 
//              */
//             const connectConfig = {
//                 remoteMachineType: 'qemu',
//                 qemuHda: "/Users/alex/qemu/ubuntu20.04/ubuntu-20-04-server.qcow2",
//                 qemuCpu: "host",
//                 remoteMachineName: "node1",
//                 remoteGatewayIp: '10.0.2.2',
//                 remoteWorkingDirectory: './',
//                 host: 'localhost',
//                 forceIPv4: true, // Macos sometimes it fails with ipv6 + localhost
//                 port: 2222,
//                 username: 'alex',
//                 privateKey: undefined,
//                 privateKeyFile: "/Users/alex/qemu/ubuntu20.04/qemuworkerkey",
//                 readyTimeout: 1000 * 60
//             };

//             const k = readFileSync(
//                 connectConfig.privateKeyFile,
//                 { strict: true });
//             assert(k);
//             connectConfig.privateKey = k;
//             if (!connectConfig.privateKey) {
//                 throw new CodeError('Unable to read ssh private key');
//             }

//             const version = await qemuSystemI386Version({ strict: true });
//             console.log(version);

//             const isRunning = await qemuSystemI386IsRunning(
//                 connectConfig.qemuHda,
//                 connectConfig.qemuCpu,
//                 connectConfig.port,
//                 []);

//             if (!isRunning) {
//                 console.log("QEMU is not running. Start QEMU...");
//                 const res = await qemuSystemI386(
//                     connectConfig.qemuHda,
//                     connectConfig.qemuCpu,
//                     connectConfig.port,
//                     [],
//                     { strict: true });
//                 console.log(res);
//             } else {
//                 console.log("QEMU is already running.");
//             }

//             const remoteFile = path.join(connectConfig.remoteWorkingDirectory, ConfigFile.basename());
//             const tmpFile = await generateTmpPathname();
//             try {
//                 const configJSON = await inventory.toConfigJSON(inventory._inv.rootDir);
//                 assert(configJSON.vars);
//                 configJSON.vars["master"] = connectConfig.remoteGatewayIp;
//                 configJSON.vars["localHostname"] = '${' + connectConfig.remoteMachineName + '}';

//                 saveToFileSync(
//                     JSON.stringify(configJSON, null, 2),
//                     path.dirname(tmpFile),
//                     path.basename(tmpFile),
//                     { strict: true });

//                 await ssh.scp(connectConfig, tmpFile, remoteFile);
//             } catch { }
//             rmrf(tmpFile);

//             let ok = await ssh.exists(connectConfig, remoteFile);
//             console.log(ok);

//             const str = await ssh.cat(connectConfig, remoteFile);
//             console.log(str);
//             return;

//             ok = await ssh.exists(connectConfig, 'caca.json');
//             console.log(ok);
//             ok = await ssh.rmrf(connectConfig, 'caca.json');
//             console.log(ok);
//             ok = await ssh.exists(connectConfig, 'caca.json');
//             console.log(ok);


//             //await ssh.exec2(connectConfig, 'source ~/.nvm/nvm.sh ; cd /home/alex/t ; node test.js');
//             //await ssh.exec(connectConfig, 'source ~/.nvm/nvm.sh ; cd /home/alex/t ; node test.js');
//             await ssh.ixcdv(connectConfig, "", ["--help"]);
//             console.log("=============================");
//             if (! await ssh.exists(connectConfig, './workspace/ixcdv-config.json')) {
//                 console.log("=============================");
//                 throw new CodeError("Unable to locate './workspace/ixcdv-config.json' on remote machine.");
//             }
//             const aa = await ssh.pwd(connectConfig);
//             await ssh.ixcdv(connectConfig, './workspace', ["start", "sms", "--no-dependencies"]);
//             const gg = await ssh.exists(connectConfig, 'install-tools.sh');
//             console.log(gg);

//             await ssh.scp(connectConfig, "ixcdv-config.json", "caca.json");
//             ok = await ssh.exists(connectConfig, 'caca.json');
//             console.log(ok);
//             ok = await ssh.rmrf(connectConfig, 'caca.json');
//             console.log(ok);
//             ok = await ssh.exists(connectConfig, 'caca.json');
//             console.log(ok);

//             // await ssh.exec(connectConfig, 'echo aa > pipo.txt');

//             // let ok = await ssh.exists(connectConfig, 'pipo.txt');
//             // console.log(ok);

//             // ok = await ssh.rmrf(connectConfig, 'pipo.txt');
//             // console.log(ok);

//             // ok = await ssh.exists(connectConfig, 'pipo.txt');
//             // console.log(ok);

//             //await ssh.exec(connectConfig, 'ls -la');
//             //await ssh.ixcdv(connectConfig, "", ["--help"]);
//             //await ssh.shutdown(connectConfig);
//         } catch (err) {
//             this.exit(options, err);
//         }
//     }

//     /**
//      * @param {string} cliDir 
//      * @param {*} options 
//      */
//     async cliExec2(cliDir, options) {
//         try {
//             const configDir = this.resolveConfigDir(cliDir);
//             this.exitIfNoConfig(configDir);

//             const type = options.type;
//             assert(type);

//             // Load inventory from config json file
//             const inventory = await Inventory.fromConfigFile(configDir, {});

//             const hubAlias = inventory._inv.guessHubAlias(options);
//             const ic = inventory._inv.getConfigFromHub(type, hubAlias);
//             if (!ic) {
//                 throw new CodeError('Error');
//             }

//             const unsolved = ic.unsolved;
//             assert(unsolved.type === type);
//             if (!options.var) {
//                 //@ts-ignore
//                 unsolved[options.key] = options.value;
//             } else {
//                 //@ts-ignore
//                 unsolved[options.key] = "${" + options.value + "}";
//             }

//             await inventory.saveConfigFile({ directory: configDir, overrideExistingFile: true });
//         } catch (err) {
//             this.exit(options, err);
//         }
//     }
// }
