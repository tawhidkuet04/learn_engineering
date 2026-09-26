/* Names, addresses and certificate data shared by every scene of the TLS lesson. */

export const HOST = 'shop.example';
export const IP = { alice: '192.168.1.23', server: '203.0.113.10' } as const;

/** The browser's clock in this lesson, so certificate dates stay self-consistent. */
export const TODAY = '2026-09-26';

/* ------------------------------------------------------------------ */
/* Certificates                                                        */
/* ------------------------------------------------------------------ */

export type CheckId = 'name' | 'dates' | 'sigs' | 'root' | 'proof';

export const CHECKS: { id: CheckId; label: string; short: string; detail: string }[] = [
  { id: 'name', label: 'Name matches', short: 'Name', detail: 'Is shop.example listed in the certificate?' },
  { id: 'dates', label: 'Within its dates', short: 'Dates', detail: `Is today (${TODAY}) inside the validity window?` },
  { id: 'sigs', label: 'Signatures chain up', short: 'Signatures', detail: 'Does each certificate carry a valid signature from the one above it?' },
  { id: 'root', label: 'Root is trusted', short: 'Trusted root', detail: 'Does the chain end at a root already in the trust store?' },
  { id: 'proof', label: 'Server holds the key', short: 'Key proof', detail: 'Did the server sign this handshake with the matching private key?' },
];

export type CertRowKey = 'subject' | 'issuer' | 'valid' | 'key' | 'sig';

export interface CertRow {
  k: CertRowKey;
  label: string;
  value: string;
  /** Short value for phone layouts */
  short?: string;
}

export interface CertData {
  role: 'leaf' | 'inter' | 'root';
  rows: CertRow[];
}

const rows = (r: Record<CertRowKey, [string, string?]>): CertRow[] => [
  { k: 'subject', label: 'Subject', value: r.subject[0], short: r.subject[1] },
  { k: 'issuer', label: 'Issuer', value: r.issuer[0], short: r.issuer[1] },
  { k: 'valid', label: 'Valid', value: r.valid[0], short: r.valid[1] },
  { k: 'key', label: 'Public key', value: r.key[0], short: r.key[1] },
  { k: 'sig', label: 'Signature', value: r.sig[0], short: r.sig[1] },
];

export const LEAF: CertData = {
  role: 'leaf',
  rows: rows({
    subject: ['shop.example, www.shop.example', 'shop.example'],
    issuer: ['Example CA R3'],
    valid: ['2026-08-01 → 2026-10-30', '08-01 → 10-30 2026'],
    key: ['ECDSA P-256 · 04:3b:9f:c2…', 'ECDSA · 04:3b:9f…'],
    sig: ['made with Example CA R3’s key', 'by Example CA R3'],
  }),
};

export const INTER: CertData = {
  role: 'inter',
  rows: rows({
    subject: ['Example CA R3'],
    issuer: ['Example Root X1'],
    valid: ['2024-03-13 → 2027-03-12', '2024 → 2027'],
    key: ['RSA 2048 · 30:82:01:0a…', 'RSA · 30:82:01…'],
    sig: ['made with Example Root X1’s key', 'by Example Root X1'],
  }),
};

export const ROOT: CertData = {
  role: 'root',
  rows: rows({
    subject: ['Example Root X1'],
    issuer: ['itself (self-signed)', 'itself'],
    valid: ['2015-06-04 → 2035-06-04', '2015 → 2035'],
    key: ['RSA 4096 · 30:82:02:0a…', 'RSA · 30:82:02…'],
    sig: ['self-signed', 'self-signed'],
  }),
};

/** Other roots drawn (dimmed) in the trust store. Real roots, for flavor. */
export const OTHER_ROOTS = ['ISRG Root X1', 'DigiCert Global Root G2', 'GTS Root R1', 'Sectigo … +140 more'];

export interface FakeScenario {
  id: string;
  /** What Mallory tries, in one line */
  title: string;
  leaf: CertData;
  inter: CertData | null;
  /** Which rows look suspicious once the failing check runs */
  badRows: { card: 'leaf' | 'inter'; k: CertRowKey }[];
  fails: CheckId;
  /** Why the check fails (predict feedback) */
  reason: string;
  /** Warning page line */
  warning: string;
  code?: string;
}

const edit = (base: CertData, patch: Partial<Record<CertRowKey, [string, string?]>>): CertData => ({
  role: base.role,
  rows: base.rows.map((r) => (patch[r.k] ? { ...r, value: patch[r.k]![0], short: patch[r.k]![1] ?? patch[r.k]![0] } : r)),
});

export const FAKES: FakeScenario[] = [
  {
    id: 'self-signed',
    title: 'A certificate Mallory made and signed herself',
    leaf: edit(LEAF, {
      subject: ['shop.example', 'shop.example'],
      issuer: ['shop.example (itself)', 'itself'],
      valid: ['2026-09-01 → 2027-09-01', '09-01-26 → 09-01-27'],
      key: ['ECDSA P-256 · Mallory’s key', 'Mallory’s key'],
      sig: ['self-signed with Mallory’s key', 'self-signed'],
    }),
    inter: null,
    badRows: [{ card: 'leaf', k: 'issuer' }],
    fails: 'root',
    reason: 'Anyone can sign their own certificate. It chains up only to itself, and “shop.example” is not a root in the trust store.',
    warning: 'Issued by an unknown authority',
    code: 'NET::ERR_CERT_AUTHORITY_INVALID',
  },
  {
    id: 'wrong-name',
    title: 'A real certificate, for Mallory’s own domain',
    leaf: edit(LEAF, {
      subject: ['mallory.example', 'mallory.example'],
      key: ['ECDSA P-256 · Mallory’s key', 'Mallory’s key'],
    }),
    inter: INTER,
    badRows: [{ card: 'leaf', k: 'subject' }],
    fails: 'name',
    reason: 'The CA really did issue it, but for mallory.example. The address bar says shop.example, so the name check fails first.',
    warning: 'Issued for mallory.example',
    code: 'NET::ERR_CERT_COMMON_NAME_INVALID',
  },
  {
    id: 'expired',
    title: 'An old shop.example certificate whose key leaked',
    leaf: edit(LEAF, {
      valid: ['2025-05-01 → 2025-07-30', '05-01 → 07-30 2025'],
      key: ['ECDSA P-256 · old leaked key', 'old leaked key'],
    }),
    inter: INTER,
    badRows: [{ card: 'leaf', k: 'valid' }],
    fails: 'dates',
    reason: 'Name and signatures are genuine, but it expired on 2025-07-30. Short lifetimes limit how long a stolen key stays useful.',
    warning: 'Expired on 2025-07-30',
    code: 'NET::ERR_CERT_DATE_INVALID',
  },
  {
    id: 'forged',
    title: 'The real certificate, edited to hold Mallory’s key',
    leaf: edit(LEAF, {
      key: ['ECDSA P-256 · Mallory’s key (swapped in)', 'Mallory’s key (edited)'],
    }),
    inter: INTER,
    badRows: [{ card: 'leaf', k: 'key' }, { card: 'leaf', k: 'sig' }],
    fails: 'sigs',
    reason: 'The CA’s signature covers every byte of the certificate. Swap in a new key and the signature no longer verifies.',
    warning: 'Certificate signature doesn’t match',
  },
  {
    id: 'copied',
    title: 'An exact copy of the real certificate',
    leaf: LEAF,
    inter: INTER,
    badRows: [],
    fails: 'proof',
    reason: 'Certificates are public, so every check on the certificate passes. But CertificateVerify must be signed with the private key, which never left the real server.',
    warning: 'Handshake failed: decrypt_error',
  },
];

/* ------------------------------------------------------------------ */
/* Deterministic "ciphertext" for drawings                             */
/* ------------------------------------------------------------------ */

/** A stable, random-looking hex string (what Eve sees instead of content). */
export function hexNoise(seed: number, bytes = 10): string {
  let a = (seed * 2654435761) >>> 0;
  const out: string[] = [];
  for (let i = 0; i < bytes; i++) {
    a = (a ^ (a << 13)) >>> 0;
    a = (a ^ (a >>> 17)) >>> 0;
    a = (a ^ (a << 5)) >>> 0;
    out.push((a & 0xff).toString(16).padStart(2, '0'));
  }
  return out.join(' ');
}

export function fmtBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)} KB`;
}
