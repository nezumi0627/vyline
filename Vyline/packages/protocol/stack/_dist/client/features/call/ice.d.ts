import dgram from "node:dgram";
export type IceCandidateType = "host" | "srflx" | "prflx" | "relay";
export interface IceCandidate {
    foundation: string;
    componentId: number;
    transport: "udp";
    priority: number;
    address: string;
    port: number;
    type: IceCandidateType;
    relatedAddress?: string;
    relatedPort?: number;
}
/** Compute the standard ICE priority for a candidate. */
export declare function icePriority(type: IceCandidateType, componentId: number, localPref?: number): number;
/** Format a candidate as the `candidate:` line value (the bit after `a=`). */
export declare function formatCandidate(c: IceCandidate): string;
export declare function parseCandidate(value: string): IceCandidate | null;
/** Gather a host candidate for the local UDP socket. */
export declare function gatherHost(sock: dgram.Socket): Promise<IceCandidate>;
/** Gather a server-reflexive candidate by Binding-Request the STUN server. */
export declare function gatherSrflx(sock: dgram.Socket, stunHost: string, stunPort?: number, timeoutMs?: number): Promise<IceCandidate | null>;
/** Gather both host + srflx candidates on a fresh UDP socket. */
export declare function gatherIceCandidates(opts?: {
    stunHost?: string;
    stunPort?: number;
    localPort?: number;
}): Promise<{
    socket: dgram.Socket;
    candidates: IceCandidate[];
}>;
/** Default STUN servers (public, free). */
export declare const DEFAULT_STUN_HOSTS: string[];
