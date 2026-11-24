export type Mode = 'major' | 'minor';
export type ClefMode = 'treble' | 'bass' | 'both';
export type ClefName = 'treble' | 'bass';
export type Difficulty = 'easy' | 'medium' | 'hard';

export const LETTER_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
export const NATURAL_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
export const MODE_INTERVALS: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

export interface Tonic {
  letter: number; // 0 = C ... 6 = B
  acc: number; // -1 flat, 0 natural, 1 sharp
}

export interface Key {
  tonic: Tonic;
  mode: Mode;
}

/** A pitch on the staff. `d` is the diatonic step (octave * 7 + letter index). */
export interface Pitch {
  d: number;
  midi: number;
  acc: number;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

export function accSymbol(acc: number): string {
  switch (acc) {
    case 1:
      return '♯';
    case -1:
      return '♭';
    case 2:
      return '𝄪';
    case -2:
      return '𝄫';
    default:
      return '';
  }
}

const T = (name: string): Tonic => ({
  letter: LETTER_NAMES.indexOf(name[0] as (typeof LETTER_NAMES)[number]),
  acc: name[1] === '#' ? 1 : name[1] === 'b' ? -1 : 0,
});

/** Parse a tonic like "C", "F#" or "Bb". */
export const parseTonic = T;

export const TONICS: Record<Mode, Tonic[]> = {
  major: ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'F', 'Bb', 'Eb', 'Ab', 'Db'].map(T),
  minor: ['A', 'E', 'B', 'F#', 'C#', 'G#', 'D', 'G', 'C', 'F', 'Bb', 'Eb'].map(T),
};

export function tonicName(t: Tonic): string {
  return LETTER_NAMES[t.letter] + accSymbol(t.acc);
}

export function keyLabel(key: Key): string {
  return `${tonicName(key.tonic)} ${key.mode}`;
}

export function tonicMidi(key: Key, octave: number): number {
  return 12 * (octave + 1) + NATURAL_SEMITONES[key.tonic.letter] + key.tonic.acc;
}

export function midiFromD(d: number, acc: number): number {
  return 12 * (Math.floor(d / 7) + 1) + NATURAL_SEMITONES[mod(d, 7)] + acc;
}

/**
 * The note `n` scale steps above the tonic (negative = below), with an optional
 * chromatic alteration, where the tonic sits in `octave`.
 */
export function scaleNote(key: Key, octave: number, n: number, alt = 0): Pitch {
  const degree = mod(n, 7);
  const oct = Math.floor(n / 7);
  const midi = tonicMidi(key, octave) + 12 * oct + MODE_INTERVALS[key.mode][degree] + alt;
  const d = octave * 7 + key.tonic.letter + n;
  return { d, midi, acc: midi - midiFromD(d, 0) };
}

export function pitchName(p: Pitch): string {
  return LETTER_NAMES[mod(p.d, 7)] + accSymbol(p.acc);
}

export function octaveOf(p: Pitch): number {
  return Math.floor(p.d / 7);
}

/** Accidental the key signature applies to each letter (index 0 = C). */
export function keyAccidentals(key: Key): number[] {
  const accs = [0, 0, 0, 0, 0, 0, 0];
  for (let n = 0; n < 7; n++) {
    const p = scaleNote(key, 4, n);
    accs[mod(p.d, 7)] = p.acc;
  }
  return accs;
}

// Diatonic steps for each accidental, treble clef. Bass clef sits 14 steps lower.
const TREBLE_SHARP_D = [38, 35, 39, 36, 33, 37, 34];
const TREBLE_FLAT_D = [34, 37, 33, 36, 32, 35, 31];

export interface KeySignature {
  kind: 'sharp' | 'flat' | 'none';
  count: number;
}

export function keySignature(key: Key): KeySignature {
  const accs = keyAccidentals(key);
  const sharps = accs.filter((a) => a > 0).length;
  const flats = accs.filter((a) => a < 0).length;
  if (sharps > 0) return { kind: 'sharp', count: sharps };
  if (flats > 0) return { kind: 'flat', count: flats };
  return { kind: 'none', count: 0 };
}

export function keySignatureSlots(key: Key, clef: ClefName): { d: number; acc: number }[] {
  const sig = keySignature(key);
  if (sig.kind === 'none') return [];
  const shift = clef === 'treble' ? 0 : -14;
  const table = sig.kind === 'sharp' ? TREBLE_SHARP_D : TREBLE_FLAT_D;
  return table.slice(0, sig.count).map((d) => ({ d: d + shift, acc: sig.kind === 'sharp' ? 1 : -1 }));
}

export function keySignatureDescription(key: Key): string {
  const sig = keySignature(key);
  if (sig.kind === 'none') return 'no sharps or flats';
  const word = sig.kind === 'sharp' ? 'sharp' : 'flat';
  return `${sig.count} ${word}${sig.count > 1 ? 's' : ''}`;
}

export interface StaffDef {
  clef: ClefName;
  bottomD: number; // diatonic step of the bottom line
}

export const TREBLE_STAFF: StaffDef = { clef: 'treble', bottomD: 30 }; // E4
export const BASS_STAFF: StaffDef = { clef: 'bass', bottomD: 18 }; // G2
export const MIDDLE_C_D = 28;

export function stavesFor(mode: ClefMode): StaffDef[] {
  if (mode === 'treble') return [TREBLE_STAFF];
  if (mode === 'bass') return [BASS_STAFF];
  return [TREBLE_STAFF, BASS_STAFF];
}

export function staffForNote(d: number, mode: ClefMode): StaffDef {
  if (mode === 'treble') return TREBLE_STAFF;
  if (mode === 'bass') return BASS_STAFF;
  return d >= MIDDLE_C_D ? TREBLE_STAFF : BASS_STAFF;
}

/** Diatonic steps at which a ledger line must be drawn for a note on this staff. */
export function ledgerLines(d: number, staff: StaffDef): number[] {
  const top = staff.bottomD + 8;
  const lines: number[] = [];
  if (d > top) for (let l = top + 2; l <= d; l += 2) lines.push(l);
  if (d < staff.bottomD) for (let l = staff.bottomD - 2; l >= d; l -= 2) lines.push(l);
  return lines;
}

/** Playable (and placeable) MIDI range for each clef choice. Both ends are white keys. */
export const PIANO_RANGE: Record<ClefMode, [number, number]> = {
  treble: [60, 84], // C4 - C6
  bass: [36, 60], // C2 - C4
  both: [48, 76], // C3 - E5
};

export const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(mod(midi, 12));

/** Diatonic step of a white-key MIDI note. */
export function whiteMidiToD(midi: number): number {
  const pc = mod(midi, 12);
  const letter = NATURAL_SEMITONES.indexOf(pc);
  return (Math.floor(midi / 12) - 1) * 7 + letter;
}

export const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
