import type { GameEvent, Sequence } from './melody';

export const GAME_SECONDS = 60;
/** Fraction of the screen width the first note starts across, so the player is not left waiting. */
export const LEAD_FRACTION = 0.45;
export const POINTS_EXACT = 5;
export const POINTS_OCTAVE = 1;
export const POINTS_WRONG = -2;

export type NoteStatus = 'pending' | 'exact' | 'octave' | 'missed';

export interface RuntimeEvent {
  ev: GameEvent;
  /** Game time (seconds) at which the event reaches the left edge and vanishes. */
  t: number;
  status: NoteStatus[];
}

export type GameFx =
  | { type: 'exact' | 'octave'; event: RuntimeEvent; noteIndex: number; points: number }
  | { type: 'miss'; event: RuntimeEvent; noteIndex: number; points: 0 }
  | { type: 'wrong'; event: RuntimeEvent; midi: number; points: number };

export interface GameConfig {
  bps: number;
  visibleSeconds: number;
}

export class Game {
  readonly events: RuntimeEvent[];
  readonly leadSeconds: number;
  time = 0;
  score = 0;
  streak = 0;
  bestStreak = 0;
  exactHits = 0;
  octaveHits = 0;
  misses = 0;
  wrongPresses = 0;
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
    while (this.expireIndex < this.events.length && this.events[this.expireIndex].t <= this.time) {
      const event = this.events[this.expireIndex++];
      event.status.forEach((s, noteIndex) => {
        if (s !== 'pending') return;
        event.status[noteIndex] = 'missed';
        this.misses++;
        this.streak = 0;
        fx.push({ type: 'miss', event, noteIndex, points: 0 });
      });
    }
    return fx;
  }

  /** Handle a piano key press. Returns null when there is nothing on screen to answer. */
  press(midi: number): GameFx | null {
    if (this.finished) return null;
    const event = this.current();
    if (!event || event.t - this.time > this.config.visibleSeconds) return null;
    const pitches = event.ev.notes;

    let noteIndex = pitches.findIndex((p, i) => event.status[i] === 'pending' && p.midi === midi);
    if (noteIndex >= 0) {
      event.status[noteIndex] = 'exact';
      this.exactHits++;
      this.hit(POINTS_EXACT);
      return { type: 'exact', event, noteIndex, points: POINTS_EXACT };
    }
    noteIndex = pitches.findIndex((p, i) => event.status[i] === 'pending' && (p.midi - midi) % 12 === 0);
    if (noteIndex >= 0) {
      event.status[noteIndex] = 'octave';
      this.octaveHits++;
      this.hit(POINTS_OCTAVE);
      return { type: 'octave', event, noteIndex, points: POINTS_OCTAVE };
    }
    this.wrongPresses++;
    this.streak = 0;
    this.addScore(POINTS_WRONG);
    return { type: 'wrong', event, midi, points: POINTS_WRONG };
  }

  private hit(points: number): void {
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.addScore(points);
  }

  private addScore(points: number): void {
    this.score = Math.max(0, this.score + points);
  }
}
