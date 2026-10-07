// The amp's DSP: a high-gain tube amp modeled stage by stage, run in an
// AudioWorklet (ampSim.ts). Kept as source text like the other kernels, so
// the unit tests run exactly what plays.
//
// Signal path, as in a three-channel American high-gain head:
//   input coupling (sets how tight the low end is)
//   -> up to four triode stages, each a cathode-bypass shelf, gain, an
//      asymmetric soft clip whose bias shifts as the grid conducts (the
//      stage "grabs" when hit hard), a coupling high-pass and the plate's
//      Miller low-pass; the Gain knob sits after the first stage
//   -> cathode follower -> the passive bass/mid/treble network (after the
//      distortion, so the controls carve the distorted tone)
//   -> master -> power amp: presence and depth (the feedback loop's
//      shaping), phase inverter and push-pull output stage clipping, the
//      power supply sagging under load, the output transformer's band
//   -> output level.
// Everything from the first stage to the output transformer runs at 4x
// the sample rate, so the distortion's harmonics don't fold back down as
// aliasing.
//
// The tone stack isn't a remembered formula: whenever a control moves, the
// circuit (capacitors, pots, slope and load resistors) is solved at a few
// frequencies and the exact third-order response fitted, then turned into
// a digital filter.

/** The oversampling factor. */
export const AMP_OS = 4;
/** Taps of the oversampling filters (each way). */
export const AMP_FIR_TAPS = 64;
/** Latency (samples at the base rate) of the oversampling. */
export const AMP_LATENCY = Math.round((AMP_FIR_TAPS - 1) / AMP_OS);

/** The kernel's settings: the knobs (0-1, as positions) and the voicing. */
export interface AmpSettings {
  gain: number;
  bass: number;
  mid: number;
  treble: number;
  presence: number;
  master: number;
  /** Output level, dB. */
  output: number;
  /** Triode stages that clip, and their gains (linear). */
  stageGains: number[];
  /** Cathode-bypass shelf per stage: frequency (Hz) below which the stage
   * has less gain, and how much less (0-1 of the gain kept). */
  shelfHz: number[];
  shelfKeep: number[];
  /** Coupling high-pass after each stage (Hz). */
  couplingHz: number[];
  /** Plate (Miller) low-pass after each stage (Hz). */
  millerHz: number[];
  /** Input coupling high-pass (Hz). */
  inputHz: number;
  /** How much softer the cutoff side clips than the saturation side (>= 1). */
  asymmetry: number;
  /** How far hard playing shifts a stage's bias (0-1). */
  bias: number;
  /** Bright shelf added at low gain (dB at full, fades as gain rises). */
  bright: number;
  /** Tone stack components: treble cap, bass cap, mid cap (F), treble,
   * bass, mid pots and slope resistor (ohm). */
  stack: { c1: number; c2: number; c3: number; r1: number; r2: number; r3: number; r4: number };
  /** Gain after the tone stack, into the master (linear). */
  stackGain: number;
  /** Power amp: drive into the output stage (linear, at full master). */
  powerDrive: number;
  /** Presence: high shelf (Hz, max dB); depth: low peak (Hz, dB). */
  presenceHz: number;
  presenceDb: number;
  depthHz: number;
  depthDb: number;
  /** Supply sag: 0 none (diode rectifier) to 1 (tube rectifier). */
  sag: number;
  /** Output transformer band (Hz). */
  lowHz: number;
  highHz: number;
}

export const AMP_SOURCE = String.raw`
const AMP_OS = 4;
const AMP_TAPS = 64;

// --- Small filters (run at the oversampled rate) ---
class OnePole {
  constructor() { this.a = 0; this.z = 0; }
  lowpass(fc, fs) { this.a = Math.exp((-2 * Math.PI * fc) / fs); }
  lp(x) { this.z = x + this.a * (this.z - x); return this.z; }
  hp(x) { return x - this.lp(x); }
}
// RBJ biquad, transposed direct form II.
class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
  set(type, fc, q, db, fs) {
    const w = (2 * Math.PI * Math.min(fc, fs * 0.45)) / fs, c = Math.cos(w), s = Math.sin(w), alpha = s / (2 * q);
    const A = Math.pow(10, db / 40);
    let b0, b1, b2, a0, a1, a2;
    if (type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha; }
    else if (type === "hp") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha; }
    else if (type === "peak") { b0 = 1 + alpha * A; b1 = -2 * c; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * c; a2 = 1 - alpha / A; }
    else if (type === "highshelf") {
      const sq = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * c + sq); b1 = -2 * A * (A - 1 + (A + 1) * c); b2 = A * (A + 1 + (A - 1) * c - sq);
      a0 = A + 1 - (A - 1) * c + sq; a1 = 2 * (A - 1 - (A + 1) * c); a2 = A + 1 - (A - 1) * c - sq;
    } else {
      const sq = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * c + sq); b1 = 2 * A * (A - 1 - (A + 1) * c); b2 = A * (A + 1 - (A - 1) * c - sq);
      a0 = A + 1 + (A - 1) * c + sq; a1 = -2 * (A - 1 + (A + 1) * c); a2 = A + 1 + (A - 1) * c - sq;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

// --- The tone stack: solve the circuit, fit H(s), make a digital filter ---

// Node voltages of the stack for input 1 V at complex frequency s = (0, w).
// Nodes: 0 treble pot top, 1 wiper (output), 2 treble pot bottom / bass top,
// 3 slope node, 4 bass bottom / mid top.
function stackResponse(st, t, l, m, w) {
  const n = 5, G = [], I = [];
  for (let i = 0; i < n; i++) { G.push(new Float64Array(2 * n)); I.push([0, 0]); }
  const rmin = 50;
  const addY = (a, b, yr, yi) => {
    if (a >= 0) { G[a][2 * a] += yr; G[a][2 * a + 1] += yi; }
    if (b >= 0) { G[b][2 * b] += yr; G[b][2 * b + 1] += yi; }
    if (a >= 0 && b >= 0) { G[a][2 * b] -= yr; G[a][2 * b + 1] -= yi; G[b][2 * a] -= yr; G[b][2 * a + 1] -= yi; }
  };
  // From the input (1 V): current into node a.
  const fromIn = (a, yr, yi) => { G[a][2 * a] += yr; G[a][2 * a + 1] += yi; I[a][0] += yr; I[a][1] += yi; };
  const R = (a, b, r) => addY(a, b, 1 / Math.max(r, rmin), 0);
  const C = (a, b, c) => addY(a, b, 0, w * c);
  fromIn(0, 0, w * st.c1);            // treble cap
  R(0, 1, (1 - t) * st.r1);           // treble pot, top to wiper
  R(1, 2, t * st.r1);                 // wiper to bottom
  fromIn(3, 1 / st.r4, 0);            // slope resistor
  C(3, 2, st.c2);                     // bass cap
  C(3, 4, st.c3);                     // mid cap
  R(2, 4, l * st.r2);                 // bass pot
  R(4, -1, m * st.r3);                // mid pot to ground
  R(1, -1, 1e6);                      // the next stage's grid resistor
  // Complex Gaussian elimination.
  const A = G.map((row, i) => { const r = Array.from(row); r.push(I[i][0], I[i][1]); return r; });
  for (let c = 0; c < n; c++) {
    let p = c, best = 0;
    for (let r = c; r < n; r++) { const v = Math.hypot(A[r][2 * c], A[r][2 * c + 1]); if (v > best) { best = v; p = r; } }
    [A[c], A[p]] = [A[p], A[c]];
    const pr = A[c][2 * c], pi = A[c][2 * c + 1], d = pr * pr + pi * pi;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const fr = (A[r][2 * c] * pr + A[r][2 * c + 1] * pi) / d, fi = (A[r][2 * c + 1] * pr - A[r][2 * c] * pi) / d;
      for (let k = 0; k <= n; k++) {
        const xr = A[c][2 * k], xi = A[c][2 * k + 1];
        A[r][2 * k] -= fr * xr - fi * xi; A[r][2 * k + 1] -= fr * xi + fi * xr;
      }
    }
  }
  const pr = A[1][2], pi = A[1][3], d = pr * pr + pi * pi, br = A[1][2 * n], bi = A[1][2 * n + 1];
  return [(br * pr + bi * pi) / d, (bi * pr - br * pi) / d];
}

// Fits H(s) = (b1 s + b2 s^2 + b3 s^3) / (1 + a1 s + a2 s^2 + a3 s^3) to the
// circuit (least squares, s scaled by w0 so the system is well conditioned).
function fitStack(st, t, l, m) {
  const w0 = 2 * Math.PI * 1000;
  const freqs = [15, 40, 110, 300, 800, 2000, 5000, 12000];
  const rows = [], rhs = [];
  for (const f of freqs) {
    const w = 2 * Math.PI * f, [hr, hi] = stackResponse(st, t, l, m, w);
    // s' = j w/w0; s'^1 = j v, s'^2 = -v^2, s'^3 = -j v^3.
    const v = w / w0, s = [[0, v], [-v * v, 0], [0, -v * v * v]];
    // b_k s^k - H a_k s^k = H
    const re = [], im = [];
    for (let k = 0; k < 3; k++) { re.push(s[k][0]); im.push(s[k][1]); }
    for (let k = 0; k < 3; k++) {
      const hsr = hr * s[k][0] - hi * s[k][1], hsi = hr * s[k][1] + hi * s[k][0];
      re.push(-hsr); im.push(-hsi);
    }
    rows.push(re, im); rhs.push(hr, hi);
  }
  // Normal equations.
  const N = 6, M = [];
  for (let i = 0; i < N; i++) { M.push(new Float64Array(N + 1)); }
  for (let r = 0; r < rows.length; r++) for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) M[i][j] += rows[r][i] * rows[r][j];
    M[i][N] += rows[r][i] * rhs[r];
  }
  for (let c = 0; c < N; c++) {
    let p = c;
    for (let r = c + 1; r < N; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < N; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= N; k++) M[r][k] -= f * M[c][k];
    }
  }
  const u = M.map((row, i) => row[N] / row[i]);
  // Unscale: coefficient of s^k (unscaled) = coefficient of s'^k / w0^k.
  return { b: [0, u[0] / w0, u[1] / (w0 * w0), u[2] / (w0 * w0 * w0)], a: [1, u[3] / w0, u[4] / (w0 * w0), u[5] / (w0 * w0 * w0)] };
}

// Bilinear transform of a third-order H(s) at sample rate fs.
function bilinear3(b, a, fs) {
  const K = 2 * fs;
  // s^k -> K^k (1 - z^-1)^k (1 + z^-1)^(3-k)
  const poly = (k) => {
    let p = [1];
    const mul = (q) => { const r = new Array(p.length + 1).fill(0); for (let i = 0; i < p.length; i++) { r[i] += p[i] * q[0]; r[i + 1] += p[i] * q[1]; } p = r; };
    for (let i = 0; i < k; i++) mul([1, -1]);
    for (let i = k; i < 3; i++) mul([1, 1]);
    return p.map((c) => c * Math.pow(K, k));
  };
  const B = [0, 0, 0, 0], A = [0, 0, 0, 0];
  for (let k = 0; k <= 3; k++) { const p = poly(k); for (let i = 0; i < 4; i++) { B[i] += b[k] * p[i]; A[i] += a[k] * p[i]; } }
  return { b: B.map((v) => v / A[0]), a: A.map((v) => v / A[0]) };
}

// --- Oversampling filters ---
function designFir() {
  const h = new Float64Array(AMP_TAPS), fc = 0.45 / AMP_OS, mid = (AMP_TAPS - 1) / 2;
  let sum = 0;
  for (let i = 0; i < AMP_TAPS; i++) {
    const x = i - mid, sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    // Blackman window
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (AMP_TAPS - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (AMP_TAPS - 1));
    h[i] = sinc * w; sum += h[i];
  }
  for (let i = 0; i < AMP_TAPS; i++) h[i] /= sum;
  return h;
}

// The triode: soft saturation on the positive side (grid conduction), a
// softer, later limit on the cutoff side.
function triode(u, asym) {
  return u >= 0 ? Math.tanh(u) : asym * Math.tanh(u / asym);
}

class AmpKernel {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.fs = sampleRate * AMP_OS;
    this.h = designFir();
    this.up = new Float64Array((2 * AMP_TAPS) / AMP_OS);
    this.upPos = 0;
    this.down = new Float64Array(2 * AMP_TAPS);
    this.downPos = 0;
    this.inHp = new OnePole();
    this.stages = [];
    for (let i = 0; i < 4; i++) this.stages.push({ shelf: new OnePole(), hp: new OnePole(), lp: new OnePole(), shift: 0, gain: 0, keep: 1 });
    this.bright = new Biquad();
    this.stack = { b: [0, 0, 0, 0], a: [1, 0, 0, 0], z: [0, 0, 0] };
    this.presence = new Biquad();
    this.depth = new Biquad();
    this.otLow = new Biquad();
    this.otHigh = new Biquad();
    this.dc = new OnePole();
    this.env = 0;
    this.s = null;
    this.stackKey = "";
  }

  set(s) {
    this.s = s;
    const fs = this.fs;
    this.inHp.lowpass(s.inputHz, fs);
    this.nStages = s.stageGains.length;
    for (let i = 0; i < this.nStages; i++) {
      const st = this.stages[i];
      st.gain = s.stageGains[i];
      st.keep = s.shelfKeep[i];
      st.shelf.lowpass(s.shelfHz[i], fs);
      st.hp.lowpass(s.couplingHz[i], fs);
      st.lp.lowpass(s.millerHz[i], fs);
    }
    // Gain pot: audio taper.
    this.gainPot = (Math.pow(10, 2 * s.gain) - 1) / 99;
    this.bright.set("highshelf", 2500, 0.6, s.bright * (1 - s.gain), fs);
    const key = [s.treble, s.bass, s.mid, s.stack.c1, s.stack.c2, s.stack.c3, s.stack.r1, s.stack.r2, s.stack.r3, s.stack.r4].join(",");
    if (key !== this.stackKey) {
      this.stackKey = key;
      const taper = (x) => (Math.pow(10, 2 * x) - 1) / 99;
      const fit = fitStack(s.stack, s.treble, taper(s.bass), taper(s.mid));
      const d = bilinear3(fit.b, fit.a, fs);
      this.stack.b = d.b; this.stack.a = d.a;
    }
    this.masterGain = ((Math.pow(10, 2 * s.master) - 1) / 99) * s.powerDrive;
    this.presence.set("highshelf", s.presenceHz, 0.7, s.presenceDb * s.presence, fs);
    this.depth.set("peak", s.depthHz, 0.9, s.depthDb, fs);
    this.otLow.set("hp", s.lowHz, 0.6, 0, fs);
    this.otHigh.set("lp", s.highHz, 0.6, 0, fs);
    this.dc.lowpass(10, fs);
    this.outGain = Math.pow(10, s.output / 20);
    // Sag: attack ~8 ms, release ~120 ms (at the oversampled rate).
    this.sagAtk = 1 - Math.exp(-1 / (0.008 * fs));
    this.sagRel = 1 - Math.exp(-1 / (0.12 * fs));
    this.shiftRate = 1 - Math.exp(-1 / (0.03 * fs));
  }

  // One sample at the oversampled rate.
  tick(x) {
    const s = this.s;
    x = this.inHp.hp(x);
    const sag = 1 - 0.35 * s.sag * this.env;
    for (let i = 0; i < this.nStages; i++) {
      const st = this.stages[i];
      // Cathode bypass: less gain below the shelf frequency.
      const low = st.shelf.lp(x);
      x = x - (1 - st.keep) * low;
      let u = x * st.gain * (i === 0 ? 1 : sag);
      // The grid conducting on big swings shifts the bias (the stage grabs).
      u -= st.shift;
      const y = triode(u, s.asymmetry) - triode(-st.shift, s.asymmetry);
      st.shift += this.shiftRate * (s.bias * Math.max(0, u - 0.6) - st.shift);
      x = st.lp.lp(st.hp.hp(-y));
      if (i === 0) x = this.bright.run(x * this.gainPot);
    }
    // Cathode follower into the stack: a soft limit on large swings.
    x = x / (1 + 0.15 * Math.abs(x));
    // Tone stack (third order, direct form I).
    const tb = this.stack.b, ta = this.stack.a, z = this.stack.z;
    const y = tb[0] * x + z[0];
    z[0] = tb[1] * x - ta[1] * y + z[1];
    z[1] = tb[2] * x - ta[2] * y + z[2];
    z[2] = tb[3] * x - ta[3] * y;
    x = y * s.stackGain;
    // Power amp.
    x = this.depth.run(this.presence.run(x * this.masterGain));
    const head = 1 - 0.3 * s.sag * this.env;
    x = Math.tanh(x * 0.8) / 0.8;                       // phase inverter
    x = head * Math.tanh(x / head);                      // output stage
    const p = x * x;
    this.env += (p > this.env ? this.sagAtk : this.sagRel) * (p - this.env);
    x = this.otHigh.run(this.otLow.run(x));
    return this.dc.hp(x) * this.outGain;
  }

  process(input, output, n) {
    // History buffers are written twice (at i and i + len), so each filter
    // reads one contiguous run without wrapping.
    const h = this.h, up = this.up, L = AMP_TAPS / AMP_OS, down = this.down, T = AMP_TAPS;
    for (let i = 0; i < n; i++) {
      const x = (input ? input[i] : 0) * AMP_OS;
      this.upPos = this.upPos === 0 ? L - 1 : this.upPos - 1;
      up[this.upPos] = x; up[this.upPos + L] = x;
      for (let p = 0; p < AMP_OS; p++) {
        // Polyphase interpolation: phase p uses taps p, p + 4, p + 8...
        let v = 0;
        for (let k = 0, j = this.upPos; k < L; k++, j++) v += h[p + AMP_OS * k] * up[j];
        const y = this.tick(v);
        this.downPos = this.downPos === 0 ? T - 1 : this.downPos - 1;
        down[this.downPos] = y; down[this.downPos + T] = y;
      }
      let acc = 0;
      for (let k = 0, j = this.downPos; k < T; k++, j++) acc += h[k] * down[j];
      output[i] = acc;
    }
  }
}
`;
