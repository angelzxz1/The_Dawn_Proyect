// The studio's side of the native engine, against a stand-in for the
// desktop app's commands (bridge.ts): turning it on opens the device and
// mutes the browser's output, the song goes over (with the audio it's
// missing, decoded at the device's rate), the transport and what's played
// live are followed, and turning it off hands back to the browser. In
// Chromium, for decoding.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as Tone from "tone";

const bridge = vi.hoisted(() => ({
  open: vi.fn(async (device: string | null, sampleRate: number | null, bufferSize: number | null) => ({ sampleRate: sampleRate ?? 44100, bufferSize, device })),
  close: vi.fn(async () => {}),
  setSong: vi.fn<(song: unknown) => Promise<{ missing: string[] }>>(async () => ({ missing: [] })),
  loadAudio: vi.fn<(id: string, channels: Float32Array[], rate: number) => Promise<void>>(async () => {}),
  play: vi.fn<(from: number) => Promise<void>>(async () => {}),
  stop: vi.fn(async () => {}),
  seek: vi.fn<(seconds: number) => Promise<void>>(async () => {}),
  loop: vi.fn<(range: unknown) => Promise<void>>(async () => {}),
  metronome: vi.fn<(on: boolean, db: number) => Promise<void>>(async () => {}),
  status: vi.fn(async () => ({ open: true, sampleRate: 44100, position: 12.5, playing: false, tracks: [], buses: [], master: [0, 0], limiterGain: 1, load: 0, errors: 0 })),
  devices: vi.fn(async () => []),
  forgetAudio: vi.fn(async () => {}),
  key: vi.fn<(track: string, key: number, velocity: number | null) => Promise<void>>(async () => {}),
  sustain: vi.fn<(track: string, down: boolean) => Promise<void>>(async () => {}),
  bend: vi.fn<(track: string, value: number) => Promise<void>>(async () => {}),
  modWheel: vi.fn<(track: string, value: number) => Promise<void>>(async () => {}),
}));
vi.mock("./bridge", () => ({ nativeBridge: bridge }));

import { nativeEngine } from "./nativeEngine";
import { audioEngine } from "../audioEngine";
import { projectStore } from "../../state/projectStore";
import type { ProjectState } from "../../project/project";

/** A short mono WAV (16-bit) at 22.05 kHz, as a blob URL. */
function wavUrl(): string {
  const rate = 22050;
  const frames = 2205;
  const data = new DataView(new ArrayBuffer(44 + frames * 2));
  const text = (at: number, s: string) => [...s].forEach((c, i) => data.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  data.setUint32(4, 36 + frames * 2, true);
  text(8, "WAVEfmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, rate, true);
  data.setUint32(28, rate * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  text(36, "data");
  data.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) data.setInt16(44 + i * 2, 8000, true);
  return URL.createObjectURL(new Blob([data.buffer], { type: "audio/wav" }));
}

function project(url: string): ProjectState {
  return {
    channels: [{ id: "a1", name: "Vox", volume: -3, pan: 0, colorIndex: 0, type: "audio", instrument: null, muted: false, solo: false, armed: false }],
    clipsByChannel: {
      a1: [
        { id: "c1", kind: "audio", offset: 1, length: 0.1, url, fileName: "vox.wav", durationSeconds: 0.1, peaks: [], sourceOffset: 0, fadeIn: 0, fadeOut: 0, gainDb: 0, loopLength: null },
      ],
    },
    takesByChannel: {},
    channelEffects: {},
    buses: [],
    busEffects: {},
    bpm: 120,
    tempoChanges: [],
    timeSignature: { numerator: 4, denominator: 4 },
    masterVolume: 0,
    masterPan: 0,
    masterName: "Master",
    masterEffects: [],
  };
}

beforeEach(() => {
  Object.values(bridge).forEach((fn) => fn.mockClear());
});

afterEach(async () => {
  await nativeEngine.turnOff();
});

describe("the native engine from the studio", () => {
  test("opens the device, mutes the browser and sends the song with its missing audio", async () => {
    const url = wavUrl();
    projectStore.replace(project(url));
    bridge.setSong.mockResolvedValueOnce({ missing: [`48000:${url}`] });
    await nativeEngine.turnOn({ device: "coreaudio:Interface", sampleRate: 48000, bufferSize: 128 });

    expect(bridge.open).toHaveBeenCalledWith("coreaudio:Interface", 48000, 128);
    expect(nativeEngine.current).toMatchObject({ active: true, sampleRate: 48000, bufferSize: 128 });
    expect(Tone.getDestination().mute).toBe(true);

    // The song, then the file it's missing (decoded at 48 kHz), then the
    // song again.
    await vi.waitFor(() => expect(bridge.setSong).toHaveBeenCalledTimes(2));
    const song = bridge.setSong.mock.calls[0][0] as { tracks: { id: string; volumeDb: number; clips: { audio: string }[] }[] };
    expect(song.tracks[0]).toMatchObject({ id: "a1", volumeDb: -3, clips: [{ audio: `48000:${url}` }] });
    expect(bridge.loadAudio).toHaveBeenCalledTimes(1);
    const [id, channels, rate] = bridge.loadAudio.mock.calls[0];
    expect(id).toBe(`48000:${url}`);
    expect(rate).toBe(48000);
    // 0.1 s, resampled from 22.05 kHz.
    expect(channels[0].length).toBeGreaterThan(4700);
    expect(channels[0][2000]).toBeCloseTo(8000 / 32768, 2);
  });

  test("an edit sends the song again; a file is only sent once", async () => {
    const url = wavUrl();
    projectStore.replace(project(url));
    await nativeEngine.turnOn({ device: null, sampleRate: null, bufferSize: null });
    await vi.waitFor(() => expect(bridge.setSong).toHaveBeenCalled());
    bridge.setSong.mockClear();
    projectStore.set("masterVolume", -6);
    await vi.waitFor(() => expect(bridge.setSong).toHaveBeenCalledTimes(1));
    expect((bridge.setSong.mock.calls[0][0] as { master: { volumeDb: number } }).master.volumeDb).toBe(-6);
  });

  test("follows the transport, and the playhead takes its position", async () => {
    projectStore.replace(project(wavUrl()));
    await nativeEngine.turnOn({ device: null, sampleRate: null, bufferSize: null });
    // On starting to follow: the loop, metronome, limiter, bar and where the
    // transport is.
    expect(bridge.loop).toHaveBeenCalled();
    expect(bridge.metronome).toHaveBeenCalled();
    audioEngine.seekTo(3);
    expect(bridge.seek).toHaveBeenLastCalledWith(3);
    audioEngine.setLoop(true, 2, 6);
    expect(bridge.loop).toHaveBeenLastCalledWith({ start: 2, end: 6 });
    audioEngine.setMetronome(true);
    expect(bridge.metronome).toHaveBeenLastCalledWith(true, expect.any(Number));
    audioEngine.stopAll();
    expect(bridge.stop).toHaveBeenCalled();
    await vi.waitFor(() => expect(audioEngine.getTransportSeconds()).toBe(12.5));
  });

  test("keys played live go to the engine, with the sustain pedal", async () => {
    const p = project(wavUrl());
    p.channels = [...p.channels, { id: "m1", name: "Keys", volume: 0, pan: 0, colorIndex: 0, type: "midi", instrument: "piano", muted: false, solo: false, armed: true }];
    projectStore.replace(p);
    await nativeEngine.turnOn({ device: null, sampleRate: null, bufferSize: null });
    audioEngine.addChannel("m1", "midi", null);
    audioEngine.noteOn("m1", "C4", 0.7);
    expect(bridge.key).toHaveBeenLastCalledWith("m1", 60, 0.7);
    audioEngine.setSustain("m1", true);
    expect(bridge.sustain).toHaveBeenLastCalledWith("m1", true);
    audioEngine.noteOff("m1", "C4");
    expect(bridge.key).toHaveBeenLastCalledWith("m1", 60, null);
    audioEngine.setSustain("m1", false);
    expect(bridge.sustain).toHaveBeenLastCalledWith("m1", false);
  });

  test("a drum track's sample pads are sent with the song", async () => {
    const p = project(wavUrl());
    p.clipsByChannel = {};
    p.channels = [{ id: "d1", name: "Drums", volume: 0, pan: 0, colorIndex: 0, type: "midi", instrument: "drums", muted: false, solo: false, armed: false }];
    projectStore.replace(p);
    bridge.setSong.mockResolvedValueOnce({ missing: ["48000:piano:A0"] });
    await nativeEngine.turnOn({ device: null, sampleRate: 48000, bufferSize: null });
    await vi.waitFor(() => expect(bridge.setSong).toHaveBeenCalled());
    const song = bridge.setSong.mock.calls[0][0] as { tracks: { instrument: { type: string; samples: unknown[] } }[] };
    expect(song.tracks[0].instrument.type).toBe("drums");
    expect(song.tracks[0].instrument.samples).toHaveLength(16);
  });

  test("a synth track's wavetables are sent with the song, as one run of samples each", async () => {
    const p = project(wavUrl());
    p.clipsByChannel = {};
    p.channels = [{ id: "s1", name: "Synth", volume: 0, pan: 0, colorIndex: 0, type: "midi", instrument: "synth", muted: false, solo: false, armed: false }];
    projectStore.replace(p);
    bridge.setSong.mockResolvedValueOnce({ missing: ["48000:wavetable:basic", "48000:wavetable:sub"] });
    await nativeEngine.turnOn({ device: null, sampleRate: 48000, bufferSize: null });
    await vi.waitFor(() => expect(bridge.setSong).toHaveBeenCalledTimes(2));
    const song = bridge.setSong.mock.calls[0][0] as { tracks: { instrument: { type: string; tables: string[] } }[] };
    expect(song.tracks[0].instrument.type).toBe("synth");
    expect(song.tracks[0].instrument.tables).toEqual(["48000:wavetable:basic", "48000:wavetable:basic", "48000:wavetable:sub"]);
    const sent = Object.fromEntries(bridge.loadAudio.mock.calls.map(([id, channels]) => [id, channels]));
    // Basic Shapes has 33 frames, the sub's shapes 4: 4480 samples a frame
    // over the mip levels.
    expect(sent["48000:wavetable:basic"].map((c) => c.length)).toEqual([33 * 4480]);
    expect(sent["48000:wavetable:sub"].map((c) => c.length)).toEqual([4 * 4480]);
  });

  test("the pitch bend and mod wheel go to the engine", async () => {
    projectStore.replace(project(wavUrl()));
    await nativeEngine.turnOn({ device: null, sampleRate: null, bufferSize: null });
    // Semitones, as the synth takes them: ±2 is a full bend.
    audioEngine.setPitchBend("m1", 1);
    expect(bridge.bend).toHaveBeenLastCalledWith("m1", 0.5);
    audioEngine.setPitchBend("m1", -4);
    expect(bridge.bend).toHaveBeenLastCalledWith("m1", -1);
    audioEngine.setModWheel("m1", 0.3);
    expect(bridge.modWheel).toHaveBeenLastCalledWith("m1", 0.3);
  });

  test("turned off, the browser plays again and the transport isn't followed", async () => {
    projectStore.replace(project(wavUrl()));
    await nativeEngine.turnOn({ device: null, sampleRate: null, bufferSize: null });
    await nativeEngine.turnOff();
    expect(bridge.close).toHaveBeenCalled();
    expect(Tone.getDestination().mute).toBe(false);
    bridge.seek.mockClear();
    audioEngine.seekTo(1);
    expect(bridge.seek).not.toHaveBeenCalled();
    expect(nativeEngine.current.active).toBe(false);
  });

  test("a device that won't open says why, and leaves the browser playing", async () => {
    bridge.open.mockRejectedValueOnce("That audio device isn't connected.");
    await nativeEngine.turnOn({ device: "asio:Gone", sampleRate: null, bufferSize: null });
    expect(nativeEngine.current).toMatchObject({ active: false, error: "That audio device isn't connected." });
    expect(Tone.getDestination().mute).toBe(false);
  });
});
