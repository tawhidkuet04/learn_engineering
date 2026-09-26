import { LAND_MASK_B64, MASK_COLS, MASK_LAT0, MASK_ROWS } from './landmask';

/* ------------------------------------------------------------------ */
/* Places                                                              */
/* ------------------------------------------------------------------ */

export interface Place {
  name: string;
  /** IATA airport code: CDNs name their PoPs this way (SYD, LHR…) */
  code: string;
  lat: number;
  lon: number;
}

export type PopId = 'LHR' | 'LOS' | 'BOM' | 'NRT' | 'SYD' | 'GRU';
export type CityId = 'london' | 'lagos' | 'mumbai' | 'tokyo' | 'sydney' | 'saopaulo';

export const ORIGIN_PLACE: Place = { name: 'Virginia', code: 'IAD', lat: 39.04, lon: -77.49 };

export const POPS: Record<PopId, Place> = {
  LHR: { name: 'London', code: 'LHR', lat: 51.51, lon: -0.13 },
  LOS: { name: 'Lagos', code: 'LOS', lat: 6.52, lon: 3.38 },
  BOM: { name: 'Mumbai', code: 'BOM', lat: 19.08, lon: 72.88 },
  NRT: { name: 'Tokyo', code: 'NRT', lat: 35.68, lon: 139.69 },
  SYD: { name: 'Sydney', code: 'SYD', lat: -33.87, lon: 151.21 },
  GRU: { name: 'São Paulo', code: 'GRU', lat: -23.55, lon: -46.63 },
};

export const POP_IDS: PopId[] = ['LHR', 'LOS', 'BOM', 'NRT', 'SYD', 'GRU'];

export interface City extends Place {
  id: CityId;
  pop: PopId;
  /** Where the user marker sits when an edge is in town (px from the city, landscape) */
  off: [number, number];
  /** Which side of the marker the city name goes */
  side: 'left' | 'right';
  /** Which side of the PoP its cache chip goes (landscape) */
  chip: 'left' | 'right';
}

export const CITIES: Record<CityId, City> = {
  london: { id: 'london', ...POPS.LHR, pop: 'LHR', off: [-27, 13], side: 'left', chip: 'right' },
  lagos: { id: 'lagos', ...POPS.LOS, pop: 'LOS', off: [-26, 13], side: 'left', chip: 'right' },
  mumbai: { id: 'mumbai', ...POPS.BOM, pop: 'BOM', off: [-12, 25], side: 'left', chip: 'left' },
  tokyo: { id: 'tokyo', ...POPS.NRT, pop: 'NRT', off: [26, 13], side: 'right', chip: 'left' },
  sydney: { id: 'sydney', ...POPS.SYD, pop: 'SYD', off: [26, 13], side: 'right', chip: 'left' },
  saopaulo: { id: 'saopaulo', ...POPS.GRU, pop: 'GRU', off: [26, 13], side: 'right', chip: 'left' },
};

export const CITY_IDS: CityId[] = ['london', 'lagos', 'mumbai', 'tokyo', 'sydney', 'saopaulo'];

/** Visitors for the "which edge?" game: cities without a PoP of their own. */
export const GUESTS: (Place & { side: 'left' | 'right' })[] = [
  { name: 'Seoul', code: 'ICN', lat: 37.57, lon: 126.98, side: 'left' },
  { name: 'Cape Town', code: 'CPT', lat: -33.92, lon: 18.42, side: 'left' },
  { name: 'Dubai', code: 'DXB', lat: 25.2, lon: 55.27, side: 'left' },
  { name: 'Moscow', code: 'SVO', lat: 55.76, lon: 37.62, side: 'right' },
  { name: 'Perth', code: 'PER', lat: -31.95, lon: 115.86, side: 'right' },
  { name: 'Buenos Aires', code: 'EZE', lat: -34.6, lon: -58.38, side: 'left' },
];

/* ------------------------------------------------------------------ */
/* The latency model                                                   */
/* ------------------------------------------------------------------ */

/** Light in optical fiber covers about 200 km per millisecond (≈ 2/3 of c). */
export const FIBER_KM_PER_MS = 200;
/** Real cable paths are longer than the great circle and pass through routers. */
export const ROUTE_FACTOR = 1.3;
/** Wi-Fi / broadband / 4G to the ISP and back. */
export const LAST_MILE_MS = 8;

const RAD = Math.PI / 180;

/** Great-circle distance in km. */
export function km(a: Place, b: Place) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Modeled round-trip time. `user` adds the last mile. */
export function rttMs(a: Place, b: Place, user: boolean) {
  return Math.round((km(a, b) * ROUTE_FACTOR * 2) / FIBER_KM_PER_MS + (user ? LAST_MILE_MS : 1));
}

/** The physical floor: straight fiber, no detours, no routers. */
export function minRttMs(a: Place, b: Place) {
  return (km(a, b) * 2) / FIBER_KM_PER_MS;
}

/** 15674 → "15,700 km", 343 → "340 km" */
export const fmtKm = (n: number) => `${(n >= 2000 ? Math.round(n / 100) * 100 : Math.round(n / 10) * 10).toLocaleString('en-US')} km`;

/* ------------------------------------------------------------------ */
/* Projection: Miller cylindrical, centered on the origin              */
/* ------------------------------------------------------------------ */

/** Central meridian: the map is centered on Virginia, so no route to the origin crosses the seam. */
export const LON0 = -77.5;
export const LAT_TOP = 74;
export const LAT_BOT = -56;

const millerY = (lat: number) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * RAD));
const Y_TOP = millerY(LAT_TOP);
const Y_BOT = millerY(LAT_BOT);

/** Width / height of the whole map. */
export const MAP_ASPECT = (2 * Math.PI) / (Y_TOP - Y_BOT);

export interface MapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function project(m: MapRect, lat: number, lon: number) {
  let d = (lon - LON0 + 180) % 360;
  if (d < 0) d += 360;
  return { x: m.x + (d / 360) * m.w, y: m.y + ((Y_TOP - millerY(lat)) / (Y_TOP - Y_BOT)) * m.h };
}

export function unproject(m: MapRect, x: number, y: number) {
  const lon = LON0 - 180 + ((x - m.x) / m.w) * 360;
  const my = Y_TOP - ((y - m.y) / m.h) * (Y_TOP - Y_BOT);
  const lat = (2.5 * Math.atan(Math.exp(0.8 * my)) - (5 * Math.PI) / 8) / RAD;
  return { lat, lon: ((((lon + 180) % 360) + 360) % 360) - 180 };
}

/* ------------------------------------------------------------------ */
/* Land mask                                                           */
/* ------------------------------------------------------------------ */

let bits: Uint8Array | null = null;

function maskBits() {
  if (!bits) {
    const bin = atob(LAND_MASK_B64);
    bits = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bits[i] = bin.charCodeAt(i);
  }
  return bits;
}

export function isLand(lat: number, lon: number) {
  const r = Math.floor(lat - MASK_LAT0);
  if (r < 0 || r >= MASK_ROWS) return false;
  const c = ((Math.floor(lon + 180) % MASK_COLS) + MASK_COLS) % MASK_COLS;
  const i = r * MASK_COLS + c;
  return ((maskBits()[i >> 3] >> (7 - (i & 7))) & 1) === 1;
}

/** Dots on a regular screen grid wherever there is land, as one SVG path. */
export function landDotsPath(m: MapRect, spacing: number) {
  const parts: string[] = [];
  const cols = Math.floor(m.w / spacing);
  const rows = Math.floor(m.h / spacing);
  const ox = m.x + (m.w - cols * spacing) / 2 + spacing / 2;
  const oy = m.y + (m.h - rows * spacing) / 2 + spacing / 2;
  for (let j = 0; j < rows; j++) {
    const y = oy + j * spacing;
    for (let i = 0; i < cols; i++) {
      const x = ox + i * spacing;
      const g = unproject(m, x, y);
      if (isLand(g.lat, g.lon)) parts.push(`M${x.toFixed(1)} ${y.toFixed(1)}h0`);
    }
  }
  return parts.join('');
}
