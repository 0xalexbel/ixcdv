import { PROD_NAME } from "../common/consts.js";
import * as types from '../common/common-types.js';
import { masterEtcHostname, toEtcHostname } from "../common/machine.js";

export const DEFAULT_MNEMONIC = "tackle clump have cool idea ripple rally jump airport shed raven song";
const STANDARD = 'standard';
const ENTERPRISE = 'enterprise';
const NATIVE = 'native';

export const DEFAULT_WALLET_INDEX = {
    'admin': 0,
    'workerpool': 1,
    'app': 2,
    'dataset': 3,
    'requester': 4,
    'worker': 5,
}

/**
 * @param {string} flavour 
 */
function getDeployName(flavour) {
    return `${flavour}`;
}
/**
 * @param {number} chainId 
 * @param {string} flavour 
 */
function computeChainName(chainId, flavour) {
    return `${chainId}.${flavour}`;
}
/**
 * @param {number} chainId 
 * @param {string} flavour 
 */
function computeHubAlias(chainId, flavour) {
    return `${chainId}.${getDeployName(flavour)}`;
}

/**
 * @param {*} shared 
 * @param {*} flavour 
 * @param {number} firstChainId 
 * @param {number} countChains 
 */
function addMarket(shared, flavour, firstChainId, countChains) {
    const chains = [];
    for (let i = 0; i < countChains; ++i) {
        chains.push(computeHubAlias(firstChainId + i, flavour));
    }
    shared[`market.${flavour}`] = {
        type: "market",
        watchers: "all",
        api: {
            chains
        }
    }
}

/**
 * @param {*} chains 
 * @param {number} chainId 
 */
function addChains(chains, chainId) {
    const chainNameStd = computeChainName(chainId, STANDARD);
    const chainNameEnt = computeChainName(chainId, ENTERPRISE);
    const chainNameNat = computeChainName(chainId, NATIVE);

    chains[chainNameStd] = { hub: computeHubAlias(chainId, STANDARD) };
    chains[chainNameEnt] = { hub: computeHubAlias(chainId, ENTERPRISE) };
    chains[chainNameNat] = { hub: computeHubAlias(chainId, NATIVE) };
}

/**
 * @param {*} shared 
 * @param {string} mnemonic 
 * @param {number} chainId 
 */
function addGanache(shared, mnemonic, chainId) {
    shared[`ganache.${chainId}`] = {
        type: "ganache",
        config: {
            chainid: chainId,
            mnemonic,
            deploySequence: [
                {
                    name: getDeployName(STANDARD),
                    asset: "Token",
                    salt: "0x0000000000000000000000000000000000000000000000000000000000000000",
                    WorkerpoolAccountIndex: DEFAULT_WALLET_INDEX['workerpool'],
                    WorkerpoolDescription: `default ${PROD_NAME} standard workerpool`
                },
                {
                    name: getDeployName(ENTERPRISE),
                    asset: "Token",
                    kyc: true,
                    salt: "0x0000000000000000000000000000000000000000000000000000000000000001",
                    WorkerpoolAccountIndex: DEFAULT_WALLET_INDEX['workerpool'],
                    WorkerpoolDescription: `default ${PROD_NAME} enterprise workerpool`
                },
                {
                    name: getDeployName(NATIVE),
                    asset: "Native",
                    salt: "0x0000000000000000000000000000000000000000000000000000000000000002",
                    WorkerpoolAccountIndex: DEFAULT_WALLET_INDEX['workerpool'],
                    WorkerpoolDescription: `default ${PROD_NAME} native workerpool`
                },
            ]
        }
    }
}

/**
 * @param {*} config 
 * @param {string} name 
 */
function addQemuMachine(config, name) {
    /** @type {types.QemuMachineArgs} */
    const args = {
        name,
        qemuConfig: {
            cpu: 'host',
            hda: `./machines/qemu/ubuntu20.04/${name}-ubuntu-20-04-server.qcow2`,
            memory: '4G'
        },
        sshConfig: {
            username: 'ixcdv',
            host: 'localhost',
            port: 2222,
            privateKeyFile: './machines/qemu/ubuntu20.04/qemuworkerkey',
            forceIPv4: true,
            readyTimeout: 2 * 60 * 1000
        },
        gatewayIp: '10.0.2.2',
        ixcdvWorkspaceDirectory: './workspace',
    };
    config.machines[name] = {
        type: "qemu",
        ...args
    }
    config.vars = {
        ...config.vars,
        "node1": toEtcHostname("node1")
    }
}

export const DEFAULT_CONFIG = (
    /** @type {boolean} */ addQemuNode1,
    /** @type {number} */ firstChainId,
    /** @type {number} */ countChains,
    mnemonics = [DEFAULT_MNEMONIC, DEFAULT_MNEMONIC]
) => {
    if (firstChainId <= 0) {
        throw new TypeError("Invalid 'firstChainId' argument");
    }
    if (countChains <= 0) {
        throw new TypeError("Invalid 'countChains' argument");
    }
    if (mnemonics.length !== 0 && mnemonics.length < countChains) {
        throw new TypeError("Invalid 'mnemonics' argument");
    }

    const c = {
        vars: {},
        shared: {},
        default: '',
        chains: {},
        // Help compiler
        /** @type {{ type : 'iexecsdk' }} */
        iexecsdk: {
            type: "iexecsdk"
        },
        // Help compiler
        /** @type {{ type : 'teeworkerprecompute' }} */
        teeworkerprecompute: {
            type: "teeworkerprecompute"
        },
        // Help compiler
        /** @type {{ type : 'teeworkerpostcompute' }} */
        teeworkerpostcompute: {
            type: "teeworkerpostcompute"
        },
        machines: {}
    };

    addMarket(c.shared, STANDARD, firstChainId, countChains);
    addMarket(c.shared, ENTERPRISE, firstChainId, countChains);
    addMarket(c.shared, NATIVE, firstChainId, countChains);

    // use ipv4 by default 
    // - the current qemu setup does not support ipv6
    // - using 'localhost' instead of '127.0.0.1' leads to
    //   worlds of troubles with the qemu node1
    c.vars = {
        "defaultHostname": "${master}",
        "localHostname": "${master}",
        "master": "127.0.0.1" // default (without Qemu node)
    };
    if (addQemuNode1) {
        // In the case of a Qemu node, must use a hostname stored in
        // both master and slave '/etc/hosts' files
        // @ts-ignore
        c.vars["master"] = masterEtcHostname();
        addQemuMachine(c, 'node1');
    } else {

    }

    c.default = computeChainName(firstChainId + 0, STANDARD);

    for (let i = 0; i < countChains; ++i) {
        addGanache(c.shared, mnemonics?.[i] ?? DEFAULT_MNEMONIC, firstChainId + i);
        addChains(c.chains, firstChainId + i);
    }

    return c;
};
