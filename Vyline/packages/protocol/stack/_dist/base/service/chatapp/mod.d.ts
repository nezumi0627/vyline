import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class ChatAppService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    getChatapp(...param: Parameters<typeof LINEStruct.getChatapp_args>): Promise<LINETypes.getChatapp_result["success"]>;
    getMyChatapps(...param: Parameters<typeof LINEStruct.getMyChatapps_args>): Promise<LINETypes.getMyChatapps_result["success"]>;
}
