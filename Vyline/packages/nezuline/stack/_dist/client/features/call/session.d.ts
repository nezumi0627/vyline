import type { Client } from "../../mod.ts";
import type * as LINETypes from "@vyline/line-types";
import type { AudioSink, AudioSource, CodecFactory, PcmFrame } from "./audio.js";
import { TypedEventEmitter } from "../../../base/core/typed-event-emitter/index.js";
export type CallSessionState = "idle" | "acquiring" | "connecting" | "ringing" | "in-call" | "ending" | "ended" | "failed";
export type CallKind = "AUDIO" | "VIDEO" | "FACEPLAY";
export interface CallSessionOpts {
    to: string;
    kind?: CallKind;
    fromEnvInfo?: Record<string, string>;
    codecs?: CodecFactory;
    transport?: CallTransport;
    /** transport 選択のため事前 acquire した route（二重 acquire 回避） */
    preacquiredRoute?: LINETypes.CallRoute;
}
export interface CallTransport {
    connect(opts: {
        route: LINETypes.CallRoute;
    }): Promise<void>;
    close(): Promise<void>;
    send(packet: Uint8Array): void | Promise<void>;
    receive(): AsyncIterable<Uint8Array>;
    /** Optional. When present, CallSession.start() drives the full
     *  signaling dialog after connect() (SIP INVITE → 200 → ACK). */
    invite?(opts: {
        to: string;
    }): Promise<unknown>;
    /** Optional. PLANET-style transports may enter ringing after INVITE and
     *  only become media-ready after the peer sends CONN_REQ. */
    waitForAnswer?(opts?: {
        to: string;
    }): Promise<unknown>;
}
export declare const stubTransport: CallTransport;
export type CallSessionEvents = {
    state: (newState: CallSessionState, prev: CallSessionState) => void;
    connected: (route: LINETypes.CallRoute) => void;
    ended: (reason: string) => void;
    error: (err: Error) => void;
};
export declare class CallSession extends TypedEventEmitter<CallSessionEvents> {
    #private;
    constructor(client: Client, opts: CallSessionOpts);
    get state(): CallSessionState;
    get route(): LINETypes.CallRoute | undefined;
    get peer(): string;
    get kind(): CallKind;
    start(): Promise<LINETypes.CallRoute>;
    sendStream(source: AudioSource, opts?: {
        signal?: AbortSignal;
    }): Promise<void>;
    sendBuffer(opts: {
        samples: Int16Array;
        sampleRate: number;
        channels?: number;
    }): Promise<void>;
    sendFile(opts: {
        bytes: Uint8Array;
        decode: (b: Uint8Array) => Promise<{
            samples: Int16Array;
            sampleRate: number;
            channels: number;
        }> | {
            samples: Int16Array;
            sampleRate: number;
            channels: number;
        };
    }): Promise<void>;
    receiveInto(sink: AudioSink): Promise<void>;
    received(): AsyncGenerator<PcmFrame>;
    end(reason?: string): Promise<void>;
}
