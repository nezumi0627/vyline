import { BaseStorage, type Storage } from "./base.js";
/**
 * @lassdesc Mmemory Storage for LINE Client
 * @constructor
 */
export declare class MemoryStorage extends BaseStorage {
    /**
     * Create a new MemoryStorage instance, with initial data.
     *
     * @param {Record<Storage["Key"], Storage["Value"]>} [extendData] - Initial data to be stored in the memory storage.
     */
    constructor(extendData?: Record<Storage["Key"], Storage["Value"]>);
    private data;
    set(key: Storage["Key"], value: Storage["Value"]): Promise<void>;
    get(key: Storage["Key"]): Promise<Storage["Value"] | undefined>;
    delete(key: Storage["Key"]): Promise<void>;
    clear(): Promise<void>;
    getAll(): Record<Storage["Key"], Storage["Value"]>;
    migrate(storage: BaseStorage): Promise<void>;
}
