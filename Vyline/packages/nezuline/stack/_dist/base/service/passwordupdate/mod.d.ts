import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class PasswordUpdateService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    createSession(...param: Parameters<typeof LINEStruct.createSession_args>): Promise<LINETypes.createSession_result["success"]>;
    getPasswordHashingParameter(...param: Parameters<typeof LINEStruct.getPasswordHashingParameter_args>): Promise<LINETypes.getPasswordHashingParameter_result["success"]>;
    setPassword(...param: Parameters<typeof LINEStruct.setPassword_args>): Promise<LINETypes.setPassword_result["success"]>;
    updatePassword(...param: Parameters<typeof LINEStruct.updatePassword_args>): Promise<LINETypes.updatePassword_result["success"]>;
}
