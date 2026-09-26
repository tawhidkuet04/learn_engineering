import type { Sim } from './Sim';

/** One "what happens next?" question. The simulation freezes until it is answered. */
export interface Question {
  /** Answers (box ids or choice ids) that count as correct; ties are fine */
  acceptable: string[];
  /** Multiple-choice options rendered as buttons in the side panel */
  choices?: { id: string; label: string }[];
  /** Short prompt shown on the stage while waiting, e.g. "Which server gets it?" */
  ask?: string;
  /** Where the stage prompt sits (defaults to the stage's top center) */
  askAt?: { id: string } | { x: number; y: number };
  /** Feedback sentence shown after answering */
  explain: (picked: string, ok: boolean) => string;
  /** Apply the outcome, e.g. let the frozen packet continue */
  resolve?: (picked: string, ok: boolean) => void;
}

/**
 * Predict-then-reveal game shared by all lessons. The learner must get
 * `needed` answers right; wrong answers explain the rule and move on.
 */
export class PredictGame {
  correct = 0;
  attempts = 0;
  pending: Question | null = null;
  last: { ok: boolean; picked: string; text: string; key: number } | null = null;
  done = false;

  constructor(
    private sim: Sim,
    public needed = 3,
  ) {}

  /** Freeze the sim and ask. Returns false if a question is already open or the game is over. */
  ask(q: Question): boolean {
    if (this.done || this.pending) return false;
    this.pending = q;
    this.sim.frozen = true;
    this.sim.rev++;
    return true;
  }

  answer(picked: string) {
    const q = this.pending;
    if (!q) return;
    const ok = q.acceptable.includes(picked);
    this.attempts += 1;
    if (ok) this.correct += 1;
    this.last = { ok, picked, text: q.explain(picked, ok), key: this.attempts };
    this.pending = null;
    this.sim.frozen = false;
    q.resolve?.(picked, ok);
    if (this.correct >= this.needed) this.done = true;
    this.sim.rev++;
  }

  /** Give up: resolve any open question with a correct answer and stop asking. */
  skip() {
    const q = this.pending;
    this.pending = null;
    this.done = true;
    this.sim.frozen = false;
    q?.resolve?.(q.acceptable[0], true);
    this.sim.rev++;
  }

  restart() {
    this.correct = 0;
    this.attempts = 0;
    this.last = null;
    this.done = false;
    this.sim.rev++;
  }

  /** True while the learner should click something on the stage (not panel buttons). */
  get awaitingStageClick() {
    return !!this.pending && !this.pending.choices;
  }
}
