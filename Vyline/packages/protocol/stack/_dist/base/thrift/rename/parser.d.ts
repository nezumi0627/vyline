import type { ParsedThrift } from "../readwrite/declares.ts";
export declare class ThriftRenameParser {
    #private;
    def: Record<string, Record<string, string> | any[]>;
    rename_thrift(structName: string, object: any): any;
    rename_data(data: ParsedThrift, square?: boolean): ParsedThrift;
}
