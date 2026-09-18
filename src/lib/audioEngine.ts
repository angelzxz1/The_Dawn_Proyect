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

  /** Replace a channel's playable clip (used after recording, import, or clear). */
  setClip(channelId: string, notes: NoteEvent[]): void {
    const nodes = this.channels.get(channelId);
    if (!nodes) return;
    nodes.part?.dispose();
    if (notes.length === 0) {
      nodes.part = null;
      return;
    }
    const part = new Tone.Part<NoteEvent>((time, value) => {
      this.safe(() =>
        nodes.sampler.triggerAttackRelease(
          value.note,
          Math.max(value.duration, MIN_NOTE_DURATION),
          time,
          value.velocity
        )
      );
    }, notes).start(0);
    nodes.part = part;
  }

  /** Starts playback of every channel's clip from the beginning. */
  async startPlayback(): Promise<void> {
    await this.ensureStarted();
    const transport = Tone.getTransport();
    transport.stop();
    transport.position = 0;
    transport.start();
  }

  /** Stops playback/recording and releases any hanging notes. */
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

  /** Stops recording, finalizes the clip, and returns the recorded notes. */
  finishRecording(): NoteEvent[] {
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
    this.setClip(rec.channelId, events);
    return events;
  }

  get isRecording(): boolean {
    return this.recording !== null;
  }

  setBpm(bpm: number): void {
    Tone.getTransport().bpm.value = bpm;
  }

  getTransportSeconds(): number {
    return Tone.getTransport().seconds;
  }

  getTransportState(): "started" | "stopped" | "paused" {
    return Tone.getTransport().state;
  }
}

export const audioEngine = new AudioEngine();
