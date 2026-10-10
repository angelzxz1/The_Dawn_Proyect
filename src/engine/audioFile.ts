// Decodes an audio source - an imported file, or a Blob captured from the
// microphone - into everything an audio clip needs: a playable object URL
// (for Tone.Player) plus a downsampled peak array (for drawing a waveform
// in the clip block) and its duration.

import { seedWaveform } from "./waveform";

const PEAK_BUCKETS = 240;

export interface DecodedAudioClip {
  url: string;
  durationSeconds: number;
  peaks: number[];
}

export async function decodeAudioFile(source: Blob): Promise<DecodedAudioClip> {
  const arrayBuffer = await source.arrayBuffer();
  const AudioContextCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioContextCtor();
  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    void ctx.close();
  }

  const channelCount = buffer.numberOfChannels;
  const length = buffer.length;
  const bucketSize = Math.max(1, Math.floor(length / PEAK_BUCKETS));
  const peaks: number[] = [];
  const channels = Array.from({ length: channelCount }, (_, i) => buffer.getChannelData(i));

  for (let bucket = 0; bucket * bucketSize < length; bucket++) {
    const start = bucket * bucketSize;
    const end = Math.min(length, start + bucketSize);
    let max = 0;
    for (let ch = 0; ch < channelCount; ch++) {
      const data = channels[ch];
      for (let i = start; i < end; i++) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
    }
    peaks.push(max);
  }

  const url = URL.createObjectURL(source);
  // The full-resolution waveform for drawing the clip, while the buffer's
  // at hand.
  seedWaveform(url, buffer);
  return {
    url,
    durationSeconds: buffer.duration,
    peaks,
  };
}
