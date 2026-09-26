'use client';

import type { ReactNode } from 'react';
import { Hud, type HudItem } from '@/components/stage/chrome';
import { StagePrompt, type InspectorLine } from '@/components/stage/overlays';
import kit from '@/components/stage/overlay.module.css';
import { SIG } from '@/lib/sim/colors';
import { PEOPLE, SERVER_META, type InspKind, type PersonId, type WsSim } from './sim';
import css from './ws.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export type HudKey =
  | 'waiting'
  | 'oldest'
  | 'reqs'
  | 'empty'
  | 'avg'
  | 'worst'
  | 'delivered'
  | 'pings'
  | 'closes'
  | 'bob'
  | 'missed'
  | 'resynced'
  | 'conns'
  | 'published';

export type ReadoutKey = 'mailbox' | 'accept' | 'conns' | 'idle' | 'client' | 'redis' | 'stream';

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

const secs = (v: number | null) => (v == null ? '–' : v.toFixed(1));

/** Messages that reached the server a while ago but never reached someone who should have them. */
function lostCount(sim: WsSim) {
  let n = 0;
  for (const m of sim.history) {
    if (m.atServer == null || sim.t - m.atServer < 2.2) continue;
    for (const r of m.expect) if (!m.got.has(r)) n++;
  }
  return n;
}

function hudItems(sim: WsSim, keys: HudKey[], compact: boolean): HudItem[] {
  const out: HudItem[] = [];
  const s = sim.stat;
  for (const k of keys) {
    if (k === 'waiting') {
      const n = sim.missingFor('bob').length;
      out.push({ label: compact ? 'For Bob' : 'Waiting for Bob', value: n, unit: n === 1 ? 'msg' : 'msgs', tone: n ? 'warn' : undefined });
    } else if (k === 'oldest') {
      const o = sim.oldestWaiting('bob');
      out.push({ label: compact ? 'Waiting' : 'Oldest waiting', value: secs(o), unit: 's', tone: o == null ? undefined : o > 5 ? 'bad' : 'warn' });
    } else if (k === 'reqs') {
      out.push({ label: compact ? 'Requests' : 'HTTP requests', value: s.reqs });
    } else if (k === 'empty') {
      const pctv = s.responses ? Math.round((s.empty / s.responses) * 100) : 0;
      out.push({ label: compact ? 'Empty' : 'Came back empty', value: s.empty, unit: s.responses ? `${pctv}%` : undefined, tone: pctv >= 50 ? 'bad' : pctv > 0 ? 'warn' : undefined });
    } else if (k === 'avg') {
      const a = sim.avgDelay();
      out.push({ label: 'Avg delay', value: secs(a), unit: 's', tone: a == null ? undefined : a > 2.6 ? 'warn' : 'good' });
    } else if (k === 'worst') {
      const w = sim.worstDelay();
      out.push({ label: compact ? 'Worst' : 'Worst delay', value: secs(w), unit: 's', tone: w == null ? undefined : w > 4 ? 'bad' : w > 2.6 ? 'warn' : 'good' });
    } else if (k === 'delivered') {
      const lost = lostCount(sim);
      out.push({ label: 'Delivered', value: `${s.delivered}/${s.expected}`, tone: lost ? 'bad' : s.delivered ? 'good' : undefined });
    } else if (k === 'pings') {
      out.push({ label: compact ? 'Pings' : 'Pings sent', value: s.pings });
    } else if (k === 'closes') {
      out.push({ label: compact ? 'Cut' : 'Cut by proxy', value: s.proxyCloses, tone: s.proxyCloses ? 'bad' : 'good' });
    } else if (k === 'bob') {
      const p = sim.ppl.get('bob')!;
      out.push({
        label: compact ? 'Bob' : 'Bob’s socket',
        value: p.conn === 'open' ? 'open' : p.conn === 'connecting' ? 'handshake' : p.conn === 'waiting' ? 'retrying' : 'closed',
        tone: p.conn === 'open' ? (p.net ? 'good' : 'bad') : p.conn === 'waiting' ? 'warn' : undefined,
      });
    } else if (k === 'missed') {
      const n = sim.missingFor('bob').length;
      out.push({ label: compact ? 'Missed' : 'Bob hasn’t got', value: n, unit: n === 1 ? 'msg' : 'msgs', tone: n ? 'warn' : 'good' });
    } else if (k === 'resynced') {
      out.push({ label: 'Resynced', value: s.resynced, tone: s.resynced ? 'good' : undefined });
    } else if (k === 'conns') {
      const a = sim.srv.get('srv1')!.conns.size;
      const b = sim.srv.get('srv2')!.conns.size;
      out.push({ label: 'ws-1 · ws-2', value: `${a} · ${b}`, unit: 'sockets', tone: Math.abs(a - b) >= 3 ? 'warn' : undefined });
    } else if (k === 'published') {
      out.push({ label: compact ? 'Published' : 'PUBLISH calls', value: s.published });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Readouts                                                            */
/* ------------------------------------------------------------------ */

function Ro({ head, children, fresh }: { head: ReactNode; children: ReactNode; fresh?: boolean }) {
  return (
    <div className={cx(css.ro, fresh && css.roFresh)}>
      <div className={css.roHead}>{head}</div>
      {children}
    </div>
  );
}

const Dot = ({ c }: { c: string }) => <i className={css.dot} style={{ background: c }} />;

function MailboxReadout({ sim, compact }: { sim: WsSim; compact: boolean }) {
  const waiting = sim.missingFor('bob');
  const bob = sim.ppl.get('bob')!;
  const mode = sim.cfg.mode;
  const held = mode === 'long' && bob.lp === 'held';
  return (
    <Ro head="server · waiting for Bob">
      {waiting.length ? (
        waiting.slice(-(compact ? 1 : 3)).map((m) => (
          <div key={m.id} className={css.row2}>
            <span className={css.line}>
              <Dot c={PEOPLE[m.from].color} />#{m.id} {m.text}
            </span>
            <span className={css.warn}>{(sim.t - m.tSent).toFixed(1)} s</span>
          </div>
        ))
      ) : (
        <div className={css.dim}>nothing: Bob is up to date</div>
      )}
      <div className={css.result}>
        {mode === 'http' ? (
          <>
            open requests from Bob: <b>0</b> <span className={css.dim}>· nothing to answer</span>
          </>
        ) : mode === 'short' ? (
          <>
            next poll in <b>{Math.max(0, bob.nextPoll - sim.t).toFixed(1)} s</b>
          </>
        ) : held ? (
          <>
            Bob&apos;s request held <b>{(sim.t - bob.heldSince).toFixed(1)} s</b> <span className={css.dim}>/ {sim.cfg.lpTimeout} s max</span>
          </>
        ) : (
          <span className={css.dim}>Bob&apos;s next request is on its way</span>
        )}
      </div>
    </Ro>
  );
}

const KEY = 'dGhlIHNhbXBsZSBub25jZQ==';
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const SHA = ['b37a4f2cc0624f1690f6', '4606cf385945b2bec4ea'];
const ACCEPT = 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=';

function AcceptReadout({ sim, compact }: { sim: WsSim; compact: boolean }) {
  const age = sim.vt - sim.acceptVt;
  if (sim.acceptVt < 0) {
    return (
      <Ro head="Sec-WebSocket-Accept">
        <div className={css.dim}>waiting for the upgrade request…</div>
      </Ro>
    );
  }
  const shown = age < 0.35 ? 1 : age < 0.8 ? 2 : age < 1.3 ? 3 : 4;
  if (compact) {
    return (
      <Ro head="Sec-WebSocket-Accept" fresh={age < 2.2}>
        <div className={css.line}>
          base64(sha1(<em>key</em> + GUID))
        </div>
        <div className={css.result}>{shown >= 4 ? <b>{ACCEPT}</b> : <span className={css.dim}>hashing…</span>}</div>
      </Ro>
    );
  }
  return (
    <Ro head="computing Sec-WebSocket-Accept" fresh={age < 2.2}>
      <div className={css.step}>
        <span>key</span>
        <span className={css.hash}>{KEY}</span>
      </div>
      {shown >= 2 && (
        <div className={css.step}>
          <span>+ GUID</span>
          <span className={css.hash}>{GUID}</span>
        </div>
      )}
      {shown >= 3 && (
        <div className={css.step}>
          <span>SHA-1</span>
          <span className={css.hash}>
            {SHA[0]}
            <br />
            {SHA[1]}
          </span>
        </div>
      )}
      {shown >= 4 && (
        <div className={css.result}>
          base64 → <b>{ACCEPT}</b>
        </div>
      )}
    </Ro>
  );
}

function ConnsReadout({ sim, compact }: { sim: WsSim; compact: boolean }) {
  const lb = sim.lastLb;
  return (
    <Ro head={compact ? 'sockets per server' : 'sockets in each server’s memory'} fresh={!!lb && sim.vt - lb.vt < 1}>
      {sim.liveServers().map((sid) => {
        const s = sim.srv.get(sid)!;
        const ids = [...s.conns.keys()];
        return (
          <div key={sid} className={css.row2}>
            <span>
              <Dot c={s.up ? SIG.res : SIG.err} />
              {SERVER_META[sid].name}
            </span>
            <span className={css.line}>
              {!s.up ? (
                <span className={css.bad}>restarting</span>
              ) : ids.length ? (
                ids.map((pid, i) => (
                  <span key={pid} style={{ color: PEOPLE[pid].color }}>
                    {i ? ', ' : ''}
                    {PEOPLE[pid].name.toLowerCase()}
                  </span>
                ))
              ) : (
                <span className={css.dim}>none</span>
              )}
            </span>
          </div>
        );
      })}
      {sim.cfg.lb && !compact && (
        <div className={css.result}>
          {lb ? (
            <>
              last upgrade: {PEOPLE[lb.pid].name} → <b>{SERVER_META[lb.sid].name}</b> <span className={css.dim}>(fewest sockets)</span>
            </>
          ) : (
            <span className={css.dim}>the load balancer picks a server once, at the upgrade</span>
          )}
        </div>
      )}
    </Ro>
  );
}

function IdleReadout({ sim, compact }: { sim: WsSim; compact: boolean }) {
  const c = sim.cfg;
  return (
    <Ro head={`proxy idle timers · limit ${c.idle} s`}>
      {c.people.map((pid) => {
        const p = sim.ppl.get(pid)!;
        const cn = sim.srv.get(p.server)!.conns.get(pid);
        const idle = cn ? sim.t - cn.lastTraffic : null;
        const k = idle == null ? 0 : Math.min(1, idle / Math.max(0.1, c.idle));
        const col = k > 0.8 ? SIG.err : k > 0.55 ? SIG.heavy : SIG.hc;
        return (
          <div key={pid} style={{ marginTop: 3 }}>
            <div className={css.row2}>
              <span>
                <Dot c={PEOPLE[pid].color} />
                {PEOPLE[pid].name}
              </span>
              <span className={idle == null ? css.dim : undefined} style={idle == null ? undefined : { color: col }}>
                {idle == null ? (p.conn === 'waiting' ? 'reconnecting' : 'no connection') : `quiet ${idle.toFixed(1)} s`}
              </span>
            </div>
            {!compact && (
              <span className={css.meter}>
                <i style={{ width: `${k * 100}%`, background: col }} />
              </span>
            )}
          </div>
        );
      })}
      <div className={css.result}>
        {c.heartbeat ? (
          <>
            ping every <b>{c.pingEvery} s</b> resets the timers
          </>
        ) : (
          <span className={css.warn}>no heartbeat: nothing resets the timers</span>
        )}
      </div>
    </Ro>
  );
}

function ClientReadout({ sim, compact }: { sim: WsSim; compact: boolean }) {
  const p = sim.ppl.get('bob')!;
  const c = sim.cfg;
  const sinceHeard = sim.t - p.lastHeard;
  const s = sim.srv.get(p.server)!;
  const serverKnows = s.conns.has('bob');
  const limit = c.pingEvery * 2 + 1.2;
  return (
    <Ro head="Bob’s connection, from both ends" fresh={p.conn === 'waiting'}>
      <div className={css.row2}>
        <span>browser thinks</span>
        <span className={p.conn === 'open' ? (p.net ? css.good : css.bad) : p.conn === 'waiting' ? css.warn : undefined}>
          {p.conn === 'open' ? (p.net ? 'open' : 'open (it isn’t!)') : p.conn === 'connecting' ? 'handshaking…' : p.conn === 'waiting' ? 'closed, will retry' : 'closed'}
        </span>
      </div>
      <div className={css.row2}>
        <span>server thinks</span>
        <span className={serverKnows ? (p.net ? css.good : css.bad) : css.dim}>{serverKnows ? (p.net ? 'open' : 'open (it isn’t!)') : 'closed'}</span>
      </div>
      {!compact && p.conn === 'open' && c.heartbeat && (
        <div className={css.row2}>
          <span>last heard from server</span>
          <span className={sinceHeard > limit * 0.6 ? css.warn : undefined}>
            {sinceHeard.toFixed(1)} s <span className={css.dim}>/ {limit.toFixed(1)}</span>
          </span>
        </div>
      )}
      {p.tries.length > 0 && (
        <div className={css.tries}>
          {p.tries.map((t, i) => (
            <span key={i} className={css.try} data-ok={String(t.ok)}>
              {t.delay.toFixed(1)} s {t.ok === true ? '✓' : t.ok === false ? '✕' : '…'}
            </span>
          ))}
        </div>
      )}
      <div className={css.result}>
        {p.conn === 'waiting' && p.retryAt != null ? (
          <>
            next try in <b>{Math.max(0, p.retryAt - sim.t).toFixed(1)} s</b> <span className={css.dim}>· backoff ×2, max 30 s</span>
          </>
        ) : p.conn === 'open' ? (
          <>
            missed while away: <b>{sim.missingFor('bob').length}</b> <span className={css.dim}>· resynced {sim.stat.resynced}</span>
          </>
        ) : (
          <span className={css.dim}>connecting…</span>
        )}
      </div>
    </Ro>
  );
}

function RedisReadout({ sim, compact }: { sim: WsSim; compact: boolean }) {
  const on = sim.cfg.backplane;
  return (
    <Ro head="redis · channel room:42">
      <div className={css.row2}>
        <span>subscribers</span>
        <span className={on ? css.hc : css.dim}>{on ? sim.liveServers().map((s) => SERVER_META[s].name).join(', ') : 'none'}</span>
      </div>
      {!compact && (
        <div className={css.row2}>
          <span>PUBLISH calls</span>
          <span>{sim.stat.published}</span>
        </div>
      )}
      <div className={css.result}>
        {on ? (
          <>
            every message reaches <b>every server</b>
          </>
        ) : (
          <span className={css.warn}>off: each server only knows its own sockets</span>
        )}
      </div>
    </Ro>
  );
}

function StreamReadout({ sim }: { sim: WsSim; compact: boolean }) {
  return (
    <Ro head="open event streams">
      {sim.cfg.receivers.map((pid) => {
        const p = sim.ppl.get(pid)!;
        return (
          <div key={pid} className={css.row2}>
            <span>
              <Dot c={PEOPLE[pid].color} />
              {PEOPLE[pid].name}
            </span>
            <span className={p.sse === 'open' ? css.good : css.dim}>{p.sse === 'open' ? 'streaming' : p.sse === 'opening' ? 'opening…' : 'closed'}</span>
          </div>
        );
      })}
      <div className={css.result}>
        server → browser: <b>stream</b> · browser → server: <b>POST</b>
      </div>
    </Ro>
  );
}

function renderReadout(k: ReadoutKey, sim: WsSim, compact: boolean) {
  switch (k) {
    case 'mailbox':
      return <MailboxReadout key={k} sim={sim} compact={compact} />;
    case 'accept':
      return <AcceptReadout key={k} sim={sim} compact={compact} />;
    case 'conns':
      return <ConnsReadout key={k} sim={sim} compact={compact} />;
    case 'idle':
      return <IdleReadout key={k} sim={sim} compact={compact} />;
    case 'client':
      return <ClientReadout key={k} sim={sim} compact={compact} />;
    case 'redis':
      return <RedisReadout key={k} sim={sim} compact={compact} />;
    case 'stream':
      return <StreamReadout key={k} sim={sim} compact={compact} />;
  }
}

/* ------------------------------------------------------------------ */
/* Inspector: what's inside the thing in flight                        */
/* ------------------------------------------------------------------ */

interface InspContent {
  head: string;
  tone: 'req' | 'res' | 'err';
  lines: InspectorLine[];
  note?: string;
}

function inspContent(sim: WsSim, kind: InspKind, pid: PersonId, msgId: number | null): InspContent | null {
  const m = msgId != null ? sim.history.find((x) => x.id === msgId) : null;
  const p = sim.ppl.get(pid)!;
  switch (kind) {
    case 'post':
      return {
        head: 'HTTP request',
        tone: 'req',
        lines: ['POST /messages HTTP/1.1', 'Host: chat.example', 'Content-Type: application/json', 'Cookie: session=4f2a…', 'rule', { t: `{"room":42,"text":"${m?.text ?? ''}"}`, kind: 'strong' }],
      };
    case 'get':
      return {
        head: 'HTTP request',
        tone: 'req',
        lines: [{ t: `GET /messages?room=42&after=${p.lastId} HTTP/1.1`, kind: 'strong' }, 'Host: chat.example', 'Cookie: session=9c1e…'],
        note: `Anything newer than message ${p.lastId}?`,
      };
    case 'poll':
      return {
        head: 'HTTP request · every poll',
        tone: 'req',
        lines: [{ t: `GET /messages?room=42&after=${p.lastId} HTTP/1.1`, kind: 'strong' }, 'Host: chat.example', 'Cookie: session=9c1e…', 'User-Agent: Mozilla/5.0 …'],
        note: 'Hundreds of bytes of headers, usually for an empty answer.',
      };
    case 'lp':
      return {
        head: 'HTTP request · long poll',
        tone: 'req',
        lines: [{ t: `GET /poll?room=42&after=${p.lastId} HTTP/1.1`, kind: 'strong' }, 'Host: chat.example', 'Cookie: session=9c1e…'],
        note: 'The server keeps this open until it has news.',
      };
    case 'sse':
      return {
        head: 'HTTP request · EventSource',
        tone: 'req',
        lines: ['GET /events?room=42 HTTP/1.1', 'Host: chat.example', { t: 'Accept: text/event-stream', kind: 'add' }],
      };
    case 'sse200':
      return {
        head: 'HTTP response · never ends',
        tone: 'res',
        lines: ['HTTP/1.1 200 OK', { t: 'Content-Type: text/event-stream', kind: 'add' }, 'Cache-Control: no-cache'],
        note: 'The body stays open. Events are written into it as they happen.',
      };
    case 'event':
      return {
        head: 'one event on the stream',
        tone: 'res',
        lines: [`id: ${m?.id ?? ''}`, { t: `data: {"from":"${m?.from ?? ''}","text":"${m?.text ?? ''}"}`, kind: 'strong' }, { t: '(a blank line ends the event)', kind: 'dim' }],
      };
    case 'upgrade':
      return {
        head: 'HTTP request · asks to upgrade',
        tone: 'req',
        lines: [
          'GET /ws HTTP/1.1',
          'Host: chat.example',
          { t: 'Upgrade: websocket', kind: 'add' },
          { t: 'Connection: Upgrade', kind: 'add' },
          { t: `Sec-WebSocket-Key: ${KEY}`, kind: 'add' },
          { t: 'Sec-WebSocket-Version: 13', kind: 'add' },
          'Origin: https://chat.example',
        ],
      };
    case '101':
      return {
        head: 'HTTP response · the last one',
        tone: 'res',
        lines: [{ t: 'HTTP/1.1 101 Switching Protocols', kind: 'strong' }, { t: 'Upgrade: websocket', kind: 'add' }, { t: 'Connection: Upgrade', kind: 'add' }, { t: `Sec-WebSocket-Accept: ${ACCEPT}`, kind: 'add' }],
        note: 'After this, the connection speaks WebSocket.',
      };
    case 'frame': {
      const up = m ? m.from === pid : true;
      const len = m ? new TextEncoder().encode(m.text).length : 0;
      return {
        head: `frame · ${up ? 'browser → server' : 'server → browser'}`,
        tone: 'req',
        lines: ['FIN 1 · opcode 1 (text)', `MASK ${up ? 1 : 0} · length ${len}`, up ? '+ 4-byte masking key' : { t: 'no masking key', kind: 'dim' }, 'rule', { t: `"${m?.text ?? ''}"`, kind: 'strong' }],
        note: `${up ? 6 : 2} bytes of header for ${len} bytes of text.`,
      };
    }
  }
}

function Inspector({ sim }: { sim: WsSim }) {
  const land = sim.orient === 'landscape';
  let at: { x: number; y: number } | null = null;
  let kind: InspKind | null = null;
  let pid: PersonId | null = null;
  let msg: number | null = null;
  const f = sim.flightViews().find((v) => v.tag?.endsWith('|insp'));
  if (f) {
    const [p, k, id] = f.tag!.split('|');
    at = { x: f.x, y: f.y };
    kind = k as InspKind;
    pid = p as PersonId;
    msg = id ? Number(id) : null;
  } else if (sim.insp && sim.t < sim.insp.until) {
    const b = sim.boxes.get(sim.insp.at);
    if (b && !Number.isNaN(b.x)) {
      at = { x: b.x, y: b.y - b.h / 2 };
      kind = sim.insp.kind;
      pid = sim.insp.pid;
      msg = sim.insp.msg;
    }
  }
  if (!at || !kind || !pid) return null;
  const c = inspContent(sim, kind, pid, msg);
  if (!c) return null;
  const longest = Math.max(...c.lines.map((l) => (l === 'rule' ? 0 : typeof l === 'string' ? l.length : l.t.length))) + 2;
  const charW = land ? 6.6 : 5.75;
  const width = Math.min(sim.w - 16, Math.max(land ? 250 : 220, longest * charW + 26));
  const cardH = c.lines.length * (land ? 17 : 15) + 36 + (c.note ? 22 : 0);
  const left = Math.min(Math.max(at.x, width / 2 + 8), sim.w - width / 2 - 8);
  // Above the point, unless that would run into the HUD at the top.
  const below = at.y - 22 - cardH < 70;
  return (
    <div
      className={cx(kit.inspect, c.tone === 'res' && kit.inspectRes, c.tone === 'err' && kit.inspectErr, below && kit.inspectBelow)}
      style={{ left, top: at.y, width, fontSize: land ? 11 : 9.6 }}
    >
      <div className={kit.inspectHead}>{c.head}</div>
      <div className={kit.inspectBody}>
        {c.lines.map((l, i) => {
          if (l === 'rule') return <div key={i} className={kit.inspectRule} />;
          const line = typeof l === 'string' ? { t: l } : l;
          const mark = line.kind === 'add' ? '+ ' : line.kind === 'change' ? '~ ' : line.kind === 'bad' ? '! ' : '  ';
          return (
            <div
              key={i}
              className={cx(
                kit.inspectLine,
                line.kind === 'add' && kit.lineAdd,
                line.kind === 'change' && kit.lineChange,
                line.kind === 'bad' && kit.lineBad,
                line.kind === 'dim' && kit.lineDim,
                line.kind === 'strong' && kit.lineStrong,
              )}
            >
              {mark}
              {line.t}
            </div>
          );
        })}
        {c.note && <div className={kit.inspectNote}>{c.note}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stage prompts                                                       */
/* ------------------------------------------------------------------ */

function Prompts({ sim, hint }: { sim: WsSim; hint?: string | null }) {
  const q = sim.game?.pending;
  const land = sim.orient === 'landscape';
  const place = (text: string, x: number, y: number) => {
    const half = (text.length * 6.7 + 22) / 2;
    return (
      <StagePrompt x={Math.min(Math.max(x, half + 8), sim.w - half - 8)} y={y}>
        {text}
      </StagePrompt>
    );
  };
  if (q) {
    const target = q.askAt && 'id' in q.askAt ? sim.boxes.get(q.askAt.id) : null;
    const text = q.ask ?? 'What happens next?';
    if (!target) return place(text, sim.w / 2, 90);
    const pinnedHere = sim.insp && sim.insp.at === (q.askAt as { id: string }).id;
    if (pinnedHere) return place(text, target.x, target.y + target.h / 2 + (land ? 34 : 30));
    return place(text, target.x, target.y - target.h / 2 - 10);
  }
  if (hint) return place(hint, sim.w / 2, land ? 64 : 60);
  return null;
}

/* ------------------------------------------------------------------ */
/* Everything on top of the stage                                      */
/* ------------------------------------------------------------------ */

export function StageOverlay({
  sim,
  hud = [],
  readouts = [],
  strip,
  hint,
}: {
  sim: WsSim;
  hud?: HudKey[];
  readouts?: ReadoutKey[];
  strip?: ReadoutKey | null;
  hint?: string | null;
}) {
  const land = sim.orient === 'landscape';
  const c = sim.cfg;
  const chat = c.view === 'chat';
  let side: ReactNode = null;
  if (land && chat && readouts.length) {
    if (c.layout === 'relay') {
      const s = sim.boxes.get('srv1');
      const two = c.servers === 2;
      if (s && !Number.isNaN(s.x)) {
        side = (
          <div className={css.anchored} style={{ left: two ? sim.w / 2 : s.x, top: s.y + s.h / 2 + (two ? 132 : 18), width: readouts.includes('accept') ? 300 : 262 }}>
            {readouts.map((k) => renderReadout(k, sim, false))}
          </div>
        );
      }
    } else {
      side = (
        <div className={css.col} style={{ width: 262 }}>
          {readouts.map((k) => renderReadout(k, sim, false))}
        </div>
      );
    }
  }
  return (
    <>
      <Hud items={hudItems(sim, hud, !land)} />
      {side}
      {!land && strip && <div className={css.strip}>{renderReadout(strip, sim, true)}</div>}
      <Inspector sim={sim} />
      <Prompts sim={sim} hint={hint} />
    </>
  );
}

