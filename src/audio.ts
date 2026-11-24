import { midiToFreq } from './theory';

/** Tiny Web Audio synth: a soft, piano-ish pluck. The context starts on the first user gesture. */
export class Audio {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  /** Must be called from a user gesture (tap/click) to satisfy autoplay policies. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      const compressor = this.ctx.createDynamicsCompressor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(compressor).connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  note(midi: number, length = 1.1, volume = 0.5): void {
    if (this.muted || !this.ctx || !this.master) return;
    const ctx = this.ctx;
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
    filter.connect(out).connect(this.master);

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
      osc.connect(g).connect(filter);
      osc.start(now);
      osc.stop(now + length + 0.05);
    }
  }

  /** Short happy arpeggio for the results screen. */
  fanfare(): void {
    [60, 64, 67, 72].forEach((m, i) => setTimeout(() => this.note(m, 0.9, 0.35), i * 110));
  }
}
