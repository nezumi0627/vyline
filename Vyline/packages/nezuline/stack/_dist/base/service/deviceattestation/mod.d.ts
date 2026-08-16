import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class DeviceAttestationService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    getAssertionChallenge(...param: Parameters<typeof LINEStruct.getAssertionChallenge_args>): Promise<LINETypes.getAssertionChallenge_result["success"]>;
    getAttestationChallenge(...param: Parameters<typeof LINEStruct.getAttestationChallenge_args>): Promise<LINETypes.getAttestationChallenge_result["success"]>;
    verifyAssertion(...param: Parameters<typeof LINEStruct.verifyAssertion_args>): Promise<LINETypes.verifyAssertion_result["success"]>;
    verifyAttestation(...param: Parameters<typeof LINEStruct.verifyAttestation_args>): Promise<LINETypes.verifyAttestation_result["success"]>;
}
