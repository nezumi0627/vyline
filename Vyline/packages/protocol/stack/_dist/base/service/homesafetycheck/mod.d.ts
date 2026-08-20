import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class HomeSafetyCheckService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    deleteSafetyStatus(...param: Parameters<typeof LINEStruct.deleteSafetyStatus_args>): Promise<void>;
    getDisasterCases(...param: Parameters<typeof LINEStruct.getDisasterCases_args>): Promise<LINETypes.getDisasterCases_result["success"]>;
    updateSafetyStatus(...param: Parameters<typeof LINEStruct.updateSafetyStatus_args>): Promise<void>;
}
