import { describe, expect, it } from 'vitest';
import {
  type Key,
  TONICS,
  keyAccidentals,
  keySignature,
  keySignatureSlots,
  ledgerLines,
  pitchName,
  scaleNote,
  staffForNote,
  stavesFor,
  TREBLE_STAFF,
  BASS_STAFF,
  whiteMidiToD,
} from './theory';

const key = (name: string, mode: 'major' | 'minor'): Key => {
  const tonic = TONICS[mode].find((t) => t.letter === 'CDEFGAB'.indexOf(name[0]) && t.acc === (name[1] === '#' ? 1 : name[1] === 'b' ? -1 : 0));
  if (!tonic) throw new Error(`no tonic ${name}`);
  return { tonic, mode };
};

const names = (k: Key) => Array.from({ length: 8 }, (_, n) => pitchName(scaleNote(k, 4, n)));

describe('scale spelling', () => {
  it('spells C major with naturals', () => {
    expect(names(key('C', 'major'))).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C']);
  });
  it('spells F# major with E#', () => {
    expect(names(key('F#', 'major'))).toEqual(['F♯', 'G♯', 'A♯', 'B', 'C♯', 'D♯', 'E♯', 'F♯']);
  });
  it('spells Bb major with flats', () => {
    expect(names(key('Bb', 'major'))).toEqual(['B♭', 'C', 'D', 'E♭', 'F', 'G', 'A', 'B♭']);
  });
  it('spells C# minor', () => {
    expect(names(key('C#', 'minor'))).toEqual(['C♯', 'D♯', 'E', 'F♯', 'G♯', 'A', 'B', 'C♯']);
  });
  it('spells Eb minor with six flats', () => {
    expect(names(key('Eb', 'minor'))).toEqual(['E♭', 'F', 'G♭', 'A♭', 'B♭', 'C♭', 'D♭', 'E♭']);
  });
  it('maps middle C to MIDI 60 and A4 to 69', () => {
    expect(scaleNote(key('C', 'major'), 4, 0).midi).toBe(60);
    expect(scaleNote(key('A', 'minor'), 4, 0).midi).toBe(69);
  });
  it('uses every letter exactly once in every key', () => {
    for (const mode of ['major', 'minor'] as const) {
      for (const tonic of TONICS[mode]) {
        const letters = new Set(Array.from({ length: 7 }, (_, n) => scaleNote({ tonic, mode }, 4, n).d % 7));
        expect(letters.size).toBe(7);
      }
    }
  });
});

describe('key signatures', () => {
  it('counts accidentals', () => {
    expect(keySignature(key('G', 'major'))).toEqual({ kind: 'sharp', count: 1 });
    expect(keySignature(key('F', 'major'))).toEqual({ kind: 'flat', count: 1 });
    expect(keySignature(key('A', 'minor'))).toEqual({ kind: 'none', count: 0 });
    expect(keySignature(key('C#', 'minor'))).toEqual({ kind: 'sharp', count: 4 });
    expect(keySignature(key('Eb', 'minor'))).toEqual({ kind: 'flat', count: 6 });
  });
  it('places treble and bass accidentals', () => {
    expect(keySignatureSlots(key('D', 'major'), 'treble').map((s) => s.d)).toEqual([38, 35]);
    expect(keySignatureSlots(key('D', 'major'), 'bass').map((s) => s.d)).toEqual([24, 21]);
    expect(keySignatureSlots(key('Bb', 'major'), 'treble').map((s) => s.d)).toEqual([34, 37]);
  });
  it('reports the accidental for each letter', () => {
    expect(keyAccidentals(key('D', 'major'))).toEqual([1, 0, 0, 1, 0, 0, 0]);
  });
});

describe('staff geometry', () => {
  it('converts white keys to diatonic steps', () => {
    expect(whiteMidiToD(60)).toBe(28);
    expect(whiteMidiToD(64)).toBe(30);
    expect(whiteMidiToD(43)).toBe(18);
  });
  it('draws a ledger line for middle C on the grand staff', () => {
    expect(staffForNote(28, 'both')).toBe(TREBLE_STAFF);
    expect(ledgerLines(28, TREBLE_STAFF)).toEqual([28]);
    expect(staffForNote(27, 'both')).toBe(BASS_STAFF);
    expect(ledgerLines(27, BASS_STAFF)).toEqual([]);
  });
  it('draws ledger lines above and below', () => {
    expect(ledgerLines(40, TREBLE_STAFF)).toEqual([40]);
    expect(ledgerLines(41, TREBLE_STAFF)).toEqual([40]);
    expect(ledgerLines(42, TREBLE_STAFF)).toEqual([40, 42]);
    expect(ledgerLines(34, TREBLE_STAFF)).toEqual([]);
    expect(ledgerLines(28, TREBLE_STAFF)).toEqual([28]);
    expect(ledgerLines(16, BASS_STAFF)).toEqual([16]);
    expect(ledgerLines(28, BASS_STAFF)).toEqual([28]);
  });
  it('returns the right staves', () => {
    expect(stavesFor('both')).toHaveLength(2);
  });
});
