// The transport - Tone's, which plays the clips - and the metronome that
// follows it (metronome.ts). Starting, stopping, seeking, tempo and the
// loop all go through here so the clicks always match the music.

import * as Tone from "tone";
import { Metronome } from "../metronome";

/** How far ahead (s) Play and Record start the transport. The page redraws
 * itself right as they're pressed, and with the short lookAhead (see
 * context.ts) the first notes would otherwise be scheduled during that
 * redraw and come out late; starting just after it keeps the first beat on
 * time. */
const START_HEADROOM = 0.12;

export class Transport {
  private readonly metronome: Metronome;

  /** `clickOutput`: where the metronome and count-in go. */
  constructor(clickOutput: () => Tone.InputNode) {
    this.metronome = new Metronome(clickOutput);
  }

  private get tone() {
    return Tone.getTransport();
  }

  /** Where the transport is now, in beats (stopped or paused: where it'll start). */
  private get positionBeats(): number {
    return this.tone.ticks / this.tone.PPQ;
  }

  /** Where the transport is, in beats, at context time `time`. */
  private beatsAt(time: number): number {
    return this.tone.getTicksAtTime(time) / this.tone.PPQ;
  }

  /** After the transport jumps or changes tempo or loop while playing, the
   * metronome picks up from where it now is. */
  private resyncMetronome(): void {
    if (!this.metronome.running || this.tone.state !== "started") return;
    const now = Tone.now();
    this.metronome.resync(now, this.beatsAt(now));
  }

  /** Plays from wherever the transport sits. */
  play(): void {
    const pos = this.positionBeats;
    const time = Tone.now() + START_HEADROOM;
    this.tone.start(time);
    this.metronome.start(time, pos);
  }

  /** Starts at `fromSeconds` after `countInBeats` beats of count-in (which
   * the metronome plays), both scheduled ahead on the audio clock so
   * nothing the page does meanwhile can delay them. Recording plays
   * straight through, without the loop. Returns the context time the
   * transport starts at. */
  startRecording(countInBeats: number, fromSeconds: number): number {
    this.tone.stop();
    this.tone.loop = false;
    this.metronome.setLoop(null);
    this.tone.seconds = Math.max(0, fromSeconds);
    const pos = this.positionBeats;
    const startTime = Tone.now() + START_HEADROOM + countInBeats * (60 / this.tone.bpm.value);
    this.tone.start(startTime);
    this.metronome.start(startTime, pos, countInBeats);
    return startTime;
  }

  pause(): void {
    this.tone.pause();
    this.metronome.stop();
  }

  stop(): void {
    this.tone.stop();
    this.metronome.stop();
  }

  /** Moves the playhead, whether playing, paused or stopped. */
  seek(seconds: number): void {
    this.tone.seconds = Math.max(0, seconds);
    this.resyncMetronome();
  }

  get seconds(): number {
    // Stopping a transport whose context hasn't run yet can leave it a hair
    // below zero (the stop lands a lookahead later); the timeline starts at 0.
    return Math.max(0, this.tone.seconds);
  }

  get state(): "started" | "stopped" | "paused" {
    return this.tone.state;
  }

  setBpm(bpm: number): void {
    this.tone.bpm.value = bpm;
    this.metronome.setTempo(bpm);
    this.resyncMetronome();
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
    const beat = this.tone.bpm.value / 60;
    this.metronome.setLoop(enabled ? { start: Number(this.tone.loopStart) * beat, end: Number(this.tone.loopEnd) * beat } : null);
    this.resyncMetronome();
  }

  setMetronome(enabled: boolean): void {
    this.metronome.setEnabled(enabled);
  }
}
