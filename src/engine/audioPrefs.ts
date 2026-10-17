// Audio settings that belong to this computer rather than to a project
// (like a DAW's preferences): delay compensation, the recording latency
// correction for this browser's audio devices, the click's level, and in
// the desktop app the native engine and its device. Kept
// in localStorage; any failure to read or write just falls back to
// defaults. One copy is shared by everything that shows or changes them
// (getAudioPrefs, updateAudioPrefs, subscribeAudioPrefs).

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
  /** The metronome's and count-in's level, in dB from their standard
   * level. */
  metronomeDb: number;
  /** "Don't show again" on the note that offers to measure the latency
   * after a take. */
  latencyHintDismissed: boolean;
  /** The desktop app plays through its native engine (native/). */
  nativeEngine: boolean;
  /** The native engine's device (bridge.ts's ids; null: the system's
   * default), sample rate and buffer size (null: the device's own). */
  nativeDevice: string | null;
  nativeSampleRate: number | null;
  nativeBufferSize: number | null;
}

/** The click level's range, in dB: at the top, the count-in peaks at
 * full scale. */
export const METRONOME_DB_RANGE = { min: -30, max: 3 } as const;

const KEY = "dawn.audioPrefs.v1";

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  delayCompensation: true,
  reducedLatencyMonitoring: true,
  recordingOffsetMs: 0,
  measuredRoundTrip: null,
  metronomeDb: 0,
  latencyHintDismissed: false,
  nativeEngine: false,
  nativeDevice: null,
  nativeSampleRate: null,
  nativeBufferSize: null,
};

/** Settings as stored, checked: anything missing or out of range is the
 * default. */
export function parseAudioPrefs(raw: unknown): AudioPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_AUDIO_PREFS };
  const r = raw as Partial<Record<keyof AudioPrefs, unknown>>;
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const roundTrip = num(r.measuredRoundTrip);
  const whole = (v: unknown, lo: number, hi: number) => {
    const n = num(v);
    return n !== null && Number.isInteger(n) && n >= lo && n <= hi ? n : null;
  };
  return {
    delayCompensation: bool(r.delayCompensation, true),
    reducedLatencyMonitoring: bool(r.reducedLatencyMonitoring, true),
    recordingOffsetMs: clamp(num(r.recordingOffsetMs) ?? 0, -500, 500),
    measuredRoundTrip: roundTrip !== null && roundTrip > 0 && roundTrip < 2 ? roundTrip : null,
    metronomeDb: clamp(num(r.metronomeDb) ?? 0, METRONOME_DB_RANGE.min, METRONOME_DB_RANGE.max),
    latencyHintDismissed: bool(r.latencyHintDismissed, false),
    nativeEngine: bool(r.nativeEngine, false),
    nativeDevice: typeof r.nativeDevice === "string" && r.nativeDevice ? r.nativeDevice : null,
    nativeSampleRate: whole(r.nativeSampleRate, 8000, 384000),
    nativeBufferSize: whole(r.nativeBufferSize, 16, 8192),
  };
}

export function loadAudioPrefs(): AudioPrefs {
  try {
    return parseAudioPrefs(JSON.parse(localStorage.getItem(KEY) ?? "null"));
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

let current: AudioPrefs | null = null;
const listeners = new Set<() => void>();

/** The settings now (read from storage the first time). */
export function getAudioPrefs(): AudioPrefs {
  current ??= loadAudioPrefs();
  return current;
}

/** Changes some settings, saves them and tells whoever's listening. */
export function updateAudioPrefs(change: Partial<AudioPrefs>): void {
  current = { ...getAudioPrefs(), ...change };
  saveAudioPrefs(current);
  listeners.forEach((fn) => fn());
}

/** Calls `fn` whenever the settings change. Returns an unsubscribe. */
export function subscribeAudioPrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
