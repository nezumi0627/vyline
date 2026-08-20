import type { Client } from "../../mod.ts";
import type * as LINETypes from "@vyline/line-types";
import type { DeviceDetails } from "../../../base/mod.ts";
import type { CodecFactory } from "./audio.js";
import { CallSession, type CallSessionOpts } from "./session.js";
export type { CallSession, CallSessionEvents, CallSessionOpts, CallSessionState, CallTransport, } from "./session.js";
export { type AudioDecoder, type AudioEncoder, type AudioSink, type AudioSource, bufferSink, bufferSource, type CodecFactory, decodeWavSync, defaultCodecFactory, type FileDecoder, type NativeGroupOpusPacketizeOptions, packetizeNativeGroupOpusPairs, type PcmFrame, resampleLinear, streamSink, streamSource, } from "./audio.js";
export { stubTransport } from "./session.js";
export { AndromedaTransport, type AndromedaTransportOpts } from "./andromeda.js";
export { buildExchangeAppStrData as planetBuildExchangeAppStrData, buildFrameHeader as planetBuildFrameHeader, buildRelReq as planetBuildRelReq, buildSetupReq as planetBuildSetupReq, type CassiniBody, type CassiniEnvelope, type CassiniHeader, decodeMpKey as planetDecodeMpKey, decodeNativeSetupOffer as planetDecodeNativeSetupOffer, decodePlanetMsg as planetDecodePlanetMsg, deriveCallKeys as planetDeriveCallKeys, type EphemeralKeypair, generateEphemeralKeypair as planetGenerateEphemeralKeypair, makeChunkHdr as planetMakeChunkHdr, packCassini, parseChunkHdr as planetParseChunkHdr, parseFrameHeader as planetParseFrameHeader, type PlanetAnswerResult, type PlanetFixedHdr, type PlanetInviteResult, type PlanetLocalMediaOffer, PlanetTransport, type PlanetTransportOpts, type TransportKeys, unpackCassini, } from "./planet/mod.js";
export { opusCodecFactory } from "./opus.js";
export { buildRtcpBye, buildRtcpCompound, nowNtp as rtcpNowNtp, type ParsedRtcp, parseRtcp, type ReportBlock, type SenderInfo, } from "./rtcp.js";
export { buildBindingRequestAsync, parseStun, readMappedAddress, type StunMessage, } from "./stun.js";
export { DEFAULT_STUN_HOSTS, formatCandidate, gatherHost, gatherIceCandidates, gatherSrflx, type IceCandidate, type IceCandidateType, icePriority, parseCandidate, } from "./ice.js";
export { buildAudioOffer, buildAudioOfferMikey, buildSdp, cryptoAttr, keyMgmtMikeyAttr, parseSdp, readCrypto, readKeyMgmt, readRtpmap, type SdpMedia, type SdpSession, } from "./sdp.js";
export { buildMikeyPke, mikeyFromBase64, type MikeyParsed, type MikeyPkeOpts, mikeyToBase64, parseMikey, } from "./mikey.js";
export { buildRtp, deriveSrtpContext, parseRtp, SRTP_KEYING_LEN, type SrtpCryptoContext, srtpDecrypt, srtpEncrypt, } from "./srtp.js";
export { buildSip, digestResponse, getStatusCode, newBranch, parseDigestChallenge, parseSip, randomCallId, type SipMessage, } from "./sip.js";
export type CallType = "AUDIO" | "VIDEO" | "FACEPLAY";
export declare function defaultCallFromEnvInfo(deviceDetails: DeviceDetails): Record<string, string>;
export interface CallClient {
    acquireRoute(opts: {
        to: string;
        callType?: CallType;
        fromEnvInfo?: Record<string, string>;
    }): Promise<LINETypes.CallRoute>;
    acquireGroupRoute(...args: Parameters<import("../../../base/service/call/mod.ts").CallService["acquireGroupCallRoute"]>): ReturnType<import("../../../base/service/call/mod.ts").CallService["acquireGroupCallRoute"]>;
    acquireOARoute(...args: Parameters<import("../../../base/service/call/mod.ts").CallService["acquireOACallRoute"]>): ReturnType<import("../../../base/service/call/mod.ts").CallService["acquireOACallRoute"]>;
    getGroupCall(chatMid: string): Promise<LINETypes.GroupCall>;
    createGroupCallUrl(...args: Parameters<import("../../../base/service/call/mod.ts").CallService["createGroupCallUrl"]>): ReturnType<import("../../../base/service/call/mod.ts").CallService["createGroupCallUrl"]>;
    getGroupCallUrl(ticket: string): ReturnType<import("../../../base/service/call/mod.ts").CallService["getGroupCallUrlInfo"]>;
    listGroupCallUrls(): ReturnType<import("../../../base/service/call/mod.ts").CallService["getGroupCallUrls"]>;
    updateGroupCallUrl(...args: Parameters<import("../../../base/service/call/mod.ts").CallService["updateGroupCallUrl"]>): ReturnType<import("../../../base/service/call/mod.ts").CallService["updateGroupCallUrl"]>;
    deleteGroupCallUrl(...args: Parameters<import("../../../base/service/call/mod.ts").CallService["deleteGroupCallUrl"]>): ReturnType<import("../../../base/service/call/mod.ts").CallService["deleteGroupCallUrl"]>;
    joinChatByUrl(ticket: string): Promise<unknown>;
    invite(...args: Parameters<import("../../../base/service/call/mod.ts").CallService["inviteIntoGroupCall"]>): ReturnType<import("../../../base/service/call/mod.ts").CallService["inviteIntoGroupCall"]>;
    kick(...args: Parameters<import("../../../base/service/call/mod.ts").CallService["kickoutFromGroupCall"]>): ReturnType<import("../../../base/service/call/mod.ts").CallService["kickoutFromGroupCall"]>;
    readonly service: import("../../../base/service/call/mod.ts").CallService;
    startSession(opts: CallSessionOpts): CallSession;
    setCodecFactory(factory: CodecFactory): void;
}
export declare function createCallClient(client: Client): CallClient;
export interface IncomingCallEvent {
    callMid: string;
    from: string;
    kind?: string;
    raw: LINETypes.Operation;
}
export interface CancelCallEvent {
    callMid: string;
    from: string;
    reason?: string;
    raw: LINETypes.Operation;
}
export declare function parseIncomingCall(op: LINETypes.Operation): IncomingCallEvent;
export declare function parseCancelCall(op: LINETypes.Operation): CancelCallEvent;
