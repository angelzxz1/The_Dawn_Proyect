import { describe, expect, it } from "vitest";
import { DEFAULT_AUDIO_PREFS, parseAudioPrefs } from "./audioPrefs";

describe("parseAudioPrefs", () => {
  it("fills in defaults for anything missing, including settings added later", () => {
    expect(parseAudioPrefs(null)).toEqual(DEFAULT_AUDIO_PREFS);
    // Saved before the click level and the latency note existed.
    expect(parseAudioPrefs({ delayCompensation: false, recordingOffsetMs: 12 })).toEqual({
      ...DEFAULT_AUDIO_PREFS,
      delayCompensation: false,
      recordingOffsetMs: 12,
    });
  });

  it("keeps values in range", () => {
    const p = parseAudioPrefs({ recordingOffsetMs: 9000, metronomeDb: 40, measuredRoundTrip: 5, latencyHintDismissed: "yes" });
    expect(p.recordingOffsetMs).toBe(500);
    expect(p.metronomeDb).toBe(3);
    expect(p.measuredRoundTrip).toBeNull();
    expect(p.latencyHintDismissed).toBe(false);
    expect(parseAudioPrefs({ metronomeDb: -100 }).metronomeDb).toBe(-30);
    expect(parseAudioPrefs({ measuredRoundTrip: 0.042, latencyHintDismissed: true })).toMatchObject({ measuredRoundTrip: 0.042, latencyHintDismissed: true });
  });

  it("keeps the click sound if it's one there is", () => {
    expect(parseAudioPrefs({ metronomeSound: "wood" }).metronomeSound).toBe("wood");
    expect(parseAudioPrefs({ metronomeSound: "kazoo" }).metronomeSound).toBe("classic");
    expect(parseAudioPrefs({}).metronomeSound).toBe("classic");
  });

  it("keeps the native engine's device settings sensible", () => {
    expect(parseAudioPrefs({ nativeEngine: true, nativeDevice: "asio:Focusrite USB ASIO", nativeSampleRate: 48000, nativeBufferSize: 128 })).toMatchObject({
      nativeEngine: true,
      nativeDevice: "asio:Focusrite USB ASIO",
      nativeSampleRate: 48000,
      nativeBufferSize: 128,
    });
    expect(parseAudioPrefs({ nativeDevice: "", nativeSampleRate: 12.5, nativeBufferSize: 1e6 })).toMatchObject({
      nativeDevice: null,
      nativeSampleRate: null,
      nativeBufferSize: null,
    });
  });
});
