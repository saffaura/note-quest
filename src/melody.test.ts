import { describe, expect, it } from 'vitest';
import { BOTH_HARD_PACE, DIFFICULTY, buildSequence, mulberry32, timing, tunePace, tuneFits, tunePool } from './melody';
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
    expect(seen.get('Prelude in C (BWV 846)')).toBe(1);
    const slow = timing('easy', 0.6);
    expect(slow.bps).toBeLessThan(DIFFICULTY.easy.bps);
    expect(slow.visibleSeconds).toBeGreaterThan(DIFFICULTY.easy.visibleSeconds);
  });

  it('plays a forced debug tune, or says clearly that it does not fit', () => {
    const tonic = TONICS.major[0];
    const key: Key = { tonic, mode: 'major' };
    let played = 0;
    let rejected = 0;
    for (const tune of TUNES) {
      for (const clef of clefs) {
        for (const difficulty of levels) {
          try {
            const seq = buildSequence({ key, clef, difficulty, tuneId: tune.id }, mulberry32(3));
            expect(seq.titles).toEqual([tune.title]);
            expect(seq.pace).toBeCloseTo(tunePace(tune, difficulty) * (clef === 'both' && difficulty === 'hard' ? BOTH_HARD_PACE : 1));
            played++;
          } catch (err) {
            expect((err as Error).message).toMatch(/does not fit/);
            expect(tuneFits(tune, key, clef)).toBe(false);
            rejected++;
          }
        }
      }
    }
    expect(played).toBeGreaterThan(0);
    expect(() => buildSequence({ key, clef: 'treble', difficulty: 'easy', tuneId: 'nope' }, mulberry32(1))).toThrow(/Unknown tune/);
    // The Pavane fits treble in every major key, so forcing it must never throw.
    for (const t of TONICS.major) {
      const seq = buildSequence({ key: { tonic: t, mode: 'major' }, clef: 'treble', difficulty: 'hard', tuneId: 'ravel-pavane' }, mulberry32(9));
      expect(seq.titles[0]).toBe('Pavane for a Dead Princess');
    }
    console.log(`forced tunes: ${played} played, ${rejected} rejected (C major)`);
  });

  it('never leaves a long empty gap between notes', () => {
    for (const mode of ['major', 'minor'] as const) {
      const key: Key = { tonic: TONICS[mode][0], mode };
      for (const difficulty of levels) {
        for (const tune of TUNES) {
          let seq;
          try {
            seq = buildSequence({ key, clef: 'treble', difficulty, tuneId: tune.id }, mulberry32(5));
          } catch {
            continue;
          }
          const { bps } = timing(difficulty, seq.pace);
          // One beat is the shortest spacing a note can get, so slow-paced tunes may exceed 2 s.
          // A repeat starts on a whole beat, which can add up to half a beat at the join.
          const limit = Math.max(2, 1 / bps) + 0.5 / bps + 1e-9;
          for (let i = 1; i < seq.events.length; i++) {
            const gap = (seq.events[i].beat - seq.events[i - 1].beat) / bps;
            expect(gap, `${tune.title} ${difficulty} #${i}`).toBeLessThanOrEqual(limit);
          }
        }
      }
    }
  });

  it('plays the melody on the treble staff and the bass line below it when both clefs are chosen', () => {
    const tune = TUNES.find((t) => t.id === 'chopin-nocturne-55-1')!;
    const melodyOnly = parseTune(tune.score);
    let fitting = 0;
    for (const tonic of TONICS.minor) {
      const key: Key = { tonic, mode: 'minor' };
      for (const difficulty of levels) {
        let seq;
        try {
          seq = buildSequence({ key, clef: 'both', difficulty, tuneId: tune.id }, mulberry32(11));
        } catch {
          continue;
        }
        const [lo, hi] = PIANO_RANGE.both;
        let pairs = 0;
        for (const ev of seq.events) {
          for (const n of ev.notes) expect(n.midi >= lo && n.midi <= hi).toBe(true);
          const [first, ...rest] = ev.notes;
          if (ev.notes.length === 2) {
            pairs++;
            expect(first.midi).toBeLessThan(60); // bass note
            expect(rest[0].midi).toBeGreaterThanOrEqual(60); // melody note
          } else {
            expect(ev.notes.length).toBe(1);
            expect(first.midi).toBeGreaterThanOrEqual(60);
          }
        }
        expect(pairs).toBeGreaterThan(0);
        expect(pairs).toBeLessThan(seq.events.length);
        if (difficulty === 'easy') {
          // The melody itself is unchanged: same intervals as the melody-only tune.
          const melody = seq.events.map((e) => e.notes[e.notes.length - 1].midi);
          const steps = (xs: number[]) => xs.slice(1, melodyOnly.length).map((m, i) => m - xs[i]);
          const plain = buildSequence({ key, clef: 'treble', difficulty, tuneId: tune.id }, mulberry32(11));
          const plainMelody = plain.events.map((e) => e.notes[0].midi);
          expect(steps(melody)).toEqual(steps(plainMelody));
          fitting++;
        }
      }
    }
    expect(fitting).toBeGreaterThanOrEqual(6);
  });

  it('gives every tune a bass line in both-clef mode, and slows hard down', () => {
    const key: Key = { tonic: TONICS.major[0], mode: 'major' };
    const minor: Key = { tonic: TONICS.minor[0], mode: 'minor' };
    for (const tune of TUNES) {
      const k = tune.mode === 'minor' ? minor : key;
      let both;
      try {
        both = buildSequence({ key: k, clef: 'both', difficulty: 'hard', tuneId: tune.id }, mulberry32(2));
      } catch {
        continue;
      }
      const pairs = both.events.filter((e) => e.notes.length === 2);
      expect(pairs.length, tune.title).toBeGreaterThan(0);
      for (const e of pairs) {
        expect(e.notes[0].midi, tune.title).toBeLessThan(60);
        expect(e.notes[1].midi, tune.title).toBeGreaterThanOrEqual(60);
      }
      const treble = buildSequence({ key: k, clef: 'treble', difficulty: 'hard', tuneId: tune.id }, mulberry32(2));
      expect(both.pace).toBeCloseTo(treble.pace * BOTH_HARD_PACE);
      expect(timing('hard', both.pace).bps).toBeLessThan(timing('hard', treble.pace).bps);
    }
  });

  it('rejects a bass line whose length does not match the melody', () => {
    expect(() => parseTune('1 2 3', '1 -')).toThrow(/Bass line/);
    expect(parseTune('1 2 3', '1 - #5')[2].bass).toEqual({ n: 4, alt: 1 });
  });

  it('offers Raindrop on easy at a slower pace, and at normal pace on medium', () => {
    const raindrop = TUNES.find((t) => t.id === 'chopin-raindrop')!;
    expect(raindrop.level).toBe('medium');
    expect(tunePool('easy', 'major').includes(raindrop)).toBe(true);
    expect(tunePool('medium', 'major').includes(raindrop)).toBe(true);
    const key: Key = { tonic: TONICS.major[7], mode: 'major' };
    const easy = buildSequence({ key, clef: 'treble', difficulty: 'easy', tuneId: raindrop.id }, mulberry32(4));
    const medium = buildSequence({ key, clef: 'treble', difficulty: 'medium', tuneId: raindrop.id }, mulberry32(4));
    expect(easy.pace).toBeCloseTo(0.8);
    expect(medium.pace).toBe(1);
    const seen = new Set<string>();
    for (let seed = 0; seed < 120; seed++) {
      seen.add(buildSequence({ key, clef: 'treble', difficulty: 'easy' }, mulberry32(seed)).titles[0]);
    }
    expect(seen.has(raindrop.title)).toBe(true);
  });

  it('offers Schumann Melodie on easy, medium and hard', () => {
    const melodie = TUNES.find((t) => t.id === 'schumann-melodie-68-1')!;
    for (const level of levels) expect(tunePool(level, 'major').includes(melodie), level).toBe(true);
    const key: Key = { tonic: TONICS.major[0], mode: 'major' };
    for (const difficulty of levels) {
      const seen = new Set<string>();
      for (let seed = 0; seed < 150; seed++) {
        seen.add(buildSequence({ key, clef: 'both', difficulty }, mulberry32(seed)).titles[0]);
      }
      expect(seen.has(melodie.title), difficulty).toBe(true);
    }
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
