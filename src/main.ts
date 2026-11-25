import '@fontsource/jost/400.css';
import '@fontsource/jost/500.css';
import '@fontsource/jost/600.css';
import '@fontsource/noto-music/index.css';
import './style.css';

import { Audio } from './audio';
import { GAME_SECONDS, Game, type GameFx } from './game';
import { buildSequence, mulberry32, randomSeed, timing, tuneFits } from './melody';
import { Piano } from './piano';
import { Renderer } from './renderer';
import { TUNES, parseTune } from './tunes';
import {
  type ClefMode,
  type Difficulty,
  type Key,
  type Mode,
  PIANO_RANGE,
  TONICS,
  type Tonic,
  keyLabel,
  parseTonic,
  tonicName,
} from './theory';

interface Settings {
  mode: Mode;
  tonic: Tonic;
  clef: ClefMode;
  difficulty: Difficulty;
  hints: boolean;
  sound: boolean;
}

const STORAGE_SETTINGS = 'notequest.settings.v1';
const STORAGE_BEST = 'notequest.best.v1';
const STORAGE_DEBUG = 'notequest.debug.tune';

// The debug song picker shows on the dev server, or on any page opened with ?debug in the URL.
const DEBUG = import.meta.env.DEV || new URLSearchParams(location.search).has('debug');

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function loadSettings(): Settings {
  const defaults: Settings = {
    mode: 'major',
    tonic: TONICS.major[0],
    clef: 'treble',
    difficulty: 'easy',
    hints: true,
    sound: true,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_SETTINGS) ?? '{}') as Partial<Settings>;
    const mode = saved.mode === 'minor' ? 'minor' : 'major';
    const tonic =
      TONICS[mode].find((t) => t.letter === saved.tonic?.letter && t.acc === saved.tonic?.acc) ?? TONICS[mode][0];
    return {
      mode,
      tonic,
      clef: (['treble', 'bass', 'both'] as const).find((c) => c === saved.clef) ?? defaults.clef,
      difficulty: (['easy', 'medium', 'hard'] as const).find((d) => d === saved.difficulty) ?? defaults.difficulty,
      hints: saved.hints ?? defaults.hints,
      sound: saved.sound ?? defaults.sound,
    };
  } catch {
    return defaults;
  }
}

const settings = loadSettings();
const saveSettings = () => {
  try {
    localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings));
  } catch {
    /* private mode: settings just won't persist */
  }
};

const readBest = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_BEST) ?? '{}');
  } catch {
    return {};
  }
};
const bestKey = () =>
  `${tonicName(settings.tonic)}-${settings.mode}-${settings.clef}-${settings.difficulty}-${settings.hints ? 'h' : 'n'}`;

const audio = new Audio();
audio.muted = !settings.sound;
const piano = new Piano($('piano'));
const renderer = new Renderer($<HTMLCanvasElement>('staff'));

let game: Game | null = null;
let running = false;
let paused = false;
let screenName: 'home' | 'game' | 'results' = 'home';
let rafId = 0;
let lastTs = 0;
let countdownTimers: number[] = [];

const currentKey = (): Key => ({ tonic: settings.tonic, mode: settings.mode });

/* ------------------------------ screens ------------------------------ */

function show(name: typeof screenName): void {
  screenName = name;
  for (const id of ['home', 'game', 'results']) $(id).classList.toggle('hidden', id !== name);
}

/* ------------------------------ home / setup ------------------------------ */

// Circle of fifths, clockwise from the top. Each position holds a major key and its relative
// minor (same key signature); the centre button switches which of the two is shown. E♭ minor
// stands in for the enharmonic D♯ minor at the bottom.
const WHEEL: Record<Mode, string[]> = {
  major: ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'],
  minor: ['A', 'E', 'B', 'F#', 'C#', 'G#', 'Eb', 'Bb', 'F', 'C', 'G', 'D'],
};
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const polar = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [round2(100 + r * Math.sin(a)), round2(100 - r * Math.cos(a))];
};

function sectorPath(rIn: number, rOut: number, deg0: number, deg1: number): string {
  const [x0, y0] = polar(rOut, deg0);
  const [x1, y1] = polar(rOut, deg1);
  const [x2, y2] = polar(rIn, deg1);
  const [x3, y3] = polar(rIn, deg0);
  return `M${x0} ${y0} A${rOut} ${rOut} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${rIn} ${rIn} 0 0 0 ${x3} ${y3}Z`;
}

function wheelIndex(): number {
  const i = WHEEL[settings.mode].findIndex((n) => {
    const t = parseTonic(n);
    return t.letter === settings.tonic.letter && t.acc === settings.tonic.acc;
  });
  return Math.max(0, i);
}

function selectKey(mode: Mode, index: number): void {
  settings.mode = mode;
  settings.tonic = parseTonic(WHEEL[mode][index]);
  saveSettings();
  refreshHome();
}

/** Switch between major and minor, staying on the same spot on the wheel (same key signature). */
function toggleMode(): void {
  selectKey(settings.mode === 'major' ? 'minor' : 'major', wheelIndex());
}

function onActivate(el: Element, action: () => void): void {
  el.addEventListener('click', action);
  el.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      action();
    }
  });
}

function buildWheel(): void {
  const wedges = $('wheel-wedges');
  for (let i = 0; i < 12; i++) {
    const g = svgEl('g', { class: 'wedge-g', role: 'button', tabindex: '0', 'aria-pressed': 'false' });
    g.dataset.index = String(i);
    g.appendChild(svgEl('path', { class: 'wedge', d: sectorPath(50, 98, i * 30 - 15, i * 30 + 15) }));
    const [tx, ty] = polar(74, i * 30);
    g.appendChild(svgEl('text', { class: 'wedge-label', x: String(tx), y: String(ty), 'font-size': '16' }));
    onActivate(g, () => selectKey(settings.mode, i));
    wedges.appendChild(g);
  }
  onActivate($('wheel-center'), toggleMode);
}

function refreshHome(): void {
  const selected = wheelIndex();
  const minor = settings.mode === 'minor';
  $('key-wheel').classList.toggle('minor', minor);
  document.querySelectorAll<SVGGElement>('.wedge-g').forEach((g) => {
    const i = Number(g.dataset.index);
    const tonic = parseTonic(WHEEL[settings.mode][i]);
    g.querySelector('text')!.textContent = tonicName(tonic) + (minor ? 'm' : '');
    g.setAttribute('aria-label', `${tonicName(tonic)} ${settings.mode}`);
    g.setAttribute('aria-pressed', String(i === selected));
    g.classList.toggle('selected', i === selected);
  });
  document.querySelectorAll<HTMLElement>('#clef-seg button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.clef === settings.clef));
  });
  document.querySelectorAll<HTMLElement>('#diff-seg button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.diff === settings.difficulty));
  });
  const other = minor ? 'major' : 'minor';
  $('wheel-tonic').textContent = tonicName(settings.tonic);
  $('wheel-mode').textContent = settings.mode;
  $('wheel-hint').textContent = `tap for ${other}`;
  $('wheel-center').setAttribute('aria-label', `${tonicName(settings.tonic)} ${settings.mode}. Switch to ${other} keys`);
  $<HTMLInputElement>('opt-hints').checked = settings.hints;
  const best = readBest()[bestKey()];
  $('best').textContent = best === undefined ? '—' : String(best);
  refreshDebug();
}

document.querySelectorAll<HTMLElement>('#clef-seg button').forEach((b) =>
  b.addEventListener('click', () => {
    settings.clef = b.dataset.clef as ClefMode;
    saveSettings();
    refreshHome();
  }),
);
document.querySelectorAll<HTMLElement>('#diff-seg button').forEach((b) =>
  b.addEventListener('click', () => {
    settings.difficulty = b.dataset.diff as Difficulty;
    saveSettings();
    refreshHome();
  }),
);
$<HTMLInputElement>('opt-hints').addEventListener('change', (e) => {
  settings.hints = (e.target as HTMLInputElement).checked;
  saveSettings();
  refreshHome();
});

/* ------------------------------ debug song picker ------------------------------ */

let debugTuneId = '';
if (DEBUG) {
  try {
    // An earlier version remembered the pick forever, which could silently force one song on later visits.
    localStorage.removeItem(STORAGE_DEBUG);
    const saved = sessionStorage.getItem(STORAGE_DEBUG) ?? '';
    if (TUNES.some((t) => t.id === saved)) debugTuneId = saved;
  } catch {
    /* storage unavailable: start on random */
  }
}

function setupDebug(): void {
  if (!DEBUG) return;
  $('debug').classList.remove('hidden');
  const select = $<HTMLSelectElement>('debug-tune');
  select.add(new Option('Random (normal game)', ''));
  for (const level of ['easy', 'medium', 'hard'] as const) {
    const group = document.createElement('optgroup');
    group.label = level[0].toUpperCase() + level.slice(1);
    for (const t of TUNES.filter((x) => x.level === level)) {
      group.appendChild(new Option(`${t.title} (${t.composer})`, t.id));
    }
    select.add(group);
  }
  select.value = debugTuneId;
  select.addEventListener('change', () => {
    debugTuneId = select.value;
    try {
      sessionStorage.setItem(STORAGE_DEBUG, debugTuneId);
    } catch {
      /* ignore */
    }
    refreshDebug();
  });
  $('debug-btn').addEventListener('click', () => toggleDebugPanel());
  document.addEventListener('pointerdown', (e) => {
    if (!$('debug').contains(e.target as Node)) toggleDebugPanel(false);
  });
}

function toggleDebugPanel(open?: boolean): void {
  const panel = $('debug-panel');
  const show = open ?? panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !show);
  $('debug-btn').setAttribute('aria-expanded', String(show));
}

function refreshDebug(): void {
  if (!DEBUG) return;
  const tune = TUNES.find((t) => t.id === debugTuneId);
  $('debug-btn').textContent = tune ? `Debug: ${tune.title}` : 'Debug';
  $('debug-btn').classList.toggle('active', !!tune);
  const info = $('debug-info');
  info.classList.remove('bad');
  if (!tune) {
    info.textContent = 'Each game picks a random song, as usual.';
    return;
  }
  const beats = parseTune(tune.score).reduce((sum, e) => sum + e.dur, 0);
  const fits = tuneFits(tune, currentKey(), settings.clef);
  const facts = [`${tune.level}`, `written in ${tune.mode}`, `${beats} beats`];
  if (tune.pace) facts.push(`pace ${tune.pace}`);
  if (tune.easyPace) facts.push(`also easy (pace ${tune.easyPace})`);
  if (tune.easyBothPace) facts.push(`easy with both clefs: pace x${tune.easyBothPace}`);
  if (tune.mediumBothPace) facts.push(`medium with both clefs: pace x${tune.mediumBothPace}`);
  if (tune.easyBass) facts.push('sparser bass on easy');
  if (tune.draft) facts.push('draft');
  const where = `${keyLabel(currentKey())}, ${settings.clef}`;
  info.textContent =
    `${facts.join(' · ')}\n` +
    (fits ? `Fits ${where}.` : `Does NOT fit ${where}. Pick another key or clef.`) +
    (tune.source ? `\nSource: ${tune.source}` : '');
  info.classList.toggle('bad', !fits);
}

function showDebugError(message: string): void {
  $('debug-info').textContent = message;
  $('debug-info').classList.add('bad');
  toggleDebugPanel(true);
}

async function goFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
  } catch {
    /* unsupported (e.g. iOS Safari) - the rotate prompt still keeps things landscape */
  }
}

/* ------------------------------ game ------------------------------ */

function applyHintState(): void {
  const hint = $('hint-btn');
  hint.setAttribute('aria-pressed', String(settings.hints));
  const sound = $('sound-btn');
  sound.setAttribute('aria-pressed', String(settings.sound));
}

function startGame(): void {
  audio.unlock();
  clearCountdown();
  if (window.matchMedia('(pointer: coarse)').matches) void goFullscreen();

  let sequence: ReturnType<typeof buildSequence>;
  try {
    sequence = buildSequence(
      { key: currentKey(), clef: settings.clef, difficulty: settings.difficulty, tuneId: debugTuneId || undefined },
      mulberry32(randomSeed()),
    );
  } catch (err) {
    // Only a forced debug song can fail to fit; say why instead of starting a game.
    showDebugError(err instanceof Error ? err.message : String(err));
    return;
  }
  const pacing = timing(settings.difficulty, sequence.pace);
  game = new Game(sequence, pacing);
  game.onTempo = showTempoToast;
  $('tempo-toast').classList.remove('show');
  running = false;
  paused = false;
  $('pause').classList.add('hidden');
  $('tune-title').textContent = '';
  lastTitle = '';

  show('game');
  const [lo, hi] = PIANO_RANGE[settings.clef];
  piano.build(lo, hi);
  applyHintState();
  renderer.configure(currentKey(), settings.clef, pacing.visibleSeconds);
  updateHud(true);

  cancelAnimationFrame(rafId);
  lastTs = performance.now();
  rafId = requestAnimationFrame(frame);
  // The first frame after the screen is shown needs a real layout pass.
  requestAnimationFrame(() => renderer.resize());
  runCountdown();
}

function showTempoToast(direction: 'up' | 'down'): void {
  const toast = $('tempo-toast');
  toast.textContent = direction === 'up' ? 'Speeding up!' : 'Slowing down...';
  toast.classList.remove('up', 'down', 'show');
  void toast.offsetWidth;
  toast.classList.add(direction, 'show');
}

function clearCountdown(): void {
  countdownTimers.forEach((t) => window.clearTimeout(t));
  countdownTimers = [];
  $('countdown').classList.add('hidden');
}

function runCountdown(): void {
  const overlay = $('countdown');
  const num = $('countdown-num');
  overlay.classList.remove('hidden');
  const steps = ['3', '2', '1', 'Go!'];
  steps.forEach((label, i) => {
    countdownTimers.push(
      window.setTimeout(() => {
        num.textContent = label;
        num.style.animation = 'none';
        void num.offsetWidth;
        num.style.animation = '';
        if (i === steps.length - 1) {
          running = !paused;
          lastTs = performance.now();
        }
      }, i * 800),
    );
  });
  countdownTimers.push(window.setTimeout(() => overlay.classList.add('hidden'), steps.length * 800));
}

let lastScore = 0;
let lastTitle = '';

function updateHud(force = false): void {
  if (!game) return;
  const remaining = Math.max(0, GAME_SECONDS - game.time);
  $('timer-fill').style.transform = `scaleX(${remaining / GAME_SECONDS})`;
  $('timer-fill').classList.toggle('low', remaining <= 10);
  $('timer-text').textContent = String(Math.ceil(remaining));
  if (force || game.score !== lastScore) {
    $('score').textContent = String(game.score);
    if (!force && game.score > lastScore) {
      const pill = $('score').parentElement!;
      pill.classList.remove('bump');
      void pill.offsetWidth;
      pill.classList.add('bump');
    }
    lastScore = game.score;
  }
  $('streak').textContent = String(game.streak);
  $('streak-pill').classList.toggle('hot', game.streak >= 3);
  const onStreak = game.onStreak;
  $('streak-pill').classList.toggle('fire', onStreak);
  $('stage').classList.toggle('streaking', onStreak);
  const title = game.current()?.ev.tuneTitle ?? lastTitle;
  if (title !== lastTitle) {
    lastTitle = title;
    $('tune-title').textContent = title ? `♪ ${title}` : '';
  }
}

function handleFx(fx: GameFx | null, pressedMidi?: number): void {
  if (!fx || !game) return;
  renderer.addFx(fx, game, performance.now());
  if (pressedMidi === undefined) return;
  if (fx.type === 'exact') piano.flash(pressedMidi, 'good');
  else if (fx.type === 'octave') {
    piano.flash(pressedMidi, 'okay');
    piano.flash(fx.event.ev.notes[fx.noteIndex].midi, 'okay');
  } else if (fx.type === 'assisted') {
    piano.flash(pressedMidi, 'okay');
  } else if (fx.type === 'wrong') {
    piano.flash(pressedMidi, 'bad');
    for (const midi of fx.hint) piano.flash(midi, 'hint');
  }
}

piano.onPress = (midi) => {
  audio.unlock();
  audio.note(midi);
  if (!game || !running || paused || screenName !== 'game') return;
  handleFx(game.press(midi), midi);
};

function frame(ts: number): void {
  rafId = requestAnimationFrame(frame);
  if (!game) return;
  const dt = Math.min(0.1, (ts - lastTs) / 1000);
  lastTs = ts;
  if (running && !paused) {
    for (const fx of game.update(dt)) handleFx(fx);
    updateHud();
    if (game.finished) {
      endGame();
      return;
    }
  }
  renderer.draw(game, ts, settings.hints);
}

function endGame(): void {
  running = false;
  if (!game) return;
  const g = game;
  const best = readBest();
  const key = bestKey();
  const isBest = g.score > (best[key] ?? 0) && g.score > 0;
  if (isBest) {
    best[key] = g.score;
    try {
      localStorage.setItem(STORAGE_BEST, JSON.stringify(best));
    } catch {
      /* ignore */
    }
  }
  const stars = g.accuracy >= 0.9 ? 3 : g.accuracy >= 0.7 ? 2 : g.accuracy >= 0.4 ? 1 : 0;
  $('stars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < stars ? '' : 'off'}">★</span>`).join('');
  $('results-title').textContent = ['A good start', 'Well played', 'Bravo', 'Virtuoso'][stars];
  $('res-score').textContent = String(g.score);
  $('res-exact').textContent = String(g.exactHits);
  $('res-octave').textContent = String(g.octaveHits);
  $('res-miss').textContent = String(g.misses);
  $('res-streak').textContent = String(g.bestStreak);
  $('new-best').classList.toggle('hidden', !isBest);
  cancelAnimationFrame(rafId);
  show('results');
  audio.fanfare();
}

function setPaused(value: boolean): void {
  if (screenName !== 'game' || !game) return;
  paused = value;
  if (value) {
    $('pause-score').textContent = String(game.score);
    $('pause-time').textContent = `${Math.ceil(Math.max(0, GAME_SECONDS - game.time))}s`;
  }
  $('pause').classList.toggle('hidden', !value);
  if (!value) lastTs = performance.now();
}

function quitToHome(): void {
  clearCountdown();
  running = false;
  paused = false;
  cancelAnimationFrame(rafId);
  game = null;
  $('pause').classList.add('hidden');
  refreshHome();
  show('home');
}

$('play').addEventListener('click', startGame);
$('again').addEventListener('click', startGame);
$('to-home').addEventListener('click', quitToHome);
$('pause-btn').addEventListener('click', () => setPaused(true));
$('resume').addEventListener('click', () => setPaused(false));
$('quit').addEventListener('click', quitToHome);
$('hint-btn').addEventListener('click', () => {
  settings.hints = !settings.hints;
  saveSettings();
  applyHintState();
});
$('sound-btn').addEventListener('click', () => {
  settings.sound = !settings.sound;
  audio.muted = !settings.sound;
  saveSettings();
  applyHintState();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && screenName === 'game') setPaused(!paused);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) setPaused(true);
});
window.matchMedia('(orientation: portrait)').addEventListener('change', (e) => {
  if (e.matches && running) setPaused(true);
});
window.addEventListener('resize', () => renderer.resize());

/* ------------------------------ boot ------------------------------ */

buildWheel();
setupDebug();
refreshHome();
show('home');
if (import.meta.env.DEV) {
  Object.defineProperty(window, '__nq', { get: () => ({ game, running, paused, audio }) });
}
// Canvas text needs the music font loaded before the first draw.
void document.fonts.load('40px "Noto Music"', '𝄞𝄢♯♭').then(() => renderer.resize());
