/**
 * Cassini / PLANET protobuf schema.
 *
 * Reverse-engineered from libandromeda's protobuf-c descriptor objects
 * in .data.rel.ro. Every field tag/type/offset here is byte-verified
 * against the live `pln_msg_pack` hook capture.
 *
 * Layered wire format (outermost to innermost):
 *
 *   planet_msg              { hdr + oneof(sc_msg / cc_msg / mc_msg) }
 *     planet_msg_hdr        7-field call session header
 *
 *     planet_cc_msg         { hdr + body }            (when cc_msg field set)
 *       planet_cc_hdr       { cid, src_chan_id, dst_chan_id }
 *       cc_msg              oneof of 63 cc message types
 *         cc_setup_req      32-field call SETUP
 *         cc_setup_rsp      …
 *         cc_verify_req     …
 *         cc_rel_req        …
 *         (and so on)
 */
export declare const enum WireType {
    Varint = 0,
    Fixed64 = 1,
    LengthDelim = 2,
    Fixed32 = 5
}
export declare function encodeVarint(v: bigint | number): Uint8Array;
export declare function decodeVarint(buf: Uint8Array, off: number): [bigint, number];
export interface PlanetMsgHdr {
    userId: string;
    msgId: number;
    sessId: Uint8Array;
    tranId: Uint8Array;
    tranSeq: number;
    locNonce: bigint;
    rmtNonce: bigint;
}
export declare function packPlanetMsgHdr(h: PlanetMsgHdr): Uint8Array;
export interface PlanetCcHdr {
    cid: string;
    srcChanId: bigint;
    dstChanId: bigint;
}
export declare function packPlanetCcHdr(h: PlanetCcHdr): Uint8Array;
export interface PlanetUserAgent {
    osName: string;
    osVersion: string;
    deviceName: string;
    mccMnc?: string;
    appVersion?: string;
    engineVersion?: string;
    appReleaseInfo?: string;
    manufacturer?: string;
    kitWrapperVersion?: string;
}
export declare function packPlanetUserAgent(ua: PlanetUserAgent): Uint8Array;
export declare function packPlanetFeatureRegister(feature: number, enabled: boolean, state?: number): Uint8Array;
export interface PlanetSetupOfferMaterial {
    /** 33-byte compressed P-256 public key used by the media key offer. */
    mediaPubKey: Uint8Array;
    /** 32-bit random/session identifier observed in the media key offer. */
    mediaKeyId: number;
    /** 16-byte random nonce in the first security offer. */
    mediaNonce: Uint8Array;
    /** 30-byte random secret/blob in the second security offer. */
    mediaSecret: Uint8Array;
}
/** Pack the native 1:1 SETUP offer shape observed in LINE Android 26.6.2.
 *
 * The offer is carried as `cc_setup_req.offer` and is not the string
 * `"AUDIO"`. It advertises audio, video, and data channels plus two security
 * blobs. Dynamic cryptographic material is supplied by the caller so tests can
 * be deterministic.
 */
export declare function packNativeSetupOffer(material: PlanetSetupOfferMaterial): Uint8Array;
export interface PlanetGroupParticipateOfferMaterial {
    /** 30-byte random secret/blob used by the group media key offer. */
    mediaSecret: Uint8Array;
}
/** Pack the native group-call participate offer shape observed in LINE Android
 * 26.6.2. Group calls carry audio, disabled video, and data records, plus the
 * shared media secret. Unlike 1:1 SETUP, the captured group offer does not
 * include a per-offer media public key/key-id/nonce block.
 */
export declare function packNativeGroupParticipateOffer(material: PlanetGroupParticipateOfferMaterial): Uint8Array;
export declare const CC_MSG: {
    readonly SETUP_REQ: 1;
    readonly SETUP_RSP: 2;
    readonly VERIFY_REQ: 3;
    readonly VERIFY_RSP: 4;
    readonly CONN_REQ: 5;
    readonly CONN_RSP: 6;
    readonly REL_REQ: 7;
    readonly REL_RSP: 8;
    readonly HO_REQ: 9;
    readonly HO_RSP: 10;
    readonly SO_REQ: 11;
    readonly SO_RSP: 12;
    readonly MCP_REQ: 13;
    readonly MCP_RSP: 14;
    readonly UPD_REQ: 15;
    readonly UPD_RSP: 16;
    readonly INFO_REQ: 17;
    readonly INFO_RSP: 18;
    readonly CPG_RPT: 19;
    readonly REL_RPT: 20;
    readonly CREL_RPT: 21;
    readonly ALIVE_RPT: 22;
    readonly SO_RPT: 23;
    readonly SOMSD_RPT: 24;
    readonly UNAVAIL_REQ: 25;
    readonly UNAVAIL_RSP: 26;
    readonly BIG_DATA_REQ: 27;
    readonly BIG_DATA_RSP: 28;
    readonly UNAVAIL_RPT: 29;
    readonly PARTICIPATE_REQ: 51;
    readonly PARTICIPATE_RSP: 52;
    readonly PULL_REQ: 53;
    readonly PULL_RSP: 54;
    readonly PUSH_REQ: 55;
    readonly PUSH_RSP: 56;
    readonly CONRX_REQ: 57;
    readonly CONRX_RSP: 58;
    readonly CSO_REQ: 59;
    readonly CSO_RSP: 60;
    readonly MSCHG_REQ: 61;
    readonly MSCHG_RSP: 62;
    readonly DTASS_REQ: 63;
    readonly DTASS_RSP: 64;
    readonly SUBSCRIBE_REQ: 65;
    readonly SUBSCRIBE_RSP: 66;
    readonly SUBPUSH_REQ: 67;
    readonly SUBPUSH_RSP: 68;
    readonly CTUNNEL_REQ: 69;
    readonly CTUNNEL_RSP: 70;
    readonly CRTE_MIX_REQ: 71;
    readonly CRTE_MIX_RSP: 72;
    readonly CTRL_MIX_REQ: 73;
    readonly CTRL_MIX_RSP: 74;
    readonly NOTIFY_MIX_REQ: 75;
    readonly NOTIFY_MIX_RSP: 76;
    readonly SUBALIVE_REQ: 77;
    readonly SUBALIVE_RSP: 78;
    readonly SET_SPEAKER_REQ: 79;
    readonly SET_SPEAKER_RSP: 80;
    readonly CLOC_REQ: 81;
    readonly CLOC_RSP: 82;
    readonly USER_STATUS_REQ: 83;
    readonly USER_STATUS_RSP: 84;
};
export declare const CC_MSG_NAMES: Record<number, string>;
export interface CcSetupReq {
    initiator: string;
    responder: string;
    iZone?: string;
    rZone?: string;
    ua?: Uint8Array;
    devId?: string;
    commTypeFlags?: number;
    capas?: number[];
    offer?: Uint8Array;
    credential?: Uint8Array;
    fakeCall?: boolean;
    svcKey?: string;
    crt?: boolean;
    netType?: number;
    stid?: string;
    ccp?: string;
    ueData?: Uint8Array;
    ueDataCompType?: number;
    features?: Uint8Array[];
    svcId?: string;
    tgtSvcId?: string;
    reqRec?: boolean;
    appSvrDataId?: string;
    uePublicAddr?: Uint8Array;
    iVisitedZone?: string;
    rToken?: string;
    iMercuryIp?: string;
    pathCheck?: boolean;
    iMercuryIpv6?: string;
    rGcallZone?: string;
    interDomain?: boolean;
    appSvrData?: string;
}
export declare function packCcSetupReq(r: CcSetupReq): Uint8Array;
export interface CcParticipateReq {
    participant: string;
    roomId: string;
    pZone?: string;
    xZone?: string;
    orionIp?: string;
    mixIp?: string;
    ua?: Uint8Array;
    devId?: string;
    commTypeFlags?: number;
    capas?: number[];
    offer?: Uint8Array;
    credential?: Uint8Array;
    svcKey?: string;
    netType?: number;
    mChanId?: bigint;
    crt?: boolean;
    mixPort?: number;
    features?: Uint8Array[];
    roomAttrs?: number[];
    recvRtp?: number;
    ccp?: string;
    maxChanCnt?: number;
    unavailToSec?: number;
    pdtpOndemandStreams?: Uint8Array[];
    disableConferenceInfo?: boolean;
    stid?: string;
    gsid?: string;
    gmsid?: string;
    speaker?: boolean;
    svcId?: string;
    tgtSvcId?: string;
    ueExtraInfo?: Uint8Array;
    appSvrDataId?: string;
    userExtraInfo?: Uint8Array;
    uePublicAddr?: Uint8Array;
    pathCheck?: boolean;
    pdtpTunnel?: boolean;
    interDomain?: boolean;
    ghost?: boolean;
    subsType?: number;
}
export declare function packCcParticipateReq(r: CcParticipateReq): Uint8Array;
export interface CcRelReq {
    relCode?: number;
    relPhrase?: string;
    releaser?: string;
    commMediaFlags?: number;
    userRelCode?: string;
    dataSvcs?: number[];
    lastKaTs?: bigint;
    roomDestroy?: boolean;
    devId?: string;
}
export declare function packCcRelReq(r: CcRelReq): Uint8Array;
export declare function decodeCcRelReq(bytes: Uint8Array): CcRelReq;
export interface PlanetMcHdr {
    cid: string;
    srcChanId: bigint;
    dstChanId: bigint;
}
export declare function packPlanetMcHdr(h: PlanetMcHdr): Uint8Array;
export interface McDataReq {
    srcType?: number;
    dstType?: number;
    dispatchId: number;
    data: Uint8Array;
}
export declare function packMcDataReq(r: McDataReq): Uint8Array;
export declare function decodeMcDataReq(bytes: Uint8Array): McDataReq;
export interface McDataRsp {
    result?: number;
    relCode?: number;
    relPhrase?: string;
    dispatchId?: number;
    data?: Uint8Array;
}
export declare function packMcDataRsp(r: McDataRsp): Uint8Array;
export declare function decodeMcDataRsp(bytes: Uint8Array): McDataRsp;
export interface PlanetUeInfo {
    userId?: string;
    svcId?: string;
}
export declare function packPlanetUeInfo(info: PlanetUeInfo): Uint8Array;
export declare function wrapMcMsg(oneofTag: number, packedInner: Uint8Array): Uint8Array;
export declare function packPlanetMcMsg(hdr: PlanetMcHdr, body: Uint8Array): Uint8Array;
export declare const MC_MSG: {
    readonly OPEN_REQ: 1;
    readonly OPEN_RSP: 2;
    readonly CLOSE_RPT: 3;
    readonly BRIDGE_REQ: 5;
    readonly BRIDGE_RSP: 6;
    readonly REOPEN_REQ: 7;
    readonly REOPEN_RSP: 8;
    readonly JOIN_REQ: 9;
    readonly JOIN_RSP: 10;
    readonly CHANGE_REQ: 11;
    readonly CHANGE_RSP: 12;
    readonly CHECK_RPT: 13;
    readonly P2P_REQ: 14;
    readonly P2P_RSP: 15;
    readonly DATA_REQ: 16;
    readonly DATA_RSP: 17;
    readonly DATA_RPT: 18;
    readonly SOPEN_REQ: 19;
    readonly SOPEN_RSP: 20;
    readonly MOPEN_REQ: 51;
    readonly MOPEN_RSP: 52;
    readonly MCLOSE_REQ: 53;
    readonly MCLOSE_RSP: 54;
    readonly STRM_REQ: 55;
    readonly STRM_RSP: 56;
    readonly RESET_REQ: 57;
    readonly RESET_RSP: 58;
    readonly NOTIFY_STRM_REQ: 59;
    readonly NOTIFY_STRM_RSP: 60;
    readonly CH_CHG_REQ: 61;
    readonly CH_CHG_RSP: 62;
    readonly OTO_STRM_REQ: 63;
    readonly OTO_STRM_RSP: 64;
};
export declare const MC_MSG_NAMES: Record<number, string>;
export interface MinMaxAttr {
    min?: number;
    max?: number;
    target?: number;
}
export interface StrmState {
    paused?: boolean;
    code?: number;
}
export interface RetxRxAttr {
    periOn?: boolean;
    periIntvMs?: number;
    periLossThre?: number[];
}
export interface RetxTxAttr {
    reqdOn?: boolean;
    reqdRttThre?: number;
}
export interface StrmAttr {
    ssrc: number;
    bitrate?: MinMaxAttr;
    state?: StrmState;
    disableDtx?: boolean;
    ptime?: number;
    retx?: RetxRxAttr;
    fecLossThre?: number[];
}
export interface TxStrmAttr {
    ssrc: number;
    state?: StrmState;
    retx?: RetxTxAttr;
}
export interface LinkAttr {
    bwInitKbps?: number;
    bwMaxKbps?: number;
    probeRate?: number;
    probeBrMaxKbps?: number;
}
export interface StrmSpec {
    strms: StrmAttr[];
    fbIntv?: number;
    tp?: number;
    fecBypass?: boolean;
    fbOn?: boolean;
    txStrms?: TxStrmAttr[];
    link?: LinkAttr;
}
export declare function packStrmSpec(r: StrmSpec): Uint8Array;
export declare function packMcDataSessionPayload(body: Uint8Array): Uint8Array;
export interface McSessionRsp {
    result?: number;
    relCode?: number;
    relPhrase?: string;
    data?: Uint8Array;
}
export declare function packMcJoinRsp(r: McSessionRsp): Uint8Array;
export declare function packMcChangeRsp(r: McSessionRsp): Uint8Array;
export declare function packMcCheckRpt(strmSpec: Uint8Array): Uint8Array;
export declare function packBepiChannelOpen(token: bigint): Uint8Array;
export declare function wrapCcMsg(oneofTag: number, packedInner: Uint8Array): Uint8Array;
export declare function packPlanetCcMsg(hdr: PlanetCcHdr, body: Uint8Array): Uint8Array;
export type PlanetMsgBody = {
    kind: "sc";
    data: Uint8Array;
} | {
    kind: "cc";
    data: Uint8Array;
} | {
    kind: "mc";
    data: Uint8Array;
};
export declare function packPlanetMsg(hdr: PlanetMsgHdr, body: PlanetMsgBody): Uint8Array;
export declare function packKeepaliveReq(ts: bigint, isP2p?: boolean): Uint8Array;
export declare function packPlanetScMsgKaReq(inner: Uint8Array): Uint8Array;
/** Extract the loc_nonce (field 6) from a decrypted incoming planet_msg.
 *  This value MUST be used as `rmt_nonce` on all subsequent outgoing msgs
 *  in the same session (echoed back to cscf so it can verify continuity).
 *
 *  Reverse-engineered from libandromeda 0xcaa4f0..0xcaa524:
 *    bl pln_msg_get_local_nonce  // sp+0x10 = msg.loc_nonce (field 6)
 *    str x8, [sess, #0xa0]       // session.rmt_nonce = that value
 */
export declare function extractRmtNonceFromReply(replyHdrBytes: Uint8Array): bigint;
export interface DecodedField {
    tag: number;
    wireType: WireType;
    value: bigint | Uint8Array;
}
export declare function decodeFields(buf: Uint8Array): DecodedField[];
export interface DecodedPlanetMsgHdr {
    userId?: string;
    msgId?: number;
    sessId?: Uint8Array;
    tranId?: Uint8Array;
    tranSeq?: number;
    locNonce?: bigint;
    rmtNonce?: bigint;
}
export declare function decodePlanetMsgHdr(bytes: Uint8Array): DecodedPlanetMsgHdr;
export interface DecodedPlanetCcHdr {
    cid?: string;
    srcChanId?: bigint;
    dstChanId?: bigint;
}
export interface DecodedPlanetCcMsg {
    hdr?: DecodedPlanetCcHdr;
    bodyTag?: number;
    bodyName?: string;
    bodyBytes?: Uint8Array;
}
export interface DecodedPlanetMcMsg {
    hdr?: DecodedPlanetCcHdr;
    bodyTag?: number;
    bodyName?: string;
    bodyBytes?: Uint8Array;
}
export interface DecodedPlanetMsg {
    hdr?: DecodedPlanetMsgHdr;
    scBytes?: Uint8Array;
    cc?: DecodedPlanetCcMsg;
    mcBytes?: Uint8Array;
    mc?: DecodedPlanetMcMsg;
}
export declare function decodePlanetCcMsg(bytes: Uint8Array): DecodedPlanetCcMsg;
export declare function decodePlanetMcMsg(bytes: Uint8Array): DecodedPlanetMcMsg;
export declare function decodePlanetMsg(bytes: Uint8Array): DecodedPlanetMsg;
export interface PlanetAddr {
    ver?: number;
    trpt?: number;
    ip?: string;
    ports?: string;
    port?: number;
}
export declare function decodePlanetAddr(bytes: Uint8Array): PlanetAddr;
export interface CcSetupRsp {
    result?: number;
    relCode?: number;
    relPhrase?: string;
    cfgs?: string;
    releaser?: string;
    compCfgs?: Uint8Array;
    compCfgsType?: number;
    aliveRptInterval?: number;
    stops?: string;
    pt?: boolean;
    noAnsToSec?: number;
    maxDurSec?: number;
    ptt?: boolean;
    svcId?: string;
    tgtSvcId?: string;
    interDomain?: boolean;
    maxCallTimeSec?: number;
}
export declare function packCcSetupRsp(r: CcSetupRsp): Uint8Array;
export declare function decodeCcSetupRsp(bytes: Uint8Array): CcSetupRsp;
export interface CcParticipateRsp {
    result?: number;
    relCode?: number;
    relPhrase?: string;
    releaser?: string;
    cfgs?: string;
    answer?: Uint8Array;
    mChanId?: bigint;
    contentsType?: number;
    contents?: Uint8Array;
    compCfgs?: Uint8Array;
    compCfgsType?: number;
    compContentsType?: number;
    role?: string;
    joinTs?: bigint;
    bridgeInfo?: Uint8Array;
    aliveRptInterval?: number;
    stops?: string;
    msgCreator?: number;
    ptt?: boolean;
    svcId?: string;
    tgtSvcId?: string;
    interDomain?: boolean;
    maxCallTimeSec?: number;
}
export declare function decodeCcParticipateRsp(bytes: Uint8Array): CcParticipateRsp;
export interface CcConnReq {
    answer?: Uint8Array;
    mChanId?: bigint;
    netType?: number;
    unavailToSec?: number;
    oCapas: number[];
    ueData?: Uint8Array;
    ueDataCompType?: number;
    features: Uint8Array[];
    ua?: Uint8Array;
    rCountry?: string;
    reqRec?: boolean;
    mAddr?: PlanetAddr;
    devId?: string;
    uePublicAddr?: PlanetAddr;
    offer?: Uint8Array;
    svcId?: string;
    tgtSvcId?: string;
    interDomain?: boolean;
    pt?: boolean;
}
export declare function packPlanetAddr(addr: PlanetAddr): Uint8Array;
export declare function packCcConnReq(r: CcConnReq): Uint8Array;
export declare function decodeCcConnReq(bytes: Uint8Array): CcConnReq;
export interface CcConnRsp {
    result?: number;
    relCode?: number;
    relPhrase?: string;
    mChanId?: bigint;
    netType?: number;
    unavailToSec?: number;
    ua?: Uint8Array;
    mAddr?: PlanetAddr;
    uePublicAddr?: PlanetAddr;
    svcId?: string;
    tgtSvcId?: string;
    interDomain?: boolean;
}
export declare function packCcConnRsp(r: CcConnRsp): Uint8Array;
export declare function decodeCcConnRsp(bytes: Uint8Array): CcConnRsp;
export interface CcInfoReq {
    bodyType?: string;
    body?: Uint8Array;
    targets: string[];
    source?: string;
    sourceSvcId?: string;
    tgtUe: Uint8Array[];
    trxOrigin?: string;
    svcId?: string;
    tgtSvcId?: string;
    interDomain?: boolean;
}
export declare function packCcInfoReq(r: CcInfoReq): Uint8Array;
export declare function decodeCcInfoReq(bytes: Uint8Array): CcInfoReq;
export interface CcInfoRsp {
    result?: number;
    relCode?: number;
    relPhrase?: string;
    bodyType?: string;
    body?: Uint8Array;
    svcId?: string;
    tgtSvcId?: string;
    interDomain?: boolean;
}
export declare function packCcInfoRsp(r: CcInfoRsp): Uint8Array;
export declare function decodeCcInfoRsp(bytes: Uint8Array): CcInfoRsp;
export interface NativeSetupMediaRecord {
    name?: string;
    enabled?: number;
    bitrate?: number;
    kind?: number;
    rtpId?: number;
    rtpPort?: number;
    rtcpId?: number;
    raw: Uint8Array;
}
export interface NativeSetupOffer {
    media: NativeSetupMediaRecord[];
    mediaPubKey?: Uint8Array;
    mediaKeyId?: number;
    mediaNonce?: Uint8Array;
    mediaSecret?: Uint8Array;
    version?: {
        major?: number;
        mode?: number;
    };
}
export declare function decodeNativeSetupOffer(bytes: Uint8Array): NativeSetupOffer;
