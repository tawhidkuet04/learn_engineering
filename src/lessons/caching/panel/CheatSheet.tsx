import cards from '@/components/lesson/cards.module.css';

const ROWS: [string, string, string][] = [
  ['Cache-aside', 'Check the cache; on a miss read the DB and store a copy', 'Stale copies, cold starts'],
  ['TTL', 'Every key deletes itself after N seconds', 'Short: more misses. Long: staler data'],
  ['LRU eviction', 'When full, drop the key unused the longest', 'Size it for the hot working set'],
  ['Delete on write', 'UPDATE the DB, then DEL the key', 'Races with slow readers: keep a TTL'],
  ['Write-through', 'Write cache and DB before replying', 'Every write waits for the DB'],
  ['Write-back', 'Write the cache now, flush to the DB later', 'Unflushed writes die with the cache'],
  ['Coalescing', 'One query per key; everyone else waits for it', 'Needs a lock across app servers'],
  ['Jittered TTL', 'EX 60 ± 10% so keys don’t expire together', 'None: just do it'],
];

export function CheatSheet() {
  return (
    <>
      <table className={cards.table}>
        <thead>
          <tr>
            <th>Pattern</th>
            <th>What it does</th>
            <th>Watch out for</th>
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

      <p className={cards.subhead}>Remember</p>
      <ul className={cards.takeaways}>
        <li>
          Cache what is <strong>read often and changes rarely</strong>. The <strong>hit ratio</strong> decides both your latency and your database load.
        </li>
        <li>
          A cache holds <strong>copies</strong>. Decide how stale is acceptable, and keep a <strong>TTL</strong> as a safety net even when you
          invalidate on write.
        </li>
        <li>
          Size the cache for the <strong>working set</strong>, not the whole dataset. The long tail isn’t worth the RAM.
        </li>
        <li>
          Protect the database from <strong>stampedes</strong>: coalesce misses, jitter TTLs, refresh hot keys early.
        </li>
        <li>
          Your app must still work, just slower, when the cache is <strong>cold or down</strong>.
        </li>
      </ul>
    </>
  );
}
