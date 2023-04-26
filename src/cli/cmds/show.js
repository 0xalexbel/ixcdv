import { Cmd } from "../Cmd.js";
import assert from 'assert';
import { getSysReq } from "../../common/sysreq.js";
import { Inventory } from "../../services/Inventory.js";
import { GanachePoCoService } from "../../poco/GanachePoCoService.js";

export default class ShowCmd extends Cmd {

    static cmdname() { return 'init'; }

    /**
     * @param {string} cliDir 
     * @param {string} cmd 
     * @param {*} options 
     */
    async cliExec(cliDir, cmd, options) {
        try {
            if (cmd === 'sysreq') {
                // No need to load any config file !
                const sr = await getSysReq();
                console.log(sr.toMessage());
                //console.log(JSON.stringify(sr, null, 2));
                return;
            }

            const configDir = this.resolveConfigDir(cliDir);
            this.exitIfNoConfig(configDir);
            // Load inventory from config json file
            const inventory = await Inventory.fromConfigFile(configDir);

            if (cmd === 'chains') {
                const chainNames = inventory._inv.allChainNames();
                console.log(`CHAIN NAME\t\tHUB ALIAS`);
                for (let i = 0; i < chainNames.length; ++i) {
                    const cn = chainNames[i];
                    const chainHub = inventory._inv.getChainHub(cn);
                    console.log(`${cn}\t\t${chainHub}`);
                }
            } else if (cmd === 'keystoredir') {
                const ganacheConf = inventory._inv.guessConfig({ ...options, type: 'ganache' });
                if (ganacheConf) {
                    const g = await inventory._inv.newInstanceFromInventoryConfig(ganacheConf);
                    if (g) {
                        assert(g instanceof GanachePoCoService);
                        console.log(g.walletsDir);
                    }
                }
            } else if (cmd === 'wallets') {
                const configNames = inventory._inv.getConfigNamesFromType('ganache');
                if (configNames && configNames.length > 0) {
                    for (let i = 0; i < configNames.length; ++i) {
                        const g = await inventory._inv.newGanacheInstance(configNames[i]);
                        if (g) {
                            console.log(``);
                            console.log(`Accounts chainid=${g.chainid}`);
                            console.log(`=====================`);

                            console.log(`directory: ${g.walletsDir}`);
                            console.log(`password : ${g.walletsPassword}`);

                            /** @type {{privateKey:string, address:string}} */
                            let keys;
                            /** @type {number} */
                            let index;

                            /** @type {('admin'|'workerpool'|'app'|'dataset'|'requester'|'worker')[]} */
                            const types = ['admin', 'workerpool', 'app', 'dataset', 'requester'];
                            // formatted types
                            const ftypes = [
                                '(admin)     ',
                                '(workerpool)',
                                '(app)       ',
                                '(dataset)   ',
                                '(requester) '
                            ];
                            for (let i = 0; i < types.length; ++i) {
                                index = inventory.getDefaultWalletIndex(types[i]);
                                keys = g.walletKeysAtIndex(index);
                                console.log(`wallet${index}.json ${ftypes[i]} : ${keys.address}  privateKey: ${keys.privateKey}`);
                            }
                            // workers
                            for (let i = 0; i < 5; ++i) {
                                index = inventory.getDefaultWalletIndex('worker') + i;
                                keys = g.walletKeysAtIndex(index);
                                console.log(`wallet${index}.json (worker#${i})   : ${keys.address}  privateKey: ${keys.privateKey}`);
                            }
                        }
                    }
                }
            } else if (cmd === 'hubs') {
                const services = await inventory.getChainids();
                if (!services) {
                    console.log('No hubs');
                } else {
                    const chainids = [...services.keys()];

                    const lines = [];
                    let configMaxLen = 0;
                    let contractMaxLen = 0;
                    for (let i = 0; i < chainids.length; ++i) {
                        const g = services.get(chainids[i]);
                        if (!g) {
                            continue;
                        }
                        const hubs = g.hubs();
                        for (let j = 0; j < hubs.length; ++j) {
                            const s = hubs[j].hubAlias();
                            const c = hubs[j].contractName;
                            assert(c);
                            if (s.length > configMaxLen) {
                                configMaxLen = s.length;
                            }
                            if (c.length > contractMaxLen) {
                                contractMaxLen = c.length;
                            }
                            lines.push({ config: s, addr: hubs[j].address, contract: c, chainid: hubs[j].chainid });
                        }
                    }

                    // Header
                    console.log(
                        'ALIAS' +
                        ' '.repeat(configMaxLen - 'ALIAS'.length + 1) +
                        'ADDRESS' +
                        ' '.repeat(42 - 'ADDRESS'.length + 1) +
                        'CONTRACT' +
                        ' '.repeat(contractMaxLen - 'CONTRACT'.length + 1) +
                        'CHAINID');
                    // Lines
                    for (let i = 0; i < lines.length; ++i) {
                        let s = lines[i].config;
                        s = s + " ".repeat(configMaxLen - s.length);
                        let c = lines[i].contract;
                        c = c + " ".repeat(contractMaxLen - c.length);
                        console.log(s + ' ' + lines[i].addr + ' ' + c + ' ' + lines[i].chainid);
                    }
                }
            }
        } catch (err) {
            this.exit(options, err);
        }
    }
}
