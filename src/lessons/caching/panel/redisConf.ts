import type { CacheConfig } from '../sim';

export type ConfSettings = Pick<CacheConfig, 'slots' | 'policy' | 'ttl' | 'writeMode' | 'coalesce'>;

/** The maxmemory-policy that plays each of the animation's policies on a real Redis. */
export function redisPolicy(cfg: Pick<ConfSettings, 'policy' | 'ttl'>): string {
  if (cfg.policy === 'lru') return 'allkeys-lru';
  if (cfg.policy === 'lfu') return 'allkeys-lfu';
  // No FIFO in Redis. With one TTL on every key, the key that expires soonest
  // is the one written first, so volatile-ttl evicts much like FIFO. Without
  // TTLs it has nothing to evict (writes would fail), so fall back to random.
  return cfg.ttl > 0 ? 'volatile-ttl' : 'allkeys-random';
}

/**
 * The playground's "your settings" block. redis.conf only allows comments on
 * their own line, so everything that isn't a directive (including the app's
 * side) is a comment, and the whole block loads in redis-server as it is.
 * verify/caching.test.ts starts Redis with every variant.
 */
export function redisConf(cfg: ConfSettings): string {
  const policy = redisPolicy(cfg);
  const lines = ['# redis.conf', '# Redis caps bytes, not keys', `# (the animation holds ${cfg.slots} ${cfg.slots === 1 ? 'key' : 'keys'})`, '!maxmemory 64mb'];
  if (policy === 'volatile-ttl') lines.push('# no FIFO in Redis; with one TTL on', '# every key, this acts much like FIFO');
  if (policy === 'allkeys-random') lines.push('# no FIFO in Redis; without TTLs,', '# this evicts at random instead');
  lines.push(
    `!maxmemory-policy ${policy}`,
    '',
    '# the app (not config):',
    cfg.ttl > 0 ? `!#   SET product:42 "{…}" EX ${cfg.ttl}` : '!#   SET product:42 "{…}"   (no TTL)',
    `#   on write: ${cfg.writeMode === 'around' ? 'UPDATE, then DEL the key' : 'UPDATE only (stale copies)'}`,
    `#   misses: ${cfg.coalesce ? 'coalesced, 1 query per key' : 'each runs its own query'}`,
  );
  return lines.join('\n');
}
