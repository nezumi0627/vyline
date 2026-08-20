import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class PrimaryAccountSmartSwitchRestoreService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    checkEmailAssigned(...param: Parameters<typeof LINEStruct.checkEmailAssigned_args>): Promise<LINETypes.checkEmailAssigned_result["success"]>;
    checkIfPasswordSetVerificationEmailVerified(...param: Parameters<typeof LINEStruct.checkIfPasswordSetVerificationEmailVerified_args>): Promise<LINETypes.checkIfPasswordSetVerificationEmailVerified_result["success"]>;
    getAcctVerifMethod(...param: Parameters<typeof LINEStruct.getAcctVerifMethod_args>): Promise<LINETypes.getAcctVerifMethod_result["success"]>;
    getCountryInfo(...param: Parameters<typeof LINEStruct.getCountryInfo_args>): Promise<LINETypes.getCountryInfo_result["success"]>;
    getMaskedEmail(...param: Parameters<typeof LINEStruct.getMaskedEmail_args>): Promise<LINETypes.getMaskedEmail_result["success"]>;
    getPasswordHashingParametersForPwdReg(...param: Parameters<typeof LINEStruct.getPasswordHashingParametersForPwdReg_args>): Promise<LINETypes.getPasswordHashingParametersForPwdReg_result["success"]>;
    getPasswordHashingParametersForPwdVerif(...param: Parameters<typeof LINEStruct.getPasswordHashingParametersForPwdVerif_args>): Promise<LINETypes.getPasswordHashingParametersForPwdVerif_result["success"]>;
    getPhoneVerifMethodV2(...param: Parameters<typeof LINEStruct.getPhoneVerifMethodV2_args>): Promise<LINETypes.getPhoneVerifMethodV2_result["success"]>;
    requestToSendPasswordSetVerificationEmail(...param: Parameters<typeof LINEStruct.requestToSendPasswordSetVerificationEmail_args>): Promise<LINETypes.requestToSendPasswordSetVerificationEmail_result["success"]>;
    requestToSendPhonePinCode(...param: Parameters<typeof LINEStruct.requestToSendPhonePinCode_args>): Promise<LINETypes.requestToSendPhonePinCode_result["success"]>;
    setHashedPassword(...param: Parameters<typeof LINEStruct.setHashedPassword_args>): Promise<LINETypes.setHashedPassword_result["success"]>;
    verifyAccountUsingHashedPwd(...param: Parameters<typeof LINEStruct.verifyAccountUsingHashedPwd_args>): Promise<LINETypes.verifyAccountUsingHashedPwd_result["success"]>;
    verifyEapLogin(...param: Parameters<typeof LINEStruct.verifyEapLogin_args>): Promise<LINETypes.verifyEapLogin_result["success"]>;
    verifyPhonePinCode(...param: Parameters<typeof LINEStruct.verifyPhonePinCode_args>): Promise<LINETypes.verifyPhonePinCode_result["success"]>;
}
