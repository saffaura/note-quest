import type { Game, GameFx, NoteStatus, RuntimeEvent } from './game';
import {
  type ClefMode,
  type Key,
  type Pitch,
  type StaffDef,
  PIANO_RANGE,
  keyAccidentals,
  keySignatureSlots,
  ledgerLines,
  pitchName,
  staffForNote,
  stavesFor,
  whiteMidiToD,
} from './theory';

const INK = '#2a2131';
const STAFF_LINE = '#857a8d';
const SAGE = '#1f9e7a';
const VIOLET = '#7c5cc4';
const ACCENT = '#98cefb';
const WINE = '#9b2f4a';
const PAPER = '#fbf7ee';

const NOTE_FONT = '"Noto Music", "Segoe UI Symbol", serif';
const UI_FONT = '"Jost", "Avenir Next", system-ui, sans-serif';

// Clef glyph placement, in staff spaces. Calibrated against the Noto Music glyphs.
const CLEF = {
  treble: { size: 3.8, dy: 0.61 },
  bass: { size: 3.9, dy: 3.0 },
};

// Sharps and flats are drawn at this fraction of full engraving size, and the key signature is
// laid out with this spacing (in staff spaces) after the clef.
const ACCIDENTAL_SCALE = 0.68;
const SIG_START = 3.4;
const SIG_STEP = 0.78;

interface Layout {
  width: number;
  height: number;
  space: number;
  hitX: number;
  pxPerSecond: number;
  staves: StaffDef[];
  yOf: (d: number) => number;
  sigWidth: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  text?: string;
}

interface StemInfo {
  dir: 1 | -1; // 1 = stem up
  x: number;
  tip: number;
  near: number; // y of the notehead end of the stem
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private layout!: Layout;
  private particles: Particle[] = [];
  private shake = new Map<number, number>(); // event id -> shake start (ms)
  private lastDraw = 0;
  private key!: Key;
  private clef: ClefMode = 'treble';
  private visibleSeconds = 8;
  private keyAcc: number[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  configure(key: Key, clef: ClefMode, visibleSeconds: number): void {
    this.key = key;
    this.clef = clef;
    this.visibleSeconds = visibleSeconds;
    this.keyAcc = keyAccidentals(key);
    this.resize();
  }

  resize(): void {
    if (!this.key) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const staves = stavesFor(this.clef);
    const [pLo, pHi] = PIANO_RANGE[this.clef];
    // Keep both staves large: notes up to C6 still fit in the top margin.
    const layoutHi = this.clef === 'both' ? Math.min(pHi, 79) : pHi;
    const lo = Math.min(...staves.map((s) => s.bottomD), whiteMidiToD(pLo));
    const hi = Math.max(...staves.map((s) => s.bottomD + 8), whiteMidiToD(layoutHi));
    const marginTop = 5;
    const marginBottom = 5;
    const steps = hi - lo + marginTop + marginBottom;
    const space = clamp(height / (steps / 2), 8, 30);
    const top = (height - (steps * space) / 2) / 2;
    const hiExt = hi + marginTop;
    const yOf = (d: number) => top + ((hiExt - d) * space) / 2;

    const sigSlots = keySignatureSlots(this.key, 'treble').length;
    const sigWidth = sigSlots === 0 ? 0 : sigSlots * space * SIG_STEP + space * 0.4;
    const hitX = 10 + space * SIG_START + sigWidth + space * 0.9;
    this.layout = {
      width,
      height,
      space,
      hitX,
      pxPerSecond: (width - hitX) / this.visibleSeconds,
      staves,
      yOf,
      sigWidth,
    };
  }

  /** Screen x of an event's note column at the given game time. */
  xOf(event: RuntimeEvent, time: number): number {
    return this.layout.hitX + (event.t - time) * this.layout.pxPerSecond;
  }

  addFx(fx: GameFx, game: Game, now: number): void {
    const { space, yOf } = this.layout;
    const x = this.xOf(fx.event, game.time);
    if (fx.type === 'wrong') {
      this.shake.set(fx.event.ev.id, now);
      const y = yOf(fx.event.ev.notes[0].d) - space * 1.8;
      this.pop(x, y, `${fx.points}`, WINE, space);
      return;
    }
    const note = fx.event.ev.notes[fx.noteIndex];
    const y = yOf(note.d);
    if (fx.type === 'miss') {
      this.pop(this.layout.hitX + space, y - space, 'miss', '#8f8497', space * 0.8);
      return;
    }
    const color = fx.type === 'exact' ? SAGE : VIOLET;
    this.pop(x, y - space * 1.8, fx.type === 'exact' ? `+${fx.points}` : `+${fx.points} · right note`, color, space);
    const colors = [SAGE, VIOLET, ACCENT, WINE, '#4f9be0'];
    const count = fx.type === 'exact' ? 16 : 8;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const speed = space * (4 + Math.random() * 6);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - space * 2,
        life: 0.7,
        max: 0.7,
        color: colors[i % colors.length],
        size: space * (0.12 + Math.random() * 0.14),
      });
    }
  }

  private pop(x: number, y: number, text: string, color: string, space: number): void {
    this.particles.push({ x, y, vx: 0, vy: -space * 2.2, life: 0.9, max: 0.9, color, size: space * 1.1, text });
  }

  draw(game: Game | null, now: number, hints: boolean): void {
    const ctx = this.ctx;
    if (!this.layout) return;
    const { width, height } = this.layout;
    const dt = this.lastDraw ? Math.min(0.05, (now - this.lastDraw) / 1000) : 0;
    this.lastDraw = now;

    ctx.clearRect(0, 0, width, height);
    this.drawStaves();
    if (game) this.drawEvents(game, now, hints);
    this.drawVanishZone(now);
    this.drawClefsAndSignature();
    this.drawParticles(dt);
  }

  private drawStaves(): void {
    const { ctx } = this;
    const { staves, yOf, width, space } = this.layout;
    ctx.strokeStyle = STAFF_LINE;
    ctx.lineWidth = Math.max(1.4, space * 0.09);
    ctx.lineCap = 'butt';
    for (const staff of staves) {
      for (let i = 0; i < 5; i++) {
        const y = Math.round(yOf(staff.bottomD + i * 2)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(8, y);
        ctx.lineTo(width - 6, y);
        ctx.stroke();
      }
    }
    // Barline joining the staves, plus a closing line on the right for the grand staff.
    const top = yOf(staves[0].bottomD + 8);
    const bottom = yOf(staves[staves.length - 1].bottomD);
    ctx.lineWidth = Math.max(2, space * 0.14);
    ctx.beginPath();
    ctx.moveTo(8, top);
    ctx.lineTo(8, bottom);
    ctx.stroke();
  }

  private drawVanishZone(now: number): void {
    const { ctx } = this;
    const { hitX, staves, yOf, space } = this.layout;
    const top = yOf(staves[0].bottomD + 8) - space * 2.4;
    const bottom = yOf(staves[staves.length - 1].bottomD) + space * 2.4;
    const pulse = 0.5 + 0.5 * Math.sin(now / 350);
    const grad = ctx.createLinearGradient(hitX, 0, hitX + space * 2.2, 0);
    grad.addColorStop(0, `rgba(155, 47, 74, ${0.2 + pulse * 0.08})`);
    grad.addColorStop(1, 'rgba(155, 47, 74, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(hitX, top, space * 2.2, bottom - top);
    ctx.strokeStyle = `rgba(155, 47, 74, ${0.5 + pulse * 0.2})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hitX, top);
    ctx.lineTo(hitX, bottom);
    ctx.stroke();
  }

  private drawClefsAndSignature(): void {
    const { ctx } = this;
    const { staves, yOf, space } = this.layout;
    ctx.save();
    for (const staff of staves) {
      const isTreble = staff.clef === 'treble';
      const tune = CLEF[staff.clef];
      ctx.fillStyle = INK;
      ctx.font = `${space * tune.size}px ${NOTE_FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      // Treble clef curls around the G line (2nd from bottom); bass clef sits on the F line (2nd from top).
      const anchorD = isTreble ? staff.bottomD + 2 : staff.bottomD + 6;
      ctx.fillText(isTreble ? '𝄞' : '𝄢', 12, yOf(anchorD) + tune.dy * space);
      let i = 0;
      for (const slot of keySignatureSlots(this.key, staff.clef)) {
        const x = 12 + space * SIG_START + i * space * SIG_STEP;
        this.drawAccidental(x, yOf(slot.d), slot.acc, INK);
        i++;
      }
    }
    ctx.restore();
  }

  private drawAccidental(x: number, y: number, acc: number, color: string): void {
    const { ctx } = this;
    const s = this.layout.space * ACCIDENTAL_SCALE;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const sharp = (cx: number) => {
      ctx.lineWidth = s * 0.1;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.2, y - s * 1.05);
      ctx.lineTo(cx - s * 0.2, y + s * 1.25);
      ctx.moveTo(cx + s * 0.2, y - s * 1.25);
      ctx.lineTo(cx + s * 0.2, y + s * 1.05);
      ctx.stroke();
      ctx.lineWidth = s * 0.3;
      ctx.lineCap = 'butt';
      for (const dy of [-0.4, 0.42]) {
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.5, y + s * (dy + 0.14));
        ctx.lineTo(cx + s * 0.5, y + s * (dy - 0.14));
        ctx.stroke();
      }
      ctx.lineCap = 'round';
    };
    const flat = (cx: number) => {
      ctx.lineWidth = s * 0.1;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.2, y - s * 1.7);
      ctx.lineTo(cx - s * 0.2, y + s * 0.5);
      ctx.stroke();
      ctx.lineWidth = s * 0.17;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.2, y + s * 0.5);
      ctx.bezierCurveTo(cx + s * 0.75, y + s * 0.05, cx + s * 0.6, y - s * 0.75, cx - s * 0.2, y - s * 0.2);
      ctx.stroke();
    };
    if (acc === 1) sharp(x);
    else if (acc === -1) flat(x);
    else if (acc === 2) {
      ctx.lineWidth = s * 0.28;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.35, y - s * 0.35);
      ctx.lineTo(x + s * 0.35, y + s * 0.35);
      ctx.moveTo(x + s * 0.35, y - s * 0.35);
      ctx.lineTo(x - s * 0.35, y + s * 0.35);
      ctx.stroke();
    } else if (acc === -2) {
      flat(x - s * 0.3);
      flat(x + s * 0.3);
    } else {
      ctx.lineWidth = s * 0.1;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.22, y - s * 1.4);
      ctx.lineTo(x - s * 0.22, y + s * 0.6);
      ctx.moveTo(x + s * 0.22, y - s * 0.6);
      ctx.lineTo(x + s * 0.22, y + s * 1.4);
      ctx.stroke();
      ctx.lineWidth = s * 0.26;
      ctx.lineCap = 'butt';
      for (const dy of [-0.38, 0.38]) {
        ctx.beginPath();
        ctx.moveTo(x - s * 0.22, y + s * (dy + 0.1));
        ctx.lineTo(x + s * 0.22, y + s * (dy - 0.1));
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private stemInfo(notes: Pitch[], x: number, dirOverride?: 1 | -1): StemInfo {
    const { yOf, space } = this.layout;
    const staffMid = (n: Pitch) => staffForNote(n.d, this.clef).bottomD + 4;
    const avg = notes.reduce((sum, n) => sum + (n.d - staffMid(n)), 0) / notes.length;
    const dir: 1 | -1 = dirOverride ?? (avg >= 0 ? -1 : 1);
    const hw = space * 0.62;
    const high = yOf(notes[notes.length - 1].d);
    const low = yOf(notes[0].d);
    const mid = yOf(staffMid(notes[0]));
    if (dir === 1) {
      return { dir, x: x + hw - space * 0.05, near: low, tip: Math.min(high - space * 3.5, mid) };
    }
    return { dir, x: x - hw + space * 0.05, near: high, tip: Math.max(low + space * 3.5, mid) };
  }

  private drawEvents(game: Game, now: number, hints: boolean): void {
    const { ctx } = this;
    const { width, hitX, space } = this.layout;
    const current = game.current();
    const visible: { re: RuntimeEvent; x: number }[] = [];
    for (const re of game.events) {
      if (re.t < game.time - 1) continue;
      let x = this.xOf(re, game.time);
      if (x > width + space * 3) break;
      if (x < hitX - space) continue;
      const shakeStart = this.shake.get(re.ev.id);
      if (shakeStart !== undefined) {
        const age = (now - shakeStart) / 1000;
        if (age < 0.35) x += Math.sin(age * 60) * space * 0.35 * (1 - age / 0.35);
        else this.shake.delete(re.ev.id);
      }
      visible.push({ re, x });
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(hitX - space * 0.2, 0, width, this.layout.height);
    ctx.clip();

    for (const { re, x } of visible) {
      this.drawEvent(re, x, re === current, now, hints);
    }
    this.drawBeams(visible);
    ctx.restore();
  }

  private statusColor(status: NoteStatus): string {
    switch (status) {
      case 'exact':
        return SAGE;
      case 'octave':
        return VIOLET;
      case 'missed':
        return 'rgba(125, 114, 133, 0.6)';
      default:
        return INK;
    }
  }

  private drawEvent(
    re: RuntimeEvent,
    x: number,
    isCurrent: boolean,
    now: number,
    hints: boolean,
  ): void {
    const { ctx } = this;
    const { yOf, space, hitX } = this.layout;
    const notes = re.ev.notes;
    const hw = space * 0.62;
    const fade = clamp((x - hitX) / (space * 1.6), 0, 1);
    ctx.save();
    ctx.globalAlpha = fade;

    // Halo behind the note the player should answer next.
    if (isCurrent) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 220);
      for (const n of notes) {
        ctx.fillStyle = `rgba(110, 175, 235, ${0.26 + pulse * 0.16})`;
        ctx.beginPath();
        ctx.arc(x, yOf(n.d), space * (1.25 + pulse * 0.12), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const cross =
      this.clef === 'both' &&
      notes.length === 2 &&
      staffForNote(notes[0].d, this.clef) !== staffForNote(notes[1].d, this.clef);
    // A pair split between the two staves (melody on top, bass below) gets one stem per note.
    const stems = cross ? [this.stemInfo([notes[0]], x), this.stemInfo([notes[1]], x)] : [this.stemInfo(notes, x)];
    const stem = stems[0];

    // Ledger lines, drawn once per line even for doubles.
    ctx.strokeStyle = STAFF_LINE;
    ctx.lineWidth = Math.max(1.4, space * 0.09);
    const drawn = new Set<number>();
    for (const n of notes) {
      for (const d of ledgerLines(n.d, staffForNote(n.d, this.clef))) {
        if (drawn.has(d)) continue;
        drawn.add(d);
        const y = Math.round(yOf(d)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x - hw * 1.9, y);
        ctx.lineTo(x + hw * 1.9, y);
        ctx.stroke();
      }
    }

    // Noteheads (neighbouring steps in a double sit on opposite sides of the stem).
    const open = re.ev.dur >= 2;
    notes.forEach((n, i) => {
      let nx = x;
      const prev = notes[i - 1];
      if (!cross && stem && notes.length === 2 && i === 1 && n.d - prev.d === 1) {
        if (stem.dir === 1) nx = x + hw * 1.95;
      }
      if (!cross && stem && notes.length === 2 && i === 0 && notes[1].d - n.d === 1 && stem.dir === -1) nx = x - hw * 1.95;
      const color = this.statusColor(re.status[i]);
      const y = yOf(n.d);
      ctx.save();
      ctx.translate(nx, y);
      ctx.rotate(-0.38);
      ctx.beginPath();
      ctx.ellipse(0, 0, hw, space * 0.46, 0, 0, Math.PI * 2);
      if (open) {
        ctx.fillStyle = PAPER;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = space * 0.17;
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.restore();

      if (re.ev.dur === 1.5) {
        ctx.fillStyle = color;
        ctx.beginPath();
        const dotY = n.d % 2 === 0 ? y - space * 0.5 : y;
        ctx.arc(nx + hw + space * 0.55, dotY, space * 0.17, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Accidentals, nudged left when two would collide.
    let lastAccD = -99;
    let nudge = 0;
    notes.forEach((n, i) => {
      const keyAcc = this.keyAcc[((n.d % 7) + 7) % 7];
      if (n.acc === keyAcc) return;
      nudge = Math.abs(n.d - lastAccD) <= 2 ? nudge + 1 : 0;
      lastAccD = n.d;
      const extra = !cross && notes.length === 2 && stem?.dir === -1 && i === 0 && notes[1].d - n.d === 1 ? hw * 1.95 : 0;
      this.drawAccidental(
        x - hw - space * (0.8 + nudge * 0.8) - extra,
        yOf(n.d),
        n.acc,
        this.statusColor(re.status[i]),
      );
    });

    if (re.ev.beamId === null) {
      stems.forEach((s, k) => {
        const color = this.statusColor(re.status[cross ? k : 0]);
        this.drawStem(s, color);
        if (re.ev.dur <= 0.5) this.drawFlag(s, color);
      });
    }

    if (hints) {
      if (cross) stems.forEach((s, k) => this.drawHint([notes[k]], x, s));
      else this.drawHint(notes, x, stem);
    }
    ctx.restore();
  }

  private drawStem(stem: StemInfo, color: string): void {
    const { ctx } = this;
    const { space } = this.layout;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.6, space * 0.11);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(stem.x, stem.near);
    ctx.lineTo(stem.x, stem.tip);
    ctx.stroke();
  }

  private drawFlag(stem: StemInfo, color: string): void {
    const { ctx } = this;
    const s = this.layout.space;
    const d = stem.dir === 1 ? 1 : -1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(stem.x, stem.tip);
    ctx.bezierCurveTo(
      stem.x + s * 0.2,
      stem.tip + d * s * 1.0,
      stem.x + s * 1.3,
      stem.tip + d * s * 1.2,
      stem.x + s * 0.95,
      stem.tip + d * s * 2.5,
    );
    ctx.bezierCurveTo(
      stem.x + s * 1.0,
      stem.tip + d * s * 1.6,
      stem.x + s * 0.4,
      stem.tip + d * s * 1.5,
      stem.x,
      stem.tip + d * s * 1.15,
    );
    ctx.closePath();
    ctx.fill();
  }

  private drawBeams(visible: { re: RuntimeEvent; x: number }[]): void {
    const { ctx } = this;
    const { space, hitX } = this.layout;
    const groups = new Map<number, { re: RuntimeEvent; x: number }[]>();
    for (const v of visible) {
      const id = v.re.ev.beamId;
      if (id === null) continue;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id)!.push(v);
    }
    for (const pair of groups.values()) {
      if (pair.length !== 2) continue;
      const [a, b] = pair;
      const all = [...a.re.ev.notes, ...b.re.ev.notes];
      const staffMid = (n: Pitch) => staffForNote(n.d, this.clef).bottomD + 4;
      const avg = all.reduce((sum, n) => sum + (n.d - staffMid(n)), 0) / all.length;
      const dir: 1 | -1 = avg >= 0 ? -1 : 1;
      const sa = this.stemInfo(a.re.ev.notes, a.x, dir);
      const sb = this.stemInfo(b.re.ev.notes, b.x, dir);
      // Shared beam height with a gentle slope towards the second note.
      const extreme = dir === 1 ? Math.min(sa.tip, sb.tip) : Math.max(sa.tip, sb.tip);
      const slope = (t: number) => extreme + clamp(t - extreme, -space * 0.6, space * 0.6);
      sa.tip = slope(sa.tip);
      sb.tip = slope(sb.tip);
      const fade = clamp((Math.min(a.x, b.x) - hitX) / (space * 1.6), 0, 1);
      ctx.save();
      ctx.globalAlpha = fade;
      const colorA = this.statusColor(a.re.status[0]);
      const colorB = this.statusColor(b.re.status[0]);
      this.drawStem(sa, colorA);
      this.drawStem(sb, colorB);
      const grad = ctx.createLinearGradient(sa.x, 0, sb.x, 0);
      grad.addColorStop(0, colorA);
      grad.addColorStop(1, colorB);
      ctx.fillStyle = grad;
      const t = space * 0.5;
      const off = dir === 1 ? 0 : -t;
      ctx.beginPath();
      ctx.moveTo(sa.x - 0.8, sa.tip + off);
      ctx.lineTo(sb.x + 0.8, sb.tip + off);
      ctx.lineTo(sb.x + 0.8, sb.tip + off + t);
      ctx.lineTo(sa.x - 0.8, sa.tip + off + t);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  private drawHint(notes: Pitch[], x: number, stem: StemInfo | null): void {
    const { ctx } = this;
    const { yOf, space } = this.layout;
    const label = notes.map((n) => pitchName(n)).join(' + ');
    const size = clamp(space * 0.72, 10, 17);
    ctx.font = `600 ${size}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textW = ctx.measureText(label).width;
    const stemUp = stem?.dir !== -1;
    const y = stemUp ? yOf(notes[0].d) + space * 1.3 : yOf(notes[notes.length - 1].d) - space * 1.3;
    const padX = size * 0.45;
    const h = size * 1.35;
    ctx.fillStyle = 'rgba(251, 247, 238, 0.94)';
    ctx.strokeStyle = 'rgba(42, 33, 49, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - textW / 2 - padX, y - h / 2, textW + padX * 2, h, h / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillText(label, x, y + 0.5);
  }

  private drawParticles(dt: number): void {
    const { ctx } = this;
    this.particles = this.particles.filter((p) => (p.life -= dt) > 0);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.text ? 0 : this.layout.space * 14 * dt;
      if (p.text) p.vy *= 0.96;
      const alpha = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = alpha;
      if (p.text) {
        ctx.font = `700 ${p.size}px ${UI_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = p.size * 0.28;
        ctx.strokeStyle = PAPER;
        ctx.lineJoin = 'round';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}
