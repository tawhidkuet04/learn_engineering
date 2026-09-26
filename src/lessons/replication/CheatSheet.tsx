import css from './replication.module.css';

const MODES = [
  ['Async', 'Fast commits; the leader never waits', 'A failover can lose the last confirmed writes'],
  ['Sync, 1 follower', 'Every commit is on two machines', 'One extra round trip per write; stalls if that follower dies'],
  ['FIRST 1 (a, b)', 'Sync, with a backup standby', 'Still one round trip; stalls only if every listed follower is gone'],
  ['Reads on followers', 'Read capacity grows with each follower', 'Stale reads, so add read-your-writes and stickiness'],
];

export function CheatSheet() {
  return (
    <>
      <table className={css.table}>
        <thead>
          <tr>
            <th>Choice</th>
            <th>You get</th>
            <th>You pay</th>
          </tr>
        </thead>
        <tbody>
          {MODES.map(([a, b, c]) => (
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
          All writes go to <strong>one leader</strong>, which orders them in its log. Followers replay the <strong>same log in the same order</strong>,
          so the copies match.
        </li>
        <li>
          Followers are always a little behind. For your own writes, <strong>read from the leader or wait for your LSN</strong>. For{' '}
          <strong>monotonic reads</strong>, pin each user to one follower.
        </li>
        <li>
          <strong>Async</strong> is fast but can lose confirmed writes on failover. <strong>Sync</strong> is durable but slower, and can block.
          One sync follower plus async ones is the usual compromise.
        </li>
        <li>
          <strong>Failover</strong>: detect with timeouts, promote the most up-to-date follower, repoint the clients, and <strong>fence</strong> the
          old leader so there&apos;s never two.
        </li>
        <li>
          <strong>Multi-leader</strong> and <strong>leaderless</strong> replication trade conflicts and quorum math for local writes and no single
          leader to lose.
        </li>
      </ul>
    </>
  );
}
