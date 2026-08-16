/**
 * PLANET Cassini message format — ground-truth revision.
 *
 * Live `pln_msg_pack` capture during a native LINE call shows the on-wire
 * format is **protobuf**. Captured hex bytes:
 *
 *   0a 60 0a 21 75 63 38 34 35 38 36 34 37 34 37 30 33 61 36 31 37 32
 *   65 39 64 30 35 31 65 61 62 62 63 62 36 32 37 10 81 22 1a 10 b0 c2
 *   a7 4c e7 cd 45 02 a0 fa 32 58 6d a9 0e 54 22 21 0f c4 ed 07 ...
 *
 * Decoded as protobuf:
 *
 *   field 1 (tag 0x0a, length-delimited, len=0x60):
 *     // nested header message
 *     field 1 (0x0a, len=0x21): user_id "u00000000000000000000000000000000"
 *     field 2 (0x10, varint):   msg_id   (varint 0x81 0x22 = 4353 ascending per call)
 *     field 3 (0x1a, len=0x10): uuid     (16-byte session UUID)
 *     field 4 (0x22, len=0x21): user_pub (33-byte SEC1 EC pubkey)
 *     field 5 (0x28, varint):   timestamp1
 *     field 6 (0x30, varint):   timestamp2
 *     field 7 (0x38, varint):   created_at_ms (Unix-ms timestamp)
 *
 *   field N+1 (0x6a, len=...): body payload — typically:
 *     field 1 (0x0a, len-delim): call_uuid "c5cd3923-5d89-45d6-a0bf-..."
 *     field N (0x12 or 0x22, len-delim): "exchange_app_str_data" (msg type name)
 *     field N (0x22, len-delim): JSON params  e.g. {"csv":1}
 *     field N (0x...):           device info  "Android..36..Pixel 6a"
 *
 * This file gives a clean protobuf encoder/decoder for these messages
 * plus typed builders for the SETUP / EXCHANGE / REL flows.
 */
/** Protobuf wire type tags. */
export declare const enum WireType {
    Varint = 0,
    Fixed64 = 1,
    LengthDelim = 2,
    Fixed32 = 5
}
/** Encode a protobuf varint. */
export declare function encodeVarint(n: number | bigint): Uint8Array;
/** Decode a protobuf varint. Returns [value, byte length]. */
export declare function decodeVarint(buf: Uint8Array, off: number): [bigint, number];
/** A single protobuf field. */
export interface PbField {
    tag: number;
    wireType: WireType;
    value: bigint | Uint8Array;
}
/** Encode a sequence of protobuf fields to wire bytes. */
export declare function encodePb(fields: PbField[]): Uint8Array;
/** Decode protobuf bytes into a list of fields (varint + length-delim only). */
export declare function decodePb(buf: Uint8Array): PbField[];
/** Cassini message envelope — the outer protobuf the libandromeda
 *  call control plane uses. Field tags match `pln_msg_pack` output. */
export interface CassiniEnvelope {
    header: CassiniHeader;
    body: Uint8Array;
}
export interface CassiniHeader {
    /** Owning user mid (Cassini "user_id"). */
    userId: string;
    /** Monotonic per-call sequence (the 0x1d5/0x1d6/... we observed). */
    msgId: number;
    /** 16-byte call UUID — constant for the call's lifetime. */
    callUuid16: Uint8Array;
    /** 16-byte per-message random / HMAC tag — varies per packet. */
    msgNonce: Uint8Array;
    /** Wire-observed counter (varint). Increments slowly. */
    counter: bigint;
    /** Subscription id (varint) — constant per call. */
    subscriptionId: bigint;
    /** Session id (varint) — constant per call, differs slightly by msg
     *  class (the upper bits encode a class indicator). */
    sessionId: bigint;
}
/** Envelope-body tag varies by message class. Observed values from a
 *  native LINE call: */
export declare const ENVELOPE_BODY_TAG: {
    readonly KA: 2;
    readonly CONTROL: 3;
    readonly STATE: 4;
};
export declare function packCassiniHeader(h: CassiniHeader): Uint8Array;
export declare function packCassini(env: CassiniEnvelope, bodyTag?: number): Uint8Array;
export declare function unpackCassini(wire: Uint8Array): CassiniEnvelope & {
    bodyTag: number;
};
/** Body payload — observed contents include:
 *  - call UUID string
 *  - message type name (e.g. "exchange_app_str_data")
 *  - JSON params (e.g. `{"csv":1}`)
 *  - device info
 */
export interface CassiniBody {
    callUuid?: string;
    msgTypeName?: string;
    jsonParams?: string;
    deviceInfo?: string;
    /** Additional protobuf fields that we don't yet have names for. */
    extra?: PbField[];
}
export declare function packCassiniBody(b: CassiniBody): Uint8Array;
export declare function unpackCassiniBody(wire: Uint8Array): CassiniBody;
/** Common per-call session parameters. The subscriptionId + sessionId
 *  values are observed-constant within a single call and need to be
 *  established by an initial bootstrap handshake (still under RE). */
export interface CassiniSession {
    fromMid: string;
    callUuid16: Uint8Array;
    callUuidString: string;
    subscriptionId: bigint;
    sessionId: bigint;
}
/** Build a Cassini SETUP envelope (state-class body, tag=4 on the wire). */
export declare function buildSetupReq(opts: {
    session: CassiniSession;
    msgId: number;
    counter: bigint;
    deviceInfo: string;
}): Uint8Array;
/** Build a Cassini "exchange_app_str_data" — used mid-call for app-level
 *  signaling (e.g. CSV capability flag). control-class body (tag=3). */
export declare function buildExchangeAppStrData(opts: {
    session: CassiniSession;
    msgId: number;
    counter: bigint;
    json: string;
}): Uint8Array;
/** Build a Cassini REL (release / BYE-equivalent). control-class body. */
export declare function buildRelReq(opts: {
    session: CassiniSession;
    msgId: number;
    counter: bigint;
    reason?: string;
}): Uint8Array;
