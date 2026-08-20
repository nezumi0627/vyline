import * as thrift from "thrift";
import { Buffer } from "node:buffer";
import type { LooseType } from "@vyline/loose-types";
export declare const genHeader: {
    3: (name: string) => Buffer<ArrayBuffer>;
    4: (name: string) => Buffer<ArrayBuffer>;
};
export declare const Protocols: {
    4: typeof thrift.TCompactProtocol;
    3: typeof thrift.TBinaryProtocol;
};
export type ProtocolKey = keyof typeof Protocols;
/**
 * @description NestedArray is an array that represents each value of thrift that is compatible with CHRLINE.
 * ```
 * [thrift_type, field_id, value]
 * ```
 */
export type NestedArray = Array<null | undefined | [2, number, 0 | 1 | boolean | undefined] | [3, number, number?] | [4, number, number?] | [6, number, number?] | [8, number, number?] | [10, number, number | bigint | undefined] | [11, number, string | Buffer | undefined] | [12, number, NestedArray?] | [
    13,
    number,
    [
        number,
        number,
        Record<string | number, NestedArray> | Record<string | number, unknown> | undefined
    ]?
] | [14, number, [number, NestedArray[] | unknown[] | undefined]?] | [15, number, [number, NestedArray[] | unknown[] | undefined]?]>;
export interface ParsedThrift {
    data: LooseType;
    _info: thrift.TMessage;
}
