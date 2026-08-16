import * as thrift from "thrift";
import { Buffer } from "node:buffer";
import type { ParsedThrift } from "./declares.ts";
export declare function readThrift(data: Uint8Array | Buffer, Protocol?: typeof thrift.TCompactProtocol | typeof thrift.TBinaryProtocol): ParsedThrift;
export declare function readThriftStruct(data: Uint8Array | Buffer, Protocol?: typeof thrift.TCompactProtocol | typeof thrift.TBinaryProtocol): any;
