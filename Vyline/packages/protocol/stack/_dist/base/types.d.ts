/**
 * Vyline protocol types.
 * @module
 */
/**
 * Fetch function used by Vyline protocol.
 * You can set custom network connection if you create an API which follows FetchLike.
 */
export interface FetchLike {
    (req: Request): Response | Promise<Response>;
}
export type Fetch = (info: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
