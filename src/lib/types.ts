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

export interface ChannelConfig {
  id: string;
  name: string;
  volume: number; // dB
  pan: number; // -1..1
  colorIndex: number;
  instrument: InstrumentType;
}

/** A clip's content type - "audio" clips hold an imported audio file instead
 * of MIDI notes; clip context menus and ClipBlock both branch on this. */
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
