import { midiToFreq } from './theory';

/** A quarter second of silence as a tiny WAV file (used to put iOS in "media playback" mode). */
function silentWavUrl(): string {
  const sampleRate = 8000;
  const samples = 2000;
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  text(36, 'data');
  v.setUint32(40, samples, true);
  new Uint8Array(buf, 44).fill(128); // 8-bit silence
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/**
 * Tiny Web Audio synth: a soft, piano-ish pluck.
 *
 * iPhones and iPads are strict about audio, so unlocking is done defensively:
 *  - the context is created and resumed from real taps (touchend/click/keydown count; pointerdown
 *    does not), and every later tap retries in case iOS interrupted it;
 *  - the page asks for a "playback" audio session and loops a silent <audio> clip, which stops the
 *    ring/silent switch from muting Web Audio;
 *  - a note requested while the context is still waking up plays once it is running instead of
 *    being lost.
 */
export class Audio {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private keepAlive: HTMLAudioElement | null = null;
  private waking = false;

  constructor() {
    const retry = () => this.unlock();
    for (const type of ['touchend', 'pointerup', 'click', 'keydown']) {
      document.addEventListener(type, retry, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.unlock();
    });
  }

  /** Safe to call as often as you like; it only does work while audio is not yet running. */
  unlock(): void {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) {
      try {
        session.type = 'playback';
      } catch {
        /* unsupported value: ignore */
      }
    }
    if (!this.keepAlive) {
      // createElement, not `new Audio()`: this module's own class shadows the global constructor.
      const el = document.createElement('audio');
      el.src = silentWavUrl();
      el.loop = true;
      el.preload = 'auto';
      el.setAttribute('playsinline', '');
      this.keepAlive = el;
    }
    if (this.keepAlive.paused) void this.keepAlive.play().catch(() => {});

    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      const compressor = this.ctx.createDynamicsCompressor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(compressor);
      compressor.connect(this.ctx.destination);
      // Playing one silent sample inside the tap finishes the unlock on older iOS versions.
      const src = this.ctx.createBufferSource();
      src.buffer = this.ctx.createBuffer(1, 1, 22050);
      src.connect(this.ctx.destination);
      src.start(0);
    }
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
  }

  note(midi: number, length = 1.1, volume = 0.5): void {
    if (this.muted || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    if (ctx.state === 'running') {
      this.play(midi, length, volume);
      return;
    }
    // Still waking up (or iOS interrupted us): play this note as soon as audio is running.
    if (this.waking) return;
    this.waking = true;
    ctx
      .resume()
      .then(() => {
        if (ctx.state === 'running') this.play(midi, length, volume);
      })
      .catch(() => {})
      .finally(() => {
        this.waking = false;
      });
  }

  private play(midi: number, length: number, volume: number): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const freq = midiToFreq(midi);

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(volume, now + 0.008);
    out.gain.exponentialRampToValueAtTime(volume * 0.35, now + 0.18);
    out.gain.exponentialRampToValueAtTime(0.0001, now + length);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(8000, freq * 7), now);
    filter.frequency.exponentialRampToValueAtTime(Math.min(2500, freq * 2.5), now + length);
    filter.connect(out);
    out.connect(this.master!);

    const partials: [number, OscillatorType, number][] = [
      [1, 'triangle', 1],
      [2, 'sine', 0.35],
      [3, 'sine', 0.12],
    ];
    for (const [mult, type, gain] of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq * mult;
      g.gain.value = gain;
      osc.connect(g);
      g.connect(filter);
      osc.start(now);
      osc.stop(now + length + 0.05);
    }
  }

  /** Short happy arpeggio for the results screen. */
  fanfare(): void {
    [60, 64, 67, 72].forEach((m, i) => setTimeout(() => this.note(m, 0.9, 0.35), i * 110));
  }

  /** For tests and debugging: whether sound can play right now. */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }
}
