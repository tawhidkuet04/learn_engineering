import type { SeqActor, SeqMessage, SeqNote, SeqSpan } from '@/components/stage/SequenceDiagram';
import { SIG } from '@/lib/sim/colors';

/*
 * The classic cache-aside race, as a sequence diagram:
 * a reader misses and loads the old price, stalls, and writes it into the
 * cache after a writer has already updated the database and deleted the key.
 */

const NIL = '#8FA6C9';

export function raceActors(portrait: boolean): SeqActor[] {
  return [
    { id: 'r', label: 'Reader', sub: portrait ? 'app-1' : 'app-1 · a GET', color: SIG.req },
    { id: 'c', label: 'Redis', sub: 'cache', color: SIG.res },
    { id: 'd', label: 'Postgres', sub: portrait ? '$89' : 'price: $89', color: SIG.heavy },
    { id: 'w', label: 'Writer', sub: portrait ? 'app-2' : 'app-2 · Dave', color: '#93A5FF' },
  ];
}

export function raceMessages(portrait: boolean): SeqMessage[] {
  const L = (long: string, short: string) => (portrait ? short : long);
  return [
    { id: 1, from: 'r', to: 'c', t0: 0.4, t1: 1.0, label: L('GET product:42', 'GET 42') },
    { id: 2, from: 'c', to: 'r', t0: 1.0, t1: 1.6, label: L('(nil): a miss', 'nil'), color: NIL },
    { id: 3, from: 'r', to: 'd', t0: 1.9, t1: 2.7, label: L('SELECT … id = 42', 'SELECT'), color: SIG.heavy },
    { id: 4, from: 'd', to: 'r', t0: 2.7, t1: 3.5, label: L('price: $89', '$89'), color: SIG.heavy },
    { id: 5, from: 'w', to: 'd', t0: 4.0, t1: 4.8, label: L('UPDATE price = 79', 'UPDATE 79'), color: SIG.heavy },
    { id: 6, from: 'd', to: 'w', t0: 5.35, t1: 5.95, label: L('COMMIT ok', 'ok'), color: SIG.res },
    { id: 7, from: 'w', to: 'c', t0: 6.2, t1: 6.85, label: L('DEL product:42', 'DEL 42'), color: SIG.hc },
    { id: 8, from: 'c', to: 'w', t0: 6.85, t1: 7.4, label: L('0: nothing to delete', '0'), color: SIG.hc, dashed: true },
    { id: 9, from: 'r', to: 'c', t0: 8.1, t1: 8.85, label: L('SET product:42 $89', 'SET 42 $89'), color: SIG.err, hot: true },
  ];
}

export function raceNotes(portrait: boolean): SeqNote[] {
  return [
    { id: 'n1', actor: 'd', t: 4.85, text: portrait ? '$79' : 'now $79', color: SIG.heavy },
    { id: 'n2', actor: 'c', t: 9.1, text: portrait ? 'stale!' : 'stale: $89, DB has $79', color: SIG.err },
    { id: 'n3', actor: 'c', t: 9.85, text: portrait ? 'until TTL' : 'wrong until the TTL runs out', color: SIG.err },
  ];
}

export function raceSpans(portrait: boolean): SeqSpan[] {
  return [{ id: 's1', actor: 'r', t0: 3.5, t1: 8.0, label: portrait ? 'paused' : 'paused (GC, slow network…)', color: SIG.warn }];
}

/** The diagram's last event (simulated seconds); the playhead stops here. */
export const RACE_END = 10.4;
