import css from './panel.module.css';

const ROWS = [
  ['Round robin', 'Next server in line', 'Servers and requests are all alike'],
  ['Weighted', 'In proportion to each weight', 'Servers have different sizes'],
  ['Least conn.', 'Fewest requests in progress', 'Request costs vary a lot'],
  ['IP hash', 'hash(client IP) mod N', 'You need stickiness (but prefer shared sessions)'],
  ['Power of two', 'Sample 2 at random, take the less busy', 'Huge fleets, many balancers'],
];

export function CheatSheet() {
  return (
    <>
      <table className={css.table}>
        <thead>
          <tr>
            <th>Algorithm</th>
            <th>How it picks</th>
            <th>Reach for it when</th>
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
          A load balancer gives many servers <strong>one address</strong> and hides them on a private network.
        </li>
        <li>
          <strong>Health checks</strong> with thresholds pull broken servers out and bring them back automatically.
        </li>
        <li>
          Keep servers <strong>stateless</strong>. Put sessions in a shared store so any server can take any request.
        </li>
        <li>
          <strong>Layer 4</strong> is fast and protocol-agnostic. <strong>Layer 7</strong> reads HTTP and routes by content.
        </li>
        <li>
          Make the balancer redundant too: an <strong>active–passive pair</strong> sharing a floating IP.
        </li>
      </ul>
    </>
  );
}
