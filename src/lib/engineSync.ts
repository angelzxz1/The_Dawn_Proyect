// Making the live engine match the project. Opening a project builds it
// from scratch (hydrateEngine); undo and redo only change what differs
// between the two versions (syncEngine). A NAM amp, an IR or a sampled kit
// that undo didn't touch keeps playing, with no reload, gap or click.
//
// The project store makes new objects only for what changed and shares
// everything else between versions, so "did this change?" is a reference
// comparison.

import type { audioEngine } from "./audioEngine";
import type { AudioClipTiming } from "./engine/nodes";
import type { EffectInstance } from "../effects/registry";
import { notesWithinClip, type ProjectState } from "./project";
import { quarterNotesPerBar } from "./timeline";
import type { AudioClipInstance, ChannelConfig, ClipInstance, MidiClipInstance, NoteEvent } from "./types";

/** The engine calls the sync makes (the real engine, or a test's fake). */
export type EngineApi = Pick<
  typeof audioEngine,
  | "addChannel"
  | "removeChannel"
  | "setInstrument"
  | "setSynthParams"
  | "setDrumKit"
  | "setVolume"
  | "setPan"
  | "setMute"
  | "setSolo"
  | "setSend"
  | "setAutomation"
  | "setClip"
  | "loadAudioClip"
  | "moveAudioClip"
  | "setAudioClipGain"
  | "removeAudioClip"
  | "addBus"
  | "removeBus"
  | "resetEffects"
  | "addEffect"
  | "removeEffect"
  | "moveEffect"
  | "setEffectParam"
  | "setEffectBypass"
  | "setEffectFile"
  | "setEffectSidechain"
  | "setMasterVolume"
  | "setMasterPan"
  | "setBpm"
  | "setTimeSignature"
>;

const isMidiClip = (c: ClipInstance): c is MidiClipInstance => c.kind === "midi";

// What a host without effects or a track without clips has, the same
// array each time so it never reads as a change.
const NO_EFFECTS: EffectInstance[] = [];
const NO_CLIPS: ClipInstance[] = [];

/** A MIDI track's clips as the one note list the engine plays (each clip's
 * notes shifted by its offset, clamped or tiled to its box). */
export function midiTimeline(clips: ClipInstance[]): NoteEvent[] {
  return clips.filter(isMidiClip).flatMap((clip) => notesWithinClip(clip).map((n) => ({ ...n, time: clip.offset + n.time })));
}

/** The engine's timing for an audio clip, from the clip's own fields. */
export function audioClipTiming(clip: AudioClipInstance): AudioClipTiming {
  return {
    offsetSeconds: clip.offset,
    bufferOffsetSeconds: clip.sourceOffset,
    trimSeconds: clip.length,
    loopLength: clip.loopLength,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
  };
}

// --- Effects chains ---

function applyEffect(engine: EngineApi, host: string, fx: EffectInstance, before?: EffectInstance): void {
  Object.entries(fx.params).forEach(([key, value]) => {
    if (!before || before.params[key] !== value) engine.setEffectParam(host, fx.id, key, value);
  });
  if (!!fx.bypass !== !!before?.bypass) engine.setEffectBypass(host, fx.id, !!fx.bypass);
  if ((fx.file?.id ?? null) !== (before?.file?.id ?? null)) void engine.setEffectFile(host, fx.id, fx.file?.id ?? null);
  if (JSON.stringify(fx.sidechain) !== JSON.stringify(before?.sidechain)) engine.setEffectSidechain(host, fx.id, fx.sidechain);
}

/** Turns a host's chain from `prev` into `next`: removes and adds only the
 * effects that came or went, moves the ones that changed place, and sets
 * only the params that differ. */
function syncEffects(engine: EngineApi, host: string, prev: EffectInstance[], next: EffectInstance[]): void {
  if (prev === next) return;
  const before = new Map(prev.map((fx) => [fx.id, fx]));
  const kept = (fx: EffectInstance) => before.get(fx.id)?.type === fx.type;
  const stays = new Set(next.filter(kept).map((fx) => fx.id));
  // The engine's chain as it goes, to know what has to move.
  const order = prev.map((fx) => fx.id).filter((id) => {
    if (stays.has(id)) return true;
    engine.removeEffect(host, id);
    return false;
  });
  next.forEach((fx, i) => {
    if (stays.has(fx.id)) return;
    engine.addEffect(host, fx.type, fx.id, Math.min(i, order.length));
    order.splice(Math.min(i, order.length), 0, fx.id);
    applyEffect(engine, host, fx);
  });
  next.forEach((fx, i) => {
    if (order[i] !== fx.id) {
      engine.moveEffect(host, fx.id, i);
      order.splice(order.indexOf(fx.id), 1);
      order.splice(i, 0, fx.id);
    }
    const old = before.get(fx.id);
    if (stays.has(fx.id) && old !== fx) applyEffect(engine, host, fx, old);
  });
}

// --- Tracks ---

function addTrack(engine: EngineApi, state: ProjectState, channel: ChannelConfig): void {
  engine.addChannel(channel.id, channel.type, channel.instrument, channel.synthParams, channel.drumParams);
  engine.setVolume(channel.id, channel.volume);
  engine.setPan(channel.id, channel.pan);
  engine.setMute(channel.id, channel.muted);
  engine.setSolo(channel.id, channel.solo);
  syncEffects(engine, channel.id, [], state.channelEffects[channel.id] ?? NO_EFFECTS);
  Object.entries(channel.sends ?? {}).forEach(([busId, db]) => engine.setSend(channel.id, busId, db));
  engine.setAutomation(channel.id, channel.automationLanes ?? []);
  syncClips(engine, channel, [], state.clipsByChannel[channel.id] ?? NO_CLIPS);
}

function syncTrack(engine: EngineApi, prev: ChannelConfig, next: ChannelConfig): void {
  if (prev === next) return;
  const id = next.id;
  if (prev.instrument !== next.instrument) {
    engine.setInstrument(id, next.instrument, next.synthParams, next.drumParams);
  } else {
    if (next.synthParams && prev.synthParams !== next.synthParams) engine.setSynthParams(id, next.synthParams);
    if (next.drumParams && prev.drumParams !== next.drumParams) engine.setDrumKit(id, next.drumParams);
  }
  if (prev.volume !== next.volume) engine.setVolume(id, next.volume);
  if (prev.pan !== next.pan) engine.setPan(id, next.pan);
  if (prev.muted !== next.muted) engine.setMute(id, next.muted);
  if (prev.solo !== next.solo) engine.setSolo(id, next.solo);
  if (prev.sends !== next.sends) {
    const buses = new Set([...Object.keys(prev.sends ?? {}), ...Object.keys(next.sends ?? {})]);
    buses.forEach((busId) => {
      const db = next.sends?.[busId] ?? null;
      if (db !== (prev.sends?.[busId] ?? null)) engine.setSend(id, busId, db);
    });
  }
  if (prev.automationLanes !== next.automationLanes) engine.setAutomation(id, next.automationLanes ?? []);
}

function syncClips(engine: EngineApi, channel: ChannelConfig, prev: ClipInstance[], next: ClipInstance[]): void {
  if (prev === next) return;
  if (channel.type === "midi") {
    engine.setClip(channel.id, midiTimeline(next), 0);
    return;
  }
  if (channel.type !== "audio") return;
  const before = new Map(prev.map((c) => [c.id, c]));
  const ids = new Set(next.map((c) => c.id));
  prev.forEach((c) => {
    if (!ids.has(c.id)) engine.removeAudioClip(channel.id, c.id);
  });
  next.forEach((clip) => {
    if (clip.kind !== "audio") return;
    const old = before.get(clip.id);
    if (old === clip) return;
    if (!old || old.kind !== "audio" || old.url !== clip.url) {
      engine.loadAudioClip(channel.id, clip.id, clip.url, audioClipTiming(clip), clip.gainDb);
      return;
    }
    const timing = audioClipTiming(clip);
    if (JSON.stringify(timing) !== JSON.stringify(audioClipTiming(old))) engine.moveAudioClip(channel.id, clip.id, timing);
    if (old.gainDb !== clip.gainDb) engine.setAudioClipGain(channel.id, clip.id, clip.gainDb);
  });
}

/** Builds the engine from scratch for a project that was just opened.
 * `registeredIds` is the studio's record of which tracks the engine has;
 * it's refilled to match. */
export function hydrateEngine(state: ProjectState, registeredIds: Set<string>, engine: EngineApi): void {
  registeredIds.forEach((id) => engine.removeChannel(id));
  registeredIds.clear();
  // The tempo first: Tone fixes a scheduled note's place at the tempo of
  // the moment it's scheduled.
  engine.setBpm(state.bpm);
  engine.setTimeSignature(quarterNotesPerBar(state.timeSignature.numerator, state.timeSignature.denominator));
  state.buses.forEach((bus) => {
    engine.addBus(bus.id);
    // Buses and the master outlive a hydrate (tracks don't): clear their
    // chains before adding the project's.
    engine.resetEffects(bus.id);
    syncEffects(engine, bus.id, [], state.busEffects[bus.id] ?? NO_EFFECTS);
  });
  state.channels.forEach((channel) => {
    addTrack(engine, state, channel);
    registeredIds.add(channel.id);
  });
  engine.setMasterVolume(state.masterVolume);
  engine.setMasterPan(state.masterPan);
  engine.resetEffects("master");
  syncEffects(engine, "master", [], state.masterEffects);
}

/** Moves the engine from `prev` to `next` (undo, redo), changing only what
 * differs. A tempo change rescales every clip, so it rebuilds it all. */
export function syncEngine(prev: ProjectState, next: ProjectState, registeredIds: Set<string>, engine: EngineApi): void {
  if (prev === next) return;
  if (prev.bpm !== next.bpm || prev.timeSignature !== next.timeSignature) {
    hydrateEngine(next, registeredIds, engine);
    return;
  }

  // Buses first: tracks' sends need them.
  const prevBuses = new Set(prev.buses.map((b) => b.id));
  const nextBuses = new Set(next.buses.map((b) => b.id));
  next.buses.forEach((bus) => {
    if (!prevBuses.has(bus.id)) engine.addBus(bus.id);
    syncEffects(engine, bus.id, prevBuses.has(bus.id) ? prev.busEffects[bus.id] ?? NO_EFFECTS : NO_EFFECTS, next.busEffects[bus.id] ?? NO_EFFECTS);
  });

  const before = new Map(prev.channels.map((c) => [c.id, c]));
  const nextIds = new Set(next.channels.map((c) => c.id));
  prev.channels.forEach((c) => {
    if (nextIds.has(c.id)) return;
    engine.removeChannel(c.id);
    registeredIds.delete(c.id);
  });
  next.channels.forEach((channel) => {
    const old = before.get(channel.id);
    if (old && old.type !== channel.type) engine.removeChannel(channel.id);
    if (!old || old.type !== channel.type || !registeredIds.has(channel.id)) {
      addTrack(engine, next, channel);
      registeredIds.add(channel.id);
      return;
    }
    syncTrack(engine, old, channel);
    syncEffects(engine, channel.id, prev.channelEffects[channel.id] ?? NO_EFFECTS, next.channelEffects[channel.id] ?? NO_EFFECTS);
    syncClips(engine, channel, prev.clipsByChannel[channel.id] ?? NO_CLIPS, next.clipsByChannel[channel.id] ?? NO_CLIPS);
  });

  prev.buses.forEach((bus) => {
    if (!nextBuses.has(bus.id)) engine.removeBus(bus.id);
  });

  if (prev.masterVolume !== next.masterVolume) engine.setMasterVolume(next.masterVolume);
  if (prev.masterPan !== next.masterPan) engine.setMasterPan(next.masterPan);
  syncEffects(engine, "master", prev.masterEffects, next.masterEffects);
}
