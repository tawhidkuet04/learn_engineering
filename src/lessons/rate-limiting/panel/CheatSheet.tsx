import css from './panel.module.css';

const ROWS: [string, string, string][] = [
  ['Fixed window', 'Count per clock window; reset at the edge', 'Simplest, 1 counter. Up to 2× the limit around an edge'],
  ['Sliding log', 'Timestamps of the last W seconds', 'Exact, but stores every request'],
  ['Sliding counter', 'prev × overlap + current', '2 counters, a close estimate'],
  ['Token bucket', 'Take a token; refill at R, hold at most B', 'Bursts up to B, average capped at R'],
  ['Leaky bucket', 'Queue, then drain at R', 'Perfectly smooth output; adds waiting'],
];

export function CheatSheet() {
  return (
    <>
      <table className={css.table}>
        <thead>
          <tr>
            <th>Algorithm</th>
            <th>How it decides</th>
            <th>Trade-off</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([a, b, c]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>{b}</td>
              <td>{c}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className={css.subhead}>Remember</p>
      <ul className={css.takeaways}>
        <li>
          Rate limits protect capacity, keep things <strong>fair between clients</strong>, and cap cost. Count per key: IP, user, or API key.
        </li>
        <li>
          Reject with <strong>429 Too Many Requests</strong> and a <strong>Retry-After</strong>. Tell good clients how much is left with RateLimit headers.
        </li>
        <li>
          Clients should retry with <strong>exponential backoff and jitter</strong>, never in a tight loop.
        </li>
        <li>
          Many gateways need <strong>one shared count</strong>: Redis with an atomic <code>INCR</code> or a Lua script, not GET then SET.
        </li>
        <li>
          Default choice for APIs: a <strong>token bucket</strong> per client, sized for your honest bursts.
        </li>
      </ul>
    </>
  );
}
