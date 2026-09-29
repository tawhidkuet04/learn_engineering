/** The programs the lessons are tested against, most relevant first. */
const ORDER = ['nginx', 'haproxy', 'redis', 'postgresql', 'mysql', 'node', 'chrome', 'openssl', 'openjdk'];

/** "nginx 1.31.6 & Node 22.22.0" entries from checks -> one "name version" per program. */
export function softwareList(entries: string[]): string[] {
  const seen = new Map<string, string>();
  for (const e of entries) {
    for (const part of e.split(/\s*&\s*|,\s*/)) {
      const clean = part.replace(/\s*\(.*\)\s*$/, '').trim();
      const key = clean.split(' ')[0].toLowerCase();
      if (clean && !seen.has(key)) seen.set(key, clean);
    }
  }
  const rank = (k: string) => (ORDER.indexOf(k) < 0 ? ORDER.length : ORDER.indexOf(k));
  return [...seen.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).map(([, v]) => v);
}
