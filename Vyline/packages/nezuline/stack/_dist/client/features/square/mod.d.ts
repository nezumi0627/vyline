import type { Square as SquareRaw, SquareChat as SquareChatRaw } from "@vyline/line-types";
import type * as LINETypes from "@vyline/line-types";
import type { Client } from "../../mod.ts";
import { SquareMessage } from "../message/mod.js";
import { TypedEventEmitter } from "../../../base/core/typed-event-emitter/index.js";
export interface SquareInit {
    raw: SquareRaw;
    client: Client;
}
/**
 * Square(Openchat) (not a SquareChat)
 */
export declare class Square {
    #private;
    raw: SquareRaw;
    constructor(init: SquareInit);
    /** Updates square information */
    update(): Promise<void>;
    updateSquare(input: {
        updatedAttrs: LINETypes.SquareAttribute[];
        square: Partial<LINETypes.Square>;
    }): Promise<LINETypes.UpdateSquareResponse>;
    updateName(name: string): Promise<LINETypes.UpdateSquareResponse>;
    /** OpenChat mid */
    get mid(): string;
    /** OpenChat Name */
    get name(): string;
}
export interface SquareChatInit {
    raw: SquareChatRaw;
    client: Client;
}
export type SquareChatEvents = {
    message: (message: SquareMessage) => void;
    kick: (event: LINETypes.SquareEventNotifiedKickoutFromSquare) => void;
    leave: (event: LINETypes.SquareEventNotifiedLeaveSquareChat) => void;
    join: (event: LINETypes.SquareEventNotifiedJoinSquareChat) => void;
    mention: (message: SquareMessage) => void;
    destroy: (event: LINETypes.SquareEventNotifiedDestroyMessage) => void;
    event: (event: LINETypes.SquareEvent) => void;
    "update:syncToken": (syncToken: string) => void;
};
export declare class SquareChat extends TypedEventEmitter<SquareChatEvents> {
    #private;
    raw: SquareChatRaw;
    constructor(init: SquareChatInit);
    /** Updates square information */
    update(): Promise<void>;
    sendMessage(input: string | {
        text?: string;
        contentType?: LINETypes.ContentType;
        contentMetadata?: Record<string, string>;
        relatedMessageId?: string;
        location?: LINETypes.Location;
    }): Promise<LINETypes.SendMessageResponse>;
    /**
     * Sends an image to this OpenChat.
     *
     * OpenChat rejects the "reserve an empty IMAGE/AUDIO/VIDEO message via
     * `sendMessage`, then attach the obs object to its id" pattern with
     * ILLEGAL_ARGUMENT. Uploading the obs object with no `oid` ("reqseq" mode)
     * instead makes the server create the message itself. A consequence is that
     * such a message can't carry a `relatedMessageId`, so media sent this way is
     * never threaded as a reply.
     */
    sendImage(data: Blob, filename?: string): Promise<{
        objId: string;
        objHash: string;
    }>;
    /** Sends a video to this OpenChat. See {@link sendImage} for the caveats. */
    sendVideo(data: Blob, filename?: string, durationMs?: number): Promise<{
        objId: string;
        objHash: string;
    }>;
    /**
     * Sends a voice/audio message to this OpenChat.
     * See {@link sendImage} for the caveats.
     */
    sendAudio(data: Blob, filename?: string, durationMs?: number): Promise<{
        objId: string;
        objHash: string;
    }>;
    updateSquareChat(input: {
        updatedAttrs: LINETypes.SquareChatAttribute[];
        squareChat: Partial<LINETypes.SquareChat>;
    }): Promise<LINETypes.UpdateSquareChatResponse>;
    updateName(name: string): Promise<LINETypes.UpdateSquareChatResponse>;
    getMembers(): Promise<LINETypes.SquareMember[]>;
    /**
     * @description start listen (fetchSquareChatEvents)
     */
    listen(param?: {
        signal?: AbortSignal;
        syncToken?: string;
        onError?: (error: unknown) => void;
    }): Promise<void>;
    /** OpenChat mid */
    get mid(): string;
    /** OpenChat Name */
    get name(): string;
}
