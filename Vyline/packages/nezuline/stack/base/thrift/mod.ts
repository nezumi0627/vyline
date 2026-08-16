export {
	type NestedArray,
	type ParsedThrift,
	type ProtocolKey,
	Protocols,
} from "./readwrite/declares.js";
export * as LINEStruct from "./readwrite/struct.js";
import { ThriftRenameParser } from "./rename/parser.js";
import { readThrift, readThriftStruct } from "./readwrite/read.js";
import { writeThrift } from "./readwrite/write.js";

/**
 * Thrift Client
 */
export class Thrift extends ThriftRenameParser {
	constructor() {
		super();
	}
	readThrift(
		...params: Parameters<typeof readThrift>
	): ReturnType<typeof readThrift> {
		return readThrift(...params);
	}

	readThriftStruct(
		...params: Parameters<typeof readThriftStruct>
	): ReturnType<typeof readThriftStruct> {
		return readThriftStruct(...params);
	}

	writeThrift(
		...params: Parameters<typeof writeThrift>
	): ReturnType<typeof writeThrift> {
		return writeThrift(...params);
	}
}
