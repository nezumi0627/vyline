/**
 * PLANET protocol framing.
 *
 * Reverse-engineered from LINE Android 26.6.2's libandromeda.so:
 *   - pln_transport_make_planet_chunk_hdr  (0xcba934, 9 insns)
 *   - pln_transport_parse_planet_chunk_hdr (0xcba958, 8 insns)
 *   - pln_transport_make_planet_fixed_hdr  (0xcba978, 26 insns)
 *   - pln_transport_parse_planet_fixed_hdr (0xcba9e0, 25 insns)
 *
 * The PLANET wire frame is:
 *
 *   [chunk_hdr 2B][fixed_hdr 4B][cassini message body (encrypted)]
 *
 * The chunk header bit-packs a 16-bit logical value into 16 wire bytes via:
 *   wire[0..15] = bit_shuffle(logical[0..15])
 * with a fixed mapping derived from the ARM64 instruction sequence.
 *
 * The fixed header packs (type, flags, length, sequence) into 4 wire bytes
 * big-endian, with field masks pulled from .rodata at va 0x2faf70/0x2faf80:
 *
 *   bits 0..1  : 2-bit type    (mask 0x0c on the BE word after rev)
 *   bit  2     : flag A         (mask 0x10)
 *   bits 3..13 : 11-bit length  (mask 0xffe0, value = (w >> 5) & 0x7ff)
 *   bit  14    : flag B         (mask 0x00010000)
 *   bits 15..31: 17-bit sequence (the 01d5/01d6/... transaction counter)
 */
/**
 * Pack a 16-bit logical chunk header into wire bytes.
 *
 * The asm:
 *   ldrh w8, [x1]
 *   lsl  w9, w8, #7
 *   and  w9, w9, #0x800
 *   orr  w9, w9, w8, lsl #12
 *   orr  w8, w9, w8, lsr #5
 *   rev  w8, w8
 *   lsr  w8, w8, #0x10
 *   strh w8, [x0]
 */
export declare function makeChunkHdr(logical: number): number;
/**
 * Inverse of makeChunkHdr.
 *
 * The asm:
 *   rev    w8, w1
 *   lsr    w9, w8, #0x17
 *   and    w9, w9, #0x10
 *   bfxil  w9, w8, #0x1c, #4   (w9[3:0] = w8[31:28])
 *   lsr    w8, w8, #0x10
 *   orr    w8, w9, w8, lsl #5
 *   strh   w8, [x0]
 */
export declare function parseChunkHdr(wire: number): number;
/** Fixed-header fields. */
export interface PlanetFixedHdr {
    /** 2-bit type code. Observed: 0 (request? response?). */
    type: number;
    /** 1-bit flag A. */
    flagA: boolean;
    /** 11-bit body length. */
    length: number;
    /** 1-bit flag B. */
    flagB: boolean;
    /** Transaction sequence (observed 0x01d5..0x01ec incrementing). */
    sequence: number;
}
/**
 * Pack a fixed header into a 4-byte wire value (big-endian).
 * Bit layout established from .rodata masks at 0x2faf70:
 *   field 0: 0x30000000 (bits 28-29) — type
 *   field 1: 0x08000000 (bit 27)     — flag A
 *   field 2: 0x07ff0000 (bits 16-26) — length
 *   field 3: 0x00008000 (bit 15)     — flag B
 * remainder (bits 0-14): sequence high bits + carry
 */
export declare function makeFixedHdr(hdr: PlanetFixedHdr): Uint8Array;
export declare function parseFixedHdr(wire: Uint8Array): PlanetFixedHdr;
/** Build a complete PLANET datagram header (chunk + fixed). */
export declare function buildFrameHeader(chunkLogical: number, fixed: PlanetFixedHdr): Uint8Array;
/** Parse a PLANET datagram header. */
export declare function parseFrameHeader(wire: Uint8Array): {
    chunkLogical: number;
    fixed: PlanetFixedHdr;
};
