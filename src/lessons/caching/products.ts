/** The outdoor-gear shop's catalog, most popular first. */
export interface Product {
  id: number;
  name: string;
  price: number;
}

export const PRODUCTS: Product[] = [
  { id: 42, name: 'Trail boots', price: 89 },
  { id: 7, name: 'Wool socks', price: 12 },
  { id: 13, name: 'Rain jacket', price: 120 },
  { id: 5, name: 'Water bottle', price: 18 },
  { id: 21, name: 'Headlamp', price: 35 },
  { id: 8, name: 'Tent', price: 240 },
  { id: 99, name: 'Camp stove', price: 55 },
  { id: 3, name: 'Sleeping bag', price: 140 },
  { id: 64, name: 'Compass', price: 22 },
  { id: 17, name: 'Backpack', price: 110 },
  { id: 11, name: 'Trekking poles', price: 65 },
  { id: 30, name: 'Map case', price: 9 },
  { id: 56, name: 'Bear spray', price: 45 },
  { id: 24, name: 'Fleece', price: 70 },
  { id: 81, name: 'Gaiters', price: 32 },
  { id: 2, name: 'Stuff sack', price: 15 },
];

/** The hottest product: Trail boots. */
export const HOT = 42;

const BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));

export function product(id: number): Product {
  return BY_ID.get(id) ?? { id, name: `Product ${id}`, price: 10 };
}

export const keyName = (id: number) => `product:${id}`;

export interface ClientSpec {
  id: string;
  name: string;
  sub: string;
  color: string;
}

export const SHOPPERS: ClientSpec[] = [
  { id: 'alice', name: 'Alice', sub: '198.51.100.42', color: '#FF7EB6' },
  { id: 'bob', name: 'Bob', sub: '192.0.2.7', color: '#2DD4BF' },
  { id: 'carol', name: 'Carol', sub: '198.51.100.73', color: '#C4F25A' },
];

export const ADMIN: ClientSpec = { id: 'dave', name: 'Dave', sub: 'shop admin', color: '#93A5FF' };
