import type { BaseClient } from "../base/mod.js";
import { Square, SquareChat } from "./features/square/mod.js";
import { Chat } from "./features/chat/mod.js";
import { User } from "./features/user/mod.js";
import { TypedEventEmitter } from "../base/core/typed-event-emitter/index.js";
import { SquareMessage, TalkMessage } from "./features/message/mod.js";
import type * as LINETypes from "@vyline/line-types";
import type { CompactMessageResponse, SendCompactMessageOptions } from "../base/service/talk/mod.ts";
import { type MyProfileUpdate } from "./features/profile.js";
import { type LiffClient } from "./features/liff.js";
export * as liff from "./features/liff.js";
export * as voom from "./features/voom.js";
import { VoomChannelId, type VoomClient, type VoomRestOptions, type VoomRestResponse } from "./features/voom.js";
export { VoomChannelId };
export type { VoomClient, VoomRestOptions, VoomRestResponse };
export type { CompactMessageResponse, SendCompactMessageOptions };
export * as call from "./features/call/mod.js";
export * as audio from "./features/call/audio.js";
import { type CallClient, type CancelCallEvent, type IncomingCallEvent } from "./features/call/mod.js";
export type { CallClient, CallType, CancelCallEvent, IncomingCallEvent, } from "./features/call/mod.js";
export { Chat, Square, SquareChat, SquareMessage, TalkMessage, User };
export { ProfileAttribute } from "./features/profile.js";
export type { MyProfileUpdate } from "./features/profile.js";
export interface ListenOptions {
    /**
     * A boolean of whether to enable receiving talk events.
     * @default true
     */
    talk?: boolean;
    /**
     * A boolean of whether to enable receiving square (OpenChat) events.
     * @default false
     */
    square?: boolean;
    /**
     * A AbortSignal to stop listening.
     */
    signal?: AbortSignal;
}
export type ClientEvents = {
    message: (message: TalkMessage) => void;
    event: (event: LINETypes.Operation) => void;
    "square:message": (message: SquareMessage) => void;
    "square:event": (event: LINETypes.SquareEvent) => void;
    "call:incoming": (event: IncomingCallEvent) => void;
    "call:cancel": (event: CancelCallEvent) => void;
};
export declare class Client extends TypedEventEmitter<ClientEvents> {
    #private;
    readonly base: BaseClient;
    constructor(base: BaseClient);
    get liff(): LiffClient;
    voomRest<T = unknown>(opts: VoomRestOptions): Promise<VoomRestResponse<T>>;
    get voom(): VoomClient;
    /** Call control-plane wrapper (#148 v3.0). Media plane TBD. */
    get call(): CallClient;
    /**
     * Listens events.
     * @param opts Options
     * @returns TypedEventEmitter
     */
    listen(opts?: ListenOptions): void;
    /** Gets auth token for LINE. */
    get authToken(): string;
    /**
     * Sends a compact talk message through `/CA5` or `/ECA5`.
     * When `e2ee` is omitted, LINE E2EE retry errors fall back to compact E2EE.
     */
    sendCompactMessage(to: string, input: string | Omit<SendCompactMessageOptions, "to">): Promise<CompactMessageResponse>;
    /** Returns the signed-in user's own profile. */
    getMyProfile(): Promise<LINETypes.Profile>;
    /**
     * Updates one or more attributes on the signed-in user's profile.
     * @example client.updateMyProfile({ statusMessage: "今日も頑張る" })
     */
    updateMyProfile(update: MyProfileUpdate): Promise<void>;
    /** Convenience: rename the signed-in user. */
    updateMyDisplayName(displayName: string): Promise<void>;
    /** Convenience: set the signed-in user's status message (ステメ). */
    updateMyStatusMessage(statusMessage: string): Promise<void>;
    /**
     * Uploads a new profile picture for the signed-in user (the avatar
     * shown in chats).  Returns the OBS object id + hash.
     */
    uploadMyProfileImage(data: Blob): Promise<{
        objId: string;
        objHash: string;
    }>;
    /**
     * Uploads a new profile background (the cover photo behind the
     * profile picture on the user's profile page).
     */
    uploadMyProfileBackground(data: Blob): Promise<{
        objId: string;
        objHash: string;
    }>;
    /**
     * Fetches all chat rooms the user joined.
     */
    fetchJoinedChats(): Promise<Chat[]>;
    /** Fetches all friends. V3→V2→getUser fallback for #71. */
    fetchUsers(): Promise<User[]>;
    /**
     * Fetches all squares the user joined.
     */
    fetchJoinedSquares(): Promise<Square[]>;
    /**
     * Fetches all square chats the user joined.
     */
    fetchJoinedSquareChats(): Promise<SquareChat[]>;
    /**
     * Gets user by mid.
     * @param mid User mid
     * @returns User
     */
    getUser(mid: string): Promise<User>;
    /**
     * Gets chat by mid.
     * @param chatMid Chat mid
     * @returns Chat
     */
    getChat(chatMid: string): Promise<Chat>;
    /**
     * Gets square by mid.
     * @param squareMid Square mid
     * @returns Square
     */
    getSquare(squareMid: string): Promise<Square>;
    /**
     * Gets square by mid.
     * @param squareChatMid Square chat mid
     * @returns SquareChat
     */
    getSquareChat(squareChatMid: string): Promise<SquareChat>;
}
