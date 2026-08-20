/**
 * PLANET call crypto, ground-truth revision.
 *
 * Reverse-engineered from a real LINE call (`ear_crypto_hkdf` Frida
 * hook, 2026-05-21). Earlier guess of "mpkey is the
 * master secret" was wrong; mpkey is actually the peer's ephemeral
 * P-256 public key.
 *
 * Real keying flow (observed):
 *
 *   1. CallRoute.commParam.mpkey  = peer's ephemeral P-256 compressed
 *      public key, SEC1 format (1-byte 0x02/0x03 parity + 32-byte X),
 *      base64-encoded to 44 chars, decodes to 33 raw bytes.
 *
 *   2. Local side generates its own ephemeral P-256 keypair.
 *
 *   3. ECDH(local_priv, peer_pub) → 32-byte shared secret (P-256 X
 *      coordinate of the resulting point).
 *
 *   4. Stage-1 PLANET KDF (kdf_id=3, SHA-512):
 *        PRK = HMAC-SHA512(key = route mpkey, data = ecdh_secret)
 *        OUT = HMAC-SHA512(key = PRK, data = local_pub || u32be(0))
 *        → 64-byte forward base material
 *
 *      Reverse direction repeats stage 1 with the public keys swapped.
 *
 *   5. Stage-2 PLANET KDF:
 *        PRK = HMAC-SHA512(key = 16-byte bootstrap seed,
 *                          data = 64-byte stage1 output)
 *        OUT = HMAC-SHA512(key = PRK, data = 2-byte label || u32be(0))
 *        → 64-byte transport keying material
 *
 *   6. Native transport carve observed from `ear_crypto_aes_ctr_create`,
 *      `ear_crypto_aes_ctr_do`, and `ear_crypto_calc_hmac`:
 *        AES-128 key = stage2[0..16]
 *        CTR base    = stage2[16..32]
 *        HMAC key    = stage2[32..64]
 *
 *      Per packet, the CTR IV is `CTR base XOR seq_hi/seq_lo` repeated
 *      across alternating bytes. The 16-bit sequence is the clear value in
 *      PLANET header bytes 2..3.
 *
 * The exported native function is named `ear_crypto_hkdf`, but live
 * arguments plus disassembly show it is not RFC 5869 HKDF. It is the
 * HMAC-based counter KDF above.
 *
 * The matching libtomcrypt functions live behind ear_crypto_hkdf's
 * dispatch table (`_get_hash_type_from_kdf` at va 0xcb5cd8):
 *
 *      kdf_id=1 -> hash_id=1  (SHA-1)
 *      kdf_id=2 -> hash_id=32 (SHA-256)
 *      kdf_id=3 -> hash_id=64 (SHA-512)
 *      kdf_id=4 -> hash_id=1  (SHA-1)
 *      kdf_id=5 -> hash_id=32 (SHA-256)
 *      kdf_id=6 -> hash_id=64 (SHA-512)
 *      default  -> hash_id=2
 */
/** Decode a base64 mpkey to its 33-byte SEC1 compressed P-256 public key. */
export declare function decodeMpKey(b64: string): Uint8Array;
/** Decode route.stnpk to a SEC1 P-256 public key.
 *
 * LINE returns stnpk as a base64 DER SubjectPublicKeyInfo. The useful ECDH
 * point is the trailing uncompressed SEC1 point: 0x04 || X || Y.
 */
export declare function decodeStnpkPublicKey(b64: string): Uint8Array;
/** A freshly-generated local ephemeral P-256 keypair, with the public
 *  key materialised in SEC1 compressed form (1-byte parity + 32-byte X). */
export interface EphemeralKeypair {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
}
export declare function generateEphemeralKeypair(): EphemeralKeypair;
/** Compute the ECDH shared secret (32-byte X coordinate of dH*P). */
export declare function ecdh(localPriv: Uint8Array, peerPub: Uint8Array): Uint8Array;
/** Native PLANET KDF used by `ear_crypto_hkdf` for kdf_id=3/SHA-512.
 *  This is not RFC HKDF:
 *
 *    prk = HMAC-SHA512(key = ikm, data = salt)
 *    block[i] = HMAC-SHA512(key = prk, data = info || u32be(i))
 *
 *  The first counter value is 0, matching live `ear_crypto_hkdf` output.
 */
export declare function planetKdfSha512(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, outLen?: number): Uint8Array;
/** Native PLANET KDF used by media-key setup for kdf_id=2/SHA-256. */
export declare function planetKdfSha256(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, outLen?: number): Uint8Array;
/** Stage-1 KDF: derive 64-byte session base from ECDH secret + the two
 *  SEC1 compressed public keys. `ikmPub` and `infoPub` are intentionally
 *  ordered; native computes one base per direction by swapping them. */
export declare function planetHkdfStage1(ecdhSecret: Uint8Array, ikmPub: Uint8Array, infoPub: Uint8Array): Uint8Array;
export interface PlanetMediaKeyPeer {
    publicKey: Uint8Array;
    mediaKeyId: number;
    mediaNonce: Uint8Array;
}
export interface PlanetMediaKeyLocal extends PlanetMediaKeyPeer {
    privateKey: Uint8Array;
}
export interface PlanetMediaKeys {
    sendKeying: Uint8Array;
    recvKeying: Uint8Array;
    sendRaw: Uint8Array;
    recvRaw: Uint8Array;
    sendStage1: Uint8Array;
    recvStage1: Uint8Array;
    ecdhSecret: Uint8Array;
}
export type PlanetMediaKeyVariantName = "local-peer/peer" | "peer-local/local" | "local-peer/local" | "peer-local/peer";
export interface PlanetMediaKeyingVariants {
    variants: Record<PlanetMediaKeyVariantName, Uint8Array>;
    raw: Record<PlanetMediaKeyVariantName, Uint8Array>;
    localPeerStage1: Uint8Array;
    peerLocalStage1: Uint8Array;
    ecdhSecret: Uint8Array;
}
export declare function derivePlanetMediaStreamKeying(baseKeying: Uint8Array, streamName?: "AUDIO" | "VIDEO" | "DATA"): Uint8Array;
export declare function buildPlanetMediaKeyInfo(mediaKeyId: number): Uint8Array;
/** Derive LINE's PLANET media SRTP keying material.
 *
 * Native capture shows kdf_id=2/SHA-256 in two stages:
 *   stage1 = KDF-SHA256(ECDH(local_priv, peer_pub), ordered_pub_a, ordered_pub_b)
 *   stage2 = KDF-SHA256(stage1, media_nonce, u32be(media_key_id) || 0)
 *
 * The outgoing SRTP key uses the peer's nonce/key id. The incoming SRTP key
 * uses our advertised nonce/key id. The first 30 bytes are the SRTP master key
 * and salt expected by AES_CM_128_HMAC_SHA1_80.
 */
export declare function derivePlanetMediaKeys(opts: {
    local: PlanetMediaKeyLocal;
    peer: PlanetMediaKeyPeer;
}): PlanetMediaKeys;
export declare function derivePlanetMediaKeyingVariants(opts: {
    local: PlanetMediaKeyLocal;
    peer: PlanetMediaKeyPeer;
}): PlanetMediaKeyingVariants;
export interface TransportKeys {
    /** AES-128-CTR encryption key, 16 bytes. */
    encKey: Uint8Array;
    /** HMAC-SHA256 key, 32 bytes. Native truncates the digest to 16 bytes. */
    macKey: Uint8Array;
    /** 16-byte CTR base mixed with the clear 16-bit packet sequence. */
    ctrBase: Uint8Array;
    /** Full 64-byte native stage-2 KDF output. */
    raw: Uint8Array;
}
/** Stage-2 KDF and native key carve. */
export declare function planetHkdfStage2(stage1Base: Uint8Array, bootstrapSeed16: Uint8Array, directionLabel2: Uint8Array): TransportKeys;
/** Build the native PLANET per-packet CTR IV.
 *
 * Native code copies the 16-byte base at transport offset `0x1180` and XORs
 * alternating bytes with the clear packet sequence high and low bytes.
 */
export declare function buildPlanetCtrIv(ctrBase: Uint8Array, sequence: number): Uint8Array;
/** Build the per-packet CTR IV: ivNonce[0..11] || 4-byte BE counter. */
export declare function buildCtrIv(ivNonce: Uint8Array, counter: number): Uint8Array;
/** AES-256-CTR encrypt. */
export declare function aesCtrEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Uint8Array;
export declare function aesCtrDecrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array): Uint8Array;
/** HMAC-SHA256, truncated to 16 bytes (the apparent PLANET tag size). */
export declare function hmacTag(key: Uint8Array, data: Uint8Array): Uint8Array;
export declare function tagEquals(a: Uint8Array, b: Uint8Array): boolean;
export declare function sha256(data: Uint8Array): Uint8Array;
/** Random 16-byte session ID. */
export declare function newSessionId(): Uint8Array;
/** Build the native 2-byte per-direction label seen in the plaintext
 *  bootstrap prefix and in stage-2 KDF `info`. */
export declare function buildDirectionLabel(label16: number): Uint8Array;
/** End-to-end key derivation: from a CallRoute mpkey + a fresh local
 *  ephemeral keypair, derive both directions' transport keys. */
export declare function deriveCallKeys(opts: {
    mpkey: Uint8Array;
    local: EphemeralKeypair;
    bootstrapSeed: Uint8Array;
    sendLabel: number;
    recvLabel: number;
}): {
    send: TransportKeys;
    recv: TransportKeys;
    ourPub: Uint8Array;
    ecdhSecret: Uint8Array;
};
