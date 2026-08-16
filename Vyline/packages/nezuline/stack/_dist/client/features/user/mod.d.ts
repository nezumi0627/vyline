import type * as line from "@vyline/line-types";
import type { Client } from "../../mod.ts";
import type { CompactMessageResponse, SendCompactMessageOptions } from "../../../base/service/talk/mod.ts";
export interface UserInit {
    client?: Client;
    raw: line.GetContactV3Response;
}
export declare class User {
    #private;
    readonly mid: string;
    readonly raw: line.GetContactV3Response;
    constructor(init: UserInit);
    /**
     * Fetches this user's contact calendar events (e.g. birthday) via
     * `getContactCalendarEvents`.  Requires the User to have been
     * constructed with a Client.
     */
    fetchCalendarEvents(eventKinds?: line.GetContactCalendarEventsRequest["requiredContactCalendarEvents"]): Promise<line.ContactCalendarEvent[]>;
    /**
     * Sends a compact talk message through `/CA5` or `/ECA5`.
     */
    sendCompactMessage(input: string | Omit<SendCompactMessageOptions, "to">): Promise<CompactMessageResponse>;
    /**
     * Sets a display-name override (the "rename friend" feature in LINE
     * Android: 友だち編集 → 表示名).  Pass `null` to clear the override.
     *
     * Backed by `talk.updateContactSetting` with flag =
     * `CONTACT_SETTING_DISPLAY_NAME_OVERRIDE`.
     */
    rename(displayNameOverride: string | null): Promise<void>;
    /** Toggles favorite (☆) on this contact. */
    setFavorite(favorite: boolean): Promise<void>;
    /** Mutes notifications for this contact's chats. */
    setNotificationDisabled(disabled: boolean): Promise<void>;
    /** Hides this contact from the friend list. */
    setHidden(hidden: boolean): Promise<void>;
}
