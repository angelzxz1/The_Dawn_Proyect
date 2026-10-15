// The audio work behind consolidating and reversing clips: what audio
// clips play, mixed into samples the way the engine plays them (each
// clip's loop played out, its gain, its linear fades in and out), and a
// file's samples turned back to front. The math is pure; decoding a clip's
// file is the one part that needs the browser.

import type { TimeRange } from "../project/timeRange";
import type { AudioClipInstance } from "../project/types";

/** One clip and its file's samples, one array per channel, at the rate
 * being rendered at. */
export interface ClipSource {
  clip: AudioClipInstance;
  channels: Float32Array[];
}

/** Adds what `clip` plays into `out` (one array per channel, sample 0 at
 * timeline second `from`), at `sampleRate`. A mono file plays in every
 * channel. */
export function mixClip(out: Float32Array[], from: number, sampleRate: number, { clip, channels }: ClipSource): void {
  if (channels.length === 0) return;
  const frames = out[0]?.length ?? 0;
  const clipStart = Math.round((clip.offset - from) * sampleRate);
  const clipFrames = Math.round(clip.length * sampleRate);
  const first = Math.max(0, clipStart);
  const last = Math.min(frames, clipStart + clipFrames);
  const loop = clip.loopLength && clip.loopLength > 0 ? Math.round(clip.loopLength * sampleRate) : 0;
  const sourceStart = Math.round(clip.sourceOffset * sampleRate);
  const gain = Math.pow(10, clip.gainDb / 20);
  const fadeIn = clip.fadeIn * sampleRate;
  const fadeOut = clip.fadeOut * sampleRate;
  out.forEach((target, c) => {
    const source = channels[Math.min(c, channels.length - 1)];
    for (let i = first; i < last; i++) {
      const k = i - clipStart;
      const s = sourceStart + (loop ? k % loop : k);
      if (s >= source.length) continue;
      let g = gain;
      if (k < fadeIn) g *= k / fadeIn;
      const left = clipFrames - k;
      if (left < fadeOut) g *= left / fadeOut;
      target[i] += source[s] * g;
    }
  });
}

/** What some audio clips play over `span`, as one file's samples: stereo
 * when any of them is, else mono. */
export function renderClips(sources: ClipSource[], span: TimeRange, sampleRate: number): Float32Array[] {
  const channelCount = Math.max(1, ...sources.map((s) => Math.min(2, s.channels.length)));
  const frames = Math.max(1, Math.round((span.end - span.start) * sampleRate));
  const out = Array.from({ length: channelCount }, () => new Float32Array(frames));
  sources.forEach((source) => mixClip(out, span.start, sampleRate, source));
  return out;
}

/** The samples back to front. */
export function reverseChannels(channels: Float32Array[]): Float32Array[] {
  return channels.map((ch) => ch.slice().reverse());
}

/** Where a clip's audio starts in its file once the file is reversed: what
 * it played (its loop, when it loops), back to front. */
export function reversedSourceOffset(clip: Pick<AudioClipInstance, "sourceOffset" | "length" | "loopLength">, fileSeconds: number): number {
  const span = clip.loopLength && clip.loopLength > 0 ? Math.min(clip.loopLength, clip.length) : clip.length;
  return Math.max(0, fileSeconds - clip.sourceOffset - span);
}

/** A file's samples at `sampleRate`, one array per channel. */
export async function decodeSamples(file: Blob, sampleRate: number): Promise<Float32Array[]> {
  const ctx = new OfflineAudioContext(1, 1, sampleRate);
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  return Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
}
