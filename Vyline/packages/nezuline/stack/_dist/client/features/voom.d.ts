import type { Client } from "../mod.ts";
/** Channel ids from smali t98.a$b. */
export declare const VoomChannelId: {
    readonly TIMELINE: "1341209950";
    readonly HOME: "1341209850";
    readonly HOME26: "2007835442";
    readonly NOTE: "1655599932";
    readonly SQUARE_NOTE: "1657618623";
    readonly ALBUM: "1375220249";
};
/**
 * Routing prefix per MH-family service, from smali ps5/j enum.
 * All 11 prefixes live-verified against gw.line.naver.jp — gateway
 * routes the request and returns a structured response (LINE code or
 * Spring error from the right upstream).
 */
export declare const VoomRoutingPrefix: {
    readonly MYHOME: "/mh";
    readonly MYHOME_RENEWAL: "/hm";
    readonly TIMELINE: "/tl";
    readonly TIMELINE_GATEWAY: "/ext/timeline/tlgw";
    readonly NOTE: "/ext/note/nt";
    readonly HOMEAPI: "/ma";
    readonly SQUARE_NOTE: "/sn";
    readonly ALBUM: "/ext/album";
    readonly STORY: "/st";
    readonly SOCIAL_NOTIFICATION: "/eg";
    readonly TRANSLATION: "/ds";
};
export type VoomRouting = keyof typeof VoomRoutingPrefix;
export interface VoomRestOptions {
    /** Path under the routing prefix, e.g. "/api/v57/post/list.json". */
    path: string;
    /** Which routing prefix to apply. Defaults to MYHOME. */
    routing?: VoomRouting;
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    channelToken?: string;
    extraHeaders?: Record<string, string>;
    /** Full host override (default gw.line.naver.jp). */
    host?: string;
}
export interface VoomRestResponse<T = unknown> {
    code: number;
    message?: string;
    result: T | null;
}
export declare function voomRest<T = unknown>(client: Client, opts: VoomRestOptions): Promise<VoomRestResponse<T>>;
export declare function getChannelToken(client: Client, channelId: string): Promise<string>;
/**
 * Curated MH-family REST paths from LINE Android 26.6.2 smali.
 * Each path is paired with its routing prefix in {@link VoomEndpointRouting}.
 */
export declare const VoomEndpoints: {
    readonly feed: "/api/v57/post/list.json";
    readonly createPost: "/api/v57/post/create.json";
    readonly updatePost: "/api/v57/post/update.json";
    readonly deletePost: "/api/v57/post/delete.json";
    readonly getPost: "/api/v57/post/get.json";
    readonly sharePost: "/api/v57/post/share.json";
    readonly sendPostToTalk: "/api/v57/post/sendPostToTalk.json";
    readonly getShareLink: "/api/v57/post/getShareLink.json";
    readonly reportPost: "/api/v57/post/report.json";
    readonly createComment: "/api/v57/comment/create.json";
    readonly deleteComment: "/api/v57/comment/delete.json";
    readonly getComment: "/api/v57/comment/get.json";
    readonly listComments: "/api/v57/comment/getList.json";
    readonly reportComment: "/api/v57/comment/report.json";
    readonly createLike: "/api/v57/like/create.json";
    readonly cancelLike: "/api/v57/like/cancel.json";
    readonly getLike: "/api/v57/like/get.json";
    readonly listLikes: "/api/v57/like/getList.json";
    readonly hashtagPosts: "/api/v57/hashtag/posts.json";
    readonly hashtagSearch: "/api/v57/hashtag/search.json";
    readonly hashtagSuggestPopular: "/api/v57/hashtag/suggest/popular.json";
    readonly groupHomeInit: "/api/v57/grouphome/init.json";
    readonly timelineStatus: "/api/v57/timeline/tab/status.json";
    readonly timelineContents: "/api/v57/timeline/tab/contents.json";
    readonly homeProfile: "/api/v1/home/profile.json";
    readonly homeCover: "/api/v1/home/cover.json";
};
export interface VoomClient {
    getToken(channel: keyof typeof VoomChannelId): Promise<string>;
    /** Low-level call. Auto-mints channel token + applies routing prefix. */
    call<T = unknown>(channel: keyof typeof VoomChannelId, opts: Omit<VoomRestOptions, "channelToken">): Promise<VoomRestResponse<T>>;
    /** GET /mh/api/v57/post/list.json — VOOM feed. Live-verified (#151). */
    feed(opts?: {
        postLimit?: number;
        followingMaxPage?: number;
    }): Promise<VoomRestResponse>;
    /** GET /tl/api/v57/timeline/tab/status.json. Live-verified. */
    timelineStatus(): Promise<VoomRestResponse>;
}
export declare function createVoomClient(client: Client): VoomClient;
