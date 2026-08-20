import type * as LINETypes from "@vyline/line-types";
import type { CallTransport } from "./session.ts";
export interface AndromedaTransportOpts {
    localMid: string;
    userAgent?: string;
    timeoutMs?: number;
}
export declare class AndromedaTransport implements CallTransport {
    #private;
    constructor(opts: AndromedaTransportOpts);
    connect(opts: {
        route: LINETypes.CallRoute;
    }): Promise<void>;
    close(): Promise<void>;
    /** Send SIP BYE to terminate an established dialog. Best-effort. */
    bye(): Promise<void>;
    /**
     * Wait for an incoming INVITE on the registered transport, answer
     * with 100 Trying → 180 Ringing → 200 OK + SDP answer, then ACK.
     * Sets up SRTP contexts the same way `invite()` does.
     */
    answer(opts?: {
        localHost?: string;
        localPort?: number;
        decryptKey?: Uint8Array;
        ringMs?: number;
    }): Promise<{
        remoteKey: Uint8Array;
        mix: {
            host: string;
            port: number;
        };
    }>;
    /** Send SIP OPTIONS as a keep-alive ping to the cscf. */
    optionsPing(): Promise<void>;
    send(opusPacket: Uint8Array): Promise<void>;
    receive(): AsyncIterable<Uint8Array>;
    /** REGISTER against cscf. Returns final SIP status (200 = registered). */
    register(): Promise<number>;
    /**
     * INVITE the peer via cscf. Returns the SDP answer from the 200 OK,
     * and configures the SRTP send/receive contexts for media exchange.
     * When `stnpk` is set on the route, the SDP offer uses MIKEY-PKE
     * (LINE's actual wire format) instead of SDES `a=crypto:`.
     */
    invite(opts: {
        to: string;
        localHost?: string;
        localPort?: number;
        /** Optional RSA private key (SPKI/PKCS8) used to decrypt a MIKEY
         *  answer from the peer. Required to fully complete a MIKEY-PKE
         *  call; without it the answer's KEMAC is opaque. */
        decryptKey?: Uint8Array;
    }): Promise<{
        status: number;
        remoteKey: Uint8Array;
        mix: {
            host: string;
            port: number;
        };
    }>;
}
