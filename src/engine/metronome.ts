import * as Tone from "tone";
import { loadWorklet } from "./workletLoader";
import { METRONOME_KERNEL_SOURCE } from "./metronomeKernel";

// The metronome and the count-in, made on the audio thread.
//
// The clicks come from an AudioWorklet running metronomeKernel.ts. The page
// only tells it where the transport is (a start, a stop, a jump), the
// tempo, the bar length and the loop; it works out every click itself and
// places it at its exact sample. So a busy or frozen page - the moment
// recording starts, a project loading, or a background tab, whose timers
// the browser slows to once a second - can't delay or drop a click. The
// accent comes from the bar position, not from when playback started, so
// starting mid-bar counts correctly.

const PROCESSOR_NAME = "dawn-metronome-v1";

const PROCESSOR_CODE = `
${METRONOME_KERNEL_SOURCE}
class DawnMetronome extends AudioWorkletProcessor {
  constructor() {
    super();
    this.kernel = new MetronomeKernel(sampleRate);
    this.port.onmessage = (e) => this.kernel.command(e.data);
  }

  process(inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (out) this.kernel.render(out, currentTime);
    return true;
  }
}
registerProcessor("${PROCESSOR_NAME}", DawnMetronome);
`;

/** A loop region, in beats. */
export interface ClickLoop {
  start: number;
  end: number;
}

type Command =
  | { type: "start"; time: number; pos: number; countInBeats: number }
  | { type: "stop" }
  | { type: "resync"; time: number; pos: number }
  | { type: "enabled"; enabled: boolean }
  | { type: "tempo"; bpm: number }
  | { type: "meter"; beatsPerBar: number }
  | { type: "loop"; loop: ClickLoop | null };

export class Metronome {
  private node: AudioWorkletNode | null = null;
  private loading: Promise<void> | null = null;
  /** What was said before the worklet loaded, passed on once it has. */
  private pending: Command[] = [];
  private connectedTo: Tone.InputNode | null = null;
  private isRunning = false;

  /** `output` is where the clicks go (the engine's delayed click bus). */
  constructor(private readonly output: () => Tone.InputNode) {}

  /** Loads the worklet, once. The engine does it as audio starts, so it's
   * ready for the first Play. */
  prepare(): Promise<void> {
    this.loading ??= (async () => {
      const context = Tone.getContext();
      await loadWorklet(context, PROCESSOR_NAME, PROCESSOR_CODE);
      const node = context.createAudioWorkletNode(PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.node = node;
      this.connect();
      this.pending.forEach((command) => node.port.postMessage(command));
      this.pending = [];
    })();
    return this.loading;
  }

  private connect(): void {
    if (!this.node) return;
    const output = this.output();
    if (output === this.connectedTo) return;
    if (this.connectedTo) Tone.disconnect(this.node, this.connectedTo);
    Tone.connect(this.node, output);
    this.connectedTo = output;
  }

  private send(command: Command): void {
    if (this.node) {
      this.node.port.postMessage(command);
    } else {
      this.pending.push(command);
      void this.prepare();
    }
  }

  /** Starts clicking with the transport: it reaches beat position `pos` at
   * context time `time`. `countInBeats` clicks are played before that (on
   * the beat grid, accented on each bar's first beat), whether or not the
   * metronome is on. */
  start(time: number, pos: number, countInBeats = 0): void {
    this.isRunning = true;
    this.connect();
    this.send({ type: "start", time, pos, countInBeats });
  }

  /** Stops, silencing any click still sounding. */
  stop(): void {
    this.isRunning = false;
    this.send({ type: "stop" });
  }

  get running(): boolean {
    return this.isRunning;
  }

  /** Clicks after the count-in sound only while it's on. */
  setEnabled(enabled: boolean): void {
    this.send({ type: "enabled", enabled });
  }

  setTempo(bpm: number): void {
    this.send({ type: "tempo", bpm });
  }

  setBeatsPerBar(beatsPerBar: number): void {
    this.send({ type: "meter", beatsPerBar });
  }

  setLoop(loop: ClickLoop | null): void {
    this.send({ type: "loop", loop });
  }

  /** After a jump, a tempo or a loop change while playing: carries on from
   * the transport's position `pos` at context time `time`. Ignored during
   * the count-in (nothing has moved yet). */
  resync(time: number, pos: number): void {
    if (this.isRunning) this.send({ type: "resync", time, pos });
  }
}
