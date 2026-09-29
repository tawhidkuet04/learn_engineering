# verify/: lessons vs. the real software

An animation can be internally consistent and still teach the wrong thing. These tests run each lesson's scenarios twice, once through the lesson's own simulation code and once through the real program (nginx, HAProxy, Redis, PostgreSQL, Node.js), and fail when the two disagree.

```sh
npm run verify                                   # everything, from a clean slate
npx vitest run verify/load-balancing.test.ts     # one lesson
npx vitest run verify/load-balancing.test.ts -t "round robin"   # one test
```

Needs `nginx`, `haproxy`, `redis-server` and `postgres` on the PATH (Homebrew: `brew install nginx haproxy redis postgresql`). Everything runs on 127.0.0.1 with random ports and temporary directories; nothing touches system config.

## What a run produces

- `verify/results/<lesson>.json`: every comparison (`check`) and every snippet that passed (`stamp`), per test.
- `verify/REPORT.md`: all checks in one table: what the real program did next to what the lesson says.
- `src/content/verified.json`: fingerprints of the code snippets that passed. `CodeBlock` shows a "tested on …" badge and the note for any snippet whose exact text is in this file. Editing a snippet changes its fingerprint, so the badge disappears until the tests run again.

## Writing a check

```ts
const R = results('rate-limiting');                 // one results file per lesson

test('burst of 30 against limit_req burst=10 nodelay', async () => {
  // 1. the real program, configured with the lesson's own snippet
  const s = snippet(collectSnippets(CHAPTERS), 'step-id', 'nginx.conf');
  // 2. the lesson's simulation (import its engine, run the same scenario headlessly)
  // 3. compare, record, assert
  R.check({ lesson, step, title, software: NGINX, real: '11 passed, 19 got 503', lesson_says: '11 passed', pass });
  expect(pass).toBe(true);
  // 4. only after the assertion: badge the snippet
  R.stamp(s.code, { lesson, by: NGINX, kind: 'ran', note: 'Ran it on nginx 1.31.6: …' });
});
```

Rules:

- **Use the snippet the reader sees.** Pull it from the lesson's `CHAPTERS` with `collectSnippets`/`snippet`. The only allowed edits are mechanical ones in `lib/confs.ts` (example IPs to local ports, certificate paths to a test certificate, a wrapper block when the snippet is a fragment). If a snippet can't run without other changes, fix the snippet in the lesson.
- **Compare against the lesson's own code.** Run the simulation (e.g. `lib/lbsim.ts`) or call the lesson's pure functions, not a re-implementation.
- **Stamp only after the assertions pass**, and keep notes short, factual and free of run-to-run numbers (put those in `check.real`). `kind: 'loads'` means the program accepted the config; `kind: 'ran'` means a scenario ran and matched.
- When the real program disagrees with the lesson, fix the lesson (text, snippet or simulation), not the test.
