import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class CoinService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    getTotalCoinBalance(...param: Parameters<typeof LINEStruct.getTotalCoinBalance_args>): Promise<LINETypes.getTotalCoinBalance_result["success"]>;
    getCoinPurchaseHistory(...param: Parameters<typeof LINEStruct.getCoinPurchaseHistory_args>): Promise<LINETypes.getCoinPurchaseHistory_result["success"]>;
    getCoinProducts(...param: Parameters<typeof LINEStruct.getCoinProducts_args>): Promise<LINETypes.getCoinProducts_result["success"]>;
    reserveCoinPurchase(...param: Parameters<typeof LINEStruct.reserveCoinPurchase_args>): Promise<LINETypes.reserveCoinPurchase_result["success"]>;
    getCoinUseAndRefundHistory(...param: Parameters<typeof LINEStruct.getCoinUseAndRefundHistory_args>): Promise<LINETypes.getCoinUseAndRefundHistory_result["success"]>;
}
