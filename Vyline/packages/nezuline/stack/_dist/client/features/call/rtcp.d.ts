export interface SenderInfo {
    ntpSec: number;
    ntpFrac: number;
    rtpTimestamp: number;
    packetCount: number;
    octetCount: number;
}
export interface ReportBlock {
    ssrc: number;
    fractionLost: number;
    cumulativeLost: number;
    highestSeq: number;
    jitter: number;
    lastSr: number;
    delaySinceLastSr: number;
}
/** Build a compound RTCP packet: SR/RR + SDES. */
export declare function buildRtcpCompound(opts: {
    senderSsrc: number;
    sender?: SenderInfo;
    reports?: ReportBlock[];
    cname?: string;
    tool?: string;
}): Uint8Array;
export declare function buildRtcpBye(ssrc: number, reason?: string): Uint8Array;
export interface ParsedRtcp {
    packetType: number;
    count: number;
    senderSsrc?: number;
    senderInfo?: SenderInfo;
    reports: ReportBlock[];
    cname?: string;
    byeReason?: string;
}
export declare function parseRtcp(buf: Uint8Array): ParsedRtcp[];
/** NTP timestamp for SR (RFC 3550 §6.4). */
export declare function nowNtp(): {
    sec: number;
    frac: number;
};
