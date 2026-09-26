/**
 * Where things sit inside a database cylinder. Shared by the sim (so the
 * replication arcs plug into the log tape) and the scene that draws it.
 */
export interface DbGeom {
  /** Radius of the elliptical top and bottom */
  ry: number;
  /** Baseline of the header line */
  headY: number;
  /** Table rows: two stacked rows (landscape) or two cells side by side (portrait) */
  stacked: boolean;
  /** Baselines of the table rows (one entry when side by side) */
  rows: number[];
  rowH: number;
  /** Log tape row */
  tapeTop: number;
  tapeH: number;
  cellW: number;
  cells: number;
  tapeMid: number;
  /** Font sizes */
  fs: { head: number; key: number; val: number; tape: number; badge: number };
}

export function dbGeom(w: number, portrait: boolean): DbGeom {
  if (portrait) {
    const cellW = 25;
    return {
      ry: 6,
      headY: 25,
      stacked: false,
      rows: [41],
      rowH: 15,
      tapeTop: 49,
      tapeH: 15,
      cellW,
      cells: Math.max(3, Math.floor((w - 20) / cellW)),
      tapeMid: 49 + 7.5,
      fs: { head: 10.5, key: 9, val: 10.5, tape: 8.5, badge: 7.6 },
    };
  }
  const cellW = 32;
  return {
    ry: 9,
    headY: 35,
    stacked: true,
    rows: [55, 73],
    rowH: 17,
    tapeTop: 84,
    tapeH: 20,
    cellW,
    cells: Math.max(3, Math.floor((w - 22) / cellW)),
    tapeMid: 84 + 10,
    fs: { head: 12, key: 10.5, val: 12, tape: 10, badge: 8.4 },
  };
}

/** Height of a database node, with or without its log tape. */
export function dbHeight(portrait: boolean, tape: boolean) {
  if (portrait) return tape ? 76 : 58;
  return tape ? 116 : 92;
}
