import css from '../pt.module.css';

const ROWS: [string, string, string][] = [
  ['Memory', 'Its own address space', 'Shares its process’s'],
  ['Owns', 'PID, page table, heap, open files', 'Stack, registers, program counter'],
  ['Start one', 'fork(): copy an address space', 'pthread_create(): add a stack'],
  ['Switch to it', 'Registers + page table, cold TLB', 'Registers only'],
  ['Talk via', 'IPC: pipes, sockets, shared memory', 'Shared memory, guarded by locks'],
  ['If it crashes', 'Only that process dies', 'Its whole process dies'],
];

export function CheatSheet() {
  return (
    <>
      <table className={css.table}>
        <thead>
          <tr>
            <th />
            <th>Process</th>
            <th>Thread</th>
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
          A <strong>process</strong> is a running program with its own address space. The OS walls processes off from each other.
        </li>
        <li>
          A <strong>thread</strong> is a line of execution: its own stack and registers, everything else shared with the other threads of its process.
        </li>
        <li>
          A core runs <strong>one thread at a time</strong>. Time slices and context switches give you <strong>concurrency</strong>; more cores give you{' '}
          <strong>parallelism</strong>.
        </li>
        <li>
          A <strong>blocked</strong> thread doesn&apos;t use a core, so I/O-heavy servers can run many threads on a few cores.
        </li>
        <li>
          Choose <strong>processes</strong> for isolation (Chrome, Postgres) and <strong>threads</strong> for cheap sharing (MySQL, most apps). Mind
          your runtime too: Python&apos;s GIL, Node&apos;s single thread.
        </li>
      </ul>
    </>
  );
}
