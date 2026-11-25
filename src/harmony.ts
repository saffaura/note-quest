import type { Mode } from './theory';
import type { TuneEvent } from './tunes';

/** Chord roots (scale degrees, 0 = tonic) the simple harmoniser may choose from. */
const ROOTS: Record<Mode, number[]> = {
  major: [0, 3, 4, 5, 1],
  minor: [0, 3, 4, 5, 2],
};

/** Small preference for the plainest chords, so ties resolve to I, IV and V. */
const PRIOR: Record<number, number> = { 0: 0.15, 3: 0.05, 4: 0.05, 5: -0.1, 1: -0.1, 2: -0.1 };

const degreeOf = (n: number) => ((n % 7) + 7) % 7;

function isChordTone(root: number, mode: Mode, n: number, alt: number): boolean {
  const degree = degreeOf(n);
  const inTriad = [root, (root + 2) % 7, (root + 4) % 7].includes(degree);
  if (alt === 0) return inTriad;
  // The raised seventh of a minor key is the third of the dominant chord.
  return mode === 'minor' && root === 4 && degree === 6 && alt === 1;
}

/**
 * A simple left hand for a melody: one chord root per bar (or per `meter` beats), chosen as the
 * diatonic triad that fits the melody notes of that bar best. The root is placed on the first
 * melody note that starts in the bar. Notes before `pickup` beats get no bass.
 */
export function autoBass(events: TuneEvent[], mode: Mode, meter = 4, pickup = 0): TuneEvent[] {
  const starts: number[] = [];
  let beat = 0;
  for (const ev of events) {
    starts.push(beat);
    beat += ev.dur;
  }
  const windowOf = (i: number) => (starts[i] < pickup - 1e-6 ? -1 : Math.floor((starts[i] - pickup + 1e-6) / meter));

  const windows = new Map<number, number[]>();
  events.forEach((_, i) => {
    const w = windowOf(i);
    if (w < 0) return;
    if (!windows.has(w)) windows.set(w, []);
    windows.get(w)!.push(i);
  });

  const out = events.map((ev) => ({ ...ev, notes: ev.notes.map((n) => ({ ...n })) }));
  let previous = -1;
  for (const w of [...windows.keys()].sort((a, b) => a - b)) {
    const members = windows.get(w)!;
    let best = 0;
    let bestScore = -Infinity;
    for (const root of ROOTS[mode]) {
      let score = PRIOR[root] + (root === previous ? 0.3 : 0);
      members.forEach((i, k) => {
        const weight = events[i].dur * (k === 0 ? 1.5 : 1);
        const note = events[i].notes[0];
        score += isChordTone(root, mode, note.n, note.alt) ? weight : -0.4 * weight;
      });
      if (w === 0 && root === 0) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = root;
      }
    }
    out[members[0]].bass = { n: best, alt: 0 };
    previous = best;
  }
  return out;
}
