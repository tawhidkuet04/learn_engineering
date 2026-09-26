/**
 * Pure routing helpers: hash functions, key catalogs and the rules that map a
 * key to a shard. No state lives here; the sim calls these.
 */

/** 32-bit integer mixer (a murmur-style finalizer). Good spread for sequential ids. */
export function mix32(x: number): number {
  let h = x >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** FNV-1a over a string, then mixed. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return mix32(h);
}

/** The two-digit "hash" the lesson shows, so learners can do mod N in their head. */
export const hash2 = (id: number) => mix32(id) % 100;
export const hash2s = (key: string) => hashStr(key) % 100;

/** Vitess-style keyspace id (first 8 hex digits of the 64-bit value). */
export const keyspaceId = (id: number) => mix32(id).toString(16).padStart(8, '0');

/* ------------------------------------------------------------------ */
/* Range by username                                                   */
/* ------------------------------------------------------------------ */

export const NAME_RANGES = ['A–F', 'G–L', 'M–R', 'S–Z'];

export function nameShard(name: string): number {
  const c = name[0].toUpperCase();
  if (c <= 'F') return 0;
  if (c <= 'L') return 1;
  if (c <= 'R') return 2;
  return 3;
}

/** Signups for the range-sharding scenes. The first few feed the prediction. */
export const PREDICT_NAMES = ['carol', 'trent', 'mallory', 'judy', 'oscar', 'bob', 'victor', 'grace'];

export const NAMES = [
  'alice', 'amir', 'bea', 'bob', 'carol', 'chen', 'dave', 'diego', 'erin', 'eve', 'fatima', 'frank',
  'grace', 'gus', 'hana', 'heidi', 'ivan', 'isaac', 'jonas', 'judy', 'kai', 'kim', 'leo', 'lina',
  'mallory', 'mateo', 'nora', 'niaj', 'oscar', 'omar', 'peggy', 'priya', 'quinn', 'raj', 'rupert',
  'sofia', 'sybil', 'tom', 'trent', 'uma', 'victor', 'walter', 'wei', 'yara', 'zoe',
];

/* ------------------------------------------------------------------ */
/* Range by created_at                                                 */
/* ------------------------------------------------------------------ */

export const YEARS = [2023, 2024, 2025, 2026];
export const TODAY = '2026-09-26';

/* ------------------------------------------------------------------ */
/* List by country                                                     */
/* ------------------------------------------------------------------ */

export interface Country {
  code: string;
  w: number;
}

/** Share of orders by country for an imaginary US-heavy shop (percent). */
export const COUNTRIES: Country[] = [
  { code: 'US', w: 40 },
  { code: 'IN', w: 12 },
  { code: 'BR', w: 8 },
  { code: 'DE', w: 8 },
  { code: 'GB', w: 7 },
  { code: 'FR', w: 5 },
  { code: 'JP', w: 5 },
  { code: 'CA', w: 5 },
  { code: 'MX', w: 4 },
  { code: 'AU', w: 3 },
  { code: 'NG', w: 3 },
];

/** The fixed 4-shard country map used in the lesson steps. */
export const COUNTRY_MAP: Record<string, number> = { US: 0, IN: 1, BR: 1, MX: 1, DE: 2, GB: 2, FR: 2, JP: 3, CA: 3, AU: 3, NG: 3 };
export const COUNTRY_TAGS = ['US', 'IN BR MX', 'DE GB FR', 'JP CA AU NG'];

/** Deal countries onto n shards, biggest first, onto the lightest shard (greedy bin packing). */
export function packCountries(n: number): Record<string, number> {
  const load = Array.from({ length: n }, () => 0);
  const out: Record<string, number> = {};
  for (const c of [...COUNTRIES].sort((a, b) => b.w - a.w)) {
    let best = 0;
    for (let i = 1; i < n; i++) if (load[i] < load[best]) best = i;
    out[c.code] = best;
    load[best] += c.w;
  }
  return out;
}

export function countryTags(map: Record<string, number>, n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    COUNTRIES.filter((c) => map[c.code] === i)
      .map((c) => c.code)
      .join(' '),
  );
}

/* ------------------------------------------------------------------ */
/* Directory (tenant → shard)                                          */
/* ------------------------------------------------------------------ */

export interface Tenant {
  name: string;
  w: number;
}

export const TENANTS: Tenant[] = [
  { name: 'acme', w: 40 },
  { name: 'birch', w: 10 },
  { name: 'cove', w: 10 },
  { name: 'dune', w: 10 },
  { name: 'echo', w: 10 },
  { name: 'fern', w: 8 },
  { name: 'gale', w: 6 },
  { name: 'halo', w: 6 },
];

export const DIR_START: Record<string, number> = { acme: 0, birch: 1, cove: 2, dune: 3, echo: 0, fern: 1, gale: 2, halo: 3 };

/* ------------------------------------------------------------------ */
/* Vitess-style key ranges over the hash space                         */
/* ------------------------------------------------------------------ */

export const VITESS_RANGES = ['-40', '40-80', '80-c0', 'c0-'];

export function vitessShard(ksid: string): number {
  const b = parseInt(ksid.slice(0, 2), 16);
  return Math.min(3, Math.floor(b / 64));
}

/* ------------------------------------------------------------------ */
/* Resharding demo: 24 sample rows with hand-picked two-digit hashes   */
/* ------------------------------------------------------------------ */

/**
 * Chosen so that mod 4 gives 6 rows per shard, going to mod 5 keeps only 5 of
 * 24 rows in place (the ~80% move you'd expect), and the 16-bucket scheme
 * moves 5 of 24 (~20%).
 */
export const TILE_HASHES = [40, 12, 28, 56, 72, 96, 21, 13, 33, 57, 85, 69, 62, 30, 18, 50, 74, 86, 83, 43, 47, 7, 35, 79];

/** Buckets are dealt round robin (bucket mod 4), so placement matches hash mod 4. */
export const BUCKETS = 16;
export const BUCKET_OWNER_4 = Array.from({ length: BUCKETS }, (_, b) => b % 4);
/** Adding shard-4 takes one bucket from shards 1, 2 and 3. Only rows in those buckets move. */
export const BUCKET_OWNER_5 = BUCKET_OWNER_4.map((s, b) => (b >= 13 ? 4 : s));

/* ------------------------------------------------------------------ */
/* Queries used by the "which shards answer?" prediction               */
/* ------------------------------------------------------------------ */

export interface QuerySpec {
  sql: string;
  short: string;
  /** 'key': routed by the shard key (one shard); 'all': scatter-gather */
  kind: 'key' | 'all';
  customer?: number;
  why: string;
}

export const PREDICT_QUERIES: QuerySpec[] = [
  {
    sql: 'SELECT * FROM orders WHERE customer_id = 42',
    short: 'customer_id = 42',
    kind: 'key',
    customer: 42,
    why: 'customer_id is the shard key. The router hashes 42 and knows the exact shard.',
  },
  {
    sql: 'SELECT * FROM orders WHERE order_id = 90017',
    short: 'order_id = 90017',
    kind: 'all',
    why: "order_id isn't the shard key, so the router can't tell where that order lives. It has to ask every shard.",
  },
  {
    sql: "SELECT count(*) FROM orders WHERE created_at >= '2026-09-01'",
    short: "created_at >= '2026-09-01'",
    kind: 'all',
    why: "September's orders belong to every kind of customer, so they're spread over all shards. Every shard counts its own, then the router adds them up.",
  },
  {
    sql: "SELECT * FROM orders WHERE customer_id = 1042 AND status = 'paid'",
    short: "customer_id = 1042 AND status = 'paid'",
    kind: 'key',
    customer: 1042,
    why: 'The filter pins customer_id, so the router goes straight to that customer’s shard. Extra conditions are fine.',
  },
  {
    sql: 'SELECT * FROM orders ORDER BY total DESC LIMIT 5',
    short: 'ORDER BY total DESC LIMIT 5',
    kind: 'all',
    why: 'The biggest orders could be anywhere. Each shard sends its own top 5 and the router merges them.',
  },
];
