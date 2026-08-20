import { type NestedArray, type ProtocolKey, type Protocols } from "./declares.js";
export declare function writeThrift(value: NestedArray, name: string, Protocol: (typeof Protocols)[ProtocolKey]): Uint8Array;
export declare function writeStruct(value: NestedArray, Protocol: (typeof Protocols)[ProtocolKey]): Uint8Array;
