import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class MultiProfileService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    deleteMultiProfile(...param: Parameters<typeof LINEStruct.deleteMultiProfile_args>): Promise<LINETypes.deleteMultiProfile_result["success"]>;
    getMappedProfileIds(...param: Parameters<typeof LINEStruct.getMappedProfileIds_args>): Promise<LINETypes.getMappedProfileIds_result["success"]>;
    mapProfileToUsers(...param: Parameters<typeof LINEStruct.mapProfileToUsers_args>): Promise<LINETypes.mapProfileToUsers_result["success"]>;
    updateProfileAttributes(...param: Parameters<typeof LINEStruct.updateProfileAttributes_args>): Promise<void>;
    createMultiProfile(...param: Parameters<typeof LINEStruct.createMultiProfile_args>): Promise<LINETypes.createMultiProfile_result["success"]>;
    getProfile(...param: Parameters<typeof LINEStruct.getProfile_args>): Promise<LINETypes.getProfile_result["success"]>;
    getUsersMappedByProfile(...param: Parameters<typeof LINEStruct.getUsersMappedByProfile_args>): Promise<LINETypes.getUsersMappedByProfile_result["success"]>;
}
