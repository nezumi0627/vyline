import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class PremiumFontService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    getAccessToken(...param: Parameters<typeof LINEStruct.getAccessToken_args>): Promise<LINETypes.getAccessToken_result["success"]>;
    getFontMetas(...param: Parameters<typeof LINEStruct.getFontMetas_args>): Promise<LINETypes.getFontMetas_result["success"]>;
}
