// The desktop app's native engine, as the studio calls it: the commands in
// src-tauri/src/audio/mod.rs. Only callable in the desktop app
// (isDesktopApp).

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
  metronome: (enabled: boolean, levelDb: number) => invoke<void>("engine_metronome", { enabled, levelDb }),
  status: () => invoke<NativeStatus>("engine_status"),
};
