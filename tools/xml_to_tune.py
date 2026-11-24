"""
Convert a MusicXML score (.mxl / .musicxml) into a Note Quest tune.

    python tools/xml_to_tune.py scores/my-piece.mxl --tonic Db --mode major --level medium

It takes the highest note of the right hand (part 0), picks the cleanest stretches of the melody
(few ornaments, narrow range, in the home key) and prints a `score` string for src/tunes.ts, plus
the bars that were used. Requires: pip install music21

Notation of the output matches src/tunes.ts: scale degrees relative to --tonic, ' / , for octaves,
# / b (or ## / bb) for notes outside the scale, :n for length in beats (1 = quarter note).
"""
import argparse
import math
import sys
import warnings

from music21 import chord, converter, key, pitch, stream

warnings.filterwarnings('ignore')

INTERVALS = {'major': [0, 2, 4, 5, 7, 9, 11], 'minor': [0, 2, 3, 5, 7, 8, 10]}
TARGET_BEATS = {'easy': 45, 'medium': 64, 'hard': 91}
MAX_SPAN = {'easy': 12, 'medium': 15, 'hard': 17}  # semitones; wider tunes fit fewer keys on the piano
GRID = 0.5


def top_pitch(el):
    return max(el.pitches, key=lambda x: x.midi) if isinstance(el, chord.Chord) else el.pitch


def top_notes(part):
    """
    The melody: in each measure, the voice whose notes are highest on average (so inner
    accompaniment voices are ignored), taking the top note of any chord. Ties are merged and
    grace notes and very short flourishes are skipped.
    """
    events = {}
    for m in part.getElementsByClass(stream.Measure):
        voices = list(m.voices) or [m]
        stats = []
        for v in voices:
            notes = [n for n in v.notes if not n.duration.isGrace]
            if notes:
                stats.append((v, sum(top_pitch(n).midi for n in notes) / len(notes),
                              sum(float(n.quarterLength) for n in notes) / len(notes)))
        if not stats:
            continue
        # The melody is the voice with clearly longer notes than the others (a sustained tune over
        # an arpeggio figure); otherwise the highest voice.
        by_len = sorted(stats, key=lambda s: -s[2])
        if len(by_len) > 1 and by_len[0][2] >= 1.5 * by_len[1][2]:
            best = by_len[0][0]
        else:
            best = max(stats, key=lambda s: s[1])[0]
        for el in best.notes:
            if el.duration.isGrace or el.quarterLength < 0.2:
                continue
            tie = el.notes[-1].tie if isinstance(el, chord.Chord) else el.tie
            if tie is not None and tie.type in ('stop', 'continue'):
                continue
            off = round((float(m.offset) + float(el.offset)) * 48) / 48
            events[off] = top_pitch(el)
    return events


def measures_of(part):
    """(start offset, length in quarters, key signature sharps) for every measure."""
    sigs = sorted((float(k.offset), k.sharps) for k in part.flatten().getElementsByClass(key.KeySignature))
    out = []
    for m in part.getElementsByClass(stream.Measure):
        start = float(m.offset)
        sharps = sigs[0][1] if sigs else 0
        for off, sh in sigs:
            if off <= start + 1e-6:
                sharps = sh
        length = float(m.duration.quarterLength) or float(m.barDuration.quarterLength)
        out.append((start, length, sharps))
    return out


def build(path, tonic, mode, level, window=2, max_alter=0.3, sharps=None):
    score = converter.parse(path)
    try:
        score = score.expandRepeats()
    except Exception:
        pass
    part = score.parts[0]
    events = top_notes(part)
    bars = measures_of(part)
    home = bars[0][2] if sharps is None else sharps  # default: the piece starts in its home key
    tonic_p = pitch.Pitch(tonic + '4')

    def degree(p):
        n = p.diatonicNoteNum - tonic_p.diatonicNoteNum
        expected = tonic_p.midi + 12 * (n // 7) + INTERVALS[mode][n % 7]
        return n, p.midi - expected

    onsets = sorted(events)
    windows = []
    for start in range(0, len(bars) - window + 1, window):
        lo = bars[start][0]
        hi = bars[start + window - 1][0] + bars[start + window - 1][1]
        in_key = all(b[2] == home for b in bars[start:start + window])
        ons = [o for o in onsets if lo - 1e-6 <= o < hi - 1e-6]
        on_grid = [o for o in ons if abs(o / GRID - round(o / GRID)) < 0.03]
        windows.append(dict(start=start, hi=hi, ons=ons, grid=on_grid, in_key=in_key))

    def good(w):
        if not w['in_key'] or len(w['grid']) < 3:
            return False
        if len(w['grid']) < 0.5 * len(w['ons']):
            return False  # too many ornaments or fast runs to represent on the half-beat grid
        ps = [events[o] for o in w['grid']]
        mids = [p.midi for p in ps]
        w['lo_p'], w['hi_p'] = min(mids), max(mids)
        if w['hi_p'] - w['lo_p'] > MAX_SPAN[level]:
            return False
        if sum(1 for p in ps if degree(p)[1] != 0) > max_alter * len(ps):
            return False
        if any(abs(degree(p)[1]) > 1 for p in ps):
            return False  # double sharps/flats are too hard to read for this game
        return sum(1 for a, b in zip(mids, mids[1:]) if abs(a - b) > 12) <= 1

    # Consecutive good windows form runs, which keep the tune flowing. A run also stops when its
    # pitch range would grow too wide for the piano.
    runs, cur = [], []
    cur_lo = cur_hi = None
    for w in windows:
        if not good(w):
            if cur:
                runs.append(cur)
            cur, cur_lo, cur_hi = [], None, None
            continue
        if cur and max(cur_hi, w['hi_p']) - min(cur_lo, w['lo_p']) > MAX_SPAN[level]:
            runs.append(cur)
            cur, cur_lo, cur_hi = [], None, None
        cur.append(w)
        cur_lo = w['lo_p'] if cur_lo is None else min(cur_lo, w['lo_p'])
        cur_hi = w['hi_p'] if cur_hi is None else max(cur_hi, w['hi_p'])
    if cur:
        runs.append(cur)

    target = TARGET_BEATS[level] * 1.1
    chosen, total, lo_all, hi_all, ref = [], 0.0, None, None, None
    for run in runs:
        seg = []
        for w in run:
            for i, o in enumerate(w['grid']):
                nxt = w['grid'][i + 1] if i + 1 < len(w['grid']) else None
                seg.append((o, events[o], (nxt - o) if nxt is not None else min(w['hi'] - o, 2)))
        mids = sorted(p.midi for _, p, _ in seg)
        med = mids[len(mids) // 2]
        if ref is None:
            ref = med
        shift = 12 * round((ref - med) / 12)  # put every passage in the same octave
        lo, hi = min(mids) + shift, max(mids) + shift
        new_lo = lo if lo_all is None else min(lo_all, lo)
        new_hi = hi if hi_all is None else max(hi_all, hi)
        if new_hi - new_lo > MAX_SPAN[level]:
            continue
        lo_all, hi_all = new_lo, new_hi
        chosen.append((run, seg, shift))
        total += sum(min(2, d) for _, _, d in seg)
        if total >= target:
            break
    return chosen, degree, total, (lo_all, hi_all)


def tokens(seg, shift, degree, base):
    out = []
    for _, p, dur in seg:
        n, alt = degree(p)
        n += 7 * (shift // 12) - base
        tok = ('#' * alt if alt > 0 else 'b' * -alt if alt < 0 else '') + str(n % 7 + 1)
        octv = n // 7
        tok += "'" * octv if octv > 0 else ',' * -octv
        dur = min(2, dur)
        if abs(dur - 1) > 1e-6:
            tok += (':' + ('%g' % dur).lstrip('0')) if dur < 1 else ':%g' % dur
        out.append(tok)
    return ' '.join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('file')
    ap.add_argument('--tonic', required=True, help='home key tonic, e.g. Db, F#, G')
    ap.add_argument('--mode', choices=['major', 'minor'], required=True)
    ap.add_argument('--level', choices=['easy', 'medium', 'hard'], required=True)
    ap.add_argument('--window', type=int, default=2, help='bars per selection window (default 2)')
    ap.add_argument('--sharps', type=int, default=None,
                    help='use the section with this key signature (negative = flats) instead of the opening key')
    args = ap.parse_args()

    chosen, degree, total, span = build(args.file, args.tonic, args.mode, args.level, args.window, sharps=args.sharps)
    if not chosen:
        sys.exit('No clean stretches found. Try --window 1 or a different part of the piece.')
    lowest = min(degree(p)[0] + 7 * (sh // 12) for _, seg, sh in chosen for _, p, _ in seg)
    base = 7 * math.floor(lowest / 7)
    print(f'// {len(chosen)} passages, {total:.1f} beats (clamped), span {span[1] - span[0]} semitones')
    for run, seg, shift in chosen:
        print(f'// bars {run[0]["start"] + 1}-{run[-1]["start"] + args.window}')
        print(tokens(seg, shift, degree, base))


if __name__ == '__main__':
    main()

