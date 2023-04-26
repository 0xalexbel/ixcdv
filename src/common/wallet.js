import { Wallet } from 'ethers';

/**
 * @param {string} mnemonic 
 * @param {number} index 
 */
export function keysAtIndex(mnemonic, index) {
    const p = `m/44'/60'/0'/0/${index}`;
    const wallet = Wallet.fromMnemonic(mnemonic, p);
    return { privateKey: wallet.privateKey, address: wallet.address };
}

/**
 * @param {string} mnemonic 
 * @param {number} index 
 */
export function walletAtIndex(mnemonic, index) {
    const p = `m/44'/60'/0'/0/${index}`;
    return Wallet.fromMnemonic(mnemonic, p);
}

/**
 * @param {string} mnemonic 
 * @param {number} index 
 * @param {string} password 
 * @param {((percent:number) => void)=} progressCb
 */
export async function mnemonicToEncryptedJson(mnemonic, index, password, progressCb) {
    const p = `m/44'/60'/0'/0/${index}`;
    const wallet = Wallet.fromMnemonic(mnemonic, p);
    return await wallet.encrypt(password, null, progressCb);
}

