// Another engine following the browser engine's transport: the desktop
// app's native engine (native/nativeEngine.ts), which then plays the song
// while the browser's engine runs on silently. The browser engine tells
// it everything the transport does, and takes its position for the
// playhead.

export interface EngineFollower {
  /** Playing from `from` (s). */
  play(from: number): void;
  /** Stopped or paused, where it is. */
  stop(): void;
  seek(seconds: number): void;
  loop(range: { start: number; end: number } | null): void;
  metronome(enabled: boolean, levelDb: number): void;
  /** The master limiter's ceiling (dB). */
  limiter(db: number): void;
  beatsPerBar(beats: number): void;
  /** Where it is (s), for the playhead; null to use the browser's. */
  position(): number | null;
  /** A key pressed live on a track (MIDI note number, velocity 0-1). */
  noteOn(track: string, key: number, velocity: number): void;
  /** A key let go live (the follower keeps its own sustain). */
  noteOff(track: string, key: number): void;
  /** A track's sustain pedal (CC64). */
  sustain(track: string, down: boolean): void;
}
