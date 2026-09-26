import type { ReactNode } from 'react';
import { ALGO_NAMES, type Decision } from '../engine/algorithms';
import { VIP } from '../engine/constants';
import type { BrainView, TourView, View } from '../engine/world';
import css from './overlay.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/* ------------------------------------------------------------------ */
/* The algorithm "brain": makes the load balancer's decision visible   */
/* ------------------------------------------------------------------ */

function Bar({ n, min }: { n: number; min?: boolean }) {
  return (
    <span className={cx(css.bar, min && css.min)}>
      {Array.from({ length: Math.min(n, 12) }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}

function resultLine(d: Decision | null, labels: Record<string, string>, suffix?: string) {
  if (!d) return <div className={cx(css.result, css.dim)}>waiting for a request…</div>;
  return (
    <div className={css.result}>
      → sent to <b>{labels[d.chosen] ?? d.chosen}</b>
      {suffix ? <span className={css.dim}> {suffix}</span> : null}
    </div>
  );
}

export function Brain({ b }: { b: BrainView }) {
  const fresh = b.age < 0.45;
  const L = (id: string) => b.labels[id] ?? id;
  const d = b.decision;
  let head: string = ALGO_NAMES[b.algo];
  let body: ReactNode = null;

  if (b.layer === 'l4') {
    head = 'layer 4 · tcp';
    const det = d?.detail.kind === 'l4' ? d.detail : null;
    body = det ? (
      <>
        <div className={css.formula}>
          tcp {det.ip}:{det.port} → :443
        </div>
        <div className={css.dim}>payload: 🔒 encrypted, unreadable</div>
        <div className={css.result}>
          {det.reused ? 'existing connection → ' : 'new connection → '}
          <b>{L(d!.chosen)}</b>
        </div>
      </>
    ) : (
      <div className={css.dim}>waiting for a connection…</div>
    );
  } else if (b.routeByPath) {
    head = 'layer 7 · http routing';
    const route = d?.route;
    body = route ? (
      <>
        <div className={css.formula}>GET {route.path}</div>
        <div className={css.dim}>
          {`matches /${route.pool}/* → `}
          <em style={{ fontStyle: 'normal', color: route.pool === 'api' ? '#45D5FF' : '#FF7EB6' }}>{route.pool} pool</em>
        </div>
        {resultLine(d, b.labels, '(round robin in pool)')}
      </>
    ) : (
      <div className={css.dim}>waiting for a request…</div>
    );
  } else if (b.pending) {
    // Prediction mode: show only what a learner needs to work it out.
    const p = b.pending;
    const det = p.detail;
    head = `${ALGO_NAMES[b.algo]} · your call`;
    if (det.kind === 'rr') {
      body = (
        <>
          <div className={cx(css.chips, css.chipsSpaced)}>
            {det.order.map((id) => (
              <span key={id} className={cx(css.chip, det.last === id && css.chipLast)}>
                {L(id)}
              </span>
            ))}
          </div>
          <div className={css.result}>
            next → <b>?</b>
          </div>
        </>
      );
    } else if (det.kind === 'least') {
      body = (
        <>
          <div className={css.rows}>
            {det.counts.map(([id, n]) => (
              <Row key={id} label={L(id)} n={n} />
            ))}
          </div>
          <div className={css.result}>
            open connections → <b>?</b>
          </div>
        </>
      );
    } else if (det.kind === 'hash') {
      body = (
        <>
          <div className={css.formula}>
            {b.pendingClient?.name} · {det.ip}
          </div>
          <div className={css.dim}>
            {det.parts.join(' + ')} = {det.sum}
          </div>
          <div className={css.result}>
            {det.sum} mod {det.n} = <b>?</b>
          </div>
        </>
      );
    }
  } else {
    const det = d?.detail;
    switch (b.algo) {
      case 'rr':
        body = (
          <>
            <div className={cx(css.chips, css.chipsSpaced)}>
              {b.conns.map((c) => (
                <span key={c.id} className={cx(css.chip, !b.hideNext && b.next === c.label && css.chipNext)}>
                  {c.label}
                </span>
              ))}
            </div>
            {resultLine(d, b.labels)}
          </>
        );
        break;
      case 'least': {
        const min = Math.min(...b.conns.map((c) => c.n));
        body = (
          <>
            <div className={css.rows}>
              {b.conns.map((c) => (
                <Row key={c.id} label={c.label} n={c.n} min={c.n === min} />
              ))}
            </div>
            {resultLine(d, b.labels, '(fewest open)')}
          </>
        );
        break;
      }
      case 'weighted':
        body = (
          <>
            <div className={css.rows}>
              {(det?.kind === 'weighted' ? det.weights : []).map(([id, wt]) => (
                <Row key={id} label={L(id)} n={wt} suffix={`×${wt}`} />
              ))}
            </div>
            {resultLine(d, b.labels)}
          </>
        );
        break;
      case 'iphash':
        body =
          det?.kind === 'hash' ? (
            <>
              <div className={css.dim}>hash({det.ip})</div>
              <div className={css.formula}>
                {det.parts.join('+')} = {det.sum}
              </div>
              <div className={css.formula}>
                {det.sum} mod {det.n} = <em>{det.mod}</em>
              </div>
              {resultLine(d, b.labels)}
            </>
          ) : (
            <div className={css.dim}>waiting for a request…</div>
          );
        break;
      case 'random':
        body = resultLine(d, b.labels, '(dice roll)');
        break;
      case 'p2c':
        body =
          det?.kind === 'p2c' ? (
            <>
              <div className={css.dim}>
                sampled {L(det.a)} ({det.ca}) &amp; {L(det.b)} ({det.cb})
              </div>
              {resultLine(d, b.labels, '(less busy)')}
            </>
          ) : (
            <div className={css.dim}>waiting for a request…</div>
          );
        break;
    }
  }

  return (
    <div
      className={cx(css.brain, b.anchor === 'below' ? css.brainBelow : css.brainStrip, fresh && css.brainFlash)}
      style={b.anchor === 'below' ? { left: b.x, top: b.y } : undefined}
    >
      <div className={css.brainHead}>{head}</div>
      {body}
    </div>
  );
}

function Row({ label, n, min, suffix }: { label: string; n: number; min?: boolean; suffix?: string }) {
  return (
    <span className={css.row}>
      <span className={cx(css.rowLabel, min && css.rowMin)}>{label}</span>
      <Bar n={n} min={min} />
      <span className={css.num}>{suffix ?? n}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Follow-one-request card                                             */
/* ------------------------------------------------------------------ */

type Line = { t: string; kind?: 'add' | 'change' } | 'rule';

const TOUR: Record<TourView['stage'], { head: string; res?: boolean; lines: Line[] }> = {
  toLb: {
    head: 'request · alice → load balancer',
    lines: [{ t: 'GET /cart HTTP/1.1' }, { t: 'Host: shop.example' }, { t: 'Cookie: session=a1f9…' }, 'rule', { t: 'src 198.51.100.42:51234' }, { t: `dst ${VIP}:443` }],
  },
  atLb: {
    head: 'arrived at the load balancer',
    lines: [{ t: 'GET /cart HTTP/1.1' }, { t: 'Host: shop.example' }, { t: 'Cookie: session=a1f9…' }, 'rule', { t: 'src 198.51.100.42:51234' }, { t: `dst ${VIP}:443` }],
  },
  toServer: {
    head: 'forwarded · load balancer → web-2',
    lines: [
      { t: 'GET /cart HTTP/1.1' },
      { t: 'Host: shop.example' },
      { t: 'Cookie: session=a1f9…' },
      { t: 'X-Forwarded-For: 198.51.100.42', kind: 'add' },
      'rule',
      { t: 'src 10.0.0.2:40112', kind: 'change' },
      { t: 'dst 10.0.1.12:8080', kind: 'change' },
    ],
  },
  atServer: {
    head: 'arrived at web-2',
    lines: [
      { t: 'GET /cart HTTP/1.1' },
      { t: 'Host: shop.example' },
      { t: 'Cookie: session=a1f9…' },
      { t: 'X-Forwarded-For: 198.51.100.42', kind: 'add' },
      'rule',
      { t: 'src 10.0.0.2:40112', kind: 'change' },
      { t: 'dst 10.0.1.12:8080', kind: 'change' },
    ],
  },
  processing: {
    head: 'web-2 is working on it',
    lines: [{ t: '→ look up session a1f9…' }, { t: '→ load cart: 1 pair of boots' }, { t: '→ render cart page' }],
  },
  toLbBack: {
    head: 'response · web-2 → load balancer',
    res: true,
    lines: [{ t: 'HTTP/1.1 200 OK' }, { t: 'Content-Type: text/html' }, { t: 'Content-Length: 5120' }, 'rule', { t: 'src 10.0.1.12:8080' }, { t: 'dst 10.0.0.2:40112' }],
  },
  toClient: {
    head: 'response · load balancer → alice',
    res: true,
    lines: [
      { t: 'HTTP/1.1 200 OK' },
      { t: 'Content-Type: text/html' },
      { t: 'Content-Length: 5120' },
      'rule',
      { t: `src ${VIP}:443`, kind: 'change' },
      { t: 'dst 198.51.100.42:51234', kind: 'change' },
    ],
  },
  done: {
    head: 'delivered',
    res: true,
    lines: [],
  },
};

export function TourCard({ tour, view }: { tour: TourView; view: View }) {
  const spec = TOUR[tour.stage];
  // Keep the card inside the stage; drop it below the packet near the top edge.
  const x = Math.min(Math.max(tour.x, 140), view.w - 140);
  const below = tour.y < 230;
  return (
    <div className={cx(css.tour, spec.res && css.tourRes, below && css.tourBelow)} style={{ left: x, top: tour.y }} key={tour.stage}>
      <div className={css.tourHead}>{spec.head}</div>
      <div className={css.tourBody}>
        {tour.stage === 'done' ? (
          <>
            <div className={css.tourLine}>
              <b>✓ cart page loaded in {Math.round(tour.lat ?? 0)} ms</b>
            </div>
            <div className={css.tourNote}>Alice’s browser only ever talked to {VIP}. It never learned web-2 exists.</div>
          </>
        ) : (
          spec.lines.map((l, i) =>
            l === 'rule' ? (
              <div key={i} className={css.tourRule} />
            ) : (
              <div key={i} className={cx(css.tourLine, l.kind === 'add' && css.lineAdd, l.kind === 'change' && css.lineChange)}>
                {l.kind === 'add' ? '+ ' : l.kind === 'change' ? '~ ' : '  '}
                {l.t}
              </div>
            ),
          )
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Yellow "markup" callouts that point at parts of the drawing         */
/* ------------------------------------------------------------------ */

export interface Callout {
  /** 'lb' | 'lb:B' | 'server:s1' | 'queue:s1' | 'units:s1' | 'client:alice' | 'redis' | 'brain' */
  target: string;
  text: ReactNode;
  dir?: 'up' | 'down' | 'left' | 'right';
}

interface Resolved {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  dir: NonNullable<Callout['dir']>;
}

function resolve(v: View, c: Callout): Resolved | null {
  const dir = c.dir ?? 'up';
  let box: { x: number; y: number; w: number; h: number } | null = null;
  const [kind, id] = c.target.split(':');
  if (kind === 'lb') {
    const lb = id ? v.lbs.find((l) => l.id === id) : v.lbs.find((l) => l.active) ?? v.lbs[0];
    if (lb) box = lb;
  } else if (kind === 'server' || kind === 'units') {
    const s = v.servers.find((q) => q.id === id);
    if (s) box = kind === 'units' ? { x: s.x - s.w / 4, y: s.y + 6, w: s.w / 2, h: s.h - 20 } : s;
  } else if (kind === 'queue') {
    const s = v.servers.find((q) => q.id === id);
    const p = s?.capSlots[Math.min(4, (s?.capSlots.length ?? 1) - 1)];
    if (p) box = { x: p.x, y: p.y, w: 8, h: 8 };
  } else if (kind === 'client') {
    const cl = v.clients.find((q) => q.id === id);
    if (cl) box = cl;
  } else if (kind === 'redis' && v.redis) {
    box = v.redis;
  } else if (kind === 'brain' && v.brain) {
    box = { x: v.brain.x, y: v.brain.y + 40, w: 238, h: 80 };
  }
  if (!box) return null;

  const gap = 46;
  let ax = box.x;
  let ay = box.y;
  if (dir === 'up') ay = box.y - box.h / 2 - 4;
  if (dir === 'down') ay = box.y + box.h / 2 + 4;
  if (dir === 'left') ax = box.x - box.w / 2 - 4;
  if (dir === 'right') ax = box.x + box.w / 2 + 4;
  let bx = ax + (dir === 'left' ? -gap : dir === 'right' ? gap : 0);
  let by = ay + (dir === 'up' ? -gap : dir === 'down' ? gap : 0);
  // Keep the text box on the stage.
  if (dir === 'up' || dir === 'down') bx = Math.min(Math.max(bx, 118), v.w - 118);
  if (dir === 'left') bx = Math.max(bx, 226);
  if (dir === 'right') bx = Math.min(bx, v.w - 226);
  by = Math.min(Math.max(by, 40), v.h - 40);
  return { ax, ay, bx, by, dir };
}

export function CalloutLeaders({ view, callouts, stepKey }: { view: View; callouts: Callout[]; stepKey: string }) {
  return (
    <g>
      {callouts.map((c, i) => {
        const r = resolve(view, c);
        if (!r) return null;
        return (
          <g key={`${stepKey}-${i}`}>
            <path className={css.leader} pathLength={1} d={`M${r.ax},${r.ay} L${r.bx},${r.by}`} style={{ animationDelay: `${i * 160}ms` }} />
            <circle className={css.leaderDot} cx={r.ax} cy={r.ay} r={3.2} style={{ animationDelay: `${i * 160}ms` }} />
          </g>
        );
      })}
    </g>
  );
}

export function CalloutBoxes({ view, callouts, stepKey }: { view: View; callouts: Callout[]; stepKey: string }) {
  return (
    <>
      {callouts.map((c, i) => {
        const r = resolve(view, c);
        if (!r) return null;
        const t =
          r.dir === 'up' ? 'translate(-50%, -100%)' : r.dir === 'down' ? 'translate(-50%, 0)' : r.dir === 'left' ? 'translate(-100%, -50%)' : 'translate(0, -50%)';
        return (
          <div key={`${stepKey}-${i}`} className={css.callout} style={{ left: r.bx, top: r.by, transform: t, animationDelay: `${180 + i * 160}ms` }}>
            {c.text}
          </div>
        );
      })}
    </>
  );
}
