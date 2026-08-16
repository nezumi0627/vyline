import { Buffer } from "node:buffer";
export interface LegyEncryptedFetchOptions {
    endpoint?: string;
    application: string;
    userAgent: string;
}
export declare class LegyEncryptedTransport {
    #private;
    readonly endpoint: string;
    constructor(endpoint?: string);
    fetch(request: Request, fetcher: (request: Request) => Promise<Response>, options: LegyEncryptedFetchOptions): Promise<Response>;
}
export declare function encodeLegyHeaders(headers: Record<string, string>): Buffer;
export declare function decodeLegyHeaders(data: Buffer): {
    headers: Record<string, string>;
    data: Buffer;
};
export declare function xxhash32(data: Uint8Array, seed?: number): number;
