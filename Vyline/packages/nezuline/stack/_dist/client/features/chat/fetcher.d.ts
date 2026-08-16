import type { Client } from "../../client.ts";
import type { Chat } from "./mod.ts";
import { TalkMessage } from "../message/mod.js";
export interface MessageFetcher {
    fetch: (limit: number) => Promise<TalkMessage[]>;
}
export declare const createMessageFetcher: (client: Client, chat: Chat) => Promise<{
    fetch(limit: number): Promise<TalkMessage[]>;
}>;
