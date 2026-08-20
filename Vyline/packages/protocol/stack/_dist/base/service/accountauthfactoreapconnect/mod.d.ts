import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class AccountAuthFactorEapConnectService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    connectEapAccount(...param: Parameters<typeof LINEStruct.connectEapAccount_args>): Promise<LINETypes.connectEapAccount_result["success"]>;
    disconnectEapAccount(...param: Parameters<typeof LINEStruct.disconnectEapAccount_args>): Promise<LINETypes.disconnectEapAccount_result["success"]>;
    openSession(...param: Parameters<typeof LINEStruct.openSession_args>): Promise<LINETypes.openSession_result["success"]>;
    verifyEapLogin(...param: Parameters<typeof LINEStruct.verifyEapLogin_args>): Promise<LINETypes.verifyEapLogin_result["success"]>;
}
