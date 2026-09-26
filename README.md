# Moving Parts

Animated, interactive lessons on system design, networking and computer science. Each topic is a step-by-step lesson built on a live simulation: learners watch requests move, predict what happens next, break things on purpose, and see the real config (NGINX, HAProxy, keepalived) behind each idea.

"Moving Parts" is a working name. Change it in `src/content/site.ts`.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (lesson pages are pre-rendered)
```

## Layout

```
src/
  app/                     routes: home page, /learn/[slug]
  content/                 site name and the topic catalog (live + coming soon)
  components/lesson/       reusable lesson player: shell, timeline, code blocks, quizzes
  components/site/         logo, topic glyphs, home-page hero
  lessons/
    registry.ts            slug → lesson component
    load-balancing/
      chapters.tsx         the lesson script: narration, stage setup, interactions per step
      engine/              the simulation (requests, queues, algorithms, health checks, failover)
      stage/               SVG renderer for the simulation, plus overlays
      panel/               interactive cards (predict, slider, playground…)
```

## Adding a topic

1. Create `src/lessons/<slug>/` with a client component that renders `LessonShell` with its own stage and panel.
2. Register it in `src/lessons/registry.ts`.
3. Flip the topic's `status` to `'live'` in `src/content/catalog.ts`.

The Load Balancing lesson is the reference implementation. Each step in `chapters.tsx` declares a world config, optional timed script, callouts, focus, an interaction, and a real-world config snippet.
