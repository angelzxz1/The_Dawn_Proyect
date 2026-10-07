// Encodes MP3 off the main thread, so the interface stays responsive while
// a long song encodes. Receives { channels, sampleRate, kbps } and posts
// { progress } updates, then { parts } (or { error }).

import { encodeMp3Frames } from "../export/mp3Encode";

self.onmessage = (e: MessageEvent<{ channels: Float32Array[]; sampleRate: number; kbps: number }>) => {
  const { channels, sampleRate, kbps } = e.data;
  try {
    let last = 0;
    const parts = encodeMp3Frames(channels, sampleRate, kbps, (p) => {
      if (p - last >= 0.02 || p === 1) {
        last = p;
        self.postMessage({ progress: p });
      }
    });
    self.postMessage({ parts }, { transfer: parts.map((p) => p.buffer as ArrayBuffer) });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
