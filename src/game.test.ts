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

