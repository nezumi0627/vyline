import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class AccessTokenRefreshService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    refresh(...param: Parameters<typeof LINEStruct.refresh_args>): Promise<LINETypes.refresh_result["success"]>;
    reportRefreshedAccessToken(...param: Parameters<typeof LINEStruct.reportRefreshedAccessToken_args>): Promise<LINETypes.reportRefreshedAccessToken_result["success"]>;
}
