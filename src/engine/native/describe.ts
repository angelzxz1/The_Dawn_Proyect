// The song as the desktop app's native engine takes it
// (src-tauri/src/audio/song.rs): every track with its level, pan, whether
// it's heard (mute and solo, worked out as the browser's engine does,
// mixGraph.ts), where it goes, its sends, its audio clips, and a MIDI
// track's notes and instrument; the buses; the master; the tempo map. The
// engine only renders what it's told. Pure.
//
// So far the native engine plays audio clips and the piano's and the Drum
// Rack's notes through the mix: the synth, effects and automation aren't in
// it yet (unsupported() names what a project uses of them).

import { audibleTracks } from "../mixGraph";
import { routeMap } from "../routing";
import { notesWithinClip, type ProjectState } from "../../project/project";
import { makeTempoMap } from "../../project/tempoMap";
import type { AudioClipInstance, ChannelConfig } from "../../project/types";
import { compileDrumKit, defaultDrumKit } from "../../instruments/drum-rack/drumParams";
import { PIANO_SAMPLE_URLS, noteNameToMidi } from "../../instruments/piano/piano";
import type { InstrumentType } from "../../instruments/registry";

/** The instruments the native engine plays. */
export const NATIVE_INSTRUMENTS: readonly InstrumentType[] = ["piano", "drums"];

/** The shortest a note plays (as the browser's engine, audioEngine.ts). */
const MIN_NOTE_DURATION = 0.05;

export interface NativeClip {
  /** The audio file it plays (sent to the engine under this id). */
  audio: string;
  offset: number;
  length: number;
  sourceOffset: number;
  loopLength: number | null;
  gainDb: number;
  fadeIn: number;
  fadeOut: number;
}

/** A note on the timeline (s). */
export interface NativeNote {
  key: number;
  start: number;
  end: number;
  velocity: number;
}

export type NativeInstrument =
  | { type: "drums"; kit: ReturnType<typeof compileDrumKit>; samples: (string | null)[] }
  | { type: "piano"; samples: { note: number; audio: string }[] };

export interface NativeTrack {
  id: string;
  volumeDb: number;
  pan: number;
  audible: boolean;
  /** The track it feeds, or null for the master. */
  output: string | null;
  sends: { bus: string; db: number }[];
  clips: NativeClip[];
  /** What plays its notes, if the native engine has it. */
  instrument: NativeInstrument | null;
  notes: NativeNote[];
}

/** The ids the engine knows what's played by: a clip's file (or its
 * rendering), a sample pad's file, one of the piano's samples. */
export interface NativeAudioIds {
  clip(clip: AudioClipInstance): string;
  drumSample(fileId: string): string;
  pianoSample(name: string): string;
}

export interface NativeSong {
  tracks: NativeTrack[];
  buses: { id: string }[];
  master: { volumeDb: number; pan: number; limiterDb: number };
  tempo: { beat: number; seconds: number; bpm: number }[];
  beatsPerBar: number;
}

/** What a clip plays: its file, or for a warped clip the rendering of its
 * stretch of the file (which starts at the clip and doesn't loop - the
 * rendering plays its loop out). `audio` names what it plays. */
function nativeClip(clip: AudioClipInstance, audio: string): NativeClip {
  const warped = !!clip.warp;
  return {
    audio,
    offset: clip.offset,
    length: clip.length,
    sourceOffset: warped ? 0 : clip.sourceOffset,
    loopLength: warped ? null : (clip.loopLength ?? null),
    gainDb: clip.gainDb,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
  };
}

function nativeInstrument(channel: ChannelConfig, ids: NativeAudioIds): NativeInstrument | null {
  if (channel.type !== "midi") return null;
  if (channel.instrument === "drums") {
    const kit = channel.drumParams ?? defaultDrumKit();
    return {
      type: "drums",
      kit: compileDrumKit(kit),
      samples: kit.pads.map((p) => (p.source === "sample" && p.sample ? ids.drumSample(p.sample.id) : null)),
    };
  }
  if (channel.instrument === "piano") {
    return {
      type: "piano",
      samples: Object.keys(PIANO_SAMPLE_URLS).map((name) => ({ note: noteNameToMidi(name) ?? 60, audio: ids.pianoSample(name) })),
    };
  }
  return null;
}

/** A MIDI track's notes on the timeline: each clip's, clamped or tiled
 * to its box (as the browser's engine plays them, engineSync.ts). */
function nativeNotes(doc: ProjectState, channel: ChannelConfig): NativeNote[] {
  if (channel.type !== "midi") return [];
  return (doc.clipsByChannel[channel.id] ?? []).flatMap((clip) =>
    clip.kind !== "midi"
      ? []
      : notesWithinClip(clip).flatMap((n) => {
          const key = noteNameToMidi(n.note);
          if (key === null) return [];
          const start = clip.offset + n.time;
          return [{ key, start, end: start + Math.max(n.duration, MIN_NOTE_DURATION), velocity: n.velocity }];
        })
  );
}

export function describeSong(doc: ProjectState, session: { limiterDb: number; beatsPerBar: number }, ids: NativeAudioIds): NativeSong {
  const routes = routeMap(doc.channels);
  const heard = audibleTracks(doc.channels, routes);
  const busIds = new Set(doc.buses.map((b) => b.id));
  return {
    tracks: doc.channels.map((c) => ({
      id: c.id,
      volumeDb: c.volume,
      pan: c.pan,
      audible: heard.has(c.id),
      output: routes.get(c.id) ?? null,
      sends: Object.entries(c.sends ?? {})
        .filter(([bus]) => busIds.has(bus))
        .map(([bus, db]) => ({ bus, db })),
      clips: (doc.clipsByChannel[c.id] ?? []).flatMap((clip) => (clip.kind === "audio" ? [nativeClip(clip, ids.clip(clip))] : [])),
      instrument: nativeInstrument(c, ids),
      notes: nativeNotes(doc, c),
    })),
    buses: doc.buses.map((b) => ({ id: b.id })),
    master: { volumeDb: doc.masterVolume, pan: doc.masterPan, limiterDb: session.limiterDb },
    tempo: makeTempoMap(doc.bpm, doc.tempoChanges).segments.map((s) => ({ beat: s.beat, seconds: s.seconds, bpm: s.bpm })),
    beatsPerBar: session.beatsPerBar,
  };
}

/** What the project uses that the native engine doesn't play yet: the
 * tracks with instruments it doesn't have (MIDI tracks with one), with
 * effects, with automation, and whether the master or a bus has effects. */
export function unsupported(doc: ProjectState): { instruments: string[]; effects: string[]; automation: string[] } {
  const named = (ids: string[]) => doc.channels.filter((c) => ids.includes(c.id)).map((c) => c.name);
  const instruments = doc.channels.filter((c) => c.type === "midi" && c.instrument !== null && !NATIVE_INSTRUMENTS.includes(c.instrument)).map((c) => c.id);
  const effects = doc.channels.filter((c) => (doc.channelEffects[c.id] ?? []).some((fx) => !fx.bypass)).map((c) => c.id);
  const busOrMaster = [
    ...doc.buses.filter((b) => (doc.busEffects[b.id] ?? []).some((fx) => !fx.bypass)).map((b) => b.name),
    ...(doc.masterEffects.some((fx) => !fx.bypass) ? [doc.masterName] : []),
  ];
  const automation = doc.channels.filter((c) => (c.automationLanes ?? []).some((lane) => lane.points.length > 0)).map((c) => c.id);
  return { instruments: named(instruments), effects: [...named(effects), ...busOrMaster], automation: named(automation) };
}
