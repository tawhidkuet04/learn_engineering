import kit from '@/components/lesson/cards.module.css';

const ROWS = [
  ['Range', 'The key falls in a range: A–F, 2026, 1–1M', 'Range scans, ordered reads', 'Hot spots when keys only go up'],
  ['Hash', 'hash(key) mod N, or ranges of hash values', 'Even load for any key', 'Range queries ask every shard'],
  ['Directory', 'Look the key up in a table', 'Moving one tenant at a time', 'An extra lookup and a critical service'],
];

export function CheatSheet() {
  return (
    <>
      <table className={kit.table}>
        <thead>
          <tr>
            <th>Strategy</th>
            <th>How it picks</th>
            <th>Good at</th>
            <th>Watch out</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([a, b, c, d]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>{b}</td>
              <td>{c}</td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className={kit.subhead}>Remember</p>
      <ul className={kit.takeaways}>
        <li>
          Shard when one machine can&apos;t hold the data or absorb the writes. <strong>Replicas copy everything</strong>, so they scale reads, not
          writes or storage.
        </li>
        <li>
          The <strong>shard key</strong> decides everything: many distinct values, an even spread, and present in your most common queries.
        </li>
        <li>
          Queries without the shard key become <strong>scatter-gather</strong>: every shard answers and you wait for the slowest.
        </li>
        <li>
          Keep joins and transactions inside one shard: <strong>co-locate</strong> related tables, copy small reference tables, and save 2PC for
          when you must.
        </li>
        <li>
          Make IDs without a central counter: <strong>Snowflake</strong> IDs or UUIDv7.
        </li>
        <li>
          Plan for <strong>resharding</strong> from day one: many small buckets or ranges of hashes, never plain mod N.
        </li>
      </ul>
    </>
  );
}
