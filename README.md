# Note Quest

**Play:** https://saffaura.github.io/note-quest/
**Debug mode:** https://saffaura.github.io/note-quest/?debug (adds a "Debug" button on the home
screen for picking a specific tune to test)

A landscape-only web game for learning to read sheet music. Pick a key (major or minor), a clef
(treble, bass or both) and a difficulty, then tap the piano keys that match the notes sliding
across the staff. Games last 60 seconds. Each game plays one randomly chosen tune, repeated
(with fresh doubles and beams) if it is shorter than the game.

## Run it

```
npm install
npm run dev      # http://localhost:5173
npm test         # theory, melody and scoring tests
npm run build    # production build in dist/
```

## Scoring

| Press                              | Points |
| ---------------------------------- | ------ |
| Exact key                          | +5     |
| Right note, wrong octave           | +1     |
| Wrong note (note stays on screen)  | -2     |
| Note slides off the left edge      | 0      |

The score never drops below 0. The current note is always the leftmost unplayed one.

## Layout

- `src/theory.ts` – scales, spelling, key signatures, staff geometry
- `src/tunes.ts` – the tune library and its notation (scale degrees, so any key works)
- `src/melody.ts` – picks tunes, transposes them to the key and clef, adds doubles and beams
- `src/game.ts` – scoring and timing
- `src/renderer.ts` – canvas drawing of the staff
- `src/piano.ts`, `src/audio.ts`, `src/main.ts` – input, sound and UI

## Testing songs (debug picker)

Open the game with `?debug` on the end of the URL (for example
`https://saffaura.github.io/note-quest/?debug`), or run `npm run dev`, and a small **Debug** button
appears in the top-left of the main menu. It opens a list of every tune; pick one and every game
plays that song until you choose "Random" again. The panel shows the song's difficulty, length,
source bars, and whether it fits the key and clef you've chosen. If it doesn't fit, Start is
blocked with a message instead of falling back to another song. Normal players never see it.

## Adding a tune from a MusicXML score

Put the `.mxl` / `.musicxml` file in `scores/` and run the converter (needs `pip install music21`):

```
python tools/xml_to_tune.py scores/my-piece.mxl --tonic Db --mode major --level medium
```

It follows the melody in the right hand, picks the cleanest stretches (few ornaments, narrow
range, in the home key, no double sharps/flats), and prints a `score` string plus the bars used.
Paste it into a new entry in `src/tunes.ts`. Use `--window 1` for more detail, or `--sharps N` to
take a section in a different key signature.

## Adding a tune by hand

Add an entry to `TUNES` in `src/tunes.ts`. Notes are scale degrees (`1`-`7`), `'` / `,` move an
octave up / down, `#` / `b` alter a note, and `:2` sets the length in beats. Transcriptions marked
`draft` were written from memory and should be checked against a public-domain score. Tunes derived
from MIDI files or MusicXML scores have a `source` field saying where they came from and which bars
were used.

## Credits and licences

- **Code:** written for this project. There is no licence file yet, so all rights are reserved until
  one is added.
- **Music:** the compositions (Beethoven, Chopin, Mozart, Ravel, Liszt, Satie and traditional tunes)
  are in the public domain. The tunes in `src/tunes.ts` are short, simplified melody lines taken from
  them, not full scores.
- **Scores in `scores/`:** these MusicXML files are source material for the tunes and were gathered
  from various places. The pieces are public domain, but an individual engraving or edition may carry
  its own licence (for example Mutopia Project editions are often CC BY-SA 4.0 and need attribution).
  If you own one of these files and want it removed or credited differently, please open an issue.
- **Fonts:** [Jost](https://github.com/indestructible-type/Jost) and
  [Noto Music](https://fonts.google.com/noto/specimen/Noto+Music), both under the SIL Open Font
  Licence, bundled through [Fontsource](https://fontsource.org).
