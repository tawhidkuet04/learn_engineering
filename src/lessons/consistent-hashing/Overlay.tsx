'use client';

import type { ReactNode } from 'react';
import { Hud, type HudItem } from '@/components/stage/chrome';
import { StagePrompt } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import { billions, commas, pct } from './hash';
import { SERVERS, hrwScore, keyString, modMoveFraction, preferenceWalk, type Token } from './ring';
import type { RingSim } from './sim';
import css from './ch.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export type HudKey = 'hit' | 'db' | 'servers' | 'moved' | 'modmoved' | 'busiest' | 'tokens' | 'lost' | 'down' | 'replicas' | 'points' | 'keys';
export type ReadoutKey = 'modn' | 'bmoves' | 'hashes' | 'shares' | 'lookup' | 'moves' | 'pref' | 'write' | 'hrw';

/* ------------------------------------------------------------------ */
/* Numbers the readouts share                                          */
/* ------------------------------------------------------------------ */

/** The most overloaded server's share divided by its fair share (weight-aware). */
export function busiest(sim: RingSim) {
  const ids = sim.presentList();
  if (!ids.length) return 1;
  const wOf = (id: string) => sim.srv.get(id)?.weight ?? 1;
  const totalW = ids.reduce((s, id) => s + wOf(id), 0);
  return Math.max(...ids.map((id) => (sim.shares.get(id) ?? 0) / (wOf(id) / totalW)));
}

/** Standard deviation of each server's share around its fair share, relative to it. */
export function spread(sim: RingSim) {
  const ids = sim.presentList();
  if (ids.length < 2) return 0;
  const totalW = ids.reduce((s, id) => s + (sim.srv.get(id)?.weight ?? 1), 0);
  let acc = 0;
  for (const id of ids) {
    const fair = (sim.srv.get(id)?.weight ?? 1) / totalW;
    const r = (sim.shares.get(id) ?? 0) / fair - 1;
    acc += r * r;
  }
  return Math.sqrt(acc / ids.length);
}

let modTable: { label: string; f: number }[] | null = null;
function modTableRows() {
  if (!modTable) modTable = [4, 10, 100].map((n) => ({ label: `${n} → ${n + 1}`, f: modMoveFraction(n, n + 1) }));
  return modTable;
}

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

function hudItems(sim: RingSim, keys: HudKey[]): HudItem[] {
  const out: HudItem[] = [];
  for (const k of keys) {
    if (k === 'hit') {
      const r = sim.hitRate();
      out.push({ label: 'Cache hit rate', value: r == null ? '—' : pct(r, 0), tone: r == null ? undefined : r >= 0.9 ? 'good' : r >= 0.6 ? 'warn' : 'bad' });
    } else if (k === 'db') {
      const r = sim.dbRate();
      out.push({ label: 'Database reads', value: r.toFixed(1), unit: '/s', tone: r >= 1.4 ? 'bad' : r >= 0.6 ? 'warn' : undefined });
    } else if (k === 'servers') {
      out.push({ label: 'Servers', value: sim.cfg.view === 'buckets' ? sim.blist.length : sim.presentList().length });
    } else if (k === 'keys') {
      out.push({ label: 'Keys', value: sim.keys.filter((x) => x.placed).length });
    } else if (k === 'moved') {
      const c = sim.lastChange;
      out.push({ label: 'Moved · ring', value: c && c.modMoved != null ? `${c.moved}/${c.total}` : '—', tone: c && c.modMoved != null ? 'good' : undefined });
    } else if (k === 'modmoved') {
      const c = sim.lastChange;
      out.push({ label: 'Moved · mod N', value: c && c.modMoved != null ? `${c.modMoved}/${c.total}` : '—', tone: c && c.modMoved != null ? 'bad' : undefined });
    } else if (k === 'busiest') {
      const b = busiest(sim);
      out.push({ label: 'Busiest ÷ fair', value: `${b.toFixed(2)}×`, tone: b <= 1.1 ? 'good' : b <= 1.4 ? 'warn' : 'bad' });
    } else if (k === 'tokens') {
      out.push({ label: 'Tokens / server', value: sim.cfg.tokens });
    } else if (k === 'points') {
      out.push({ label: 'Points on ring', value: sim.ring.length });
    } else if (k === 'lost') {
      const n = sim.lostCount();
      out.push({ label: 'No live copy', value: n, unit: 'keys', tone: n ? 'bad' : 'good' });
    } else if (k === 'down') {
      out.push({ label: 'Servers down', value: sim.presentList().filter((id) => !sim.srv.get(id)?.up).length });
    } else if (k === 'replicas') {
      out.push({ label: 'Copies (R)', value: sim.cfg.replicas });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Readout shell                                                       */
/* ------------------------------------------------------------------ */

function Ro({ head, children, fresh, className }: { head: ReactNode; children: ReactNode; fresh?: boolean; className?: string }) {
  return (
    <div className={cx(css.ro, fresh && css.roFresh, className)}>
      <div className={css.roHead}>{head}</div>
      {children}
    </div>
  );
}

const Dot = ({ c }: { c: string }) => <i className={css.dot} style={{ background: c }} />;

function Bar({ f, color, max = 1 }: { f: number; color: string; max?: number }) {
  return (
    <span className={css.bar}>
      <i style={{ width: `${Math.min(100, (f / max) * 100)}%`, background: color }} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* The readouts                                                        */
/* ------------------------------------------------------------------ */

function ModnReadout({ sim, compact }: { sim: RingSim; compact?: boolean }) {
  const r = sim.lastReq;
  if (!r) {
    return (
      <Ro head="hash mod N">
        <div className={css.dim}>waiting for a request…</div>
      </Ro>
    );
  }
  const name = SERVERS[r.sid].name;
  const outcome =
    r.result === 'hit' ? (
      <span style={{ color: SIG.res }}>hit</span>
    ) : r.result === 'miss' ? (
      <span style={{ color: SIG.heavy }}>miss → database</span>
    ) : (
      <span className={css.dim}>in flight</span>
    );
  if (compact) {
    return (
      <Ro head="hash mod N">
        <div className={css.line}>
          hash(user:{r.key}) mod {r.n} = <em>{r.idx}</em> → <span style={{ color: SERVERS[r.sid].color }}>{name}</span>
        </div>
        <div className={css.result}>{outcome}</div>
      </Ro>
    );
  }
  return (
    <Ro head="hash mod N">
      <div className={css.line}>
        hash(&quot;user:{r.key}&quot;) = <b>{commas(r.h)}</b>
      </div>
      <div className={css.line}>
        {commas(r.h)} mod {r.n} = <em>{r.idx}</em>
      </div>
      <div className={cx(css.result, css.row2)}>
        <span>
          servers[{r.idx}] = <span style={{ color: SERVERS[r.sid].color }}>{name}</span>
        </span>
        {outcome}
      </div>
    </Ro>
  );
}

function BMovesReadout({ sim, compact }: { sim: RingSim; compact?: boolean }) {
  const c = sim.bChange;
  return (
    <Ro head={c ? `resized · ${c.n0} → ${c.n1} servers` : 'after the resize'} fresh={!!c && sim.vt - c.vt < 1.2}>
      {c ? (
        <>
          <div className={css.line}>
            <b className={css.bad}>{c.moved}</b> of {c.total} keys map elsewhere
          </div>
          <div className={css.barGap}>
            <Bar f={c.moved / c.total} color={SIG.err} />
          </div>
          {!compact && (
            <div className={css.dimLine}>
              at 100,000 keys: <b className={css.bad}>{pct(c.scale)}</b> moved
            </div>
          )}
        </>
      ) : (
        <div className={css.dim}>no resize yet</div>
      )}
      {!compact && (
        <div className={css.result}>
          <div className={css.dimSmall}>add one server, 100,000 keys:</div>
          {modTableRows().map((r) => (
            <div key={r.label} className={css.row2}>
              <span>{r.label} servers</span>
              <span className={css.bad}>{pct(r.f)} move</span>
            </div>
          ))}
        </div>
      )}
    </Ro>
  );
}

function HashesReadout({ sim, compact }: { sim: RingSim; compact?: boolean }) {
  const names = ['alice', 'bob', 'carol', 'dave'];
  return (
    <Ro head="where each key lands">
      {names.map((n) => {
        const k = sim.keyByName(n);
        if (!k) return null;
        return compact ? null : (
          <div key={n} className={css.row3}>
            <span>{k.label}</span>
            <span className={css.num}>{commas(k.h)}</span>
            <em>{pct(k.f)}</em>
          </div>
        );
      })}
      {compact && (
        <div className={css.line}>
          alice → <em>{commas(sim.keyByName('alice')?.h ?? 0)}</em> ({pct(sim.keyByName('alice')?.f ?? 0)} along)
        </div>
      )}
      <div className={css.result}>position = hash ÷ 2³² of the way round</div>
    </Ro>
  );
}

function SharesReadout({ sim, compact }: { sim: RingSim; compact?: boolean }) {
  const ids = sim.presentList();
  if (!ids.length) {
    return (
      <Ro head="share of the keys">
        <div className={css.dim}>no servers yet</div>
      </Ro>
    );
  }
  const b = busiest(sim);
  if (compact) {
    return (
      <Ro head={`share of the keys · busiest ${b.toFixed(2)}× fair`}>
        <div className={css.stack}>
          {ids.map((id) => (
            <i key={id} style={{ width: `${(sim.shares.get(id) ?? 0) * 100}%`, background: SERVERS[id].color }} title={SERVERS[id].name} />
          ))}
        </div>
        <div className={css.stackLegend}>
          {ids.map((id) => (
            <span key={id}>
              <Dot c={SERVERS[id].color} />
              {id} {pct(sim.shares.get(id) ?? 0, 0)}
            </span>
          ))}
        </div>
      </Ro>
    );
  }
  const max = Math.max(0.5, ...ids.map((id) => sim.shares.get(id) ?? 0));
  const tokens = sim.cfg.tokens > 1 || ids.some((id) => (sim.srv.get(id)?.weight ?? 1) !== 1);
  return (
    <Ro head="share of the keys">
      <div className={css.shares}>
        {ids.map((id) => {
          const s = sim.srv.get(id);
          const share = sim.shares.get(id) ?? 0;
          return (
            <div key={id} className={css.shareRow}>
              <span className={css.shareName}>
                <Dot c={s?.up ? SERVERS[id].color : SIG.err} />
                {SERVERS[id].name}
              </span>
              <Bar f={share} max={max} color={s?.up ? SERVERS[id].color : SIG.err} />
              <span className={css.num}>{pct(share)}</span>
              {tokens && <span className={css.tok}>×{sim.tokensOf(id)}</span>}
            </div>
          );
        })}
      </div>
      <div className={css.result}>
        busiest ÷ fair share = <b className={b <= 1.1 ? css.good : b <= 1.4 ? css.warn : css.bad}>{b.toFixed(2)}×</b>
      </div>
    </Ro>
  );
}

function LookupReadout({ sim, compact }: { sim: RingSim; compact?: boolean }) {
  const info = sim.lookupInfo();
  if (!info) {
    return (
      <Ro head="lookup · binary search">
        <div className={css.dim}>waiting for a key…</div>
      </Ro>
    );
  }
  const { key, revealed, owner, wrap } = info;
  const firsts: Token[] = sim.ring.filter((t) => t.i === 0);
  const rows: ({ kind: 'tok'; t: Token } | { kind: 'key' })[] = [];
  let placedKey = false;
  for (const t of firsts) {
    if (!placedKey && key.h <= t.h) {
      rows.push({ kind: 'key' });
      placedKey = true;
    }
    rows.push({ kind: 'tok', t });
  }
  if (!placedKey) rows.push({ kind: 'key' });
  if (compact) {
    return (
      <Ro head="lookup">
        <div className={css.line}>
          {key.label} → hash <em>{billions(key.h)}</em>
        </div>
        <div className={css.result}>
          first server clockwise ≥ hash → {revealed && owner ? <b style={{ color: SERVERS[owner].color }}>{SERVERS[owner].name}</b> : <b>?</b>}
          {revealed && wrap ? <span className={css.dim}> (wrapped past 0)</span> : null}
        </div>
      </Ro>
    );
  }
  return (
    <Ro head="lookup · binary search">
      <div className={css.line}>
        hash(&quot;{key.label}&quot;) = <em>{commas(key.h)}</em>
      </div>
      <div className={css.sorted}>
        {rows.map((r, i) =>
          r.kind === 'key' ? (
            <div key={`k${i}`} className={css.sortedKey}>
              <span>▸ {key.label}</span>
              <span className={css.num}>{billions(key.h)}</span>
            </div>
          ) : (
            <div key={r.t.sid} className={cx(css.sortedRow, revealed && owner === r.t.sid && css.sortedHit)}>
              <span>
                <Dot c={SERVERS[r.t.sid].color} />
                {SERVERS[r.t.sid].name}
              </span>
              <span className={css.num}>{billions(r.t.h)}</span>
            </div>
          ),
        )}
      </div>
      <div className={css.result}>
        {revealed && owner ? (
          <>
            first server at or after the key: <b style={{ color: SERVERS[owner].color }}>{SERVERS[owner].name}</b>
            {wrap && <div className={css.dimSmall}>nothing after it, so wrap to the top of the list</div>}
          </>
        ) : (
          <>
            first server at or after the key: <b>?</b>
          </>
        )}
      </div>
    </Ro>
  );
}

function MovesReadout({ sim, compact }: { sim: RingSim; compact?: boolean }) {
  const c = sim.lastChange;
  const fresh = !!c && sim.vt - c.vt < 1.2;
  if (!c) {
    return (
      <Ro head="keys moved">
        <div className={css.dim}>No change yet.</div>
      </Ro>
    );
  }
  const name = SERVERS[c.sid].name;
  if (c.kind === 'fail' || c.kind === 'revive') {
    return (
      <Ro head={`${name} ${c.kind === 'fail' ? 'crashed' : 'is back'}`} fresh={fresh}>
        <div className={css.row2}>
          <span>{c.kind === 'fail' ? 'keys failed over' : 'keys handed back'}</span>
          <span>{c.moved}</span>
        </div>
        <div className={css.row2}>
          <span>keys with no live copy</span>
          <span className={c.lost ? css.bad : css.good}>{sim.lostCount()}</span>
        </div>
      </Ro>
    );
  }
  const verb = c.kind === 'join' ? 'joined' : 'left';
  // Where the keys came from / went, measured on 100,000 keys (a 26-key sample is too lumpy).
  const split = c.scale ? (c.kind === 'join' ? c.scale.from : c.scale.to) : c.flow;
  const splitTotal = [...split.values()].reduce((s, n) => s + n, 0) || 1;
  const flow = [...split.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <Ro head={`${name} ${verb} · ${c.n0} → ${c.n1} servers`} fresh={fresh}>
      <div className={css.cmp}>
        <span className={css.cmpLabel}>consistent hashing</span>
        <Bar f={c.moved / Math.max(1, c.total)} color={SIG.res} />
        <span className={css.num}>
          {c.moved}/{c.total}
        </span>
        <span className={css.cmpLabel}>hash mod N</span>
        <Bar f={(c.modMoved ?? 0) / Math.max(1, c.total)} color={SIG.err} />
        <span className={css.num}>
          {c.modMoved}/{c.total}
        </span>
      </div>
      {!compact && c.scale && (
        <div className={css.dimLine}>
          at 100,000 keys: <b className={css.good}>{pct(c.scale.ring / c.scale.total)}</b> vs <b className={css.bad}>{pct(c.scale.mod / c.scale.total)}</b>
        </div>
      )}
      {!compact && flow.length > 0 && (
        <div className={css.result}>
          {c.kind === 'join' ? 'taken from ' : 'handed to '}
          {flow.length === 1 ? (
            <>
              <span style={{ color: SERVERS[flow[0][0]].color }}>{SERVERS[flow[0][0]].name}</span>
              <span className={css.dim}> only</span>
            </>
          ) : (
            flow.map(([sid, n], i) => (
              <span key={sid}>
                {i > 0 ? ' · ' : ''}
                <span style={{ color: SERVERS[sid].color }}>{sid}</span> {pct(n / splitTotal, 0)}
              </span>
            ))
          )}
        </div>
      )}
    </Ro>
  );
}

function PrefReadout({ sim, compact }: { sim: RingSim; compact?: boolean }) {
  const k = sim.keyByName(sim.selected);
  if (!k) {
    return (
      <Ro head="preference list">
        <div className={css.dim}>click a key</div>
      </Ro>
    );
  }
  const { list, steps } = preferenceWalk(sim.ring, k.h, sim.cfg.replicas);
  const skipped = steps.filter((s) => s.skip).length;
  const serving = list.find((t) => sim.srv.get(t.sid)?.up);
  if (compact) {
    return (
      <Ro head={`${k.label} · R = ${sim.cfg.replicas}`}>
        <div className={css.line}>
          {list.map((t, i) => (
            <span key={t.sid} style={{ color: sim.srv.get(t.sid)?.up ? SERVERS[t.sid].color : SIG.err, marginRight: 8 }}>
              {i + 1}·{t.sid}
              {sim.srv.get(t.sid)?.up ? '' : '✕'}
            </span>
          ))}
          {skipped > 0 && <span className={css.dim}>skipped {skipped}</span>}
        </div>
        <div className={css.result}>
          no live copy: <b className={sim.lostCount() ? css.bad : css.good}>{sim.lostCount()} keys</b>
        </div>
      </Ro>
    );
  }
  return (
    <Ro head={`${k.label} · R = ${sim.cfg.replicas}`}>
      {list.map((t, i) => {
        const up = sim.srv.get(t.sid)?.up;
        return (
          <div key={t.sid} className={css.prefRow}>
            <span className={css.prefN} style={{ background: up ? SERVERS[t.sid].color : 'transparent', borderColor: up ? SERVERS[t.sid].color : SIG.err, color: up ? '#0b1020' : SIG.err }}>
              {i + 1}
            </span>
            <span style={{ color: up ? 'var(--text-1)' : SIG.err }}>{SERVERS[t.sid].name}</span>
            <span className={css.dim}>{!up ? 'down' : serving?.sid === t.sid ? (i === 0 ? 'coordinator' : 'answers now') : 'copy'}</span>
          </div>
        );
      })}
      {skipped > 0 && (
        <div className={css.dimLine}>
          skipped {skipped} token{skipped > 1 ? 's' : ''} of a server that already has a copy
        </div>
      )}
      <div className={css.result}>
        keys with no live copy: <b className={sim.lostCount() ? css.bad : css.good}>{sim.lostCount()}</b>
      </div>
    </Ro>
  );
}

function WriteReadout({ sim, compact }: { sim: RingSim; compact?: boolean }) {
  const w = sim.write;
  if (!w) {
    return (
      <Ro head="replicated write">
        <div className={css.dim}>waiting for a write…</div>
      </Ro>
    );
  }
  return (
    <Ro head={`PUT user:${w.key} · R = ${w.reps.length}, quorum ${w.need}`}>
      {!compact &&
        w.reps.map((sid, i) => (
          <div key={sid} className={css.prefRow}>
            <span className={css.prefN} style={{ background: SERVERS[sid].color, borderColor: SERVERS[sid].color, color: '#0b1020' }}>
              {i + 1}
            </span>
            <span>{SERVERS[sid].name}</span>
            <span className={w.acked.has(sid) ? css.good : css.dim}>{sid === w.coord ? 'coordinator' : 'replica'} {w.acked.has(sid) ? '✓' : '…'}</span>
          </div>
        ))}
      <div className={cx(css.result, css.row2)}>
        <span>
          {w.acked.size}/{w.reps.length} stored
        </span>
        {w.done ? <b className={css.good}>quorum met → OK</b> : <span className={css.dim}>waiting for {w.need}</span>}
      </div>
    </Ro>
  );
}

function HrwReadout({ sim, compact }: { sim: RingSim; compact?: boolean }) {
  const key = keyString(sim.hrwKey());
  const live = sim.hrwLive();
  const ranked = [...live].sort((a, b) => hrwScore(key, b) - hrwScore(key, a));
  const c = sim.hrwChange;
  return (
    <Ro head={`rendezvous · ${key}`}>
      <div className={css.row2}>
        <span>winner</span>
        <b style={{ color: SERVERS[ranked[0]].color, fontWeight: 500 }}>{SERVERS[ranked[0]].name}</b>
      </div>
      {!compact && (
        <div className={css.row2}>
          <span>runner-up</span>
          <span style={{ color: SERVERS[ranked[1]].color }}>{SERVERS[ranked[1]].name}</span>
        </div>
      )}
      <div className={css.result}>
        {c ? (
          <>
            {SERVERS[c.sid].name} removed: <b>{c.moved}</b> of {c.total} keys moved, each to its runner-up
          </>
        ) : (
          <span className={css.dim}>
            if {SERVERS[ranked[0]].name} goes, {key} moves to <span style={{ color: SERVERS[ranked[1]].color }}>{SERVERS[ranked[1]].name}</span>
          </span>
        )}
      </div>
    </Ro>
  );
}

function renderReadout(k: ReadoutKey, sim: RingSim, compact: boolean) {
  switch (k) {
    case 'modn':
      return <ModnReadout key={k} sim={sim} compact={compact} />;
    case 'bmoves':
      return <BMovesReadout key={k} sim={sim} compact={compact} />;
    case 'hashes':
      return <HashesReadout key={k} sim={sim} compact={compact} />;
    case 'shares':
      return <SharesReadout key={k} sim={sim} compact={compact} />;
    case 'lookup':
      return <LookupReadout key={k} sim={sim} compact={compact} />;
    case 'moves':
      return <MovesReadout key={k} sim={sim} compact={compact} />;
    case 'pref':
      return <PrefReadout key={k} sim={sim} compact={compact} />;
    case 'write':
      return <WriteReadout key={k} sim={sim} compact={compact} />;
    case 'hrw':
      return <HrwReadout key={k} sim={sim} compact={compact} />;
  }
}

/* ------------------------------------------------------------------ */
/* Stage overlay                                                       */
/* ------------------------------------------------------------------ */

export function StageOverlay({ sim, hud = [], side = [], strip, hint }: { sim: RingSim; hud?: HudKey[]; side?: ReadoutKey[]; strip?: ReadoutKey | null; hint?: string }) {
  const land = sim.orient === 'landscape';
  const buckets = sim.cfg.view === 'buckets';
  const app = sim.boxes.get('app');
  const db = sim.boxes.get('db');
  return (
    <>
      <Hud items={hudItems(sim, hud)} />
      {land && buckets && (
        <>
          {side.includes('modn') && app && (
            <div className={css.anchored} style={{ left: Math.max(app.x, 145), top: app.y + app.h / 2 + 16, width: 266 }}>
              <ModnReadout sim={sim} />
            </div>
          )}
          {side.includes('bmoves') && db && (
            <div className={css.anchored} style={{ left: Math.min(db.x, sim.w - 136), top: db.y + db.h / 2 + 16, width: 248 }}>
              <BMovesReadout sim={sim} />
            </div>
          )}
        </>
      )}
      {land && !buckets && side.length > 0 && (
        <div className={css.col} style={{ width: sim.geo.side ? sim.geo.side - 28 : 262 }}>
          {side.map((k) => renderReadout(k, sim, false))}
        </div>
      )}
      {!land && strip && <div className={css.strip}>{renderReadout(strip, sim, true)}</div>}
      <Prompts sim={sim} hint={hint} />
    </>
  );
}

function Prompts({ sim, hint }: { sim: RingSim; hint?: string }) {
  const q = sim.game?.pending;
  const a = sim.asking;
  const g = sim.geo;
  if (q && a) {
    if (a.kind === 'owner') {
      return (
        <StagePrompt x={g.cx} y={g.cy + (g.small ? 6 : 10)}>
          {g.small ? 'Tap the owner' : 'Which server owns it? Click one'}
        </StagePrompt>
      );
    }
    const b = a.sid ? sim.boxes.get(`srv:${a.sid}`) : null;
    if (a.kind === 'join' && b) {
      if (g.small) {
        return (
          <StagePrompt x={g.cx} y={g.cy + 6}>
            Who gives up keys to {a.sid}?
          </StagePrompt>
        );
      }
      const text = 'Who hands keys over? Click one';
      const half = (text.length * 6.7 + 22) / 2;
      return (
        <StagePrompt x={Math.min(Math.max(b.x, half + 8), sim.w - half - 8)} y={b.y - b.h / 2 - 8}>
          {text}
        </StagePrompt>
      );
    }
    if (a.kind === 'modn' && b) {
      return g.small ? (
        <StagePrompt x={sim.w / 2} y={b.y - b.h / 2 - 12}>
          How many keys move?
        </StagePrompt>
      ) : (
        <StagePrompt x={b.x} y={b.y + b.h / 2 - 12}>
          How many keys move?
        </StagePrompt>
      );
    }
  }
  if (hint && !sim.lastChange && !q) {
    return (
      <StagePrompt x={g.cx} y={g.cy + (g.small ? 6 : 10)}>
        {g.small ? hint.replace(/^Click/, 'Tap') : hint}
      </StagePrompt>
    );
  }
  return null;
}
