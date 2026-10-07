import { describe, expect, it } from "vitest";
import { encodeMp3Frames } from "./mp3Encode";
import { id3Tag, normalizeExportSettings, normalizePeak, peakOf, safeFileName, stemFileNames, toInt16, DEFAULT_EXPORT } from "./exportFormats";

describe("export helpers", () => {
  it("normalizes the peak to -1 dB and leaves silence alone", () => {
    const ch = [new Float32Array([0.1, -0.25, 0.2]), new Float32Array([0, 0.05, -0.1])];
    normalizePeak(ch, -1);
    expect(peakOf(ch)).toBeCloseTo(Math.pow(10, -1 / 20), 6);
    expect(ch[0][0] / ch[0][2]).toBeCloseTo(0.5, 6); // shape kept
    const silent = [new Float32Array(4)];
    expect(normalizePeak(silent)).toBe(1);
  });

  it("converts to 16-bit with clipping", () => {
    expect(Array.from(toInt16(new Float32Array([0, 1, -1, 2, -2, 0.5])))).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
  });

  it("names stems safely and uniquely", () => {
    expect(stemFileNames("My Song", ["Guitar", "Bass", "Guitar", "a/b:c"], "wav")).toEqual([
      "My Song - Guitar.wav",
      "My Song - Bass.wav",
      "My Song - Guitar (2).wav",
      "My Song - a b c.wav",
    ]);
    expect(safeFileName("  ..  ")).toBe("Untitled");
  });

  it("repairs saved settings", () => {
    expect(normalizeExportSettings(null)).toEqual(DEFAULT_EXPORT);
    expect(normalizeExportSettings({ what: "stems", format: "mp3", mp3Kbps: 999, tail: 4, normalize: true })).toEqual({
      ...DEFAULT_EXPORT,
      what: "stems",
      format: "mp3",
      tail: 4,
      normalize: true,
    });
  });

  it("writes a well-formed ID3v2.3 tag", () => {
    const tag = id3Tag({ title: "Démo", software: "The Dawn Project", comment: "Made with The Dawn Project" });
    expect(String.fromCharCode(...tag.slice(0, 3))).toBe("ID3");
    expect(tag[3]).toBe(3);
    const size = (tag[6] << 21) | (tag[7] << 14) | (tag[8] << 7) | tag[9];
    expect(size).toBe(tag.length - 10);
    expect(String.fromCharCode(...tag.slice(10, 14))).toBe("TIT2");
  });
});

describe("MP3 encoding", () => {
  it("encodes a stereo tone into valid MP3 frames of about the right length", () => {
    const sr = 48000;
    const n = sr * 2;
    const tone = new Float32Array(n).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr));
    const parts = encodeMp3Frames([tone, tone], sr, 192);
    const bytes = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) {
      bytes.set(p, o);
      o += p.length;
    }
    // Frame sync: 11 set bits at the start of the first frame.
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1] & 0xe0).toBe(0xe0);
    // 2 s at 192 kbps is about 48 kB.
    expect(bytes.length).toBeGreaterThan(44000);
    expect(bytes.length).toBeLessThan(52000);
  });
});
