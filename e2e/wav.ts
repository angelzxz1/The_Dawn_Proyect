// WAV files for the tests: a tone to import, and reading what was exported.

/** A mono 16-bit WAV of a sine tone. */
export function toneWav(seconds = 1, frequency = 440, sampleRate = 48000): Buffer {
  const frames = Math.round(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + frames * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 8000), 44 + i * 2);
  return buffer;
}

/** A mono 16-bit WAV with a short 1 kHz blip on every beat, at `bpm`. */
export function beatWav(bpm: number, beats: number, sampleRate = 48000): Buffer {
  const frames = Math.round(((beats * 60) / bpm) * sampleRate);
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + frames * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(frames * 2, 40);
  const beat = (60 / bpm) * sampleRate;
  const blip = Math.round(0.03 * sampleRate);
  for (let i = 0; i < frames; i++) {
    const k = i % beat;
    const v = k < blip ? Math.sin((2 * Math.PI * 1000 * k) / sampleRate) * Math.exp(-k / (0.008 * sampleRate)) * 0.6 : 0;
    buffer.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buffer;
}

export interface WavInfo {
  channels: number;
  sampleRate: number;
  bits: number;
  seconds: number;
  /** The loudest sample, 0 to 1. */
  peak: number;
}

/** Reads a PCM (16/24-bit) or float (32-bit) WAV's format and peak. */
export function readWav(buffer: Buffer): WavInfo {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let offset = 12;
  let format = { code: 0, channels: 0, sampleRate: 0, bits: 0 };
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      format = { code: buffer.readUInt16LE(body), channels: buffer.readUInt16LE(body + 2), sampleRate: buffer.readUInt32LE(body + 4), bits: buffer.readUInt16LE(body + 14) };
    } else if (id === "data") {
      const bytes = format.bits / 8;
      const samples = Math.floor(size / bytes);
      let peak = 0;
      for (let i = 0; i < samples; i++) {
        const at = body + i * bytes;
        const value =
          format.code === 3 ? buffer.readFloatLE(at) : format.bits === 24 ? buffer.readIntLE(at, 3) / 0x800000 : buffer.readInt16LE(at) / 0x8000;
        peak = Math.max(peak, Math.abs(value));
      }
      return { channels: format.channels, sampleRate: format.sampleRate, bits: format.bits, seconds: samples / format.channels / format.sampleRate, peak };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("no audio in the WAV file");
}
