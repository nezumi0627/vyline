import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class BuddyService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    getPromotedBuddyContacts(...param: Parameters<typeof LINEStruct.getPromotedBuddyContacts_args>): Promise<LINETypes.getPromotedBuddyContacts_result["success"]>;
    getBuddyDetailWithPersonal(...param: Parameters<typeof LINEStruct.getBuddyDetailWithPersonal_args>): Promise<LINETypes.getBuddyDetailWithPersonal_result["success"]>;
    getNewlyReleasedBuddyIds(...param: Parameters<typeof LINEStruct.getNewlyReleasedBuddyIds_args>): Promise<LINETypes.getNewlyReleasedBuddyIds_result["success"]>;
    getBuddyDetail(...param: Parameters<typeof LINEStruct.getBuddyDetail_args>): Promise<LINETypes.getBuddyDetail_result["success"]>;
}
