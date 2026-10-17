// The native engine in the desktop app, from the studio's side: turned
// on, it opens the audio device, plays the song (describe.ts) and follows
// the browser engine's transport (follower.ts), while the browser engine
// runs on silently - the playhead takes the native engine's position.
//
// It sends the song again whenever the project changes, and each audio
// file once, decoded at the device's rate (a warped clip: its rendering,
// warpRender.ts). A clip whose file is still on its way is silent until it
// arrives.

import * as Tone from "tone";
import { audioEngine } from "../audioEngine";
import type { EngineFollower } from "../follower";
import { warpedBuffer, warpKey } from "../warpRender";
import { nativeBridge, type NativeStatus } from "./bridge";
import { describeSong } from "./describe";
import { currentTempo, projectStore } from "../../state/projectStore";
import { warpPieces } from "../../project/warp";
import type { AudioClipInstance } from "../../project/types";
import { noteIssue } from "../../services/issues";

/** 32-bit FNV-1a of a string, as hex: a short id for a long key. */
function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export interface NativeSettings {
  /** A device id (bridge.ts), or null for the system's default. */
  device: string | null;
  sampleRate: number | null;
  bufferSize: number | null;
}

export interface NativeState {
  active: boolean;
  /** Opening the device. */
  starting: boolean;
  sampleRate: number;
  bufferSize: number | null;
  error: string | null;
  status: NativeStatus | null;
}

class NativeEngine {
  private state: NativeState = { active: false, starting: false, sampleRate: 0, bufferSize: null, error: null, status: null };
  private listeners = new Set<() => void>();
  /** Files sent (or on their way), by the id the engine knows them by. */
  private sent = new Map<string, Promise<void>>();
  private unsubscribe: (() => void) | null = null;
  private songQueued = false;
  private session = { limiterDb: -1, beatsPerBar: 4 };
  private statusAt = 0;
  private polling = false;

  get current(): NativeState {
    return this.state;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<NativeState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  /** Opens the device and takes over playing; again with other settings
   * to change them. */
  async turnOn(settings: NativeSettings): Promise<void> {
    this.set({ starting: true, error: null });
    try {
      const opened = await nativeBridge.open(settings.device, settings.sampleRate, settings.bufferSize);
      if (opened.sampleRate !== this.state.sampleRate) this.sent.clear();
      this.set({ active: true, starting: false, sampleRate: opened.sampleRate, bufferSize: opened.bufferSize });
      Tone.getDestination().mute = true;
      audioEngine.setFollower(this.follower);
      this.unsubscribe ??= projectStore.subscribe(() => this.queueSong());
      this.queueSong();
      this.poll();
    } catch (error) {
      this.set({ starting: false, error: String(error) });
      noteIssue("native.open", error);
      if (!this.state.active) this.release();
    }
  }

  /** Back to the browser's engine. */
  async turnOff(): Promise<void> {
    this.release();
    this.set({ active: false, status: null });
    try {
      await nativeBridge.close();
    } catch (error) {
      noteIssue("native.close", error);
    }
  }

  private release(): void {
    audioEngine.setFollower(null);
    Tone.getDestination().mute = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  // --- The song ---

  private queueSong(): void {
    if (this.songQueued || !this.state.active) return;
    this.songQueued = true;
    queueMicrotask(() => {
      this.songQueued = false;
      void this.sendSong();
    });
  }

  /** The id the engine knows what a clip plays by: its file, or its
   * rendering at the tempo now. */
  private audioId(clip: AudioClipInstance): string {
    const rate = this.state.sampleRate;
    if (!clip.warp) return `${rate}:${clip.url}`;
    const key = warpKey(clip.url, clip.warp.mode, warpPieces(clip as AudioClipInstance & { warp: NonNullable<AudioClipInstance["warp"]> }, currentTempo()), clip.length);
    return `${rate}:w${hash(key)}`;
  }

  private async sendSong(): Promise<void> {
    if (!this.state.active) return;
    const doc = projectStore.get();
    const song = describeSong(doc, this.session, (clip) => this.audioId(clip));
    try {
      const { missing } = await nativeBridge.setSong(song);
      if (missing.length === 0) return;
      // Sends what's missing, then the song again.
      const clips = Object.values(doc.clipsByChannel)
        .flat()
        .filter((c): c is AudioClipInstance => c.kind === "audio");
      const uploads = missing.map((id) => {
        const clip = clips.find((c) => this.audioId(c) === id);
        return clip ? this.upload(id, clip) : Promise.resolve();
      });
      await Promise.all(uploads);
      this.queueSong();
    } catch (error) {
      noteIssue("native.song", error);
    }
  }

  /** Sends what a clip plays, once. */
  private upload(id: string, clip: AudioClipInstance): Promise<void> {
    const known = this.sent.get(id);
    if (known) return known;
    const rate = this.state.sampleRate;
    const job = (async () => {
      const file = await (await fetch(clip.url)).arrayBuffer();
      const source = await new OfflineAudioContext(1, 1, rate).decodeAudioData(file);
      let buffer = source;
      if (clip.warp) {
        const pieces = warpPieces(clip as AudioClipInstance & { warp: NonNullable<AudioClipInstance["warp"]> }, currentTempo());
        // Kept apart from the browser engine's renderings, which may be at
        // another rate.
        buffer = await warpedBuffer(`${rate}|${warpKey(clip.url, clip.warp.mode, pieces, clip.length)}`, source, pieces, clip.length, clip.warp.mode);
      }
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
      await nativeBridge.loadAudio(id, channels, rate);
    })();
    // A failure is forgotten, so it's tried again with the next song.
    job.catch((error) => {
      this.sent.delete(id);
      noteIssue("native.audio", error);
    });
    this.sent.set(id, job);
    return job;
  }

  // --- The status: the position and meters, as often as the screen redraws ---

  private poll(): void {
    if (this.polling) return;
    this.polling = true;
    const tick = async () => {
      if (!this.state.active) {
        this.polling = false;
        return;
      }
      try {
        const status = await nativeBridge.status();
        this.statusAt = performance.now();
        this.set({ status });
      } catch (error) {
        noteIssue("native.status", error);
      }
      requestAnimationFrame(() => void tick());
    };
    void tick();
  }

  // --- Following the browser engine's transport (follower.ts) ---

  private run(name: string, call: Promise<void>): void {
    call.catch((error) => noteIssue(`native.${name}`, error));
  }

  private readonly follower: EngineFollower = {
    play: (from) => this.run("play", nativeBridge.play(from)),
    stop: () => this.run("stop", nativeBridge.stop()),
    seek: (seconds) => this.run("seek", nativeBridge.seek(seconds)),
    loop: (range) => this.run("loop", nativeBridge.loop(range)),
    metronome: (enabled, levelDb) => this.run("metronome", nativeBridge.metronome(enabled, levelDb)),
    limiter: (db) => {
      this.session = { ...this.session, limiterDb: db };
      this.queueSong();
    },
    beatsPerBar: (beats) => {
      this.session = { ...this.session, beatsPerBar: beats };
      this.queueSong();
    },
    position: () => {
      const s = this.state.status;
      if (!s) return null;
      return s.playing ? s.position + (performance.now() - this.statusAt) / 1000 : s.position;
    },
  };
}

export const nativeEngine = new NativeEngine();
