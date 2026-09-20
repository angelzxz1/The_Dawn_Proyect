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
  muted: boolean;
  /** Soloing any one channel silences every non-soloed channel. */
  solo: boolean;
  /** Record-armed - exactly one channel can be armed at a time. Only the
   * armed channel is what Record captures, and only the armed channel's
   * instrument sounds when a note comes in (computer keyboard, the
   * on-screen piano/pads, or a MIDI controller) - so merely clicking a
   * track to select it never makes noise. */
  armed: boolean;
}

/** A clip's content type - "audio" clips hold an imported audio file instead
 * of MIDI notes; ClipBlock branches on this. Always matches its channel's
 * fixed `type`. */
export type ClipType = "midi" | "audio";

interface ClipBase {
  /** Unique across the whole project - identifies one clip box on the
   * timeline, independent of any other clip on the same (or any) track. */
  id: string;
  /** Where the clip starts on the arrangement timeline, in seconds. */
  offset: number;
  /** The clip box's length, in seconds. */
  length: number;
  /** When set and > 0, the clip's content (its notes, or its audio source
   * region) repeats every `loopLength` seconds to fill the box's full
   * `length` - lets you drag the clip's right edge out past its natural
   * content and have it tile instead of trailing into silence. Undefined
   * or null means "play through once, no looping". */
  loopLength?: number | null;
}

export interface MidiClipInstance extends ClipBase {
  kind: "midi";
  /** Clip-relative (0 = the start of this clip, not the timeline). */
  notes: NoteEvent[];
}

export interface AudioClipInstance extends ClipBase {
  kind: "audio";
  url: string;
  fileName: string;
  /** Full duration of the decoded source audio file, in seconds - may be
   * longer than `length` if the clip has been trimmed. */
  durationSeconds: number;
  /** Downsampled |amplitude| peaks (0..1) covering the FULL source file
   * (not just this clip's current trim/length) - a clip's waveform is
   * drawn by slicing the range of this array that `sourceOffset`/`length`
   * cover, so a clip split off from another still shows the right piece
   * of the source's waveform. */
  peaks: number[];
  /** Where within the source buffer this clip's content starts, in
   * seconds. 0 for a freshly imported/recorded clip; nonzero for a clip
   * produced by splitting another one further into the source. */
  sourceOffset: number;
  /** Seconds of fade-in/out applied at the start/end of this clip's
   * audible region. */
  fadeIn: number;
  fadeOut: number;
  /** This clip's own gain, in dB, independent of the channel fader. */
  gainDb: number;
}

/** One clip box placed on a track - a track can hold any number of these,
 * at any position, as long as their `kind` matches the track's fixed
 * `ChannelType`. */
export type ClipInstance = MidiClipInstance | AudioClipInstance;

export interface TimeSignature {
  numerator: number;
  denominator: number;
}
