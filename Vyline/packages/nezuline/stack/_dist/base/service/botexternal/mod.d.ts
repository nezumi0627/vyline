import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class BotExternalService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    notifyOATalkroomEvents(...param: Parameters<typeof LINEStruct.notifyOATalkroomEvents_args>): Promise<LINETypes.notifyOATalkroomEvents_result["success"]>;
    notifyChatAdEntry(...param: Parameters<typeof LINEStruct.notifyChatAdEntry_args>): Promise<LINETypes.notifyChatAdEntry_result["success"]>;
}
