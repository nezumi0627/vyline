import { type BaseClient } from "../../core/mod.js";
import type { ProtocolKey } from "../../thrift/mod.js";
import type { BaseService } from "../types.ts";
import { LINEStruct } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
export declare class PrimaryQrCodeMigrationLongPollingService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    checkIfEncryptedE2EEKeyReceived(...param: Parameters<typeof LINEStruct.checkIfEncryptedE2EEKeyReceived_args>): Promise<LINETypes.checkIfEncryptedE2EEKeyReceived_result["success"]>;
}
