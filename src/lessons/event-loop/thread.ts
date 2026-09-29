/*
 * The main thread in real time (1 virtual ms = 1 ms at 1× speed), for the
 * "blocking the loop" chapter. It keeps the same rules as the step-by-step
 * machine, just much faster: one thing at a time on the main thread;
 * microtasks drain before anything else; a frame is rendered at the first
 * free moment after each vsync; tasks run in order.
 */

export type ThreadMode = 'long' | 'chunk' | 'micro' | 'worker';
export type BarKind = 'click' | 'long' | 'chunk' | 'micro' | 'render' | 'message' | 'work' | 'post';

export interface Bar {
  lane: 'main' | 'worker';
  kind: BarKind;
  start: number;
  end: number;
  label?: string;
}

export interface Slot {
  t: number;
  state: 'painted' | 'dropped' | 'pending';
}

export interface Click {
  id: number;
  at: number;
  start?: number;
  done?: number;
}

/** A task and the microtasks drained right after it: what DevTools calls one task. */
export interface Span {
  start: number;
  end: number;
  open: boolean;
}

interface Item {
  kind: BarKind;
  label: string;
  dur: number;
  onDone?: () => void;
  /** Queued at (for input delay) */
  at?: number;
  click?: Click;
}

interface Running extends Item {
  start: number;
  end: number;
  bar: Bar;
  micro: boolean;
}

export const VSYNC = 1000 / 60;
export const TOTAL_WORK = 1500;
const RENDER_MS = 2.2;
const CLICK_MS = 5;
const CHUNK_MS = 12;
const WINDOW = 4000;

export class MainThread {
  ms = 0;
  mode: ThreadMode = 'long';
  running: Running | null = null;
  tasks: Item[] = [];
  micro: Item[] = [];
  timers: { at: number; item: Item }[] = [];
  bars: Bar[] = [];
  slots: Slot[] = [];
  spans: Span[] = [];
  clicks: Click[] = [];
  nextVsync = VSYNC;
  frameDue = false;

  /** What JavaScript has written to the DOM… */
  dom = { progress: 0, cart: 0, status: 'Ready' };
  /** …and what the screen actually shows (updated only when a frame paints). */
  painted = { progress: 0, cart: 0, status: 'Ready', spin: 0, at: 0 };

  job = { active: false, done: 0, t0: 0, t1: 0, nest: 0 };
  worker: { start: number; end: number; bar: Bar } | null = null;
  stats = { dropped: 0, painted: 0, longest: 0, lastDelay: null as number | null, maxDelay: 0 };
  private clickSeq = 0;

  reset(mode: ThreadMode) {
    this.mode = mode;
    this.ms = 0;
    this.running = null;
    this.tasks = [];
    this.micro = [];
    this.timers = [];
    this.bars = [];
    this.slots = [];
    this.spans = [];
    this.clicks = [];
    this.nextVsync = VSYNC;
    this.frameDue = false;
    this.dom = { progress: 0, cart: 0, status: 'Ready' };
    this.painted = { progress: 0, cart: 0, status: 'Ready', spin: 0, at: 0 };
    this.job = { active: false, done: 0, t0: 0, t1: 0, nest: 0 };
    this.worker = null;
    this.stats = { dropped: 0, painted: 0, longest: 0, lastDelay: null, maxDelay: 0 };
  }

  setMode(mode: ThreadMode) {
    this.mode = mode;
  }

  get busy() {
    return !!this.running;
  }

  /** The longest span (task + its microtasks) currently open, in ms. */
  get currentSpan() {
    const s = this.spans[this.spans.length - 1];
    return s && s.open ? this.ms - s.start : 0;
  }

  /* ---------------------------------------------------------------- */
  /* input                                                            */
  /* ---------------------------------------------------------------- */

  /** The user clicks "Add to cart": the browser queues a task. */
  clickCart() {
    const c: Click = { id: ++this.clickSeq, at: this.ms };
    this.clicks.push(c);
    this.tasks.push({
      kind: 'click',
      label: 'click → addToCart',
      dur: CLICK_MS,
      at: this.ms,
      click: c,
      onDone: () => {
        this.dom.cart += 1;
        c.done = this.ms;
      },
    });
  }

  /** The user clicks "Process orders": its click handler starts the work. */
  startJob() {
    if (this.job.active) return false;
    this.job = { active: true, done: 0, t0: this.ms, t1: 0, nest: 0 };
    this.dom.progress = 0;
    this.dom.status = 'Working…';
    const mode = this.mode;
    if (mode === 'worker') {
      this.tasks.push({ kind: 'post', label: 'click → postMessage', dur: 1.5, onDone: () => this.startWorker() });
    } else if (mode === 'long') {
      this.tasks.push({ kind: 'long', label: 'click → processAll()', dur: TOTAL_WORK, onDone: () => this.finishJob() });
    } else {
      this.tasks.push(this.chunk());
    }
    return true;
  }

  private chunk(): Item {
    const dur = Math.min(CHUNK_MS, TOTAL_WORK - this.job.done);
    const micro = this.mode === 'micro';
    return {
      kind: micro && this.job.done > 0 ? 'micro' : 'chunk',
      label: this.job.done === 0 ? 'click → processAll()' : micro ? 'await → next chunk' : 'timeout → next chunk',
      dur,
      onDone: () => {
        this.job.done += dur;
        this.dom.progress = this.job.done / TOTAL_WORK;
        if (this.job.done >= TOTAL_WORK - 1e-6) {
          this.finishJob();
          return;
        }
        if (this.mode === 'micro') {
          // await Promise.resolve(): the next chunk is a microtask.
          this.micro.push(this.chunk());
        } else {
          // setTimeout(next, 0): the next chunk is a task, at the back of the line.
          // Browsers clamp nested timers to 4 ms after 5 levels: the first call
          // (from the click) and the next 5 run at 0 ms, the 7th waits 4 ms.
          this.job.nest += 1;
          const delay = this.job.nest > 6 ? 4 : 0;
          this.timers.push({ at: this.ms + delay, item: this.chunk() });
        }
      },
    };
  }

  private startWorker() {
    const start = this.ms;
    const end = start + TOTAL_WORK;
    const bar: Bar = { lane: 'worker', kind: 'work', start, end: start, label: 'processAll() in worker' };
    this.bars.push(bar);
    this.worker = { start, end, bar };
    // Progress updates come back as message events (tasks) every ~150 ms.
    for (let t = 150; t < TOTAL_WORK; t += 150) {
      const p = t / TOTAL_WORK;
      this.timers.push({
        at: start + t,
        item: { kind: 'message', label: 'message → progress', dur: 1, onDone: () => (this.dom.progress = p) },
      });
    }
    this.timers.push({
      at: end,
      item: { kind: 'message', label: 'message → results', dur: 2, onDone: () => this.finishJob() },
    });
  }

  private finishJob() {
    this.job.active = false;
    this.job.t1 = this.ms;
    this.dom.progress = 1;
    this.dom.status = 'Done';
  }

  /* ---------------------------------------------------------------- */
  /* time                                                             */
  /* ---------------------------------------------------------------- */

  tick(dtMs: number) {
    let left = Math.min(dtMs, 250);
    while (left > 1e-9) {
      const h = Math.min(left, 0.5);
      this.ms += h;
      left -= h;
      this.step();
    }
    const cutoff = this.ms - WINDOW;
    if (this.bars.length > 400) this.bars = this.bars.filter((b) => b.end > cutoff || b === this.running?.bar || b === this.worker?.bar);
    if (this.slots.length > 400) this.slots = this.slots.filter((s) => s.t > cutoff);
    if (this.spans.length > 200) this.spans = this.spans.filter((s) => s.end > cutoff || s.open);
    if (this.clicks.length > 60) this.clicks = this.clicks.filter((c) => (c.done ?? this.ms) > cutoff);
  }

  private step() {
    const now = this.ms;

    // Vsync: the display wants a new frame.
    if (now >= this.nextVsync) {
      const prev = this.slots[this.slots.length - 1];
      if (prev && prev.state === 'pending') {
        prev.state = 'dropped';
        this.stats.dropped += 1;
      }
      this.slots.push({ t: this.nextVsync, state: 'pending' });
      this.nextVsync += VSYNC;
      this.frameDue = true;
    }

    // Timers and the worker live on other threads.
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= now);
      if (due.length) {
        this.timers = this.timers.filter((t) => t.at > now);
        for (const t of due) this.tasks.push(t.item);
      }
    }
    if (this.worker) {
      this.worker.bar.end = Math.min(now, this.worker.end);
      if (now >= this.worker.end) this.worker = null;
    }

    const r = this.running;
    if (r) {
      r.bar.end = Math.min(now, r.end);
      if (r.kind === 'long' && this.job.active) this.dom.progress = Math.min(1, (now - r.start) / r.dur);
      if (now < r.end) return;
      this.running = null;
      r.onDone?.();
      if (r.kind === 'render') {
        this.painted = { ...this.dom, spin: this.painted.spin, at: now };
        this.painted.spin = (now * 0.36) % 360;
        this.stats.painted += 1;
        const last = [...this.slots].reverse().find((s) => s.state === 'pending');
        if (last) last.state = 'painted';
      }
    }
    this.schedule();
  }

  private schedule() {
    if (this.running) return;
    const span = this.spans[this.spans.length - 1];
    // 1. Microtasks drain first, always.
    const m = this.micro.shift();
    if (m) {
      this.start(m, true);
      return;
    }
    if (span && span.open) {
      span.open = false;
      span.end = this.ms;
      this.stats.longest = Math.max(this.stats.longest, span.end - span.start);
    }
    // 2. Render if a frame is due.
    if (this.frameDue) {
      this.frameDue = false;
      this.start({ kind: 'render', label: 'render', dur: RENDER_MS }, false);
      return;
    }
    // 3. One task.
    const t = this.tasks.shift();
    if (t) {
      this.spans.push({ start: this.ms, end: this.ms, open: true });
      if (t.click) {
        t.click.start = this.ms;
        const d = this.ms - t.click.at;
        this.stats.lastDelay = d;
        this.stats.maxDelay = Math.max(this.stats.maxDelay, d);
      }
      this.start(t, false);
    }
  }

  private start(item: Item, micro: boolean) {
    const bar: Bar = { lane: 'main', kind: item.kind, start: this.ms, end: this.ms, label: item.label };
    this.bars.push(bar);
    this.running = { ...item, start: this.ms, end: this.ms + item.dur, bar, micro };
    const span = this.spans[this.spans.length - 1];
    if (span && span.open) span.end = this.ms + item.dur;
  }
}
