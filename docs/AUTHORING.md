# Authoring a lesson

Every topic on the site is an animated, interactive, step-by-step lesson built on a live simulation. The reference implementation is **Load Balancing** (`src/lessons/load-balancing/`, visit `/learn/load-balancing`). The kit demo (`src/lessons/_template/`, `/learn/kit-demo` in dev) shows every shared piece in ~300 lines. Read both before you start.

## The quality bar

A lesson is done when a curious developer who knows nothing about the topic can click through it and **understand the topic completely**, and an expert finds nothing wrong or hand-wavy.

- **6–8 chapters, 16–24 steps.** One idea per step. Build from "why does this exist?" to real-world detail.
- **A live simulation, not a slideshow.** Things move, queue, fail and recover because the sim says so. Each step reconfigures the same world.
- **At least 2 predict-then-reveal moments** (`PredictGame` + `PredictCard`): the lesson freezes and asks what happens next, then explains.
- **At least 2 "try it / break it" moments**: sliders, toggles, buttons, or clicking things on the stage (crash it, drop the packet, add a node).
- **Make the invisible visible.** Show the internal state the learner can't normally see: a readout panel (algorithm state, table contents, counters), an inspector card riding along with a packet (headers, fields, bytes), live metrics (HUD).
- **Real-world grounding.** Most steps show the actual config, command, header or code (nginx, Redis, `dig`, Postgres, JS…) in a `CodeBlock`, with the relevant lines marked `!`.
- **End with a cheat sheet step and a playground step** (a sandbox with the main knobs, and ideally 2–3 challenges).
- **Correct.** Numbers, protocol fields, names and behavior must be accurate. When simplifying, say so in an `Aside`.

## Ground rules

1. **Keep a lesson inside `src/lessons/<slug>/`.** Add a `Lesson.tsx` (default export), register it in `src/lessons/registry.ts`, and add or flip its entry in `src/content/catalog.ts`.
2. **Kit changes go in their own pull request.** If a lesson needs something the shared kit (`src/components/**`, `src/lib/**`) lacks, build it inside the lesson folder first; move it into the kit once a second lesson needs it.
3. **No new npm dependencies** without discussing it first.

## Setup

```bash
npm install
npm run dev          # then open http://localhost:3000/learn/<slug>
```

## Architecture

```
src/lessons/<slug>/
  Lesson.tsx      default export: the client component (useLessonPlayer + LessonShell + LessonStage)
  chapters.tsx    the script: chapters → steps (narration, config, script, callouts, interactions, code)
  sim.ts          class extends Sim: all state and logic
  Scene.tsx       SVG drawing of the sim (and overlay pieces)
  ...             anything else you need
```

### The sim (`src/lib/sim/Sim.ts`)

Extend `Sim`. It gives you two clocks (`t` simulated, only while playing; `vt` visual, always), boxes that ease into place, flights (packets) that travel between boxes along auto-routed curves, wires that fade in and out, effects, timers and per-step scripts.

- `protected layout()`: call `this.place(id, cx, cy, w, h)` for every live box, for **both** `this.orient === 'landscape'` and `'portrait'` (phones, ~370×520). Use `this.w`, `this.h`, `this.compact`. Keep the top ~70px free for the HUD and the bottom ~64px free for the controls/legend/title block.
- `protected step(dt)`: simulation logic (arrivals, processing, timeouts).
- `protected wires(): WireSpec[]`: the current topology. `state`: `normal | dim | down | dashed | hot | control`.
- `box(id)` creates/revives a box, `hide(id)` fades it out, `isLive(id)`.
- `send({ from, to, dur, color, label, shape, lane, hold, lostAt, tag, onArrive, onLost })` returns a `Flight`. Chain behavior in `onArrive`. `release(f)` lets a held flight arrive. `drop(f)` loses it where it is.
- `after(delay, fn)`, `runScript([{ at, run }])` for timed events within a step, `clearTransient()` to wipe flights/timers/effects.
- `fx({ kind: 'ring' | 'x' | 'text', at: { id } | { x, y }, color })`, `say(id, text, color)` for floating labels, `flashWire(a, b)`.
- `rev++` whenever something the side panel shows changes.
- Override `curveFor(from, to, lane)` for custom paths (e.g. arcs on a ring, straight lines).
- `PredictGame` (`src/lib/sim/predict.ts`): `game.ask({ acceptable, choices?, ask, askAt, explain, resolve })` freezes the sim until answered. Stage clicks call `game.answer(id)`.

Components must **never assign sim fields directly** (lint forbids mutating state from `useState`). Expose methods (`sim.setRate(v)`) and call those.

### The lesson component

Copy `src/lessons/_template/Lesson.tsx`. The pattern:

```tsx
const [sim] = useState(() => new MySim());
const player = useLessonPlayer(CHAPTERS, (entry) => sim.enter(configFor(entry), entry.step.script, { reset: entry.step.reset }));
return (
  <LessonShell code track title chapters={player.shellChapters} index={player.index} visited={player.visited}
    onIndexChange={player.go} onTogglePlay={player.togglePlay} onReplay={player.replay}
    panel={panel}
    stage={<LessonStage sim={sim} player={player} meta={META} scene={() => <Scene sim={sim} .../>} overlay={() => ...}
      callouts={step.callouts} legend={step.legend} />} />
);
```

- The URL hash is the current step (`/learn/tcp#three-way-handshake`), so give steps stable kebab-case ids.
- `enter` runs **after** the first render of a new step. So build the panel from the **step definition** (e.g. `step.predict && <PredictCard …/>`), never from sim state, and read live values inside polling cards. Give step-local cards `key={player.stepKey}` so they reset on replay.
- Sliders take their `initial` value from the step's config, not from the live sim.

### Kit reference

Panel (`src/components/lesson/`): `Prose`, `Aside`, `Term` (hover a word to highlight a box: `<Term k="server">server</Term>`, you decide how `player.highlight` is drawn, usually `glow`), `CodeBlock` (langs: nginx, haproxy, js, conf, python, sql, shell, c, http; prefix lines with `!` to highlight), `QuizCard`, and in `cards.tsx`: `PredictCard`, `ActionsCard`, `ToggleCard`, `SliderCard` + `Stat`.

Stage SVG (`src/components/stage/svg.tsx`): `Wires`, `Flights` (pass `onFlightClick` to make packets clickable), `Effects`, `NodeCard`, `ClientCard`, `Cylinder`, `Rack`, `Label`, `Boundary`, `Arrow`. Node props: `box`, `dim`, `glow`, `state` (`normal | down | hot | ok | dim`), `pickable`, `onClick`, `children` (drawn in the node's local coordinates).

Stage overlays (`src/components/stage/overlays.tsx`, HTML on top of the SVG): `Readout` (+ `RRows`, `RRow`, `RChips`, `RLine`, `RResult`), `InspectorCard`, `StagePrompt`, `Badge`, `Callouts` (automatic via LessonStage), `FxTexts` (automatic). `chrome.tsx`: `Hud` (metric chips, top-left), `Legend` (automatic via LessonStage `legend`).

Special views: `SequenceDiagram` (actors, messages, notes, spans, `now`; ideal for protocols like TCP, TLS, DNS, WebSocket) and `CodeTrace` (source with the executing line highlighted; for event loop, stack/heap, races).

Colors: import `SIG` from `src/lib/sim/colors.ts`. Cyan `req` = requests/data out, mint `res` = responses/success/acks, orange `heavy` = expensive/special, red `err` = errors/loss/crashes, yellow `warn` = attention and the learner's turn, violet `hc` = control traffic (heartbeats, internal, metadata). `PALETTE` for per-entity colors (users, threads, shards).

## Design language: "living blueprint"

Dark drafting-grid stage, thin pale linework, glowing signal-colored packets, yellow markup callouts pointing at what the text is about. Serif display headings (Newsreader), IBM Plex Sans for UI, IBM Plex Mono for technical labels.

- Spotlight: dim what the step isn't about (`dim` on nodes, via `step.focus`).
- Callouts: 1–2 per step at most, short (≤ 8 words, one `<b>` key phrase).
- Legends: only the colors that appear in this step.
- Everything must fit the stage at **1440×900** (stage ≈ 960×760) and **390×844** (stage ≈ 370×540, portrait). Nothing may overlap the HUD (top-left), controls (bottom-left) or title block (bottom-right). Readouts use `anchor='strip'` in portrait.
- Motion should explain, not decorate. Default pacing: a packet hop takes 0.5–1.2 simulated seconds.

## Writing

- Second person, friendly and precise. Short sentences. No filler ("Let's dive in", "It's important to note").
- 2–4 short paragraphs per step. Bold the key term the first time it appears.
- Titles in sentence case: "Three-way handshake", "When a packet goes missing".
- Use documentation IPs (192.0.2.x, 198.51.100.x, 203.0.113.x), `example` domains, and the cast Alice, Bob, Carol, Dave where people are needed.

## Verify before you finish

1. `npx tsc --noEmit` and `npx eslint src/lessons/<slug>` are clean.
2. Screenshot every step on desktop and phone:
   ```bash
   node scripts/shots.mjs http://localhost:3000/learn/<slug> shots/<slug> --steps --wait=4000
   node scripts/shots.mjs http://localhost:3000/learn/<slug> shots/<slug> --steps --wait=4000 --width=390 --height=844
   ```
   Look at **every** image. Fix overlaps, clipped text, empty-looking stages, unreadable labels, and anything that doesn't match the narration.
3. Play each interaction (predict answers, sliders, buttons) and confirm the feedback is right.
4. No console errors.
5. Anything the lesson says about real software (a config, a default, an error message, how a crash plays out) gets a check in `verify/`, run against the real program. See [verify/README.md](../verify/README.md).

## Finish

Open a pull request with a short summary: what the lesson covers, how many chapters and steps, the estimated minutes, and anything you added to the kit.
