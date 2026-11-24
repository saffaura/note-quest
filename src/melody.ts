import { GAME_SECONDS, LEAD_FRACTION } from './game';
import {
  type ClefMode,
  type Difficulty,
  type Key,
  type Pitch,
  PIANO_RANGE,
  scaleNote,
} from './theory';
import { type Tune, type TuneEvent, TUNES, parseTune } from './tunes';

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

export interface DifficultyConfig {
  bps: number; // beats per second
  visibleSeconds: number; // time a note takes to cross the playing area
  dyadChance: number;
  beamChance: number;
  dyadSpans: number[]; // how many scale steps below the melody note the second note sits
}

export const DIFFICULTY: Record<Difficulty, DifficultyConfig> = {
  easy: { bps: 0.7, visibleSeconds: 9, dyadChance: 0, beamChance: 0, dyadSpans: [] },
  medium: { bps: 1.0, visibleSeconds: 7, dyadChance: 0.12, beamChance: 0.14, dyadSpans: [2] },
  hard: { bps: 1.45, visibleSeconds: 5.5, dyadChance: 0.2, beamChance: 0.2, dyadSpans: [2, 3, 4, 5] },
};

export interface GameEvent {
  id: number;
  beat: number;
  dur: number;
  notes: Pitch[]; // sorted low to high
  beamId: number | null;
  tuneTitle: string;
}

export interface Sequence {
  events: GameEvent[];
  titles: string[];
  /** Speed multiplier for the tune (1 = the difficulty's normal speed, below 1 = slower). */
  pace: number;
}

export interface MelodySettings {
  key: Key;
  clef: ClefMode;
  difficulty: Difficulty;
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const LEVELS: Difficulty[] = ['easy', 'medium', 'hard'];

const hasAlterations = (t: Tune) => /[#b]\d/.test(t.score);

/** Tunes usable for this key mode, own level first, topped up with easier ones. */
export function tunePool(level: Difficulty, mode: 'major' | 'minor', library: Tune[] = TUNES): Tune[] {
  const usable = library.filter((t) => t.mode === mode || !hasAlterations(t));
  const idx = LEVELS.indexOf(level);
  let pool = usable.filter((t) => t.level === level);
  for (let i = idx - 1; i >= 0 && pool.length < 4; i--) {
    pool = pool.concat(usable.filter((t) => t.level === LEVELS[i]));
  }
  return pool;
}

/** A short random-walk melody, used when no library tune fits the chosen key and clef. */
export function generateTune(level: Difficulty, rng: Rng): TuneEvent[] {
  const events: TuneEvent[] = [];
  let n = [0, 2, 4][Math.floor(rng() * 3)];
  const count = level === 'easy' ? 12 : 16;
  for (let i = 0; i < count; i++) {
    const r = rng();
    const step = r < 0.55 ? 1 : r < 0.8 ? 2 : 3;
    n += (rng() < 0.5 ? -1 : 1) * step;
    n = Math.max(-2, Math.min(7, n));
    const last = i === count - 1;
    events.push({ notes: [{ n: last ? 0 : n, alt: 0 }], dur: last ? 2 : rng() < 0.2 ? 2 : 1 });
  }
  return events;
}

function inject(events: TuneEvent[], cfg: DifficultyConfig, rng: Rng): TuneEvent[] {
  if (cfg.dyadChance === 0 && cfg.beamChance === 0) return events;
  const out: TuneEvent[] = [];
  let cooldown = 2;
  events.forEach((ev, i) => {
    const plain = ev.notes.length === 1 && ev.notes[0].alt === 0;
    if (cooldown > 0 || !plain) {
      cooldown = Math.max(0, cooldown - 1);
      out.push(ev);
      return;
    }
    const r = rng();
    const note = ev.notes[0];
    if (ev.dur >= 1 && r < cfg.dyadChance) {
      const span = cfg.dyadSpans[Math.floor(rng() * cfg.dyadSpans.length)];
      out.push({ dur: ev.dur, notes: [{ n: note.n - span, alt: 0 }, note] });
      cooldown = 2;
    } else if (ev.dur === 1 && r < cfg.dyadChance + cfg.beamChance) {
      const next = events[i + 1]?.notes[0];
      const dir = next && next.n !== note.n ? Math.sign(next.n - note.n) : -1;
      out.push({ dur: 0.5, notes: [note] }, { dur: 0.5, notes: [{ n: note.n + dir, alt: 0 }] });
      cooldown = 2;
    } else {
      out.push(ev);
    }
  });
  return out;
}

const PREFERRED_CENTER = { treble: 71, bass: 50 };

/** Pick the tonic octave that places `events` inside the window, closest to the preferred centre. */
function bestOctave(
  events: TuneEvent[],
  key: Key,
  window: [number, number],
  side: 'treble' | 'bass',
): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (let octave = 0; octave <= 8; octave++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const ev of events) {
      for (const note of ev.notes) {
        const midi = scaleNote(key, octave, note.n, note.alt).midi;
        lo = Math.min(lo, midi);
        hi = Math.max(hi, midi);
      }
    }
    if (lo < window[0] || hi > window[1]) continue;
    const dist = Math.abs((lo + hi) / 2 - PREFERRED_CENTER[side]);
    if (dist < bestDist) {
      bestDist = dist;
      best = octave;
    }
  }
  return best;
}

const CHUNK_SIZE = 6;

interface PlacedEvent {
  dur: number;
  notes: Pitch[];
}

/** Turn scale-relative events into real pitches, or null if they cannot fit on the keyboard. */
export function placeEvents(events: TuneEvent[], key: Key, clef: ClefMode, rng: Rng): PlacedEvent[] | null {
  const window = PIANO_RANGE[clef];
  const chunks: TuneEvent[][] = [];
  if (clef === 'both') {
    for (let i = 0; i < events.length; i += CHUNK_SIZE) chunks.push(events.slice(i, i + CHUNK_SIZE));
  } else {
    chunks.push(events);
  }
  let side: 'treble' | 'bass' = clef === 'bass' ? 'bass' : 'treble';
  if (clef === 'both' && rng() < 0.5) side = 'bass';
  const placed: PlacedEvent[] = [];
  for (const chunk of chunks) {
    const octave = bestOctave(chunk, key, window, side);
    if (octave === null) return null;
    for (const ev of chunk) {
      const notes = ev.notes
        .map((n) => scaleNote(key, octave, n.n, n.alt))
        .sort((a, b) => a.midi - b.midi);
      placed.push({ dur: ev.dur, notes });
    }
    if (clef === 'both') side = side === 'treble' ? 'bass' : 'treble';
  }
  return placed;
}

/** Group neighbouring eighth notes that share a beat into beamed pairs. */
export function assignBeams(events: GameEvent[]): void {
  let beamId = 0;
  for (let i = 0; i < events.length - 1; i++) {
    const a = events[i];
    const b = events[i + 1];
    if (a.beamId !== null) continue;
    if (a.dur === 0.5 && b.dur === 0.5 && Number.isInteger(a.beat) && b.beat === a.beat + 0.5) {
      const ds = [...a.notes, ...b.notes].map((n) => n.d);
      // Keep beams tidy: skip pairs that leap across the grand staff (e.g. at a clef switch).
      if (Math.max(...ds) - Math.min(...ds) > 8) continue;
      a.beamId = b.beamId = beamId++;
      i++;
    }
  }
}

/** Beats-per-second and crossing time for a difficulty, scaled by a tune's `pace` (1 = normal). */
export function timing(difficulty: Difficulty, pace = 1): { bps: number; visibleSeconds: number } {
  const cfg = DIFFICULTY[difficulty];
  return { bps: cfg.bps * pace, visibleSeconds: cfg.visibleSeconds / pace };
}

/** Beats of music needed to keep the staff full until the end of a game. */
export function beatsNeeded(difficulty: Difficulty, pace = 1): number {
  const { bps, visibleSeconds } = timing(difficulty, pace);
  return (GAME_SECONDS + visibleSeconds * (1 - LEAD_FRACTION)) * bps;
}

/**
 * Build one song for a game: a random tune from the library, transposed to the chosen key and
 * clef. If the tune is shorter than a game it is played again (with fresh doubles and beams)
 * until the music lasts the full 60 seconds.
 */
export function buildSequence(settings: MelodySettings, rng: Rng, minBeats?: number): Sequence {
  const { key, clef, difficulty } = settings;
  const cfg = DIFFICULTY[difficulty];

  let title = '';
  let pace = 1;
  let source: TuneEvent[] = [];
  let first: PlacedEvent[] | null = null;
  for (const tune of shuffle(tunePool(difficulty, key.mode), rng)) {
    source = parseTune(tune.score);
    first = placeEvents(inject(source, cfg, rng), key, clef, rng);
    if (first) {
      title = tune.title;
      pace = tune.pace ?? 1;
      break;
    }
  }
  // No library tune fits this key and clef: fall back to a generated one.
  while (!first) {
    title = 'Surprise tune';
    source = generateTune(difficulty, rng);
    first = placeEvents(inject(source, cfg, rng), key, clef, rng);
  }

  const needed = minBeats ?? beatsNeeded(difficulty, pace);
  const events: GameEvent[] = [];
  let beat = 0;
  let id = 0;
  let pass = 0;
  while (events.length === 0 || events[events.length - 1].beat < needed) {
    const placed = (pass > 0 && placeEvents(inject(source, cfg, rng), key, clef, rng)) || first;
    for (const ev of placed) {
      events.push({ id: id++, beat, dur: ev.dur, notes: ev.notes, beamId: null, tuneTitle: title });
      beat += ev.dur;
    }
    beat = Math.ceil(beat) + 1; // short pause before a repeat, keeps beams on whole beats
    pass++;
  }
  assignBeams(events);
  return { events, titles: [title], pace };
}
