export declare const MIKEY_VERSION = 1;
export declare const DATA_TYPE_PKE_INIT = 2;
/** PRF function values. */
export declare const PRF_MIKEY_1 = 0;
export interface MikeyPkeOpts {
    /** The peer's STNPK (RSA public key in DER/SPKI form). 256 bytes ≈ RSA-2048. */
    peerPublicKey: Uint8Array;
    /** 30-byte SRTP master keying material (16-byte key + 14-byte salt). */
    tgk: Uint8Array;
    /** Initiator (caller) identity. e.g. "u<mid>". */
    initiatorId?: string;
    /** Responder identity. */
    responderId?: string;
    /** CSB (Crypto Session Bundle) ID. Random 32-bit. */
    csbId?: number;
    /** Override the 16-byte envelope key (testing). */
    envelopeKey?: Uint8Array;
    /** Override the 16-byte RAND (testing). */
    rand?: Uint8Array;
    /** Override the NTP timestamp (testing). */
    ntpTimestamp?: bigint;
}
/** Build a complete MIKEY-PKE I_MESSAGE as a Uint8Array. */
export declare function buildMikeyPke(opts: MikeyPkeOpts): Promise<Uint8Array>;
export declare function mikeyToBase64(msg: Uint8Array): string;
export declare function mikeyFromBase64(s: string): Uint8Array;
export interface MikeyParsed {
    version: number;
    dataType: number;
    csbId: number;
    rand?: Uint8Array;
    ntpTimestamp?: bigint;
    pkeBody?: Uint8Array;
    kemacEncrypted?: Uint8Array;
}
export declare function parseMikey(buf: Uint8Array): MikeyParsed;
