// The song as the desktop app's native engine takes it
// (src-tauri/src/audio/song.rs): every track with its level, pan, whether
// it's heard (mute and solo, worked out as the browser's engine does,
// mixGraph.ts), where it goes, its sends and its audio clips; the buses;
// the master; the tempo map. The engine only renders what it's told. Pure.
//
// So far the native engine plays audio clips through the mix: instruments,
// effects and automation aren't in it yet (unsupported() names what a
// project uses of them).

import { audibleTracks } from "../mixGraph";
import { routeMap } from "../routing";
import type { ProjectState } from "../../project/project";
import { makeTempoMap } from "../../project/tempoMap";
import type { AudioClipInstance } from "../../project/types";

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

export interface NativeTrack {
  id: string;
  volumeDb: number;
  pan: number;
  audible: boolean;
  /** The track it feeds, or null for the master. */
  output: string | null;
  sends: { bus: string; db: number }[];
  clips: NativeClip[];
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
 * rendering plays its loop out). `audioIdOf` names the audio it plays. */
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

export function describeSong(
  doc: ProjectState,
  session: { limiterDb: number; beatsPerBar: number },
  audioIdOf: (clip: AudioClipInstance) => string
): NativeSong {
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
      clips: (doc.clipsByChannel[c.id] ?? []).flatMap((clip) => (clip.kind === "audio" ? [nativeClip(clip, audioIdOf(clip))] : [])),
    })),
    buses: doc.buses.map((b) => ({ id: b.id })),
    master: { volumeDb: doc.masterVolume, pan: doc.masterPan, limiterDb: session.limiterDb },
    tempo: makeTempoMap(doc.bpm, doc.tempoChanges).segments.map((s) => ({ beat: s.beat, seconds: s.seconds, bpm: s.bpm })),
    beatsPerBar: session.beatsPerBar,
  };
}

/** What the project uses that the native engine doesn't play yet: the
 * tracks with instruments (MIDI tracks with notes), with effects, with
 * automation, and whether the master or a bus has effects. */
export function unsupported(doc: ProjectState): { instruments: string[]; effects: string[]; automation: string[] } {
  const named = (ids: string[]) => doc.channels.filter((c) => ids.includes(c.id)).map((c) => c.name);
  const instruments = doc.channels
    .filter((c) => c.type === "midi" && (doc.clipsByChannel[c.id] ?? []).some((clip) => clip.kind === "midi" && clip.notes.length > 0))
    .map((c) => c.id);
  const effects = doc.channels.filter((c) => (doc.channelEffects[c.id] ?? []).some((fx) => !fx.bypass)).map((c) => c.id);
  const busOrMaster = [
    ...doc.buses.filter((b) => (doc.busEffects[b.id] ?? []).some((fx) => !fx.bypass)).map((b) => b.name),
    ...(doc.masterEffects.some((fx) => !fx.bypass) ? [doc.masterName] : []),
  ];
  const automation = doc.channels.filter((c) => (c.automationLanes ?? []).some((lane) => lane.points.length > 0)).map((c) => c.id);
  return { instruments: named(instruments), effects: [...named(effects), ...busOrMaster], automation: named(automation) };
}
