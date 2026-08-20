import type { Client } from "../mod.ts";
export type LiffMessage = LiffTextMessage | LiffStickerMessage | LiffImageMessage | LiffFlexMessage | LiffTemplateMessage | Record<string, any>;
export interface LiffTextMessage {
    type: "text";
    text: string;
    sentBy?: {
        label: string;
        iconUrl: string;
        linkUrl?: string;
    };
}
export interface LiffStickerMessage {
    type: "sticker";
    packageId: string;
    stickerId: string;
}
export interface LiffImageMessage {
    type: "image";
    originalContentUrl: string;
    previewImageUrl: string;
}
export interface LiffFlexMessage {
    type: "flex";
    altText: string;
    contents: Record<string, unknown>;
}
export interface LiffTemplateMessage {
    type: "template";
    altText: string;
    template: Record<string, unknown>;
}
export declare function text(body: string, sentBy?: LiffTextMessage["sentBy"]): LiffTextMessage;
export declare function sticker(packageId: string, stickerId: string): LiffStickerMessage;
export declare function image(originalContentUrl: string, previewImageUrl?: string): LiffImageMessage;
export declare function flex(altText: string, contents: Record<string, unknown>): LiffFlexMessage;
export interface LiffClient {
    readonly defaultLiffId: string;
    setDefaultLiffId(liffId: string): void;
    getToken(opts: {
        chatMid?: string;
        liffId?: string;
        lang?: string;
    }): Promise<string>;
    issueView(opts: {
        chatMid?: string;
        liffId?: string;
        lang?: string;
    }): Promise<import("@vyline/line-types").LiffViewResponse>;
    issueSubView(...args: Parameters<import("../../base/service/liff/mod.ts").LiffService["issueSubLiffView"]>): ReturnType<import("../../base/service/liff/mod.ts").LiffService["issueSubLiffView"]>;
    shareMessages(to: string, messages: LiffMessage[], opts?: {
        liffId?: string;
        forceIssue?: boolean;
    }): Promise<unknown>;
    shareMessage(to: string, message: LiffMessage, opts?: {
        liffId?: string;
        forceIssue?: boolean;
    }): Promise<unknown>;
    readonly service: import("../../base/service/liff/mod.ts").LiffService;
}
export declare function createLiffClient(client: Client): LiffClient;
