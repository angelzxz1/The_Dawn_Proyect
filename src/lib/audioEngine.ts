import * as Tone from "tone";

// Every live-triggered note (a keyboard/MIDI-controller key, a drum pad)
// goes out via Tone.now(), which Tone.js defines as `currentTime +
// context.lookAhead` - a deliberate scheduling safety margin meant for
// Transport-driven playback, not live input. Its 100ms default was the
// actual source of the noticeable keypress-to-sound delay (not a bug in
// how notes are triggered here - they already go out immediately, via
// Tone.now(), with no debounce/setTimeout in the way). Trimming it to
// 10ms keeps enough margin that sequenced clip/automation playback still
// schedules safely, while cutting live playing latency by ~90ms.
if (typeof window !== "undefined") {
  Tone.getContext().lookAhead = 0.01;
}

import type {
  NoteEvent,
  InstrumentType,
  ChannelType,
  SynthParams,
  AutomationLane,
} from "./types";
import { PIANO_SAMPLE_BASE_URL, PIANO_SAMPLE_URLS } from "./piano";
import { DrumKit, NullInstrument, type Instrument } from "./drumKit";
import { SynthInstrument, defaultSynthParams } from "./synth";
import { type EffectType, autoMakeupDb, defaultParams } from "./effects";

/** Linearly interpolates an automation lane's value at time `t` - flat
 * before the first point and after the last, matching how the lane's UI
 * draws the curve. Points must be sorted by `time`. */
function interpolateAutomation(
  points: { time: number; value: number }[],
  t: number
): number | null {
  if (points.length === 0) return null;
  if (points.length === 1 || t <= points[0].time) return points[0].value;
  const last = points[points.length - 1];
  if (t >= last.time) return last.value;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (t >= a.time && t <= b.time) {
      const ratio = (t - a.time) / (b.time - a.time || 1);
      return a.value + (b.value - a.value) * ratio;
    }
  }
  return last.value;
}

interface EffectNode {
  id: string;
  type: EffectType;
  node: Tone.ToneAudioNode;
  /** Skipped when wiring the chain (as if unplugged) while true. */
  bypass: boolean;
}

/** Common shape shared by a track channel and a bus's own effects rack, so
 * one generic set of add/remove/reorder/bypass/param methods can drive
 * either. */
interface EffectsHost {
  effects: EffectNode[];
}

interface ChannelNodes extends EffectsHost {
  channel: Tone.Channel;
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
}

/** A send/return bus - like a track channel's effects rack, but fed by
 * other channels' sends instead of an instrument or audio clips. `input` is
 * a stable tap point sends connect to, decoupled from the effects chain
 * itself so reordering/adding/removing an effect never has to re-find every
 * sending channel's connection. */
interface BusNodes extends EffectsHost {
  input: Tone.Gain;
  channel: Tone.Channel;
  meter: Tone.Meter;
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

interface RecordingState {
  channelId: string;
  /** Notes currently down during the recording, keyed by note name. */
  open: Map<string, { time: number; velocity: number }>;
  events: NoteEvent[];
}

const MIN_NOTE_DURATION = 0.05;
let effectIdCounter = 0;

/** After restoring effects with explicit ids (loading a saved project), makes
 * sure the next auto-generated id can't collide with one that was just
 * restored. */
export function bumpEffectIdCounter(atLeast: number): void {
  effectIdCounter = Math.max(effectIdCounter, atLeast);
}

export function createInstrument(
  type: InstrumentType | null,
  onSettled: () => void,
  synthParams?: SynthParams
): Instrument {
  if (type === null) {
    queueMicrotask(onSettled);
    return new NullInstrument();
  }
  if (type === "drums") {
    // Synth-built, so it's "ready" the instant it's constructed.
    queueMicrotask(onSettled);
    return new DrumKit();
  }
  if (type === "synth") {
    // Synth-built too - no samples to wait on.
    queueMicrotask(onSettled);
    return new SynthInstrument(synthParams ?? defaultSynthParams());
  }
  return new Tone.Sampler({
    urls: PIANO_SAMPLE_URLS,
    baseUrl: PIANO_SAMPLE_BASE_URL,
    release: 1,
    attack: 0,
    onload: onSettled,
    onerror: onSettled,
  });
}

/** Maps the filter effect's single 0..1 "Type" knob onto Tone.Filter's
 * discrete filter types, so the generic number-only ValueBar UI can still
 * drive it: 0 = lowpass, 0.5 = highpass, 1 = bandpass. */
function filterTypeFromKnob(v: number): BiquadFilterType {
  if (v < 0.33) return "lowpass";
  if (v < 0.67) return "highpass";
  return "bandpass";
}

/** A Tone.Compressor plus everything the custom Compressor plugin UI needs
 * that Tone.Compressor doesn't provide on its own: automatic (or manual)
 * makeup gain, a dry/wet blend for parallel compression, a final output
 * trim, and input/gain-reduction/output metering for the live meters in the
 * full window. Exposed as a single `Tone.ToneAudioNode` (its `input`/
 * `output` are its own boundary nodes) so it drops straight into the
 * existing effects-chain wiring (`wireEffectsChain` only ever calls
 * `.connect()`/`.disconnect()`/`.dispose()` on an effect's node) without the
 * engine needing to know it's actually several nodes internally. */
class CompressorChain extends Tone.ToneAudioNode {
  readonly name = "CompressorChain";
  readonly input: Tone.Gain;
  readonly output: Tone.Gain;
  readonly compressor: Tone.Compressor;
  private readonly makeupGain: Tone.Volume;
  private readonly dryGain: Tone.Gain;
  private readonly wetGain: Tone.Gain;
  private readonly outputTrim: Tone.Volume;
  private readonly inputMeter: Tone.Meter;
  private readonly outputMeter: Tone.Meter;
  private manualMakeup: number;
  private autoMakeup: boolean;

  constructor(params: Record<string, number>) {
    super();
    this.input = new Tone.Gain();
    this.output = new Tone.Gain();
    this.compressor = new Tone.Compressor({
      threshold: params.threshold,
      ratio: params.ratio,
      attack: params.attack,
      release: params.release,
      knee: params.knee,
    });
    this.makeupGain = new Tone.Volume(0);
    this.dryGain = new Tone.Gain(1 - params.dryWet);
    this.wetGain = new Tone.Gain(params.dryWet);
    this.outputTrim = new Tone.Volume(params.output);
    this.inputMeter = new Tone.Meter({ normalRange: false, smoothing: 0.6 });
    this.outputMeter = new Tone.Meter({ normalRange: false, smoothing: 0.6 });
    this.manualMakeup = params.makeup;
    this.autoMakeup = params.makeupAuto >= 0.5;

    this.input.connect(this.inputMeter);
    this.input.connect(this.dryGain);
    this.input.connect(this.compressor);
    this.compressor.connect(this.makeupGain);
    this.makeupGain.connect(this.wetGain);
    this.dryGain.connect(this.outputTrim);
    this.wetGain.connect(this.outputTrim);
    this.outputTrim.connect(this.output);
    // Tapped off `outputTrim`, one node before the `output` boundary, not
    // off `output` itself: the shared effects-chain wiring disconnects and
    // reconnects every effect's `output` boundary on every add/remove/
    // reorder/bypass (`wireEffectsChain`'s `e.node.disconnect()` resolves
    // through that same boundary and clears ALL of its outgoing native
    // connections, this tap included) - tapping a node earlier keeps this
    // meter alive across the chain's own rewiring instead of only ever
    // measuring the instant right after construction.
    this.outputTrim.connect(this.outputMeter);

    this.refreshMakeup();
  }

  setThreshold(v: number): void {
    this.compressor.threshold.value = v;
    this.refreshMakeup();
  }

  setRatio(v: number): void {
    this.compressor.ratio.value = v;
    this.refreshMakeup();
  }

  setManualMakeup(v: number): void {
    this.manualMakeup = v;
    this.refreshMakeup();
  }

  setAutoMakeup(auto: boolean): void {
    this.autoMakeup = auto;
    this.refreshMakeup();
  }

  setDryWet(mix: number): void {
    this.dryGain.gain.value = 1 - mix;
    this.wetGain.gain.value = mix;
  }

  setOutput(db: number): void {
    this.outputTrim.volume.value = db;
  }

  private refreshMakeup(): void {
    const threshold = this.compressor.threshold.value;
    const ratio = this.compressor.ratio.value;
    this.makeupGain.volume.value = this.autoMakeup ? autoMakeupDb(threshold, ratio) : this.manualMakeup;
  }

  /** Current gain reduction, in dB (always <= 0; 0 = no reduction). */
  get reductionDb(): number {
    return this.compressor.reduction;
  }

  get inputDb(): number {
    const v = this.inputMeter.getValue();
    const n = Array.isArray(v) ? v[0] : v;
    return Number.isFinite(n) ? n : -Infinity;
  }

  get outputDb(): number {
    const v = this.outputMeter.getValue();
    const n = Array.isArray(v) ? v[0] : v;
    return Number.isFinite(n) ? n : -Infinity;
  }

  dispose(): this {
    super.dispose();
    this.compressor.dispose();
    this.makeupGain.dispose();
    this.dryGain.dispose();
    this.wetGain.dispose();
    this.outputTrim.dispose();
    this.inputMeter.dispose();
    this.outputMeter.dispose();
    this.input.dispose();
    this.output.dispose();
    return this;
  }
}

export function createEffectNode(type: EffectType, params: Record<string, number>): Tone.ToneAudioNode {
  switch (type) {
    case "eq3":
      return new Tone.EQ3({
        low: params.low,
        mid: params.mid,
        high: params.high,
        lowFrequency: params.lowFrequency,
        highFrequency: params.highFrequency,
      });
    case "compressor":
      return new CompressorChain(params);
    case "delay":
      return new Tone.FeedbackDelay({
        delayTime: params.delayTime,
        feedback: params.feedback,
        wet: params.wet,
      });
    case "reverb":
      return new Tone.Reverb({ decay: params.decay, wet: params.wet });
    case "chorus":
      return new Tone.Chorus({
        frequency: params.frequency,
        delayTime: params.delayTime,
        depth: params.depth,
        wet: params.wet,
      }).start();
    case "distortion":
      return new Tone.Distortion({ distortion: params.distortion, wet: params.wet });
    case "filter":
      return new Tone.Filter({
        frequency: params.frequency,
        Q: params.Q,
        type: filterTypeFromKnob(params.type),
      });
    case "limiter":
      return new Tone.Limiter(params.threshold);
    case "pitchShift":
      return new Tone.PitchShift({ pitch: params.pitch, wet: params.wet });
  }
}

export function applyEffectParam(
  node: Tone.ToneAudioNode,
  type: EffectType,
  key: string,
  value: number
): void {
  switch (type) {
    case "eq3": {
      const eq = node as Tone.EQ3;
      if (key === "low") eq.low.value = value;
      else if (key === "mid") eq.mid.value = value;
      else if (key === "high") eq.high.value = value;
      else if (key === "lowFrequency") eq.lowFrequency.value = value;
      else if (key === "highFrequency") eq.highFrequency.value = value;
      break;
    }
    case "compressor": {
      const comp = node as CompressorChain;
      if (key === "threshold") comp.setThreshold(value);
      else if (key === "ratio") comp.setRatio(value);
      else if (key === "attack") comp.compressor.attack.value = value;
      else if (key === "release") comp.compressor.release.value = value;
      else if (key === "knee") comp.compressor.knee.value = value;
      else if (key === "makeup") comp.setManualMakeup(value);
      else if (key === "makeupAuto") comp.setAutoMakeup(value >= 0.5);
      else if (key === "dryWet") comp.setDryWet(value);
      else if (key === "output") comp.setOutput(value);
      break;
    }
    case "delay": {
      const delay = node as Tone.FeedbackDelay;
      if (key === "delayTime") delay.delayTime.value = value;
      else if (key === "feedback") delay.feedback.value = value;
      else if (key === "wet") delay.wet.value = value;
      break;
    }
    case "reverb": {
      const reverb = node as Tone.Reverb;
      if (key === "decay") reverb.decay = value;
      else if (key === "wet") reverb.wet.value = value;
      break;
    }
    case "chorus": {
      const chorus = node as Tone.Chorus;
      if (key === "frequency") chorus.frequency.value = value;
      else if (key === "delayTime") chorus.delayTime = value;
      else if (key === "depth") chorus.depth = value;
      else if (key === "wet") chorus.wet.value = value;
      break;
    }
    case "distortion": {
      const dist = node as Tone.Distortion;
      if (key === "distortion") dist.distortion = value;
      else if (key === "wet") dist.wet.value = value;
      break;
    }
    case "filter": {
      const filter = node as Tone.Filter;
      if (key === "frequency") filter.frequency.value = value;
      else if (key === "Q") filter.Q.value = value;
      else if (key === "type") filter.type = filterTypeFromKnob(value);
      break;
    }
    case "limiter": {
      const limiter = node as Tone.Limiter;
      if (key === "threshold") limiter.threshold.value = value;
      break;
    }
    case "pitchShift": {
      const shift = node as Tone.PitchShift;
      if (key === "pitch") shift.pitch = value;
      else if (key === "wet") shift.wet.value = value;
      break;
    }
  }
}

class AudioEngine {
  private channels = new Map<string, ChannelNodes>();
  private buses = new Map<string, BusNodes>();
  private started = false;
  private startPromise: Promise<void> | null = null;
  private recording: RecordingState | null = null;
  private pendingLoads = 0;
  private readyListeners = new Set<() => void>();
  private micStream: MediaStream | null = null;
  private audioRecording: { channelId: string; recorder: MediaRecorder; chunks: Blob[] } | null =
    null;

  // --- Automation playback ---
  private automation = new Map<string, AutomationLane[]>();
  private automationLoopStarted = false;

  /** Replaces a channel's set of automation lanes (played back live during
   * transport playback, one control-rate sample at a time). */
  setAutomation(channelId: string, lanes: AutomationLane[]): void {
    if (lanes.length > 0) this.ensureAutomationLoop();
    this.automation.set(channelId, lanes);
  }

  private ensureAutomationLoop(): void {
    if (this.automationLoopStarted) return;
    this.automationLoopStarted = true;
    // 20Hz is smooth enough for volume/pan/knob automation without being a
    // meaningful CPU cost - reuses the same synchronous setters a manual
    // knob drag calls, so there's only one code path that actually applies
    // a value to a live node.
    Tone.getTransport().scheduleRepeat(() => {
      const t = Tone.getTransport().seconds;
      this.automation.forEach((lanes, channelId) => {
        lanes.forEach((lane) => this.applyAutomationAt(channelId, lane, t));
      });
    }, 0.05);
  }

  private applyAutomationAt(channelId: string, lane: AutomationLane, t: number): void {
    const value = interpolateAutomation(lane.points, t);
    if (value === null) return;
    if (lane.target.kind === "volume") this.setVolume(channelId, value);
    else if (lane.target.kind === "pan") this.setPan(channelId, value);
    else this.setEffectParam(channelId, lane.target.effectId, lane.target.paramKey, value);
  }

  // --- Sustain pedal (CC64) ---
  private sustainedChannels = new Set<string>();
  /** Notes released (key-up) while the pedal was held down, per channel -
   * kept sounding until the pedal itself lifts. */
  private sustainPending = new Map<string, Set<string>>();

  setSustain(channelId: string, down: boolean): void {
    if (down) {
      this.sustainedChannels.add(channelId);
      return;
    }
    this.sustainedChannels.delete(channelId);
    const pending = this.sustainPending.get(channelId);
    if (!pending || pending.size === 0) return;
    const nodes = this.channels.get(channelId);
    pending.forEach((note) => this.safe(() => nodes?.instrument.triggerRelease(note, Tone.now())));
    pending.clear();
  }

  /** Live pitch-bend - `semitones` is the already-scaled bend amount (e.g.
   * wheel position -1..1 times the bend range), applied as live detune.
   * Only instruments that implement `setDetune` (the synth) respond. */
  setPitchBend(channelId: string, semitones: number): void {
    this.channels.get(channelId)?.instrument.setDetune?.(semitones * 100);
  }

  /** Live mod wheel, 0..1. Only instruments that implement `setModWheel`
   * (the synth) respond. */
  setModWheel(channelId: string, amount: number): void {
    this.channels.get(channelId)?.instrument.setModWheel?.(amount);
  }

  /** True once every sampler currently loading has finished (or failed). */
  samplesReady = true;

  /** Fires whenever samplesReady flips. Returns an unsubscribe function. */
  onReadyChange(listener: () => void): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  private setReady(ready: boolean) {
    if (this.samplesReady === ready) return;
    this.samplesReady = ready;
    this.readyListeners.forEach((l) => l());
  }

  /** Wraps a sampler call so a transient loading/decoding error never throws
   * out into a UI event handler or the transport's scheduling loop. */
  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      // sample not loaded yet, or another transient playback error - drop the note.
    }
  }

  /** Must be called from within a user gesture handler to unlock audio. */
  async ensureStarted(): Promise<void> {
    if (this.started) return;
    if (!this.startPromise) {
      this.startPromise = Tone.start().then(() => {
        this.started = true;
      });
    }
    await this.startPromise;
  }

  get isStarted() {
    return this.started;
  }

  // --- Master bus: every track channel routes through this before hitting
  // the speakers, so the Master track's fader/meter reflects the real mix.
  // A brake-wall Limiter sits right before the meter/destination so nothing
  // downstream can clip no matter how hot the mix gets. ---
  private masterChannel: Tone.Channel | null = null;
  private masterLimiter: Tone.Limiter | null = null;
  private masterMeter: Tone.Meter | null = null;
  /** The master bus's own effects chain (e.g. a final EQ or compressor
   * across the whole mix) - sits between the master channel and the
   * limiter, wired the same way a track's or bus's chain is. */
  private masterEffects: EffectNode[] = [];

  private ensureMaster(): { channel: Tone.Channel; limiter: Tone.Limiter; meter: Tone.Meter } {
    if (!this.masterChannel || !this.masterLimiter || !this.masterMeter) {
      this.masterMeter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
      this.masterLimiter = new Tone.Limiter(-1).connect(this.masterMeter);
      this.masterMeter.toDestination();
      this.masterChannel = new Tone.Channel({ volume: 0, pan: 0 });
      this.rewireMaster();
    }
    return { channel: this.masterChannel, limiter: this.masterLimiter, meter: this.masterMeter };
  }

  /** Reconnects the master channel through its (bypass-aware) effects
   * chain into the limiter - called whenever an effect is added, removed,
   * reordered, or bypassed on the master bus. */
  private rewireMaster(): void {
    if (!this.masterChannel || !this.masterLimiter) return;
    this.masterChannel.disconnect();
    this.wireEffectsChain([this.masterChannel], this.masterEffects, this.masterLimiter);
  }

  setMasterVolume(db: number): void {
    this.ensureMaster().channel.volume.value = db;
  }

  setMasterPan(pan: number): void {
    this.ensureMaster().channel.pan.value = pan;
  }

  /** Ceiling the master limiter won't let the mix exceed, in dB (e.g. -1). */
  setMasterLimiterThreshold(db: number): void {
    this.ensureMaster().limiter.threshold.value = db;
  }

  /** Current master output level, 0-1. */
  getMasterLevel(): number {
    const value = this.ensureMaster().meter.getValue();
    const level = Array.isArray(value) ? value[0] : value;
    return Number.isFinite(level) ? level : 0;
  }

  addChannel(
    id: string,
    channelType: ChannelType,
    instrument: InstrumentType | null,
    synthParams?: SynthParams
  ): void {
    if (this.channels.has(id)) return;

    const meter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
    const channel = new Tone.Channel({ volume: 0, pan: 0 })
      .connect(meter)
      .connect(this.ensureMaster().channel);
    this.pendingLoads += 1;
    this.setReady(false);
    const onSettled = () => {
      this.pendingLoads = Math.max(0, this.pendingLoads - 1);
      if (this.pendingLoads === 0) this.setReady(true);
    };

    this.channels.set(id, {
      channel,
      meter,
      channelType,
      instrumentType: channelType === "midi" ? instrument : null,
      instrument: createInstrument(
        channelType === "midi" ? instrument : null,
        onSettled,
        synthParams
      ),
      part: null,
      heldNotes: new Set(),
      effects: [],
      audioClips: new Map(),
      sends: new Map(),
    });
    this.rewireChannel(id);
  }

  removeChannel(id: string): void {
    const nodes = this.channels.get(id);
    if (!nodes) return;
    nodes.part?.dispose();
    nodes.instrument.dispose();
    nodes.audioClips.forEach(({ player, gain }) => {
      player.dispose();
      gain.dispose();
    });
    nodes.sends.forEach((gain) => gain.dispose());
    nodes.effects.forEach((e) => e.node.dispose());
    nodes.channel.dispose();
    nodes.meter.dispose();
    this.channels.delete(id);
    this.automation.delete(id);
    this.sustainedChannels.delete(id);
    this.sustainPending.delete(id);
    this.monitorNodes.get(id)?.dispose();
    this.monitorNodes.delete(id);
    if (this.recording?.channelId === id) {
      this.recording = null;
    }
  }

  /** Wires `sources` through the non-bypassed entries of `effects`, in
   * order, into `dest` - shared by a track channel (whose sources are its
   * instrument or audio clips) and a bus (whose source is its stable send
   * `input` tap), so both get the same bypass-aware chain-building logic. */
  private wireEffectsChain(
    sources: { connect: (n: Tone.InputNode) => unknown }[],
    effects: EffectNode[],
    dest: Tone.ToneAudioNode
  ): void {
    effects.forEach((e) => e.node.disconnect());
    const active = effects.filter((e) => !e.bypass);
    const first = active[0]?.node ?? dest;
    sources.forEach((source) => source.connect(first));
    for (let i = 0; i < active.length; i++) {
      const next = active[i + 1]?.node ?? dest;
      active[i].node.connect(next);
    }
  }

  /** Reconnects a channel's active sound source(s) - its instrument for a
   * MIDI channel, or every one of its clips' (post-gain) outputs for an
   * audio channel (the channel's `type` is fixed for its lifetime) -
   * through the effects chain, in order, into the channel strip. Called
   * whenever the instrument, an audio clip, or the effects chain itself
   * changes. Each clip's player stays permanently wired into its own gain
   * node (set up once in loadAudioClip) - only the gain's downstream
   * connection is touched here. */
  private rewireChannel(id: string): void {
    const nodes = this.channels.get(id);
    if (!nodes) return;

    // disconnect() with no args drops every outgoing connection, so both
    // possible sources can be safely detached here regardless of which one
    // is currently active.
    nodes.instrument.disconnect();
    nodes.audioClips.forEach(({ gain }) => gain.disconnect());

    type Connectable = { connect: (n: Tone.InputNode) => unknown };
    const sources: Connectable[] =
      nodes.channelType === "audio"
        ? [...nodes.audioClips.values()].map((c) => c.gain)
        : [nodes.instrument];
    if (sources.length === 0) {
      nodes.effects.forEach((e) => e.node.disconnect());
      return; // audio channel with nothing loaded yet
    }
    this.wireEffectsChain(sources, nodes.effects, nodes.channel);
  }

  /** Same as `rewireChannel`, but for a bus: its "source" is always just
   * its stable send-input tap. */
  private rewireBus(id: string): void {
    const bus = this.buses.get(id);
    if (!bus) return;
    bus.input.disconnect();
    this.wireEffectsChain([bus.input], bus.effects, bus.channel);
  }

  /** Swaps the instrument a MIDI track plays through (e.g. Piano -> Drums,
   * or null to leave the track empty), disposing the old one and
   * reconnecting the signal chain. No-op on an audio channel. */
  setInstrument(id: string, type: InstrumentType | null, synthParams?: SynthParams): void {
    const nodes = this.channels.get(id);
    if (!nodes || nodes.channelType !== "midi" || nodes.instrumentType === type) return;
    nodes.instrument.dispose();
    this.pendingLoads += 1;
    this.setReady(false);
    const onSettled = () => {
      this.pendingLoads = Math.max(0, this.pendingLoads - 1);
      if (this.pendingLoads === 0) this.setReady(true);
    };
    nodes.instrument = createInstrument(type, onSettled, synthParams);
    nodes.instrumentType = type;
    this.rewireChannel(id);
  }

  /** Applies a full new param set to a channel's synth instrument (a no-op
   * if it isn't currently a synth - e.g. a stale event arriving right after
   * switching to Piano/Drums). */
  setSynthParams(id: string, params: SynthParams): void {
    const nodes = this.channels.get(id);
    if (nodes?.instrumentType === "synth") {
      (nodes.instrument as SynthInstrument).setParams(params);
    }
  }

  // --- Effects chain - shared by track channels, buses, and the master bus ---

  private effectsHost(id: string): { host: EffectsHost; rewire: () => void } | null {
    if (id === "master") {
      this.ensureMaster();
      return { host: { effects: this.masterEffects }, rewire: () => this.rewireMaster() };
    }
    const channel = this.channels.get(id);
    if (channel) return { host: channel, rewire: () => this.rewireChannel(id) };
    const bus = this.buses.get(id);
    if (bus) return { host: bus, rewire: () => this.rewireBus(id) };
    return null;
  }

  /** `explicitId`, when given (restoring a saved project, or an undo/redo
   * rebuild), keeps the effect's id stable across a full engine rebuild so
   * the UI's existing references to it (remove/reorder/param-change) keep
   * working without React state needing to learn a new id. `atIndex`, when
   * given (dragging a device in from the FX browser sidebar and dropping
   * it mid-chain), inserts there instead of appending at the end. */
  addEffect(
    id: string,
    type: EffectType,
    explicitId?: string,
    atIndex?: number
  ): { id: string; type: EffectType; params: Record<string, number>; bypass: boolean } | null {
    const target = this.effectsHost(id);
    if (!target) return null;
    const params = defaultParams(type);
    const node = createEffectNode(type, params);
    const effectId = explicitId ?? `fx-${++effectIdCounter}`;
    const entry = { id: effectId, type, node, bypass: false };
    if (atIndex !== undefined && atIndex >= 0 && atIndex <= target.host.effects.length) {
      target.host.effects.splice(atIndex, 0, entry);
    } else {
      target.host.effects.push(entry);
    }
    target.rewire();
    return { id: effectId, type, params, bypass: false };
  }

  removeEffect(id: string, effectId: string): void {
    const target = this.effectsHost(id);
    if (!target) return;
    const idx = target.host.effects.findIndex((e) => e.id === effectId);
    if (idx === -1) return;
    target.host.effects[idx].node.dispose();
    target.host.effects.splice(idx, 1);
    target.rewire();
  }

  /** Moves an effect one slot earlier (-1) or later (+1) in the chain. */
  reorderEffect(id: string, effectId: string, direction: -1 | 1): void {
    const target = this.effectsHost(id);
    if (!target) return;
    const idx = target.host.effects.findIndex((e) => e.id === effectId);
    const targetIdx = idx + direction;
    if (idx === -1 || targetIdx < 0 || targetIdx >= target.host.effects.length) return;
    const [entry] = target.host.effects.splice(idx, 1);
    target.host.effects.splice(targetIdx, 0, entry);
    target.rewire();
  }

  /** Moves an effect to an absolute position in the chain - used by
   * drag-and-drop reordering in the FX rack, where a device can be dropped
   * anywhere, not just one slot over. */
  moveEffect(id: string, effectId: string, toIndex: number): void {
    const target = this.effectsHost(id);
    if (!target) return;
    const idx = target.host.effects.findIndex((e) => e.id === effectId);
    if (idx === -1) return;
    const [entry] = target.host.effects.splice(idx, 1);
    const clamped = Math.max(0, Math.min(target.host.effects.length, toIndex));
    target.host.effects.splice(clamped, 0, entry);
    target.rewire();
  }

  /** Toggles whether an effect is skipped in the chain, keeping its params
   * and position intact. */
  setEffectBypass(id: string, effectId: string, bypass: boolean): void {
    const target = this.effectsHost(id);
    const effect = target?.host.effects.find((e) => e.id === effectId);
    if (!effect || effect.bypass === bypass) return;
    effect.bypass = bypass;
    target!.rewire();
  }

  /** Clears an effects host (a bus or the master bus - never a channel,
   * which is fully torn down and rebuilt on every hydrate) back to no
   * effects, disposing every node. `hydrateEngine` calls this right before
   * repopulating a bus's or master's chain from a snapshot: unlike a
   * channel, a bus/master persists across repeated undo/redo, so without
   * this it would re-`addEffect` the same ids on top of what's already
   * there and silently double up the chain. */
  resetEffects(id: string): void {
    const target = this.effectsHost(id);
    if (!target) return;
    target.host.effects.forEach((e) => e.node.dispose());
    target.host.effects.length = 0;
    target.rewire();
  }

  setEffectParam(id: string, effectId: string, key: string, value: number): void {
    const target = this.effectsHost(id);
    const effect = target?.host.effects.find((e) => e.id === effectId);
    if (!effect) return;
    this.safe(() => applyEffectParam(effect.node, effect.type, key, value));
  }

  // --- Send/return buses ---

  addBus(id: string): void {
    if (this.buses.has(id)) return;
    const input = new Tone.Gain(1);
    const meter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
    const channel = new Tone.Channel({ volume: 0, pan: 0 })
      .connect(meter)
      .connect(this.ensureMaster().channel);
    this.buses.set(id, { input, channel, meter, effects: [] });
    this.rewireBus(id);
  }

  removeBus(id: string): void {
    const bus = this.buses.get(id);
    if (!bus) return;
    bus.effects.forEach((e) => e.node.dispose());
    bus.input.dispose();
    bus.channel.dispose();
    bus.meter.dispose();
    this.buses.delete(id);
    this.channels.forEach((nodes) => {
      const gain = nodes.sends.get(id);
      if (gain) {
        gain.dispose();
        nodes.sends.delete(id);
      }
    });
  }

  setBusVolume(id: string, db: number): void {
    const bus = this.buses.get(id);
    if (bus) bus.channel.volume.value = db;
  }

  setBusPan(id: string, pan: number): void {
    const bus = this.buses.get(id);
    if (bus) bus.channel.pan.value = pan;
  }

  getBusLevel(id: string): number {
    const bus = this.buses.get(id);
    if (!bus) return 0;
    const value = bus.meter.getValue();
    const level = Array.isArray(value) ? value[0] : value;
    return Number.isFinite(level) ? level : 0;
  }

  /** Sets (or, with `db === null`, removes) a channel's send to a bus, in
   * dB - independent of the channel's own dry output, which always keeps
   * going straight to master regardless of any sends. */
  setSend(channelId: string, busId: string, db: number | null): void {
    const nodes = this.channels.get(channelId);
    if (!nodes) return;
    const bus = this.buses.get(busId);
    let gain = nodes.sends.get(busId);
    if (db === null || !bus) {
      if (gain) {
        gain.dispose();
        nodes.sends.delete(busId);
      }
      return;
    }
    if (!gain) {
      gain = new Tone.Gain(Tone.dbToGain(db));
      nodes.channel.connect(gain);
      gain.connect(bus.input);
      nodes.sends.set(busId, gain);
    } else {
      gain.gain.value = Tone.dbToGain(db);
    }
  }

  setVolume(id: string, db: number): void {
    const nodes = this.channels.get(id);
    if (nodes) nodes.channel.volume.value = db;
  }

  setPan(id: string, pan: number): void {
    const nodes = this.channels.get(id);
    if (nodes) nodes.channel.pan.value = pan;
  }

  /** Tone.Channel has built-in mute/solo - soloing any one channel silences
   * every other channel that isn't also soloed, all handled internally by
   * Tone's shared Solo group. */
  setMute(id: string, muted: boolean): void {
    const nodes = this.channels.get(id);
    if (nodes) nodes.channel.mute = muted;
  }

  setSolo(id: string, solo: boolean): void {
    const nodes = this.channels.get(id);
    if (nodes) nodes.channel.solo = solo;
  }

  /** Current output level for the channel's meter, 0-1. */
  getLevel(id: string): number {
    const nodes = this.channels.get(id);
    if (!nodes) return 0;
    const value = nodes.meter.getValue();
    const level = Array.isArray(value) ? value[0] : value;
    return Number.isFinite(level) ? level : 0;
  }

  /** Live input/gain-reduction/output levels (all in dB) for one compressor
   * effect instance, for the full Compressor window's meters - `hostId` is
   * the channel, bus, or "master" the effect lives on. Null if that effect
   * isn't a compressor (or doesn't exist). */
  getCompressorMeters(hostId: string, effectId: string): { input: number; gainReduction: number; output: number } | null {
    const target = this.effectsHost(hostId);
    const effect = target?.host.effects.find((e) => e.id === effectId);
    if (!effect || effect.type !== "compressor") return null;
    const comp = effect.node as CompressorChain;
    return { input: comp.inputDb, gainReduction: comp.reductionDb, output: comp.outputDb };
  }

  /** Live note-on, triggered immediately (not scheduled on the transport). */
  noteOn(channelId: string, note: string, velocity = 0.8): void {
    const nodes = this.channels.get(channelId);
    if (!nodes || nodes.heldNotes.has(note)) return;
    nodes.heldNotes.add(note);
    this.safe(() => nodes.instrument.triggerAttack(note, Tone.now(), velocity));

    if (this.recording && this.recording.channelId === channelId) {
      this.recording.open.set(note, {
        time: Tone.getTransport().seconds,
        velocity,
      });
    }
  }

  /** Live note-off. When the sustain pedal (CC64) is down for this channel,
   * the voice keeps ringing - it's queued for release once the pedal lifts
   * - but the note is still considered "up" for re-triggering and its
   * recorded duration (if recording) still reflects the real key-up time,
   * not the sustained tail. */
  noteOff(channelId: string, note: string): void {
    const nodes = this.channels.get(channelId);
    if (!nodes || !nodes.heldNotes.has(note)) return;
    nodes.heldNotes.delete(note);
    if (this.sustainedChannels.has(channelId)) {
      let pending = this.sustainPending.get(channelId);
      if (!pending) {
        pending = new Set();
        this.sustainPending.set(channelId, pending);
      }
      pending.add(note);
    } else {
      this.safe(() => nodes.instrument.triggerRelease(note, Tone.now()));
    }

    const rec = this.recording;
    if (rec && rec.channelId === channelId) {
      const open = rec.open.get(note);
      if (open) {
        rec.open.delete(note);
        const duration = Math.max(
          Tone.getTransport().seconds - open.time,
          MIN_NOTE_DURATION
        );
        rec.events.push({
          note,
          time: open.time,
          duration,
          velocity: open.velocity,
        });
      }
    }
  }

  /**
   * Replace a channel's playable clip (used after recording, import, clear,
   * or editing). `notes` are clip-relative; `offsetSeconds` is where the
   * clip sits on the arrangement timeline.
   */
  setClip(channelId: string, notes: NoteEvent[], offsetSeconds = 0): void {
    const nodes = this.channels.get(channelId);
    if (!nodes) return;
    nodes.part?.dispose();
    if (notes.length === 0) {
      nodes.part = null;
      return;
    }
    const scheduled = notes.map((n) => ({ ...n, time: offsetSeconds + n.time }));
    const part = new Tone.Part<NoteEvent>((time, value) => {
      this.safe(() =>
        nodes.instrument.triggerAttackRelease(
          value.note,
          Math.max(value.duration, MIN_NOTE_DURATION),
          time,
          value.velocity
        )
      );
    }, scheduled).start(0);
    nodes.part = part;
  }

  // --- Audio clips ---
  // An audio channel can hold several independent clips at once, each
  // addressed by its own `clipId` (the arrangement-level clip instance id).

  /** Applies a clip's timing (position, source offset, trim, loop) to an
   * already-loaded, already-synced player. Shared by the initial load and
   * by re-timing after a move/resize/loop-toggle. */
  private applyAudioClipTiming(player: Tone.Player, timing: AudioClipTiming): void {
    const bufferOffset = timing.bufferOffsetSeconds ?? 0;
    if (timing.loopLength && timing.loopLength > 0) {
      player.loop = true;
      player.loopStart = bufferOffset;
      player.loopEnd = bufferOffset + timing.loopLength;
    } else {
      player.loop = false;
    }
    player.fadeIn = timing.fadeIn ?? 0;
    player.fadeOut = timing.fadeOut ?? 0;
    if (timing.trimSeconds !== undefined) {
      player.start(timing.offsetSeconds, bufferOffset, timing.trimSeconds);
    } else {
      player.start(timing.offsetSeconds, bufferOffset);
    }
  }

  /**
   * Loads an audio file's object URL as one clip on this (audio) channel,
   * replacing any earlier player for the same `clipId`. No-op on a MIDI
   * channel.
   */
  loadAudioClip(channelId: string, clipId: string, url: string, timing: AudioClipTiming, gainDb = 0): void {
    const nodes = this.channels.get(channelId);
    if (!nodes || nodes.channelType !== "audio") return;
    const existing = nodes.audioClips.get(clipId);
    existing?.player.dispose();
    existing?.gain.dispose();

    this.pendingLoads += 1;
    this.setReady(false);
    const onSettled = () => {
      this.pendingLoads = Math.max(0, this.pendingLoads - 1);
      if (this.pendingLoads === 0) this.setReady(true);
    };
    const gain = new Tone.Volume(gainDb);
    const player = new Tone.Player({
      url,
      fadeIn: timing.fadeIn ?? 0,
      fadeOut: timing.fadeOut ?? 0,
      onload: () => {
        onSettled();
        this.safe(() => {
          player.sync();
          this.applyAudioClipTiming(player, timing);
        });
      },
      onerror: onSettled,
    });
    player.connect(gain);
    nodes.audioClips.set(clipId, { player, gain });
    this.rewireChannel(channelId);
  }

  /** Re-times an already-loaded audio clip after it's moved, resized, or
   * has its loop/fades toggled, without re-decoding the file. */
  moveAudioClip(channelId: string, clipId: string, timing: AudioClipTiming): void {
    const entry = this.channels.get(channelId)?.audioClips.get(clipId);
    if (!entry || !entry.player.loaded) return;
    this.safe(() => {
      entry.player.unsync();
      entry.player.sync();
      this.applyAudioClipTiming(entry.player, timing);
    });
  }

  /** Sets a clip's own gain, independent of the channel fader. */
  setAudioClipGain(channelId: string, clipId: string, gainDb: number): void {
    const entry = this.channels.get(channelId)?.audioClips.get(clipId);
    if (entry) entry.gain.volume.value = gainDb;
  }

  /** Removes one clip from an audio channel. */
  removeAudioClip(channelId: string, clipId: string): void {
    const nodes = this.channels.get(channelId);
    if (!nodes) return;
    const entry = nodes.audioClips.get(clipId);
    entry?.player.dispose();
    entry?.gain.dispose();
    nodes.audioClips.delete(clipId);
    this.rewireChannel(channelId);
  }

  /** Clears every clip on an audio channel, leaving it empty. */
  clearAllAudioClips(channelId: string): void {
    const nodes = this.channels.get(channelId);
    if (!nodes) return;
    nodes.audioClips.forEach(({ player, gain }) => {
      player.dispose();
      gain.dispose();
    });
    nodes.audioClips.clear();
    this.rewireChannel(channelId);
  }

  /** Starts/resumes playback from wherever the transport currently sits
   * (position 0 if it was never played or was explicitly stopped, or a
   * seeked/paused position otherwise). */
  async startPlayback(): Promise<void> {
    await this.ensureStarted();
    Tone.getTransport().start();
  }

  /** Pauses playback in place - unlike stopAll, the transport position is
   * preserved so playback can resume from the same spot. */
  pauseAll(): void {
    Tone.getTransport().pause();
    this.channels.forEach((nodes) => {
      this.safe(() => nodes.instrument.releaseAll());
      nodes.heldNotes.clear();
    });
    this.sustainPending.forEach((pending) => pending.clear());
  }

  /** Stops playback/recording and releases any hanging notes. Leaves the
   * playhead wherever it was - the caller decides where to rewind it to
   * (e.g. back to a cursor/marker position), matching how Ableton's Stop
   * returns to the last clicked point rather than always the very start. */
  stopAll(): void {
    const transport = Tone.getTransport();
    transport.stop();
    this.channels.forEach((nodes) => {
      this.safe(() => nodes.instrument.releaseAll());
      nodes.heldNotes.clear();
    });
    this.sustainPending.forEach((pending) => pending.clear());
    if (this.recording) {
      this.finishRecording();
    }
    // Defensive hard-stop only - a caller that wants the take should have
    // already awaited finishAudioRecording() before calling stopAll().
    if (this.audioRecording) {
      this.safe(() => this.audioRecording!.recorder.stop());
      this.audioRecording = null;
    }
  }

  /** Moves the playhead to an absolute position on the timeline, whether
   * the transport is currently playing, paused, or stopped. */
  seekTo(seconds: number): void {
    Tone.getTransport().seconds = Math.max(0, seconds);
  }

  private countInSynth: Tone.Synth | null = null;

  /** Plays `beats` audible clicks (accenting every downbeat) scheduled by
   * wall-clock time rather than the transport - the transport isn't running
   * yet at this point - then resolves once they've finished playing. */
  private playCountIn(beats: number): Promise<void> {
    if (!this.countInSynth) {
      this.countInSynth = new Tone.Synth({
        oscillator: { type: "square" },
        envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.04 },
      }).toDestination();
      this.countInSynth.volume.value = -8;
    }
    const secPerBeat = 60 / Tone.getTransport().bpm.value;
    const now = Tone.now();
    for (let i = 0; i < beats; i++) {
      const accent = i % this.metronomeBeatsPerBar === 0;
      this.safe(() =>
        this.countInSynth!.triggerAttackRelease(
          accent ? "C6" : "C5",
          0.03,
          now + i * secPerBeat
        )
      );
    }
    return new Promise((resolve) => setTimeout(resolve, beats * secPerBeat * 1000));
  }

  /** Arms a channel for recording and starts the transport (other channels'
   * clips still play back). `countInBeats` > 0 plays that many audible
   * clicks first and only starts the transport/recording once they finish,
   * like a real DAW's pre-roll. */
  async startRecording(channelId: string, countInBeats = 0): Promise<void> {
    await this.ensureStarted();
    if (!this.channels.has(channelId)) return;
    if (countInBeats > 0) await this.playCountIn(countInBeats);
    if (!this.channels.has(channelId)) return; // channel could've been removed mid-count-in
    this.recording = { channelId, open: new Map(), events: [] };
    const transport = Tone.getTransport();
    transport.stop();
    transport.position = 0;
    transport.start();
  }

  /**
   * Stops recording, finalizes the clip, and returns the recorded notes.
   * `offsetSeconds` is the clip's current position on the timeline, so
   * playback scheduling doesn't get reset to the start of the timeline.
   */
  finishRecording(offsetSeconds = 0): NoteEvent[] {
    const rec = this.recording;
    if (!rec) return [];
    const nodes = this.channels.get(rec.channelId);
    const transportSeconds = Tone.getTransport().seconds;

    rec.open.forEach((open, note) => {
      rec.events.push({
        note,
        time: open.time,
        duration: Math.max(transportSeconds - open.time, MIN_NOTE_DURATION),
        velocity: open.velocity,
      });
      this.safe(() => nodes?.instrument.triggerRelease(note, Tone.now()));
    });
    nodes?.heldNotes.clear();

    this.recording = null;
    const events = rec.events.sort((a, b) => a.time - b.time);
    this.setClip(rec.channelId, events, offsetSeconds);
    return events;
  }

  get isRecording(): boolean {
    return this.recording !== null || this.audioRecording !== null;
  }

  // --- Audio (microphone) recording ---

  /** Which input device recordings should capture from - null means the
   * browser's default. Set via `setMicDevice`, e.g. after plugging in an
   * audio interface and picking it from a track's own Input select. */
  private micDeviceId: string | null = null;

  /** Per-channel live input-monitor taps - open only while that channel is
   * both armed and monitoring is enabled (see `setInputMonitoring`). */
  private monitorNodes = new Map<string, Tone.UserMedia>();

  private async ensureMicStream(): Promise<MediaStream> {
    if (this.micStream) return this.micStream;
    // `channelCount: { ideal: 1 }` asks for a single (mono) capture rather
    // than whatever multi-channel width the selected device natively
    // exposes - without it, some audio interfaces hand back every input
    // channel summed together regardless of which single `deviceId` was
    // requested. echo/noise/gain processing is turned off since it can
    // audibly mangle a mic or instrument signal, matching what a DAW's own
    // input path should do (same constraints Tone.UserMedia uses below).
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(this.micDeviceId ? { deviceId: { exact: this.micDeviceId } } : {}),
        channelCount: { ideal: 1 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    return this.micStream;
  }

  /** Requests mic permission (prompting the user the first time) without
   * starting a recording - lets a caller (e.g. a track's Input select,
   * on focus) unlock the browser's full, labeled device list ahead of
   * time, since `enumerateDevices` only returns generic/blank entries
   * until permission has been granted at least once. */
  async requestMicAccess(): Promise<void> {
    await this.ensureMicStream();
  }

  /** Switches which input device future recordings and monitoring capture
   * from. Drops any already-open mic stream so `ensureMicStream`
   * re-requests `getUserMedia` against the new device instead of reusing
   * the old one, and reopens any active monitor taps on the new device -
   * a no-op while nothing's open yet. */
  setMicDevice(deviceId: string | null): void {
    if (this.micDeviceId === deviceId) return;
    this.micDeviceId = deviceId;
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
    this.monitorNodes.forEach((_, channelId) => {
      this.setInputMonitoring(channelId, false);
      void this.setInputMonitoring(channelId, true);
    });
  }

  /** Lists the browser's available audio input devices (an interface's
   * separate inputs included, once the OS exposes them). Device labels -
   * and, on some browsers, entries for anything past the first device -
   * come back blank/missing until mic permission has been granted at
   * least once; call `requestMicAccess` first (or just try recording) to
   * unlock the real list, then call this again. */
  async listInputDevices(): Promise<{ deviceId: string; label: string }[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "audioinput")
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  }

  /** Turns a live input-monitor tap for `channelId` on or off - while on,
   * the selected mic/interface input is audible in real time through that
   * channel's volume/pan/mute, so an armed track can be heard while
   * recording (or just while getting ready to). Taps in directly to the
   * channel strip rather than through its effects chain, for lower
   * latency and so unrelated effect changes never have to know about it. */
  async setInputMonitoring(channelId: string, enabled: boolean): Promise<void> {
    const nodes = this.channels.get(channelId);
    if (!nodes) return;
    if (!enabled) {
      const mic = this.monitorNodes.get(channelId);
      if (mic) {
        mic.dispose();
        this.monitorNodes.delete(channelId);
      }
      return;
    }
    if (this.monitorNodes.has(channelId)) return;
    await this.ensureStarted();
    const mic = new Tone.UserMedia();
    try {
      await mic.open(this.micDeviceId ?? undefined);
    } catch {
      mic.dispose();
      return;
    }
    // The channel (or the whole engine) may have gone away while the
    // permission prompt/device open was in flight.
    if (!this.channels.has(channelId) || this.monitorNodes.has(channelId)) {
      mic.dispose();
      return;
    }
    mic.connect(nodes.channel);
    this.monitorNodes.set(channelId, mic);
  }

  isInputMonitoring(channelId: string): boolean {
    return this.monitorNodes.has(channelId);
  }

  private static readonly PREFERRED_MIME_TYPES = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];

  private pickRecorderMimeType(): string | undefined {
    return AudioEngine.PREFERRED_MIME_TYPES.find(
      (type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)
    );
  }

  /**
   * Requests microphone access (prompting the user the first time) and
   * arms a channel to capture the input as an audio clip, starting the
   * transport from the top like MIDI recording does.
   */
  async startAudioRecording(channelId: string, countInBeats = 0): Promise<void> {
    await this.ensureStarted();
    if (!this.channels.has(channelId)) return;
    const stream = await this.ensureMicStream();
    if (countInBeats > 0) await this.playCountIn(countInBeats);
    if (!this.channels.has(channelId)) return;
    const mimeType = this.pickRecorderMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    this.audioRecording = { channelId, recorder, chunks };
    recorder.start();

    const transport = Tone.getTransport();
    transport.stop();
    transport.position = 0;
    transport.start();
  }

  /** Stops the mic capture and returns the recorded take as a Blob, or
   * null if nothing was being recorded. */
  async finishAudioRecording(): Promise<Blob | null> {
    const rec = this.audioRecording;
    if (!rec) return null;
    this.audioRecording = null;
    if (rec.recorder.state === "inactive") {
      return rec.chunks.length > 0 ? new Blob(rec.chunks, { type: rec.recorder.mimeType }) : null;
    }
    return new Promise((resolve) => {
      rec.recorder.onstop = () => {
        resolve(rec.chunks.length > 0 ? new Blob(rec.chunks, { type: rec.recorder.mimeType }) : null);
      };
      rec.recorder.stop();
    });
  }

  get isAudioRecording(): boolean {
    return this.audioRecording !== null;
  }

  setBpm(bpm: number): void {
    Tone.getTransport().bpm.value = bpm;
  }

  setTimeSignature(beatsPerBar: number): void {
    Tone.getTransport().timeSignature = beatsPerBar;
    this.metronomeBeatsPerBar = beatsPerBar;
  }

  getTransportSeconds(): number {
    return Tone.getTransport().seconds;
  }

  /** Sets (or clears) the transport's loop region. When enabled, playback
   * that reaches `endSeconds` jumps back to `startSeconds` and keeps going
   * instead of running off the end of the loop. */
  setLoop(enabled: boolean, startSeconds: number, endSeconds: number): void {
    const transport = Tone.getTransport();
    transport.loopStart = startSeconds;
    transport.loopEnd = Math.max(startSeconds + 0.05, endSeconds);
    transport.loop = enabled;
  }

  getTransportState(): "started" | "stopped" | "paused" {
    return Tone.getTransport().state;
  }

  // --- Metronome ---
  private metronomeSynth: Tone.Synth | null = null;
  private metronomeLoop: Tone.Loop | null = null;
  private metronomeBeatsPerBar = 4;
  private metronomeBeatIndex = 0;
  private metronomeStartHooked = false;

  setMetronome(enabled: boolean): void {
    if (!this.metronomeStartHooked) {
      this.metronomeStartHooked = true;
      Tone.getTransport().on("start", () => {
        this.metronomeBeatIndex = 0;
      });
    }
    if (enabled) {
      if (!this.metronomeSynth) {
        this.metronomeSynth = new Tone.Synth({
          oscillator: { type: "square" },
          envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.04 },
        }).toDestination();
        this.metronomeSynth.volume.value = -14;
      }
      if (!this.metronomeLoop) {
        this.metronomeBeatIndex = 0;
        this.metronomeLoop = new Tone.Loop((time) => {
          const accent = this.metronomeBeatIndex % this.metronomeBeatsPerBar === 0;
          this.safe(() =>
            this.metronomeSynth!.triggerAttackRelease(
              accent ? "C6" : "C5",
              0.03,
              time
            )
          );
          this.metronomeBeatIndex += 1;
        }, "4n").start(0);
      }
    } else {
      this.metronomeLoop?.dispose();
      this.metronomeLoop = null;
    }
  }
}

export const audioEngine = new AudioEngine();
