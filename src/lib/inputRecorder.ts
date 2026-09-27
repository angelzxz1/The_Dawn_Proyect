import * as Tone from "tone";
import { loadWorklet } from "./workletLoader";
import { encodeWav } from "./wav";
import { WaveformBuilder, type Waveform } from "./waveform";

// Captures the audio input sample-accurately, inside the audio graph: an
// AudioWorklet that copies every frame it's given and stamps each chunk
// with the context frame it was rendered at. Knowing exactly where each
// sample falls on the audio clock is what lets a take be lined up with
// the beat you heard (see audioEngine.ts's recording), unlike
// MediaRecorder, whose start time is only loosely tied to it - and the take
// stays lossless PCM instead of compressed Opus.

const PROCESSOR_NAME = "dawn-input-recorder-v1";
// ~43 ms at 48 kHz: small enough that the timeline's live waveform keeps up.
const CHUNK = 2048;

const PROCESSOR_CODE = `
class DawnInputRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(${CHUNK});
    this.fill = 0;
    this.chunkFrame = -1;
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data !== "stop") return;
      this.flush();
      this.port.postMessage({ done: true });
      this.alive = false;
    };
  }
  flush() {
    if (this.fill === 0) return;
    const data = this.chunk.slice(0, this.fill);
    this.port.postMessage({ frame: this.chunkFrame, data }, [data.buffer]);
    this.fill = 0;
    this.chunkFrame = -1;
  }
  process(inputs) {
    if (!this.alive) return false;
    const input = inputs[0] && inputs[0][0];
    const n = 128;
    if (this.chunkFrame < 0) this.chunkFrame = currentFrame;
    for (let i = 0; i < n; i++) this.chunk[this.fill + i] = input ? input[i] : 0;
    this.fill += n;
    if (this.fill >= ${CHUNK}) this.flush();
    return true;
  }
}
registerProcessor("${PROCESSOR_NAME}", DawnInputRecorder);
`;

/** Recording in progress: a mono capture of `stream` from the moment it's
 * created. */
export class InputRecorder {
  private readonly chunks: { frame: number; data: Float32Array }[] = [];
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private done: Promise<void> | null = null;
  private resolveDone: (() => void) | null = null;
  private preview: { builder: WaveformBuilder; originFrame: number } | null = null;
  readonly sampleRate: number;

  private constructor(private readonly context: Tone.BaseContext) {
    this.sampleRate = context.sampleRate;
  }

  /** `source` should be one long-lived node per input: the browser's
   * buffering between the device and the audio graph settles per source
   * node, so reusing it keeps a measured round trip valid for later takes. */
  static async start(context: Tone.BaseContext, source: MediaStreamAudioSourceNode): Promise<InputRecorder> {
    await loadWorklet(context, PROCESSOR_NAME, PROCESSOR_CODE);
    const rec = new InputRecorder(context);
    rec.source = source;
    rec.node = context.createAudioWorkletNode(PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    }) as unknown as AudioWorkletNode;
    rec.done = new Promise((resolve) => (rec.resolveDone = resolve));
    rec.node.port.onmessage = (e: MessageEvent<{ frame: number; data: Float32Array } | { done: true }>) => {
      if ("done" in e.data) rec.resolveDone?.();
      else {
        rec.chunks.push(e.data);
        rec.preview?.builder.add(e.data.frame - rec.preview.originFrame, e.data.data);
      }
    };
    rec.source.connect(rec.node);
    return rec;
  }

  /** Starts building a live waveform of the take, from context time
   * `fromSeconds` (where the finished take will start). */
  startPreview(fromSeconds: number): void {
    const originFrame = Math.round(fromSeconds * this.sampleRate);
    const builder = new WaveformBuilder(this.sampleRate);
    for (const c of this.chunks) builder.add(c.frame - originFrame, c.data);
    this.preview = { builder, originFrame };
  }

  /** The live waveform so far, and a counter that changes as it grows. */
  get previewWaveform(): { waveform: Waveform; version: number } | null {
    return this.preview && { waveform: this.preview.builder.waveform, version: this.preview.builder.version };
  }

  /** Stops capturing and resolves with the audio from context time
   * `fromSeconds` on (earlier audio is dropped; if capture began later,
   * the gap is silence), as mono samples. */
  async stop(fromSeconds: number): Promise<Float32Array> {
    if (this.node) {
      this.node.port.postMessage("stop");
      await Promise.race([this.done, new Promise((r) => setTimeout(r, 1000))]);
      this.source?.disconnect(this.node);
      this.node.port.onmessage = null;
      this.node = null;
    }
    const from = Math.round(fromSeconds * this.sampleRate);
    const end = this.chunks.reduce((m, c) => Math.max(m, c.frame + c.data.length), from);
    const out = new Float32Array(Math.max(0, end - from));
    for (const c of this.chunks) {
      const at = c.frame - from;
      const skip = Math.max(0, -at);
      if (skip < c.data.length) out.set(c.data.subarray(skip), Math.max(0, at));
    }
    return out;
  }

  /** Abandons the capture. */
  cancel(): void {
    if (!this.node) return;
    this.node.port.postMessage("stop");
    this.source?.disconnect(this.node);
    this.node.port.onmessage = null;
    this.node = null;
  }
}

/** A take as a 24-bit WAV file. */
export function takeToWav(samples: Float32Array, sampleRate: number): Blob {
  return encodeWav([samples], sampleRate, 24);
}
