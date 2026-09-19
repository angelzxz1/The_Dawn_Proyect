import * as Tone from "tone";
import type { NoteEvent, InstrumentType, ChannelType } from "./types";
import { PIANO_SAMPLE_BASE_URL, PIANO_SAMPLE_URLS } from "./piano";
import { DrumKit, NullInstrument, type Instrument } from "./drumKit";
import { type EffectType, defaultParams } from "./effects";

interface EffectNode {
  id: string;
  type: EffectType;
  node: Tone.ToneAudioNode;
}

interface ChannelNodes {
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
  effects: EffectNode[];
  /** An audio channel can hold several independent clips at once, each its
   * own Tone.Player keyed by clip instance id. */
  audioPlayers: Map<string, Tone.Player>;
}

interface RecordingState {
  channelId: string;
  /** Notes currently down during the recording, keyed by note name. */
  open: Map<string, { time: number; velocity: number }>;
  events: NoteEvent[];
}

const MIN_NOTE_DURATION = 0.05;
let effectIdCounter = 0;

function createInstrument(
  type: InstrumentType | null,
  onSettled: () => void
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
  return new Tone.Sampler({
    urls: PIANO_SAMPLE_URLS,
    baseUrl: PIANO_SAMPLE_BASE_URL,
    release: 1,
    attack: 0,
    onload: onSettled,
    onerror: onSettled,
  });
}

function createEffectNode(type: EffectType, params: Record<string, number>): Tone.ToneAudioNode {
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
      return new Tone.Compressor({
        threshold: params.threshold,
        ratio: params.ratio,
        attack: params.attack,
        release: params.release,
      });
    case "delay":
      return new Tone.FeedbackDelay({
        delayTime: params.delayTime,
        feedback: params.feedback,
        wet: params.wet,
      });
    case "reverb":
      return new Tone.Reverb({ decay: params.decay, wet: params.wet });
  }
}

function applyEffectParam(
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
      const comp = node as Tone.Compressor;
      if (key === "threshold") comp.threshold.value = value;
      else if (key === "ratio") comp.ratio.value = value;
      else if (key === "attack") comp.attack.value = value;
      else if (key === "release") comp.release.value = value;
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
  }
}

class AudioEngine {
  private channels = new Map<string, ChannelNodes>();
  private started = false;
  private startPromise: Promise<void> | null = null;
  private recording: RecordingState | null = null;
  private pendingLoads = 0;
  private readyListeners = new Set<() => void>();
  private micStream: MediaStream | null = null;
  private audioRecording: { channelId: string; recorder: MediaRecorder; chunks: Blob[] } | null =
    null;

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
  // the speakers, so the Master track's fader/meter reflects the real mix. ---
  private masterChannel: Tone.Channel | null = null;
  private masterMeter: Tone.Meter | null = null;

  private ensureMaster(): { channel: Tone.Channel; meter: Tone.Meter } {
    if (!this.masterChannel || !this.masterMeter) {
      this.masterMeter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
      this.masterChannel = new Tone.Channel({ volume: 0, pan: 0 })
        .connect(this.masterMeter)
        .toDestination();
    }
    return { channel: this.masterChannel, meter: this.masterMeter };
  }

  setMasterVolume(db: number): void {
    this.ensureMaster().channel.volume.value = db;
  }

  setMasterPan(pan: number): void {
    this.ensureMaster().channel.pan.value = pan;
  }

  /** Current master output level, 0-1. */
  getMasterLevel(): number {
    const value = this.ensureMaster().meter.getValue();
    const level = Array.isArray(value) ? value[0] : value;
    return Number.isFinite(level) ? level : 0;
  }

  addChannel(id: string, channelType: ChannelType, instrument: InstrumentType | null): void {
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
      instrument: createInstrument(channelType === "midi" ? instrument : null, onSettled),
      part: null,
      heldNotes: new Set(),
      effects: [],
      audioPlayers: new Map(),
    });
    this.rewireChannel(id);
  }

  removeChannel(id: string): void {
    const nodes = this.channels.get(id);
    if (!nodes) return;
    nodes.part?.dispose();
    nodes.instrument.dispose();
    nodes.audioPlayers.forEach((p) => p.dispose());
    nodes.effects.forEach((e) => e.node.dispose());
    nodes.channel.dispose();
    nodes.meter.dispose();
    this.channels.delete(id);
    if (this.recording?.channelId === id) {
      this.recording = null;
    }
  }

  /** Reconnects a channel's active sound source(s) - its instrument for a
   * MIDI channel, or every one of its clips' players for an audio channel
   * (the channel's `type` is fixed for its lifetime) - through the effects
   * chain, in order, into the channel strip. Called whenever the
   * instrument, an audio player, or the effects chain itself changes. */
  private rewireChannel(id: string): void {
    const nodes = this.channels.get(id);
    if (!nodes) return;

    // disconnect() with no args drops every outgoing connection, so both
    // possible sources can be safely detached here regardless of which one
    // is currently active.
    nodes.instrument.disconnect();
    nodes.audioPlayers.forEach((p) => p.disconnect());
    nodes.effects.forEach((e) => e.node.disconnect());

    type Connectable = { connect: (n: Tone.InputNode) => unknown };
    const sources: Connectable[] =
      nodes.channelType === "audio" ? [...nodes.audioPlayers.values()] : [nodes.instrument];
    if (sources.length === 0) return; // audio channel with nothing loaded yet

    const firstEffect = nodes.effects[0]?.node ?? nodes.channel;
    sources.forEach((source) => source.connect(firstEffect));
    for (let i = 0; i < nodes.effects.length; i++) {
      const next = nodes.effects[i + 1]?.node ?? nodes.channel;
      nodes.effects[i].node.connect(next);
    }
  }

  /** Swaps the instrument a MIDI track plays through (e.g. Piano -> Drums,
   * or null to leave the track empty), disposing the old one and
   * reconnecting the signal chain. No-op on an audio channel. */
  setInstrument(id: string, type: InstrumentType | null): void {
    const nodes = this.channels.get(id);
    if (!nodes || nodes.channelType !== "midi" || nodes.instrumentType === type) return;
    nodes.instrument.dispose();
    this.pendingLoads += 1;
    this.setReady(false);
    const onSettled = () => {
      this.pendingLoads = Math.max(0, this.pendingLoads - 1);
      if (this.pendingLoads === 0) this.setReady(true);
    };
    nodes.instrument = createInstrument(type, onSettled);
    nodes.instrumentType = type;
    this.rewireChannel(id);
  }

  // --- Effects chain ---

  addEffect(id: string, type: EffectType): { id: string; type: EffectType; params: Record<string, number> } | null {
    const nodes = this.channels.get(id);
    if (!nodes) return null;
    const params = defaultParams(type);
    const node = createEffectNode(type, params);
    const effectId = `fx-${++effectIdCounter}`;
    nodes.effects.push({ id: effectId, type, node });
    this.rewireChannel(id);
    return { id: effectId, type, params };
  }

  removeEffect(id: string, effectId: string): void {
    const nodes = this.channels.get(id);
    if (!nodes) return;
    const idx = nodes.effects.findIndex((e) => e.id === effectId);
    if (idx === -1) return;
    nodes.effects[idx].node.dispose();
    nodes.effects.splice(idx, 1);
    this.rewireChannel(id);
  }

  /** Moves an effect one slot earlier (-1) or later (+1) in the chain. */
  reorderEffect(id: string, effectId: string, direction: -1 | 1): void {
    const nodes = this.channels.get(id);
    if (!nodes) return;
    const idx = nodes.effects.findIndex((e) => e.id === effectId);
    const target = idx + direction;
    if (idx === -1 || target < 0 || target >= nodes.effects.length) return;
    const [entry] = nodes.effects.splice(idx, 1);
    nodes.effects.splice(target, 0, entry);
    this.rewireChannel(id);
  }

  setEffectParam(id: string, effectId: string, key: string, value: number): void {
    const nodes = this.channels.get(id);
    const effect = nodes?.effects.find((e) => e.id === effectId);
    if (!effect) return;
    this.safe(() => applyEffectParam(effect.node, effect.type, key, value));
  }

  setVolume(id: string, db: number): void {
    const nodes = this.channels.get(id);
    if (nodes) nodes.channel.volume.value = db;
  }

  setPan(id: string, pan: number): void {
    const nodes = this.channels.get(id);
    if (nodes) nodes.channel.pan.value = pan;
  }

  /** Current output level for the channel's meter, 0-1. */
  getLevel(id: string): number {
    const nodes = this.channels.get(id);
    if (!nodes) return 0;
    const value = nodes.meter.getValue();
    const level = Array.isArray(value) ? value[0] : value;
    return Number.isFinite(level) ? level : 0;
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

  /** Live note-off. */
  noteOff(channelId: string, note: string): void {
    const nodes = this.channels.get(channelId);
    if (!nodes || !nodes.heldNotes.has(note)) return;
    nodes.heldNotes.delete(note);
    this.safe(() => nodes.instrument.triggerRelease(note, Tone.now()));

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

  /**
   * Loads an audio file's object URL as one clip on this (audio) channel,
   * replacing any earlier player for the same `clipId`. `trimSeconds`, if
   * given, caps playback to that much of the file (used when the clip
   * block is resized shorter than the source). No-op on a MIDI channel.
   */
  loadAudioClip(
    channelId: string,
    clipId: string,
    url: string,
    offsetSeconds: number,
    trimSeconds?: number
  ): void {
    const nodes = this.channels.get(channelId);
    if (!nodes || nodes.channelType !== "audio") return;
    nodes.audioPlayers.get(clipId)?.dispose();

    this.pendingLoads += 1;
    this.setReady(false);
    const onSettled = () => {
      this.pendingLoads = Math.max(0, this.pendingLoads - 1);
      if (this.pendingLoads === 0) this.setReady(true);
    };
    const player = new Tone.Player({
      url,
      onload: () => {
        onSettled();
        this.safe(() => {
          player.sync();
          if (trimSeconds !== undefined) player.start(offsetSeconds, 0, trimSeconds);
          else player.start(offsetSeconds);
        });
      },
      onerror: onSettled,
    });
    nodes.audioPlayers.set(clipId, player);
    this.rewireChannel(channelId);
  }

  /** Re-times an already-loaded audio clip after it's moved or resized on
   * the timeline, without re-decoding the file. */
  moveAudioClip(channelId: string, clipId: string, offsetSeconds: number, trimSeconds?: number): void {
    const player = this.channels.get(channelId)?.audioPlayers.get(clipId);
    if (!player || !player.loaded) return;
    this.safe(() => {
      player.unsync();
      player.sync();
      if (trimSeconds !== undefined) player.start(offsetSeconds, 0, trimSeconds);
      else player.start(offsetSeconds);
    });
  }

  /** Removes one clip from an audio channel. */
  removeAudioClip(channelId: string, clipId: string): void {
    const nodes = this.channels.get(channelId);
    if (!nodes) return;
    nodes.audioPlayers.get(clipId)?.dispose();
    nodes.audioPlayers.delete(clipId);
    this.rewireChannel(channelId);
  }

  /** Clears every clip on an audio channel, leaving it empty. */
  clearAllAudioClips(channelId: string): void {
    const nodes = this.channels.get(channelId);
    if (!nodes) return;
    nodes.audioPlayers.forEach((p) => p.dispose());
    nodes.audioPlayers.clear();
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
  }

  /** Stops playback/recording, resets the playhead to the start, and
   * releases any hanging notes. */
  stopAll(): void {
    const transport = Tone.getTransport();
    transport.stop();
    transport.position = 0;
    this.channels.forEach((nodes) => {
      this.safe(() => nodes.instrument.releaseAll());
      nodes.heldNotes.clear();
    });
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

  /** Arms a channel for recording and starts the transport (other channels' clips still play back). */
  async startRecording(channelId: string): Promise<void> {
    await this.ensureStarted();
    if (!this.channels.has(channelId)) return;
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

  private async ensureMicStream(): Promise<MediaStream> {
    if (this.micStream) return this.micStream;
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return this.micStream;
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
  async startAudioRecording(channelId: string): Promise<void> {
    await this.ensureStarted();
    if (!this.channels.has(channelId)) return;
    const stream = await this.ensureMicStream();
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
