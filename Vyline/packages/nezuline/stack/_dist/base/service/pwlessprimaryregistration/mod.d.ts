import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class PwlessPrimaryRegistrationService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    createSession(...param: Parameters<typeof LINEStruct.createSession_args>): Promise<LINETypes.createSession_result["success"]>;
    getChallengeForPrimaryReg(...param: Parameters<typeof LINEStruct.getChallengeForPrimaryReg_args>): Promise<LINETypes.getChallengeForPrimaryReg_result["success"]>;
}
