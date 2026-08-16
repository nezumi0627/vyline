import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class OaMembershipService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    activateSubscription(...param: Parameters<typeof LINEStruct.activateSubscription_args>): Promise<void>;
    getJoinedMembership(...param: Parameters<typeof LINEStruct.getJoinedMembership_args>): Promise<LINETypes.getJoinedMembership_result["success"]>;
}
