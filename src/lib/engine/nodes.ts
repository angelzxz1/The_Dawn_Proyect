// The live engine's node bundles: what a track, a bus and an effect are
// made of, and where they can be tapped.

import * as Tone from "tone";
import type { NoteEvent, InstrumentType, ChannelType } from "../types";
import { type Instrument } from "../../instruments/instrument";
import { type EffectType } from "../../effects/registry";
import type { SidechainRouting } from "../../effects/sidechain/sidechainModel";

/** Longest delay compensation can add to one path (s). */
export const MAX_COMPENSATION = 2;

export interface EffectNode {
  id: string;
  type: EffectType;
  node: Tone.ToneAudioNode;
  /** Skipped when wiring the chain (as if unplugged) while true. */
  bypass: boolean;
  /** The effect file most recently asked for (see setEffectFile) - a slow
   * decode that finishes after a newer request is ignored. */
  fileId?: string | null;
  /** Where its detector listens (dynamics effects only). */
  sidechain?: SidechainRouting;
}

/** A dynamics effect's node that can take a key signal. */
export interface SidechainNode {
  sidechainInput: Tone.Gain;
  setSidechainActive(on: boolean): void;
}

export function isSidechainNode(node: Tone.ToneAudioNode): node is Tone.ToneAudioNode & SidechainNode {
  return "sidechainInput" in node && "setSidechainActive" in node;
}

/** Where a track's or bus's audio can be tapped for a sidechain: before
 * its effects, after them, after its fader. Fixed for its lifetime, so
 * keys stay connected while its chain is rewired. */
export interface SidechainTaps {
  preFx: Tone.Gain;
  postFx: Tone.Gain;
  postFader: Tone.Gain;
}

/** Common shape shared by a track channel and a bus's own effects rack, so
 * one generic set of add/remove/reorder/bypass/param methods can drive
 * either. */
export interface EffectsHost {
  effects: EffectNode[];
}

export interface ChannelNodes extends EffectsHost {
  channel: Tone.Channel;
  /** Its sources feed `taps.preFx`, which feeds `head`, the start of the
   * effects chain (rewiring only ever disconnects `head`, so keys taken
   * from the taps stay connected); the chain ends in `taps.postFx`, which
   * feeds `pdc`. */
  taps: SidechainTaps;
  head: Tone.Gain;
  meter: Tone.Meter;
  /** Fixed for the channel's lifetime - decides whether the instrument or
   * the audio player feeds the effects chain. */
  channelType: ChannelType;
  instrumentType: InstrumentType | null;
  instrument: Instrument;
  part: Tone.Part<NoteEvent> | null;
  /** Notes currently held down live (not yet released), keyed by note name. */
  heldNotes: Set<string>;
  /** An audio channel can hold several independent clips at once - each
   * clip gets its own Player (the decoded source plus its playback window)
   * and a Volume node for its per-clip gain, permanently wired in series
   * (player -> gain) and keyed by clip instance id. */
  audioClips: Map<string, { player: Tone.Player; gain: Tone.Volume }>;
  /** One send-level Gain per bus this channel currently sends to, tapped
   * from `channel`'s output (post-fader) and feeding straight into that
   * bus's input - independent of the dry signal, which always keeps going
   * to master regardless of any sends. */
  sends: Map<string, Tone.Gain>;
  /** The user's own mute button state (solo can silence a track too). */
  userMuted: boolean;
  /** Mutes the strip (the user's mute, or another track's solo), between
   * the delay compensation and the fader. Kept apart from the fader
   * because Tone.Channel's own mute is just its volume at -Infinity, which
   * any volume change (the fader, automation) would undo. */
  muteGain: Tone.Gain;
  /** Whether `muteGain` is open. */
  audible: boolean;
  /** Delay compensation: between the effects chain and the strip (see
   * latency.ts). */
  pdc: Tone.Delay;
  /** Audio from other tracks routed into this one (a group's members, or
   * tracks choosing it as their output): straight into its effects. */
  routeIn: Tone.Gain;
  /** The track's own sources go through this, so they wait for the audio
   * routed in (delay compensation). */
  ownDelay: Tone.Delay;
  /** Sends leave the strip through this (delay compensation). */
  sendTap: Tone.Delay;
  /** Where the strip's dry output goes: through the shared direct-path
   * delay, straight to the master (a live track skipping compensation),
   * or into another track ("to:" + its id). */
  route: string | null;
}

/** A send/return bus - like a track channel's effects rack, but fed by
 * other channels' sends instead of an instrument or audio clips. `input` is
 * a stable tap point sends connect to, decoupled from the effects chain
 * itself so reordering/adding/removing an effect never has to re-find every
 * sending channel's connection. */
export interface BusNodes extends EffectsHost {
  input: Tone.Gain;
  /** preFx is `input` itself, feeding `head` (see ChannelNodes). */
  taps: SidechainTaps;
  head: Tone.Gain;
  channel: Tone.Channel;
  meter: Tone.Meter;
  /** Delay compensation, between the effects chain and the strip. */
  pdc: Tone.Delay;
}

export interface AudioClipTiming {
  /** Where the clip starts on the arrangement timeline, in seconds. */
  offsetSeconds: number;
  /** Where within the source buffer this clip's content starts, in
   * seconds - lets a clip play a sub-region of a longer source file (e.g.
   * after splitting a clip in two). Defaults to 0. */
  bufferOffsetSeconds?: number;
  /** How long the clip plays for, in seconds (the box's length). */
  trimSeconds?: number;
  /** When set and > 0, the [bufferOffsetSeconds, bufferOffsetSeconds +
   * loopLength) region repeats to fill `trimSeconds`, instead of playing
   * through once and stopping. */
  loopLength?: number | null;
  fadeIn?: number;
  fadeOut?: number;
}
