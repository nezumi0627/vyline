import type { CodecFactory } from "./audio.ts";
/** Returns a CodecFactory backed by opusscript (WASM Opus). */
export declare function opusCodecFactory(): Promise<CodecFactory>;
