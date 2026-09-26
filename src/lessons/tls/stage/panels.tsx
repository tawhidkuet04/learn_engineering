import type { CSSProperties, ReactNode } from 'react';
import { CHECKS, HOST, IP, TODAY, fmtBytes } from '../sim/data';
import { TOUR, cid } from '../sim/cert';
import { DH, pid } from '../sim/paint';
import type { TlsSim } from '../sim/TlsSim';
import css from '../tls.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

function Panel({ sim, attacker, style, head, right, children, fresh }: { sim: TlsSim; attacker?: boolean; style?: CSSProperties; head: ReactNode; right?: ReactNode; children: ReactNode; fresh?: string | number }) {
  const strip = sim.orient === 'portrait';
  return (
    <div key={fresh} className={cx(css.panel, attacker && css.attacker, strip && css.strip, fresh != null && css.fresh)} style={strip ? undefined : style}>
      <div className={css.head}>
        {head}
        {right && <span className={css.headRight}>{right}</span>}
      </div>
      {children}
    </div>
  );
}

const Sw = ({ c, label }: { c: string; label?: ReactNode }) => (
  <span className={css.swatch}>
    <i style={{ '--c': c } as CSSProperties} />
    {label && <em>{label}</em>}
  </span>
);

/* ------------------------------------------------------------------ */
/* Wire scene: what the attacker can read                             */
/* ------------------------------------------------------------------ */

export function WirePanel({ sim }: { sim: TlsSim }) {
  const w = sim.wire;
  const portrait = sim.orient === 'portrait';
  const eve = w.cfg.attacker === 'eve';
  const anchor = sim.boxes.get(eve ? 'eve' : 'mallory');
  if (!anchor || Number.isNaN(anchor.x)) return null;
  const who = eve ? 'Eve' : 'Mallory';
  let style: CSSProperties;
  if (eve) {
    const left = anchor.x + anchor.w / 2 + 22;
    style = { left, top: anchor.y - 58, width: Math.min(350, sim.w - left - 16) };
  } else {
    const width = 340;
    const left = Math.min(Math.max(16, anchor.x - width / 2 + 40), sim.w - width - 16);
    style = { left, top: anchor.y + anchor.h / 2 + 30, width };
  }

  if (w.cfg.story === 'browse') {
    const sni = w.sni;
    return (
      <Panel sim={sim} attacker style={{ ...style, top: (style.top as number) - 10 }} head={`${who}’s notebook`} right={`${w.packets} packets`}>
        <div className={css.kv}>
          <span>who</span>
          <span>
            {IP.alice} ↔ {IP.server}:443
          </span>
          <span>site</span>
          <span>{sni == null ? '…' : w.cfg.ech ? <i>{sni}</i> : <b>{sni} (from SNI)</b>}</span>
          <span>volume</span>
          <span>
            {w.packets} record{w.packets === 1 ? '' : 's'} · {fmtBytes(w.bytesSeen)} · timing
          </span>
          <span>content</span>
          <span>
            <i>{portrait ? 'encrypted: paths, cookies, pages' : 'encrypted: paths, headers, cookies, pages'}</i>
          </span>
        </div>
      </Panel>
    );
  }

  const last = w.captures.at(-1);
  const max = portrait ? 4 : 7;
  const lines = last ? last.lines.slice(0, max) : [];
  return (
    <Panel sim={sim} attacker style={style} head={`${who}’s view`} right={`${w.packets} ${portrait ? '' : w.packets === 1 ? 'packet ' : 'packets '}${eve ? 'copied' : 'seen'}`} fresh={last?.id}>
      {last ? (
        lines.map((l, i) => (
          <div key={i} className={css.cap} data-kind={l.kind}>
            {l.t}
          </div>
        ))
      ) : (
        <div className={css.empty}>{eve ? 'listening on the café Wi-Fi…' : 'every packet passes through her…'}</div>
      )}
      {w.cfg.story !== 'pair' && (
        <div className={css.foot}>
          {w.leaked.length ? (
            <>
              leaked: <b>{w.leaked.join(' · ')}</b>
            </>
          ) : (
            <>
              leaked: <i>{w.encrypted && w.packets ? 'nothing she can read' : 'nothing yet'}</i>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Paint scene: Eve's pots (or Mallory's two keys)                     */
/* ------------------------------------------------------------------ */

export function PaintPanel({ sim }: { sim: TlsSim }) {
  const p = sim.paint;
  const portrait = sim.orient === 'portrait';
  if (p.mitm) {
    const mal = sim.boxes.get(pid('mal'));
    if (!mal || Number.isNaN(mal.x)) return null;
    const a = p.fill.mFinA && !p.partial.mFinA ? p.fill.mFinA : null;
    const b = p.fill.mFinB && !p.partial.mFinB ? p.fill.mFinB : null;
    return (
      <Panel sim={sim} attacker style={{ left: mal.x, top: mal.y + mal.h / 2 + 16, width: 300, transform: 'translateX(-50%)' }} head="Mallory’s view">
        <div className={css.swatches}>
          <span>key with Alice</span>
          {a ? <Sw c={a} /> : <span className={css.empty}>…</span>}
          <span>key with server</span>
          {b ? <Sw c={b} /> : <span className={css.empty}>…</span>}
        </div>
        <div className={css.foot}>{a && b ? <b>decrypts, reads, re-encrypts everything</b> : 'running two exchanges at once'}</div>
      </Panel>
    );
  }
  const eve = sim.boxes.get(pid('eve'));
  if (!eve || Number.isNaN(eve.x)) return null;
  const has = p.eveHas;
  const tried = p.eveTry === 'done';
  return (
    <Panel sim={sim} attacker style={{ left: eve.x, top: eve.y + eve.h / 2 + 14, width: p.numbers ? 330 : 312, transform: 'translateX(-50%)' }} head="Eve copied" right={`${has.length} of 3`}>
      <div className={css.swatches}>
        {has.length === 0 && <span className={css.empty}>nothing yet</span>}
        {has.map((h) => (
          <Sw key={h.what} c={h.color} label={p.numbers ? `${h.what} = ${h.num}` : h.what} />
        ))}
      </div>
      {p.numbers ? (
        <div className={css.foot}>
          {has.length < 3 ? (
            <>needs a with 5ᵃ mod 23 = 8: tiny here, hopeless at 2²⁵⁵</>
          ) : (
            <>
              shortcut 8 × 19 mod 23 = <b>{DH.eve}</b>, not {DH.s}. She needs <b>a</b>.
            </>
          )}
        </div>
      ) : (
        <div className={css.verdict}>
          {p.eveTry === 'none' && <span className={css.empty}>{has.length === 3 ? 'about to try…' : 'watching the wire…'}</span>}
          {p.eveTry === 'mixing' && <span>pours her two mixtures together…</span>}
          {tried && (
            <>
              <span>her pot</span>
              <Sw c={p.eveColor} />
              <b>≠</b>
              <Sw c={p.shared} />
              <span>
                <i>{portrait ? 'too much common paint' : 'too much common paint: it can’t be un-mixed'}</i>
              </span>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}


/* ------------------------------------------------------------------ */
/* Cert scene: the browser's checklist (or the field tour)             */
/* ------------------------------------------------------------------ */

export function CertPanel({ sim }: { sim: TlsSim }) {
  const c = sim.cert;
  const portrait = sim.orient === 'portrait';
  const leaf = sim.boxes.get(cid('leaf'));
  const col = sim.boxes.get(cid('store'));
  const left = (col?.tx ?? sim.w * 0.44) + (col?.w ?? 330) / 2 + 26;
  const style: CSSProperties = { left, top: 206, width: Math.min(330, sim.w - left - 16) };
  if (c.cfg.mode === 'inspect') {
    if (!c.arrived || !leaf) {
      return (
        <Panel sim={sim} style={style} head="What’s in a certificate">
          <div className={css.empty}>the server is sending its chain…</div>
        </Panel>
      );
    }
    if (portrait) {
      const t = c.tour >= 0 && c.tour < TOUR.length ? TOUR[c.tour] : null;
      return (
        <Panel sim={sim} head={t ? t.title : 'CertificateVerify'} right={t ? `${c.tour + 1} / ${TOUR.length}` : 'proof'}>
          <div className={css.tourItem} data-on="true">
            {t ? t.text : 'The server signs the handshake with the private key. Only the real server can.'}
          </div>
        </Panel>
      );
    }
    return (
      <Panel sim={sim} style={style} head="What’s in a certificate">
        <div className={css.tour}>
          {TOUR.map((t, i) => (
            <div key={t.k} className={css.tourItem} data-on={c.tour === i}>
              <b>{t.title}</b>
              {t.text}
            </div>
          ))}
          <div className={css.tourItem} data-on={c.tour === TOUR.length}>
            <b>+ CertificateVerify</b>
            Certificates are public. So the server also signs the handshake with the private key, proving it’s the real owner.
          </div>
        </div>
      </Panel>
    );
  }

  const running = CHECKS.find((k) => c.status[k.id] === 'run');
  const failed = CHECKS.find((k) => c.status[k.id] === 'fail');
  const sc = c.scenario;
  const detail = failed
    ? { tone: 'fail', title: `✗ ${failed.label}.`, text: sc?.warning ?? '' }
    : running
      ? { tone: 'run', title: running.label, text: running.detail }
      : c.browser === 'secure'
        ? { tone: 'ok', title: 'All checks pass.', text: 'The padlock appears and the encrypted HTTP request can go.' }
        : c.arrived
          ? { tone: 'run', title: c.fake ? 'A certificate arrived.' : 'Chain received.', text: c.fake ? `${sc?.title ?? ''}.` : 'Run the checks, one by one.' }
          : { tone: 'run', title: 'Connecting…', text: `Alice opened https://${HOST}.` };

  if (portrait) {
    return (
      <Panel sim={sim} head="Browser checks" right={`today ${TODAY}`}>
        <div className={css.stripChecks}>
          {CHECKS.map((k) => (
            <span key={k.id} className={css.check} data-s={c.status[k.id]}>
              <span className={css.mark}>{mark(c.status[k.id])}</span>
              {k.short}
            </span>
          ))}
        </div>
        <div className={css.detail} data-tone={detail.tone}>
          <b>{detail.title}</b> {detail.text}
        </div>
      </Panel>
    );
  }
  return (
    <Panel sim={sim} style={style} head="Browser checks" right={`today ${TODAY}`}>
      <div className={css.checks}>
        {CHECKS.map((k) => (
          <div key={k.id} className={css.check} data-s={c.status[k.id]}>
            <span className={css.mark}>{mark(c.status[k.id])}</span>
            <span>{k.label}</span>
          </div>
        ))}
      </div>
      <div className={css.detail} data-tone={detail.tone}>
        <b>{detail.title}</b> {detail.text}
      </div>
    </Panel>
  );
}

const mark = (s: string) => (s === 'ok' ? '✓' : s === 'fail' ? '✗' : s === 'run' ? '•' : s === 'skip' ? '–' : '');

/* ------------------------------------------------------------------ */
/* Handshake scene: Eve's notebook                                     */
/* ------------------------------------------------------------------ */

const leaky = (s: string) => s.includes(HOST) || s.includes('Cookie') || s.includes('Card');

export function NotebookPanel({ sim }: { sim: TlsSim }) {
  const s = sim.shake;
  const g = s.geo();
  const entries = s.notebook();
  const portrait = !g.land;
  const shown = portrait ? entries.slice(-2) : entries;
  const style: CSSProperties | undefined = g.panel ? { left: g.panel.x, top: g.panel.y, width: g.panel.w, maxHeight: g.panel.h, overflow: 'hidden' } : undefined;
  const clearSite = s.cfg.proto !== 'http' && !s.cfg.ech;
  const summary =
    s.cfg.proto === 'http'
      ? { bad: true, text: 'everything: pages, cookies, passwords' }
      : s.cfg.ech
        ? { bad: false, text: 'IPs, sizes and timing, but not the site name' }
        : { bad: true, text: `the site (${HOST}), IPs, sizes, timing` };
  return (
    <Panel sim={sim} attacker style={style} head="Eve’s notebook" right={portrait ? undefined : `${entries.length} flights`} fresh={portrait ? undefined : undefined}>
      {shown.length === 0 && <div className={css.empty}>waiting at her tap…</div>}
      {shown.map((e) => (
        <div key={e.n} className={css.note}>
          <div className={css.noteHead}>
            <span>{e.dir === 'cs' ? '→' : e.dir === 'sc' ? '←' : '⤳'}</span>
            {e.clear.length ? e.clear.map((c) => c.name).join(', ') : `${e.enc.count} encrypted record${e.enc.count === 1 ? '' : 's'}`}
          </div>
          {e.clear
            .filter((c) => c.eve && (c.eve !== 'TCP control packet' || e.clear.length === 1))
            .slice(0, portrait ? 1 : 3)
            .map((c) => (
              <div key={c.name} className={css.noteLine} data-kind={e.dir === 'xs' ? 'attack' : leaky(c.eve) ? 'leak' : undefined}>
                {c.eve}
              </div>
            ))}
          {e.clear.length > 0 && e.enc.count > 0 && (
            <div className={css.noteLine} data-kind="enc">
              + {e.enc.count} encrypted · {fmtBytes(e.enc.bytes)}
            </div>
          )}
          {e.clear.length === 0 && (
            <div className={css.noteLine} data-kind="enc">
              {fmtBytes(e.enc.bytes)} of ciphertext
            </div>
          )}
        </div>
      ))}
      {!portrait && entries.length > 0 && s.now >= s.endT && (
        <div className={css.foot}>
          she learned: {summary.bad ? <b>{summary.text}</b> : <i>{summary.text}</i>}
          {clearSite && s.cfg.proto === 'tls12' && <div>TLS 1.2 even showed her the certificate.</div>}
        </div>
      )}
    </Panel>
  );
}
