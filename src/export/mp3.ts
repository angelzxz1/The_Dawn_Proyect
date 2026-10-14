// Encodes audio as an MP3 file in a Web Worker (see workers/mp3.worker.ts),
// with an ID3 tag saying it was made with Dawn.

import { id3Tag, MP3_SAMPLE_RATES } from "./exportFormats";

/** Resamples to 48 kHz when the audio's rate isn't one an MP3 can have. */
async function mp3Rate(channels: Float32Array[], sampleRate: number): Promise<{ channels: Float32Array[]; sampleRate: number }> {
  if (MP3_SAMPLE_RATES.includes(sampleRate)) return { channels, sampleRate };
  const target = 48000;
  const length = Math.ceil((channels[0].length * target) / sampleRate);
  const ctx = new OfflineAudioContext(channels.length, Math.max(1, length), target);
  const buffer = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return { channels: Array.from({ length: out.numberOfChannels }, (_, i) => out.getChannelData(i)), sampleRate: target };
}

export async function encodeMp3(
  input: Float32Array[],
  inputRate: number,
  kbps: number,
  title: string,
  onProgress?: (fraction: number) => void
): Promise<Blob> {
  const { channels, sampleRate } = await mp3Rate(input, inputRate);
  const worker = new Worker(new URL("../workers/mp3.worker.ts", import.meta.url), { type: "module" });
  try {
    const parts = await new Promise<Uint8Array[]>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ progress?: number; parts?: Uint8Array[]; error?: string }>) => {
        if (e.data.progress !== undefined) onProgress?.(e.data.progress);
        else if (e.data.parts) resolve(e.data.parts);
        else reject(new Error(e.data.error ?? "MP3 encoding failed"));
      };
      worker.onerror = (e) => reject(new Error(e.message || "MP3 encoder failed to start"));
      // Copies, so the caller's audio stays usable.
      worker.postMessage({ channels: channels.map((c) => c.slice()), sampleRate, kbps });
    });
    const tag = id3Tag({ title, software: "The Dawn Project", comment: "Made with The Dawn Project" });
    return new Blob([tag as Uint8Array<ArrayBuffer>, ...(parts as Uint8Array<ArrayBuffer>[])], { type: "audio/mpeg" });
  } finally {
    worker.terminate();
  }
}
