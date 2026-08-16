export declare const COMPACT_PLAIN_MESSAGE_ENDPOINT = "/CA5";
export declare const COMPACT_E2EE_MESSAGE_ENDPOINT = "/ECA5";
export type CompactMessageType = 2 | 5 | 6;
export interface CompactMessageResponse {
    sequenceId: number;
    messageId: bigint;
    createdTime: number;
}
export interface CompactMessageProtocolOptions {
    msgType: CompactMessageType;
    seqId: number;
    to: string;
    args: string | readonly Uint8Array[];
    plainSuffix?: number;
}
export interface SendCompactMessageOptions {
    to: string;
    text?: string;
    chunks?: readonly Uint8Array[];
    e2ee?: boolean;
}
export declare class CompactMessageProtocolError extends Error {
    readonly code?: number;
    constructor(message: string, code?: number);
}
export declare function packCompactMessage(options: CompactMessageProtocolOptions): Uint8Array;
export declare function packCompactPlainMessage(seqId: number, to: string, text: string): Uint8Array;
export declare function packCompactE2EEMessage(seqId: number, to: string, chunks: readonly Uint8Array[], msgType?: 5 | 6): Uint8Array;
export declare function decodeCompactMessageResponse(data: Uint8Array): CompactMessageResponse;
export declare function encodeCompactText(text: string): Uint8Array;
export declare function writeCompactI32(out: number[], value: number): void;
export declare function writeCompactI64(out: number[], value: bigint): void;
