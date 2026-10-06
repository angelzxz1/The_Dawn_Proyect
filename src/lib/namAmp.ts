import * as Tone from "tone";
import { NamInstance, type NamModelInfo } from "./namEngine";
import { namSlimSize, normalizationDb, toneStack } from "./namModel";
import { noteIssue } from "./issues";

// Loading a model parses it on the audio thread, which stalls all audio
// for ~0.1-0.2 s. Undo/redo rebuilds every track's effects from scratch,
// so without care each undo would re-parse every amp model and glitch.
// Instead, an amp being torn down "parks" its engine instance - model
// still loaded - for a few seconds, and a rebuilt amp asking for the same
// model file takes it over instead of loading it again.

interface Parked {
  instance: NamInstance;
  fileId: string;
  info: NamModelInfo;
  slim: number;
  timer: ReturnType<typeof setTimeout>;
}

const PARK_MS = 4000;
const parkedByContext = new WeakMap<object, Parked[]>();

function park(context: Tone.BaseContext, entry: Omit<Parked, "timer">): void {
  const raw = context.rawContext;
  const list = parkedByContext.get(raw) ?? [];
  parkedByContext.set(raw, list);
  const parked: Parked = {
    ...entry,
    timer: setTimeout(() => {
      const i = list.indexOf(parked);
      if (i !== -1) list.splice(i, 1);
      entry.instance.dispose();
    }, PARK_MS),
  };
  list.push(parked);
}

function takeParked(context: Tone.BaseContext, fileId: string): Parked | null {
  const list = parkedByContext.get(context.rawContext);
  const i = list?.findIndex((p) => p.fileId === fileId) ?? -1;
  if (!list || i === -1) return null;
  const [parked] = list.splice(i, 1);
  clearTimeout(parked.timer);
  return parked;
}

/** The NAM Amp effect: Input gain -> the NAM model (mono; stereo input is
 * summed) -> DC blocker -> the plugin's Bass/Middle/Treble tone stack ->
 * Output gain (plus normalization to the model's loudness). Until a model
 * is loaded - and while the engine first starts - it passes audio through. */
export class NamAmpChain extends Tone.ToneAudioNode {
  readonly name = "NamAmpChain";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  private readonly inputGain: Tone.Gain;
  private readonly inputMeter = new Tone.Meter({ smoothing: 0.6 });
  private readonly direct = new Tone.Gain();
  private readonly dcBlock = new Tone.Filter({ type: "highpass", frequency: 5, Q: Math.SQRT1_2 });
  private readonly bass = new Tone.Filter({ type: "lowshelf", frequency: 150 });
  private readonly middle = new Tone.Filter({ type: "peaking", frequency: 425 });
  private readonly treble = new Tone.Filter({ type: "highshelf", frequency: 1800 });
  private readonly outputGain = new Tone.Gain();
  private instance: NamInstance | null = null;
  private instancePromise: Promise<NamInstance> | null = null;
  private fileId: string | null = null;
  private info: NamModelInfo | null = null;
  private loadToken = 0;
  private pendingLoad: Promise<string | null> = Promise.resolve(null);
  private tone: { bass: number; middle: number; treble: number };
  private outputDb: number;
  private normalize: boolean;
  private size: number;
  private isDisposed = false;

  constructor(params: Record<string, number>) {
    super();
    this.inputGain = new Tone.Gain(Tone.dbToGain(params.input));
    this.tone = { bass: params.bass, middle: params.middle, treble: params.treble };
    this.outputDb = params.output;
    this.normalize = params.normalize >= 0.5;
    this.size = params.size;
    this.applyTone();
    this.applyOutput();

    this.input.connect(this.inputGain);
    this.inputGain.connect(this.inputMeter);
    this.inputGain.connect(this.direct);
    this.direct.connect(this.dcBlock);
    this.dcBlock.chain(this.bass, this.middle, this.treble, this.outputGain, this.output);
  }

  private attach(instance: NamInstance): void {
    this.inputGain.disconnect(this.direct);
    this.inputGain.connect(instance.node);
    Tone.connect(instance.node, this.dcBlock);
    this.instance = instance;
  }

  private ensureInstance(): Promise<NamInstance> {
    this.instancePromise ??= NamInstance.create(this.context).then((instance) => {
      if (this.isDisposed) {
        instance.dispose();
        throw new Error("The amp was removed.");
      }
      this.attach(instance);
      return instance;
    });
    return this.instancePromise;
  }

  /** Loads a model (a .nam file's contents, identified by its effect-file
   * id), or unloads with null. Resolves with an error message if the engine
   * can't load it, in which case the previous model stays. */
  setModel(fileId: string | null, json: string | null): Promise<string | null> {
    const token = ++this.loadToken;
    this.pendingLoad = this.load(token, fileId, json);
    return this.pendingLoad;
  }

  /** Resolves once the most recent setModel has finished (WAV export waits
   * on this before rendering). */
  whenLoaded(): Promise<string | null> {
    return this.pendingLoad;
  }

  private async load(token: number, fileId: string | null, json: string | null): Promise<string | null> {
    if (!fileId || !json) {
      this.fileId = null;
      this.info = null;
      this.applyOutput();
      await this.instance?.unloadModel().catch((error) => noteIssue("nam.unload", error));
      return null;
    }
    if (fileId === this.fileId && this.info) return null;

    const slim = namSlimSize(this.size);
    if (!this.instance && !this.instancePromise) {
      const parked = takeParked(this.context, fileId);
      if (parked) {
        this.instancePromise = Promise.resolve(parked.instance);
        this.attach(parked.instance);
        this.fileId = fileId;
        this.info = parked.info;
        this.applyOutput();
        if (parked.slim !== slim && parked.info.slimmable) await parked.instance.setSlimSize(slim).catch((error) => noteIssue("nam.slim", error));
        return null;
      }
    }

    try {
      const instance = await this.ensureInstance();
      if (token !== this.loadToken) return null;
      const info = await instance.loadModel(json, slim);
      if (token !== this.loadToken) return null;
      this.fileId = fileId;
      this.info = info;
      this.applyOutput();
      return null;
    } catch (error) {
      if (token !== this.loadToken || this.isDisposed) return null;
      return error instanceof Error ? error.message : String(error);
    }
  }

  private applyTone(): void {
    const stack = toneStack(this.tone.bass, this.tone.middle, this.tone.treble);
    this.bass.gain.value = stack.bass.gainDb;
    this.middle.gain.value = stack.middle.gainDb;
    this.middle.Q.value = stack.middle.q;
    this.treble.gain.value = stack.treble.gainDb;
  }

  private applyOutput(): void {
    const loudness = this.info?.hasLoudness ? this.info.loudness : null;
    this.outputGain.gain.value = Tone.dbToGain(this.outputDb + normalizationDb(this.normalize, loudness));
  }

  setInput(db: number): void {
    this.inputGain.gain.value = Tone.dbToGain(db);
  }

  setTone(key: "bass" | "middle" | "treble", value: number): void {
    this.tone[key] = value;
    this.applyTone();
  }

  setOutput(db: number): void {
    this.outputDb = db;
    this.applyOutput();
  }

  setNormalize(on: boolean): void {
    this.normalize = on;
    this.applyOutput();
  }

  setSize(value: number): void {
    const changed = namSlimSize(value) !== namSlimSize(this.size);
    this.size = value;
    if (changed && this.instance && this.info?.slimmable) void this.instance.setSlimSize(namSlimSize(value)).catch((error) => noteIssue("nam.slim", error));
  }

  /** Level going into the model (after Input), in dB. */
  get inputLevelDb(): number {
    const v = this.inputMeter.getValue();
    return Array.isArray(v) ? Math.max(...v) : v;
  }

  dispose(): this {
    super.dispose();
    this.isDisposed = true;
    this.loadToken++;
    const instance = this.instance;
    if (instance) {
      this.inputGain.disconnect(instance.node);
      instance.node.disconnect();
      const live = !(this.context instanceof Tone.OfflineContext);
      if (live && this.fileId && this.info) {
        park(this.context, { instance, fileId: this.fileId, info: this.info, slim: namSlimSize(this.size) });
      } else {
        instance.dispose();
      }
    }
    this.inputGain.dispose();
    this.inputMeter.dispose();
    this.direct.dispose();
    this.dcBlock.dispose();
    this.bass.dispose();
    this.middle.dispose();
    this.treble.dispose();
    this.outputGain.dispose();
    this.input.dispose();
    this.output.dispose();
    return this;
  }
}
