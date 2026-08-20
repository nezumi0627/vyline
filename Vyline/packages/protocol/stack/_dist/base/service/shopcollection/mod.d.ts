import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class ShopCollectionService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    getUserCollections(...param: Parameters<typeof LINEStruct.getUserCollections_args>): Promise<LINETypes.getUserCollections_result["success"]>;
    createCollectionForUser(...param: Parameters<typeof LINEStruct.createCollectionForUser_args>): Promise<LINETypes.createCollectionForUser_result["success"]>;
    addItemToCollection(...param: Parameters<typeof LINEStruct.addItemToCollection_args>): Promise<LINETypes.addItemToCollection_result["success"]>;
    removeItemFromCollection(...param: Parameters<typeof LINEStruct.removeItemFromCollection_args>): Promise<LINETypes.removeItemFromCollection_result["success"]>;
    isProductForCollections(...param: Parameters<typeof LINEStruct.isProductForCollections_args>): Promise<LINETypes.isProductForCollections_result["success"]>;
}
