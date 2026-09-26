import type { CSSProperties } from 'react';
import { SIG } from '@/lib/sim/colors';
import { Hud, type HudItem } from '@/components/stage/chrome';
import { infoFor, type Info } from './info';
import { PH } from './journey';
import type { JourneySim } from './sim';
import css from './lesson.module.css';

export type HudKey = 'since' | 'phase' | 'rtts' | 'ttfb' | 'fcp' | 'first';

const TONE: Record<Info['tone'], string> = {
  dns: PH.dns,
  tcp: PH.tcp,
  tls: PH.tls,
  req: PH.req,
  res: PH.res,
  err: SIG.err,
  int: SIG.line,
};

function hudItems(sim: JourneySim, keys: HudKey[]): HudItem[] {
  const m = sim.j.marks;
  // The static waterfall already shows the whole plan, so show its totals.
  const all = sim.sc.staticWf;
  const got = (t: number) => Number.isFinite(t) && (all || sim.reached(t));
  const out: HudItem[] = [];
  for (const k of keys) {
    if (k === 'since') out.push({ label: 'Since Enter', value: Math.round(sim.tau), unit: 'ms' });
    if (k === 'phase') out.push({ label: 'Now', value: sim.phaseLabel(), wide: true, tone: sim.j.marks.failAt != null && sim.tau >= sim.j.marks.failAt ? 'bad' : undefined });
    if (k === 'rtts') out.push({ label: all ? 'RTTs to 1st byte' : 'Round trips', value: all ? sim.j.rtts : sim.roundTrips() });
    if (k === 'ttfb') out.push({ label: 'TTFB', value: got(m.ttfb) ? Math.round(m.ttfb) : '—', unit: got(m.ttfb) ? 'ms' : undefined });
    if (k === 'fcp') out.push({ label: 'First paint', value: got(m.fcp) ? Math.round(m.fcp) : '—', unit: got(m.fcp) ? 'ms' : undefined, tone: got(m.fcp) ? 'good' : undefined });
    if (k === 'first' && sim.ghostJ) out.push({ label: 'First visit', value: Math.round(sim.ghostJ.marks.fcp), unit: 'ms' });
  }
  return out;
}

export function StageHud({ sim, keys }: { sim: JourneySim; keys: HudKey[] }) {
  const list = sim.orient === 'portrait' ? keys.slice(0, 2) : keys;
  return <Hud items={hudItems(sim, list)} />;
}

export function RateNote({ sim }: { sim: JourneySim }) {
  const f = sim.rateFactor;
  if (f === 1) return null;
  // Phones: the top row belongs to the HUD, so sit beside the playback controls.
  return (
    <div className={`${css.rate} ${sim.orient === 'portrait' ? css.rateLow : ''}`}>
      {f > 1 ? (
        <>
          time-lapse <b>×{Math.round(f)}</b>
        </>
      ) : (
        <>
          slow motion <b>×{Math.round(1 / f)}</b>
        </>
      )}
    </div>
  );
}

/** The inspector: the bytes and headers of whatever is happening right now. */
export function Inspector({ sim }: { sim: JourneySim }) {
  if (sim.sc.inspector !== 'full') return null;
  if (sim.sc.view !== 'net' && sim.sc.view !== 'seq') return null;
  if (sim.sc.view === 'seq' && sim.orient === 'portrait') return null;
  if (sim.orient === 'portrait' && sim.game?.pending) return null;
  const cur = sim.current();
  if (!cur) return null;
  const info = infoFor(cur.key, sim.j);
  if (!info.lines.length) return null;
  const d = sim.dock;
  const portrait = sim.orient === 'portrait';
  const lines = portrait && info.short ? info.short : info.lines;
  // Fit the card in its dock: drop the note first, then trailing lines.
  const lineH = portrait ? 15.8 : 17;
  const chrome = portrait ? 34 : 44;
  const noteH = !portrait && info.note ? (info.note.length * 6.2 > d.w - 24 ? 40 : 22) : 0;
  let showNote = noteH > 0;
  let maxLines = Math.floor((d.maxH - chrome - noteH) / lineH);
  if (maxLines < lines.length) {
    showNote = false;
    maxLines = Math.floor((d.maxH - chrome) / lineH);
  }
  const shown = lines.slice(0, Math.max(1, maxLines));
  const tone = TONE[info.tone];
  return (
    <div
      key={`${cur.key}-${sim.runId}`}
      className={`${css.insp} ${portrait ? css.compact : ''}`}
      style={{ left: d.x - d.w / 2, top: d.y, width: d.w, maxHeight: d.maxH, '--tone': tone } as CSSProperties}
    >
      <div className={css.inspHead}>
        <i />
        {info.head}
      </div>
      <div className={css.inspBody}>
        {shown.map((l, i) =>
          l === 'rule' ? (
            <div key={i} className={css.rule} />
          ) : (
            <div key={i} className={css.line} data-kind={l.kind}>
              {l.k && <span className={css.k}>{l.k}</span>}
              <span className={css.v}>{l.v}</span>
            </div>
          ),
        )}
        {showNote && <div className={css.note}>{info.note}</div>}
      </div>
    </div>
  );
}

/** Yellow "your turn" pill, kept inside the stage. */
export function Prompt({ sim, x, y, text }: { sim: JourneySim; x: number; y: number; text: string }) {
  const w = text.length * 6.7 + 22;
  const cx = Math.min(Math.max(x, w / 2 + 8), sim.w - w / 2 - 8);
  return (
    <div className={css.prompt} style={{ left: cx, top: Math.max(y, 30) }}>
      {text}
    </div>
  );
}

/* ---------------- URL anatomy ---------------- */

const URL_PARTS = [
  { id: 'scheme', text: 'https', color: PH.tls, n: 1, label: 'scheme', note: 'Encrypt with TLS. No port typed, so use 443.' },
  { id: 'sep', text: '://', color: SIG.dim, n: 0, label: '', note: '' },
  { id: 'host', text: 'shop.example', color: PH.dns, n: 2, label: 'host', note: 'A name, not an address. Ask DNS for the IP.' },
  { id: 'port', text: ':443', color: PH.tcp, n: 3, label: 'port', note: 'Implied by https. The server listens here.', ghost: true },
  { id: 'path', text: '/cart', color: PH.req, n: 4, label: 'path', note: 'What to ask for: GET /cart.' },
];

export function UrlAnatomy({ sim, highlight }: { sim: JourneySim; highlight: string | null }) {
  const b = sim.boxes.get('browser');
  if (!b || Number.isNaN(b.x)) return null;
  const land = sim.orient === 'landscape';
  const t = sim.stepT;
  const onAt = (n: number) => t >= 0.5 + (n - 1) * 0.8;
  const hl = highlight?.startsWith('url:') ? highlight.slice(4) : null;
  const style: CSSProperties = land
    ? { left: b.tx + b.w / 2 + 40, top: sim.band.y + 44, width: sim.band.x + sim.band.w - (b.tx + b.w / 2 + 40) }
    : { left: 14, top: b.ty + b.h / 2 + 14, width: sim.w - 28 };
  return (
    <div className={`${css.url} ${land ? '' : css.urlSmall}`} style={style}>
      <div className={css.urlCaption}>
        you typed <b>a URL, not a search</b>
      </div>
      <div className={css.urlLine}>
        {URL_PARTS.map((p) => (
          <div
            key={p.id}
            className={css.seg}
            data-on={p.n === 0 ? t >= 0.5 : onAt(p.n) || hl === p.id}
            // Hovering a part in the narration dims the others.
            data-dim={!!hl && hl !== p.id}
            data-ghost={!!p.ghost}
            style={{ '--c': p.color } as CSSProperties}
          >
            <span className={css.segText}>{p.text}</span>
            {p.n > 0 && (
              <>
                <span className={css.bracket} />
                <span className={css.num}>{p.n}</span>
              </>
            )}
          </div>
        ))}
      </div>
      <div className={css.urlNotes}>
        {URL_PARTS.filter((p) => p.n > 0).map((p) => (
          <div key={p.id} className={css.urlNote} data-on={onAt(p.n) || hl === p.id} data-dim={!!hl && hl !== p.id} style={{ '--c': p.color } as CSSProperties}>
            <i>{p.n}</i>
            <span>{p.label}</span>
            <em>{p.note}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Checks before the network ---------------- */

export function Checks({ sim }: { sim: JourneySim }) {
  const b = sim.boxes.get('browser');
  if (!b || Number.isNaN(b.x)) return null;
  const land = sim.orient === 'landscape';
  const t = sim.stepT;
  const style: CSSProperties = land
    ? { left: b.tx + b.w / 2 + 34, top: sim.band.y + 70, width: Math.min(380, sim.w - (b.tx + b.w / 2 + 34) - 200) }
    : { left: 10, top: sim.dock.y - 8, width: sim.w - 20 };
  const items = [
    { at: 0.5, cls: css.ok, mark: '✓', k: 'HSTS', v: 'shop.example is https-only' },
    { at: 1.4, cls: css.skip, mark: '–', k: 'Service worker', v: 'none registered yet' },
    { at: 2.3, cls: css.no, mark: '✗', k: 'HTTP cache', v: 'no stored copy of /cart' },
  ];
  return (
    <div className={`${css.panel} ${land ? '' : css.small}`} style={style}>
      <div className={css.panelHead}>before the network</div>
      {items.map((it) => (
        <div key={it.k} className={css.check} data-on={t >= it.at}>
          <span className={`${css.mark} ${it.cls}`}>{it.mark}</span>
          <b>{it.k}</b>
          <span>{it.v}</span>
        </div>
      ))}
      <div className={css.go} data-on={t >= 3.2}>
        → off to the network. First stop: DNS.
      </div>
    </div>
  );
}

/* ---------------- Where the time goes (TTFB budget) ---------------- */

export function Budget({ sim }: { sim: JourneySim }) {
  const j = sim.j;
  const m = j.marks;
  const c = j.cfg;
  const d = sim.dock;
  const land = sim.orient === 'landscape';
  const r = c.rtt;
  const tlsN = c.tls === '1.3' ? 1 : 2;
  const dns = c.dnsCached ? 0 : m.dnsEnd;
  const lost = m.lossAt != null ? 1000 : 0;
  const think = c.serverMs;
  const n = c.reuse ? 1 : 2 + tlsN;
  const style: CSSProperties = { left: d.x - d.w / 2, top: d.y, width: d.w };
  if (m.failAt != null) return null;
  if (!land) {
    const parts = [c.dnsCached ? null : `${Math.round(dns)}`, lost ? '1000' : null, `${n}×${r}`, `${think}`].filter(Boolean).join(' + ');
    return (
      <div className={`${css.panel} ${css.small}`} style={style}>
        <div className={css.panelHead}>where the time goes</div>
        <div className={css.budgetLine}>
          TTFB = {parts} = <b>{Math.round(m.ttfb)} ms</b>
        </div>
        <div className={css.budgetNote}>
          {n} round trip{n > 1 ? 's' : ''} × {r} ms, {c.dnsCached ? 'no DNS, ' : ''}plus {think} ms of thinking
        </div>
      </div>
    );
  }
  const rows: { k: string; how: string; v: number | null; color: string }[] = [
    { k: 'DNS', how: c.dnsCached ? 'cached' : 'resolver', v: c.dnsCached ? null : dns, color: PH.dns },
    { k: 'TCP', how: c.reuse ? 'reused' : lost ? `1 RTT + 1 s lost SYN` : '1 RTT', v: c.reuse ? null : r + lost, color: PH.tcp },
    { k: 'TLS', how: c.reuse ? 'reused' : `${tlsN} RTT${tlsN > 1 ? 's' : ''} (TLS ${c.tls})`, v: c.reuse ? null : tlsN * r, color: PH.tls },
    { k: 'Request', how: '1 RTT', v: r, color: PH.req },
    { k: 'Think', how: 'server', v: think, color: PH.req },
  ];
  return (
    <div className={css.panel} style={style}>
      <div className={css.panelHead}>where the time goes · until the first byte</div>
      <div className={css.budget}>
        {rows.map((row) => (
          <div key={row.k} data-off={row.v == null}>
            <i style={{ background: row.color }} />
            <span>{row.k}</span>
            <span>{row.how}</span>
            <b>{row.v == null ? '0 ms' : `${Math.round(row.v)} ms`}</b>
          </div>
        ))}
      </div>
      <div className={css.budgetTotal}>
        <span>TTFB</span>
        <b>{Math.round(m.ttfb)} ms</b>
        <span>then first paint at {Math.round(m.fcp)} ms</span>
      </div>
    </div>
  );
}

/* ---------------- Certificate check ---------------- */

export function CertCheck({ sim }: { sim: JourneySim }) {
  const j = sim.j;
  const m = j.marks;
  const arrived = j.cfg.reuse ? false : sim.tau >= m.tcpEnd + j.cfg.rtt - 1e-6;
  if (!arrived) return null;
  const d = sim.dock;
  const land = sim.orient === 'landscape';
  const cert = j.cfg.cert;
  const style: CSSProperties = { left: d.x - d.w / 2, top: d.y, width: d.w };
  const verdict = (
    <div className={css.verdict}>
      <div className={css.ok}>✓ signatures chain to a trusted root</div>
      {cert === 'wrong-name' ? <div className={css.no}>✗ covers cdn.example, not shop.example</div> : <div className={css.ok}>✓ covers shop.example (SAN)</div>}
      {cert === 'expired' ? <div className={css.no}>✗ expired 12 days ago</div> : <div className={css.ok}>✓ within its validity dates</div>}
    </div>
  );
  if (!land) {
    return (
      <div className={`${css.panel} ${css.small}`} style={style}>
        <div className={css.panelHead}>certificate check</div>
        <div className={css.chain}>
          <div>
            <span>{cert === 'wrong-name' ? 'cdn.example' : 'shop.example'} ← Issuing CA 1 ← Root CA</span>
          </div>
        </div>
        {verdict}
      </div>
    );
  }
  return (
    <div className={css.panel} style={style}>
      <div className={css.panelHead}>certificate check</div>
      <div className={css.chain}>
        <div>
          <span>{cert === 'wrong-name' ? 'cdn.example' : 'shop.example'}</span>
          <span>leaf</span>
        </div>
        <div>
          <span>↳ Example Issuing CA 1</span>
          <span>intermediate</span>
        </div>
        <div>
          <span>&nbsp;&nbsp;↳ Example Root CA</span>
          <span>in the trust store</span>
        </div>
      </div>
      {verdict}
    </div>
  );
}

