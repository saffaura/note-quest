import { autoBass } from './harmony';
import type { Difficulty, Mode } from './theory';

export interface TuneNote {
  n: number; // scale steps from the tonic (negative = below)
  alt: number; // chromatic alteration relative to the scale
}

export interface TuneEvent {
  notes: TuneNote[];
  dur: number; // beats; 1 = quarter note
  /** Supporting bass note played together with this melody note (clef "both" only). */
  bass?: TuneNote;
}

export interface Tune {
  id: string;
  title: string;
  composer: string;
  mode: Mode;
  level: Difficulty;
  /** Simplified transcription, see parseTune for the notation. */
  score: string;
  /**
   * Optional hand-written left hand, one token per melody token in `score` (`-` = no bass note
   * there). Played on the bass staff when the player picks both clefs; other clef choices
   * ignore it. Tunes without it get a simple generated bass (see harmony.ts).
   */
  bass?: string;
  /** A fuller bass line used instead of `bass` on hard difficulty (same one-token-per-melody-token format). */
  hardBass?: string;
  /** A sparser bass line used instead of `bass` on easy difficulty (same one-token-per-melody-token format). */
  easyBass?: string;
  /** Beats per bass note for the generated bass (a bar, usually). Default 4. */
  meter?: number;
  /** Beats of lead-in before the first full bar, so the generated bass starts on the downbeat. */
  pickup?: number;
  /** True when the transcription is from memory and should be checked against a PD score. */
  draft?: boolean;
  /** Where a transcription came from, when it was derived from a published edition. */
  source?: string;
  /**
   * Speed multiplier for tunes that are mostly fast notes. Everything slows down together:
   * note spacing in time and how quickly notes cross the screen (0.6 = 40% slower).
   */
  pace?: number;
  /**
   * Also offer this tune on easy (besides its own level), played at this extra speed multiplier
   * (below 1 = slower), for tunes that are fine for easy readers when they are slowed down.
   */
  easyPace?: number;
  /** Extra slowdown on easy when the player chooses both clefs (for tunes that are busy with two hands). */
  easyBothPace?: number;
  /** Extra slowdown on medium when the player chooses both clefs, on top of the general Both-mode slowdown. */
  mediumBothPace?: number;
  /** Extra difficulties to offer this tune on, besides `level`, at its normal speed there. */
  alsoLevels?: Difficulty[];
}

/**
 * Notation: whitespace-separated tokens, `|` is ignored.
 *   [#|b] degree(1-7) [' = octave up, "," = octave down] [:beats]
 * Degrees are relative to the tonic of the tune's own mode. Default length is one beat.
 * A bass line uses the same degree notation without octave marks or lengths (bass notes are
 * folded into the bass staff by the game), with `-` for "no bass note on this melody note".
 */
export function parseTune(score: string, bass?: string): TuneEvent[] {
  const events: TuneEvent[] = [];
  for (const token of score.split(/[\s|]+/).filter(Boolean)) {
    const m = /^([#b]?)([1-7])([',]*)(?::(\d*\.?\d+))?$/.exec(token);
    if (!m) throw new Error(`Bad tune token "${token}"`);
    const alt = m[1] === '#' ? 1 : m[1] === 'b' ? -1 : 0;
    const marks = m[3];
    const octave = [...marks].reduce((sum, c) => sum + (c === "'" ? 1 : -1), 0);
    const dur = Math.min(2, m[4] ? parseFloat(m[4]) : 1);
    events.push({ notes: [{ n: Number(m[2]) - 1 + 7 * octave, alt }], dur });
  }
  if (bass !== undefined) {
    const tokens = bass.split(/[\s|]+/).filter(Boolean);
    if (tokens.length !== events.length) {
      throw new Error(`Bass line has ${tokens.length} tokens but the melody has ${events.length}`);
    }
    tokens.forEach((token, i) => {
      if (token === '-') return;
      const m = /^([#b]?)([1-7])$/.exec(token);
      if (!m) throw new Error(`Bad bass token "${token}"`);
      events[i].bass = { n: Number(m[2]) - 1, alt: m[1] === '#' ? 1 : m[1] === 'b' ? -1 : 0 };
    });
  }
  return events;
}

/** A tune's melody with its bass line: the hand-written one if there is one, else a generated one. */
export function tuneEvents(tune: Tune, difficulty?: Difficulty): TuneEvent[] {
  const bass =
    difficulty === 'hard' && tune.hardBass !== undefined
      ? tune.hardBass
      : difficulty === 'easy' && tune.easyBass !== undefined
        ? tune.easyBass
        : tune.bass;
  if (bass !== undefined) return parseTune(tune.score, bass);
  return autoBass(parseTune(tune.score), tune.mode, tune.meter ?? 4, tune.pickup ?? 0);
}

export const TUNES: Tune[] = [
  {
    id: 'bach-prelude-846',
    title: 'Prelude in C (BWV 846)',
    composer: 'Bach',
    mode: 'major',
    level: 'easy',
    source: 'MusicXML score (bach-prelude-bwv846.mxl), bars 1-4 (C, Dm7/C, G7/B, C): the written broken-chord figure of each bar, every note one beat; the low B of bar 3 is the bass note, bass as written',
    score: `1 3 5 1' 3' 5 1' 3' | 1 2 6 2' 4' 6 2' 4' | 2 5 2' 4' 5 2' 4' | 1 3 5 1' 3' 5 1' 3'`,
    bass: `1 - - - - - - - | 1 - - - - - - - | 7 - - - - - - | 1 - - - - - - -`,
  },
  {
    id: 'bach-petit-prelude-939',
    title: 'Petit Prelude in C (BWV 939)',
    composer: 'Bach',
    mode: 'major',
    level: 'easy',
    source: 'MusicXML score (bach-petit-prelude-bwv939.mxl), bars 1-8, top note of the right hand, every note one beat, bass as written',
    score: `1 3 5 3 1 b7 5 | 6 1 4 6 4 1 1' 6 | 7 5 7 2' 7 5 4' 2' | 3' 3' | 2' 2' |
            2' 5 7 2' 7 3' | 1' 1' | 1' 2 #4 6 #4 2 1' 6`,
    bass: `1 - - - - - - | 1 - - - - - - - | 1 - - - - - - - | 1 - | 2 - |
           5 - - - - - | 6 - | 2 - - - - - - -`,
  },
  {
    id: 'rondo-alla-turca',
    title: 'Turkish March',
    composer: 'Mozart',
    mode: 'minor',
    level: 'hard',
    score: `2':.5 1':.5 #7:.5 1':.5 3':2 4':.5 3':.5 2':.5 3':.5 5':2 6':.5 5':.5 #4':.5 5':.5 2'':.5 1'':.5 #7':.5 1'':.5 2'':.5 1'':.5 #7':.5 1'':.5 3'':2 1'' 3'' 2'' 1'' 7' 1'' 2'' 1'' 7' 1'' 2'' 1'' 7' #6' 5':2 5' 6' 7' 7' 1'':.5 7':.5 6':.5 5':.5 4':2 5' 6' 7' 7' 1'':.5 7':.5 6':.5 5':.5 4':2 3' 4' 5' 5' 6':.5 5':.5 4':.5 3':.5 2':2 3' 4' 5' 5' 6':.5 5':.5 4':.5 3':.5 2':2
            2':.5 1':.5 #7:.5 1':.5 3':2 4':.5 3':.5 2':.5 3':.5 5':2 6':.5 5':.5 #4':.5 5':.5 2'':.5 1'':.5 #7':.5 1'':.5 2'':.5 1'':.5 #7':.5 1'':.5 3''`,
    source: 'Mutopia Project, Mozart K. 331 Rondo alla Turca (public domain), bars 1-20',
  },

  // Chopin (public domain). Melodies were taken from Mutopia Project MIDI files of public-domain
  // editions and simplified: top line only, ornaments and fast runs thinned to eighth notes.
  {
    id: 'chopin-prelude-4',
    title: 'Prelude in E minor (Op. 28 No. 4)',
    composer: 'Chopin',
    mode: 'minor',
    level: 'easy',
    alsoLevels: ['medium'],
    source: 'MusicXML score (chopin-prelude-op28-4.mxl), the melody of bars 1-11, the restatement in bars 13-15 and the ending in bars 19-25, every note one beat (the climax and the runs of bars 12 and 16-18 are skipped), bass as written',
    score: `5 6 | 5 6 | 5 6 | 5 b5 | 4 5 | 4 5 | 4 5 4 | 4 #3 | #3 4 5 7 6 1 4 | 2 4 | 2 4 |
            5 6 | 5 6 | 5 6 |
            2 4 | 2 2 1 | 1 2 | 1 2 | 1 | 1 #7, | 1`,
    bass: `3 - | 2 - | b2 - | 1 - | 1 - | 1 - | 7 - - | 7 - | 6 - - - - - - | 5 - | 5 - |
           3 - | 2 - | b2 - |
           5 - | 5 - - | 6 - | 5 - | 6 | 5 - | 1`,
  },
  {
    id: 'chopin-prelude-7',
    meter: 3,
    title: 'Prelude in A major (Op. 28 No. 7)',
    composer: 'Chopin',
    mode: 'major',
    level: 'easy',
    source: 'Mutopia Project, Chopin Op. 28 No. 7 (public domain), bars 1-10 and 13-16',
    score: `5 3' 2' 2' 2':2 6' #4' 1'' 1'' 1'':2 3' b2' 4' 4' 4':2 7 7 3' 3' 3':2 5 3' 2' 2' 2':2
            3' 3' 6' 6' 6':2 7 2' 1'' 1'' 1'':2`,
  },
  {
    id: 'chopin-fantaisie-impromptu',
    title: 'Fantaisie-Impromptu (theme)',
    composer: 'Chopin',
    mode: 'major',
    level: 'medium',
    source: 'Mutopia Project, Chopin Op. 66 (public domain), middle section bars 43-58',
    score: `5:2 6:.5 5:.5 1':.5 2':.5 3':2 5' 5 4' 3' 2' 3' 5:2 6:2 b7:.5 6:.5 2':.5 3':.5 4' 3' 2' 3' 1':2 1':1.5 2':.5 2':2
            5:2 6:.5 5:.5 1':.5 2':.5 3':2 5' 5 4' 3' 2' 3' 5:2 6:2 b7:.5 6:.5 2':.5 3':.5 4' 3' 2' 3' 1':1.5 #4:.5 3':1.5 2':.5 2':2 1':1.5 5':.5`,
  },
  {
    id: 'chopin-raindrop',
    title: 'Raindrop Prelude (Op. 28 No. 15)',
    composer: 'Chopin',
    mode: 'major',
    level: 'medium',
    easyPace: 0.8,
    source: 'MusicXML score (chopin-raindrop-prelude.mxl), the main theme, bars 1-19: top line of the right hand with the chords reduced to their top note and the small run in bar 4 thinned to three notes; every note one beat, bass as written',
    score: `3' 1' 5 6 | 7 1' | 2' 3' 4' 3' | 3' 2' 1' 2' 3' 4' |
            3' 1' 5 6 | 7 1' | 2' 3' 4' 3' | 3' 2' 1' 7 1' |
            2' 2' 3' | 4' 3' 2' 1' 3' | 2' b7 6 5 6 6 b7 | 5 2' 1' b3' |
            2' 2' 3' | 4' 3' 2' 1' 3' | 3' 1' 7 6 7 7 1' | 6 3' 2' 4' |
            3' 1' 7 6 7 7 1' | 6 2' 3' 2' | 3' 2'`,
    bass: `1 - - - | 5 - | 1 - - - | 5 - - - - - |
           1 - - - | 5 - | 1 - - - | 5 - - - - |
           5 - - | 4 - - - - | 2 - - - - - - | 5 - - - |
           5 - - | 2 - - - - | 3 - - - - - - | 6 - - - |
           3 - - - - - - | 6 - - - | 5 -`,
  },
  {
    id: 'schumann-melodie-68-1',
    title: 'Melodie (Op. 68 No. 1)',
    composer: 'Schumann',
    mode: 'major',
    level: 'medium',
    alsoLevels: ['easy', 'hard'],
    source: 'MusicXML score (schumann-melodie-op68-1.mxl), the whole right-hand melody, bars 1-20 (rests dropped, chords reduced to their top note), every note one beat, bass as written',
    score: `3' 2' 1' 7 | 6 1' 7 2' 1' 5 | 5' 4' 3' 1' | 7 6 5 | 2' 1' 7 | 4' 3' 2' | 6' 5' 4' 3' | 2' 4' 3' 5' 4' 2' |
            3' 2' 1' 7 | 6 1' 7 2' 1' 5 | 6' 5' 4' 3' | 2' 4' 7 2' 1' | 2' 1' 7 | 4' 3' 2' | 6' 5' 4' 3' | 2' 4' 3' 5' 4' 2' |
            3' 2' 1' 7 | 6 1' 7 2' 1' 5 | 6' 5' 4' 3' | 2' 4' 7 2' 1'`,
    bass: `1 - - - | 4 - - - - - | 3 - - - | 2 - - | 4 - - | 2 - - | 4 - - - | 7 - - - - - |
           1 - - - | 4 - - - - - | 4 - - - | 4 - - - - | 4 - - | 2 - - | 4 - - - | 7 - - - - - |
           1 - - - | 4 - - - - - | 4 - - - | 4 - - - -`,
  },
  {
    id: 'burgmuller-arabesque-100-2',
    title: 'Arabesque (Op. 100 No. 2)',
    composer: 'Burgmüller',
    mode: 'minor',
    level: 'medium',
    alsoLevels: ['easy', 'hard'],
    source: 'MusicXML score (burgmuller-op100no2-arabesque.mxl), right hand bars 3-5 and 7-19 (the runs to E6 in bar 6 are skipped to keep it in range), rests dropped, every note one beat, bass as written',
    score: `1 2 3 2 1 | 1 2 3 4 5 | 4 5 6 7 1' | 5 5 6 | 4 4 | 4 7 4 5 | 3 5 | 3 3' |
            5 2 | 3 1 | 5 2 | 3 1 | 1' 5 | 6 5 | 4 3 2 1 | #7, 5`,
    bass: `1 - - - - | 1 - - - - | 4 - - - - | 3 - - | 7 - | 7 - - - | 3 - | 3 - |
           5 - | 1 - | 5 - | 1 - | 1 - | 4 - | 5 - - - | 5 -`,
  },
  {
    id: 'schumann-traumerei-15-7',
    title: 'Träumerei (Op. 15 No. 7)',
    composer: 'Schumann',
    mode: 'major',
    level: 'easy',
    alsoLevels: ['medium'],
    source: 'MusicXML score (schumann-reverie-op15-7.mxl), the opening C pickup and the right-hand top line of bars 1-4, 9-13 and 16 (the high A and B♭ of bars 6, 7 and 14 are skipped to keep it in range), every note one beat, bass as written',
    score: `5, | 1 1 7, 1 3 | 5 1' 1' 7 6 | 5 1' 2 3 4 6 1 2 | 3 5 2 5, |
            1 1 7, 1 3 | 5 b7 b7 6 5 | 4 6 2 3 4 3 | 2 6, 6, 1 |
            4 4 3 4 6 | 6 3 3 2`,
    bass: `- | 1 - - - - | 1 - - - - | 5 - - - - - - - | 1 - - - |
           1 - - - - | 5 - - - - | 2 - - - - - | 6 - - - |
           4 - - - - | 3 - - -`,
  },
  {
    id: 'chopin-valse-b150',
    title: 'Waltz in A minor (B. 150)',
    composer: 'Chopin',
    mode: 'minor',
    level: 'medium',
    alsoLevels: ['easy', 'hard'],
    source: 'MusicXML score (chopin-valse-b150.mxl), the opening theme: the E pickup and bars 1-14 (bar 15 and later climb too high and are skipped), every note one beat, bass as written',
    score: `5, | 1 2 3 3 | 4 5 6 | 2 3 4 1' 7 6 | 5 #4 5 |
            1 2 3 3 | 4 5 6 | 2 3 4 1' 7 2 | 3 5, |
            1 2 3 3 | 4 5 6 | 2 3 4 1' 7 6 | 5 #4 5 |
            3 4 5 5 | 6 7 1'`,
    bass: `- | 1 - - - | 4 - - | 7 - - - - - | 3 - - |
           1 - - - | 4 - - | 7 - - - - - | 3 - |
           1 - - - | 4 - - | 7 - - - - - | 3 - - |
           1 - - - | 4 - -`,
  },
  {
    id: 'bach-invention-8',
    title: 'Invention No. 8 in F (BWV 779)',
    composer: 'Bach',
    mode: 'major',
    level: 'hard',
    source: 'MusicXML score (bach-invention-8.mxl), the right hand of bars 1-3 and 5-9 (the high run of bar 4 is skipped to keep it in range), every note one beat; the bass notes are the left hand of the same bars wherever it sounds with the melody on an eighth-note beat, folded into the bass staff',
    score: `1 3 1 5 1 |
            1' 7 6 5 6 5 4 3 4 3 2 |
            1 3 5 3 1' 5 |
            1' 3' 2' 3' 1' 3' 2' 3' 1' 3' 2' 3' |
            6 1' 7 1' 6 1' 7 1' 6 1' 7 1' |
            #4 2 6 #4 1' 6 |
            2' 3' 2' 1' 7 1' 7 6 5 6 5 4 |
            3 6 5 #4 5 #4 3 2 3 2 1`,
    bass: `- - - - - |
           - 1 - 3 - 1 - 5 - 1 - |
           1 7 5 5 3 3 |
           3 - 4 - 3 - 4 - 3 - 4 - |
           1 - 2 - 1 - 2 - 1 - 2 - |
           6 7 6 7 6 7 |
           #4 - 2 - 5 - 2 - 7 - 5 - |
           1 1 - 6 - 6 - #4 - #4 -`,
  },
  {
    id: 'mendelssohn-romance-19-1',
    title: 'Romance (Op. 19 No. 1)',
    composer: 'Mendelssohn',
    mode: 'major',
    level: 'medium',
    alsoLevels: ['easy', 'hard'],
    source: 'MusicXML score (mendelssohn-romance-op19-1.mxl), the melody (top voice) of the opening section, bars 2-16, every note one beat, bass as written',
    score: `4 | 3 2 1 1' | 7 6 5 6 | 4 5 2 3 5 4 | 3 2 4 |
            3 2 1 1' | 7 6 5 3' | 6 3' | 6 6 | 6 1' 7 6 3 |
            5 #4 | 4 3 3 | #4 5 7 6 5 | 5 4 | 5 2 2`,
    bass: `- | 1 - - - | 5 - - - | 2 - - - - - | 5 - - |
           1 - - - | 5 - - - | 1 - | 1 - | 2 - - - - |
           2 - | 2 - - | 6 - - - - | 5 - | 5 - -`,
  },
  {
    id: 'grieg-arietta-12-1',
    title: 'Arietta (Op. 12 No. 1)',
    composer: 'Grieg',
    mode: 'major',
    level: 'medium',
    alsoLevels: ['easy', 'hard'],
    source: 'MusicXML score (grieg-arietta.mxl), the melody of bars 1-12, 17-19 and 22 (the repeat of bars 13-16 and the closing bars are skipped), every note one beat; the bass notes are the left-hand bass line where it sounds with the melody',
    score: `3' 3' 3' 3' | 3' #1' 2' | 2' 2' 2' 2' | 2' 7 1' | 1' 1' 7 7 | 6 6 5 | 1' 1' 7 5 7 | 6 6 5 |
            #4 5 6 7 2' 1' | #2 3 | 2 3 4 #5 7 6 | 1 |
            5 5 #4 2 #4 | 4 4 3 | 2 3 4 #5 7 6 | 1`,
    bass: `1 - - - | 1 - - | 1 - - - | 1 - - | 6 - 5 - | #4 - 7 | 6 - 5 - - | #4 - 7 |
           6 - - - - - | 1 - | 4 - - - - - | 5 |
           b7 - 6 - - | 2 - 3 | 4 - - - - - | 5`,
  },
  {
    id: 'burgmuller-limpid-stream-100-5',
    title: 'The Limpid Stream (Op. 100 No. 5)',
    composer: 'Burgmüller',
    mode: 'major',
    level: 'medium',
    alsoLevels: ['easy', 'hard'],
    source: 'MusicXML score (burgmuller-op100-5.mxl), the right hand of bars 1-11 (the climb to C7 in bars 12-14 is skipped to keep it in range), every note one beat; the bass notes are the left-hand chord roots where they sound with the melody',
    score: `3' 2' 1' 7 1' 7 6 5 6 5 4 3 | 5 4 4 | 2' 1' 7 6 5 6 7 1' 2' 3' 4' 5' | 4' 3' 3' |
            3' 2' 1' 7 1' 7 6 #5 6 | 2' 1' 7 6 7 6 5 #4 5 #4 3 2 | b3 2 3 2 7 6 | 5 |
            5 5 #4 5 6 5 | 5 5 6 7 7 1' 2' | 1' 1' 2' 3' 3' 4' 5'`,
    bass: `1 - - - - - - - - - - - | 1 - 1 | 7 - - - - - - - - - - - | 1 - 1 |
           1 - - - - - - - 1 | 2 - - - - - - - 2 - - - | 2 - 2 - 2 - | 5 |
           5 - - - - - | 4 5 - 4 5 - 4 | 3 5 - 3 5 - 3`,
    hardBass: `1 - - - 3 - - - 5 - - - | 1 - 1 | 7 - - - 4 - - - 5 - - - | 1 - 1 |
               1 - - - 3 - - - 1 | 2 - - - 5 - - - 2 - - - | 2 - 2 - 2 - | 5 |
               5 - - - - - | 4 5 - 4 5 - 4 | 3 5 - 3 5 - 3`,
  },
  {
    id: 'satie-gnossienne-1',
    title: 'Gnossienne No. 1',
    composer: 'Satie',
    mode: 'minor',
    level: 'medium',
    alsoLevels: ['easy', 'hard'],
    source: 'MusicXML score (satie-gnossienne1.mxl), the melody of lines 1-3, 6 and 7 without the grace notes (the lines with the run up to B5 are skipped to keep it in range), every note one beat; the bass notes are the written bass, with the left-hand chords added on hard',
    score: `5 7 #6 5 #4 #4 5 7 #6 5 1' 1' 5 7 #6 5 #4 2 2 2 2 |
            2 1 1 1 5 7 #6 5 #4 #4 5 7 #6 5 1' 1' 5 7 #6 5 |
            #4 2 2 2 2 2 1 1 1 4 2 4 2 2 1 1 1 |
            2 1 1 1 4 2 4 2 2 1 1 1 4 2 4 2 |
            2 1 1 1 5 7 #6 5 #4 5 7 #6 5 1' 5 7 #6 5 #4`,
    bass: `- - - - 1 - - - - - 1 - - - - - 1 - 5 - - |
           1 - - 1 - - - - 1 - - - - - 1 - - - - - |
           1 - 5 - - 1 - - 1 4 - 4 - 1 - - 1 |
           1 - - 1 4 - 4 - 1 - - 1 4 - 4 - |
           1 - - 1 - - - - 1 - - - - 1 - - - - 1`,
    hardBass: `3 - - 3 1 - 3 - - 3 1 - 3 - - 3 1 - 5 7 7 |
               1 3 - 1 3 - - 3 1 - 3 - - 3 1 - 3 - - 3 |
               1 - 5 7 7 1 3 - 1 4 - 4 - 1 3 - 1 |
               1 3 - 1 4 - 4 - 1 3 - 1 4 - 4 - |
               1 3 - 1 3 - - 3 1 3 - - 3 1 3 - - 3 1`,
  },
  {
    id: 'kuhlau-sonatina-20-1',
    title: 'Sonatina in C (Op. 20 No. 1), 1st movement',
    composer: 'Kuhlau',
    mode: 'major',
    level: 'medium',
    alsoLevels: ['easy', 'hard'],
    easyBothPace: 0.8,
    source: 'MusicXML score (kuhlau-sonatina-op20no1-1st.mxl), the right hand of bars 1-2, 6-8, 17-20 and 22-25 (the flourishes up to E6 in bars 3-5 and the high runs are skipped to keep it in range), every note one beat; the bass notes are the left hand where it sounds with the melody (on every aligned note on hard, on the beat otherwise)',
    score: `1' 3' | 5' 5' 5' 5' 5' | 3' 5' 3' | #1' 2' 4' 3' 2' 6' 4' 2' | 1' 7 2' 7 5 |
            7 7' 6' 5' | #4' 3' #2' 3' 3' 2' 1' | 7 6 #5 6 6 1' 3' 2' | 2' 7 |
            #2' 3' 6' 5' #4' 3' 2' 1' | #6 7 3' 2' #1' 2' 1' 6 |
            5 6 7 1' 2' 3' #4' 5' 6' 7' 6' 5' #4' 3' 2' | #1' 2' 3' 2' 1' 7 6 5 #4 #4 #4 #4`,
    bass: `1 1 | 1 1 - 3 - | 1 1 - | 4 - - - - - - - | 5 - - - - |
           5 7 7 - | 5 - 1 - 5 1 - | #4 - 1 - #4 - 1 - | 5 5 |
           1 - - - - - - - | 2 - - - 2 - - - |
           5 - - - - - - - - - - - - - - | - - - - - - - - - - 2 -`,
    hardBass: `1 1 | 1 1 5 3 5 | 1 1 5 | 4 - - - - - - - | 5 - - - - |
               5 7 7 2 | 5 3 1 3 5 1 3 | #4 2 1 2 #4 2 1 2 | 5 5 |
               1 - - - - - - - | 2 - - - 2 - - - |
               5 - - - - - - - - - - - - - - | - - - - - - - - - 2 2 2`,
  },
  {
    id: 'schumann-distant-lands-15-1',
    title: 'Of Foreign Lands and Peoples (Op. 15 No. 1)',
    composer: 'Schumann',
    mode: 'minor',
    level: 'medium',
    alsoLevels: ['easy', 'hard'],
    pace: 0.8,
    easyBothPace: 0.8,
    mediumBothPace: 0.85,
    source: 'MusicXML score (schumann-gens-pays-lointains-op15-1.mxl), the right-hand melody of bars 1-20 (the triplet inner voice is dropped, chords in bars 9-12 reduced to their top note), every note one beat; the bass notes are the left hand where it sounds with the melody (on every aligned note on hard, on the beat otherwise); slowed down because the original is fast',
    score: `5 3' | 2' 1' 7 | 5 3' | 2' 1' 7 | 5 3' | 1' 7 6 | 4 7 | 5:2 |
            5 6 | 4 5 | 3 4 | 2 3 | 1 2 | 3 4 5 6 |
            7 3' | 2' 1' 7 | 5 3' | 2' 1' 7 | 5 3' | 1' 7 6`,
    bass: `3 #6 | 7 - 2 | 3 #6 | 7 - 2 | 3 5 | 6 - 1 | 7 7 | 3 |
           1 4 | 7 5 | 6 2 | 5 3 | 6 6 | 5 - 3 - |
           3 #6 | 7 - 2 | 3 #6 | 7 - 2 | 3 5 | 6 - 1`,
    hardBass: `3 #6 | 7 - 2 | 3 #6 | 7 - 2 | 3 5 | 6 - 1 | 7 7 | 3 |
               1 4 | 7 5 | 6 2 | 5 3 | 6 6 | 5 4 3 - |
               3 #6 | 7 - 2 | 3 #6 | 7 - 2 | 3 5 | 6 - 1`,
    easyBass: `3 - | 7 - - | 3 - | 7 - - | 3 - | 6 - - | 7 - | 3 |
               1 - | 7 - | 6 - | 5 - | 6 - | 5 - - - |
               3 - | 7 - - | 3 - | 7 - - | 3 - | 6 - -`,
  },
  {
    id: 'chopin-waltz-69-2',
    meter: 3,
    title: 'Waltz in B minor (Op. 69 No. 2)',
    composer: 'Chopin',
    mode: 'minor',
    level: 'hard',
    source: 'Mutopia Project, Chopin Op. 69 No. 2 (public domain), bars 1-12 and 17-28',
    score: `5':1.5 6':.5 5':.5 2':.5 3':.5 1':.5 #7:2 5':1.5 6':.5 5':.5 2':.5 4':.5 3':.5 1':2 5':1.5 6':.5 #4':.5 5':.5 1'':.5 3'':.5 3'' #4' 3'':2 4' 2'':1.5 1'':.5 #7':.5 6':.5 5':.5 2':.5 3':.5 6':.5 5':.5 2':.5 3':.5 1':.5 #7:2 5':1.5 6':.5 5':.5 2':.5 4':.5 3':.5 1':2
            1':.5 2':.5 3':.5 6':.5 5':.5 2':.5 3':.5 1':.5 #7:2 5':1.5 6':.5 5':.5 2':.5 4':.5 3':.5 1':2 5':1.5 6':.5 #4':.5 5':.5 1'':.5 3'':.5 3'' #4' 3'':2 4' 2'':1.5 1'':.5 #7':.5 6':.5 5':.5 2':.5 3':.5 6':.5 5':.5 2':.5 3':.5 1':.5 #7:2 5':1.5 6':.5 5':.5 2':.5 4':.5 3':.5 1':2`,
  },

  // Nocturnes, Berceuse and Gymnopédie. As above, melodies were extracted from MIDI files of the
  // public-domain compositions and simplified to the top line. Two of the files are
  // sequences by others (see each `source`); only the notes were used.
  {
    id: 'satie-gymnopedie-1',
    title: 'Gymnopédie No. 1',
    composer: 'Satie',
    mode: 'major',
    level: 'easy',
    source: 'MusicXML score (satie-gymnopedie1.mxl), melody from bar 5 to bar 37 (the three-bar intro is skipped), every note one beat, bass as written',
    score: `3' 5' | 4' 3' 7 | 6 7 1' | 5 | 3 | 3 | 3 | 3 |
            3' 5' | 4' 3' 7 | 6 7 1' | 5 | 7 | 3' | 2 | 2 | 2 |
            5 6 b7 | 2' 1' 6 | 1' b7 6 | 1' | 1' 1' | 2' b3' 4' | 5' b7 1' | 2' 1' 6 | 1' | 1' 1' |
            4' | 3' | 6 5 6 | 7 1' 2' | 7 1' 2' | 3`,
    bass: `4 - | 1 - - | 4 - - | 1 | 4 | 1 | 4 | 1 |
           4 - | 1 - - | 4 - - | 1 | 3 | 6 | 2 | 2 | 1 |
           5 - - | 1 - - | 1 - - | 1 | 1 - | 1 - - | 1 - - | 1 - - | 1 | 1 - |
           2 | 3 | 6 - - | 2 - - | 2 - - | 2`,
  },
  {
    id: 'chopin-nocturne-32-1',
    title: 'Nocturne in B major (Op. 32 No. 1)',
    composer: 'Chopin',
    mode: 'major',
    level: 'medium',
    source: 'midiworld.com MIDI recording of Chopin Op. 32 No. 1, opening theme (notes only; rhythm approximated)',
    score: `3':2 4' 3':.5 2':1.5 3':1.5 1':2 3':.5 1'':.5 6':.5 5':2 4' 3' 3':.5 5':1.5 3':.5 2':1.5 3' 7 2' 7 3':.5 1'':.5 6':.5 5':2 4' 3':2 b3' 3':.5 #4' #4':2 #4':2 7 2':1.5 6`,
  },

  // More Beethoven, Chopin and Ravel. Same approach as above: top-line melodies taken from MIDI
  // files of the public-domain compositions (see each `source`).
  {
    id: 'chopin-prelude-20',
    title: 'Prelude in C minor (Op. 28 No. 20)',
    composer: 'Chopin',
    mode: 'minor',
    level: 'easy',
    source: 'Mutopia Project, Chopin Op. 28 No. 20 (public domain), top voice of the chords, bars 1-13',
    score: `5 6 5 3 3 4 3 1 2 #3 5 3 2 5 #7 5 3' 3' 2' 2' 1' 2' #7 5 1' 6 5 3 3 4 3 1 3' 3' 2' 2' 1' 2' #7 5 1' 6 5 3 3 4 3 1 1':2`,
  },
  {
    id: 'beethoven-pathetique-2',
    title: 'Pathétique Sonata, Adagio (Op. 13)',
    composer: 'Beethoven',
    mode: 'major',
    level: 'medium',
    alsoLevels: ['hard'],
    source: 'MusicXML score (beethoven-pathetique-2.mxl), the high statement of the theme (bars 9-16) and the episode of bars 37-41 (the low statement, the tremolo sections and the climb to C6 are skipped to keep it in range), every note one beat, bass as written',
    score: `3 2 | 5 4 | 3 5 1' 2' | 5 #5 | 6 2 | 5 #1 | 4 3 2 1 7, | 2 1 |
            1 b3 2 1 | 7, 4 | 1 b3 2 1 | 1 7, | 1 b3 2 1`,
    bass: `1 - | 3 - | 1 - - - | 5 - | 4 - | 3 - | 2 - - - - | 1 - |
           1 - - - | 2 - | 1 - - - | 5 - | 1 - - -`,
  },
  {
    id: 'beethoven-les-adieux',
    title: 'Les Adieux Sonata (Op. 81a)',
    composer: 'Beethoven',
    mode: 'major',
    level: 'medium',
    source: 'pianobit.app MIDI of Beethoven Op. 81a first movement: the "Lebewohl" motif and the clearest melodic passages (bars 1-3, 7-9, 81-84, 105-108)',
    score: `3' 2' 1':1.5 1':.5 3':.5 3':.5 6':.5
            3' 2' 1':1.5 b3':.5 b6':.5 5':.5 1'':.5
            b2':.5 2':.5 6:.5 1':2 3':2 2':.5
            5' 3':.5 2':.5 2':.5 1':.5 7:.5 6:.5 7:2 6:2`,
  },

  // From MusicXML scores in scores/, converted with tools/xml_to_tune.py.
  {
    id: 'ravel-pavane',
    title: 'Pavane for a Dead Princess',
    composer: 'Ravel',
    mode: 'major',
    level: 'easy',
    source: 'MusicXML score (ravel-pavane.mxl), bars 1-10, 17-18, 25-26',
    pace: 0.6,
    score: `1':2 2':.5 7:.5 6:.5 5 6:.5 7:.5 7:.5 6:.5 6 3':2 4':.5 2':.5 1':.5 7 1':.5 2' 3':.5 1':.5 7:.5 6 7:.5 1' 2':.5 7:.5 6:.5 7:2 2':.5 7:.5 6:.5 7 3':2 3':2 2':.5 5':.5 3':.5 3' 2' 1' 2' 6:2 5' 5':.5
            2' 3':1.5 2':.5 3':.5 #4':.5 7 6:1.5 5:.5 6:.5 7:.5
            7 6:1.5 5:.5 6:.5 7:.5 6 5 7 6`,
  },
  {
    id: 'chopin-nocturne-55-1',
    title: 'Nocturne in F minor (Op. 55 No. 1)',
    composer: 'Chopin',
    mode: 'minor',
    level: 'medium',
    source: 'MusicXML score (chopin-nocturne-op55-1.mxl), melody bars 1-2, 5-8 and 17-24; ornaments and the left-hand-register run in bars 17 and 19 kept, rhythm evened out',
    score: `5 1' 7 6 | 5 b5 5 6 5:2 | 5 1' 7 6 | 5:2 4 5 6 | 3:2 3 2 1 | 1:2 5 5 |
            4 #6, 7, 1 7, 3 4 | 5:2 5 5 | #6 #1 2 3 2 5 #6 | #7:2 1' 7 6 |
            6 5 6 5 4 | 4 3 2 3 2 | 2 2 2 3 2 | 2 5 5 5 |
            5 1' 7 6 | 5 b5 5 6 5:2`,
    bass: `1 - 2 - | 3 - - - #7 | 1 - 2 - | 3 - - - | 5 - - - | 1 1 - |
           - - - 7 - - - | 3 3 - | 2 - - 2 - - - | 5 - - - |
           5 - 5 - - | 5 - 5 - - | 5 - 5 - - | 5 - - - |
           1 - 2 - | 3 - - - #7`,
  },
  {
    id: 'chopin-nocturne-9-2',
    meter: 3,
    pickup: 0.5,
    title: 'Nocturne in E♭ major (Op. 9 No. 2)',
    composer: 'Chopin',
    mode: 'major',
    level: 'medium',
    source: 'MusicXML score (nocturne_op9_2.mxl), bars 1-4, 7-8, 11-16, 19-26',
    score: `5:.5 3':2 2':.5 3':.5 2':1.5 1' 5:.5 3' 6:.5 6' 3':.5 5':1.5 4' 3':.5 2':1.5 3' 7:.5 1':1.5 6:1.5
            3':.5 6:.5 6:.5 #1':.5 3':.5 6':.5 5':1.5 4' 3':.5 2':1.5 3':.5 3':.5 7:.5 1':1.5 6:1.5
            1':.5 1':.5 1':.5 1':.5 7:.5 2':.5 1':1.5 5:1.5 5':1.5 #4' 3':.5 2':1.5 7:1.5 1':1.5 7:.5 6:.5 7:.5 5:.5 #5:.5 #5:.5 6:.5 6:.5 7:.5 3' #4:.5 b6:.5 #6:.5 3':.5 2' 1' 1':.5 1':.5 3':.5 6:.5 6:.5 #1':.5 3':.5 6':.5 5':1.5 4' 3':.5 2':1.5 3':.5 3':.5 7:.5 1':1.5 6:1.5
            1':1.5 1':.5 7:.5 2':.5 1':1.5 5:1.5 5':1.5 #4' 3':.5 2':1.5 7:1.5 1':1.5 7:.5 6:.5 7:.5 5:.5 #5:.5 #5:.5 6:.5 6:.5 7:.5 3' #4:.5 b6:.5 #6:.5 3':.5 2' 1':.5 1':.5 1':.5 1':.5 3':.5 6:.5 6:.5 #1':.5 3':.5 6':.5 5':1.5 4' 3':.5 2':1.5 3':.5 3':.5 7:.5 1':1.5 6:1.5 5 6':.5 5':.5 4' 1':2 1':1.5 2':.5 1':.5 2':.5 3':2`,
  },
  {
    id: 'liszt-liebestraum-3',
    title: 'Liebesträume No. 3',
    composer: 'Liszt',
    mode: 'major',
    level: 'medium',
    source: 'MusicXML score (liebestraum.mxl), the opening theme, bars 0-12: the sung melody line (held C, then D♭ and the F G A♭ C B♭ rise) taken from the voices of both hands, every note one beat',
    score: `5, | 3 3 | 3 3 | 3 3 4 3 | 3 6, 6, | 6, 7, 1 3 2 | 1
            5, | 3 3 | 3 3 | 3 3 4 3 | 6 6, | 6, 7, 1 3 2 | 1`,
    bass: `- | 1 - | 7 - | 6 - - - | 2 - - | 5 - - - - | 1
           - | 1 - | 7 - | 6 - - - | 2 - | 5 - - - - | 1`,
  },
  {
    id: 'beethoven-appassionata-2',
    title: 'Appassionata Sonata, Andante (Op. 57)',
    composer: 'Beethoven',
    mode: 'major',
    level: 'medium',
    source: 'MusicXML score (beethoven-appassionata-2nd.mxl), right hand bars 43-49 (the broken-chord variation), every written note, one beat each',
    meter: 8,
    score: `1' 5 3 1' 5 3 1 5
            1' 5 3 1' 5 3 1 5
            5 2 7, 5 7, 5 4 7,
            1 3 5 1' 7 4 1' 3
            5 2 7, 5 7, 5 4 7,
            1 3 5 3' 2' 4 1' 3
            5 2 7, 5 7, 5 4 7,`,
  },
  {
    id: 'chopin-berceuse-57',
    meter: 6,
    title: 'Berceuse in D♭ major (Op. 57)',
    composer: 'Chopin',
    mode: 'major',
    level: 'hard',
    source: 'MusicXML score (chopin-berceuse-op57.mxl), bars 3-18, 33-34, 43-44, 67-68',
    score: `3':1.5 2':.5 5':.5 3':.5 2':.5 3':.5 1':.5 6:.5 7:.5 2':.5 5:.5 1' 2':.5 4':.5 6':.5 5':.5 4':.5 3':.5 2':.5 1':.5 2':.5 3':1.5 2':.5 5':.5 3':.5 2':.5 3':.5 1':.5 6:.5 7:.5 2':.5 5:.5 1' 2':.5 4':.5 6':.5 5':.5 1'':.5 6':.5 4':.5 7':.5 5':.5 3':.5 6':.5 4':.5 2':.5 5':.5 3':.5 2':.5 3':.5 1':.5 6:.5 7:.5 2':.5 5:.5 1' 2':.5 4':.5 6':.5 5':.5 1'':.5 6':.5 4':.5 7':.5 5':.5 5:1.5 5:.5 5:.5 5:.5 5:.5 5:.5 5:.5 5:.5 5:.5 5:.5 5:.5 5:.5 5:.5 5:.5 5:.5 5:.5 5:.5 5:.5 5:.5 5:.5 5:.5 5:.5
            5':.5 5':.5 5':.5 5':.5 5':.5 5':.5 5':.5 5':.5 5':.5 5':.5 5':.5 5':.5
            b6' 5':.5 5':1.5 5':1.5
            2':.5 5':.5 1':2 3':.5 3':1.5`,
  },
  {
    id: 'chopin-nocturne-27-2',
    meter: 3,
    title: 'Nocturne in D♭ major (Op. 27 No. 2)',
    composer: 'Chopin',
    mode: 'major',
    level: 'hard',
    source: 'MusicXML score (chopin-nocturne-op27no2.mxl), bars 1-6, 19-22, 25-30, 47-48, 59-60, 65-66, 71-74',
    score: `3':1.5 2':.5 1' 5:2 1':.5 3':.5 6':2 #2':.5 7:.5 #5:2 6:2 6':.5 5':.5
            7 5 5:.5 b3':.5 2' 5':2 7:2 5:.5 b3':.5 2':1.5 2':1.5
            7:.5 6 6:.5 1':.5 3':1.5 2':.5 1' 5:2 1':.5 3':.5 6':2 #2':.5 7:.5 #5:2 6:2 6':.5 5':.5
            5:2 1':.5 3':.5 6':2 #2':.5 7:.5
            5':1.5 6':1.5 1':2
            5':2 5':2 1'':.5 #4':.5
            5':2 4':.5 2':.5 1':1.5 3':.5 #4':.5 7':.5 5':2 4':.5 2':.5 1':2`,
  },
  {
    id: 'chopin-minute-waltz',
    title: 'Minute Waltz',
    composer: 'Chopin',
    mode: 'major',
    level: 'hard',
    source: 'MusicXML score (minute_waltz.mxl), bars 1-22, 23-24, 89-110',
    score: `5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 6:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 6:.5 7:.5 1':.5 2':.5 3':.5 4':.5 6':1.5 5':.5 4':.5 3':.5 3':.5 2':.5 2':.5 #1':.5 2' 6':1.5 5':.5 4':.5 3':.5 3':.5 2':.5 #1':.5 2':.5 3':.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 6:.5 7:.5 1':.5 2':.5 3':.5 4':.5 6':1.5 5':.5 4':.5 3':.5 3':.5 2':.5 2':.5 #1':.5 2' 6':1.5 5':.5 4':.5 3':.5 2':.5 3':.5 2':.5 #1':.5 2':.5 #2':.5 3' #2':.5 3':.5 5':.5 4':.5 3':.5 4':.5 3':.5 #2':.5 3':.5 6':.5
            5 #4:.5 5:.5 7:.5 6:.5 5:.5 6:.5 5:.5 #4:.5 5:.5 1':.5
            #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 6:.5 7:.5 1':.5 2':.5 3':.5 4':.5 6':1.5 5':.5 4':.5 3':.5 3':.5 2':.5 2':.5 #1':.5 2' 6':1.5 5':.5 4':.5 3':.5 3':.5 2':.5 #1':.5 2':.5 3':.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 7:.5 6:.5 #4:.5 5:.5 6:.5 7:.5 1':.5 2':.5 3':.5 4':.5 6':1.5 5':.5 4':.5 3':.5 3':.5 2':.5 2':.5 #1':.5 2' 6':1.5 5':.5 4':.5 3':.5 2':.5 3':.5 2':.5 #1':.5 2':.5 #2':.5 3' #2':.5 3':.5 5':.5 4':.5 3':.5 4':.5 3':.5 #2':.5 3':.5 6':.5`,
  },
];
