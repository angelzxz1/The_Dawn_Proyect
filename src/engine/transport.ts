// The transport - Tone's, which plays the clips - and the metronome that
// follows it (metronome.ts). Starting, stopping, seeking, tempo and the
// loop all go through here so the clicks always match the music.

import * as Tone from "tone";
import { Metronome, type ClickTempo } from "./metronome";
import type { ClickSound } from "./clickSounds";

/** How far ahead of the audio clock (s) Play and Record start the
 * transport: past the scheduling window (context.ts), with room for the
 * redraw the page does right as they're pressed, so the first beat is
 * queued in time like every other. */
const START_LEAD = 0.13;

/** The beats of a count-in left at context time `now`, counting the one
 * sounding, when the transport starts at `startTime` at `bpm`; null once
 * it's over. */
export function countInBeatsLeft(startTime: number, bpm: number, now: number): number | null {
  const left = ((startTime - now) * bpm) / 60;
  return left > 0 ? Math.ceil(left - 1e-9) : null;
}

export class Transport {
  private readonly metronome: Metronome;
  /** The tempo map (setTempoMap); none set yet: Tone's tempo throughout. */
  private segments: ClickTempo[] = [];
  /** The count-in going on: when (context time) the transport starts after
   * it, and its tempo. */
  private countIn: { startTime: number; bpm: number } | null = null;

  /** `clickOutput`: where the metronome and count-in go. */
  constructor(clickOutput: () => Tone.InputNode) {
    this.metronome = new Metronome(clickOutput);
  }

  /** Loads the metronome's worklet (see Metronome.prepare). */
  prepare(): Promise<void> {
    return this.metronome.prepare();
  }

  private get tone() {
    return Tone.getTransport();
  }

  /** Where the transport is now, in seconds (stopped or paused: where
   * it'll start). The metronome works in these, with the tempo map. */
  private get position(): number {
    return this.tone.seconds;
  }

  /** Where the transport is, in seconds, at context time `time`. */
  private positionAt(time: number): number {
    return this.tone.getSecondsAtTime(time);
  }

  /** After the transport jumps or changes tempo or loop while playing, the
   * metronome picks up from where it now is. */
  private resyncMetronome(): void {
    if (!this.metronome.running || this.tone.state !== "started") return;
    const now = Tone.now();
    this.metronome.resync(now, this.positionAt(now));
  }

  /** Plays from wherever the transport sits. */
  play(): void {
    const pos = this.position;
    const time = Tone.immediate() + START_LEAD;
    this.tone.start(time);
    this.metronome.start(time, pos);
    this.countIn = null;
  }

  /** Starts at `fromSeconds` after `countInBeats` beats of count-in (which
   * the metronome plays), both scheduled ahead on the audio clock so
   * nothing the page does meanwhile can delay them. Recording plays
   * straight through - or round `loop` (s), for a loop recording, each time
   * round a take. Returns the context time the transport starts at. */
  startRecording(countInBeats: number, fromSeconds: number, loop: { start: number; end: number } | null = null): number {
    this.tone.stop();
    if (loop) this.setLoop(true, loop.start, loop.end);
    else {
      this.tone.loop = false;
      this.metronome.setLoop(null);
    }
    this.tone.seconds = Math.max(0, fromSeconds);
    const pos = this.position;
    // The count-in is at the tempo where recording starts (as the
    // metronome counts it).
    const bpm = this.bpmAt(pos);
    const startTime = Tone.immediate() + START_LEAD + countInBeats * (60 / bpm);
    this.tone.start(startTime);
    this.metronome.start(startTime, pos, countInBeats);
    this.countIn = countInBeats > 0 ? { startTime, bpm } : null;
    return startTime;
  }

  /** During a count-in, the beats of it left to hear, counting the one
   * sounding (4, 3, 2, 1 over a bar of four); otherwise null. */
  countInLeft(now = Tone.immediate()): number | null {
    const c = this.countIn;
    if (!c) return null;
    const left = countInBeatsLeft(c.startTime, c.bpm, now);
    if (left === null) this.countIn = null;
    return left;
  }

  pause(): void {
    this.tone.pause();
    this.metronome.stop();
    this.countIn = null;
  }

  stop(): void {
    this.tone.stop();
    this.metronome.stop();
    this.countIn = null;
  }

  /** Moves the playhead, whether playing, paused or stopped. */
  seek(seconds: number): void {
    this.tone.seconds = Math.max(0, seconds);
    this.resyncMetronome();
  }

  /** Where the transport is now: while playing, the position being heard
   * (at the audio clock's time - Tone's own reading is a scheduling window
   * ahead), which is also where a note played now is recorded. */
  get seconds(): number {
    const seconds = this.tone.state === "started" ? this.tone.getSecondsAtTime(Tone.immediate()) : this.tone.seconds;
    // Stopping a transport whose context hasn't run yet can leave it a hair
    // below zero (the stop lands a lookahead later); the timeline starts at 0.
    return Math.max(0, seconds);
  }

  get state(): "started" | "stopped" | "paused" {
    return this.tone.state;
  }

  /** The tempo at the start (Tone's transport, which plays everything in
   * seconds, keeps this; the beats follow the tempo map, setTempoMap). */
  setBpm(bpm: number): void {
    this.tone.bpm.value = bpm;
  }

  /** Where the beats are (tempoMap.ts segments, in transport seconds): what
   * the metronome clicks on. */
  setTempoMap(segments: ClickTempo[]): void {
    this.segments = segments;
    this.metronome.setTempo(segments);
    this.resyncMetronome();
  }

  /** The tempo at a transport position (s). */
  private bpmAt(seconds: number): number {
    let bpm = this.segments[0]?.bpm ?? this.tone.bpm.value;
    for (const s of this.segments) if (s.seconds <= seconds + 1e-6) bpm = s.bpm;
    return bpm;
  }

  setBeatsPerBar(beatsPerBar: number): void {
    this.tone.timeSignature = beatsPerBar;
    this.metronome.setBeatsPerBar(beatsPerBar);
  }

  /** Sets (or clears) the loop region: playback reaching `endSeconds` jumps
   * back to `startSeconds`. */
  setLoop(enabled: boolean, startSeconds: number, endSeconds: number): void {
    this.tone.loopStart = startSeconds;
    this.tone.loopEnd = Math.max(startSeconds + 0.05, endSeconds);
    this.tone.loop = enabled;
    this.metronome.setLoop(enabled ? { start: startSeconds, end: Math.max(startSeconds + 0.05, endSeconds) } : null);
    this.resyncMetronome();
  }

  setMetronome(enabled: boolean): void {
    this.metronome.setEnabled(enabled);
  }

  /** The click's level, in dB from its standard level. */
  setMetronomeLevel(db: number): void {
    this.metronome.setLevel(db);
  }

  setMetronomeSound(sound: ClickSound): void {
    this.metronome.setSound(sound);
  }
}
