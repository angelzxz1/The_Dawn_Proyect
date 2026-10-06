// Waveform data for drawing audio clips the way a DAW does: for every
// short bucket of samples, the lowest and highest value, so any zoom level
// can draw each pixel column as the true min-to-max span of the audio under
// it. Computed once per audio source (clips split from one recording share
// it) and cached by the source's URL.

import { noteIssue } from "./issues";

/** Samples per bucket: ~1.3 ms at 48 kHz, finer than a pixel at the
 * timeline's closest zoom. */
export const WAVE_BUCKET = 64;

export interface Waveform {
  min: Float32Array;
  max: Float32Array;
  /** Buckets in use (the arrays may be longer while recording). */
  length: number;
  /** Seconds per bucket. */
  bucketSeconds: number;
}

/** Min/max per bucket across all channels. */
export function waveformFromChannels(channels: Float32Array[], sampleRate: number): Waveform {
  const frames = channels[0]?.length ?? 0;
  const length = Math.ceil(frames / WAVE_BUCKET);
  const min = new Float32Array(length);
  const max = new Float32Array(length);
  for (let b = 0; b < length; b++) {
    let lo = 0;
    let hi = 0;
    const end = Math.min(frames, (b + 1) * WAVE_BUCKET);
    for (const data of channels) {
      for (let i = b * WAVE_BUCKET; i < end; i++) {
        const v = data[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max, length, bucketSeconds: WAVE_BUCKET / sampleRate };
}

/** A coarse stand-in from a clip's saved peak list (0..1 per slice of the
 * whole file), drawn until the full waveform is ready. */
export function waveformFromPeaks(peaks: number[], durationSeconds: number): Waveform | null {
  if (!peaks.length || durationSeconds <= 0) return null;
  const max = Float32Array.from(peaks);
  return { min: max.map((v) => -v), max, length: peaks.length, bucketSeconds: durationSeconds / peaks.length };
}

/** The lowest and highest value between source times s0 and s1 (seconds),
 * or null past the end of the audio. */
export function waveformSpan(wf: Waveform, s0: number, s1: number): [number, number] | null {
  const b0 = Math.max(0, Math.floor(s0 / wf.bucketSeconds));
  if (b0 >= wf.length) return null;
  const b1 = Math.min(wf.length, Math.max(b0 + 1, Math.ceil(s1 / wf.bucketSeconds)));
  let lo = 0;
  let hi = 0;
  for (let b = b0; b < b1; b++) {
    if (wf.min[b] < lo) lo = wf.min[b];
    if (wf.max[b] > hi) hi = wf.max[b];
  }
  return [lo, hi];
}

/** A waveform that grows as audio arrives (a recording in progress).
 * Samples are placed by their index from the start of the take. */
export class WaveformBuilder {
  private min = new Float32Array(4096);
  private max = new Float32Array(4096);
  private used = 0;
  /** Bumped on every change, so a view knows to redraw. */
  version = 0;

  constructor(private readonly sampleRate: number) {}

  add(startIndex: number, data: Float32Array): void {
    for (let i = 0; i < data.length; i++) {
      const at = startIndex + i;
      if (at < 0) continue;
      const b = Math.floor(at / WAVE_BUCKET);
      if (b >= this.min.length) this.grow(b + 1);
      const v = data[i];
      if (v < this.min[b]) this.min[b] = v;
      if (v > this.max[b]) this.max[b] = v;
      if (b + 1 > this.used) this.used = b + 1;
    }
    this.version++;
  }

  private grow(needed: number): void {
    let size = this.min.length;
    while (size < needed) size *= 2;
    const min = new Float32Array(size);
    const max = new Float32Array(size);
    min.set(this.min);
    max.set(this.max);
    this.min = min;
    this.max = max;
  }

  get waveform(): Waveform {
    return { min: this.min, max: this.max, length: this.used, bucketSeconds: WAVE_BUCKET / this.sampleRate };
  }
}

// --- Cache by source URL ---

const cache = new Map<string, Waveform>();
const loading = new Map<string, Promise<Waveform | null>>();

export function cachedWaveform(url: string): Waveform | null {
  return cache.get(url) ?? null;
}

/** Stores the waveform of an already-decoded source (an import or a
 * recording), so it doesn't have to be decoded again to be drawn. */
export function seedWaveform(url: string, buffer: AudioBuffer): Waveform {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const wf = waveformFromChannels(channels, buffer.sampleRate);
  cache.set(url, wf);
  return wf;
}

/** Decodes a source by URL (once) and caches its waveform. */
export function loadWaveform(url: string): Promise<Waveform | null> {
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);
  let pending = loading.get(url);
  if (!pending) {
    pending = (async () => {
      try {
        const data = await (await fetch(url)).arrayBuffer();
        const buffer = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(data);
        return seedWaveform(url, buffer);
      } catch (error) {
        // The clip shows without its waveform.
        noteIssue("waveform", error);
        return null;
      } finally {
        loading.delete(url);
      }
    })();
    loading.set(url, pending);
  }
  return pending;
}
