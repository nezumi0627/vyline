import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class PrimaryAccountReLoginService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    createSession(...param: Parameters<typeof LINEStruct.createSession_args>): Promise<LINETypes.createSession_result["success"]>;
    getCountryInfo(...param: Parameters<typeof LINEStruct.getCountryInfo_args>): Promise<LINETypes.getCountryInfo_result["success"]>;
    getPhoneVerifMethodV2(...param: Parameters<typeof LINEStruct.getPhoneVerifMethodV2_args>): Promise<LINETypes.getPhoneVerifMethodV2_result["success"]>;
    requestToSendPhonePinCode(...param: Parameters<typeof LINEStruct.requestToSendPhonePinCode_args>): Promise<LINETypes.requestToSendPhonePinCode_result["success"]>;
    verifyEapLogin(...param: Parameters<typeof LINEStruct.verifyEapLogin_args>): Promise<LINETypes.verifyEapLogin_result["success"]>;
    verifyPhonePinCode(...param: Parameters<typeof LINEStruct.verifyPhonePinCode_args>): Promise<LINETypes.verifyPhonePinCode_result["success"]>;
}
