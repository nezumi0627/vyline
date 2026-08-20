import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class PrimaryAccountInitService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    openSession(...param: Parameters<typeof LINEStruct.openSession_args>): Promise<LINETypes.openSession_result["success"]>;
    getCountryInfo(...param: Parameters<typeof LINEStruct.getCountryInfo_args>): Promise<LINETypes.getCountryInfo_result["success"]>;
    validateProfile(...param: Parameters<typeof LINEStruct.validateProfile_args>): Promise<LINETypes.validateProfile_result["success"]>;
    setPassword(...param: Parameters<typeof LINEStruct.setPassword_args>): Promise<LINETypes.setPassword_result["success"]>;
    getPhoneVerifMethodV2(...param: Parameters<typeof LINEStruct.getPhoneVerifMethodV2_args>): Promise<LINETypes.getPhoneVerifMethodV2_result["success"]>;
    requestToSendPhonePinCode(...param: Parameters<typeof LINEStruct.requestToSendPhonePinCode_args>): Promise<LINETypes.requestToSendPhonePinCode_result["success"]>;
    verifyPhonePinCode(...param: Parameters<typeof LINEStruct.verifyPhonePinCode_args>): Promise<LINETypes.verifyPhonePinCode_result["success"]>;
    registerPrimaryUsingPhoneWithTokenV3(...param: Parameters<typeof LINEStruct.registerPrimaryUsingPhoneWithTokenV3_args>): Promise<LINETypes.registerPrimaryUsingPhoneWithTokenV3_result["success"]>;
    lookupAvailableEap(...param: Parameters<typeof LINEStruct.lookupAvailableEap_args>): Promise<LINETypes.lookupAvailableEap_result["success"]>;
    getAllowedRegistrationMethod(...param: Parameters<typeof LINEStruct.getAllowedRegistrationMethod_args>): Promise<LINETypes.getAllowedRegistrationMethod_result["success"]>;
    verifyEapAccountForRegistration(...param: Parameters<typeof LINEStruct.verifyEapAccountForRegistration_args>): Promise<LINETypes.verifyEapAccountForRegistration_result["success"]>;
    registerPrimaryUsingEapAccount(...param: Parameters<typeof LINEStruct.registerPrimaryUsingEapAccount_args>): Promise<LINETypes.registerPrimaryUsingEapAccount_result["success"]>;
    getPhoneVerifMethodForRegistration(...param: Parameters<typeof LINEStruct.getPhoneVerifMethodForRegistration_args>): Promise<LINETypes.getPhoneVerifMethodForRegistration_result["success"]>;
    getAcctVerifMethod(...param: Parameters<typeof LINEStruct.getAcctVerifMethod_args>): Promise<LINETypes.getAcctVerifMethod_result["success"]>;
    getPasswordHashingParametersForPwdReg(...param: Parameters<typeof LINEStruct.getPasswordHashingParametersForPwdReg_args>): Promise<LINETypes.getPasswordHashingParametersForPwdReg_result["success"]>;
    setHashedPassword(...param: Parameters<typeof LINEStruct.setHashedPassword_args>): Promise<LINETypes.setHashedPassword_result["success"]>;
}
