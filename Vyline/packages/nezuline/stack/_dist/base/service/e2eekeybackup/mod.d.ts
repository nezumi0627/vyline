import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class E2EEKeyBackupService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    getE2EEKeyBackupCertificates(...param: Parameters<typeof LINEStruct.getE2EEKeyBackupCertificates_args>): Promise<LINETypes.getE2EEKeyBackupCertificates_result["success"]>;
    getE2EEKeyBackupInfo(...param: Parameters<typeof LINEStruct.getE2EEKeyBackupInfo_args>): Promise<LINETypes.getE2EEKeyBackupInfo_result["success"]>;
}
