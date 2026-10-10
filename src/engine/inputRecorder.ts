import * as Tone from "tone";
import { loadWorklet } from "./workletLoader";
import { encodeWav } from "../export/wav";
import { WaveformBuilder, type Waveform } from "./waveform";

// Captures the audio input sample-accurately, inside the audio graph: an
// AudioWorklet that copies every frame it's given and stamps each chunk
// with the context frame it was rendered at. Knowing exactly where each
// sample falls on the audio clock is what lets a take be lined up with
// the beat you heard (see audioEngine.ts's recording), unlike
// MediaRecorder, whose start time is only loosely tied to it - and the take
// stays lossless PCM instead of compressed Opus.

const PROCESSOR_NAME = "dawn-input-recorder-v2";
// ~43 ms at 48 kHz: small enough that the timeline's live waveform keeps up.
const CHUNK = 2048;

const PROCESSOR_CODE = `
class DawnInputRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channels = (options.processorOptions && options.processorOptions.channels) || 1;
    this.chunk = Array.from({ length: this.channels }, () => new Float32Array(${CHUNK}));
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
    const data = this.chunk.map((c) => c.slice(0, this.fill));
    this.port.postMessage({ frame: this.chunkFrame, data }, data.map((d) => d.buffer));
    this.fill = 0;
    this.chunkFrame = -1;
  }
  process(inputs) {
    if (!this.alive) return false;
    const input = inputs[0] || [];
    const n = 128;
    if (this.chunkFrame < 0) this.chunkFrame = currentFrame;
    for (let c = 0; c < this.channels; c++) {
      // A mono input feeds every channel.
      const src = input[c] || input[0];
      const dst = this.chunk[c];
      for (let i = 0; i < n; i++) dst[this.fill + i] = src ? src[i] : 0;
    }
    this.fill += n;
    if (this.fill >= ${CHUNK}) this.flush();
    return true;
  }
}
registerProcessor("${PROCESSOR_NAME}", DawnInputRecorder);
`;

/** A take's channels: one (mono) or two (left, right). */
export type TakeChannels = Float32Array[];

/** Recording in progress: a capture of a source, mono or stereo, from the
 * moment it's created. */
export class InputRecorder {
  private readonly chunks: { frame: number; data: Float32Array[] }[] = [];
  private node: AudioWorkletNode | null = null;
  private source: Tone.OutputNode | null = null;
  private done: Promise<void> | null = null;
  private resolveDone: (() => void) | null = null;
  private preview: { builder: WaveformBuilder; originFrame: number } | null = null;
  readonly sampleRate: number;

  private constructor(private readonly context: Tone.BaseContext) {
    this.sampleRate = context.sampleRate;
  }

  /** `source` should be one long-lived node per input: the browser's
   * buffering between the device and the audio graph settles per source
   * node, so reusing it keeps a measured round trip valid for later takes.
   * `channels`: 2 records in stereo (another track's audio), 1 in mono
   * (an interface input, mixed down if the device sends more). */
  static async start(context: Tone.BaseContext, source: Tone.OutputNode, channels: 1 | 2 = 1): Promise<InputRecorder> {
    await loadWorklet(context, PROCESSOR_NAME, PROCESSOR_CODE);
    const rec = new InputRecorder(context);
    rec.source = source;
    rec.node = context.createAudioWorkletNode(PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: channels,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
      processorOptions: { channels },
    });
    rec.done = new Promise((resolve) => (rec.resolveDone = resolve));
    rec.node.port.onmessage = (e: MessageEvent<{ frame: number; data: Float32Array[] } | { done: true }>) => {
      if ("done" in e.data) rec.resolveDone?.();
      else {
        rec.chunks.push(e.data);
        rec.preview?.builder.add(e.data.frame - rec.preview.originFrame, mixdown(e.data.data));
      }
    };
    Tone.connect(source, rec.node);
    return rec;
  }

  private unplug(): void {
    if (!this.source || !this.node) return;
    try {
      Tone.disconnect(this.source, this.node);
    } catch {
      // Already gone (the source track was removed).
    }
  }

  /** Starts building a live waveform of the take, from context time
   * `fromSeconds` (where the finished take will start). */
  startPreview(fromSeconds: number): void {
    const originFrame = Math.round(fromSeconds * this.sampleRate);
    const builder = new WaveformBuilder(this.sampleRate);
    for (const c of this.chunks) builder.add(c.frame - originFrame, mixdown(c.data));
    this.preview = { builder, originFrame };
  }

  /** The live waveform so far, and a counter that changes as it grows. */
  get previewWaveform(): { waveform: Waveform; version: number } | null {
    return this.preview && { waveform: this.preview.builder.waveform, version: this.preview.builder.version };
  }

  /** Stops capturing and resolves with the audio from context time
   * `fromSeconds` on (earlier audio is dropped; if capture began later,
   * the gap is silence): one channel, or two - unless both came out the
   * same, as a mono source through a centered track does, which is kept
   * as one. */
  async stop(fromSeconds: number): Promise<TakeChannels> {
    if (this.node) {
      this.node.port.postMessage("stop");
      await Promise.race([this.done, new Promise((r) => setTimeout(r, 1000))]);
      this.unplug();
      this.node.port.onmessage = null;
      this.node = null;
    }
    const from = Math.round(fromSeconds * this.sampleRate);
    const count = this.chunks[0]?.data.length ?? 1;
    const end = this.chunks.reduce((m, c) => Math.max(m, c.frame + c.data[0].length), from);
    const out = Array.from({ length: count }, () => new Float32Array(Math.max(0, end - from)));
    for (const c of this.chunks) {
      const at = c.frame - from;
      const skip = Math.max(0, -at);
      c.data.forEach((d, ch) => {
        if (skip < d.length) out[ch].set(d.subarray(skip), Math.max(0, at));
      });
    }
    return sameChannels(out) ? [out[0]] : out;
  }

  /** Abandons the capture. */
  cancel(): void {
    if (!this.node) return;
    this.node.port.postMessage("stop");
    this.unplug();
    this.node.port.onmessage = null;
    this.node = null;
  }
}

/** One channel to draw a take's waveform from: the mono one, or the
 * stereo pair's average. */
export function mixdown(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (let i = 0; i < out.length; i++) out[i] = (channels[0][i] + channels[1][i]) / 2;
  return out;
}

/** Whether a stereo take's two sides are the same (to within float
 * rounding), so one is enough. */
export function sameChannels(channels: Float32Array[]): boolean {
  if (channels.length < 2) return true;
  const [l, r] = channels;
  for (let i = 0; i < l.length; i++) if (Math.abs(l[i] - r[i]) > 1e-6) return false;
  return true;
}

/** A take as a WAV file (mono or stereo): 24-bit, or 32-bit float for
 * audio that may go over full scale. */
export function takeToWav(channels: TakeChannels, sampleRate: number, float = false): Blob {
  return encodeWav(channels, sampleRate, float ? 32 : 24);
}
