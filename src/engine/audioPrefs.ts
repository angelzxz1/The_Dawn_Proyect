// Audio settings that belong to this computer rather than to a project
// (like a DAW's preferences): delay compensation, and the recording
// latency correction for this browser's audio devices. Kept in
// localStorage; any failure to read or write just falls back to defaults.

export interface AudioPrefs {
  /** Plugin delay compensation (see latency.ts). */
  delayCompensation: boolean;
  /** Monitored/armed tracks skip compensation so playing feels immediate. */
  reducedLatencyMonitoring: boolean;
  /** Extra shift applied to recordings, in ms (positive = move earlier). */
  recordingOffsetMs: number;
  /** A measured round trip (output -> input, seconds), which replaces the
   * browser's own estimate when present. */
  measuredRoundTrip: number | null;
}

const KEY = "dawn.audioPrefs.v1";

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  delayCompensation: true,
  reducedLatencyMonitoring: true,
  recordingOffsetMs: 0,
  measuredRoundTrip: null,
};

export function loadAudioPrefs(): AudioPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<AudioPrefs> | null;
    if (!raw || typeof raw !== "object") return { ...DEFAULT_AUDIO_PREFS };
    const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return {
      delayCompensation: bool(raw.delayCompensation, true),
      reducedLatencyMonitoring: bool(raw.reducedLatencyMonitoring, true),
      recordingOffsetMs: Math.max(-500, Math.min(500, num(raw.recordingOffsetMs) ?? 0)),
      measuredRoundTrip: (() => {
        const v = num(raw.measuredRoundTrip);
        return v !== null && v > 0 && v < 2 ? v : null;
      })(),
    };
  } catch {
    return { ...DEFAULT_AUDIO_PREFS };
  }
}

export function saveAudioPrefs(prefs: AudioPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Private mode / storage blocked: the settings just won't persist.
  }
}
