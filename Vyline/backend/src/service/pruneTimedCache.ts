export function pruneTimedCache<K, V>(
  cache: Map<K, V>,
  expiresAt: (value: V) => number,
  now: number,
  maxSize: number,
): void {
  for (const [key, value] of cache) {
    if (expiresAt(value) <= now) cache.delete(key);
  }
  while (cache.size >= maxSize) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    cache.delete(oldest.value);
  }
}
