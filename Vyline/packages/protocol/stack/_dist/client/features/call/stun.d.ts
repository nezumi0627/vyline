declare const CLASS_SUCCESS = 256;
declare const ATTR_USERNAME = 6;
declare const ATTR_XOR_MAPPED_ADDR = 32;
declare const ATTR_USE_CANDIDATE = 37;
export interface StunMessage {
    type: number;
    method: number;
    class: number;
    transactionId: Uint8Array;
    attrs: Map<number, Uint8Array>;
}
export interface StunBindingResult {
    mappedAddress?: {
        family: 4 | 6;
        host: string;
        port: number;
    };
}
/** Build a STUN Binding Request. */
export declare function buildBindingRequest(opts: {
    transactionId?: Uint8Array;
    username?: string;
    password?: string;
    priority?: number;
    iceControlling?: bigint;
    iceControlled?: bigint;
    useCandidate?: boolean;
}): Uint8Array;
/** Parse a STUN message. */
export declare function parseStun(buf: Uint8Array): StunMessage;
/** Pull XOR-MAPPED-ADDRESS (or MAPPED-ADDRESS) out of a Binding Success. */
export declare function readMappedAddress(m: StunMessage): StunBindingResult["mappedAddress"] | undefined;
/** Async variant that doesn't require sync require(). */
export declare function buildBindingRequestAsync(opts: Parameters<typeof buildBindingRequest>[0]): Promise<Uint8Array>;
export { ATTR_USE_CANDIDATE, ATTR_USERNAME, ATTR_XOR_MAPPED_ADDR, CLASS_SUCCESS };
