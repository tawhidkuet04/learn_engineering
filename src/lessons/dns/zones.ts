/**
 * The lesson's little internet: four zones (root, the .example TLD,
 * shop.example and cdn.example), their records, and the rules an
 * authoritative server follows to answer a query. Names are stored in
 * lower case without the trailing dot ('' is the root).
 */

export type RRType = 'A' | 'AAAA' | 'NS' | 'CNAME' | 'MX' | 'TXT' | 'SOA';

export interface RR {
  name: string;
  ttl: number;
  type: RRType;
  /** Presentation format, exactly as dig prints it (names keep their final dot) */
  data: string;
}

export type ServerId = 'root' | 'tld' | 'auth' | 'cdn';
export const SERVER_IDS: ServerId[] = ['root', 'tld', 'auth', 'cdn'];

export interface ServerInfo {
  id: ServerId;
  zone: string;
  host: string;
  ip: string;
  role: string;
  /** The zone it answers for, as a learner would say it */
  zoneLabel: string;
  /** Nominal round trip from the resolver, in ms */
  rtt: number;
}

export const SERVERS: Record<ServerId, ServerInfo> = {
  root: { id: 'root', zone: '', host: 'a.root-servers.net', ip: '198.41.0.4', role: 'root server', zoneLabel: '. (root)', rtt: 20 },
  tld: { id: 'tld', zone: 'example', host: 'a.nic.example', ip: '192.0.2.30', role: 'TLD server', zoneLabel: '.example', rtt: 31 },
  auth: { id: 'auth', zone: 'shop.example', host: 'ns1.shop.example', ip: '203.0.113.53', role: 'authoritative', zoneLabel: 'shop.example', rtt: 44 },
  cdn: { id: 'cdn', zone: 'cdn.example', host: 'ns1.cdn.example', ip: '198.51.100.53', role: 'authoritative', zoneLabel: 'cdn.example', rtt: 26 },
};

/** Which server box answers for a zone apex. */
export const ZONE_SERVER: Record<string, ServerId> = { '': 'root', example: 'tld', 'shop.example': 'auth', 'cdn.example': 'cdn' };

export const RESOLVER_IP = '192.0.2.53';
export const STUB_RTT = 14;
export const IP_OLD = '203.0.113.10';
export const IP_NEW = '203.0.113.80';
export const CDN_EDGE = '198.51.100.8';

export const fqdn = (n: string) => (n ? `${n}.` : '.');
export const target = (data: string) => data.replace(/^\d+\s+/, '').replace(/\.$/, '').toLowerCase();
export const parent = (n: string) => (n.includes('.') ? n.slice(n.indexOf('.') + 1) : '');
export const inZone = (name: string, apex: string) => apex === '' || name === apex || name.endsWith(`.${apex}`);

export interface Delegation {
  zone: string;
  ns: RR[];
  glue: RR[];
}

export interface Zone {
  apex: string;
  records: RR[];
  cuts: Delegation[];
  soa: RR;
}

export interface WorldData {
  shopIp: string;
  ttlA: number;
  wwwTarget: string;
  bigTxt: boolean;
}

const rr = (name: string, ttl: number, type: RRType, data: string): RR => ({ name, ttl, type, data });

/** Real-looking domain-verification tokens: they are what makes TXT answers big. */
const TOKENS = [
  'example-site-verification=3f9a1c07d2b84e6e9a5b0c1d2e3f4a5b6c7d8e9f',
  'mailvendor-verification=8c1e4f7a2b5d9e0c3f6a1b4d7e0a3c6f9b2e5d8a1c',
  'apple-domain-verification=Qm9vdHMgb24gc2FsZSB0aGlzIHdlZWtlbmQ',
  'cloudvendor-domain-verification=41d9b8e2c7f6a5d4c3b2a1f0e9d8c7b6a5',
  'chat-domain-verification=7e2c9b4a1f8d3e6c0b5a2f9e4d7c1b8a3f6e',
  'docs-site-verification=a9f3e7c1b5d2e8f4a0c6b3d9e5f1a7c4b0d6e2',
  'analytics-verification=5b8e1d4a7c0f3e6b9d2a5c8f1e4b7d0a3c6f9e',
  'payments-domain-verify=e4c7a0d3f6b9e2c5a8d1f4b7e0c3a6d9f2b5e8',
  'crm-verification=2d5a8f1c4e7b0d3a6f9c2e5b8d1a4f7c0e3b6d',
];

export function buildZones(w: WorldData): Record<ServerId, Zone> {
  const root: Zone = {
    apex: '',
    records: [],
    cuts: [
      {
        zone: 'example',
        ns: [rr('example', 172800, 'NS', 'a.nic.example.'), rr('example', 172800, 'NS', 'b.nic.example.')],
        glue: [rr('a.nic.example', 172800, 'A', '192.0.2.30'), rr('b.nic.example', 172800, 'A', '198.51.100.30')],
      },
      { zone: 'com', ns: [rr('com', 172800, 'NS', 'a.gtld-servers.net.')], glue: [rr('a.gtld-servers.net', 172800, 'A', '192.5.6.30')] },
    ],
    soa: rr('', 86400, 'SOA', 'a.root-servers.net. nstld.verisign-grs.com. 2026092600 1800 900 604800 86400'),
  };

  const tld: Zone = {
    apex: 'example',
    records: [],
    cuts: [
      {
        zone: 'shop.example',
        ns: [rr('shop.example', 172800, 'NS', 'ns1.shop.example.'), rr('shop.example', 172800, 'NS', 'ns2.shop.example.')],
        glue: [rr('ns1.shop.example', 172800, 'A', '203.0.113.53'), rr('ns2.shop.example', 172800, 'A', '198.51.100.54')],
      },
      {
        zone: 'cdn.example',
        ns: [rr('cdn.example', 172800, 'NS', 'ns1.cdn.example.')],
        glue: [rr('ns1.cdn.example', 172800, 'A', '198.51.100.53')],
      },
    ],
    soa: rr('example', 900, 'SOA', 'a.nic.example. hostmaster.nic.example. 2026092601 1800 900 604800 900'),
  };

  const shopTxt = [rr('shop.example', 3600, 'TXT', '"v=spf1 mx -all"')];
  if (w.bigTxt) shopTxt.push(...TOKENS.map((t) => rr('shop.example', 3600, 'TXT', `"${t}"`)));

  const auth: Zone = {
    apex: 'shop.example',
    records: [
      rr('shop.example', 3600, 'SOA', 'ns1.shop.example. hostmaster.shop.example. 2026092601 7200 3600 1209600 300'),
      rr('shop.example', 3600, 'NS', 'ns1.shop.example.'),
      rr('shop.example', 3600, 'NS', 'ns2.shop.example.'),
      rr('shop.example', w.ttlA, 'A', w.shopIp),
      rr('shop.example', 300, 'AAAA', '2001:db8::10'),
      rr('shop.example', 3600, 'MX', '10 mail.shop.example.'),
      ...shopTxt,
      rr('www.shop.example', 3600, 'CNAME', w.wwwTarget),
      rr('api.shop.example', 300, 'A', '203.0.113.11'),
      rr('mail.shop.example', 3600, 'A', '203.0.113.25'),
      rr('ns1.shop.example', 3600, 'A', '203.0.113.53'),
      rr('ns2.shop.example', 3600, 'A', '198.51.100.54'),
    ],
    cuts: [],
    soa: rr('shop.example', 3600, 'SOA', 'ns1.shop.example. hostmaster.shop.example. 2026092601 7200 3600 1209600 300'),
  };

  const cdn: Zone = {
    apex: 'cdn.example',
    records: [
      rr('cdn.example', 3600, 'SOA', 'ns1.cdn.example. ops.cdn.example. 2026092601 3600 600 604800 60'),
      rr('cdn.example', 3600, 'NS', 'ns1.cdn.example.'),
      rr('cdn.example', 60, 'A', '198.51.100.7'),
      rr('shop.cdn.example', 60, 'A', CDN_EDGE),
      rr('static.cdn.example', 60, 'A', '198.51.100.9'),
      rr('ns1.cdn.example', 3600, 'A', '198.51.100.53'),
    ],
    cuts: [],
    soa: rr('cdn.example', 3600, 'SOA', 'ns1.cdn.example. ops.cdn.example. 2026092601 3600 600 604800 60'),
  };

  return { root, tld, auth, cdn };
}

export type RespKind = 'referral' | 'answer' | 'cname' | 'nxdomain' | 'nodata';

export interface Resp {
  kind: RespKind;
  aa: boolean;
  status: 'NOERROR' | 'NXDOMAIN';
  answer: RR[];
  authority: RR[];
  additional: RR[];
}

/** The negative-caching TTL: min(SOA TTL, SOA MINIMUM), per RFC 2308. */
export function negTtl(soa: RR) {
  const min = Number(soa.data.trim().split(/\s+/).pop());
  return Math.min(soa.ttl, Number.isFinite(min) ? min : soa.ttl);
}

/** What an authoritative server for `zone` says about (qname, qtype). Servers never recurse. */
export function answerFrom(zone: Zone, qname: string, qtype: RRType): Resp {
  const cut = zone.cuts.find((c) => inZone(qname, c.zone));
  if (cut) return { kind: 'referral', aa: false, status: 'NOERROR', answer: [], authority: cut.ns, additional: cut.glue };

  const at = zone.records.filter((r) => r.name === qname);
  if (!at.length) return { kind: 'nxdomain', aa: true, status: 'NXDOMAIN', answer: [], authority: [zone.soa], additional: [] };

  const exact = at.filter((r) => r.type === qtype);
  if (exact.length) return { kind: 'answer', aa: true, status: 'NOERROR', answer: exact, authority: [], additional: [] };

  const cname = at.find((r) => r.type === 'CNAME');
  if (cname) {
    // A server follows a CNAME itself only while the target is in its own zone.
    const t = target(cname.data);
    const chained = inZone(t, zone.apex) && !zone.cuts.some((c) => inZone(t, c.zone)) ? zone.records.filter((r) => r.name === t && r.type === qtype) : [];
    return { kind: 'cname', aa: true, status: 'NOERROR', answer: [cname, ...chained], authority: [], additional: [] };
  }
  return { kind: 'nodata', aa: true, status: 'NOERROR', answer: [], authority: [zone.soa], additional: [] };
}

/* ------------------------------------------------------------------ */
/* Presentation                                                        */
/* ------------------------------------------------------------------ */

function shortData(r: RR) {
  if (r.type === 'SOA') {
    const f = r.data.split(/\s+/);
    return `${f[0]} … ${f[f.length - 1]}`;
  }
  if (r.type === 'TXT' && r.data.length > 26) return `${r.data.slice(0, 24)}…"`;
  return r.data;
}

/** One record in dig's column layout. `ttl` overrides the stored TTL (cached copies count down). */
export function fmtRR(r: RR, nameW: number, ttl?: number) {
  return `${fqdn(r.name).padEnd(nameW)} ${String(ttl ?? r.ttl).padStart(6)} IN ${r.type.padEnd(5)} ${shortData(r)}`;
}

export function nameWidth(rrs: RR[], min = 0) {
  return Math.max(min, ...rrs.map((r) => fqdn(r.name).length));
}

/* ------------------------------------------------------------------ */
/* Sizes on the wire (RFC 1035, with name compression)                  */
/* ------------------------------------------------------------------ */

/** Bytes to write `name`, pointing at any suffix already in the message (then remember its suffixes). */
function encName(name: string, seen: Set<string>) {
  const labels = name ? name.split('.') : [];
  let cost = 0;
  let i = 0;
  for (; i < labels.length; i++) {
    if (seen.has(labels.slice(i).join('.'))) break;
    cost += labels[i].length + 1;
  }
  cost += i < labels.length ? 2 : 1;
  for (let j = 0; j < labels.length; j++) seen.add(labels.slice(j).join('.'));
  return cost;
}

function rdataLen(r: RR, seen: Set<string>) {
  switch (r.type) {
    case 'A':
      return 4;
    case 'AAAA':
      return 16;
    case 'NS':
    case 'CNAME':
      return encName(target(r.data), seen);
    case 'MX':
      return 2 + encName(target(r.data), seen);
    case 'TXT':
      return (r.data.match(/"[^"]*"/g) ?? [r.data]).reduce((sum, q) => sum + 1 + q.length - 2, 0);
    case 'SOA': {
      const f = r.data.split(/\s+/);
      return encName(target(f[0]), seen) + encName(target(f[1]), seen) + 20;
    }
  }
}

/** Bytes in the DNS message: header, question, records, and an EDNS OPT record if used. */
export function wireSize(qname: string, rrs: RR[], edns = false) {
  const seen = new Set<string>();
  let s = 12 + encName(qname, seen) + 4;
  for (const r of rrs) s += encName(r.name, seen) + 10 + rdataLen(r, seen);
  return s + (edns ? 11 : 0);
}
