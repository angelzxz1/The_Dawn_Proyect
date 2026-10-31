// The desktop app's native engine and plugins, as the studio calls them:
// the commands in src-tauri/src/audio/mod.rs and src-tauri/src/plugins.rs.
// Only callable in the desktop app (isDesktopApp).

import { invoke } from "@tauri-apps/api/core";
import type { NativeSong } from "./describe";

export interface AudioDevice {
  /** What `open` takes ("wasapi:…", "coreaudio:…", "asio:…"). */
  id: string;
  name: string;
  isDefault: boolean;
  sampleRates: number[];
  /** The buffer sizes (frames) it allows, when it says. */
  minBuffer: number | null;
  maxBuffer: number | null;
  defaultSampleRate: number | null;
}

/** A kind of driver on this system (ASIO, WASAPI, Core Audio, ALSA) and
 * its output devices. */
export interface AudioDriver {
  id: string;
  name: string;
  devices: AudioDevice[];
}

export interface NativeStatus {
  open: boolean;
  sampleRate: number;
  position: number;
  playing: boolean;
  /** Peaks since the last status (0-1, left and right), in track order. */
  tracks: [number, number][];
  buses: [number, number][];
  master: [number, number];
  /** The master limiter's gain (1: not limiting). */
  limiterGain: number;
  /** How much of each buffer's time the engine takes (0-1). */
  load: number;
  /** Dropouts and stream errors since the device opened. */
  errors: number;
}

export const nativeBridge = {
  devices: () => invoke<AudioDriver[]>("audio_devices"),

  /** Opens a device (null: the system's default) at a rate and buffer
   * size (null: the device's own), closing the one open. */
  open: (device: string | null, sampleRate: number | null, bufferSize: number | null) =>
    invoke<{ sampleRate: number; bufferSize: number | null }>("audio_open", { device, sampleRate, bufferSize }),

  close: () => invoke<void>("audio_close"),

  /** Sends a file's decoded audio (at the engine's rate) under `id`. */
  loadAudio: (id: string, channels: Float32Array[], sampleRate: number) => {
    const frames = channels[0]?.length ?? 0;
    const bytes = new Uint8Array(frames * channels.length * 4);
    const view = new Float32Array(bytes.buffer);
    channels.forEach((ch, c) => view.set(ch, c * frames));
    return invoke<void>("engine_load_audio", bytes, {
      headers: { "dawn-audio-id": id, "dawn-channels": String(channels.length), "dawn-sample-rate": String(sampleRate) },
    });
  },

  forgetAudio: (ids: string[]) => invoke<void>("engine_forget_audio", { ids }),

  /** The song to play; says which of its files haven't been sent. */
  setSong: (song: NativeSong) => invoke<{ missing: string[] }>("engine_set_song", { song }),

  play: (from: number, countInBeats = 0) => invoke<void>("engine_play", { from, countInBeats }),
  stop: () => invoke<void>("engine_stop"),
  seek: (seconds: number) => invoke<void>("engine_seek", { seconds }),
  loop: (range: { start: number; end: number } | null) => invoke<void>("engine_loop", { start: range?.start ?? null, end: range?.end ?? null }),
  metronome: (enabled: boolean, levelDb: number, sound: string) => invoke<void>("engine_metronome", { enabled, levelDb, sound }),
  /** A key pressed (with its velocity) or let go (none) live on a track. */
  key: (track: string, key: number, velocity: number | null) => invoke<void>("engine_key", { track, key, velocity }),
  sustain: (track: string, down: boolean) => invoke<void>("engine_sustain", { track, down }),
  /** A track's pitch bend, -1..1 of its instrument's bend range. */
  bend: (track: string, value: number) => invoke<void>("engine_bend", { track, value }),
  /** A track's mod wheel, 0..1. */
  modWheel: (track: string, value: number) => invoke<void>("engine_mod_wheel", { track, value }),
  status: () => invoke<NativeStatus>("engine_status"),
  /** What's gone into a Tuner lately (its last 4096 samples, as f32s);
   * empty when there's no such Tuner playing. */
  tuner: (effect: string) => invoke<ArrayBuffer>("engine_tuner", { effect }),
};

// --- The VST3 and CLAP plugins on this computer (src-tauri/src/plugins.rs) ---

export type PluginFormat = "vst3" | "clap";

export interface PluginInfo {
  format: PluginFormat;
  /** What the format knows it by: a VST3 class id or a CLAP plugin id. */
  id: string;
  name: string;
  vendor: string;
  version: string;
  kind: "effect" | "instrument" | "noteEffect";
  /** VST3 sub-categories ("Fx", "Delay") or CLAP features ("audio-effect"). */
  categories: string[];
  /** The file or bundle it's in. */
  path: string;
}

export interface PluginFailure {
  format: PluginFormat;
  path: string;
  /** Why it couldn't be read ("It crashed as it loaded."). */
  error: string;
}

export interface PluginFolder {
  path: string;
  /** One of this system's standard folders; otherwise, one the user added. */
  standard: boolean;
  exists: boolean;
}

export interface PluginScanProgress {
  done: number;
  total: number;
  /** The files being read right now. */
  reading: string[];
}

export interface PluginList {
  plugins: PluginInfo[];
  failed: PluginFailure[];
  folders: PluginFolder[];
  /** How the scan running now is going, if one is. */
  scan: PluginScanProgress | null;
  /** Whether a scan has finished since the app started. */
  scanned: boolean;
}

export const pluginBridge = {
  /** The plugins found so far; the first call starts a scan. */
  list: () => invoke<PluginList>("plugins_list"),
  /** Scans again, for what's new or changed (and, with `retryFailed`,
   * the files that couldn't be read). */
  scan: (retryFailed: boolean) => invoke<void>("plugins_scan", { retryFailed }),
  addFolder: (path: string) => invoke<void>("plugins_add_folder", { path }),
  removeFolder: (path: string) => invoke<void>("plugins_remove_folder", { path }),
};
