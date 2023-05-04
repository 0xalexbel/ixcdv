import * as types from "../common-types.js";
import assert from "assert";
import { Contract, Signer, Wallet, ethers } from "ethers";
import { ContractBaseConstructorGuard, ContractBase } from "./ContractBase.js";
import { ContractRef, DevContractRef, PoCoContractRef, newContract } from '../contractref.js';
import { SharedReadonlyContracts } from './SharedReadonlyContracts.js';
import { isNullishOrEmptyString } from '../string.js';
import { NULL_ADDRESS, isContract, toChecksumAddress, toTxArgs } from '../ethers.js';
import { PublicResolver } from './PublicResolver.js';
import { CodeError } from '../error.js';
import { FIFSRegistrar } from './FIFSRegistrar.js';

export const ENSRegistryConstructorGuard = { value: false };

export class ENSRegistry extends ContractBase {

    /**
     * @param {Contract} contract 
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     */
    constructor(contract, contractRef, contractDir) {
        if (!ENSRegistryConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }

        assert(!ContractBaseConstructorGuard.value);
        ContractBaseConstructorGuard.value = true;
        super(contract, contractRef, contractDir);
        ContractBaseConstructorGuard.value = false;
    }

    /**
     * @param {Contract} contract 
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     */
    static #newENSRegistry(contract, contractRef, contractDir) {
        assert(!ENSRegistryConstructorGuard.value);
        ENSRegistryConstructorGuard.value = true;
        const o = new ENSRegistry(contract, contractRef, contractDir);
        ENSRegistryConstructorGuard.value = false;
        return o;
    }

    /**
     * @param {ContractRef} contractRef 
     * @param {string} contractDir
     * @param {{
     *      ensAddress: string
     *      networkName: string
     * }} options 
     */
    static sharedReadOnly(contractRef, contractDir, options) {
        const c = SharedReadonlyContracts.get(contractRef, 'ENSRegistry', contractDir, options);
        return ENSRegistry.#newENSRegistry(c, contractRef, contractDir);
    }

    /**
     * @param {Wallet} wallet 
     */
    newSigningContract(wallet) {
        return newContract(this.contractRef, 'ENSRegistry', this.contractDir, wallet);
    }

    /** @param {string} name */
    static HumanReadableNameToNode(name) {
        // throws an error if not a string
        return ethers.utils.namehash(name);
    }

    /**
     * Throws an error if failed
     * @param {*} name 
     */
    static validateName(name) {
        if (isNullishOrEmptyString(name)) {
            throw new CodeError(`Invalid ENS name : ${name}`);
        }
        if (typeof name !== 'string') {
            throw new CodeError(`Invalid ENS name : ${name}`);
        }

        const emptyLabels = name.split('.')
            .filter((label) => label.length < 1);
        if (emptyLabels.length > 0) {
            throw new CodeError(`Invalid ENS name : ${name}`);
        }
        try {
            const namehash = ethers.utils.namehash(name);
        } catch (err) {
            throw new CodeError(`Invalid ENS name : ${name}`);
        }
    }

    /**
     * @param {string} name 
     * @returns {Promise<string>}
     */
    async nameOwner(name) {
        ENSRegistry.validateName(name);
        const node = ENSRegistry.HumanReadableNameToNode(name);
        const addr = await this.contract.owner(node);
        return addr;
    }

    /**
     * @param {string} name 
     * @param {string} owner 
     * @param {types.TxArgsOrWallet} txArgsOrWallet 
     */
    async #setNameOwner(name, owner, txArgsOrWallet) {
        ENSRegistry.validateName(name);

        const txArgs = toTxArgs(txArgsOrWallet);
        owner = toChecksumAddress(owner);

        const node = ENSRegistry.HumanReadableNameToNode(name);

        const currentOwner = await this.nameOwner(name);
        if (currentOwner === owner) {
            return;
        }

        if (txArgs.wallet.address.toLowerCase() !== currentOwner.toLowerCase()) {
            throw new CodeError('Unauthorized operation');
        }

        const sc = this.newSigningContract(txArgs.wallet);
        const tx = await sc.setOwner(node, owner, txArgs.txOverrides);

        // wait for tx
        const txReceipt = await tx.wait(txArgs.txConfirms);
        return { name, txHash: txReceipt.hash };
    }

    /**
     * @param {string} label 
     * @param {string} domain 
     * @param {string | PoCoContractRef} publicResolver
     * @param {types.TxArgsOrWallet} txArgsOrWallet 
     */
    async addFIFSRegistrar(label, domain, publicResolver, txArgsOrWallet) {
        ENSRegistry.validateName(label);
        ENSRegistry.validateName(domain);

        const txArgs = toTxArgs(txArgsOrWallet);
        assert(this.address);

        let publicResolverAddress;
        if (publicResolver instanceof PoCoContractRef) {
            if (!publicResolver.address) {
                throw new CodeError('Missing public resolver address');
            }
            publicResolverAddress = publicResolver.address;
        } else {
            publicResolverAddress = publicResolver;
        }

        const wallet = txArgs.wallet;
        const walletAddr = wallet.address;
        const walletAddrLc = walletAddr.toLowerCase();

        const name = `${label}.${domain}`;
        const node = ENSRegistry.HumanReadableNameToNode(name);

        const nameOwner = await this.contract.owner(node);
        const nameOwnerLc = nameOwner.toLowerCase();

        const nameResolver = await this.contract.resolver(node);
        const nameResolverLc = nameResolver.toLowerCase();

        if (nameOwnerLc !== NULL_ADDRESS && nameOwnerLc !== walletAddrLc) {
            if (! await isContract(this.baseProvider, nameOwner)) {
                throw new CodeError(`Unauthorized operation, '${name}' is already owned by ${nameOwner}`);
            }
            if (nameResolverLc !== publicResolverAddress.toLowerCase()) {
                throw new CodeError(`Public resolver mismatch, expecting ${publicResolverAddress}, got ${nameResolver}`);
            }
            // Assume nameOwner is a FIFSRegistrar address
            const existingFIFSRegistrar = await this.getFIFSRegistrar(name, wallet);
            return existingFIFSRegistrar;
        }

        const sc = this.newSigningContract(txArgs.wallet);

        // set owner to wallet
        if (nameOwnerLc === NULL_ADDRESS) {
            const domainRegistrar = await this.getFIFSRegistrar(domain, wallet);
            await domainRegistrar.register(label, walletAddr, txArgs);
            assert((await this.nameOwner(name)) === walletAddr);
        }

        // set public resolver
        if (nameResolverLc !== publicResolverAddress.toLowerCase()) {
            const tx = await sc.setResolver(
                node,
                publicResolverAddress,
                txArgs.txOverrides);
            // wait for tx
            const txReceipt = await tx.wait(txArgs.txConfirms);
        }

        // Deploy a new FIFSRegistrar instance 
        const out = await FIFSRegistrar.deployNewAt(
            name,
            this.address,
            this.contractDir,
            txArgs);

        // Future label owner
        const newFIFSRegAddr = out.address;

        // Transfer ownership
        await this.#setNameOwner(
            name,
            newFIFSRegAddr,
            txArgs);

        // For debugging purpose
        // Make sure everything ok
        const verifOwner = await this.nameOwner(name);
        const verifResolver = await this.nameResolver(name);
        assert(verifOwner.toLowerCase() === newFIFSRegAddr.toLowerCase());
        assert(verifResolver.address?.toLowerCase() === publicResolverAddress.toLowerCase());

        const newFIFSRegistrar = await this.getFIFSRegistrar(name, wallet);
        assert(newFIFSRegistrar.address === newFIFSRegAddr);

        return newFIFSRegistrar;
    }

    /**
     * @param {string} name 
     * @param {Signer} signer
     * @returns {Promise<FIFSRegistrar>}
     */
    async getFIFSRegistrar(name, signer) {
        return FIFSRegistrar.newSigning(this, name, signer);
    }

    /**
     * - Returns resolver address
     * @param {string} name 
     * @returns {Promise<PoCoContractRef>}
     */
    async nameResolver(name) {
        ENSRegistry.validateName(name);

        const node = ENSRegistry.HumanReadableNameToNode(name);
        const resolver = await this.contract.resolver(node);

        /** @type {string | undefined} */
        let deployConfigName = undefined;
        if (this.contractRef instanceof DevContractRef) {
            deployConfigName = this.contractRef.deployConfigName;
        }

        return new PoCoContractRef({
            address: resolver,
            chainid: this.chainid,
            contractName: 'PublicResolver',
            deployConfigName,
            url: this.contractRef.url
        })
    }

    /**
     * @param {string} name 
     * @param {string} publicResolverAddress 
     * @param {types.TxArgsOrWallet} txArgsOrWallet 
     */
    async #setNameResolver(name, publicResolverAddress, txArgsOrWallet) {
        ENSRegistry.validateName(name);

        const txArgs = toTxArgs(txArgsOrWallet);

        const node = ENSRegistry.HumanReadableNameToNode(name);

        // Step 1
        const currentResolver = await this.baseProvider.getResolver(name);

        if (currentResolver?.address?.toLowerCase() === publicResolverAddress.toLowerCase()) {
            return;
        }

        const sc = this.newSigningContract(txArgs.wallet);
        const tx = await sc.setResolver(
            node,
            publicResolverAddress,
            txArgs.txOverrides
        );

        // wait for tx
        const txReceipt = await tx.wait(txArgs.txConfirms);
        return { name, txHash: txReceipt.transactionHash }
    }

    /**
     * Throws an error if failed
     * @param {string} name 
     * @param {string} key 
     */
    async getText(name, key) {
        ENSRegistry.validateName(name);

        const publicResolverRef = await this.nameResolver(name);
        if (!publicResolverRef.address || publicResolverRef.address === NULL_ADDRESS) {
            throw new CodeError(`No resolver is configured for ${name}`);
        }

        const publicResolverContract = newContract(
            publicResolverRef.address,
            'PublicResolver',
            this.contractDir,
            this.baseProvider);

        const node = ENSRegistry.HumanReadableNameToNode(name);

        try {
            const value = await publicResolverContract.text(node, key);
            if (typeof value === 'string') {
                return value;
            } else {
                throw new Error();
            }
        } catch {
            throw new CodeError(`Unable to retrieve key value (key=${key})`);
        }
    }

    /**
     * @param {string} name 
     * @param {string} key 
     * @param {string} value 
     * @param {types.TxArgsOrWallet} txArgsOrWallet 
     */
    async setText(name, key, value, txArgsOrWallet) {
        ENSRegistry.validateName(name);

        if (typeof value !== 'string') {
            throw new CodeError('Invalid value argument');
        }

        const txArgs = toTxArgs(txArgsOrWallet);
        const publicResolverRef = await this.nameResolver(name);
        if (!publicResolverRef.address || publicResolverRef.address === NULL_ADDRESS) {
            throw new CodeError(`No resolver is configured for ${name}`);
        }
        const owner = await this.nameOwner(name);
        const walletAddress = txArgs.wallet.address;
        if (owner !== walletAddress) {
            throw new CodeError(`${walletAddress} is not authorised to set a text record for ${name}`);
        }

        const publicResolverContract = newContract(
            publicResolverRef.address,
            'PublicResolver',
            this.contractDir,
            txArgs.wallet);

        const node = ENSRegistry.HumanReadableNameToNode(name);

        const existingText = await publicResolverContract.text(node, key);
        if (existingText === value) {
            return;
        }

        const tx = await publicResolverContract.setText(node, key, value);

        // wait for tx
        const txReceipt = await tx.wait(txArgs.txConfirms);
        return { name, txHash: txReceipt.hash };
    }

    // Top-level domains are owned by contracts called 'Registrar'

    /**
     * @param {string} name 
     */
    async getPublicResolver(name) {
        ENSRegistry.validateName(name);

        const ensAddress = this.address;
        assert(ensAddress);

        const network = this.network;
        assert(network.ensAddress === ensAddress);

        // ensNameResolver === deployconfig.PublicResolver
        const ensNameResolver = await this.nameResolver(name);

        return PublicResolver.sharedReadOnly(
            ensNameResolver,
            this.contractDir,
            {
                ensAddress,
                networkName: network.networkName
            });
    }

    /**
     * - Register the key/value pair (`<label>.<domain>`, `<address>`)
     * - The signer is now the owner of `<label>.<domain>`
     * @param {string} label 
     * @param {string} domain 
     * @param {string} address 
     * @param {types.TxArgsOrWallet} txArgsOrWallet 
     */
    async registerAddress(label, domain, address, txArgsOrWallet) {
        ENSRegistry.validateName(label);
        ENSRegistry.validateName(domain);

        const txArgs = toTxArgs(txArgsOrWallet);

        const name = `${label}.${domain}`;
        const walletAddress = txArgs.wallet.address;
        const ensAddress = this.address;
        const baseProvider = this.baseProvider;
        assert(ensAddress);

        // <address> MUST be one of the following:
        // - RegistryEntry (workerpool | app | dataset) AND wallet MUST be RegistryEntry owner !
        // - <txArgsOrWallet>.address

        // === vAddress
        address = toChecksumAddress(address);

        /** @type {Contract=} */
        let registryEntrySigningContract;

        if (address !== walletAddress) {
            if (! await isContract(baseProvider, address)) {
                throw new CodeError(`address ${address} is not a RegistryEntry contract and don't match current wallet address ${walletAddress}`);
            }
            registryEntrySigningContract = newContract(
                address,
                'RegistryEntry',
                this.contractDir,
                txArgs.wallet);

            let entryOwner;
            try {
                entryOwner = await registryEntrySigningContract.owner();
            } catch (err) {
                throw new CodeError(`Not a RegistryEntry contract (${address})`);
            }
            if (entryOwner.toLowerCase() !== walletAddress.toLowerCase()) {
                throw new CodeError(`wallet ${walletAddress} is not the RegistryEntry owner ${entryOwner}`);
            }
        }

        const publicResolver = await this.getPublicResolver(domain);
        const publicResolverAddress = publicResolver.address;
        if (!publicResolverAddress) {
            throw new CodeError(`Unable to retrieve public resolver`);
        }

        // Make sure wallet is the owner of <label>.<domain>
        const fifsReg = await this.getFIFSRegistrar(domain, txArgs.wallet);
        // ens[node].owner = <walletAddress>
        // Throw error if <label>.<domain> is owned by someone else
        await fifsReg.register(label, walletAddress, txArgs);

        // wallet MUST be equal to name owner !!!
        assert((await this.nameOwner(name)).toLowerCase() === walletAddress.toLowerCase());

        // wallet MUST be name owner !!
        // ens[node].resolver = <publicResolverAddress>
        await this.#setNameResolver(
            name,
            publicResolverAddress,
            txArgsOrWallet);

        // wallet MUST be name owner !!
        // PublicResolver works with ens internaly
        await publicResolver.setAddress(name, address, txArgs);

        const existingReverseName = await baseProvider.lookupAddress(address);
        if (existingReverseName === name) {
            return;
        }

        if (registryEntrySigningContract) {
            // see RegistryEntry.sol
            const tx = await registryEntrySigningContract.setName(
                ensAddress,
                name,
                txArgs.txOverrides
            );
            // wait for tx
            const txReceipt = await tx.wait(txArgs.txConfirms);

        } else {
            assert(walletAddress === address);
            // 'addr.reverse' : see ReverseRegistrar.sol
            const reverseRegistrarAddress = await this.nameOwner('addr.reverse');
            const reverseRegistrarSigningContract = new Contract(
                reverseRegistrarAddress,
                'ReverseRegistrar',
                txArgs.wallet
            );
            const tx = await reverseRegistrarSigningContract.setName(
                name,
                txArgs.txOverrides);
            // wait for tx
            const txReceipt = await tx.wait(txArgs.txConfirms);
        }
    }
}

