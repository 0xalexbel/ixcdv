// Dependencies
// ../common
// ../docker
// ../ipfs
import * as types from "../common/common-types.js";
import * as cTypes from './contracts-types-internal.js';
import assert from 'assert';
import path from 'path';
import { Contract, BigNumber, Wallet } from "ethers";
import { ContractBase, ContractBaseConstructorGuard } from '../common/contracts/ContractBase.js';
import { AppRegistry } from './AppRegistry.js';
import { WorkerpoolRegistry } from './WorkerpoolRegistry.js';
import { DatasetRegistry } from './DatasetRegistry.js';
import { AppOrder, newAppOrder } from './AppOrder.js';
import { Order } from './Order.js';
import { tagArrayToTagInt, tagIntAnd, tagIntOr, TAG_NONE_INT, TAG_TEE_INT } from './tags.js';
import { EIP712Domain } from './EIP712Domain.js';
import { AppRegistryEntry } from './AppRegistryEntry.js';
import { DatasetRegistryEntry } from './DatasetRegistryEntry.js';
import { WorkerpoolRegistryEntry } from './WorkerpoolRegistryEntry.js';
import { DatasetOrder, newDatasetOrder, newEmptyDatasetOrder } from './DatasetOrder.js';
import { newWorkerpoolOrder, WorkerpoolOrder } from './WorkerpoolOrder.js';
import { newRequestOrder, RequestOrder } from './RequestOrder.js';
import { Category, newCategory } from './Category.js';
import { Deal, newDealFromRPC } from './Deal.js';
import { newTaskFromRPC } from './Task.js';
import { ContractRef, PoCoContractRef, newContract } from '../common/contractref.js';
import { CodeError, pureVirtualError } from '../common/error.js';
import { isBytes32String, NULL_ADDRESS, NULL_BYTES32, toChecksumAddress, toTxArgs } from '../common/ethers.js';
import { isNullishOrEmptyString, throwIfNullishOrEmptyString } from '../common/string.js';

export const HubBaseConstructorGuard = { value: false };
export const ORDER_VOLUME_INFINITE = 1000000;

export class HubBase extends ContractBase {

    /** @type {types.checksumaddress=} */
    #appRegistryAddr;
    /** @type {types.checksumaddress=} */
    #datasetRegistryAddr;
    /** @type {types.checksumaddress=} */
    #workerpoolRegistryAddr;
    /** @type {string=} */
    #symbol;
    /** @type {types.checksumaddress=} */
    #token;
    /** @type {EIP712Domain=} */
    #domain;

    /**
     * @param {Contract} contract 
     * @param {ContractRef} contractRef 
     * @param {string} contractDir 
     */
    constructor(contract, contractRef, contractDir) {
        if (!HubBaseConstructorGuard.value) {
            throw new TypeError('class constructor is not accessible');
        }
        assert(!ContractBaseConstructorGuard.value);
        ContractBaseConstructorGuard.value = true;
        super(contract, contractRef, contractDir);
        ContractBaseConstructorGuard.value = false;
    }

    /** 
     * @abstract 
     * @returns {string}
     */
    static defaultContractName() { throw pureVirtualError('HubBase.defaultContractName()'); }

    /** 
     * @abstract 
     * @returns {string}
     */
    defaultContractName() { throw pureVirtualError('HubBase.defaultContractName()'); }

    /**
     * @param {Wallet} wallet 
     */
    newSigningContract(wallet) {
        return newContract(this.contractRef, this.defaultContractName(), this.contractDir, wallet);
    }

    async symbol() {
        if (!this.#symbol) {
            this.#symbol = await this.contract['symbol']();
            if (!this.#symbol) {
                throw new CodeError("Failed to retrieve 'symbol' property value.");
            }
        }
        return this.#symbol;
    }

    async token() {
        if (!this.#token) {
            this.#token = await this.contract['token']();
            if (!this.#token) {
                throw new CodeError("Failed to retrieve 'token' property value.");
            }
        }
        return this.#token;
    }

    /** @returns {Promise<PoCoContractRef>} */
    async tokenRef() {
        throw pureVirtualError('tokenRef()');
    }

    async domain() {
        if (!this.#domain) {
            const d = await this.contract['domain']();
            this.#domain = new EIP712Domain({
                name: d.name,
                version: d.version,
                chainId: d.chainId,
                verifyingContract: d.verifyingContract
            });
            Object.freeze(this.#domain);
        }
        return this.#domain;
    }

    /**
     * @param {Order} order 
     * @param {types.bytes32string} salt 
     */
    async viewConsumed(order, salt) {
        const d = await this.domain();
        const hash = order.hash(d, salt);
        /** @type {BigNumber} */
        const consumed = await this.contract.viewConsumed(hash);
        return consumed;
    }

    /**
     * @param {string} poolAddress 
     */
    async getSchedulerNoticeFilter(poolAddress) {
        return this.contract.filters.SchedulerNotice(poolAddress);
    }

    async queryOrdersMatchedEvents() {
        const f = this.contract.filters.OrdersMatched();
        let events = await this.contract.queryFilter(f, 0, "latest");
        return events.map(v => v.args?.['dealid']);
    }
    async queryTaskInitializeEvents() {
        const f = this.contract.filters.TaskInitialize();
        let events = await this.contract.queryFilter(f, 0, "latest");
        return events.map(v => v.args?.['taskid']);
    }

    async appRegistryAddr() {
        if (!this.#appRegistryAddr) {
            this.#appRegistryAddr = await this.contract['appregistry']();
            if (!this.#appRegistryAddr) {
                throw new CodeError("Failed to retrieve 'appregistry' property value.");
            }
        }
        return this.#appRegistryAddr;
    }

    async datasetRegistryAddr() {
        if (!this.#datasetRegistryAddr) {
            this.#datasetRegistryAddr = await this.contract['datasetregistry']();
            if (!this.#datasetRegistryAddr) {
                throw new CodeError("Failed to retrieve 'datasetregistry' property value.");
            }
        }
        return this.#datasetRegistryAddr;
    }

    async workerpoolRegistryAddr() {
        if (!this.#workerpoolRegistryAddr) {
            this.#workerpoolRegistryAddr = await this.contract['workerpoolregistry']();
            if (!this.#workerpoolRegistryAddr) {
                throw new CodeError("Failed to retrieve 'workerpoolregistry' property value.");
            }
        }
        return this.#workerpoolRegistryAddr;
    }

    async appRegistry() {
        const addr = await this.appRegistryAddr();
        return AppRegistry.fromAddr(addr, this);
    }
    async datasetRegistry() {
        const addr = await this.datasetRegistryAddr();
        return DatasetRegistry.fromAddr(addr, this);
    }
    async workerpoolRegistry() {
        const addr = await this.workerpoolRegistryAddr();
        return WorkerpoolRegistry.fromAddr(addr, this);
    }

    /**
     * - app, dataset & workerpool addresses must be registered
     * - appprice >= 0 
     * - volume > 0 
     * @param {cTypes.AppOrderLike} args 
     */
    async newAppOrder(args) {
        const appAddr = AppRegistryEntry.toAppAddr(args.app);
        if (appAddr === NULL_ADDRESS) {
            throw new CodeError(`Invalid app address=${appAddr}`);
        }
        const appReg = await this.appRegistry();
        const isAppReg = await appReg.isRegistered(appAddr);
        if (!isAppReg) {
            throw new CodeError(`App ${appAddr} is not registered`);
        }

        const appprice = Order.validatePrice(args.appprice ?? BigNumber.from(0), 'nRLC');
        const volume = Order.validateVolume(args.volume ?? ORDER_VOLUME_INFINITE);
        const tag = Order.validateTag(args.tag ?? []);

        const datasetRestrictAddr = DatasetRegistryEntry.toDatasetAddr(args.datasetrestrict);
        const workerpoolRestrictAddr = WorkerpoolRegistryEntry.toWorkerpoolAddr(args.workerpoolrestrict);
        const requesterRestrictAddr = (args.requesterrestrict) ?
            toChecksumAddress(args.requesterrestrict) :
            NULL_ADDRESS;

        if (datasetRestrictAddr !== NULL_ADDRESS) {
            const datasetReg = await this.datasetRegistry();
            const isDatasetReg = await datasetReg.isRegistered(datasetRestrictAddr);
            if (!isDatasetReg) {
                throw new CodeError(`Dataset ${datasetRestrictAddr} is not registered`);
            }
        }
        if (workerpoolRestrictAddr !== NULL_ADDRESS) {
            const workerpoolReg = await this.workerpoolRegistry();
            const isWorkerpoolReg = await workerpoolReg.isRegistered(workerpoolRestrictAddr);
            if (!isWorkerpoolReg) {
                throw new CodeError(`Workerpool ${workerpoolRestrictAddr} is not registered`);
            }
        }

        return newAppOrder({
            app: appAddr,
            appprice,
            volume,
            tag,
            datasetrestrict: datasetRestrictAddr,
            workerpoolrestrict: workerpoolRestrictAddr,
            requesterrestrict: requesterRestrictAddr
        });
    }

    /**
     * - app, dataset & workerpool addresses must be registered
     * - workerpoolprice >= 0 
     * - volume > 0 
     * @param {cTypes.WorkerpoolOrderLike} args 
     */
    async newWorkerpoolOrder(args) {
        const workerpoolAddr = WorkerpoolRegistryEntry.toWorkerpoolAddr(args.workerpool);
        if (workerpoolAddr === NULL_ADDRESS) {
            throw new CodeError(`Invalid workerpool address=${workerpoolAddr}`);
        }
        const workerpoolReg = await this.workerpoolRegistry();
        const isWorkerpoolReg = await workerpoolReg.isRegistered(workerpoolAddr);
        if (!isWorkerpoolReg) {
            throw new CodeError(`Workerpool ${workerpoolAddr} is not registered`);
        }

        const workerpoolprice = Order.validatePrice(args.workerpoolprice ?? BigNumber.from(0), 'nRLC');
        const volume = Order.validateVolume(args.volume ?? 1);
        const tag = Order.validateTag(args.tag ?? []);
        const category = Order.validateCategory(args.category ?? 0);
        const trust = Order.validateTrust(args.trust ?? 0);

        const appRestrictAddr = AppRegistryEntry.toAppAddr(args.apprestrict);
        const datasetRestrictAddr = DatasetRegistryEntry.toDatasetAddr(args.datasetrestrict);
        const requesterRestrictAddr = (args.requesterrestrict) ?
            toChecksumAddress(args.requesterrestrict) :
            NULL_ADDRESS;

        if (datasetRestrictAddr !== NULL_ADDRESS) {
            const datasetReg = await this.datasetRegistry();
            const isDatasetReg = await datasetReg.isRegistered(datasetRestrictAddr);
            if (!isDatasetReg) {
                throw new CodeError(`Dataset ${datasetRestrictAddr} is not registered`);
            }
        }
        if (appRestrictAddr !== NULL_ADDRESS) {
            const appReg = await this.appRegistry();
            const isAppReg = await appReg.isRegistered(appRestrictAddr);
            if (!isAppReg) {
                throw new CodeError(`App ${appRestrictAddr} is not registered`);
            }
        }

        return newWorkerpoolOrder({
            workerpool: workerpoolAddr,
            workerpoolprice,
            volume,
            tag,
            category,
            trust,
            apprestrict: appRestrictAddr,
            datasetrestrict: datasetRestrictAddr,
            requesterrestrict: requesterRestrictAddr
        });
    }

    /**
     * - app, dataset & workerpool addresses must be registered
     * @param {cTypes.RequestOrderLike} args 
     */
    async newRequestOrder(args) {
        const resultProxyUrl = args.params?.['iexec_result_storage_proxy'];
        if (!resultProxyUrl) {
            throw new CodeError(`Missing 'iexec_result_storage_proxy' parameter`);
        }
        try {
            const u = new URL(resultProxyUrl);
        } catch {
            throw new CodeError(`Invalid 'iexec_result_storage_proxy' url`);
        }
        const provider = args.params?.['iexec_result_storage_provider'];
        if (!provider) {
            throw new CodeError(`Missing 'iexec_result_storage_provider' parameter`);
        }
        if (provider !== 'ipfs') {
            throw new CodeError(`Invalid 'iexec_result_storage_provider' parameter`);
        }

        // App
        const appAddr = AppRegistryEntry.toAppAddr(args.app);
        if (appAddr === NULL_ADDRESS) {
            throw new CodeError(`Invalid app address=${appAddr}`);
        }
        const appReg = await this.appRegistry();
        const isAppReg = await appReg.isRegistered(appAddr);
        if (!isAppReg) {
            throw new CodeError(`App ${appAddr} is not registered`);
        }

        // Dataset (Optional)
        let datasetAddr = null;
        if (args.dataset) {
            datasetAddr = DatasetRegistryEntry.toDatasetAddr(args.dataset);
            if (datasetAddr !== NULL_ADDRESS) {
                const datasetReg = await this.datasetRegistry();
                const isDatasetReg = await datasetReg.isRegistered(datasetAddr);
                if (!isDatasetReg) {
                    throw new CodeError(`Dataset ${datasetAddr} is not registered`);
                }
            }
        }

        // Workerpool
        const workerpoolAddr = WorkerpoolRegistryEntry.toWorkerpoolAddr(args.workerpool);
        if (workerpoolAddr === NULL_ADDRESS) {
            throw new CodeError(`Invalid workerpool address=${workerpoolAddr}`);
        }
        const workerpoolReg = await this.workerpoolRegistry();
        const isWorkerpoolReg = await workerpoolReg.isRegistered(workerpoolAddr);
        if (!isWorkerpoolReg) {
            throw new CodeError(`Workerpool ${workerpoolAddr} is not registered`);
        }

        const appmaxprice = Order.validatePrice(args.appmaxprice ?? BigNumber.from(0), 'nRLC');
        const workerpoolmaxprice = Order.validatePrice(args.workerpoolmaxprice ?? BigNumber.from(0), 'nRLC');
        const datasetmaxprice = Order.validatePrice(args.datasetmaxprice ?? BigNumber.from(0), 'nRLC');

        const volume = Order.validateVolume(args.volume ?? 1);
        const tag = Order.validateTag(args.tag ?? []);
        const category = Order.validateCategory(args.category ?? 0);
        const trust = Order.validateTrust(args.trust ?? 0);
        const requester = (args.requester) ? toChecksumAddress(args.requester) : NULL_ADDRESS;
        const beneficiary = (args.beneficiary) ? toChecksumAddress(args.beneficiary) : NULL_ADDRESS;
        const callback = (args.callback) ? toChecksumAddress(args.callback) : NULL_ADDRESS;

        /*
        iexec_args: 'test',
        iexec_result_storage_provider: 'ipfs',
        iexec_result_storage_proxy: 'https://result-proxy.iex.ec',
            iexec_input_files: [
                'https://iex.ec/wp-content/uploads/pdf/iExec-WPv3.0-English.pdf',
                'https://iex.ec/wp-content/uploads/pdf/iExec-WPv3.0-English.pdf',
            ],
        */

        /** @type {cTypes.RequestOrder} */
        const ro = {
            app: appAddr,
            appmaxprice,
            dataset: datasetAddr ?? NULL_ADDRESS,
            datasetmaxprice,
            workerpool: workerpoolAddr,
            workerpoolmaxprice,
            volume,
            tag,
            category,
            trust,
            requester,
            beneficiary,
            callback,
            params: {
                "iexec_result_storage_provider": args.params?.iexec_result_storage_provider ?? 'ipfs',
                "iexec_result_storage_proxy": args.params?.iexec_result_storage_proxy ?? resultProxyUrl
            }
        };

        if (args.params?.iexec_args) {
            ro.params.iexec_args = args.params?.iexec_args;
        }

        if (args.params?.iexec_input_files) {
            const inputFiles = [...args.params.iexec_input_files];
            for (let i = 0; i < inputFiles.length; ++i) {
                if (isNullishOrEmptyString(inputFiles[i])) {
                    throw new CodeError( `inputFile[${i}] parameter is invalid. Expecting a non empty string` );
                }

                // ./src/main/java/com/iexec/common/utils/IexecEnvUtils.java
                // public static Map<String, String> getComputeStageEnvMap(TaskDescription taskDescription) {
                //   ...                     
                //   map.put(IEXEC_INPUT_FILE_NAME_PREFIX + index, FilenameUtils.getName(inputFileUrl));
                //   ...                     
                // }
                // org.apache.commons.io.FilenameUtils.indexOfLastSeparator(final String filename)
                // org.apache.commons.io.FilenameUtils.getName(final String filename)

                // Prevent from passing invalid inputFiles as parameters
                const inputFile = inputFiles[i];
                const posPosix = inputFile.lastIndexOf(path.posix.sep);
                const posWin = inputFile.lastIndexOf(path.win32.sep);
                const pos = (posWin > posPosix) ? posWin : posPosix;
                const basename = inputFile.substring(pos);
                if (basename.trim().length === 0) {
                    throw new CodeError( `inputFile[${i}] parameter is invalid. Basename is empty (='${basename}')` );
                }
            }
            ro.params.iexec_input_files = [...args.params.iexec_input_files];
        }


        return newRequestOrder(ro);
    }

    // this.#paramsObj['iexec_result_storage_provider'] = "ipfs";
    // this.#paramsObj['iexec_result_storage_proxy'] = getResultProxyUrl();

    newEmptyDatasetOrder() {
        return newEmptyDatasetOrder();
    }

    /**
     * - app, dataset & workerpool addresses must be registered
     * - workerpoolprice >= 0 
     * - volume > 0 
     * @param {cTypes.DatasetOrderLike} args 
     */
    async newDatasetOrder(args) {
        const datasetAddr = DatasetRegistryEntry.toDatasetAddr(args.dataset);
        if (datasetAddr === NULL_ADDRESS) {
            throw new CodeError(`Invalid dataset address=${datasetAddr}`);
        }
        const datasetReg = await this.datasetRegistry();
        const isDatasetReg = await datasetReg.isRegistered(datasetAddr);
        if (!isDatasetReg) {
            throw new CodeError(`Dataset ${datasetAddr} is not registered`);
        }

        const datasetprice = Order.validatePrice(args.datasetprice ?? BigNumber.from(0), 'nRLC');
        const volume = Order.validateVolume(args.volume ?? ORDER_VOLUME_INFINITE);
        const tag = Order.validateTag(args.tag ?? []);

        const appRestrictAddr = AppRegistryEntry.toAppAddr(args.apprestrict);
        const workerpoolRestrictAddr = WorkerpoolRegistryEntry.toWorkerpoolAddr(args.workerpoolrestrict);
        const requesterRestrictAddr = (args.requesterrestrict) ?
            toChecksumAddress(args.requesterrestrict) :
            NULL_ADDRESS;

        if (workerpoolRestrictAddr !== NULL_ADDRESS) {
            const workerpoolReg = await this.workerpoolRegistry();
            const isWorkerpoolReg = await workerpoolReg.isRegistered(workerpoolRestrictAddr);
            if (!isWorkerpoolReg) {
                throw new CodeError(`Workerpool ${workerpoolRestrictAddr} is not registered`);
            }
        }
        if (appRestrictAddr !== NULL_ADDRESS) {
            const appReg = await this.appRegistry();
            const isAppReg = await appReg.isRegistered(appRestrictAddr);
            if (!isAppReg) {
                throw new CodeError(`App ${appRestrictAddr} is not registered`);
            }
        }

        return newDatasetOrder({
            dataset: datasetAddr,
            datasetprice: datasetprice,
            volume,
            tag,
            apprestrict: appRestrictAddr,
            workerpoolrestrict: workerpoolRestrictAddr,
            requesterrestrict: requesterRestrictAddr
        });
    }

    /**
     * Check workepool.category == request.category
     * @param {WorkerpoolOrder} workerpoolOrder 
     * @param {RequestOrder} requestOrder 
     */
    #checkCategory(workerpoolOrder, requestOrder) {
        const workerpoolCategory = workerpoolOrder.category;
        const requestCategory = requestOrder.category;
        if (workerpoolCategory !== requestCategory) {
            throw Error(`category mismatch between requestorder (${requestCategory.toString()}) and workerpoolorder (${workerpoolCategory.toString()})`);
        }
    }

    /**
     * - Check workepool.trust >= request.trust
     * @param {WorkerpoolOrder} workerpoolOrder 
     * @param {RequestOrder} requestOrder 
     */
    #checkTrust(workerpoolOrder, requestOrder) {
        const workerpoolTrust = workerpoolOrder.trust;
        const requestTrust = requestOrder.trust;
        if (workerpoolTrust < requestTrust) {
            throw new CodeError(`workerpoolorder trust is too low (expected ${requestTrust}, got ${workerpoolTrust})`);
        }
    }

    /**
     * - Check workerpoolTags & (appTags | datasetTag | requestTag)
     * - Check if (datasetTag | requestTag) has TEE, then appTag must also have TEE
     * @param {AppOrder} appOrder 
     * @param {DatasetOrder?} datasetOrder 
     * @param {WorkerpoolOrder} workerpoolOrder 
     * @param {RequestOrder} requestOrder 
     */
    #checkTags(appOrder, datasetOrder, workerpoolOrder, requestOrder) {
        const appTag = tagArrayToTagInt(appOrder.tag);
        const workerpoolTag = tagArrayToTagInt(workerpoolOrder.tag);
        const datasetTag = (datasetOrder) ? tagArrayToTagInt(datasetOrder.tag) : TAG_NONE_INT;
        const requestTag = tagArrayToTagInt(requestOrder.tag);

        const requestOrDatasetTags = tagIntOr(requestTag, datasetTag);

        let neededTags = tagIntOr(requestOrDatasetTags, appTag);
        let availableTags = tagIntAnd(neededTags, workerpoolTag);
        if (availableTags !== neededTags) {
            throw new CodeError('Tags inconsistency');
        }

        let teeNeeded = (tagIntAnd(requestOrDatasetTags, TAG_TEE_INT) === TAG_TEE_INT);
        if (teeNeeded) {
            if (tagIntAnd(appTag, TAG_TEE_INT) !== TAG_TEE_INT) {
                throw new CodeError('Missing tag [tee] in apporder');
            }
        }
    }

    /**
     * - Check request.appmaxprice >= app.price
     * - Check request.datasetmaxprice >= dataset.price
     * - Check request.workerpoolmaxprice >= workerpool.price
     * @param {AppOrder} appOrder 
     * @param {DatasetOrder?} datasetOrder 
     * @param {WorkerpoolOrder} workerpoolOrder 
     * @param {RequestOrder} requestOrder 
     */
    #checkPrices(appOrder, datasetOrder, workerpoolOrder, requestOrder) {
        const appPrice = appOrder.appprice;
        const appMaxPrice = requestOrder.appmaxprice;

        assert(appPrice instanceof BigNumber);
        assert(appMaxPrice instanceof BigNumber);

        if (appMaxPrice.lt(appPrice)) {
            throw new CodeError(`appmaxprice too low (expected ${appPrice}, got ${appMaxPrice})`);
        }

        const workerpoolPrice = workerpoolOrder.workerpoolprice;
        const workerpoolMaxPrice = requestOrder.workerpoolmaxprice;

        assert(workerpoolPrice instanceof BigNumber);
        assert(workerpoolMaxPrice instanceof BigNumber);

        if (workerpoolMaxPrice.lt(workerpoolPrice)) {
            throw new CodeError(`workerpoolmaxprice too low (expected ${workerpoolPrice}, got ${workerpoolMaxPrice})`);
        }

        if (datasetOrder) {
            const datasetPrice = datasetOrder.datasetprice;
            const datasetMaxPrice = requestOrder.datasetmaxprice;

            assert(datasetPrice instanceof BigNumber);
            assert(datasetMaxPrice instanceof BigNumber);

            if (datasetMaxPrice.lt(datasetPrice)) {
                throw new CodeError(`datasetmaxprice too low (expected ${datasetPrice}, got ${datasetMaxPrice})`);
            }
        }
    }

    /**
     * @param {types.checksumaddress} addr 
     */
    async viewAccount(addr) {
        addr = toChecksumAddress(addr);
        const acc = await this.contract.viewAccount(addr);
        return { locked: acc.locked, stake: acc.stake };
    }

    /**
     * @param {EIP712Domain} domain 
     * @param {AppOrder} appOrder 
     * @param {string} appOrderSalt 
     * @param {Wallet} appOrderSigner 
     */
    async #computeMatchOrderAppArgs(domain, appOrder, appOrderSalt, appOrderSigner) {
        // retrieve app 
        const appReg = await this.appRegistry();
        const app = await appReg.getEntry(appOrder.app);
        if (!app) {
            throw new CodeError(`app ${appOrder.app} does not exist`);
        }
        const appOwner = await app.owner();
        // From Solidity source code: 'IexecPoco1Delegate.sol'
        // require(_checkPresignatureOrSignature(ids.appOwner, ids.apporderStruct, _apporder.sign), 'iExecV5-matchOrders-0x21');
        if (appOwner !== appOrderSigner.address) {
            throw new CodeError(`app owner (${appOwner}) differs from app order signer (${appOrderSigner.address}).`);
        }
        return appOrder.computeMatchOrderArgs(domain, appOrderSalt, appOrderSigner);
    }

    /**
     * - Dataset is optional
     * @param {EIP712Domain} domain 
     * @param {DatasetOrder | null} datasetOrder 
     * @param {string | null} datasetOrderSalt 
     * @param {Wallet | null} datasetOrderSigner 
     */
    async #computeMatchOrderDatasetArgs(domain, datasetOrder, datasetOrderSalt, datasetOrderSigner) {
        if (!datasetOrder) {
            datasetOrder = this.newEmptyDatasetOrder();
            datasetOrderSalt = NULL_BYTES32;
            datasetOrderSigner = null;
        } else {
            assert(datasetOrder.dataset !== NULL_ADDRESS);
            assert(datasetOrderSalt);
            assert(datasetOrderSigner);
            const datasetReg = await this.datasetRegistry();
            const dataset = await datasetReg.getEntry(datasetOrder.dataset);
            if (!dataset) {
                throw new CodeError(`dataset ${datasetOrder.dataset} does not exist`);
            }
            const datasetOwner = await dataset.owner();
            // From Solidity source code: 'IexecPoco1Delegate.sol'
            // require(_checkPresignatureOrSignature(ids.datasetOwner, ids.datasetorderStruct, _datasetorder.sign), 'iExecV5-matchOrders-0x31');
            if (datasetOwner !== datasetOrderSigner.address) {
                throw new CodeError(`dataset owner (${datasetOwner}) differs from dataset order signer (${datasetOrderSigner.address}).`);
            }
        }
        return datasetOrder.computeMatchOrderArgs(domain, datasetOrderSalt, datasetOrderSigner);
    }

    /**
     * @param {EIP712Domain} domain 
     * @param {WorkerpoolOrder} workerpoolOrder 
     * @param {string} workerpoolOrderSalt 
     * @param {Wallet} workerpoolOrderSigner 
     */
    async #computeMatchOrderWorkerpoolArgs(domain, workerpoolOrder, workerpoolOrderSalt, workerpoolOrderSigner) {
        // retrieve workerpool
        const workerpoolReg = await this.workerpoolRegistry();
        const workerpool = await workerpoolReg.getEntry(workerpoolOrder.workerpool);
        if (!workerpool) {
            throw new CodeError(`workerpool ${workerpoolOrder.workerpool} does not exist`);
        }
        const workerpoolOwner = await workerpool.owner();
        // From Solidity source code: 'IexecPoco1Delegate.sol'
        // require(_checkPresignatureOrSignature(ids.workerpoolOwner, ids.workerpoolorderStruct, _workerpoolorder.sign), 'iExecV5-matchOrders-0x41');
        if (workerpoolOwner !== workerpoolOrderSigner.address) {
            throw new CodeError(`workerpool owner (${workerpoolOwner}) differs from workerpool order signer (${workerpoolOrderSigner.address}).`);
        }
        return workerpoolOrder.computeMatchOrderArgs(domain, workerpoolOrderSalt, workerpoolOrderSigner);
    }

    /**
     * @param {AppOrder} appOrder 
     * @param {string} appOrderSalt 
     * @param {Wallet} appOrderSigner 
     * @param {DatasetOrder | null} datasetOrder 
     * @param {string | null} datasetOrderSalt 
     * @param {Wallet | null} datasetOrderSigner 
     * @param {WorkerpoolOrder} workerpoolOrder 
     * @param {string} workerpoolOrderSalt 
     * @param {Wallet} workerpoolOrderSigner 
     * @param {RequestOrder} requestOrder 
     * @param {string} requestOrderSalt 
     * @param {types.TxArgsOrWallet} txArgsOrWallet 
     */
    async #check(
        appOrder,
        appOrderSalt,
        appOrderSigner,
        datasetOrder,
        datasetOrderSalt,
        datasetOrderSigner,
        workerpoolOrder,
        workerpoolOrderSalt,
        workerpoolOrderSigner,
        requestOrder,
        requestOrderSalt,
        txArgsOrWallet) {

        // dataset is optional
        if (!datasetOrder) {
            assert(!datasetOrderSalt);
            assert(!datasetOrderSigner);
        } else {
            assert(datasetOrderSalt);
            assert(datasetOrderSigner);
        }

        // compiler
        if (!datasetOrderSalt) {
            datasetOrderSalt = NULL_BYTES32;
        }

        // this.#checkAddresses();
        // await this.#checkDeloyement();
        // await this.#checkSignatures();

        // // enterprise KYC checks (to be implemented)
        // await this.#checkEnterpriseKYC();

        this.#checkCategory(workerpoolOrder, requestOrder);
        this.#checkTrust(workerpoolOrder, requestOrder);
        this.#checkTags(appOrder, datasetOrder, workerpoolOrder, requestOrder);
        this.#checkPrices(appOrder, datasetOrder, workerpoolOrder, requestOrder);

        /*************************************************************************************
         *                             Final Check:                                          *
         *                       - Compute final volume                                      *
         *   - Compute Requester Lock (the price to pay by the requester)                    *
         *   - Compute Scheduler Lock (the amount to stake by the scheduler to participate)  *
         *************************************************************************************/

        /*
            uint256 volume;
            volume =                             _apporder.volume.sub       (m_consumed[ids.apporderHash       ]);
            volume = ids.hasDataset ? volume.min(_datasetorder.volume.sub   (m_consumed[ids.datasetorderHash   ])) : volume;
            volume =                  volume.min(_workerpoolorder.volume.sub(m_consumed[ids.workerpoolorderHash]));
            volume =                  volume.min(_requestorder.volume.sub   (m_consumed[ids.requestorderHash   ]));
            require(volume > 0, 'iExecV5-matchOrders-0x60');
        */

        const consumed = await Promise.all([
            this.viewConsumed(appOrder, appOrderSalt),
            (datasetOrder) ? await this.viewConsumed(datasetOrder, datasetOrderSalt) : BigNumber.from(0),
            this.viewConsumed(workerpoolOrder, workerpoolOrderSalt),
            this.viewConsumed(requestOrder, requestOrderSalt),
        ]);
        assert(consumed.length == 4);

        const appConsumed = consumed[0];
        const datasetConsumed = consumed[1];
        const workerpoolConsumed = consumed[2];
        const requestConsumed = consumed[3];

        // remaining app volume
        const appVolumeSubConsumed = appOrder.volume.sub(appConsumed);
        // remaining dataset volume
        const datasetVolumeSubConsumed = (datasetOrder) ? datasetOrder.volume.sub(datasetConsumed) : BigNumber.from(0);
        // remaining workerpool volume
        const workerpoolVolumeSubConsumed = workerpoolOrder.volume.sub(workerpoolConsumed);
        // remaining request volume
        const requestVolumeSubConsumed = requestOrder.volume.sub(requestConsumed);

        // uint256 volume;
        let volume
        // 0: app order
        // volume =                             _apporder.volume.sub       (m_consumed[ids.apporderHash       ]);
        volume = appVolumeSubConsumed;
        if (datasetOrder) {
            // 1 = dataset order
            // volume = ids.hasDataset ? volume.min(_datasetorder.volume.sub   (m_consumed[ids.datasetorderHash   ])) : volume;
            if (datasetVolumeSubConsumed.lt(volume)) {
                volume = datasetVolumeSubConsumed;
            }
        }
        // 2: workerpool order
        // volume =                  volume.min(_workerpoolorder.volume.sub(m_consumed[ids.workerpoolorderHash]));
        if (workerpoolVolumeSubConsumed.lt(volume)) {
            volume = workerpoolVolumeSubConsumed;
        }
        // 3: request order
        // volume =                  volume.min(_requestorder.volume.sub   (m_consumed[ids.requestorderHash   ]));
        if (requestVolumeSubConsumed.lt(volume)) {
            volume = requestVolumeSubConsumed;
        }
        if (volume.lte(0)) {
            throw new CodeError('Volume is fully consumed');
        }

        /*
            lock(
                deal.requester,
                deal.app.price
                .add(deal.dataset.price)
                .add(deal.workerpool.price)
                .mul(volume)
            );
        */
        const appPrice = appOrder.appprice;
        const datasetPrice = (datasetOrder) ? datasetOrder.datasetprice : BigNumber.from(0);
        const workerpoolPrice = workerpoolOrder.workerpoolprice;

        const requesterAccount = await this.viewAccount(requestOrder.requester);
        const requesterLock = appPrice.add(datasetPrice).add(workerpoolPrice).mul(volume);
        const requesterStake = requesterAccount.stake;
        if (requesterStake.lt(requesterLock)) {
            assert(!(requesterStake.eq(requesterLock)));
            throw new CodeError(`The total amount to lock by the requester (${requesterLock.toString()}) is greather than the requester account stake (${requesterStake.toString()}).`);
        }

        /*
            lock(
                deal.workerpool.owner,
                deal.workerpool.price
                .percentage(WORKERPOOL_STAKE_RATIO) // ORDER IS IMPORTANT HERE!
                .mul(volume)                        // ORDER IS IMPORTANT HERE!
            );

            // From SafeMathExtended.sol
            a.percentage(b) = div(mul(a, b), 100)

            Definitions:
            ------------
            Scheduler : core, workerpool
            workerpoolOrder.price : price charged by the scheduler for 'one' single task computation
            Volume : total number of tasks to compute
            Deal : bunch of tasks

            Scheduler Lock Rule:
            --------------------
            In order to charge a given 'price' for one task (=workerpoolOrder.price), 
            the scheduler MUST lock 30% of this given 'price', prior to the computation of this task.
            Therefore, to start the computation of N tasks, the scheduler must lock N times the 'price'.
            The formula : lock(volume * workerpoolOrder.price * 30 / 100)

            Each time a task is computed successfully, one fraction of the total locked amount is unlocked.
            The formula :  unlock(workerpoolOrder.price * 30 / 100)

            Each worker who wants to participate MUST lock: 
            scheduler.single-task-price * scheduler.m_workerStakeRatioPolicy / 100 

            Worker Lock Rule:
            -----------------
            In order to participate to a group computation managed by the scheduler, the worker must lock 
            a certain amount defined by the scheduler (aka: Policy). 
            If the computation is successfull, the locked amout is unlocked and the worker recieves a reward
            The Scheduler Policy parameters:
                - m_workerStakeRatioPolicy 
                - m_schedulerRewardRatioPolicy  

            The worker stake for 1 task = scheduler.single-task-price * m_workerStakeRatioPolicy / 100
            The worker reward for 1 task = F(m_schedulerRewardRatioPolicy)

            Worker Failure
            --------------
            If the worker failed to compute the task, its stake is lost and remains with 
            the global Currency Contract (RLC/ETH)

            Scheduler Rewards
            -----------------
            When all the tasks have been computed (successfully or not), the scheduler stake is unlocked
            The scheduler is rewarded after each successfull computation.
            Note: it looks like the scheduler is never penalized.
        */
        const WORKERPOOL_STAKE_RATIO = BigNumber.from(30);
        const workerpoolAccount = await this.viewAccount(workerpoolOrderSigner.address);
        const workerpoolStake = workerpoolAccount.stake;
        const workerpoolLock = workerpoolPrice.mul(WORKERPOOL_STAKE_RATIO).div(BigNumber.from(100)).mul(volume);
        if (workerpoolStake.lt(workerpoolLock)) {
            assert(!(workerpoolStake.eq(workerpoolLock)));
            throw new CodeError(`The total amount to lock by the workerpool owner (${workerpoolLock.toString()}) is greather than the workerpool owner account stake (${workerpoolStake.toString()}).`);
        }
    }

    /*
    struct AppOrder
    {
        address app;
        uint256 appprice;
        uint256 volume;
        bytes32 tag;
        address datasetrestrict;
        address workerpoolrestrict;
        address requesterrestrict;
        bytes32 salt;
        bytes   sign;
    }

    struct DatasetOrder
    {
        address dataset;
        uint256 datasetprice;
        uint256 volume;
        bytes32 tag;
        address apprestrict;
        address workerpoolrestrict;
        address requesterrestrict;
        bytes32 salt;
        bytes   sign;
    }

    struct WorkerpoolOrder
    {
        address workerpool;
        uint256 workerpoolprice;
        uint256 volume;
        bytes32 tag;
        uint256 category;
        uint256 trust;
        address apprestrict;
        address datasetrestrict;
        address requesterrestrict;
        bytes32 salt;
        bytes   sign;
    }

    struct RequestOrder
    {
        address app;
        uint256 appmaxprice;
        address dataset;
        uint256 datasetmaxprice;
        address workerpool;
        uint256 workerpoolmaxprice;
        address requester;
        uint256 volume;
        bytes32 tag;
        uint256 category;
        uint256 trust;
        address beneficiary;
        address callback;
        string  params;
        bytes32 salt;
        bytes   sign;
    }

    // should be external
    function matchOrders(
        IexecLibOrders_v5.AppOrder        memory _apporder,
        IexecLibOrders_v5.DatasetOrder    memory _datasetorder,
        IexecLibOrders_v5.WorkerpoolOrder memory _workerpoolorder,
        IexecLibOrders_v5.RequestOrder    memory _requestorder)
    public override returns (bytes32)
    */

    /**
     * @param {{
     *      appOrder: AppOrder
     *      appOrderSalt: string
     *      appOrderSigner: Wallet
     *      datasetOrder: DatasetOrder | null
     *      datasetOrderSalt: string | null
     *      datasetOrderSigner: Wallet | null
     *      workerpoolOrder: WorkerpoolOrder
     *      workerpoolOrderSalt: string
     *      workerpoolOrderSigner: Wallet
     *      requestOrder: RequestOrder
     *      requestOrderSalt: string
     * }} args 
     * @param {types.TxArgsOrWallet} txArgsOrWallet 
     */
    async matchOrders(
        {
            appOrder,
            appOrderSalt,
            appOrderSigner,
            datasetOrder,
            datasetOrderSalt,
            datasetOrderSigner,
            workerpoolOrder,
            workerpoolOrderSalt,
            workerpoolOrderSigner,
            requestOrder,
            requestOrderSalt
        },
        txArgsOrWallet) {
        const txArgs = toTxArgs(txArgsOrWallet);
        const domain = await this.domain();

        this.#check(appOrder,
            appOrderSalt,
            appOrderSigner,
            datasetOrder,
            datasetOrderSalt,
            datasetOrderSigner,
            workerpoolOrder,
            workerpoolOrderSalt,
            workerpoolOrderSigner,
            requestOrder,
            requestOrderSalt,
            txArgsOrWallet);

        const callArgs = await Promise.all([
            this.#computeMatchOrderAppArgs(domain, appOrder, appOrderSalt, appOrderSigner),
            this.#computeMatchOrderDatasetArgs(domain, datasetOrder, datasetOrderSalt, datasetOrderSigner),
            this.#computeMatchOrderWorkerpoolArgs(domain, workerpoolOrder, workerpoolOrderSalt, workerpoolOrderSigner)
        ]);

        // From Solidity source code: 'IexecPoco1Delegate.sol'
        // require(_checkPresignatureOrSignature(_requestorder.requester, ids.requestorderStruct, _requestorder.sign), 'iExecV5-matchOrders-0x50');
        const requestOrderSigner = txArgs.wallet;
        if (requestOrder.requester !== requestOrderSigner.address) {
            throw new CodeError(`requester address (${requestOrder.requester}) differs from request order signer (${requestOrderSigner.address}).`);
        }

        // handle requestOrder
        const requestCallArgs = await requestOrder.computeMatchOrderArgs(
            domain,
            requestOrderSalt,
            requestOrderSigner);

        const signingContract = this.newSigningContract(requestOrderSigner);

        /** @type {any} */
        const tx = await signingContract.matchOrders(
            callArgs[0],
            callArgs[1],
            callArgs[2],
            requestCallArgs,
            txArgs.txOverrides);

        // wait for tx
        const txReceipt = await tx.wait(txArgs.txConfirms);
        const evtOrdersMatched = txReceipt.events.find(/** @param {any} event */(event) => event.event === 'OrdersMatched');
        if (!evtOrdersMatched) {
            throw new Error('OrdersMatched not confirmed');
        }

        const dealid = evtOrdersMatched.args.dealid;
        assert(typeof dealid === 'string');
        const txHash = tx.hash;
        assert(typeof txHash === 'string');
        const volume = evtOrdersMatched.args.volume;
        assert(volume instanceof BigNumber);

        // volume <= requestOrder.volume
        // volume === Deal(dealid).volume
        // volume = min of all volumes 
        return {
            dealid,
            volume,
            txHash
        };
    }

    /**
     * @param {types.bytes32string} dealid 
     */
    async viewDeal(dealid) {
        if (!isBytes32String(dealid)) {
            throw Error('Invalid argument, not a bytes32')
        }
        const dealRpc = await this.contract.viewDeal(dealid);
        return newDealFromRPC(dealid, dealRpc);
    } 

    /**
     * @param {RequestOrder} requestOrder 
     * @param {types.bytes32string} salt 
     * @param {types.uint256like} idx 
     */
    async viewRequestOrderDeal(requestOrder, salt, idx) {
        if (!isBytes32String(salt)) {
            throw Error('Invalid argument, not a bytes32')
        }
        const domain = await this.domain();
        const dealid = requestOrder.computeDealId(domain, salt, idx);
        return this.viewDeal(dealid);
    }

    /**
     * @param {types.bytes32string} taskid 
     */
    async viewTask(taskid) {
        if (!isBytes32String(taskid)) {
            throw Error('Invalid argument, not a bytes32')
        }
        const taskRpc = await this.contract.viewTask(taskid);
        return newTaskFromRPC(taskid, taskRpc);
    }

    /**
     * taskidx >= 0 && taskidx < botSize
     * @param {types.bytes32string | Deal} dealidOrDeal 
     * @param {types.uint256like} taskidx 
     */
    async viewTaskAt(dealidOrDeal, taskidx) {
        /** @type {Deal} */
        let deal;
        if (!(dealidOrDeal instanceof Deal)) {
            if (!isBytes32String(dealidOrDeal)) {
                throw Error('Invalid argument, not a bytes32')
            }
            const dealRpc = await this.contract.viewDeal(dealidOrDeal);
            deal = newDealFromRPC(dealidOrDeal, dealRpc);
        } else {
            deal = dealidOrDeal;
        }
        const taskId = deal.computeTaskId(taskidx);
        return this.viewTask(taskId);
    }

    /**
     * Eth Call
     * @return {Promise<types.uint256>}
     */
    async countCategory() {
        return await this.contract.countCategory();
    }

    /**
     * EVM error if catId >= count
     * @param {number | types.uint256} catIdx 
     * @returns {Promise<Category | null>}
     */
    async viewCategory(catIdx) {
        if (catIdx === null || catIdx === undefined) {
            return null;
        }
        if ((typeof catIdx !== 'number') && !(catIdx instanceof BigNumber)) {
            throw new TypeError('Invalid catIdx');
        }
        try {
            const catIdxBn = BigNumber.from(catIdx);
            const c = await this.contract.viewCategory(catIdxBn);
            return newCategory({
                id: catIdxBn,
                hub: this.address ?? NULL_ADDRESS,
                description: c.description,
                name: c.name,
                workClockTimeRef: c.workClockTimeRef
            });
        } catch {
            return null;
        }
    }

    /*
     function createCategory(
        string  calldata name,
        string  calldata description,
        uint256          workClockTimeRef)
    external override onlyOwner returns (uint256)
    {
        m_categories.push(IexecLibCore_v5.Category(
            name,
            description,
            workClockTimeRef
        ));
 
        uint256 catid = m_categories.length - 1;
 
        emit CreateCategory(
            catid,
            name,
            description,
            workClockTimeRef
        );
        return catid;
    }
    */

    /**
     * @param {string} name 
     * @param {string} description 
     * @param {types.uint256} workClockTimeRef 
     * @param {types.TxArgsOrWallet} txArgsOrWallet 
     */
    async createCategory(name, description, workClockTimeRef, txArgsOrWallet) {
        throwIfNullishOrEmptyString(name);
        throwIfNullishOrEmptyString(description);
        if (!(workClockTimeRef instanceof BigNumber)) {
            throw new CodeError('Invalid workClockTimeRef argument');
        }

        const txArgs = toTxArgs(txArgsOrWallet);

        const owner = await this.owner();
        if (txArgs.wallet.address !== owner) {
            throw new CodeError(`Incompatible wallet. wallet address=${txArgs.wallet.address} differs from contract owner address=${owner}`);
        }

        const sc = this.newSigningContract(txArgs.wallet);
        /** @type {any} */
        const tx = await sc.createCategory(
            name,
            description,
            workClockTimeRef,
            txArgs.txOverrides);

        // wait for tx
        const txReceipt = await tx.wait(txArgs.txConfirms);
        const evtCreateCategory = txReceipt.events.find((/** @type {{ event: string; }} */ event) => event.event === 'CreateCategory');
        if (!evtCreateCategory) {
            throw new Error(`Unknown event 'CreateCategory'`);
        }

        const catIdBN = evtCreateCategory.args.catid;
        const newCat = newCategory({
            id: catIdBN,
            hub: this.address ?? NULL_ADDRESS,
            name: evtCreateCategory.args.name,
            description: evtCreateCategory.args.description,
            workClockTimeRef: evtCreateCategory.args.workClockTimeRef,
        });
        return newCat;
    }
}