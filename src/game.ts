import type { GameEvent, Sequence } from './melody';

export const GAME_SECONDS = 60;
/** Fraction of the screen width the first note starts across, so the player is not left waiting. */
export const LEAD_FRACTION = 0.8;
export const POINTS_EXACT = 5;
export const POINTS_OCTAVE = 1;
export const POINTS_WRONG = -2;
/** Correct notes in a row after which every further correct note earns a bonus. */
export const STREAK_BONUS_AT = 10;
export const POINTS_STREAK_BONUS = 3;
/** Wrong presses in a row after which the correct key is shown. */
export const WRONG_BEFORE_HINT = 2;

/** The song speed changes with how the player is doing, within these limits (1 = normal). */
export const TEMPO_MIN = 0.7;
export const TEMPO_MAX = 1.3;
/** A perfect note counts as "prompt" if it is played while still in this share of the way in from the right edge. */
export const PROMPT_FRACTION = 0.6;
/** Prompt perfect notes in a row before the song starts speeding up (the same run that starts the streak bonus). */
export const SPEEDUP_AFTER = STREAK_BONUS_AT;
/** After that, the song speeds up again for every this many further prompt perfect notes. */
export const SPEEDUP_EVERY = 7;
export const SPEEDUP_STEP = 0.05;
/** Wrong presses and missed notes in a row (with no correct note between) that slow the song down. */
export const SLOWDOWN_AFTER = 5;
export const SLOWDOWN_STEP = 0.1;

export type NoteStatus = 'pending' | 'exact' | 'octave' | 'assisted' | 'missed';

export interface RuntimeEvent {
  ev: GameEvent;
  /** Song time (seconds, see Game.songTime) at which the event reaches the left edge and vanishes. */
  t: number;
  status: NoteStatus[];
}

export type GameFx =
  | { type: 'exact' | 'octave'; event: RuntimeEvent; noteIndex: number; points: number; bonus: number; streak: number }
  | { type: 'assisted'; event: RuntimeEvent; noteIndex: number; points: 0 }
  | { type: 'miss'; event: RuntimeEvent; noteIndex: number; points: 0 }
  | { type: 'wrong'; event: RuntimeEvent; midi: number; points: number; hint: number[] };

export interface GameConfig {
  bps: number;
  visibleSeconds: number;
}

export class Game {
  readonly events: RuntimeEvent[];
  readonly leadSeconds: number;
  /** Real seconds played; the 60 s clock. */
  time = 0;
  /** Where the song is, in seconds at normal speed. It runs faster or slower than `time` as the tempo changes. */
  songTime = 0;
  /** Current song speed (1 = normal), easing towards `tempoTarget`. */
  tempo = 1;
  tempoTarget = 1;
  /** Called when the song is made faster or slower. */
  onTempo?: (direction: 'up' | 'down', target: number) => void;
  score = 0;
  streak = 0;
  bestStreak = 0;
  exactHits = 0;
  octaveHits = 0;
  misses = 0;
  wrongPresses = 0;
  bonusPoints = 0;
  assistedHits = 0;
  private wrongInRow = 0;
  /** Perfect notes in a row that were played soon after they appeared. */
  private promptRun = 0;
  /** Wrong presses and missed notes in a row. */
  private troubleRun = 0;
  private helped = new Set<RuntimeEvent>();
  private expireIndex = 0;

  constructor(
    sequence: Sequence,
    readonly config: GameConfig,
  ) {
    this.leadSeconds = config.visibleSeconds * LEAD_FRACTION;
    this.events = sequence.events.map((ev) => ({
      ev,
      t: this.leadSeconds + ev.beat / config.bps,
      status: ev.notes.map(() => 'pending' as NoteStatus),
    }));
  }

  get finished(): boolean {
    return this.time >= GAME_SECONDS;
  }

  get hits(): number {
    return this.exactHits + this.octaveHits;
  }

  get accuracy(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  /** The leftmost event that still has an unplayed note. */
  current(): RuntimeEvent | null {
    for (let i = this.expireIndex; i < this.events.length; i++) {
      if (this.events[i].status.includes('pending')) return this.events[i];
    }
    return null;
  }

  update(dt: number): GameFx[] {
    const fx: GameFx[] = [];
    if (this.finished) return fx;
    this.time = Math.min(GAME_SECONDS, this.time + dt);
    this.tempo += (this.tempoTarget - this.tempo) * (1 - Math.exp(-3 * dt));
    this.songTime += dt * this.tempo;
    while (this.expireIndex < this.events.length && this.events[this.expireIndex].t <= this.songTime) {
      const event = this.events[this.expireIndex++];
      event.status.forEach((s, noteIndex) => {
        if (s !== 'pending') return;
        event.status[noteIndex] = 'missed';
        this.misses++;
        this.streak = 0;
        this.promptRun = 0;
        this.fail();
        fx.push({ type: 'miss', event, noteIndex, points: 0 });
      });
    }
    return fx;
  }

  /** Handle a piano key press. Returns null when there is nothing on screen to answer. */
  press(midi: number): GameFx | null {
    if (this.finished) return null;
    const event = this.current();
    if (!event || event.t - this.songTime > this.config.visibleSeconds) return null;
    const pitches = event.ev.notes;
    const prompt = (event.t - this.songTime) / this.config.visibleSeconds >= PROMPT_FRACTION;

    let noteIndex = pitches.findIndex((p, i) => event.status[i] === 'pending' && p.midi === midi);
    if (noteIndex >= 0) {
      if (this.helped.has(event)) return this.assist(event, noteIndex);
      event.status[noteIndex] = 'exact';
      this.exactHits++;
      const fx = this.hit({ type: 'exact', event, noteIndex, points: POINTS_EXACT });
      this.trackPromptRun(prompt);
      return fx;
    }
    noteIndex = pitches.findIndex((p, i) => event.status[i] === 'pending' && (p.midi - midi) % 12 === 0);
    if (noteIndex >= 0) {
      if (this.helped.has(event)) return this.assist(event, noteIndex);
      event.status[noteIndex] = 'octave';
      this.octaveHits++;
      const fx = this.hit({ type: 'octave', event, noteIndex, points: POINTS_OCTAVE });
      this.promptRun = 0;
      return fx;
    }
    this.wrongPresses++;
    this.wrongInRow++;
    this.streak = 0;
    this.promptRun = 0;
    this.fail();
    this.addScore(POINTS_WRONG);
    let hint: number[] = [];
    if (this.wrongInRow >= WRONG_BEFORE_HINT) {
      hint = pitches.filter((_, i) => event.status[i] === 'pending').map((p) => p.midi);
      this.helped.add(event); // notes of this event no longer score once the answer was shown
    }
    return { type: 'wrong', event, midi, points: POINTS_WRONG, hint };
  }

  /** A note played after the game showed the answer: it clears the note but earns nothing. */
  private assist(event: RuntimeEvent, noteIndex: number): GameFx {
    event.status[noteIndex] = 'assisted';
    this.assistedHits++;
    this.wrongInRow = 0;
    this.promptRun = 0;
    return { type: 'assisted', event, noteIndex, points: 0 };
  }

  /** A perfect note played soon after it appeared extends the run that speeds the song up. */
  private trackPromptRun(prompt: boolean): void {
    this.promptRun = prompt ? this.promptRun + 1 : 0;
    if (this.promptRun >= SPEEDUP_AFTER && (this.promptRun - SPEEDUP_AFTER) % SPEEDUP_EVERY === 0) {
      this.changeTempo(SPEEDUP_STEP);
    }
  }

  /** A wrong press or a missed note; enough of them in a row slow the song down. */
  private fail(): void {
    if (++this.troubleRun >= SLOWDOWN_AFTER) {
      this.troubleRun = 0;
      this.changeTempo(-SLOWDOWN_STEP);
    }
  }

  private changeTempo(delta: number): void {
    const target = Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, Math.round((this.tempoTarget + delta) * 100) / 100));
    if (target === this.tempoTarget) return;
    this.tempoTarget = target;
    this.onTempo?.(delta > 0 ? 'up' : 'down', target);
  }

  /** Score a correct note; once a streak is running every further correct note earns a bonus. */
  private hit(base: { type: 'exact' | 'octave'; event: RuntimeEvent; noteIndex: number; points: number }): GameFx {
    const bonus = this.streak >= STREAK_BONUS_AT ? POINTS_STREAK_BONUS : 0;
    this.streak++;
    this.wrongInRow = 0;
    this.troubleRun = 0;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.bonusPoints += bonus;
    this.addScore(base.points + bonus);
    return { ...base, bonus, streak: this.streak };
  }

  /** True while the streak bonus is being earned. */
  get onStreak(): boolean {
    return this.streak >= STREAK_BONUS_AT;
  }

  private addScore(points: number): void {
    this.score = Math.max(0, this.score + points);
  }
}
