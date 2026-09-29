# Contributing

Thanks for helping. The goal is lessons that are clear to a beginner and have nothing wrong or hand-wavy for an expert, so corrections are as welcome as new features.

## Report something wrong

If a lesson's animation, text or config doesn't match how the real software behaves, [open a "Something in a lesson is wrong" issue](https://github.com/tawhidkuet04/learn_engineering/issues/new/choose). Include the lesson URL (it contains the step), what you expected, and ideally how to see it on the real thing: versions, a config, a command. Evidence from the real software can usually become a check in `verify/`, so the mistake can't come back.

## Make a change

```bash
npm install
npm run dev          # http://localhost:3000/learn/<slug>#<step-id>
```

Before you open a pull request:

1. `npm run lint` and `npm run build` pass. The build also type-checks.
2. You looked at every step you touched, on desktop and phone width. `node scripts/shots.mjs http://localhost:3000/learn/<slug> shots/<slug> --steps` screenshots them all (add `--width=390 --height=844` for phone).
3. If you changed a code snippet, or anything a lesson claims about real software, run that lesson's checks: `npx vitest run verify/<file>.test.ts`. Commit the updated `verify/results/`, `verify/REPORT.md` and `src/content/*.json` along with your change. Editing a snippet removes its "tested" badge until its check passes again.
4. If the real software disagrees with the lesson, fix the lesson, not the test. If the fix came from a check, add a line to `src/content/caught.ts`.

## Adding a lesson

Lessons are big, usually 16 to 24 steps, so open an issue first to agree on the topic and outline. Then read [docs/AUTHORING.md](docs/AUTHORING.md): it covers the simulation kit, the design language, the writing style and the quality bar. [Load Balancing](src/lessons/load-balancing/) is the reference implementation.

## Style

- Second person, short sentences, no filler. Bold a key term the first time it appears.
- Use documentation addresses (`192.0.2.x`, `198.51.100.x`, `203.0.113.x`), `example` domains, and the cast Alice, Bob, Carol and Dave.
- Keep changes focused: one lesson or one kit change per pull request.
- No new npm dependencies without discussing it first.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
