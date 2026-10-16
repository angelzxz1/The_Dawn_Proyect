// What the parity tests between a JavaScript DSP kernel and its Rust port
// (crates/dawn-engine) share. A kernel's parity test renders a set of cases
// with the JavaScript kernel and keeps the result as a fixture in
// crates/dawn-engine/tests/fixtures/: a generated Rust file with the cases
// and settings, and a binary file with the rendered samples and meters.
// `cargo test` renders the same cases with the Rust port and compares.
//
// Both sides build the same test signal from the same steps
// (crates/dawn-engine/tests/common/mod.rs mirrors paritySignal), using only
// arithmetic that rounds identically in JavaScript and Rust, so only the
// output needs storing; the fixture records the signal's hash to catch the
// two drifting apart.

export const PARITY_SAMPLE_RATE = 48000;
/** 0.4 s. */
export const PARITY_FRAMES = 19200;
/** Frames per process() call, as an AudioWorklet's render quantum. */
export const PARITY_BLOCK = 128;
/** Every this-many-th output sample is kept (a stride that isn't a factor
 * of the block, so the kept samples fall at every position in a block). */
export const PARITY_STRIDE = 17;
/** How often (frames) the worklets read their kernel's meters. */
export const PARITY_METER_INTERVAL = 512;

/** The test signal: a stereo input (two saws and noise through quiet, loud,
 * quiet and decaying-hit sections) and a stereo key (noise bursts every
 * 75 ms, the right at half the left). */
export interface ParitySignal {
  inL: Float32Array;
  inR: Float32Array;
  keyL: Float32Array;
  keyR: Float32Array;
}

export function paritySignal(frames = PARITY_FRAMES): ParitySignal {
  const sig = {
    inL: new Float32Array(frames),
    inR: new Float32Array(frames),
    keyL: new Float32Array(frames),
    keyR: new Float32Array(frames),
  };
  let seed = 0x2545f491;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };
  const incL = 110 / PARITY_SAMPLE_RATE;
  const incR = 165 / PARITY_SAMPLE_RATE;
  let phL = 0;
  let phR = 0;
  let hit = 0;
  let keyEnv = 0;
  for (let i = 0; i < frames; i++) {
    const nL = noise();
    const nR = noise();
    const nK = noise();
    phL += incL;
    if (phL >= 1) phL -= 1;
    phR += incR;
    if (phR >= 1) phR -= 1;
    let env: number;
    if (i < 2400) env = 0.02;
    else if (i < 7200) env = 0.9;
    else if (i < 12000) env = 0.1;
    else {
      if ((i - 12000) % 2400 === 0) hit = 0.8;
      else hit *= 0.9995;
      env = hit;
    }
    sig.inL[i] = env * (0.7 * (2 * phL - 1) + 0.3 * nL);
    sig.inR[i] = env * (0.7 * (2 * phR - 1) + 0.3 * nR);
    if (i % 3600 === 0) keyEnv = 1;
    else keyEnv *= 0.999;
    const k = keyEnv * 0.9 * nK;
    sig.keyL[i] = k;
    sig.keyR[i] = k * 0.5;
  }
  return sig;
}

/** 32-bit FNV-1a over the arrays' samples (their little-endian bytes). */
export function fnv1a(arrays: Float32Array[]): number {
  let h = 2166136261;
  for (const a of arrays) {
    const view = new DataView(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < a.length; i++) {
      const bits = view.getUint32(i * 4, true);
      for (let b = 0; b < 4; b++) {
        h ^= (bits >>> (8 * b)) & 0xff;
        h = Math.imul(h, 16777619) >>> 0;
      }
    }
  }
  return h;
}

/** `x` as a Rust f64 literal. */
export function rustF64(x: number): string {
  if (!Number.isFinite(x)) throw new Error(`no Rust literal for ${x}`);
  const s = String(x);
  return /[.e]/.test(s) ? s : `${s}.0`;
}

/** `x` as a Rust u32 hex literal. */
export function rustHex(x: number): string {
  return `0x${(x >>> 0).toString(16).padStart(8, "0")}`;
}

/** A fixture's numbers, in order: runs of f32 (samples) and f64 (meters),
 * written little-endian one after another. */
export class FixtureData {
  private runs: { kind: "f32" | "f64"; values: number[] }[] = [];

  f32(values: ArrayLike<number>): void {
    this.runs.push({ kind: "f32", values: Array.from(values) });
  }

  f64(values: ArrayLike<number>): void {
    this.runs.push({ kind: "f64", values: Array.from(values) });
  }

  private get byteLength(): number {
    return this.runs.reduce((n, r) => n + r.values.length * (r.kind === "f32" ? 4 : 8), 0);
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.byteLength);
    const view = new DataView(out.buffer);
    let at = 0;
    for (const r of this.runs) {
      for (const v of r.values) {
        if (r.kind === "f32") {
          view.setFloat32(at, v, true);
          at += 4;
        } else {
          view.setFloat64(at, v, true);
          at += 8;
        }
      }
    }
    return out;
  }

  /** The largest difference between these numbers and `bytes` read with
   * the same layout - Infinity if the layout can't match. */
  maxDifference(bytes: Uint8Array): number {
    if (bytes.byteLength !== this.byteLength) return Infinity;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = 0;
    let worst = 0;
    for (const r of this.runs) {
      for (const v of r.values) {
        const f32 = r.kind === "f32";
        const stored = f32 ? view.getFloat32(at, true) : view.getFloat64(at, true);
        at += f32 ? 4 : 8;
        const d = Math.abs(stored - (f32 ? Math.fround(v) : v));
        if (Number.isNaN(d)) return Infinity;
        if (d > worst) worst = d;
      }
    }
    return worst;
  }
}
