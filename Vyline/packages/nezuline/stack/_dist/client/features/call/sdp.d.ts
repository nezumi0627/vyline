export interface SdpSession {
    v?: string;
    o?: string;
    s?: string;
    c?: string;
    t?: string;
    attrs: string[];
    media: SdpMedia[];
}
export interface SdpMedia {
    type: string;
    port: number;
    proto: string;
    formats: string[];
    c?: string;
    attrs: string[];
}
export declare function buildSdp(s: SdpSession): string;
export declare function parseSdp(text: string): SdpSession;
/** Pull `a=rtpmap:<pt> name/rate[/channels]` entries off an SdpMedia. */
export declare function readRtpmap(m: SdpMedia): {
    pt: number;
    name: string;
    rate: number;
    channels?: number;
}[];
/** Pull `a=crypto:N <suite> inline:<key>[|...]` (RFC 4568). */
export declare function readCrypto(m: SdpMedia): {
    tag: number;
    suite: string;
    key: Uint8Array;
}[];
/** Build a `a=crypto:` line per RFC 4568. */
export declare function cryptoAttr(opts: {
    tag: number;
    suite: string;
    key: Uint8Array;
}): string;
/** Pull `a=key-mgmt:mikey <base64>` (RFC 4567). */
export declare function readKeyMgmt(m: SdpMedia): {
    proto: string;
    data: string;
} | null;
/** Build `a=key-mgmt:mikey <base64-message>` (RFC 4567). */
export declare function keyMgmtMikeyAttr(base64Message: string): string;
/** Build a LINE-style audio SDP offer with MIKEY key management. */
export declare function buildAudioOfferMikey(opts: {
    host: string;
    port: number;
    opusPayloadType?: number;
    mikeyBase64: string;
    username?: string;
    sessionId?: number;
    sessionVer?: number;
}): string;
/** Build a LINE-style audio SDP offer: Opus on RTP/SAVP with crypto. */
export declare function buildAudioOffer(opts: {
    host: string;
    port: number;
    opusPayloadType?: number;
    crypto: {
        suite: string;
        key: Uint8Array;
    };
    username?: string;
    sessionId?: number;
    sessionVer?: number;
}): string;
