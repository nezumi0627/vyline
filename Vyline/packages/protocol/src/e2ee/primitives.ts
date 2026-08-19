/**
 * e2ee/primitives.ts — E2EE 低レベル関数の自前実装
 *
 * これまで `client.base.e2ee.*` 経由で呼んでいた汎用暗号プリミティブ
 * (Curve25519 の鍵検証、SHA256 派生、XOR、keychain の AES-256-CBC 復号) を
 * Vyline 自身のコードとして持つ。アルゴリズムは標準的な暗号プリミティブの
 * 組み合わせであり、LINE 固有の秘密ではない
 * (docs/analysis/e2ee-decrypt-journey.md 参照)。
 */

import { createDecipheriv, createHash, randomBytes } from "node:crypto";
import { generateKeyPair } from "curve25519-js";
import { generateSharedSecret } from "./letterSealing.js";

export { generateSharedSecret };

export function getSHA256Sum(...parts: (string | Buffer)[]): Buffer {
  const hash = createHash("sha256");
  for (const p of parts) hash.update(typeof p === "string" ? Buffer.from(p) : p);
  return hash.digest();
}

/** SHA256 の32バイトを16+16に分けて XOR し、AES の IV(16B) を作る */
export function xorHalves(buf: Buffer): Buffer {
  const half = buf.length / 2;
  const out = Buffer.alloc(half);
  for (let i = 0; i < half; i++) {
    out[i] = (buf[i] as number) ^ (buf[i + half] as number);
  }
  return out;
}

/** Curve25519 の秘密鍵から対応する公開鍵を導出し、期待値と比較する */
export function verifyE2EEKeyPair(privKey: Buffer, pubKey: Buffer): boolean {
  try {
    const derived = Buffer.from(generateKeyPair(Uint8Array.from(privKey)).public);
    return derived.equals(pubKey);
  } catch {
    return false;
  }
}

/** 新規 Curve25519 鍵ペアを生成する (センダーキー登録用) */
export function createKeyPair(): { privKey: Buffer; pubKey: Buffer } {
  const seed = randomBytes(32);
  const pair = generateKeyPair(Uint8Array.from(seed));
  return { privKey: Buffer.from(pair.private), pubKey: Buffer.from(pair.public) };
}

/**
 * サーバーの keychain 応答 (encryptedKeyChain) を復号する。
 * AES-256-CBC, key = SHA256(sharedSecret‖salt?‖"Key") 相当 (共有鍵から直接),
 * iv = xorHalves(SHA256(sharedSecret‖"IV"))。
 * サーバー実装は PKCS7 パディングを付けないため autoPadding=false で読む。
 */
export function decryptKeyChainRaw(sharedSecret: Buffer, encryptedKeyChain: Buffer): Buffer {
  const aesKey = getSHA256Sum(sharedSecret, "Key");
  const aesIv = xorHalves(getSHA256Sum(sharedSecret, "IV"));
  const decipher = createDecipheriv("aes-256-cbc", aesKey, aesIv);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(encryptedKeyChain), decipher.final()]);
}

export function decryptKeyChain(
  serverPubKey: Buffer,
  mySecret: Buffer,
  encryptedKeyChain: Buffer,
): Buffer {
  const sharedSecret = generateSharedSecret(mySecret, serverPubKey);
  return decryptKeyChainRaw(sharedSecret, encryptedKeyChain);
}
