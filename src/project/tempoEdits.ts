// Keeping the song on its beats when the tempo map changes (tempoMap.ts).
// What follows the beat moves with it: MIDI clips and their notes, warped
// audio clips (warp.ts), takes, and the automation on tracks that aren't
// audio. Unwarped audio isn't stretched, so (like in most DAWs) it keeps
// its place in seconds - and so does the automation on audio tracks, which
// stays with the audio it shapes. Pure: what doesn't move is returned as
// it was, so the engine's diff (engineSync.ts) leaves it alone.

import type { ProjectState } from "./project";
import { beatAtSeconds, remapSeconds, secondsAtBeat, type TempoMap } from "./tempoMap";
import { remapWarped } from "./warp";
import type { AudioClipInstance, AutomationLane, ChannelConfig, ClipInstance, MidiClipInstance, NoteEvent, TakeLane } from "./types";

/** Whether two maps put every beat in the same place. */
export function sameTempo(a: TempoMap, b: TempoMap): boolean {
  return (
    a.segments.length === b.segments.length &&
    a.segments.every((s, i) => Math.abs(s.beat - b.segments[i].beat) < 1e-9 && Math.abs(s.bpm - b.segments[i].bpm) < 1e-9)
  );
}

/** How long `beats` beats last from `start` (s). */
export function secondsForBeats(tempo: TempoMap, start: number, beats: number): number {
  return secondsAtBeat(tempo, beatAtSeconds(tempo, start) + beats) - start;
}

/** Notes timed in beats from `start` (s) - a MIDI file's, a groove's - as
 * a clip's there: in seconds from `start`, following the tempo map. */
export function notesAtBeats(notes: readonly NoteEvent[], tempo: TempoMap, start: number): NoteEvent[] {
  const from = beatAtSeconds(tempo, start);
  return notes.map((n) => {
    const on = secondsAtBeat(tempo, from + n.time);
    return { ...n, time: on - start, duration: secondsAtBeat(tempo, from + n.time + n.duration) - on };
  });
}

/** A MIDI clip moved from one map to another: its box, its notes and its
 * loop stay on their beats. (The same clip when nothing in it moves.) */
export function remapMidiClip(clip: MidiClipInstance, from: TempoMap, to: TempoMap): MidiClipInstance {
  let moved = false;
  // Clip-relative times to where they go on the timeline; ones that stay
  // (before the first change edited) keep their exact value.
  const at = (t: number) => {
    const was = clip.offset + t;
    const now = remapSeconds(was, from, to);
    if (Math.abs(now - was) < 1e-9) return was;
    moved = true;
    return now;
  };
  const offset = at(0);
  const length = at(clip.length) - offset;
  const loopLength = clip.loopLength ? at(clip.loopLength) - offset : clip.loopLength;
  const notes = clip.notes.map((n) => {
    const on = at(n.time);
    return { ...n, time: on - offset, duration: at(n.time + n.duration) - on };
  });
  return moved ? { ...clip, offset, length, loopLength, notes } : clip;
}

/** A warped audio clip on its beats on the new map (the same clip when it
 * doesn't move); an unwarped one stays. */
function remapAudioClip(clip: AudioClipInstance, from: TempoMap, to: TempoMap): AudioClipInstance {
  if (!clip.warp) return clip;
  const at = (t: number) => {
    const now = remapSeconds(t, from, to);
    return Math.abs(now - t) < 1e-9 ? t : now;
  };
  const next = remapWarped(clip, at);
  return next.offset === clip.offset && next.length === clip.length && next.loopLength === clip.loopLength ? clip : next;
}

function remapClips(clips: ClipInstance[], from: TempoMap, to: TempoMap): ClipInstance[] {
  const next = clips.map((c) => (c.kind === "midi" ? remapMidiClip(c, from, to) : remapAudioClip(c, from, to)));
  return next.every((c, i) => c === clips[i]) ? clips : next;
}

function remapLanes(lanes: AutomationLane[], from: TempoMap, to: TempoMap): AutomationLane[] {
  const next = lanes.map((lane) => {
    const points = lane.points.map((p) => {
      const time = Math.max(0, remapSeconds(p.time, from, to));
      return Math.abs(time - p.time) < 1e-9 ? p : { ...p, time };
    });
    return points.every((p, i) => p === lane.points[i]) ? lane : { ...lane, points };
  });
  return next.every((l, i) => l === lanes[i]) ? lanes : next;
}

type Retimed = Pick<ProjectState, "channels" | "clipsByChannel" | "takesByChannel">;

/** The project's tracks, clips and takes moved from one tempo map to
 * another. */
export function retimeProject(state: Retimed, from: TempoMap, to: TempoMap): Retimed {
  if (sameTempo(from, to)) return state;
  const channels = state.channels.map((c): ChannelConfig => {
    if (c.type === "audio" || !c.automationLanes?.length) return c;
    const automationLanes = remapLanes(c.automationLanes, from, to);
    return automationLanes === c.automationLanes ? c : { ...c, automationLanes };
  });
  const clipsByChannel = Object.fromEntries(Object.entries(state.clipsByChannel).map(([id, clips]) => [id, remapClips(clips, from, to)]));
  const takesByChannel = Object.fromEntries(
    Object.entries(state.takesByChannel).map(([id, lanes]): [string, TakeLane[]] => {
      const next = lanes.map((l) => {
        const clips = remapClips(l.clips, from, to);
        return clips === l.clips ? l : { ...l, clips };
      });
      return [id, next.every((l, i) => l === lanes[i]) ? lanes : next];
    })
  );
  return { channels, clipsByChannel, takesByChannel };
}
