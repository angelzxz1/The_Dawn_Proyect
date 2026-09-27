import type * as Tone from "tone";

// Client for the NAM (Neural Amp Modeler) engine: TONE3000's WebAssembly
// build of NeuralAmpModelerCore, vendored in public/nam/ (see its README).
// The package's own NamNode class extends the browser's native
// AudioWorkletNode, which can't be used on Tone's (wrapped) audio context,
// so this talks to the same worklet through its message protocol instead
// and creates the node through Tone like the app's other worklets.

const WORKLET_URL = "/nam/nam-worklet.js";
const WASM_URL = "/nam/nam-engine.wasm";
const PROCESSOR_NAME = "nam-processor";

/** What the engine reports about a loaded model. */
export interface NamModelInfo {
  /** Whether the model has a smaller built-in variant (A2 models). */
  slimmable: boolean;
  slimmableBreakpoints: number[];
  /** Whether the model reports its loudness (used to normalize output). */
  hasLoudness: boolean;
  loudness: number;
  /** Sample rate the model was trained at in Hz, -1 when unknown. */
  expectedSampleRate: number;
}

type Request =
  | { type: "init"; wasmBytes: ArrayBuffer }
  | { type: "load-model"; json: string; slimSize: number }
  | { type: "unload-model" }
  | { type: "set-slim-size"; slimSize: number }
  | { type: "destroy" };

type Response =
  | { type: "response"; requestId: number; ok: true; modelInfo?: NamModelInfo }
  | { type: "response"; requestId: number; ok: false; error: string };

let wasmBytes: Promise<ArrayBuffer> | null = null;

function loadWasm(): Promise<ArrayBuffer> {
  wasmBytes ??= fetch(WASM_URL).then((r) => {
    if (!r.ok) throw new Error(`Couldn't load the amp engine (${r.status}).`);
    return r.arrayBuffer();
  });
  wasmBytes.catch(() => {
    wasmBytes = null;
  });
  return wasmBytes;
}

const moduleLoads = new WeakMap<object, Promise<void>>();

function loadModule(context: Tone.BaseContext): Promise<void> {
  const raw = context.rawContext;
  let promise = moduleLoads.get(raw);
  if (!promise) {
    promise = raw.audioWorklet!.addModule(WORKLET_URL);
    moduleLoads.set(raw, promise);
    promise.catch(() => moduleLoads.delete(raw));
  }
  return promise;
}

let nextRequestId = 1;

/** One NAM instance on the audio thread: mono in, mono out. With no model
 * loaded it passes audio through unchanged. */
export class NamInstance {
  private readonly pending = new Map<number, { resolve: (info?: NamModelInfo) => void; reject: (e: Error) => void }>();
  private disposed = false;

  private constructor(readonly node: AudioWorkletNode) {
    node.port.onmessage = (event: MessageEvent<Response>) => {
      const response = event.data;
      const entry = this.pending.get(response.requestId);
      if (!entry) return;
      this.pending.delete(response.requestId);
      if (response.ok) entry.resolve(response.modelInfo);
      else entry.reject(new Error(response.error));
    };
  }

  /** Creates an instance in `context` (loading the engine there first if
   * needed). Works in offline contexts too, for WAV export. */
  static async create(context: Tone.BaseContext): Promise<NamInstance> {
    const [, bytes] = await Promise.all([loadModule(context), loadWasm()]);
    const node = context.createAudioWorkletNode(PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    const instance = new NamInstance(node);
    // Structured-cloned (not transferred) so every instance can use it.
    await instance.request({ type: "init", wasmBytes: bytes });
    return instance;
  }

  private request(message: Request): Promise<NamModelInfo | undefined> {
    if (this.disposed) return Promise.reject(new Error("The amp was removed."));
    const requestId = nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.node.port.postMessage({ ...message, requestId });
    });
  }

  /** Loads a .nam file's contents, replacing any current model. Audio
   * pauses briefly while it's parsed and fades back in. `slimSize` below 0
   * means the full model. Rejects with the engine's reason if it can't. */
  async loadModel(json: string, slimSize = -1): Promise<NamModelInfo> {
    const info = await this.request({ type: "load-model", json, slimSize });
    if (!info) throw new Error("The amp engine didn't report the model.");
    return info;
  }

  async unloadModel(): Promise<void> {
    await this.request({ type: "unload-model" });
  }

  async setSlimSize(slimSize: number): Promise<void> {
    await this.request({ type: "set-slim-size", slimSize });
  }

  /** Frees the instance on the audio thread and disconnects it. */
  dispose(): void {
    if (this.disposed) return;
    void this.request({ type: "destroy" }).catch(() => {});
    this.disposed = true;
    this.pending.forEach((entry) => entry.reject(new Error("The amp was removed.")));
    this.pending.clear();
    this.node.disconnect();
  }
}
