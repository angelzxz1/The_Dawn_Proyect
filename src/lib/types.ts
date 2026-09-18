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

export interface ChannelConfig {
  id: string;
  name: string;
  volume: number; // dB
  pan: number; // -1..1
  colorIndex: number;
}

/** A clip's content type - only "midi" is implemented today, but clip
 * context menus already branch on this so audio clips can slot in later. */
export type ClipType = "midi" | "audio";

export interface TimeSignature {
  numerator: number;
  denominator: number;
}
