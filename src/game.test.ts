import { describe, expect, it } from 'vitest';
import { GAME_SECONDS, Game } from './game';
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
    expect(g.press(60)?.type).toBe('exact');
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
  const run = (count: number) => make(Array.from({ length: count }, (_, i) => ev(i, 0, 60)));

  it('adds +3 to every correct note after the fifth in a row', () => {
    const g = run(8);
    const bonuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const fx = g.press(60);
      bonuses.push(fx && fx.type === 'exact' ? fx.bonus : -1);
    }
    expect(bonuses).toEqual([0, 0, 0, 0, 0, 3, 3, 3]);
    expect(g.score).toBe(8 * 5 + 3 * 3);
    expect(g.bonusPoints).toBe(9);
    expect(g.onStreak).toBe(true);
  });

  it('also applies to right-note-wrong-octave hits', () => {
    const g = run(7);
    for (let i = 0; i < 5; i++) g.press(60);
    const fx = g.press(72);
    expect(fx?.type === 'octave' && fx.bonus).toBe(3);
    expect(g.score).toBe(25 + 1 + 3);
  });

  it('stops at a wrong note and has to be earned again', () => {
    const g = run(14);
    for (let i = 0; i < 6; i++) g.press(60);
    expect(g.onStreak).toBe(true);
    g.press(61);
    expect(g.streak).toBe(0);
    expect(g.onStreak).toBe(false);
    const after: number[] = [];
    for (let i = 0; i < 6; i++) {
      const fx = g.press(60);
      after.push(fx && fx.type === 'exact' ? fx.bonus : -1);
    }
    expect(after).toEqual([0, 0, 0, 0, 0, 3]);
  });

  it('stops when a note is missed', () => {
    const g = run(8);
    for (let i = 0; i < 6; i++) g.press(60);
    g.update(100);
    expect(g.streak).toBe(0);
    expect(g.onStreak).toBe(false);
  });
});

describe('Wrong-note hints', () => {
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

