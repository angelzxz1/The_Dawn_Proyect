// Decodes an imported audio file into everything an audio clip needs: a
// playable object URL (for Tone.Player) plus a downsampled peak array (for
// drawing a waveform in the clip block) and its duration.

const PEAK_BUCKETS = 240;

export interface DecodedAudioClip {
  url: string;
  durationSeconds: number;
  peaks: number[];
}

export async function decodeAudioFile(file: File): Promise<DecodedAudioClip> {
  const arrayBuffer = await file.arrayBuffer();
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

  return {
    url: URL.createObjectURL(file),
    durationSeconds: buffer.duration,
    peaks,
  };
}
