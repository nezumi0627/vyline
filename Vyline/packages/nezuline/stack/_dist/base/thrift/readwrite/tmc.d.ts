import type { Buffer } from "node:buffer";
import type { LooseType } from "@vyline/loose-types";
/**
 * TMoreCompactProtocol - TypeScript implementation
 * Ported from CHRLINE Python implementation by YinMo
 * Author: YinMo (https://github.com/WEDeach)
 * Source: CHRLINE (https://github.com/DeachSword/CHRLINE))
 */
interface DummyProtocolData {
    fid: number | null;
    ftype: number;
    data: unknown;
    subType: number[] | null;
}
interface DummyProtocol {
    data?: DummyProtocolData;
}
export declare class TMoreCompactProtocol {
    huffmanTree: number[];
    huffmanPatterns: string[][];
    buildHuffmanNode: (cArr: string[], typeId: number) => void;
    typeSequence: number[];
    stringTable: string[];
    reserved: unknown[];
    bufferToHexArray: (data: Buffer) => string[];
    lastFieldId: number;
    currentPosition: number;
    lastStringId: bigint;
    data: Buffer;
    res: LooseType;
    dummyProtocol?: DummyProtocol;
    baseException: {
        [key: string]: number;
    };
    readWith?: string;
    constructor(inputData?: Buffer, baseException?: {
        [key: string]: number;
    }, readWith?: string);
    readVarint(): number;
    readBytes(position: number, length: number): number[];
    setDataAndParse(inputData: Buffer): void;
    parseMessageBody(): void;
    decodeZigZag(encoded: number): number;
    readDataByType(typeId: number, fieldId?: number | null): [number | null, LooseType];
    readStringTableAndParseMessage(): void;
    decodeFieldBitmap(bitmap: number): number[];
    decodeMapTypes(typesByte: number): [number, number];
    readString(): string | Buffer;
    parseHeader(): void;
    getNextType(): number;
    readVarintWithoutIncrement(buffer: Buffer, _returnLength?: boolean): number;
    readSingleByte(): number;
    hasMoreData(): boolean;
    initializeHuffmanTree(): void;
    buildHuffmanNodeImpl(pattern: string[], typeId: number): void;
    convertBufferToHexArray(buffer: Buffer): string[];
    convertCompactTypeToTType(compactType: number): number;
    unsignedRightShift(value: number, shiftAmount: number): number;
}
export {};
