// The DAW's "document" state - everything undo/redo and save/load need to
// fully reconstruct the project - plus the one function that rebuilds the
// live Tone.js graph from it. Both features share this so there's a single
// definition of "what a project is" and "how to make the engine match it".

import { audioEngine } from "./audioEngine";
import type {
  ChannelConfig,
  ClipInstance,
  MidiClipInstance,
  NoteEvent,
  TimeSignature,
} from "./types";
import type { EffectInstance } from "./effects";
import { quarterNotesPerBar } from "./timeline";

export interface ProjectState {
  channels: ChannelConfig[];
  clipsByChannel: Record<string, ClipInstance[]>;
  channelEffects: Record<string, EffectInstance[]>;
  bpm: number;
  timeSignature: TimeSignature;
  masterVolume: number;
  masterPan: number;
  masterName: string;
}

function isMidiClip(c: ClipInstance): c is MidiClipInstance {
  return c.kind === "midi";
}

/** A MIDI clip's notes clamped to its own length - matches what the clip
 * box visually shows (ClipBlock hides anything at/after `length`), so
 * playback never sounds a note the clip's boundary already hides it
 * behind. Shared by the engine sync below and by Daw.tsx's own rebuild
 * after a live move/resize/edit. */
export function notesWithinClip(clip: MidiClipInstance): NoteEvent[] {
  return clip.notes
    .filter((n) => n.time < clip.length)
    .map((n) => ({ ...n, duration: Math.min(n.duration, clip.length - n.time) }));
}

/**
 * Tears down and fully rebuilds every channel in the audio engine to match
 * `state` - used after an undo/redo jump and after loading a saved project,
 * where the live Tone.js graph needs to end up exactly matching a snapshot
 * rather than being incrementally patched toward it. `registeredIds` is the
 * caller's own bookkeeping set of channel ids currently registered with the
 * engine (Daw.tsx's `registeredChannelIds` ref) - it's cleared and
 * repopulated in place so the caller's regular per-render sync effect keeps
 * seeing accurate state afterward.
 */
export function hydrateEngine(state: ProjectState, registeredIds: Set<string>): void {
  registeredIds.forEach((id) => audioEngine.removeChannel(id));
  registeredIds.clear();

  // Must happen before any clip is scheduled below: Tone.js converts a
  // scheduled note's time to ticks at the moment it's scheduled, using
  // whatever tempo is active right then. Scheduling first and only
  // updating the tempo afterward (e.g. via a React effect that fires on
  // the next render) leaves every note's actual playback position keyed
  // to the OLD tempo, silently drifting once the new tempo takes effect.
  audioEngine.setBpm(state.bpm);
  audioEngine.setTimeSignature(
    quarterNotesPerBar(state.timeSignature.numerator, state.timeSignature.denominator)
  );

  state.channels.forEach((channel) => {
    audioEngine.addChannel(channel.id, channel.type, channel.instrument);
    audioEngine.setVolume(channel.id, channel.volume);
    audioEngine.setPan(channel.id, channel.pan);
    audioEngine.setMute(channel.id, channel.muted);
    audioEngine.setSolo(channel.id, channel.solo);
    registeredIds.add(channel.id);

    (state.channelEffects[channel.id] ?? []).forEach((fx) => {
      audioEngine.addEffect(channel.id, fx.type, fx.id);
      Object.entries(fx.params).forEach(([key, value]) =>
        audioEngine.setEffectParam(channel.id, fx.id, key, value)
      );
    });

    const clips = state.clipsByChannel[channel.id] ?? [];
    if (channel.type === "midi") {
      const flattened = clips
        .filter(isMidiClip)
        .flatMap((clip) => notesWithinClip(clip).map((n) => ({ ...n, time: clip.offset + n.time })));
      audioEngine.setClip(channel.id, flattened, 0);
    } else {
      clips.forEach((clip) => {
        if (clip.kind === "audio") {
          audioEngine.loadAudioClip(channel.id, clip.id, clip.url, clip.offset, clip.length);
        }
      });
    }
  });

  audioEngine.setMasterVolume(state.masterVolume);
  audioEngine.setMasterPan(state.masterPan);
}
