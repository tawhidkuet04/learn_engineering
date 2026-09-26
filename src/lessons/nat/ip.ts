/* Pure IPv4 / IPv6 helpers. Every number the lesson shows is computed here. */

/** "192.168.1.23" → 3232235799 (unsigned 32-bit). */
export function ipToInt(s: string): number {
  const p = s.split('.').map(Number);
  return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
}

/** 3232235799 → "192.168.1.23". */
export function intToIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** The four octets of an address. */
export const octets = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

/** Subnet mask for a prefix length: /24 → 255.255.255.0. */
export function maskOf(prefix: number): number {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xffffffff;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

/** Network address: the address AND the mask (host bits cleared). */
export const netOf = (ip: number, prefix: number) => (ip & maskOf(prefix)) >>> 0;

/** Broadcast address: every host bit set. */
export const bcastOf = (ip: number, prefix: number) => (netOf(ip, prefix) | (~maskOf(prefix) >>> 0)) >>> 0;

/** Bit i of a 32-bit address, i = 0 is the most significant. */
export const bitAt = (n: number, i: number) => (n >>> (31 - i)) & 1;

/** Every address in a prefix, including network and broadcast. */
export const blockSize = (prefix: number) => 2 ** (32 - prefix);

/** Usable host addresses: minus network and broadcast, except /31 (RFC 3021) and /32. */
export function usableHosts(prefix: number) {
  if (prefix >= 32) return 1;
  if (prefix === 31) return 2;
  return blockSize(prefix) - 2;
}

export const sameNet = (a: number, b: number, prefix: number) => netOf(a, prefix) === netOf(b, prefix);

export const commas = (n: number) => n.toLocaleString('en-US');

/** An 8-bit value as "11000000". */
export const bin8 = (n: number) => n.toString(2).padStart(8, '0');

/** Place values of one octet, left to right. */
export const PLACES = [128, 64, 32, 16, 8, 4, 2, 1];

/** "128 + 64" for 192; "0" for 0. */
export function placeSum(n: number): string {
  const parts = PLACES.filter((v) => n & v);
  return parts.length ? parts.join(' + ') : '0';
}

/* ---------------- endpoints ---------------- */

export interface Addr {
  ip: string;
  port?: number;
}

export const ep = (a: Addr | null | undefined) => (!a ? '*' : a.port != null ? `${a.ip}:${a.port}` : a.ip);

export const sameAddr = (a: Addr | null | undefined, b: Addr | null | undefined) => !!a && !!b && a.ip === b.ip && a.port === b.port;

/* ---------------- IPv6 ---------------- */

/** Eight 16-bit groups of a (fully written) IPv6 address. */
export function v6Groups(full: string): number[] {
  return full.split(':').map((g) => parseInt(g, 16));
}

/** Bit i (0 = most significant) of a 128-bit address given as 8 groups. */
export const v6Bit = (groups: number[], i: number) => (groups[i >> 4] >> (15 - (i & 15))) & 1;

/** RFC 5952 text form: lowercase, no leading zeros, longest run of 2+ zero groups as "::". */
export function v6Compress(groups: number[]): string {
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen && j - i >= 2) {
      best = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (best < 0) return hex.join(':');
  return `${hex.slice(0, best).join(':')}::${hex.slice(best + bestLen).join(':')}`;
}
