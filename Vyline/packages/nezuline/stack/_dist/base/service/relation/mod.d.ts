import { LINEStruct, type ProtocolKey } from "../../thrift/mod.js";
import type * as LINETypes from "@vyline/line-types";
import type { BaseClient } from "../../core/mod.ts";
import type { BaseService } from "../types.ts";
export declare class RelationService implements BaseService {
    client: BaseClient;
    protocolType: ProtocolKey;
    requestPath: string;
    errorName: string;
    constructor(client: BaseClient);
    getTargetProfiles(...param: Parameters<typeof LINEStruct.getTargetProfiles_args>): Promise<LINETypes.getTargetProfiles_result["success"]>;
    getRecommendationDetails(...param: Parameters<typeof LINEStruct.getRecommendationDetails_args>): Promise<LINETypes.getRecommendationDetails_result["success"]>;
    getContactCalendarEvents(...param: Parameters<typeof LINEStruct.getContactCalendarEvents_args>): Promise<LINETypes.getContactCalendarEvents_result["success"]>;
    getContactsV3(options: {
        mids: string[];
        checkUserStatusStrictly?: boolean;
    }): Promise<LINETypes.getContactsV3_result["success"]>;
    getFriendDetails(...param: Parameters<typeof LINEStruct.getFriendDetails_args>): Promise<LINETypes.getFriendDetails_result["success"]>;
    getUserFriendIds(...param: Parameters<typeof LINEStruct.getUserFriendIds_args>): Promise<LINETypes.getUserFriendIds_result["success"]>;
    /**
     * @description Add friend by mid.
     */
    addFriendByMid(options: {
        mid: string;
        reference?: string;
        trackingMetaType?: number;
        trackingMetaHint?: string;
    }): Promise<LINETypes.addFriendByMid_result["success"]>;
    /**
     * @description Find a contact by its search id (the user's LINE ID). Official
     * Accounts include the leading `@`, e.g. `@livecast`. Throws when nothing matches
     * or the id search is rate limited.
     */
    findContactBySearchIdOrTicketV3(options: {
        searchId: string;
    }): Promise<LINETypes.Contact>;
    /**
     * @description Search a user by their LINE ID and add them as a friend. Official
     * Account IDs include the leading `@`.
     */
    addFriendByUserId(options: {
        userId: string;
    }): Promise<LINETypes.addFriendByMid_result["success"]>;
    /**
     * @description Find a contact by phone number. The number is in E.164 form,
     * e.g. `+66814298575`. Throws when nothing matches or the lookup is rate limited.
     */
    findContactByPhoneV3(options: {
        phone: string;
    }): Promise<LINETypes.Contact>;
    /**
     * @description Look up a user by phone number (E.164) and add them as a friend.
     */
    addFriendByPhone(options: {
        phone: string;
    }): Promise<LINETypes.addFriendByMid_result["success"]>;
}
