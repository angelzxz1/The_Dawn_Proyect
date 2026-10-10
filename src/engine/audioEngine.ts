import * as Tone from "tone";
import { PREFERRED_SAMPLE_RATE, nativeAudioContext } from "./context";

export { PREFERRED_SAMPLE_RATE };


import type { NoteEvent, InstrumentType, ChannelType, AutomationLane } from "../project/types";
import { DrumRack, type DrumLiveState } from "../instruments/drum-rack/drumRack";
import { padNote, type DrumKitParams } from "../instruments/drum-rack/drumParams";
import { SynthInstrument, setSynthTempo, type SynthLiveState } from "../instruments/synth/synth";
import { type EffectType, defaultParams } from "../effects/registry";
import { CompressorChain, type CompressorMeterReading } from "../effects/compressor/compressor";
import { GlueChain, type GlueMeterReading } from "../effects/glue/glue";
import { MbDynamicsChain, type MbdMeters } from "../effects/multiband-dynamics/mbDynamics";
import { LookaheadLimiter, type LimiterLevels } from "../effects/limiter/lookaheadLimiter";
import { measureNativeLatencies } from "./nativeLatency";
import { chainLatency, detectRoundTrip, nodeLatency, type CompensationPlan } from "./latency";
import { InputRecorder, takeToWav } from "./inputRecorder";
import type { Waveform } from "./waveform";
import { installCpuMeter } from "./cpuMeter";
import { decodeEffectFileAudio, readEffectFileText } from "../effects/effectFiles";
import { NamAmpChain } from "../effects/nam-amp/namAmp";
import { NoiseGate, type GateReading } from "../effects/gate/noiseGate";
import { ParamEqChain } from "../effects/parametric-eq/paramEq";
import { MultibandChain, type MultibandMeters } from "../effects/multiband/multiband";
import { UtilityChain, type UtilityMeters } from "../effects/utility/utility";
import { TunerChain } from "../effects/tuner/tuner";
import type { SidechainRouting } from "../effects/sidechain/sidechainModel";
import { canKeyFrom, tapLatency, type RoutingSnapshot } from "../effects/sidechain/sidechainRouting";
import type { RouteNode } from "./routing";
import { planMix, type MixGraph, type MixHost, type MixInput, type MixTrack } from "./mixGraph";
import { interpolateAutomation } from "./automation";
import { InputManager } from "./inputs";
import { MidiTake } from "./midiTake";
import { Transport } from "./transport";
import { createInstrument, updateInstrument } from "../instruments/nodes";
import type { InstrumentSettings } from "../instruments/registry";
import { applyEffectParam, createEffectNode, IrLoaderChain } from "../effects/nodes";
import { isSidechainNode, MAX_COMPENSATION, type AudioClipTiming, type BusNodes, type ChannelNodes, type EffectNode, type EffectsHost, type SidechainNode, type SidechainTaps } from "./nodes";
import { attempt, noteIssue } from "../services/issues";

export type { AudioClipTiming };

const MIN_NOTE_DURATION = 0.05;
let effectIdCounter = 0;

/** After restoring effects with explicit ids (loading a saved project), makes
 * sure the next auto-generated id can't collide with one that was just
 * restored. */
export function bumpEffectIdCounter(atLeast: number): void {
  effectIdCounter = Math.max(effectIdCounter, atLeast);
}

class AudioEngine {
  private channels = new Map<string, ChannelNodes>();
  private buses = new Map<string, BusNodes>();
  private started = false;
  private startPromise: Promise<void> | null = null;
  private recording: MidiTake | null = null;
  /** Tone's transport and the metronome (transport.ts). */
  private transport = new Transport(() => this.ensureClickOut());
  private pendingLoads = 0;
  private readyListeners = new Set<() => void>();
  private audioRecording: {
    channelId: string;
    recorder: InputRecorder;
    startTime: number;
    from: number;
    latency: number;
    /** Recording another track ("Audio From"), not the interface. */
    fromTrack: boolean;
  } | null =
    null;
  /** Ids of channels the user currently has soloed - tracked here instead of
   * via Tone.Channel's own `solo`, whose Solo instance is shared globally
   * per-AudioContext across *every* Tone.Channel, including the master
   * channel and every send/return bus. Those are never themselves soloed,
   * so letting a track's solo touch that shared group silences the whole
   * mix (master included) instead of isolating the soloed track. */
  private soloedIds = new Set<string>();

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
    pending.forEach((note) => this.safe(() => nodes?.instrument.triggerRelease(note, Tone.immediate())));
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

  /** Wraps an instrument call so a playback error (a sample not loaded
   * yet, say) never throws out into a UI event handler or the transport's
   * scheduling loop: the note is dropped, and noted (issues.ts). */
  private safe(fn: () => void): void {
    attempt("engine.playback", fn);
  }

  /** Must be called from within a user gesture handler to unlock audio. */
  async ensureStarted(): Promise<void> {
    if (this.started) return;
    if (!this.startPromise) {
      this.startPromise = Tone.start().then(() => {
        this.started = true;
        // Browsers' own nodes hide some delay; measure it for compensation.
        void measureNativeLatencies(Tone.getContext().sampleRate).then(() => this.refreshMix());
        void installCpuMeter();
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
  private masterLimiter: LookaheadLimiter | null = null;
  private masterMeter: Tone.Meter | null = null;
  /** The master bus's own effects chain (e.g. a final EQ or compressor
   * across the whole mix) - sits between the master channel and the
   * limiter, wired the same way a track's or bus's chain is. */
  private masterEffects: EffectNode[] = [];

  private ensureMaster(): { channel: Tone.Channel; limiter: LookaheadLimiter; meter: Tone.Meter } {
    if (!this.masterChannel || !this.masterLimiter || !this.masterMeter) {
      this.masterMeter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
      this.masterLimiter = new LookaheadLimiter({ ceilingDb: -1 }).connect(this.masterMeter);
      this.masterMeter.toDestination();
      // channelCount: 2 - see the comment on the per-track Channel below;
      // without it the whole mix gets folded to mono right before the
      // speakers, undoing any stereo width a stereo delay/reverb/etc. built.
      this.masterChannel = new Tone.Channel({ volume: 0, pan: 0, channelCount: 2 });
      this.directDelay = new Tone.Delay(0, MAX_COMPENSATION).connect(this.masterChannel);
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
    this.refreshMix();
  }

  // --- Latency: delay compensation (see latency.ts) ---

  /** The tracks' shared delay into the master (aligns them with sends
   * through latent bus effects). */
  private directDelay: Tone.Delay | null = null;
  /** The metronome and count-in go out through this, delayed by the mix's
   * total latency so they stay on the beat you hear. */
  private clickOut: Tone.Delay | null = null;
  private delayCompensation = true;
  private reducedLatencyMonitoring = true;
  private armedChannelId: string | null = null;
  private compensation: CompensationPlan = { channel: new Map(), own: new Map(), send: new Map(), bus: new Map(), direct: 0, total: 0, compensated: 0, live: new Set() };
  private routeNodes: RouteNode[] = [];
  /** The mix as last planned (mixGraph.ts). */
  private mix: MixGraph | null = null;
  private latencyListeners = new Set<() => void>();

  private ensureClickOut(): Tone.Delay {
    if (!this.clickOut) {
      this.clickOut = new Tone.Delay(this.compensation.total, MAX_COMPENSATION).toDestination();
    }
    return this.clickOut;
  }

  private isLive(id: string, nodes: ChannelNodes): boolean {
    return (
      this.reducedLatencyMonitoring &&
      (this.inputs.isMonitoring(id) || (nodes.channelType === "midi" && id === this.armedChannelId))
    );
  }

  /** The mix as the engine has it now, for mixGraph.ts: tracks in the
   * project's order (then any the routing hasn't been told about yet). */
  private mixInput(): MixInput {
    const master = this.ensureMaster();
    const known = new Set<string>();
    const tracks: MixTrack[] = [];
    const add = (id: string, route: RouteNode | undefined) => {
      const n = this.channels.get(id);
      if (!n || known.has(id)) return;
      known.add(id);
      tracks.push({
        id,
        type: n.channelType,
        groupId: route?.groupId,
        output: route?.output,
        input: route?.input,
        latency: chainLatency(n.effects),
        live: this.isLive(id, n),
        muted: n.userMuted,
        solo: this.soloedIds.has(id),
        sends: [...n.sends.keys()],
      });
    };
    this.routeNodes.forEach((r) => add(r.id, r));
    this.channels.forEach((_, id) => add(id, undefined));
    const hostOf = (id: string, effects: EffectNode[]): MixHost => ({
      id,
      effects: effects.map((e) => ({
        id: e.id,
        latency: nodeLatency(e.node),
        bypass: !!e.bypass,
        keyed: isSidechainNode(e.node),
        sidechain: e.sidechain,
      })),
    });
    return {
      tracks,
      buses: [...this.buses].map(([id, b]) => ({ id, latency: chainLatency(b.effects) })),
      masterLatency: chainLatency(this.masterEffects) + nodeLatency(master.limiter),
      compensation: this.delayCompensation,
      hosts: this.effectHosts().map(([id, effects]) => hostOf(id, effects)),
    };
  }

  /** Re-plans the mix (mixGraph.ts) and applies it: every compensation
   * delay, where each track's strip goes, mute and solo, and the
   * sidechains. Called after anything that changes the routing, a chain's
   * latency (an effect added/removed/bypassed, a latency setting), a track
   * going live, mute/solo, a send, or the settings. */
  private refreshMix(): void {
    const master = this.ensureMaster();
    const mix = planMix(this.mixInput());
    const plan = mix.plan;
    this.mix = mix;
    this.inputs.setTrackInputs(mix.inputs);
    const setDelay = (delay: Tone.Delay | null, seconds: number) => {
      if (delay && Math.abs(Number(delay.delayTime.value) - seconds) > 1e-7) delay.delayTime.value = seconds;
    };
    this.channels.forEach((n, id) => {
      setDelay(n.pdc, plan.channel.get(id) ?? 0);
      setDelay(n.ownDelay, plan.own.get(id) ?? 0);
      setDelay(n.sendTap, plan.send.get(id) ?? 0);
      const audible = mix.audible.has(id);
      if (audible !== n.audible) {
        n.audible = audible;
        // A few ms ramp, so muting mid-note doesn't click.
        n.muteGain.gain.cancelScheduledValues(Tone.now());
        n.muteGain.gain.setTargetAtTime(audible ? 1 : 0, Tone.now(), 0.003);
      }
      const out = mix.outputs.get(id) ?? { kind: "direct" };
      const route = out.kind === "track" ? `to:${out.id}` : out.kind;
      if (route !== n.route) {
        try {
          if (n.route === "direct") n.channel.disconnect(this.directDelay!);
          else if (n.route === "master") n.channel.disconnect(master.channel);
          else if (n.route?.startsWith("to:")) {
            const old = this.channels.get(n.route.slice(3));
            if (old) n.channel.disconnect(old.routeIn);
          }
        } catch {
          // Already disconnected (the old destination was removed).
        }
        n.channel.connect(out.kind === "track" ? this.channels.get(out.id)!.routeIn : out.kind === "direct" ? this.directDelay! : master.channel);
        n.route = route;
      }
    });
    this.buses.forEach((b, id) => setDelay(b.pdc, plan.bus.get(id) ?? 0));
    setDelay(this.directDelay, plan.direct);
    setDelay(this.clickOut, plan.total);
    const changed = plan.total !== this.compensation.total || plan.compensated !== this.compensation.compensated;
    this.compensation = plan;
    this.applySidechains(mix);
    if (changed) this.latencyListeners.forEach((fn) => fn());
  }

  /** Plugin delay compensation on/off (on by default). */
  setDelayCompensation(enabled: boolean): void {
    this.delayCompensation = enabled;
    this.refreshMix();
  }

  /** Whether monitored/armed tracks skip compensation to stay responsive. */
  setReducedLatencyMonitoring(enabled: boolean): void {
    this.reducedLatencyMonitoring = enabled;
    this.refreshMix();
  }

  /** The record-armed track - a MIDI one counts as played live. */
  setArmedChannel(id: string | null): void {
    if (this.armedChannelId === id) return;
    this.armedChannelId = id;
    this.refreshMix();
  }

  /** Called whenever the latency figures change. Returns an unsubscribe. */
  onLatencyChange(fn: () => void): () => void {
    this.latencyListeners.add(fn);
    return () => this.latencyListeners.delete(fn);
  }

  /** Latency figures, in seconds. `output`: from the audio engine to the
   * speakers (the browser's buffer plus the device's). `input`: from the
   * mic to the engine, as the browser reports it (it may not know it all -
   * a measured round trip replaces the estimate). `effects`: how late the
   * mix leaves the master from compensation and master effects. */
  getLatencyInfo(): { sampleRate: number; output: number; input: number; effects: number; compensated: number } {
    const ctx = nativeAudioContext();
    const base = ctx?.baseLatency ?? 0;
    const output = base + (ctx?.outputLatency ?? 0);
    const settings = this.inputs.inputSettings ?? {};
    return {
      sampleRate: Tone.getContext().sampleRate,
      output,
      input: typeof settings.latency === "number" ? settings.latency : 0,
      effects: this.compensation.total,
      compensated: this.compensation.compensated,
    };
  }

  /** The audio devices' own sample rates, when known: the output's (what a
   * plain AudioContext gets) and the input's (the mic stream's). When they
   * differ from the engine's rate the browser converts, which can add
   * latency. */
  async getDeviceRates(): Promise<{ output: number | null; input: number | null }> {
    let output: number | null = null;
    try {
      const probe = new AudioContext();
      output = probe.sampleRate;
      void probe.close();
    } catch {
      // No way to ask.
    }
    const input = this.inputs.inputSettings?.sampleRate ?? null;
    return { output, input };
  }

  setMasterVolume(db: number): void {
    this.ensureMaster().channel.volume.value = db;
  }

  setMasterPan(pan: number): void {
    this.ensureMaster().channel.pan.value = pan;
  }

  /** Ceiling the master limiter won't let the mix exceed, in dB (e.g. -1). */
  setMasterLimiterThreshold(db: number): void {
    this.ensureMaster().limiter.setCeiling(db);
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
    instrumentSettings?: InstrumentSettings
  ): void {
    if (this.channels.has(id)) return;

    const meter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
    // channelCount: 2 - Tone.Channel's Panner defaults to channelCount 1
    // with channelCountMode "explicit", which per the Web Audio spec means
    // *any* input, stereo included, gets downmixed to mono before panning.
    // Left at that default, every channel strip silently collapsed stereo
    // content (a stereo delay/ping-pong, anything genuinely wide) to mono,
    // and - since it happens at both this channel and the master channel in
    // series - added a spurious ~6dB loss even on already-mono sources
    // (each equal-power mono-to-stereo pan stage costs ~3dB on its own).
    const channel = new Tone.Channel({ volume: 0, pan: 0, channelCount: 2 }).connect(meter);
    // Its dry route to the master is set by updateCompensation.
    const muteGain = new Tone.Gain(1).connect(channel);
    const pdc = new Tone.Delay(0, MAX_COMPENSATION).connect(muteGain);
    const taps: SidechainTaps = { preFx: new Tone.Gain(), postFx: new Tone.Gain(), postFader: new Tone.Gain() };
    const head = new Tone.Gain();
    taps.preFx.connect(head);
    taps.postFx.connect(pdc);
    channel.connect(taps.postFader);
    const routeIn = new Tone.Gain().connect(taps.preFx);
    const ownDelay = new Tone.Delay(0, MAX_COMPENSATION).connect(taps.preFx);
    const sendTap = new Tone.Delay(0, MAX_COMPENSATION);
    channel.connect(sendTap);
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
      instrument: createInstrument(channelType === "midi" ? instrument : null, onSettled, instrumentSettings),
      part: null,
      heldNotes: new Set(),
      effects: [],
      audioClips: new Map(),
      sends: new Map(),
      userMuted: false,
      muteGain,
      audible: true,
      pdc,
      routeIn,
      ownDelay,
      sendTap,
      taps,
      head,
      route: null,
    });
    this.rewireChannel(id);
    // Tracks listening to this one (rebuilt by undo, say) plug back in.
    this.inputs.replug();
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
    nodes.pdc.dispose();
    nodes.muteGain.dispose();
    nodes.routeIn.dispose();
    nodes.ownDelay.dispose();
    nodes.sendTap.dispose();
    Object.values(nodes.taps).forEach((tap) => tap.dispose());
    nodes.head.dispose();
    nodes.channel.dispose();
    nodes.meter.dispose();
    this.channels.delete(id);
    this.soloedIds.delete(id);
    this.automation.delete(id);
    this.sustainedChannels.delete(id);
    this.sustainPending.delete(id);
    // An open monitor input is kept (just unplugged): undo/redo tears every
    // channel down and rebuilds it with the same id, and addChannel plugs
    // the input back in. Turning monitoring off is what closes it.
    this.inputs.monitor(id)?.disconnect();
    if (this.recording?.channelId === id) {
      this.recording = null;
    }
    this.refreshMix();
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
    const monitor = this.inputs.monitor(id);
    monitor?.disconnect();

    // Live input (monitoring) is a source like a clip, so it's heard
    // through the track's effects - an amp, a cab IR - not around them.
    type Connectable = { connect: (n: Tone.InputNode) => unknown };
    // A group's only source is what its members route in (routeIn).
    const sources: Connectable[] =
      nodes.channelType === "audio"
        ? [...[...nodes.audioClips.values()].map((c) => c.gain), ...(monitor ? [monitor] : [])]
        : nodes.channelType === "midi"
          ? [nodes.instrument]
          : [];
    sources.forEach((source) => source.connect(nodes.ownDelay));
    nodes.head.disconnect();
    this.wireEffectsChain([nodes.head], nodes.effects, nodes.taps.postFx);
    this.refreshMix();
  }

  /** Same as `rewireChannel`, but for a bus: its "source" is always just
   * its stable send-input tap. */
  private rewireBus(id: string): void {
    const bus = this.buses.get(id);
    if (!bus) return;
    bus.head.disconnect();
    this.wireEffectsChain([bus.head], bus.effects, bus.taps.postFx);
    this.refreshMix();
  }

  /** Swaps the instrument a MIDI track plays through (e.g. Piano -> Drums,
   * or null to leave the track empty), disposing the old one and
   * reconnecting the signal chain. No-op on an audio channel. */
  setInstrument(id: string, type: InstrumentType | null, settings?: InstrumentSettings): void {
    const nodes = this.channels.get(id);
    if (!nodes || nodes.channelType !== "midi" || nodes.instrumentType === type) return;
    nodes.instrument.dispose();
    this.pendingLoads += 1;
    this.setReady(false);
    const onSettled = () => {
      this.pendingLoads = Math.max(0, this.pendingLoads - 1);
      if (this.pendingLoads === 0) this.setReady(true);
    };
    nodes.instrument = createInstrument(type, onSettled, settings);
    nodes.instrumentType = type;
    this.rewireChannel(id);
  }

  /** Applies new settings (the synth's patch, the Drum Rack's kit) to the
   * instrument a track plays. Settings for another instrument are ignored -
   * e.g. a stale edit arriving right after switching to the piano. */
  setInstrumentSettings(id: string, settings: InstrumentSettings): void {
    const nodes = this.channels.get(id);
    if (nodes) updateInstrument(nodes.instrumentType, nodes.instrument, settings);
  }

  /** Plays one of a track's drum pads now (clicking it in the Drum Rack). */
  auditionDrumPad(id: string, pad: number, velocity = 0.9): void {
    const nodes = this.channels.get(id);
    if (nodes?.instrumentType === "drums") (nodes.instrument as DrumRack).audition(pad, velocity);
  }

  private preview: { rack: DrumRack; gain: Tone.Gain; timer: number } | null = null;
  private previewToken = 0;

  /** Plays drum hits once on a kit through the master bus (a groove
   * previewed from the browser), replacing any preview still playing.
   * `time` is seconds from now. Resolves when the hits are scheduled. */
  async previewDrums(kit: DrumKitParams, hits: { pad: number; time: number; velocity: number }[]): Promise<void> {
    this.stopPreview();
    const token = ++this.previewToken;
    await this.ensureStarted();
    const rack = new DrumRack(kit);
    const gain = new Tone.Gain(Tone.dbToGain(-3));
    rack.connect(gain);
    gain.connect(this.ensureMaster().channel);
    await rack.ready;
    if (token !== this.previewToken) {
      rack.dispose();
      gain.dispose();
      return;
    }
    const start = Tone.now() + 0.05;
    hits.forEach((h) => rack.triggerAttack(Tone.Frequency(padNote(h.pad), "midi").toNote(), start + h.time, h.velocity));
    const end = hits.reduce((m, h) => Math.max(m, h.time), 0) + 2.5;
    this.preview = { rack, gain, timer: window.setTimeout(() => this.stopPreview(), end * 1000) };
  }

  stopPreview(): void {
    this.previewToken++;
    if (!this.preview) return;
    window.clearTimeout(this.preview.timer);
    this.preview.rack.dispose();
    this.preview.gain.dispose();
    this.preview = null;
  }

  /** Live pad hits from a track's Drum Rack, for its window. Returns a function that stops it. */
  watchDrums(id: string, listener: (state: DrumLiveState) => void): () => void {
    const nodes = this.channels.get(id);
    if (nodes?.instrumentType !== "drums") return () => {};
    const rack = nodes.instrument as DrumRack;
    rack.setMonitor(listener);
    return () => rack.setMonitor(null);
  }

  /** Live state from a track's synth (for its window), or nothing if the
   * track isn't playing the synth. Returns a function that stops it. */
  watchSynth(id: string, listener: (state: SynthLiveState) => void): () => void {
    const nodes = this.channels.get(id);
    if (nodes?.instrumentType !== "synth") return () => {};
    const synth = nodes.instrument as SynthInstrument;
    synth.setMonitor(listener);
    return () => synth.setMonitor(null);
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

  /** The live audio context's sample rate - what uploaded files are
   * decoded at. */
  get sampleRate(): number {
    return Tone.getContext().sampleRate;
  }

  /** Loads an uploaded file (see effectFiles.ts) into a file-based effect -
   * an IR into the IR Loader, a model into the NAM Amp - or clears it with
   * null. If another file is asked for before this one finishes, only the
   * newest request takes effect. Resolves with an error message if the file
   * couldn't be used (the effect keeps what it had). */
  async setEffectFile(id: string, effectId: string, fileId: string | null): Promise<string | null> {
    const effect = this.effectsHost(id)?.host.effects.find((e) => e.id === effectId);
    if (!effect) return null;
    effect.fileId = fileId;
    const node = effect.node;
    if (node instanceof IrLoaderChain) {
      const buffer = fileId ? await decodeEffectFileAudio(fileId, this.sampleRate) : null;
      if (effect.fileId !== fileId) return null;
      this.safe(() => node.setImpulse(buffer));
      return fileId && !buffer ? "Couldn't read the IR file." : null;
    }
    if (node instanceof NamAmpChain) {
      const json = fileId ? await readEffectFileText(fileId) : null;
      if (effect.fileId !== fileId) return null;
      if (fileId && json === null) return "The model file is missing.";
      return node.setModel(fileId, json);
    }
    return null;
  }

  /** The spectrum before or after a Parametric EQ or Multiband Compressor
   * (dB per FFT bin), for its window's analyzer. Null for other effects. */
  getSpectrum(hostId: string, effectId: string, which: "pre" | "post"): Float32Array | null {
    const effect = this.effectsHost(hostId)?.host.effects.find((e) => e.id === effectId);
    return effect?.node instanceof ParamEqChain || effect?.node instanceof MultibandChain ? effect.node.spectrum(which) : null;
  }

  /** Auditions one band (0-based) of a Parametric EQ or Multiband
   * Compressor, or -1 for none. */
  setBandSolo(hostId: string, effectId: string, band: number): void {
    const effect = this.effectsHost(hostId)?.host.effects.find((e) => e.id === effectId);
    if (effect?.node instanceof ParamEqChain || effect?.node instanceof MultibandChain) effect.node.setSolo(band);
  }

  /** One Utility's output meters and scope points (null if it isn't one,
   * or no audio is flowing). */
  getUtilityMeters(hostId: string, effectId: string): UtilityMeters | null {
    const effect = this.effectsHost(hostId)?.host.effects.find((e) => e.id === effectId);
    return effect?.node instanceof UtilityChain ? effect.node.meters : null;
  }

  /** The latest audio going into one Tuner, for pitch detection. */
  getTunerWaveform(hostId: string, effectId: string): Float32Array | null {
    const effect = this.effectsHost(hostId)?.host.effects.find((e) => e.id === effectId);
    return effect?.node instanceof TunerChain ? effect.node.waveform : null;
  }

  /** Each band's live gain and level in one Multiband Compressor, for its
   * window. Null if that effect isn't one. */
  getMultibandMeters(hostId: string, effectId: string): MultibandMeters | null {
    const effect = this.effectsHost(hostId)?.host.effects.find((e) => e.id === effectId);
    return effect?.node instanceof MultibandChain ? effect.node.meters : null;
  }

  /** Recent level readings of one Noise Gate, for its window's graph.
   * Null if that effect isn't a gate. */
  getGateHistory(hostId: string, effectId: string): GateReading[] | null {
    const effect = this.effectsHost(hostId)?.host.effects.find((e) => e.id === effectId);
    return effect?.node instanceof NoiseGate ? effect.node.history : null;
  }

  /** Level going into one NAM Amp's model (after its Input knob), in dB -
   * for the amp window's input meter. Null if that effect isn't an amp. */
  getNamInputLevel(hostId: string, effectId: string): number | null {
    const effect = this.effectsHost(hostId)?.host.effects.find((e) => e.id === effectId);
    return effect?.node instanceof NamAmpChain ? effect.node.inputLevelDb : null;
  }

  setEffectParam(id: string, effectId: string, key: string, value: number): void {
    const target = this.effectsHost(id);
    const effect = target?.host.effects.find((e) => e.id === effectId);
    if (!effect) return;
    this.safe(() => applyEffectParam(effect.node, effect.type, key, value));
    // The settings that change how late an effect is.
    if (key === "oversample" || (effect.type === "pitchShift" && key === "window")) this.refreshMix();
  }

  // --- Sidechains (see sidechainRouting.ts) ---

  /** Per keyed effect: its source tap -> a delay lining the key up -> the
   * effect's sidechain input, and a meter on the key. */
  private sidechainLinks = new Map<
    string,
    { tap: Tone.Gain; delay: Tone.Delay; meter: Tone.Meter; node: SidechainNode }
  >();

  /** The routing and its latencies as last planned (refreshMix keeps it
   * current). */
  private routingSnapshot(): RoutingSnapshot {
    return (this.mix ?? planMix(this.mixInput())).snapshot;
  }

  private effectHosts(): [string, EffectNode[]][] {
    return [
      ...[...this.channels].map(([id, n]): [string, EffectNode[]] => [id, n.effects]),
      ...[...this.buses].map(([id, b]): [string, EffectNode[]] => [id, b.effects]),
      ["master", this.masterEffects],
    ];
  }

  /** Connects every keyed effect to its source as the plan says (and
   * disconnects the rest). */
  private applySidechains(mix: MixGraph): void {
    for (const [, effects] of this.effectHosts()) {
      for (const e of effects) {
        const node = e.node;
        if (!isSidechainNode(node)) continue;
        const link = mix.sidechains.get(e.id);
        const from = link ? (this.channels.get(link.source) ?? this.buses.get(link.source)) : undefined;
        const tap = from && link ? from.taps[link.tap] : null;
        let wired = this.sidechainLinks.get(e.id);
        if (wired && (wired.tap !== tap || wired.node !== node)) {
          this.dropSidechainLink(e.id);
          wired = undefined;
        }
        if (tap && !wired) {
          const delay = new Tone.Delay(0, MAX_COMPENSATION);
          const meter = new Tone.Meter({ smoothing: 0.6 });
          tap.connect(delay);
          delay.connect(node.sidechainInput);
          delay.connect(meter);
          wired = { tap, delay, meter, node };
          this.sidechainLinks.set(e.id, wired);
        }
        if (wired && link && Math.abs(Number(wired.delay.delayTime.value) - link.delay) > 1e-7) wired.delay.delayTime.value = link.delay;
        node.setSidechainActive(!!(wired && link));
      }
    }
    [...this.sidechainLinks.keys()].forEach((id) => mix.sidechains.has(id) || this.dropSidechainLink(id));
  }

  private dropSidechainLink(effectId: string): void {
    const link = this.sidechainLinks.get(effectId);
    if (!link) return;
    try {
      link.tap.disconnect(link.delay);
    } catch {
      // The source is already gone.
    }
    link.delay.dispose();
    link.meter.dispose();
    this.sidechainLinks.delete(effectId);
  }

  /** Sets where a dynamics effect's detector listens (undefined: its own
   * input). */
  setEffectSidechain(hostId: string, effectId: string, routing: SidechainRouting | undefined): void {
    const effect = this.effectsHost(hostId)?.host.effects.find((e) => e.id === effectId);
    if (!effect) return;
    effect.sidechain = routing ? { ...routing } : undefined;
    this.refreshMix();
  }

  /** Whether an effect's key is connected, and its level (dB) - null if the
   * effect doesn't exist. */
  getSidechainState(hostId: string, effectId: string): { connected: boolean; levelDb: number } | null {
    const effect = this.effectsHost(hostId)?.host.effects.find((e) => e.id === effectId);
    if (!effect) return null;
    const link = this.sidechainLinks.get(effectId);
    if (!link) return { connected: false, levelDb: -Infinity };
    const v = link.meter.getValue();
    const db = Array.isArray(v) ? v[0] : v;
    return { connected: true, levelDb: Number.isFinite(db) ? db : -Infinity };
  }

  /** Which tracks and buses an effect on `hostId` could take its key from
   * without making a feedback loop. */
  sidechainSourcesAllowed(hostId: string, effectId: string): Set<string> {
    const snapshot = this.routingSnapshot();
    const others = (this.mix?.requests ?? []).filter((r) => r.effectId !== effectId);
    const ids = [...this.channels.keys(), ...this.buses.keys()];
    return new Set(ids.filter((id) => canKeyFrom(snapshot, others, hostId, id)));
  }

  // --- Send/return buses ---

  addBus(id: string): void {
    if (this.buses.has(id)) return;
    const input = new Tone.Gain(1);
    const meter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
    const channel = new Tone.Channel({ volume: 0, pan: 0, channelCount: 2 }) // see addChannel's comment
      .connect(meter)
      .connect(this.ensureMaster().channel);
    const pdc = new Tone.Delay(0, MAX_COMPENSATION).connect(channel);
    const taps: SidechainTaps = { preFx: input, postFx: new Tone.Gain(), postFader: new Tone.Gain() };
    const head = new Tone.Gain();
    input.connect(head);
    taps.postFx.connect(pdc);
    channel.connect(taps.postFader);
    this.buses.set(id, { input, channel, meter, effects: [], pdc, taps, head });
    this.rewireBus(id);
  }

  removeBus(id: string): void {
    const bus = this.buses.get(id);
    if (!bus) return;
    bus.effects.forEach((e) => e.node.dispose());
    bus.input.dispose();
    bus.taps.postFx.dispose();
    bus.taps.postFader.dispose();
    bus.head.dispose();
    bus.pdc.dispose();
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
    this.refreshMix();
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
        this.refreshMix();
      }
      return;
    }
    if (!gain) {
      gain = new Tone.Gain(Tone.dbToGain(db));
      nodes.sendTap.connect(gain);
      gain.connect(bus.input);
      nodes.sends.set(busId, gain);
      // Sends can close (or open) a sidechain loop.
      this.refreshMix();
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

  /** Tells the engine every track's group and output (see routing.ts). */
  setRouting(nodes: RouteNode[]): void {
    this.routeNodes = nodes.map((n) => ({ id: n.id, type: n.type, groupId: n.groupId, output: n.output, input: n.input }));
    this.refreshMix();
    this.inputs.replug();
  }

  setMute(id: string, muted: boolean): void {
    const nodes = this.channels.get(id);
    if (!nodes) return;
    nodes.userMuted = muted;
    this.refreshMix();
  }

  setSolo(id: string, solo: boolean): void {
    if (solo) this.soloedIds.add(id);
    else this.soloedIds.delete(id);
    this.refreshMix();
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
  getCompressorMeters(hostId: string, effectId: string): CompressorMeterReading | null {
    const effect = this.effectsHost(hostId)?.host.effects.find((e) => e.id === effectId);
    return effect?.node instanceof CompressorChain ? effect.node.meters : null;
  }

  /** One Multiband Dynamics' per-band input/output levels. */
  getMbDynamicsMeters(hostId: string, effectId: string): MbdMeters | null {
    const effect = this.effectsHost(hostId)?.host.effects.find((e) => e.id === effectId);
    return effect?.node instanceof MbDynamicsChain ? effect.node.meters : null;
  }

  /** One Glue Compressor's gain reduction, output level and Clip LED. */
  getGlueMeters(hostId: string, effectId: string): GlueMeterReading | null {
    const effect = this.effectsHost(hostId)?.host.effects.find((e) => e.id === effectId);
    return effect?.node instanceof GlueChain ? effect.node.meters : null;
  }

  /** Live peak input (after the plugin's gain), output, and gain reduction
   * for one Limiter effect instance, for its window's meters. Null if that
   * effect isn't a limiter (or doesn't exist). */
  getLimiterMeters(hostId: string, effectId: string): LimiterLevels | null {
    const target = this.effectsHost(hostId);
    const effect = target?.host.effects.find((e) => e.id === effectId);
    if (!effect || effect.type !== "limiter") return null;
    return (effect.node as LookaheadLimiter).meterLevels;
  }

  /** Live note-on: plays at the audio clock's current time, not the
   * transport's lookahead (context.ts). */
  noteOn(channelId: string, note: string, velocity = 0.8): void {
    const nodes = this.channels.get(channelId);
    if (!nodes || nodes.heldNotes.has(note)) return;
    nodes.heldNotes.add(note);
    this.safe(() => nodes.instrument.triggerAttack(note, Tone.immediate(), velocity));

    if (this.recording?.channelId === channelId) this.recording.noteOn(note, velocity, Tone.getContext().currentTime);
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
      this.safe(() => nodes.instrument.triggerRelease(note, Tone.immediate()));
    }

    if (this.recording?.channelId === channelId) this.recording.noteOff(note);
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
      onerror: (error) => {
        onSettled();
        // The clip stays silent: its audio couldn't be loaded.
        noteIssue("clip.load", error);
      },
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
    this.transport.play();
  }

  /** Pauses playback in place - unlike stopAll, the transport position is
   * preserved so playback can resume from the same spot. */
  pauseAll(): void {
    this.transport.pause();
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
    this.transport.stop();
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
      this.audioRecording.recorder.cancel();
      this.audioRecording = null;
    }
  }

  /** Moves the playhead to an absolute position on the timeline, whether
   * the transport is currently playing, paused, or stopped. */
  seekTo(seconds: number): void {
    this.transport.seek(seconds);
  }

  /** Arms a channel for recording and starts the transport (other channels'
   * clips still play back). `countInBeats` > 0 plays that many audible
   * clicks first and only starts the transport/recording once they finish,
   * like a real DAW's pre-roll. */
  async startRecording(channelId: string, countInBeats = 0, fromSeconds = 0, beforeStart?: () => void): Promise<void> {
    await this.ensureStarted();
    if (!this.channels.has(channelId)) return;
    beforeStart?.();
    const startTime = this.transport.startRecording(countInBeats, fromSeconds);
    this.recording = new MidiTake(channelId, fromSeconds, startTime, () => this.transport.seconds - this.midiRecordShift(channelId) - fromSeconds);
  }

  /** Where on the timeline the take being recorded starts (s), for
   * drawing it; null when not recording. */
  get recordingFrom(): number | null {
    return this.recording?.from ?? this.audioRecording?.from ?? null;
  }

  /** How far to move a recorded MIDI note earlier: a live (armed) track
   * skips delay compensation, so to sound in time you play it that much
   * after the beat. */
  private midiRecordShift(channelId: string): number {
    const nodes = this.channels.get(channelId);
    if (!nodes || !this.isLive(channelId, nodes) || !this.delayCompensation) return 0;
    return Math.max(0, this.compensation.compensated - chainLatency(nodes.effects));
  }

  /**
   * Stops recording, finalizes the clip, and returns the recorded notes.
   * `offsetSeconds` is the clip's current position on the timeline, so
   * playback scheduling doesn't get reset to the start of the timeline.
   */
  finishRecording(offsetSeconds?: number): NoteEvent[] {
    const take = this.recording;
    if (!take) return [];
    const nodes = this.channels.get(take.channelId);
    take.heldNotes.forEach((note) => this.safe(() => nodes?.instrument.triggerRelease(note, Tone.immediate())));
    nodes?.heldNotes.clear();
    this.recording = null;
    const events = take.finish();
    this.setClip(take.channelId, events, offsetSeconds ?? take.from);
    return events;
  }

  /** What's being recorded right now, for drawing it on the timeline as it
   * comes in: the take's waveform so far (audio), or its notes (MIDI). */
  getRecordingPreview():
    | { channelId: string; kind: "audio"; waveform: Waveform | null; version: number }
    | { channelId: string; kind: "midi"; notes: readonly NoteEvent[]; held: NoteEvent[] }
    | null {
    if (this.audioRecording) {
      const live = this.audioRecording.recorder.previewWaveform;
      return { channelId: this.audioRecording.channelId, kind: "audio", waveform: live?.waveform ?? null, version: live?.version ?? 0 };
    }
    const take = this.recording;
    if (!take) return null;
    return { channelId: take.channelId, kind: "midi", ...take.preview() };
  }

  get isRecording(): boolean {
    return this.recording !== null || this.audioRecording !== null;
  }

  // --- Inputs and monitoring (inputs.ts) ---

  private inputs = new InputManager({
    hasTrack: (id) => this.channels.has(id),
    tap: (trackId, tap) => this.channels.get(trackId)?.taps[tap] ?? null,
    ensureStarted: () => this.ensureStarted(),
    rewireTrack: (id) => this.rewireChannel(id),
  });

  getInputPeak(): number | null {
    return this.inputs.getInputPeak();
  }
  openInput(): Promise<void> {
    return this.inputs.openInput();
  }
  requestMicAccess(): Promise<void> {
    return this.inputs.requestMicAccess();
  }
  setMicDevice(deviceId: string | null): void {
    this.inputs.setMicDevice(deviceId);
  }
  listInputDevices(): Promise<{ deviceId: string; label: string }[]> {
    return this.inputs.listInputDevices();
  }
  setInputMonitoring(channelId: string, enabled: boolean): Promise<boolean> {
    return this.inputs.setInputMonitoring(channelId, enabled);
  }
  isInputMonitoring(channelId: string): boolean {
    return this.inputs.isMonitoring(channelId);
  }

  // --- Audio (microphone) recording ---

  /** Recording latency correction: a measured round trip (replacing the
   * browser's estimate) and a manual offset (ms, positive = earlier). */
  private measuredRoundTrip: number | null = null;
  private recordingOffsetMs = 0;

  setRecordingCorrection(measuredRoundTrip: number | null, offsetMs: number): void {
    this.measuredRoundTrip = measuredRoundTrip;
    this.recordingOffsetMs = offsetMs;
  }

  /** The audio round trip (s): output to the speakers plus input from the
   * mic - measured if available, else what the browser reports. */
  getRoundTrip(): { seconds: number; measured: boolean } {
    if (this.measuredRoundTrip !== null) return { seconds: this.measuredRoundTrip, measured: true };
    const info = this.getLatencyInfo();
    return { seconds: info.output + info.input, measured: false };
  }

  /** How late a recorded sound lands after the beat it was played to (s):
   * the mix's latency to the speakers, through the air/cable, back in,
   * plus the manual offset. The take is trimmed by this. */
  getRecordingLatency(): number {
    return this.compensation.total + this.getRoundTrip().seconds + this.recordingOffsetMs / 1000;
  }

  /**
   * Requests microphone access (prompting the user the first time) and
   * arms a channel to capture the input as an audio clip, starting the
   * transport from the top like MIDI recording does. The input is captured
   * sample-accurately (see inputRecorder.ts) from before the count-in, so
   * the take can be lined up exactly. `beforeStart` runs just before the
   * transport starts (the page shows it's recording then, so its redraw
   * doesn't land on the first beat).
   */
  async startAudioRecording(channelId: string, countInBeats = 0, fromSeconds = 0, beforeStart?: () => void): Promise<void> {
    await this.ensureStarted();
    if (!this.channels.has(channelId)) return;
    // From another track ("Audio From"), or the audio interface.
    const trackNode = this.inputs.trackInputNode(channelId);
    if (trackNode === null) throw new Error("The track this one takes its input from is gone.");
    // Another track's audio is stereo; the interface is recorded in mono
    // (one input, see inputs.ts).
    const recorder = trackNode
      ? await InputRecorder.start(Tone.getContext(), trackNode, 2)
      : await InputRecorder.start(Tone.getContext(), await this.inputs.ensureMicSource());
    if (!this.channels.has(channelId)) {
      recorder.cancel();
      return;
    }
    beforeStart?.();
    const startTime = this.transport.startRecording(countInBeats, fromSeconds);
    // A track's audio reaches its tap a known time after the beat (its
    // delay compensation and effects); the interface's comes back after the
    // round trip.
    const input = this.inputs.trackInput(channelId);
    const latency = trackNode && input ? tapLatency(this.routingSnapshot(), input.track, input.tap) : this.getRecordingLatency();
    this.audioRecording = { channelId, recorder, startTime, from: fromSeconds, latency, fromTrack: !!trackNode };
    recorder.startPreview(startTime + latency);
  }

  /** Stops the capture and returns the take as a WAV Blob - trimmed so its
   * first sample is what was played on the downbeat - or null if nothing
   * was being recorded. */
  async finishAudioRecording(): Promise<Blob | null> {
    const rec = this.audioRecording;
    if (!rec) return null;
    this.audioRecording = null;
    const channels = await rec.recorder.stop(rec.startTime + rec.latency);
    // A take from another track can go over full scale (before its fader,
    // say): kept as float so nothing clips. An interface input can't.
    return channels[0].length > 0 ? takeToWav(channels, rec.recorder.sampleRate, rec.fromTrack) : null;
  }

  /** Measures the real round trip: plays a few clicks straight to the
   * output and listens for them on the input (speakers into the mic, or a
   * cable from the interface's output to its input). Resolves with seconds,
   * or null if they weren't heard clearly. */
  async measureRoundTrip(): Promise<number | null> {
    await this.ensureStarted();
    const ctx = Tone.getContext();
    const recorder = await InputRecorder.start(ctx, await this.inputs.ensureMicSource());
    const sr = ctx.sampleRate;
    const click = ctx.createBuffer(1, Math.round(0.004 * sr), sr);
    const data = click.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = 0.5 * Math.sin((2 * Math.PI * 2500 * i) / sr) * Math.sin((Math.PI * i) / data.length);
    }
    const from = Tone.now() + 0.1;
    const times = [0.3, 0.9, 1.5, 2.1, 2.7].map((t) => from + t);
    for (const t of times) {
      const src = ctx.createBufferSource();
      src.buffer = click;
      // Past the master (so no effects or compensation), not muted by it.
      Tone.connect(src, Tone.getDestination());
      src.start(t);
    }
    await new Promise((r) => setTimeout(r, (times[times.length - 1] - ctx.currentTime + 0.6) * 1000));
    const [samples] = await recorder.stop(from);
    return detectRoundTrip(samples, sr, times.map((t) => Math.round((t - from) * sr)), data);
  }

  get isAudioRecording(): boolean {
    return this.audioRecording !== null;
  }

  setBpm(bpm: number): void {
    this.transport.setBpm(bpm);
    setSynthTempo(bpm);
  }

  setTimeSignature(beatsPerBar: number): void {
    this.transport.setBeatsPerBar(beatsPerBar);
  }

  getTransportSeconds(): number {
    return this.transport.seconds;
  }

  /** Sets (or clears) the transport's loop region. When enabled, playback
   * that reaches `endSeconds` jumps back to `startSeconds` and keeps going
   * instead of running off the end of the loop. */
  setLoop(enabled: boolean, startSeconds: number, endSeconds: number): void {
    this.transport.setLoop(enabled, startSeconds, endSeconds);
  }

  getTransportState(): "started" | "stopped" | "paused" {
    return this.transport.state;
  }

  setMetronome(enabled: boolean): void {
    this.transport.setMetronome(enabled);
  }
}

export const audioEngine = new AudioEngine();
