import css from '@/components/lesson/cards.module.css';

const ROWS = [
  ['Queue', 'Stores work so the producer can answer now', 'It absorbs bursts; on average consumers must keep up'],
  ['Competing consumers', 'Many workers, one queue, each message to one worker', 'Messages can finish out of order'],
  ['Visibility timeout', 'Received messages hide, and return if not deleted', 'Shorter than your slowest job means duplicates'],
  ['Ack after the work', 'At-least-once: nothing lost, repeats possible', 'Consumers must be idempotent'],
  ['Dead-letter queue', 'Parks messages that fail N times', 'Alert on it, fix, then redrive'],
  ['Pub/sub fan-out', 'One event, a copy in every subscriber’s queue', 'New subscribers only see new events'],
  ['Partitions + key', 'Same key, same partition, kept in order', 'Parallelism is capped by partitions'],
];

export function CheatSheet() {
  return (
    <>
      <table className={css.table}>
        <thead>
          <tr>
            <th>Idea</th>
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

      <p className={css.subhead}>Remember</p>
      <ul className={css.takeaways}>
        <li>
          A queue lets a request <strong>answer now and work later</strong>: users wait milliseconds, not seconds, and a sick dependency no longer fails
          the request.
        </li>
        <li>
          Receiving is not deleting. The <strong>ack</strong> (delete) removes a message; a crash before it means <strong>redelivery</strong>.
        </li>
        <li>
          Delivery is <strong>at-least-once</strong>, so duplicates will happen. Make every consumer <strong>idempotent</strong>.
        </li>
        <li>
          Cap retries with a <strong>dead-letter queue</strong>, and alert on the <strong>age of the oldest message</strong> (or consumer lag), not just
          depth.
        </li>
        <li>
          Need order? Give events a <strong>key</strong>: Kafka partitions and SQS FIFO message groups keep one key’s events in sequence.
        </li>
      </ul>
    </>
  );
}
