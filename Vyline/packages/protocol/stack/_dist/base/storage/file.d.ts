import { BaseStorage, type Storage } from "./base.js";
/**
 * @classdesc File Storage for LINE Client
 * @constructor
 */
export declare class FileStorage extends BaseStorage {
    private path;
    private writeLock;
    /**
     * @description Construct a FileStorage with the given path and data.
     *
     * @param {string} path - The path to the file.
     * @param {string} [extendData] - The data to extend the file with. If the file does not exist, it will be created with the given data. If the file does exist, the data will be appended to the file. If no data is given, the file will be created with an empty object.
     */
    constructor(path: string, extendData?: string);
    private withLock;
    set(key: Storage["Key"], value: Storage["Value"]): Promise<void>;
    get(key: Storage["Key"]): Promise<Storage["Value"] | undefined>;
    delete(key: Storage["Key"]): Promise<void>;
    clear(): Promise<void>;
    getAll(): Promise<Record<Storage["Key"], Storage["Value"]>>;
    migrate(storage: BaseStorage): Promise<void>;
}
