import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class SettingsService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    bulkGetSetting(...param: Parameters<typeof LINEStruct.bulkGetSetting_args>): Promise<LINETypes.bulkGetSetting_result["success"]>;
    bulkSetSetting(...param: Parameters<typeof LINEStruct.bulkSetSetting_args>): Promise<LINETypes.bulkSetSetting_result["success"]>;
}
