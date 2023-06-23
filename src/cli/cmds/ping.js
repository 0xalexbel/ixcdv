import assert from 'assert';
import path from 'path';
import { Cmd } from "../Cmd.js";
import { Inventory } from "../../services/Inventory.js";
import { CodeError } from "../../common/error.js";
import { generateTmpPathname, mkDirP, readFileSync, rmrf, saveToFileSync } from "../../common/fs.js";
import { qemuSystemI386, qemuSystemI386IsRunning, qemuSystemI386Version } from '../../qemu/qemu-system-i386-api.js';
import * as ssh from '../../common/ssh.js';
import { ConfigFile } from '../../services/ConfigFile.js';
import { hostnamePortToString } from '../../common/string.js';
import { getEthAccounts } from '../../common/ethers.js';

export default class PingCmd extends Cmd {

    static cmdname() { return 'ping'; }

    /**
     * @param {string} cliDir 
     * @param {string} type 
     * @param {*} options 
     */
    async cliExec(cliDir, type, options) {
        try {
            const vars = this.parseVars(options);
            const hasVars = Object.keys(vars).length;

            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);

            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir, vars);

            //hostfwd
            //guestfwd
            // curl http://localhost:8545/ -X POST -H "Content-Type: application/json" --data '{"method":"eth_accounts","id":1,"jsonrpc":"2.0"}'

            if (type === 'ganache') {
                const ic = inventory._inv.guessConfig({ type, ...options });
                const conf = ic?.resolved;
                assert(conf);
                assert(conf.type === 'ganache');
                const url = "http://127.0.0.1:8545";
                const res = await getEthAccounts(conf.config.chainid, url);
                let hh =0;
            } else {
                throw new CodeError(`Unsupported service type ${options.type}`)
            }
        } catch (err) {
            this.exit(options, err);
        }
    }

    /**
     * @param {string} cliDir 
     * @param {*} options 
     */
    async cliExec2(cliDir, options) {
        try {
            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);

            const type = options.type;
            assert(type);

            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir, {});

            const hubAlias = inventory._inv.guessHubAlias(options);
            const ic = inventory._inv.getConfigFromHub(type, hubAlias);
            if (!ic) {
                throw new CodeError('Error');
            }

            const unsolved = ic.unsolved;
            assert(unsolved.type === type);
            if (!options.var) {
                //@ts-ignore
                unsolved[options.key] = options.value;
            } else {
                //@ts-ignore
                unsolved[options.key] = "${" + options.value + "}";
            }

            await inventory.saveConfigFile({ directory: configDir, overrideExistingFile: true });
        } catch (err) {
            this.exit(options, err);
        }
    }
}
