/** 公開鍵 storage キー（自己 / 相手を分離 — keyId 番号衝突対策） */

export function selfPubCacheKey(keyId: number): string {
  return `e2eePublicKeys:self:${keyId}`;
}

export function peerPubCacheKey(mid: string, keyId: number): string {
  return `e2eePublicKeys:peer:${mid}:${keyId}`;
}
