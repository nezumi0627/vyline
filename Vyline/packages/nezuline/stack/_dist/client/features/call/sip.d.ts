export interface SipMessage {
    startLine: string;
    headers: Record<string, string>;
    body: string;
}
export declare function buildSip(msg: SipMessage): Uint8Array;
export declare function parseSip(bytes: Uint8Array): SipMessage;
/** Parse e.g. `Digest realm="X", nonce="Y", qop="auth", algorithm=MD5`. */
export declare function parseDigestChallenge(value: string): Record<string, string>;
export interface DigestParams {
    username: string;
    password: string;
    realm: string;
    nonce: string;
    uri: string;
    method: string;
    qop?: string;
    cnonce?: string;
    nc?: string;
    opaque?: string;
    algorithm?: string;
}
export declare function digestResponse(p: DigestParams): Promise<string>;
export declare function newBranch(): string;
export declare function randomCallId(host?: string): string;
export declare function getStatusCode(startLine: string): number | null;
