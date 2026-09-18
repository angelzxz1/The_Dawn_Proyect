import * as Tone from "tone";
import type { NoteEvent } from "./types";
import { PIANO_SAMPLE_BASE_URL, PIANO_SAMPLE_URLS } from "./piano";

interface ChannelNodes {
  channel: Tone.Channel;
  sampler: Tone.Sampler;
  meter: Tone.Meter;
  part: Tone.Part<NoteEvent> | null;
  /** Notes currently held down live (not yet released), keyed by note name. */
  heldNotes: Set<string>;
}

interface RecordingState {
  channelId: string;
  /** Notes currently down during the recording, keyed by note name. */
  open: Map<string, { time: number; velocity: number }>;
  events: NoteEvent[];
}

const MIN_NOTE_DURATION = 0.05;

class AudioEngine {
  private channels = new Map<string, ChannelNodes>();
  private started = false;
  private startPromise: Promise<void> | null = null;
  private recording: RecordingState | null = null;
  private pendingLoads = 0;
  private readyListeners = new Set<() => void>();

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

  addChannel(id: string): void {
    if (this.channels.has(id)) return;

    const meter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
    const channel = new Tone.Channel({ volume: 0, pan: 0 })
      .connect(meter)
      .toDestination();
    this.pendingLoads += 1;
    this.setReady(false);
    const onSettled = () => {
      this.pendingLoads = Math.max(0, this.pendingLoads - 1);
      if (this.pendingLoads === 0) this.setReady(true);
    };
    const sampler = new Tone.Sampler({
      urls: PIANO_SAMPLE_URLS,
      baseUrl: PIANO_SAMPLE_BASE_URL,
      release: 1,
      attack: 0,
      onload: onSettled,
      onerror: onSettled,
    }).connect(channel);

    this.channels.set(id, {
      channel,
      sampler,
      meter,
      part: null,
      heldNotes: new Set(),
    });
  }

  removeChannel(id: string): void {
    const nodes = this.channels.get(id);
    if (!nodes) return;
    nodes.part?.dispose();
    nodes.sampler.dispose();
    nodes.channel.dispose();
    nodes.meter.dispose();
    this.channels.delete(id);
    if (this.recording?.channelId === id) {
      this.recording = null;
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
    this.safe(() => nodes.sampler.triggerAttack(note, Tone.now(), velocity));

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
    this.safe(() => nodes.sampler.triggerRelease(note, Tone.now()));

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
        nodes.sampler.triggerAttackRelease(
          value.note,
          Math.max(value.duration, MIN_NOTE_DURATION),
          time,
          value.velocity
        )
      );
    }, scheduled).start(0);
    nodes.part = part;
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
      this.safe(() => nodes.sampler.releaseAll());
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
      this.safe(() => nodes.sampler.releaseAll());
      nodes.heldNotes.clear();
    });
    if (this.recording) {
      this.finishRecording();
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
      this.safe(() => nodes?.sampler.triggerRelease(note, Tone.now()));
    });
    nodes?.heldNotes.clear();

    this.recording = null;
    const events = rec.events.sort((a, b) => a.time - b.time);
    this.setClip(rec.channelId, events, offsetSeconds);
    return events;
  }

  get isRecording(): boolean {
    return this.recording !== null;
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
