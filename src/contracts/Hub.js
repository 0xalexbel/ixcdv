import { HubStandard } from "./HubStandard.js";
import { HubEnterprise } from "./HubEnterprise.js";
import { HubNative } from "./HubNative.js";
import { HubUniswap } from "./HubUniswap.js";
import { PoCoHubRef } from "../common/contractref.js";
import { CodeError } from "../common/error.js";

export class Hub {
    /**
     * @param {PoCoHubRef} hubRef 
     * @param {string} contractDir
     * @param {{
     *      ensAddress: string
     *      networkName: string
     * }} options 
     */
    static sharedReadOnly(hubRef, contractDir, options) {
        if (hubRef.isStandard) {
            return HubStandard.sharedReadOnly(hubRef, contractDir, options);
        }
        if (hubRef.isEnterprise) {
            return HubEnterprise.sharedReadOnly(hubRef, contractDir, options);
        }
        if (hubRef.isNative) {
            return HubNative.sharedReadOnly(hubRef, contractDir, options);
        }
        if (hubRef.isUniswap) {
            return HubUniswap.sharedReadOnly(hubRef, contractDir, options);
        }
        throw new CodeError('Invalid hub argument');
    }
}