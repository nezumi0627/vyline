import type { LooseType } from "@vyline/loose-types";
export interface Storage {
    Key: string;
    Value: string | number | boolean | null | Record<string | number, LooseType>;
}
/**
 * @classdesc Base Storage for LINE Client
 */
export declare abstract class BaseStorage {
    /**
     * @description Set a value.
     *
     * @param {Storage["Key"]} key
     * @param {Storage["Value"]} value
     */
    abstract set(key: Storage["Key"], value: Storage["Value"]): Promise<void>;
    /**
     * @description Get a value.
     *
     * @param {Storage["Key"]} key
     *
     * @returns {Promise<Storage["Value"] | undefined>} value
     */
    abstract get(key: Storage["Key"]): Promise<Storage["Value"] | undefined>;
    /**
     * @description Delete a value.
     *
     * @param {Storage["Key"]} key
     */
    abstract delete(key: Storage["Key"]): Promise<void>;
    /**
     * @description Clear all data.
     */
    abstract clear(): Promise<void>;
    /**
     * @description Migrate all data to another storage.
     */
    abstract migrate(storage: BaseStorage): Promise<void>;
}
