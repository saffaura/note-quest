import { describe, expect, it } from 'vitest';
import { GAME_SECONDS, Game, SPEEDUP_EVERY, STREAK_BONUS_AT, TEMPO_MAX, TEMPO_MIN } from './game';
import type { GameEvent, Sequence } from './melody';
import type { Pitch } from './theory';

const pitch = (midi: number): Pitch => ({ d: 0, midi, acc: 0 });
const ev = (id: number, beat: number, ...midis: number[]): GameEvent => ({
  id,
  beat,
  dur: 1,
  notes: midis.map(pitch),
  beamId: null,
  tuneTitle: 't',
});

const make = (events: GameEvent[]) =>
  new Game({ events, titles: [], pace: 1 } as Sequence, { bps: 1, visibleSeconds: 10 });

describe('Game scoring', () => {
  it('awards 5 for the exact key', () => {
    const g = make([ev(0, 0, 60)]);
    expect(g.press(60)?.type).toBe('exact');
    expect(g.score).toBe(5);
    expect(g.streak).toBe(1);
  });

  it('awards 1 for the right note in the wrong octave', () => {
    const g = make([ev(0, 0, 60)]);
    expect(g.press(72)?.type).toBe('octave');
    expect(g.score).toBe(1);
  });

  it('takes 2 off for a wrong note and keeps the note on screen', () => {
    const g = make([ev(0, 0, 60), ev(1, 1, 62)]);
    g.press(60);
    g.press(61);
    expect(g.score).toBe(3);
    expect(g.streak).toBe(0);
    expect(g.current()?.ev.id).toBe(1);
  });

  it('lets the player retry the same note', () => {
    const g = make([ev(0, 0, 60)]);
    expect(g.press(61)?.type).toBe('wrong');
    expect(g.press(62)?.type).toBe('wrong');
    expect(g.current()?.ev.id).toBe(0);
    expect(g.press(60)?.type).toBe('assisted'); // the answer was shown after the second miss
    expect(g.wrongPresses).toBe(2);
  });

  it('never lets the score go below zero', () => {
    const g = make([ev(0, 0, 60)]);
    g.press(61);
    expect(g.score).toBe(0);
  });

  it('always targets the leftmost unhit note', () => {
    const g = make([ev(0, 0, 60), ev(1, 1, 62)]);
    expect(g.press(62)?.type).toBe('wrong');
    g.press(60);
    expect(g.current()?.ev.id).toBe(1);
  });

  it('needs both notes of a double and scores each', () => {
    const g = make([ev(0, 0, 60, 64), ev(1, 2, 67)]);
    expect(g.press(64)?.type).toBe('exact');
    expect(g.current()?.ev.id).toBe(0);
    expect(g.press(48)?.type).toBe('octave');
    expect(g.current()?.ev.id).toBe(1);
    expect(g.score).toBe(6);
  });

  it('registers a miss when a note reaches the left edge', () => {
    const g = make([ev(0, 0, 60), ev(1, 5, 62)]);
    const fx = g.update(g.leadSeconds + 0.01);
    expect(fx.map((f) => f.type)).toEqual(['miss']);
    expect(g.misses).toBe(1);
    expect(g.current()?.ev.id).toBe(1);
    expect(g.score).toBe(0);
  });

  it('ignores presses when nothing is on screen yet', () => {
    const g = new Game({ events: [ev(0, 20, 60)], titles: [], pace: 1 } as Sequence, { bps: 1, visibleSeconds: 5 });
    expect(g.press(60)).toBeNull();
    expect(g.score).toBe(0);
  });

  it('ends after 60 seconds', () => {
    const g = make([ev(0, 0, 60)]);
    for (let i = 0; i < 700; i++) g.update(0.1);
    expect(g.finished).toBe(true);
    expect(g.time).toBe(GAME_SECONDS);
    expect(g.press(60)).toBeNull();
  });
});

describe('Streak bonus', () => {
  const N = STREAK_BONUS_AT;
  const run = (count: number) => make(Array.from({ length: count }, (_, i) => ev(i, 0, 60)));
  const bonusOf = (fx: ReturnType<Game['press']>) => (fx && (fx.type === 'exact' || fx.type === 'octave') ? fx.bonus : -1);

  it('is 10 correct notes in a row', () => {
    expect(N).toBe(10);
  });

  it('adds +3 to every correct note after the tenth in a row', () => {
    const g = run(N + 3);
    const bonuses: number[] = [];
    for (let i = 0; i < N + 3; i++) bonuses.push(bonusOf(g.press(60)));
    expect(bonuses).toEqual([...Array(N).fill(0), 3, 3, 3]);
    expect(g.score).toBe((N + 3) * 5 + 3 * 3);
    expect(g.bonusPoints).toBe(9);
    expect(g.onStreak).toBe(true);
  });

  it('also applies to right-note-wrong-octave hits', () => {
    const g = run(N + 2);
    for (let i = 0; i < N; i++) g.press(60);
    const fx = g.press(72);
    expect(fx?.type === 'octave' && fx.bonus).toBe(3);
    expect(g.score).toBe(N * 5 + 1 + 3);
  });

  it('stops at a wrong note and has to be earned again', () => {
    const g = run(N * 2 + 4);
    for (let i = 0; i < N + 1; i++) g.press(60);
    expect(g.onStreak).toBe(true);
    g.press(61);
    expect(g.streak).toBe(0);
    expect(g.onStreak).toBe(false);
    const after: number[] = [];
    for (let i = 0; i < N + 1; i++) after.push(bonusOf(g.press(60)));
    expect(after).toEqual([...Array(N).fill(0), 3]);
  });

  it('stops when a note is missed', () => {
    const g = run(N + 3);
    for (let i = 0; i < N + 1; i++) g.press(60);
    g.update(100);
    expect(g.streak).toBe(0);
    expect(g.onStreak).toBe(false);
  });
});

describe('Wrong-note hints', () => {
  it('earns no points for the note that was shown after two wrong presses', () => {
    const g = make([ev(0, 0, 60), ev(1, 1, 62)]);
    g.press(61);
    g.press(63);
    expect(g.score).toBe(0);
    const fx = g.press(60);
    expect(fx?.type).toBe('assisted');
    expect(g.score).toBe(0);
    expect(g.streak).toBe(0);
    expect(g.assistedHits).toBe(0 + 1);
    expect(g.exactHits).toBe(0);
    expect(g.current()?.ev.id).toBe(1); // the note is cleared and the game moves on
    // The next note scores normally again.
    expect(g.press(62)?.type).toBe('exact');
    expect(g.score).toBe(5);
  });

  it('also gives no points for the right note in another octave after a hint', () => {
    const g = make([ev(0, 0, 60)]);
    g.press(61);
    g.press(63);
    expect(g.press(72)?.type).toBe('assisted');
    expect(g.score).toBe(0);
  });

  it('keeps every note of a pair unscored once the pair was hinted', () => {
    const g = make([ev(0, 0, 60, 64)]);
    g.press(61);
    g.press(62);
    expect(g.press(60)?.type).toBe('assisted');
    expect(g.press(64)?.type).toBe('assisted');
    expect(g.score).toBe(0);
  });

  it('still scores normally after a single wrong press', () => {
    const g = make([ev(0, 0, 60)]);
    g.press(61);
    expect(g.press(60)?.type).toBe('exact');
    expect(g.score).toBe(5);
  });

  it('shows the correct key from the second wrong press in a row', () => {
    const g = make([ev(0, 0, 60, 64)]);
    const first = g.press(61);
    expect(first?.type === 'wrong' && first.hint).toEqual([]);
    const second = g.press(62);
    expect(second?.type === 'wrong' && second.hint).toEqual([60, 64]);
  });

  it('only hints for notes that are still pending, and resets after a correct press', () => {
    const g = make([ev(0, 0, 60, 64), ev(1, 1, 67)]);
    g.press(61);
    g.press(60);
    const wrong = g.press(62);
    expect(wrong?.type === 'wrong' && wrong.hint).toEqual([]);
    const again = g.press(63);
    expect(again?.type === 'wrong' && again.hint).toEqual([64]);
    g.press(64);
    g.press(61);
    const next = g.press(62);
    expect(next?.type === 'wrong' && next.hint).toEqual([67]);
  });
});

describe('Tempo', () => {
  const run = (count: number) => Array.from({ length: count }, (_, i) => ev(i, i, 60 + (i % 5)));
  /** Plays note `i` one second after the previous one, so each is hit just after it appears. */
  const playPrompt = (g: Game, i: number) => {
    g.update(1);
    return g.press(60 + (i % 5));
  };

  it('starts at normal speed and the song clock follows real time', () => {
    const g = make(run(3));
    g.update(2);
    expect(g.tempo).toBe(1);
    expect(g.songTime).toBeCloseTo(2);
  });

  it('runs the song clock at the current tempo while the 60 s timer stays real', () => {
    const g = make(run(3));
    g.tempo = g.tempoTarget = 1.2;
    g.update(1);
    expect(g.time).toBeCloseTo(1);
    expect(g.songTime).toBeCloseTo(1.2);
  });

  it('speeds up slightly after 10 perfect notes in a row played soon after they appear, then every 7 more', () => {
    const g = make(run(30));
    const changes: [string, number][] = [];
    g.onTempo = (dir, target) => changes.push([dir, target]);
    for (let i = 0; i < STREAK_BONUS_AT - 1; i++) playPrompt(g, i);
    expect(g.tempoTarget).toBe(1);
    playPrompt(g, STREAK_BONUS_AT - 1);
    expect(g.tempoTarget).toBeCloseTo(1.05);
    for (let i = STREAK_BONUS_AT; i < STREAK_BONUS_AT + SPEEDUP_EVERY - 1; i++) playPrompt(g, i);
    expect(g.tempoTarget).toBeCloseTo(1.05);
    playPrompt(g, STREAK_BONUS_AT + SPEEDUP_EVERY - 1);
    expect(g.tempoTarget).toBeCloseTo(1.1);
    expect(changes).toEqual([
      ['up', 1.05],
      ['up', 1.1],
    ]);
    g.update(3);
    expect(g.tempo).toBeGreaterThan(1);
    expect(g.tempo).toBeLessThanOrEqual(g.tempoTarget);
  });

  it('does not speed up when notes are played late, close to the vanish line', () => {
    const g = make(run(30));
    g.update(4); // the first note is already 40% of the way across when it is played
    for (let i = 0; i < 20; i++) {
      expect(g.press(60 + (i % 5))?.type).toBe('exact');
      g.update(1);
    }
    expect(g.tempoTarget).toBe(1);
  });

  it('does not count the right note in another octave toward speeding up', () => {
    const g = make(run(30));
    for (let i = 0; i < 9; i++) playPrompt(g, i);
    g.update(1);
    g.press(72 + (9 % 5));
    for (let i = 10; i < 19; i++) playPrompt(g, i);
    expect(g.tempoTarget).toBe(1);
  });

  it('starts the run again after a wrong note', () => {
    const g = make(run(30));
    for (let i = 0; i < 9; i++) playPrompt(g, i);
    g.update(1);
    g.press(70);
    g.press(60 + (9 % 5));
    for (let i = 10; i < 18; i++) playPrompt(g, i);
    expect(g.tempoTarget).toBe(1);
    playPrompt(g, 18);
    expect(g.tempoTarget).toBeCloseTo(1.05);
  });

  it('never goes above the maximum tempo', () => {
    const g = make(run(60));
    g.tempo = g.tempoTarget = 1.28;
    for (let i = 0; i < 40; i++) {
      g.update(0.2);
      g.press(60 + (i % 5));
    }
    expect(g.tempoTarget).toBeLessThanOrEqual(TEMPO_MAX);
  });

  it('slows down after 5 wrong notes in a row', () => {
    const g = make(run(5));
    const changes: [string, number][] = [];
    g.onTempo = (dir, target) => changes.push([dir, target]);
    for (let i = 0; i < 4; i++) g.press(70);
    expect(g.tempoTarget).toBe(1);
    g.press(70);
    expect(g.tempoTarget).toBeCloseTo(0.9);
    expect(changes).toEqual([['down', 0.9]]);
  });

  it('slows down after 5 missed notes in a row', () => {
    const g = make(run(5));
    g.update(30);
    expect(g.misses).toBe(5);
    expect(g.tempoTarget).toBeCloseTo(0.9);
  });

  it('counts wrong notes and misses together, and a correct note starts the count again', () => {
    const g = make(run(6));
    for (let i = 0; i < 4; i++) g.press(70);
    g.press(60); // shown after the hint: clears the note, neither fails nor helps
    expect(g.press(61)?.type).toBe('exact');
    for (let i = 0; i < 4; i++) g.press(70);
    expect(g.tempoTarget).toBe(1);
    g.update(30); // the rest are missed: 4 + 3 more in a row
    expect(g.tempoTarget).toBeLessThan(1);
  });

  it('never goes below the minimum tempo', () => {
    const g = make(run(40));
    g.update(60);
    expect(g.tempoTarget).toBeCloseTo(TEMPO_MIN);
  });

  it('moves the speed gradually rather than jumping', () => {
    const g = make(run(5));
    g.update(30);
    const before = g.tempo;
    expect(before).toBeGreaterThan(g.tempoTarget);
    g.update(0.05);
    expect(g.tempo).toBeLessThan(before);
    expect(g.tempo).toBeGreaterThan(g.tempoTarget);
  });
});

