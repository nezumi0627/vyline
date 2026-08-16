export interface PcmFrame {
    samples: Int16Array;
    sampleRate: number;
    channels: number;
    timestamp?: number;
}
export interface AudioSource {
    frames(opts?: {
        signal?: AbortSignal;
    }): AsyncIterable<PcmFrame>;
    close?(): Promise<void> | void;
}
export interface AudioSink {
    write(frame: PcmFrame): Promise<void> | void;
    end?(): Promise<void> | void;
}
export interface NativeGroupOpusPacketizeOptions {
    /**
     * Number of bytes before the raw Opus TOC byte in each input packet.
     * PLANET 1:1 examples usually pass packets shaped as `00 + opus`.
     */
    inputPrefixBytes?: number;
}
export declare function streamSource(stream: ReadableStream<PcmFrame>): AudioSource;
export declare function bufferSource(opts: {
    samples: Int16Array;
    sampleRate: number;
    channels?: number;
    frameDurationMs?: number;
}): AudioSource;
export interface FileDecoder {
    (bytes: Uint8Array): Promise<{
        samples: Int16Array;
        sampleRate: number;
        channels: number;
    }>;
}
export declare function fileSource(opts: {
    bytes: Uint8Array;
    decode: FileDecoder;
    frameDurationMs?: number;
}): Promise<AudioSource>;
export declare function bufferSink(): AudioSink & {
    frames: PcmFrame[];
};
export declare function streamSink(stream: WritableStream<PcmFrame>): AudioSink;
export declare function packetizeNativeGroupOpusPairs(packets: Uint8Array[], opts?: NativeGroupOpusPacketizeOptions): Uint8Array[];
export interface AudioEncoder {
    encode(frame: PcmFrame): Uint8Array | null;
    close?(): void;
}
export interface AudioDecoder {
    decode(packet: Uint8Array): PcmFrame | null;
    close?(): void;
}
export interface CodecFactory {
    newEncoder(opts: {
        sampleRate: number;
        channels: number;
        bitrate?: number;
        frameDurationMs?: number;
        bandwidth?: "narrowband" | "mediumband" | "wideband" | "superwideband" | "fullband";
        signal?: "auto" | "voice" | "music";
        vbr?: boolean;
    }): AudioEncoder;
    newDecoder(opts: {
        sampleRate: number;
        channels: number;
    }): AudioDecoder;
}
export declare const defaultCodecFactory: CodecFactory;
/** Minimal 16-bit PCM WAV decoder. Throws on compressed formats. */
export declare function decodeWavSync(bytes: Uint8Array): {
    samples: Int16Array;
    sampleRate: number;
    channels: number;
};
/** Linear-interpolated resample of interleaved 16-bit PCM. */
export declare function resampleLinear(samples: Int16Array, fromRate: number, toRate: number, channels: number): Int16Array;
