import { PROD_NAME } from "../common/consts.js";

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

export const DEFAULT_CONFIG = (
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
        shared: {},
        default: '',
        chains: {},
        iexecsdk: {
            type: "iexecsdk"
        }
    };

    addMarket(c.shared, STANDARD, firstChainId, countChains);
    addMarket(c.shared, ENTERPRISE, firstChainId, countChains);
    addMarket(c.shared, NATIVE, firstChainId, countChains);

    c.default = computeChainName(firstChainId + 0, STANDARD);

    for (let i = 0; i < countChains; ++i) {
        addGanache(c.shared, mnemonics?.[i] ?? DEFAULT_MNEMONIC, firstChainId + i);
        addChains(c.chains, firstChainId + i);
    }

    return c;
};
