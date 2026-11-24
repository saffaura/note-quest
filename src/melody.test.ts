import { describe, expect, it } from 'vitest';
import { DIFFICULTY, buildSequence, mulberry32, timing, tunePool } from './melody';
import { GAME_SECONDS, Game } from './game';
import { PIANO_RANGE, TONICS, type ClefMode, type Difficulty, type Key } from './theory';
import { TUNES, parseTune } from './tunes';

describe('tune parser', () => {
  it('parses degrees, octaves, alterations and durations', () => {
    const [a, b, c] = parseTune("3 #7,:.5 5':2");
    expect(a).toEqual({ notes: [{ n: 2, alt: 0 }], dur: 1 });
    expect(b).toEqual({ notes: [{ n: -1, alt: 1 }], dur: 0.5 });
    expect(c).toEqual({ notes: [{ n: 11, alt: 0 }], dur: 2 });
  });
  it('rejects junk', () => {
    expect(() => parseTune('3 x')).toThrow();
  });
  it('parses every library tune', () => {
    for (const t of TUNES) expect(parseTune(t.score).length).toBeGreaterThan(8);
  });
});

describe('tune pools', () => {
  it('only offers altered tunes in their own mode', () => {
    const majorHard = tunePool('hard', 'major').map((t) => t.id);
    expect(majorHard).not.toContain('fur-elise');
    expect(tunePool('hard', 'minor').map((t) => t.id)).toContain('fur-elise');
  });
  it('has enough tunes for every mode and level', () => {
    for (const mode of ['major', 'minor'] as const)
      for (const level of ['easy', 'medium', 'hard'] as const)
        expect(tunePool(level, mode).length).toBeGreaterThanOrEqual(3);
  });
});

describe('sequence building', () => {
  const clefs: ClefMode[] = ['treble', 'bass', 'both'];
  const levels: Difficulty[] = ['easy', 'medium', 'hard'];

  it('fits every key, clef and difficulty inside the piano range', () => {
    let seed = 1;
    for (const mode of ['major', 'minor'] as const) {
      for (const tonic of TONICS[mode]) {
        for (const clef of clefs) {
          for (const difficulty of levels) {
            const key: Key = { tonic, mode };
            const seq = buildSequence({ key, clef, difficulty }, mulberry32(seed++));
            expect(seq.events.length).toBeGreaterThan(20);
            expect(seq.titles).toHaveLength(1);
            const pacing = timing(difficulty, seq.pace);
            const game = new Game(seq, pacing);
            // Music must last the whole game and keep the right edge of the staff filled.
            expect(game.events.at(-1)!.t).toBeGreaterThanOrEqual(GAME_SECONDS + pacing.visibleSeconds);
            const [lo, hi] = PIANO_RANGE[clef];
            for (const ev of seq.events) {
              expect(ev.notes.length).toBeLessThanOrEqual(2);
              expect(new Set(ev.notes.map((n) => n.midi)).size).toBe(ev.notes.length);
              for (const n of ev.notes) {
                expect(n.midi).toBeGreaterThanOrEqual(lo);
                expect(n.midi).toBeLessThanOrEqual(hi);
                expect(Math.abs(n.acc)).toBeLessThanOrEqual(2);
              }
            }
          }
        }
      }
    }
  });

  it('never adds doubles or beams on easy', () => {
    const key: Key = { tonic: TONICS.major[0], mode: 'major' };
    for (let s = 0; s < 20; s++) {
      const seq = buildSequence({ key, clef: 'treble', difficulty: 'easy' }, mulberry32(s), 60);
      expect(seq.events.every((e) => e.notes.length === 1)).toBe(true);
    }
  });

  it('produces doubles and beams on hard', () => {
    const key: Key = { tonic: TONICS.major[0], mode: 'major' };
    let doubles = 0;
    let beams = 0;
    for (let s = 0; s < 20; s++) {
      const seq = buildSequence({ key, clef: 'treble', difficulty: 'hard' }, mulberry32(s), 100);
      doubles += seq.events.filter((e) => e.notes.length === 2).length;
      beams += seq.events.filter((e) => e.beamId !== null).length;
    }
    expect(doubles).toBeGreaterThan(0);
    expect(beams).toBeGreaterThan(0);
  });

  it('is different each playthrough but repeatable per seed', () => {
    const key: Key = { tonic: TONICS.major[0], mode: 'major' };
    const make = (seed: number) =>
      buildSequence({ key, clef: 'treble', difficulty: 'easy' }, mulberry32(seed)).titles.join('|');
    expect(make(5)).toBe(make(5));
    const variants = new Set(Array.from({ length: 12 }, (_, i) => make(i)));
    expect(variants.size).toBeGreaterThan(1);
  });

  it('plays slow-paced tunes slower than the difficulty default', () => {
    const key: Key = { tonic: TONICS.major[0], mode: 'major' };
    const seen = new Map<string, number>();
    for (let seed = 0; seed < 80; seed++) {
      const seq = buildSequence({ key, clef: 'treble', difficulty: 'easy' }, mulberry32(seed));
      seen.set(seq.titles[0], seq.pace);
    }
    expect(seen.get('Pavane for a Dead Princess')).toBe(0.6);
    expect(seen.get('Ode to Joy')).toBe(1);
    const slow = timing('easy', 0.6);
    expect(slow.bps).toBeLessThan(DIFFICULTY.easy.bps);
    expect(slow.visibleSeconds).toBeGreaterThan(DIFFICULTY.easy.visibleSeconds);
  });

  it('includes Chopin at every difficulty', () => {
    for (const level of ['easy', 'medium', 'hard'] as const) {
      expect(TUNES.some((t) => t.composer === 'Chopin' && t.level === level)).toBe(true);
    }
  });

  it('can play every library tune for a full game, repeating it if it is short', () => {
    const seen = new Set<string>();
    for (const mode of ['major', 'minor'] as const) {
      for (const difficulty of levels) {
        const key: Key = { tonic: TONICS[mode][0], mode };
        for (let seed = 0; seed < 60; seed++) {
          const seq = buildSequence({ key, clef: 'treble', difficulty }, mulberry32(seed));
          seen.add(seq.titles[0]);
        }
      }
    }
    for (const tune of TUNES) expect(seen.has(tune.title), tune.title).toBe(true);
  });
});
