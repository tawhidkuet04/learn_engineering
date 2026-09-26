/*
 * Paint mixing for the Diffie–Hellman analogy.
 *
 * Paint mixes subtractively: each pigment absorbs some light. A decent model
 * is the weighted geometric mean of the colors' linear reflectance, per
 * channel. It is commutative and associative, which is exactly the property
 * the analogy needs: common + a + b gives the same color in any order.
 */

type RGB = [number, number, number];

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function parse(hex: string): RGB {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
}

function format(c: RGB): string {
  return `#${c
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Mix equal parts of each paint (repeat a paint to add more of it). */
export function mix(...paints: string[]): string {
  const lin = paints.map((p) => parse(p).map(toLin) as RGB);
  const out = [0, 1, 2].map((ch) => {
    const logSum = lin.reduce((s, c) => s + Math.log(Math.max(c[ch], 0.003)), 0);
    return toSrgb(Math.exp(logSum / lin.length));
  }) as RGB;
  return format(out);
}

export const COMMON = '#F4C542';

export interface Paint {
  id: string;
  name: string;
  hex: string;
}

/** Secret colors the learner can pick. */
export const PAINTS: Paint[] = [
  { id: 'crimson', name: 'crimson', hex: '#E23B4E' },
  { id: 'blue', name: 'blue', hex: '#2F6BE0' },
  { id: 'teal', name: 'teal', hex: '#12B3A5' },
  { id: 'violet', name: 'violet', hex: '#8B5CE8' },
  { id: 'pink', name: 'pink', hex: '#F064B2' },
  { id: 'green', name: 'green', hex: '#3FBF5B' },
];

export const MALLORY_PAINT = '#6B8E23';

export const paintById = (id: string) => PAINTS.find((p) => p.id === id) ?? PAINTS[0];

/** Color pairs used when the predict round repeats. */
export const ROUNDS: [string, string][] = [
  ['crimson', 'blue'],
  ['pink', 'teal'],
  ['violet', 'green'],
];
