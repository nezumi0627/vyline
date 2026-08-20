import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class PremiumStatusService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    getPremiumStatus(...param: Parameters<typeof LINEStruct.getPremiumStatus_args>): Promise<LINETypes.getPremiumStatus_result["success"]>;
    getPremiumStatusForUpgrade(...param: Parameters<typeof LINEStruct.getPremiumStatusForUpgrade_args>): Promise<LINETypes.getPremiumStatusForUpgrade_result["success"]>;
    getDataRetention(...param: Parameters<typeof LINEStruct.getDataRetention_args>): Promise<LINETypes.getDataRetention_result["success"]>;
    getIncentiveStatus(...param: Parameters<typeof LINEStruct.getIncentiveStatus_args>): Promise<LINETypes.getIncentiveStatus_result["success"]>;
}
