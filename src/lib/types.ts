export interface NoteEvent {
  /** Scientific pitch notation, e.g. "C4" */
  note: string;
  /** Start time in seconds, relative to the start of the clip */
  time: number;
  /** Duration in seconds */
  duration: number;
  /** Velocity, 0-1 */
  velocity: number;
}

/** The sound source a MIDI track plays through - "like in Ableton", an
 * instrument you pick per track rather than a single hardcoded piano. */
export type InstrumentType = "piano" | "drums";

/** A channel's fixed kind, chosen when it's created (Ableton-style): a MIDI
 * track plays notes through an instrument and can host audio effects too; an
 * audio track holds a recorded/imported clip and can only host audio
 * effects. This never changes for the lifetime of the channel. */
export type ChannelType = "midi" | "audio";

export interface ChannelConfig {
  id: string;
  name: string;
  volume: number; // dB
  pan: number; // -1..1
  colorIndex: number;
  type: ChannelType;
  /** The loaded instrument, or null for an empty (silent) MIDI track - a
   * track doesn't have to have anything loaded into it. Unused for audio
   * channels. */
  instrument: InstrumentType | null;
}

/** A clip's content type - "audio" clips hold an imported audio file instead
 * of MIDI notes; ClipBlock branches on this. Always matches its channel's
 * fixed `type`. */
export type ClipType = "midi" | "audio";

export interface AudioClipData {
  url: string;
  fileName: string;
  /** Full duration of the decoded audio file, in seconds. */
  durationSeconds: number;
  /** Downsampled |amplitude| peaks (0..1) for drawing a waveform. */
  peaks: number[];
}

export interface TimeSignature {
  numerator: number;
  denominator: number;
}
