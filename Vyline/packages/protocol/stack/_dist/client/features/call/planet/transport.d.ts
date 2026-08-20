/**
 * PLANET transport — full state-machine implementation.
 *
 * Flow:
 *   1. acquireRoute (caller already did)
 *   2. connect(route): generate ephemeral keypair, derive session keys
 *      via 2-stage HKDF, open UDP socket to cscf
 *   3. invite(to): send SETUP_REQ (planet_msg with cc_msg.setup_req,
 *      rmt_nonce=0 since we don't yet know cscf's loc_nonce)
 *   4. First reply: decrypt, parse planet_msg_hdr,
 *      extract cscf's loc_nonce → use as session.rmtNonce going forward
 *      (libandromeda 0xcaa524: `str x8, [x19, #0xa0]`)
 *   5. Subsequent sends: include the captured rmt_nonce
 *   6. close(): send REL_REQ
 */
import type * as LINETypes from "@vyline/line-types";
import type { CallTransport } from "../session.ts";
import { type EphemeralKeypair } from "./crypto.js";
import { type CcConnReq, decodeCcParticipateRsp, decodeCcSetupRsp, decodePlanetMsg, type NativeSetupOffer, type PlanetSetupOfferMaterial, type PlanetUserAgent } from "./schema.js";
export interface PlanetTransportOpts {
    localMid: string;
    deviceInfo?: string;
    userAgent?: PlanetUserAgent;
    deviceId?: string;
    transportKeypair?: EphemeralKeypair;
    setupOffer?: Uint8Array;
    credential?: Uint8Array;
    serviceKey?: string;
    capabilities?: number[];
    features?: Uint8Array[];
    timeoutMs?: number;
    keepaliveIntervalMs?: number;
    mediaKeyMode?: PlanetMediaKeyMode;
    rtpTimestampStep?: number;
    preferIpv6?: boolean;
    groupDataSessionAfterProvisional?: boolean;
    wireSend?: (packet: Uint8Array, endpoint: {
        host: string;
        port: number;
        bootstrap: boolean;
        seq: number;
        plainLen: number;
        bodyLen: number;
        plaintext: Uint8Array;
    }) => Promise<Uint8Array | void> | Uint8Array | void;
    debug?: (event: Record<string, unknown>) => void;
}
export type PlanetMediaKeyMode = "current" | "reverse-stage" | "sender-material" | "sender-material-reverse-stage" | "audio-current" | "audio-reverse-stage" | "audio-sender-material" | "audio-sender-material-reverse-stage" | "secret-receiver" | "secret-sender" | "audio-secret-receiver" | "audio-secret-sender" | "auto";
export interface PlanetInviteResult {
    plaintext: Uint8Array;
    message: ReturnType<typeof decodePlanetMsg>;
    setupRsp?: ReturnType<typeof decodeCcSetupRsp>;
}
export interface PlanetIncomingMessage {
    plaintext: Uint8Array;
    message?: ReturnType<typeof decodePlanetMsg>;
}
export interface PlanetAnswerResult {
    plaintext: Uint8Array;
    message: ReturnType<typeof decodePlanetMsg>;
    connReq: CcConnReq;
    peerAnswerOffer?: NativeSetupOffer;
    peerOffer?: NativeSetupOffer;
    connRspSent: boolean;
    mediaReady: boolean;
}
export interface PlanetGroupJoinResult {
    plaintext: Uint8Array;
    message: ReturnType<typeof decodePlanetMsg>;
    participateRsp?: ReturnType<typeof decodeCcParticipateRsp>;
    peerAnswerOffer?: NativeSetupOffer;
    mediaReady: boolean;
}
export interface PlanetLocalMediaOffer {
    keypair: EphemeralKeypair;
    material: PlanetSetupOfferMaterial;
    offer: Uint8Array;
}
export declare class PlanetTransport implements CallTransport {
    #private;
    constructor(opts: PlanetTransportOpts);
    get localMediaOffer(): PlanetLocalMediaOffer | undefined;
    connect(opts: {
        route: LINETypes.CallRoute | LINETypes.GroupCallRoute;
    }): Promise<void>;
    inviteDetailed(opts: {
        to: string;
    }): Promise<PlanetInviteResult>;
    invite(opts: {
        to: string;
    }): Promise<Uint8Array>;
    joinGroupDetailed(opts: {
        roomId: string;
    }): Promise<PlanetGroupJoinResult>;
    joinGroup(opts: {
        roomId: string;
    }): Promise<Uint8Array>;
    waitForAnswerDetailed(opts?: {
        timeoutMs?: number;
        autoConnRsp?: boolean;
    }): Promise<PlanetAnswerResult>;
    waitForAnswer(_opts?: {
        to: string;
    }): Promise<PlanetAnswerResult>;
    close(): Promise<void>;
    send(opusPacket: Uint8Array, opts?: {
        timestampStep?: number;
    }): Promise<void>;
    receive(): AsyncIterable<Uint8Array>;
}
