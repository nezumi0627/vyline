import type { Client } from "../../mod.ts";
import type * as line from "@vyline/line-types";
import { TalkMessage } from "../message/talk.js";
import { type MessageFetcher } from "./fetcher.js";
import type { CompactMessageResponse, SendCompactMessageOptions } from "../../../base/service/talk/mod.ts";
interface ChatInit {
    client: Client;
    raw: line.Chat;
}
/**
 * Talk chat(group) class (not a OpenChat)
 */
export declare class Chat {
    #private;
    raw: line.Chat;
    readonly mid: string;
    name: string;
    constructor(init: ChatInit);
    /**
     * Sends message to the chat(group).
     */
    sendMessage(input: string | {
        text?: string;
        /**
         * If true, end2end encryption will be enabled.
         * @default true
         */
        e2ee?: boolean;
        /**
         * Related message mid. This is used for reply.
         */
        relatedMessageId?: string;
        contentType?: line.ContentType;
        contentMetadata?: Record<string, string>;
        location?: line.Location;
        chunk?: string[];
    }): Promise<TalkMessage>;
    /**
     * Sends a compact talk message through `/CA5` or `/ECA5`.
     */
    sendCompactMessage(input: string | Omit<SendCompactMessageOptions, "to">): Promise<CompactMessageResponse>;
    /**
     * @description Update chat(group) status.
     */
    updateChat(options: {
        chat: Partial<line.Chat>;
        updatedAttribute: line.Pb1_O2;
    }): Promise<line.Pb1_Zc>;
    /**
     * @description Update chat(group) name.
     */
    updateName(name: string): Promise<line.Pb1_Zc>;
    /**
     * @description Invite user.
     */
    invite(mids: string[]): Promise<line.Pb1_J5>;
    /**
     * @description Kickout user.
     */
    kick(mid: string): Promise<line.Pb1_M3>;
    /**
     * @description Leave chat.
     */
    leave(): Promise<line.Pb1_M3>;
    /**
     * Fetches messages from the chat(group).
     *
     * @param limit The number of messages to fetch. Defaults to 10.
     * @returns A promise that resolves to an array of TalkMessage instances.
     */
    fetchMessages(limit?: number): Promise<TalkMessage[]>;
    messageFetcher(): Promise<MessageFetcher>;
    /**
     * Fetches the BGM (chat background music) currently set on this chat,
     * or `undefined` if none is set.
     *
     * Backed by `Talk.getChatRoomBGMs`, which is a batch RPC; this is the
     * single-chat convenience.
     */
    getBgm(): Promise<line.ChatRoomBGM | undefined>;
    /**
     * Sets (or clears) the BGM on this chat.  Pass a string `bgmInfo` to
     * set, or `null` to clear.  The `bgmInfo` encoding (LINE MUSIC track
     * id etc.) is opaque to the protocol client and is round-tripped to the server as-
     * is.
     */
    setBgm(bgmInfo: string | null): Promise<line.ChatRoomBGM>;
}
export {};
