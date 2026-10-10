import * as Tone from "tone";

// The metronome and the count-in, scheduled on the audio clock.
//
// Tone's transport queues events a few tens of ms ahead (context.ts), from
// the page's main thread; a click is the one sound that must never slip,
// even when the page is busy for longer - as it can be right when
// recording starts. So the metronome works
// like a dedicated click track: it knows where the transport is (the
// position at a given context time, the tempo and the loop) and queues each
// click as a buffer source a fifth of a second ahead, so a busy page can't
// shift it. The accent comes from the bar position, not from when playback
// started, so starting mid-bar counts correctly.

/** How far ahead clicks are queued (s). */
const HORIZON = 0.2;
/** How often the queue is topped up (ms). */
const PUMP_MS = 25;
const EPS = 1e-6;

/** A loop region, in beats. */
export interface ClickLoop {
  start: number;
  end: number;
}

/** The beats (whole beat positions) that sound from position `pos` over
 * the next `span` beats of playing time, following the loop like the
 * transport does (reaching `end` jumps back to `start`). `inclusive`: a
 * beat exactly at `pos` counts. `elapsed` is how many beats of playing
 * time after `pos` each one sounds. */
export function clicksAhead(
  pos: number,
  span: number,
  loop: ClickLoop | null,
  inclusive = true
): { elapsed: number; beat: number }[] {
  const out: { elapsed: number; beat: number }[] = [];
  const looping = loop && loop.end - loop.start > EPS ? loop : null;
  let elapsed = 0;
  let p = pos;
  let include = inclusive;
  // Bounded so a loop with no whole beat inside can't spin forever.
  for (let guard = 0; guard < 10000; guard++) {
    const k = include ? Math.ceil(p - EPS) : Math.floor(p + EPS) + 1;
    if (looping && k >= looping.end - EPS) {
      elapsed += Math.max(0, looping.end - p);
      if (elapsed > span + EPS) break;
      p = looping.start;
      include = true;
      continue;
    }
    elapsed += k - p;
    if (elapsed > span + EPS) break;
    out.push({ elapsed, beat: k });
    p = k;
    include = false;
  }
  return out;
}

/** Whether a beat position starts a bar. */
export function isDownbeat(beat: number, beatsPerBar: number): boolean {
  const n = Math.max(1, Math.round(beatsPerBar));
  return ((Math.round(beat) % n) + n) % n === 0;
}

/** A short square-ish blip (band-limited, so it doesn't alias), like the
 * synth click it replaces. */
function clickBuffer(ctx: BaseAudioContext, frequency: number, gainDb: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const length = Math.round(0.07 * sr);
  const buffer = ctx.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);
  const gain = Math.pow(10, gainDb / 20);
  for (let i = 0; i < length; i++) {
    const t = i / sr;
    let wave = 0;
    for (let h = 1; h <= 9 && h * frequency < sr / 2; h += 2) wave += Math.sin(2 * Math.PI * h * frequency * t) / h;
    // 1 ms attack, then ~40 ms decay.
    const env = Math.min(1, t / 0.001) * Math.exp(-t / 0.012);
    data[i] = (4 / Math.PI) * wave * env * gain;
  }
  return buffer;
}

export class Metronome {
  /** Clicks after the count-in sound only while this is on. */
  enabled = false;
  private bpm = 120;
  private beatsPerBar = 4;
  private loop: ClickLoop | null = null;
  /** Where scheduling continues from: position `pos` (beats) at context
   * time `time`. Null when stopped. */
  private next: { time: number; pos: number; inclusive: boolean } | null = null;
  /** Context time the transport starts at; clicks before it are the
   * count-in, which always sounds. */
  private startTime = 0;
  private queued: { source: AudioBufferSourceNode; time: number; countIn: boolean }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private buffers: { accent: AudioBuffer; beat: AudioBuffer; countAccent: AudioBuffer; countBeat: AudioBuffer } | null = null;

  /** `output` is where the clicks go (the engine's delayed click bus). */
  constructor(private readonly output: () => Tone.InputNode) {}

  private get secondsPerBeat(): number {
    return 60 / this.bpm;
  }

  /** Starts clicking with the transport: it reaches beat position `pos` at
   * context time `time`. `countInBeats` clicks are played before that (on
   * the beat grid, accented on each bar's first beat), whatever `enabled`
   * says. */
  start(time: number, pos: number, countInBeats = 0): void {
    this.cancel(-Infinity);
    this.startTime = time;
    this.next = { time: time - countInBeats * this.secondsPerBeat, pos: pos - countInBeats, inclusive: true };
    this.pump();
    this.timer ??= setInterval(() => this.pump(), PUMP_MS);
  }

  /** Stops, silencing anything already queued. */
  stop(): void {
    this.next = null;
    this.cancel(-Infinity);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return this.next !== null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    // Turning it off silences what's queued (but not the count-in).
    if (!enabled) this.cancel(Tone.getContext().currentTime, false);
  }

  setTempo(bpm: number): void {
    this.bpm = bpm;
  }

  setBeatsPerBar(beatsPerBar: number): void {
    this.beatsPerBar = beatsPerBar;
  }

  setLoop(loop: ClickLoop | null): void {
    this.loop = loop;
  }

  /** After a jump, a tempo or a loop change while playing: drops what's
   * queued and carries on from the transport's position `pos` at context
   * time `time`. Ignored during the count-in (nothing has moved yet). */
  resync(time: number, pos: number): void {
    if (!this.next || time < this.startTime) return;
    this.cancel(time);
    this.next = { time, pos, inclusive: true };
    this.pump();
  }

  /** Stops queued clicks that start after `after` (count-in ones too,
   * unless `countIn` is false). */
  private cancel(after: number, countIn = true): void {
    this.queued = this.queued.filter((q) => {
      if (q.time <= after || (!countIn && q.countIn)) return true;
      try {
        q.source.stop();
        q.source.disconnect();
      } catch {
        // Already finished.
      }
      return false;
    });
  }

  /** Queues every click up to HORIZON ahead. */
  private pump(): void {
    const next = this.next;
    if (!next) return;
    const ctx = Tone.getContext();
    const now = ctx.currentTime;
    // Forget clicks that have played.
    this.queued = this.queued.filter((q) => q.time > now - 0.2);
    const until = now + HORIZON;
    if (until <= next.time) return;
    const spb = this.secondsPerBeat;
    // The count-in doesn't loop (recording, the only thing with one, plays
    // straight through anyway); from the start, the transport's loop does.
    const loop = next.time >= this.startTime - EPS ? this.loop : null;
    const clicks = clicksAhead(next.pos, (until - next.time) / spb, loop, next.inclusive);
    for (const { elapsed, beat } of clicks) {
      const time = next.time + elapsed * spb;
      const countIn = time < this.startTime - EPS;
      if (time >= now - 0.005 && (countIn || this.enabled)) this.play(time, isDownbeat(beat, this.beatsPerBar), countIn);
      this.next = { time, pos: beat, inclusive: false };
    }
  }

  private play(time: number, accent: boolean, countIn: boolean): void {
    const raw = Tone.getContext().rawContext;
    this.buffers ??= {
      accent: clickBuffer(raw, 1046.5, -14),
      beat: clickBuffer(raw, 523.25, -14),
      countAccent: clickBuffer(raw, 1046.5, -8),
      countBeat: clickBuffer(raw, 523.25, -8),
    };
    const b = this.buffers;
    const source = raw.createBufferSource();
    source.buffer = countIn ? (accent ? b.countAccent : b.countBeat) : accent ? b.accent : b.beat;
    Tone.connect(source, this.output());
    source.start(Math.max(time, raw.currentTime));
    this.queued.push({ source, time, countIn });
  }
}
