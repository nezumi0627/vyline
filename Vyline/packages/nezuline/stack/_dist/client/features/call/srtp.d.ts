export declare const SRTP_KEYING_LEN: number;
export interface SrtpCryptoContext {
    cipherKey: Uint8Array;
    cipherSalt: Uint8Array;
    authKey: Uint8Array;
    rocs: Map<number, number>;
}
/** Derive SRTP session keys from the 30-byte SDES master keying material. */
export declare function deriveSrtpContext(masterKeying: Uint8Array): Promise<SrtpCryptoContext>;
/** Encrypt an RTP packet in place + append the 80-bit auth tag. */
export declare function srtpEncrypt(ctx: SrtpCryptoContext, rtpPacket: Uint8Array): Promise<Uint8Array>;
/** Verify the auth tag + decrypt an SRTP packet. */
export declare function srtpDecrypt(ctx: SrtpCryptoContext, srtpPacket: Uint8Array): Promise<Uint8Array>;
/** Build a minimal RTP packet (v=2, no extensions, no padding). */
export declare function buildRtp(opts: {
    payloadType: number;
    seq: number;
    timestamp: number;
    ssrc: number;
    payload: Uint8Array;
    marker?: boolean;
    extensionProfile?: number;
    extensionData?: Uint8Array;
}): Uint8Array;
export declare function parseRtp(pkt: Uint8Array): {
    payloadType: number;
    seq: number;
    timestamp: number;
    ssrc: number;
    marker: boolean;
    payload: Uint8Array;
};
