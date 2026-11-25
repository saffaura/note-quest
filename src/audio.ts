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

/** How a note should sound: right answers get a little reverb, wrong ones stay short and dry. */
export type NoteStyle = 'plain' | 'correct' | 'near' | 'wrong';

/** `sustain` is the time (seconds) the synth fallback takes to die away; `wet` is how much goes to the reverb. */
const STYLES: Record<NoteStyle, { sustain: number; wet: number; length: number }> = {
  plain: { sustain: 1.1, wet: 0.045, length: 1.3 },
  correct: { sustain: 1.1, wet: 0.16, length: 1.3 },
  near: { sustain: 1.1, wet: 0.1, length: 1.3 },
  wrong: { sustain: 0.9, wet: 0, length: 0.5 },
};

/**
 * Real grand-piano recordings, one every three semitones from C3 to C6 (Salamander Grand Piano by
 * Alexander Holm, CC BY 3.0). A key plays the nearest recording, shifted by at most two semitones.
 * File names are the note names, e.g. Ds4.mp3 = D#4.
 */
const SAMPLE_FILES = import.meta.glob('./assets/piano/*.mp3', { query: '?url', import: 'default', eager: true }) as Record<
  string,
  string
>;
const NOTE_SEMITONES: Record<string, number> = { C: 0, Cs: 1, D: 2, Ds: 3, E: 4, F: 5, Fs: 6, G: 7, Gs: 8, A: 9, As: 10, B: 11 };

export const PIANO_SAMPLES: { midi: number; url: string }[] = Object.entries(SAMPLE_FILES)
  .flatMap(([path, url]) => {
    const m = /\/([A-G]s?)(\d)\.mp3$/.exec(path);
    return m ? [{ midi: 12 * (Number(m[2]) + 1) + NOTE_SEMITONES[m[1]], url }] : [];
  })
  .sort((a, b) => a.midi - b.midi);

/** Only the start of each (long) recording is kept: notes here never ring for more than a couple of seconds. */
const SAMPLE_SECONDS = 2.2;
/** Average level of the first moments of a recording after normalising, before the caller's volume. */
const SAMPLE_LEVEL = 0.36;
/** The loudest peak a normalised recording may reach, before the caller's volume. */
const SAMPLE_PEAK = 1.4;
/** How far (0 to 1) the stereo image of each recording is pulled towards the centre. */
const SAMPLE_CENTERING = 0.7;

export interface Sample {
  midi: number;
  buffer: AudioBuffer;
  /** Seconds of silence before the attack, skipped so keys respond straight away. */
  start: number;
  /** Evens out the loudness of the different recordings. */
  gain: number;
}

/**
 * Trim a decoded recording, find where the attack begins and work out its loudness. Both channels
 * count: the recordings are panned (higher notes sit to one side), so measuring a single channel
 * would make those notes far too loud.
 */
export function prepareSample(ctx: BaseAudioContext, decoded: AudioBuffer, midi: number): Sample {
  const length = Math.min(decoded.length, Math.floor(decoded.sampleRate * SAMPLE_SECONDS));
  const buffer = ctx.createBuffer(decoded.numberOfChannels, length, decoded.sampleRate);
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    buffer.copyToChannel(decoded.getChannelData(ch).subarray(0, length), ch);
    channels.push(buffer.getChannelData(ch));
  }
  if (channels.length === 2) {
    // Close-miked recordings can sit almost entirely in one ear; pull them part-way to the middle.
    const [left, right] = channels;
    for (let i = 0; i < length; i++) {
      const mid = (left[i] + right[i]) / 2;
      left[i] += (mid - left[i]) * SAMPLE_CENTERING;
      right[i] += (mid - right[i]) * SAMPLE_CENTERING;
    }
  }
  let peak = 0;
  for (const data of channels) for (const v of data) peak = Math.max(peak, Math.abs(v));
  let onset = 0;
  while (onset < length && channels.every((data) => Math.abs(data[onset]) < peak * 0.08)) onset++;
  const window = Math.min(length - onset, Math.floor(buffer.sampleRate * 0.4));
  let sum = 0;
  for (const data of channels) for (let i = 0; i < window; i++) sum += data[onset + i] * data[onset + i];
  const rms = window > 0 ? Math.sqrt(sum / (window * channels.length)) : 0;
  // Even out loudness, but never let a sharp attack (the highest notes) get much louder than the rest.
  const gain = rms > 0 ? Math.min(SAMPLE_LEVEL / rms, SAMPLE_PEAK / peak) : 1;
  return { midi, buffer, start: Math.max(0, onset / buffer.sampleRate - 0.004), gain };
}

/** The recording closest in pitch to `midi`. */
export function nearestSample(samples: Sample[], midi: number): Sample | null {
  let best: Sample | null = null;
  for (const s of samples) if (!best || Math.abs(s.midi - midi) < Math.abs(best.midi - midi)) best = s;
  return best;
}

/** Play the recorded note, shifted to the pitch of `midi`, with the same reverb routing as the synth voice. */
export function playSample(
  ctx: BaseAudioContext,
  dest: AudioNode,
  reverb: AudioNode | null,
  sample: Sample,
  midi: number,
  style: NoteStyle,
  volume: number,
  when: number = ctx.currentTime,
): void {
  const { wet, length } = STYLES[style];
  const src = ctx.createBufferSource();
  src.buffer = sample.buffer;
  src.playbackRate.value = midiToFreq(midi) / midiToFreq(sample.midi);

  const out = ctx.createGain();
  const level = volume * sample.gain;
  const fade = Math.min(0.35, length / 2);
  out.gain.setValueAtTime(level, when);
  // The recordings are long and piano notes ring; cap the length so notes never pile up.
  out.gain.setValueAtTime(level, when + length - fade);
  out.gain.linearRampToValueAtTime(0, when + length);
  src.connect(out);
  out.connect(dest);
  if (reverb && wet > 0) {
    const send = ctx.createGain();
    send.gain.value = wet;
    out.connect(send);
    send.connect(reverb);
  }
  src.start(when, sample.start);
  src.stop(when + length + 0.02);
}

/** Relative loudness of the first partials of a piano string. */
const PARTIALS = [1, 0.55, 0.32, 0.2, 0.11, 0.06];
const PARTIAL_SCALE = 0.66;

/** A short, damped stereo room built from decaying noise, used as the reverb's impulse response. */
function reverbImpulse(ctx: BaseAudioContext, seconds = 0.3): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // The tail gets darker as it fades, like a real room.
      low += (Math.random() * 2 - 1 - low) * (0.75 - 0.6 * t);
      data[i] = low * Math.pow(1 - t, 2.6) * (i < 64 ? i / 64 : 1);
    }
  }
  return buffer;
}

/**
 * One piano-like note: slightly inharmonic partials that die away at different speeds (the
 * high ones first), a pair of detuned strings for the shimmer, and a soft hammer thump.
 * Low notes ring longer than high ones. `reverb` is the convolver input (or null for no reverb).
 */
export function playVoice(
  ctx: BaseAudioContext,
  dest: AudioNode,
  reverb: AudioNode | null,
  midi: number,
  style: NoteStyle,
  volume: number,
  when: number = ctx.currentTime,
): void {
  const { sustain, wet } = STYLES[style];
  const freq = midiToFreq(midi);
  const register = Math.min(1.5, Math.max(0.6, 1.6 - (midi - 48) / 48));
  const tau = (sustain / 6.9) * register;

  const bus = ctx.createGain();
  bus.gain.value = volume * PARTIAL_SCALE;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = Math.min(9000, 2400 + freq * 4);
  tone.Q.value = 0.5;
  bus.connect(tone);
  tone.connect(dest);
  if (reverb && wet > 0) {
    const send = ctx.createGain();
    send.gain.value = wet;
    tone.connect(send);
    send.connect(reverb);
  }

  const stringsPerPartial = (n: number) => (n <= 2 ? [1.0006, 0.9995] : [1]);
  PARTIALS.forEach((level, index) => {
    const n = index + 1;
    const partialFreq = freq * n * Math.sqrt(1 + 0.0003 * n * n);
    if (partialFreq > 10000) return;
    const partialTau = tau / (1 + 0.7 * index);
    const strings = stringsPerPartial(n);
    for (const detune of strings) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = partialFreq * detune;
      const peak = level / strings.length;
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(peak, when + 0.004);
      g.gain.setTargetAtTime(0, when + 0.004, partialTau);
      osc.connect(g);
      g.connect(bus);
      osc.start(when);
      osc.stop(when + 0.05 + partialTau * 7);
    }
  });

  // Hammer thump: a few milliseconds of filtered noise.
  const noiseLength = Math.floor(ctx.sampleRate * 0.04);
  const noiseBuffer = ctx.createBuffer(1, noiseLength, ctx.sampleRate);
  const noise = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseLength; i++) noise[i] = (Math.random() * 2 - 1) * (1 - i / noiseLength);
  const thump = ctx.createBufferSource();
  thump.buffer = noiseBuffer;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = Math.min(3000, freq * 3);
  band.Q.value = 0.8;
  const thumpGain = ctx.createGain();
  thumpGain.gain.value = 0.35;
  thump.connect(band);
  band.connect(thumpGain);
  thumpGain.connect(bus);
  thump.start(when);
}

/**
 * Tiny Web Audio piano: additive synthesis plus a convolution reverb (see playVoice).
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
  private reverb: ConvolverNode | null = null;
  private samples: Sample[] = [];
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
      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = reverbImpulse(this.ctx);
      this.reverb.connect(this.master);
      void this.loadSamples();
      // Playing one silent sample inside the tap finishes the unlock on older iOS versions.
      const src = this.ctx.createBufferSource();
      src.buffer = this.ctx.createBuffer(1, 1, 22050);
      src.connect(this.ctx.destination);
      src.start(0);
    }
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
  }

  /** Play a note. Right answers should use 'correct' (or 'near'), which gets a little reverb. */
  note(midi: number, style: NoteStyle = 'plain', volume = 0.5): void {
    if (this.muted || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    if (ctx.state === 'running') {
      this.play(midi, style, volume);
      return;
    }
    // Still waking up (or iOS interrupted us): play this note as soon as audio is running.
    if (this.waking) return;
    this.waking = true;
    ctx
      .resume()
      .then(() => {
        if (ctx.state === 'running') this.play(midi, style, volume);
      })
      .catch(() => {})
      .finally(() => {
        this.waking = false;
      });
  }

  /**
   * Fetch and decode the piano recordings one at a time (keeping memory low), middle of the keyboard
   * first. A key uses a recording once one within a few semitones is ready; until then, or if
   * loading fails, the built-in synth plays instead.
   */
  private async loadSamples(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    const order = [...PIANO_SAMPLES].sort((a, b) => Math.abs(a.midi - 66) - Math.abs(b.midi - 66));
    for (const { midi, url } of order) {
      try {
        const data = await (await fetch(url)).arrayBuffer();
        // Callback form: older Safari has no promise-based decodeAudioData.
        const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
          const decoding = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
          decoding?.catch?.(() => {});
        });
        this.samples.push(prepareSample(ctx, decoded, midi));
      } catch {
        /* skip this one; neighbouring recordings or the synth cover it */
      }
    }
  }

  private play(midi: number, style: NoteStyle, volume: number): void {
    const sample = nearestSample(this.samples, midi);
    if (sample && Math.abs(sample.midi - midi) <= 3) {
      playSample(this.ctx!, this.master!, this.reverb, sample, midi, style, volume);
    } else {
      playVoice(this.ctx!, this.master!, this.reverb, midi, style, volume);
    }
  }

  /** Short happy arpeggio for the results screen. */
  fanfare(): void {
    [60, 64, 67, 72].forEach((m, i) => setTimeout(() => this.note(m, 'correct', 0.35), i * 110));
  }

  /** For tests and debugging: whether sound can play right now. */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }
}
