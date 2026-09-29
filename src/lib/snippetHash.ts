/**
 * A short, stable fingerprint of a code snippet (FNV-1a, 32-bit). verify/
 * records the fingerprint of every snippet it checks against real software;
 * CodeBlock looks it up, so editing a snippet hides its badge until the checks
 * run again.
 */
export function snippetHash(code: string): string {
  const text = code.replace(/^\n+|\n+$/g, '');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
