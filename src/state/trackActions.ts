// What you can do to a track: add, remove, rename, recolor, move, its
// fader, pan, mute, solo, arm and instrument, its sends, and its place in
// the routing (groups, Audio To / From) and the view (folded). Each changes
// the project (and the audio engine where it hears about it directly), as
// one undo step where it's an edit. What the view does around it - which
// track is selected, which FX rack is open - stays with the view.

import { audioEngine } from "@/lib/audioEngine";
import type { TrackColorPick } from "@/lib/colors";
import { defaultDrumKit, type DrumKitParams } from "@/lib/drumParams";
import { groupTracks, moveTrack, setTrackGroup, ungroup } from "@/lib/routing";
import { defaultSynthParams } from "@/lib/synth";
import type { SynthParams } from "@/lib/synthParams";
import { track } from "@/lib/telemetry";
import type { ChannelConfig, ChannelType, InstrumentType, TrackInput } from "@/lib/types";
import { createChannel } from "./ids";
import { projectStore } from "./projectStore";

const channels = () => projectStore.get().channels;
const setChannels = (update: (prev: ChannelConfig[]) => ChannelConfig[]) => projectStore.set("channels", update);
const updateTrack = (id: string, change: (c: ChannelConfig) => ChannelConfig) =>
  setChannels((prev) => prev.map((c) => (c.id === id ? change(c) : c)));

/** A copy of `c` without `key` (an optional field set back to its default). */
function without<K extends keyof ChannelConfig>(c: ChannelConfig, key: K): ChannelConfig {
  const copy = { ...c };
  delete copy[key];
  return copy;
}

export const trackActions = {
  /** Adds an empty track at the end ("MIDI 3", "Audio 2", "Group 1"...);
   * returns its id. */
  add(type: ChannelType): string {
    projectStore.push();
    const countOfType = channels().filter((c) => c.type === type).length;
    const name = type === "midi" ? `MIDI ${countOfType + 1}` : type === "audio" ? `Audio ${countOfType + 1}` : `Group ${countOfType + 1}`;
    const channel = createChannel(name, type);
    setChannels((prev) => [...prev, channel]);
    return channel.id;
  },

  /** Removes a track with its clips and effects. Removing a group keeps its
   * tracks (they leave the group). The clips' audio isn't let go of here:
   * the undo step just taken still holds them (projectStore.ts). */
  remove(id: string): void {
    projectStore.push();
    setChannels((prev) => (prev.find((c) => c.id === id)?.type === "group" ? ungroup(prev, id) : prev.filter((c) => c.id !== id)));
    projectStore.set("clipsByChannel", (prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    projectStore.set("channelEffects", (prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  },

  rename(id: string, name: string): void {
    projectStore.push();
    updateTrack(id, (c) => ({ ...c, name }));
  },

  /** A palette slot, or (`color`) any color from the color wheel. */
  recolor(id: string, pick: TrackColorPick): void {
    projectStore.push();
    updateTrack(id, (c) => ("color" in pick ? { ...c, color: pick.color } : { ...without(c, "color"), colorIndex: pick.colorIndex }));
  },

  /** One step up (-1) or down (1): a group moves with its tracks, a track
   * in a group moves within it. Its color goes with it. */
  move(id: string, direction: -1 | 1): void {
    projectStore.push();
    setChannels((prev) => moveTrack(prev, id, direction));
  },

  // Fader and pan: no undo step here - it's taken as the drag starts.
  setVolume(id: string, db: number): void {
    audioEngine.setVolume(id, db);
    updateTrack(id, (c) => ({ ...c, volume: db }));
  },

  setPan(id: string, pan: number): void {
    audioEngine.setPan(id, pan);
    updateTrack(id, (c) => ({ ...c, pan }));
  },

  toggleMute(id: string): void {
    const current = channels().find((c) => c.id === id);
    if (!current) return;
    projectStore.push();
    audioEngine.setMute(id, !current.muted);
    updateTrack(id, (c) => ({ ...c, muted: !current.muted }));
  },

  toggleSolo(id: string): void {
    const current = channels().find((c) => c.id === id);
    if (!current) return;
    projectStore.push();
    audioEngine.setSolo(id, !current.solo);
    updateTrack(id, (c) => ({ ...c, solo: !current.solo }));
  },

  /** Record-arm is exclusive: arming a track disarms the others. A group
   * has nothing to record. Returns whether anything changed. */
  toggleArm(id: string): boolean {
    if (channels().find((c) => c.id === id)?.type === "group") return false;
    projectStore.push();
    setChannels((prev) => prev.map((c) => ({ ...c, armed: c.id === id ? !c.armed : false })));
    return true;
  },

  /** Picks a MIDI track's instrument. The synth starts from its first
   * preset and the Drum Rack from its default kit, the first time; switching
   * away and back keeps what was dialed in. */
  setInstrument(id: string, type: InstrumentType | null): void {
    const current = channels().find((c) => c.id === id);
    if (!current) return;
    projectStore.push();
    const synthParams = type === "synth" ? current.synthParams ?? defaultSynthParams() : current.synthParams;
    const drumParams = type === "drums" ? current.drumParams ?? defaultDrumKit() : current.drumParams;
    audioEngine.setInstrument(id, type, synthParams, drumParams);
    updateTrack(id, (c) => ({ ...c, instrument: type, synthParams, drumParams }));
  },

  // Instrument edits: no undo step here - the windows take one per gesture.
  setDrumKit(id: string, kit: DrumKitParams): void {
    audioEngine.setDrumKit(id, kit);
    updateTrack(id, (c) => ({ ...c, drumParams: kit }));
  },

  setSynthParams(id: string, params: SynthParams): void {
    audioEngine.setSynthParams(id, params);
    updateTrack(id, (c) => ({ ...c, synthParams: params }));
  },

  /** A send's level in dB, or null to remove it. */
  setSend(id: string, busId: string, db: number | null): void {
    audioEngine.setSend(id, busId, db);
    updateTrack(id, (c) => {
      const sends = { ...(c.sends ?? {}) };
      if (db === null) delete sends[busId];
      else sends[busId] = db;
      return { ...c, sends };
    });
  },

  // --- Groups and routing (routing.ts) ---

  /** Puts tracks into a new group, named "Group N", colored like the first
   * of them; returns the group's id (null if none of them can be grouped). */
  group(ids: string[]): string | null {
    const all = channels();
    const members = ids.filter((id) => all.some((c) => c.id === id && c.type !== "group"));
    if (members.length === 0) return null;
    projectStore.push();
    const count = all.filter((c) => c.type === "group").length;
    const group = { ...createChannel(`Group ${count + 1}`, "group"), colorIndex: all.find((c) => c.id === members[0])?.colorIndex ?? 0 };
    setChannels((prev) => groupTracks(prev, members, group));
    track("tracks_grouped");
    return group.id;
  },

  /** Moves a track into a group, or (null) out of its group. */
  setGroup(id: string, groupId: string | null): void {
    projectStore.push();
    setChannels((prev) => setTrackGroup(prev, id, groupId));
  },

  /** Where an audio track's input comes from ("Audio From"): another track
   * at a tap point, or null for the audio interface. */
  setInput(id: string, input: TrackInput | null): void {
    projectStore.push();
    updateTrack(id, (c) => (input ? { ...c, input } : without(c, "input")));
  },

  /** Where a track's audio goes ("Audio To"): a track's id, "master", or
   * null for the default (its group, else the master). */
  setOutput(id: string, output: string | null): void {
    projectStore.push();
    updateTrack(id, (c) => (output ? { ...c, output } : without(c, "output")));
  },

  // --- Folding (a view choice: no undo step) ---

  toggleFold(id: string): void {
    updateTrack(id, (c) => ({ ...c, folded: !c.folded }));
  },

  /** Folds every track to a short row, or unfolds them all; with no
   * argument, folds them unless they all are. */
  foldAll(fold?: boolean): void {
    setChannels((prev) => {
      const next = fold ?? !prev.every((c) => c.folded);
      return prev.map((c) => ({ ...c, folded: next }));
    });
  },
};
