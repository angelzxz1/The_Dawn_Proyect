// The synth's DSP ("Daybreak"): the whole instrument, run in an
// AudioWorklet (synth.ts). Kept as source text like the effects' kernels,
// so the unit tests run exactly what plays.
//
// Per voice: two wavetable oscillators (a warp each, up to 16 unison voices
// spread in pitch and stereo), a sub and a noise source feed two filters
// (serial or parallel, or straight to the output), then the amp envelope.
// Everything that moves - envelopes, LFOs, the modulation matrix, glide -
// is worked out every 32 samples ("control rate") and ramped in between, so
// modulation stays smooth while costing little.
//
// Notes arrive as timestamped events and start on their exact sample.

import { DEST_INDEX, DEST_SPECS, LFO_RATE_MAX, LFO_RATE_MIN, MAX_POLYPHONY, MAX_UNISON, MOD_SOURCES } from "./synthParams";
import { MIP_HARMONICS, MIP_SIZES } from "./wavetableModel";

export const SYNTH_STEP = 32;
/** Voices beyond the polyphony, so a stolen voice can fade out (a few ms)
 * while its replacement starts. */
const SPARE_VOICES = 4;

export const SYNTH_SOURCE = `
const STEP = ${SYNTH_STEP};
const NDEST = ${DEST_SPECS.length};
const NSRC = ${MOD_SOURCES.length};
const MAXU = ${MAX_UNISON};
const MAXV = ${MAX_POLYPHONY + SPARE_VOICES};
const DEST_MIN = ${JSON.stringify(DEST_SPECS.map((d) => d.min))};
const DEST_MAX = ${JSON.stringify(DEST_SPECS.map((d) => d.max))};
const DEST_LOG = ${JSON.stringify(DEST_SPECS.map((d) => (d.scale === "log" ? 1 : 0)))};
const DI = ${JSON.stringify(DEST_INDEX)};
const MIP_H = ${JSON.stringify(MIP_HARMONICS)};
const MIP_N = ${JSON.stringify(MIP_SIZES)};
const LFO_OCTAVES = ${Math.log2(LFO_RATE_MAX / LFO_RATE_MIN)};
const OSC_D = [1, 2].map((n) => ["level", "pan", "position", "warpAmount", "transpose", "fine", "detune", "blend", "width"].map((k) => DI["osc" + n + "." + k]));
const FIL_D = [1, 2].map((n) => ["cutoff", "resonance", "drive", "morph", "mix"].map((k) => DI["filter" + n + "." + k]));
const LFO_D = [DI["lfo1.rate"], DI["lfo2.rate"], DI["lfo3.rate"]];
const SUB_LEVEL = DI["sub.level"], SUB_PAN = DI["sub.pan"], NOISE_LEVEL = DI["noise.level"], NOISE_PAN = DI["noise.pan"];
const V_TRANSPOSE = DI["voice.transpose"], V_VOLUME = DI["voice.volume"];
// Warp modes (synthParams.ts WARP_MODES order).
const W_NONE = 0, W_SYNC = 1, W_BEND = 2, W_SQUEEZE = 3, W_PULSE = 4, W_MIRROR = 5, W_FOLD = 6, W_QUANT = 7, W_FM = 8, W_RM = 9;
// Filter types (FILTER_TYPES order).
const F_LP12 = 0, F_LP24 = 1, F_LADDER = 2, F_HP12 = 3, F_HP24 = 4, F_BP = 5, F_NOTCH = 6, F_MORPH = 7, F_COMB = 8, F_COMBN = 9, F_FORMANT = 10;
const VOWELS = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]];
const COMB_SIZE = 4096;

function fromNorm(d, n) {
  const f = n < 0 ? 0 : n > 1 ? 1 : n;
  const lo = DEST_MIN[d], hi = DEST_MAX[d];
  return DEST_LOG[d] ? lo * Math.pow(hi / lo, f) : lo + f * (hi - lo);
}

/** -1..1: 0 is linear, positive bows the segment out (fast start). */
function curve(x, c) {
  if (c > 0.001) return 1 - Math.pow(1 - x, 1 + 4 * c);
  if (c < -0.001) return Math.pow(x, 1 - 4 * c);
  return x;
}

function mipLevel(freq, sr) {
  const ceiling = Math.max(0.5, 1 - 20000 / sr) * sr;
  const maxH = ceiling / Math.max(1e-6, freq);
  for (let l = 0; l < MIP_H.length; l++) if (MIP_H[l] <= maxH) return l;
  return MIP_H.length - 1;
}

/** tanh, close enough for saturation and much cheaper. */
function sat(x) {
  if (x < -3) return -1;
  if (x > 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

function mtof(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

let seed = 22222;
function rand() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}

function makeOsc() {
  return {
    n: 0,
    ph: new Float64Array(MAXU),
    inc: new Float64Array(MAXU),
    lvl: new Int32Array(MAXU),
    ul: new Float32Array(MAXU),
    ur: new Float32Array(MAXU),
    um: new Float32Array(MAXU),
    pos: 0, posD: 0,
    amt: 0, amtD: 0,
    lv: 0, lvD: 0,
    buf: new Float32Array(128),
  };
}

function makeFilter() {
  return {
    type: -1,
    // SVF coefficients (ramped) and states: [stage1 L ic1, ic2, R ic1, ic2, stage2 ...]
    a1: 0, a2: 0, a3: 0, k: 1, a1D: 0, a2D: 0, a3D: 0, kD: 0,
    b1: 0, b2: 0, b3: 0, kb: 1.41,
    s: new Float64Array(16),
    G: 0, GD: 0, lk: 0, dg: 1, drive: 0, morph: 0, mix: 1,
    combL: null, combR: null, combW: 0, combD: 100, combFb: 0, combDamp: 0, combLpL: 0, combLpR: 0,
    fa: null,
  };
}

function makeVoice() {
  return {
    active: false, gate: false, stealing: false, fade: 1,
    note: 60, vel: 0, age: 0, rnd: 0,
    pitch: 60, target: 60, glideRate: 0,
    env: [0, 1, 2].map(() => ({ stage: 0, t: 0, level: 0, from: 0 })),
    lfo: [0, 1, 2].map(() => ({ phase: 0, prev: 0, next: 0, fadeT: 0, done: false, value: 0 })),
    mod: new Float32Array(NDEST),
    srcU: new Float32Array(NSRC),
    srcB: new Float32Array(NSRC),
    osc: [makeOsc(), makeOsc()],
    subPh: 0, subInc: 0, subLvl: 0, subL: 0, subR: 0, subLv: 0, subLvD: 0,
    pink: new Float64Array(7), noiseL: 0, noiseR: 0, noiseLv: 0, noiseLvD: 0,
    filt: [makeFilter(), makeFilter()],
    amp: 0, ampD: 0,
  };
}

class DawnSynthKernel {
  constructor(sr) {
    this.sr = sr;
    this.bpm = 120;
    this.s = null;
    this.tables = [null, null];
    this.sub = null;
    this.voices = [];
    for (let i = 0; i < MAXV; i++) this.voices.push(makeVoice());
    this.events = [];
    this.modwheel = 0;
    this.bend = 0;
    this.lastNote = -1;
    this.stack = [];
    this.counter = 0;
    this.globalLfo = [0, 0, 0];
    this.ctrlLeft = 0;
    this.frame = 0;
    const b = () => new Float32Array(128);
    this.bus = { f1L: b(), f1R: b(), f2L: b(), f2R: b(), dL: b(), dR: b() };
    this.peakL = 0;
    this.peakR = 0;
    this.scope = new Float32Array(1024);
    this.scopeW = 0;
  }

  setSettings(s) {
    this.s = s;
    // Which buses anything reaches, so the rest are skipped.
    let f1 = false, f2 = false, d = false;
    const add = (on, dest) => {
      if (!on) return;
      if (dest === 0) f1 = true;
      else if (dest === 1) f2 = true;
      else if (dest === 2) { f1 = true; if (!s.serial) f2 = true; }
      else d = true;
    };
    add(s.osc[0].on, s.osc[0].dest);
    add(s.osc[1].on, s.osc[1].dest);
    add(s.sub.on, s.sub.dest);
    add(s.noise.on, s.noise.dest);
    if (s.serial && f1 && s.filters[1].on) f2 = true;
    this.use = { f1, f2, d };
  }

  setTable(slot, data) {
    if (slot === 2) this.sub = data;
    else this.tables[slot] = data;
  }

  /** e: { type: "on" | "off" | "allOff" | "panic", note, vel, time (s) } */
  addEvent(e) {
    const list = this.events;
    let i = list.length;
    while (i > 0 && list[i - 1].time > e.time) i--;
    list.splice(i, 0, e);
  }

  // --- notes ---

  noteOn(note, vel) {
    const s = this.s;
    if (!s) return;
    const mode = s.voice.mode;
    if (mode === 0) {
      let v = null;
      for (const x of this.voices) if (x.active && x.gate && !x.stealing && x.note === note) v = x;
      if (!v) {
        let count = 0;
        for (const x of this.voices) if (x.active && !x.stealing) count++;
        while (count >= s.voice.polyphony) {
          this.steal();
          count--;
        }
        v = this.freeVoice();
      }
      this.startVoice(v, note, vel, this.lastNote);
    } else {
      this.stack = this.stack.filter((n) => n !== note);
      this.stack.push(note);
      let v = null;
      for (const x of this.voices) if (x.active && !x.stealing) {
        if (v && x.age < v.age) { this.release(x, true); continue; }
        if (v) this.release(v, true);
        v = x;
      }
      if (v && v.gate) {
        this.glideTo(v, note);
        v.note = note;
        v.vel = vel;
        if (mode === 1) this.retrigger(v);
      } else {
        const from = v ? v.pitch : this.lastNote;
        if (v) this.release(v, true);
        this.startVoice(this.freeVoice(), note, vel, from);
      }
    }
    this.lastNote = note;
  }

  noteOff(note) {
    const s = this.s;
    if (!s) return;
    if (s.voice.mode === 0) {
      for (const v of this.voices) if (v.active && v.gate && v.note === note) this.release(v, false);
      return;
    }
    const wasTop = this.stack[this.stack.length - 1] === note;
    this.stack = this.stack.filter((n) => n !== note);
    if (!wasTop) return;
    for (const v of this.voices) {
      if (!v.active || !v.gate || v.stealing) continue;
      if (this.stack.length > 0) {
        const back = this.stack[this.stack.length - 1];
        this.glideTo(v, back);
        v.note = back;
      } else this.release(v, false);
    }
  }

  allOff(hard) {
    this.stack = [];
    for (const v of this.voices) {
      if (!v.active) continue;
      if (hard) this.release(v, true);
      else if (v.gate) this.release(v, false);
    }
  }

  freeVoice() {
    let best = null;
    for (const v of this.voices) if (!v.active) return v;
    // Every voice is busy (or fading out): take the one fading longest.
    for (const v of this.voices) if (!best || v.age < best.age) best = v;
    best.active = false;
    return best;
  }

  steal() {
    let pick = null;
    for (const v of this.voices) {
      if (!v.active || v.stealing || v.gate) continue;
      if (!pick || v.age < pick.age) pick = v;
    }
    if (!pick) for (const v of this.voices) {
      if (!v.active || v.stealing) continue;
      if (!pick || v.age < pick.age) pick = v;
    }
    if (pick) this.release(pick, true);
  }

  /** Release a voice: through its envelopes, or (stolen) a quick fade. */
  release(v, fast) {
    if (fast) {
      v.stealing = true;
      v.gate = false;
      return;
    }
    v.gate = false;
    for (const e of v.env) {
      if (e.stage === 0) continue;
      e.from = e.level;
      e.stage = 6;
      e.t = 0;
    }
  }

  glideTo(v, note) {
    const glide = this.s.voice.glide;
    v.target = note;
    if (glide > 0) v.glideRate = Math.abs(note - v.pitch) / (glide * this.sr);
    else v.pitch = note;
  }

  retrigger(v) {
    const s = this.s;
    v.env.forEach((e) => {
      e.from = e.level;
      e.stage = 1;
      e.t = 0;
    });
    v.lfo.forEach((st, i) => {
      if (s.lfos[i].mode !== 1) {
        st.phase = 0;
        st.done = false;
      }
      st.fadeT = 0;
    });
  }

  startVoice(v, note, vel, from) {
    const s = this.s;
    const fresh = !v.active;
    v.active = true;
    v.gate = true;
    v.stealing = false;
    v.fade = 1;
    v.note = note;
    v.vel = vel;
    v.age = ++this.counter;
    v.rnd = rand();
    v.target = note;
    if (s.voice.glide > 0 && from >= 0 && from !== note) {
      v.pitch = from;
      v.glideRate = Math.abs(note - from) / (s.voice.glide * this.sr);
    } else v.pitch = note;
    if (fresh) {
      v.amp = 0;
      v.env.forEach((e) => {
        e.level = 0;
        e.from = 0;
      });
      for (let o = 0; o < 2; o++) {
        const O = v.osc[o];
        const S = s.osc[o];
        O.n = 0;
        for (let u = 0; u < MAXU; u++) O.ph[u] = (S.phase + S.randomPhase * rand()) % 1;
      }
      v.subPh = 0;
      v.pink.fill(0);
      v.filt.forEach((f) => this.resetFilter(f));
    }
    v.lfo.forEach((st, i) => {
      const L = s.lfos[i];
      st.phase = L.mode === 1 ? this.globalLfo[i] : 0;
      st.done = false;
      st.fadeT = 0;
      st.prev = rand();
      st.next = rand();
    });
    this.retrigger(v);
    // The first samples already play with this note's settings.
    this.control(v, true);
  }

  resetFilter(f) {
    f.s.fill(0);
    f.combLpL = 0;
    f.combLpR = 0;
    if (f.combL) {
      f.combL.fill(0);
      f.combR.fill(0);
    }
    if (f.fa) f.fa.fill(0);
  }

  // --- control rate ---

  envStep(e, p, dt) {
    switch (e.stage) {
      case 1:
        e.t += dt;
        if (e.t >= p.delay) { e.stage = 2; e.t = 0; }
        break;
      case 2: {
        e.t += dt;
        const x = p.attack > 0 ? e.t / p.attack : 1;
        if (x >= 1) { e.level = 1; e.stage = 3; e.t = 0; }
        else e.level = e.from + (1 - e.from) * curve(x, p.attackCurve);
        break;
      }
      case 3:
        e.level = 1;
        e.t += dt;
        if (e.t >= p.hold) { e.stage = 4; e.t = 0; }
        break;
      case 4: {
        e.t += dt;
        const x = e.t / Math.max(1e-4, p.decay);
        if (x >= 1) { e.level = p.sustain; e.stage = 5; }
        else e.level = p.sustain + (1 - p.sustain) * (1 - curve(x, p.decayCurve));
        break;
      }
      case 5:
        e.level = p.sustain;
        break;
      case 6: {
        e.t += dt;
        const x = e.t / Math.max(1e-4, p.release);
        if (x >= 1) { e.level = 0; e.stage = 0; }
        else e.level = e.from * (1 - curve(x, p.releaseCurve));
        break;
      }
      default:
        e.level = 0;
    }
  }

  lfoRate(i, v) {
    const L = this.s.lfos[i];
    let rate = L.sync ? this.bpm / 60 / L.beats : L.rate;
    if (v) rate *= Math.pow(2, (v.mod[LFO_D[i]] - this.s.base[LFO_D[i]]) * LFO_OCTAVES);
    return rate;
  }

  lfoStep(v, i, dt) {
    const L = this.s.lfos[i];
    const st = v.lfo[i];
    if (!st.done) {
      st.phase += this.lfoRate(i, v) * dt;
      if (st.phase >= 1) {
        if (L.mode === 2) { st.phase = 1; st.done = true; }
        else {
          st.phase -= Math.floor(st.phase);
          st.prev = st.next;
          st.next = rand();
        }
      }
    }
    const raw = st.done ? 0.99999 : st.phase;
    let p = raw + L.phase;
    p -= Math.floor(p);
    let u;
    switch (L.shape) {
      case 0: u = 0.5 + 0.5 * Math.sin(2 * Math.PI * p); break;
      case 1: { const q = (p + 0.25) % 1; u = q < 0.5 ? 2 * q : 2 - 2 * q; break; }
      case 2: u = 1 - p; break;
      case 3: u = p; break;
      case 4: u = p < 0.5 ? 1 : 0; break;
      case 5: u = st.next; break;
      default: { const m = 0.5 - 0.5 * Math.cos(Math.PI * raw); u = st.prev + (st.next - st.prev) * m; }
    }
    st.fadeT += dt;
    const f = L.fade > 0 ? Math.min(1, st.fadeT / L.fade) : 1;
    st.value = u;
    v.srcU[3 + i] = u * f;
    v.srcB[3 + i] = (2 * u - 1) * f;
  }

  /** Sources, the modulation matrix, then every per-voice target. */
  control(v, snap) {
    const s = this.s;
    const dt = snap ? 0 : STEP / this.sr;
    for (let i = 0; i < 3; i++) this.envStep(v.env[i], s.envs[i], dt);
    const srcU = v.srcU, srcB = v.srcB;
    for (let i = 0; i < 3; i++) {
      srcU[i] = v.env[i].level;
      srcB[i] = 2 * v.env[i].level - 1;
    }
    for (let i = 0; i < 3; i++) this.lfoStep(v, i, dt);
    srcU[6] = v.vel; srcB[6] = 2 * v.vel - 1;
    srcU[7] = v.note / 127; srcB[7] = (v.note - 64) / 64;
    srcU[8] = this.modwheel; srcB[8] = 2 * this.modwheel - 1;
    srcU[9] = (this.bend + 1) / 2; srcB[9] = this.bend;
    srcU[10] = v.rnd; srcB[10] = 2 * v.rnd - 1;
    for (let i = 0; i < 4; i++) {
      srcU[11 + i] = s.macros[i];
      srcB[11 + i] = 2 * s.macros[i] - 1;
    }
    const mod = v.mod;
    const base = s.base;
    for (let d = 0; d < NDEST; d++) mod[d] = base[d];
    const r = s.routes;
    for (let i = 0; i < r.length; i += 4) {
      mod[r[i + 1]] += r[i + 2] * (r[i + 3] ? srcB[r[i]] : srcU[r[i]]);
    }

    // Glide.
    if (v.pitch !== v.target) {
      const step = v.glideRate * (snap ? 0 : STEP);
      if (Math.abs(v.target - v.pitch) <= step || v.glideRate <= 0) v.pitch = v.target;
      else v.pitch += v.target > v.pitch ? step : -step;
    }
    const pitch = v.pitch + fromNorm(V_TRANSPOSE, mod[V_TRANSPOSE]) + this.bend * s.voice.bendRange;

    for (let o = 0; o < 2; o++) this.controlOsc(v, o, pitch, snap);

    // Sub.
    const sr = this.sr;
    const subF = mtof(pitch + s.sub.octave * 12);
    v.subInc = subF / sr;
    v.subLvl = mipLevel(subF, sr);
    const sp = fromNorm(SUB_PAN, mod[SUB_PAN]);
    v.subL = Math.cos((sp + 1) * Math.PI / 4) * Math.SQRT2;
    v.subR = Math.sin((sp + 1) * Math.PI / 4) * Math.SQRT2;
    const subT = s.sub.on ? fromNorm(SUB_LEVEL, mod[SUB_LEVEL]) : 0;
    if (snap) { v.subLv = subT; v.subLvD = 0; } else v.subLvD = (subT - v.subLv) / STEP;
    const np = fromNorm(NOISE_PAN, mod[NOISE_PAN]);
    v.noiseL = Math.cos((np + 1) * Math.PI / 4) * Math.SQRT2;
    v.noiseR = Math.sin((np + 1) * Math.PI / 4) * Math.SQRT2;
    const nT = s.noise.on ? fromNorm(NOISE_LEVEL, mod[NOISE_LEVEL]) : 0;
    if (snap) { v.noiseLv = nT; v.noiseLvD = 0; } else v.noiseLvD = (nT - v.noiseLv) / STEP;

    for (let f = 0; f < 2; f++) this.controlFilter(v, f, snap);

    // Amp: envelope, velocity, volume, and a quick fade when stolen.
    if (v.stealing) {
      v.fade -= STEP / (0.004 * sr);
      if (v.fade <= 0) { v.fade = 0; }
    }
    const velGain = 1 - s.voice.velocity + s.voice.velocity * v.vel;
    const vol = Math.pow(10, fromNorm(V_VOLUME, mod[V_VOLUME]) / 20);
    const ampT = v.env[0].level * velGain * vol * v.fade;
    v.ampD = (ampT - v.amp) / STEP;
  }

  controlOsc(v, o, pitch, snap) {
    const s = this.s;
    const S = s.osc[o];
    const O = v.osc[o];
    const D = OSC_D[o];
    const mod = v.mod;
    const n = S.unison;
    if (O.n !== n) {
      for (let u = O.n; u < n; u++) O.ph[u] = (S.phase + S.randomPhase * rand()) % 1;
      O.n = n;
    }
    const amt = fromNorm(D[3], mod[D[3]]);
    const w = S.warp;
    const speed = w === W_SYNC ? 1 + amt * 15 : w === W_PULSE ? 1 / (1 - 0.95 * amt) : w === W_BEND || w === W_SQUEEZE ? 1 + amt * 3 : w === W_FM ? 1 + amt * 4 : 1;
    const p = pitch + fromNorm(D[4], mod[D[4]]) + fromNorm(D[5], mod[D[5]]) / 100;
    const detune = fromNorm(D[6], mod[D[6]]) * 50;
    const blend = fromNorm(D[7], mod[D[7]]);
    const width = fromNorm(D[8], mod[D[8]]);
    const pan = fromNorm(D[1], mod[D[1]]);
    let norm = 0;
    for (let u = 0; u < n; u++) {
      const x = n === 1 ? 0 : (2 * u) / (n - 1) - 1;
      const f = mtof(p + (detune * x) / 100);
      O.inc[u] = f / this.sr;
      O.lvl[u] = mipLevel(f * speed, this.sr);
      const center = n === 1 || Math.abs(x) < 1 / (n - 1) + 1e-6;
      const g = center ? 1 : blend;
      norm += g * g;
      let pp = pan + width * x * (u % 2 === 0 ? 1 : -1);
      pp = pp < -1 ? -1 : pp > 1 ? 1 : pp;
      O.ul[u] = g * Math.cos((pp + 1) * Math.PI / 4) * Math.SQRT2;
      O.ur[u] = g * Math.sin((pp + 1) * Math.PI / 4) * Math.SQRT2;
      O.um[u] = g;
    }
    norm = norm > 0 ? 1 / Math.sqrt(norm) : 0;
    for (let u = 0; u < n; u++) {
      O.ul[u] *= norm;
      O.ur[u] *= norm;
      O.um[u] *= norm;
    }
    const posT = fromNorm(D[2], mod[D[2]]);
    const lvT = S.on ? fromNorm(D[0], mod[D[0]]) : 0;
    if (snap) {
      O.pos = posT; O.amt = amt; O.lv = lvT;
      O.posD = 0; O.amtD = 0; O.lvD = 0;
    } else {
      O.posD = (posT - O.pos) / STEP;
      O.amtD = (amt - O.amt) / STEP;
      O.lvD = (lvT - O.lv) / STEP;
    }
  }

  controlFilter(v, i, snap) {
    const s = this.s;
    const F = v.filt[i];
    const S = s.filters[i];
    const D = FIL_D[i];
    const mod = v.mod;
    if (F.type !== S.type) {
      this.resetFilter(F);
      F.type = S.type;
    }
    const sr = this.sr;
    let fc = fromNorm(D[0], mod[D[0]]) * Math.pow(2, (S.keytrack * (v.note - 60)) / 12);
    const res = fromNorm(D[1], mod[D[1]]);
    F.drive = fromNorm(D[2], mod[D[2]]);
    F.dg = Math.pow(10, (F.drive * 24) / 20);
    F.morph = fromNorm(D[3], mod[D[3]]);
    F.mix = fromNorm(D[4], mod[D[4]]);
    const t = S.type;
    if (t === F_COMB || t === F_COMBN) {
      if (!F.combL) {
        F.combL = new Float32Array(COMB_SIZE);
        F.combR = new Float32Array(COMB_SIZE);
      }
      F.combD = Math.min(COMB_SIZE - 2, Math.max(2, sr / Math.max(20, fc)));
      F.combFb = (t === F_COMB ? 1 : -1) * res * 0.97;
      F.combDamp = F.morph * 0.95;
      return;
    }
    if (t === F_FORMANT) {
      if (!F.fa) F.fa = new Float64Array(12);
      const x = F.morph * 4;
      const j = Math.min(3, Math.floor(x));
      const fr = x - j;
      const shift = Math.min(4, Math.max(0.25, fc / 1000));
      const q = 4 + res * 16;
      for (let k = 0; k < 3; k++) {
        const hz = (VOWELS[j][k] + (VOWELS[j + 1][k] - VOWELS[j][k]) * fr) * shift;
        const g = Math.tan(Math.PI * Math.min(hz, sr * 0.45) / sr);
        const kk = 1 / q;
        const a1 = 1 / (1 + g * (g + kk));
        F.fa[k * 4] = a1;
        F.fa[k * 4 + 1] = g * a1;
        F.fa[k * 4 + 2] = g * g * a1;
        F.fa[k * 4 + 3] = kk;
      }
      return;
    }
    fc = Math.min(fc, sr * 0.45);
    const g = Math.tan(Math.PI * fc / sr);
    if (t === F_LADDER) {
      const G = g / (1 + g);
      const k = res * 3.9;
      if (snap) { F.G = G; F.GD = 0; F.lk = k; }
      else { F.GD = (G - F.G) / STEP; F.lk = k; }
      return;
    }
    const Q = 0.5 * Math.pow(50, res);
    const twoStage = t === F_LP24 || t === F_HP24;
    const k = twoStage ? 1 / Math.max(Q, 0.707) : 1 / Q;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    if (snap) {
      F.a1 = a1; F.a2 = a2; F.a3 = a3; F.k = k;
      F.a1D = F.a2D = F.a3D = F.kD = 0;
    } else {
      F.a1D = (a1 - F.a1) / STEP;
      F.a2D = (a2 - F.a2) / STEP;
      F.a3D = (a3 - F.a3) / STEP;
      F.kD = (k - F.k) / STEP;
    }
    if (twoStage) {
      // The first stage stays Butterworth; the second carries the resonance.
      const kb = 1.414;
      const b1 = 1 / (1 + g * (g + kb));
      F.b1 = b1; F.b2 = g * b1; F.b3 = g * F.b2; F.kb = kb;
    }
  }

  // --- audio ---

  renderOsc(v, o, off, len) {
    const T = this.tables[o];
    const O = v.osc[o];
    const buf = O.buf;
    for (let i = 0; i < len; i++) buf[i] = 0;
    const S = this.s.osc[o];
    if (!T || !S.on) {
      O.pos += O.posD * len; O.amt += O.amtD * len; O.lv += O.lvD * len;
      return;
    }
    const partner = v.osc[1 - o].buf;
    const frames = T.frames;
    const warp = S.warp;
    const dest = S.dest;
    const bus = this.bus;
    const serial = this.s.serial;
    const toL1 = dest === 1 ? bus.f2L : dest === 3 ? bus.dL : bus.f1L;
    const toR1 = dest === 1 ? bus.f2R : dest === 3 ? bus.dR : bus.f1R;
    const both = dest === 2 && !serial;
    const n = O.n;
    for (let u = 0; u < n; u++) {
      let ph = O.ph[u];
      const inc = O.inc[u];
      const lvl = O.lvl[u];
      const size = MIP_N[lvl];
      const mask = size - 1;
      const tab = T.levels[lvl];
      const ul = O.ul[u], ur = O.ur[u], um = O.um[u];
      let pos = O.pos, amt = O.amt, lv = O.lv;
      const posD = O.posD, amtD = O.amtD, lvD = O.lvD;
      const moving = posD !== 0;
      let f0 = 0, f1 = 0, ff = 0;
      const frameAt = (p) => {
        let fi = p * (frames - 1);
        if (fi < 0) fi = 0; else if (fi > frames - 1) fi = frames - 1;
        f0 = fi | 0;
        ff = fi - f0;
        f1 = f0 + 1 < frames ? f0 + 1 : f0;
      };
      frameAt(pos);
      for (let i = 0; i < len; i++) {
        ph += inc;
        if (ph >= 1) ph -= 1;
        let w = ph;
        switch (warp) {
          case W_SYNC: w = ph * (1 + amt * 15); w -= Math.floor(w); break;
          case W_BEND: { const b = amt * 12; w = (ph * (1 + b)) / (1 + b * ph); break; }
          case W_SQUEEZE: {
            const b = amt * 12;
            if (ph < 0.5) { const x = 2 * ph; w = (0.5 * x) / (1 + b * (1 - x)); }
            else { const x = 2 - 2 * ph; w = 1 - (0.5 * x) / (1 + b * (1 - x)); }
            break;
          }
          case W_PULSE: { const width = 1 - 0.95 * amt; w = ph < width ? ph / width : 0; break; }
          case W_MIRROR: { const tri = ph < 0.5 ? ph : 1 - ph; w = ph + (tri - ph) * amt; if (w < 0) w += 1; break; }
          case W_QUANT: if (amt > 0) { const steps = Math.round(Math.pow(2, 8 - amt * 7)); w = Math.floor(ph * steps) / steps; } break;
          case W_FM: w = ph + amt * 2 * partner[i]; w -= Math.floor(w); break;
        }
        if (moving) frameAt(pos);
        const x = w * size;
        let i0 = x | 0;
        const fr = x - i0;
        i0 &= mask;
        const i1 = (i0 + 1) & mask;
        const b0 = f0 * size, b1 = f1 * size;
        const a = tab[b0 + i0] + (tab[b0 + i1] - tab[b0 + i0]) * fr;
        const b = tab[b1 + i0] + (tab[b1 + i1] - tab[b1 + i0]) * fr;
        let y = a + (b - a) * ff;
        if (warp === W_FOLD && amt > 0) {
          const folded = Math.sin(y * (1 + amt * 7) * Math.PI * 0.5);
          y += (folded - y) * Math.min(1, amt * 4);
        } else if (warp === W_RM) y *= 1 - amt + amt * partner[i];
        buf[i] += y * um;
        const yl = y * lv;
        const j = off + i;
        toL1[j] += yl * ul;
        toR1[j] += yl * ur;
        if (both) {
          bus.f2L[j] += yl * ul;
          bus.f2R[j] += yl * ur;
        }
        pos += posD; amt += amtD; lv += lvD;
      }
      O.ph[u] = ph;
    }
    O.pos += O.posD * len; O.amt += O.amtD * len; O.lv += O.lvD * len;
  }

  renderSources(v, off, len) {
    const s = this.s;
    const bus = this.bus;
    const serial = s.serial;
    if (s.sub.on && this.sub) {
      const dest = s.sub.dest;
      const L = dest === 1 ? bus.f2L : dest === 3 ? bus.dL : bus.f1L;
      const R = dest === 1 ? bus.f2R : dest === 3 ? bus.dR : bus.f1R;
      const both = s.sub.dest === 2 && !serial;
      const lvl = v.subLvl, size = MIP_N[lvl], mask = size - 1;
      const tab = this.sub.levels[lvl];
      const base = Math.min(3, s.sub.shape) * size;
      let ph = v.subPh, lv = v.subLv;
      const inc = v.subInc, lvD = v.subLvD, gl = v.subL, gr = v.subR;
      for (let i = 0; i < len; i++) {
        ph += inc;
        if (ph >= 1) ph -= 1;
        const x = ph * size;
        let i0 = x | 0;
        const fr = x - i0;
        i0 &= mask;
        const y = (tab[base + i0] + (tab[base + ((i0 + 1) & mask)] - tab[base + i0]) * fr) * lv;
        const j = off + i;
        L[j] += y * gl;
        R[j] += y * gr;
        if (both) { bus.f2L[j] += y * gl; bus.f2R[j] += y * gr; }
        lv += lvD;
      }
      v.subPh = ph;
      v.subLv = lv;
    } else v.subLv += v.subLvD * len;
    if (s.noise.on) {
      const dest = s.noise.dest;
      const L = dest === 1 ? bus.f2L : dest === 3 ? bus.dL : bus.f1L;
      const R = dest === 1 ? bus.f2R : dest === 3 ? bus.dR : bus.f1R;
      const both = s.noise.dest === 2 && !serial;
      const pk = v.pink;
      let lv = v.noiseLv;
      const lvD = v.noiseLvD, gl = v.noiseL, gr = v.noiseR, pinkOn = s.noise.pink;
      for (let i = 0; i < len; i++) {
        let y = rand() * 2 - 1;
        if (pinkOn) {
          // Paul Kellet's pink noise filter.
          pk[0] = 0.99886 * pk[0] + y * 0.0555179;
          pk[1] = 0.99332 * pk[1] + y * 0.0750759;
          pk[2] = 0.969 * pk[2] + y * 0.153852;
          pk[3] = 0.8665 * pk[3] + y * 0.3104856;
          pk[4] = 0.55 * pk[4] + y * 0.5329522;
          pk[5] = -0.7616 * pk[5] - y * 0.016898;
          y = (pk[0] + pk[1] + pk[2] + pk[3] + pk[4] + pk[5] + pk[6] + y * 0.5362) * 0.11;
          pk[6] = y * 0.115926;
        }
        y *= lv;
        const j = off + i;
        L[j] += y * gl;
        R[j] += y * gr;
        if (both) { bus.f2L[j] += y * gl; bus.f2R[j] += y * gr; }
        lv += lvD;
      }
      v.noiseLv = lv;
    } else v.noiseLv += v.noiseLvD * len;
  }

  filter(F, type, L, R, off, len) {
    const st = F.s;
    const mix = F.mix;
    const drive = F.drive > 0.0005;
    const dg = F.dg;
    if (type === F_COMB || type === F_COMBN) {
      const bufL = F.combL, bufR = F.combR;
      let w = F.combW;
      const d = F.combD, fb = F.combFb, damp = F.combDamp;
      let lpL = F.combLpL, lpR = F.combLpR;
      const norm = 1 - Math.abs(fb) * 0.75;
      for (let i = off; i < off + len; i++) {
        let r = w - d;
        if (r < 0) r += COMB_SIZE;
        const r0 = r | 0;
        const fr = r - r0;
        const r1 = (r0 + 1) % COMB_SIZE;
        const dl = bufL[r0] + (bufL[r1] - bufL[r0]) * fr;
        const dr = bufR[r0] + (bufR[r1] - bufR[r0]) * fr;
        lpL += (1 - damp) * (dl - lpL);
        lpR += (1 - damp) * (dr - lpR);
        let xl = L[i], xr = R[i];
        if (drive) { xl = sat(xl * dg); xr = sat(xr * dg); }
        const yl = xl + fb * lpL;
        const yr = xr + fb * lpR;
        bufL[w] = yl;
        bufR[w] = yr;
        w = (w + 1) % COMB_SIZE;
        L[i] += (yl * norm - L[i]) * mix;
        R[i] += (yr * norm - R[i]) * mix;
      }
      F.combW = w;
      F.combLpL = lpL;
      F.combLpR = lpR;
      return;
    }
    if (type === F_FORMANT) {
      const fa = F.fa;
      for (let c = 0; c < 2; c++) {
        const X = c === 0 ? L : R;
        for (let i = off; i < off + len; i++) {
          let x = X[i];
          if (drive) x = sat(x * dg);
          let y = 0;
          for (let k = 0; k < 3; k++) {
            const a1 = fa[k * 4], a2 = fa[k * 4 + 1], a3 = fa[k * 4 + 2], kk = fa[k * 4 + 3];
            const si = c * 6 + k * 2;
            const ic1 = st[si], ic2 = st[si + 1];
            const v3 = x - ic2;
            const v1 = a1 * ic1 + a2 * v3;
            const v2 = ic2 + a2 * ic1 + a3 * v3;
            st[si] = 2 * v1 - ic1;
            st[si + 1] = 2 * v2 - ic2;
            y += kk * v1 * (k === 0 ? 1 : k === 1 ? 0.7 : 0.4);
          }
          X[i] = x + (y * 1.6 - x) * mix;
        }
      }
      return;
    }
    if (type === F_LADDER) {
      let G = F.G;
      const GD = F.GD, k = F.lk;
      const comp = 1 + k * 0.5;
      for (let c = 0; c < 2; c++) {
        const X = c === 0 ? L : R;
        const b = c * 4;
        let g = G;
        for (let i = off; i < off + len; i++) {
          const x = X[i];
          const beta = 1 - g;
          const S = beta * (g * g * g * st[b] + g * g * st[b + 1] + g * st[b + 2] + st[b + 3]);
          let u = (x * comp - k * S) / (1 + k * g * g * g * g);
          u = sat(u * (drive ? dg : 1));
          let inp = u;
          for (let j = 0; j < 4; j++) {
            const vv = (inp - st[b + j]) * g;
            const y = vv + st[b + j];
            st[b + j] = y + vv;
            inp = y;
          }
          X[i] = x + (inp - x) * mix;
          g += GD;
        }
      }
      F.G = G + GD * len;
      return;
    }
    const twoStage = type === F_LP24 || type === F_HP24;
    for (let c = 0; c < 2; c++) {
      const X = c === 0 ? L : R;
      let a1 = F.a1, a2 = F.a2, a3 = F.a3, k = F.k;
      const b1 = F.b1, b2 = F.b2, b3 = F.b3, kb = F.kb;
      const si = c * 4;
      let ic1 = st[si], ic2 = st[si + 1], jc1 = st[si + 2], jc2 = st[si + 3];
      for (let i = off; i < off + len; i++) {
        const dry = X[i];
        let x = dry;
        if (drive) x = sat(x * dg);
        if (twoStage) {
          const v3 = x - jc2;
          const v1 = b1 * jc1 + b2 * v3;
          const v2 = jc2 + b2 * jc1 + b3 * v3;
          jc1 = 2 * v1 - jc1;
          jc2 = 2 * v2 - jc2;
          x = type === F_LP24 ? v2 : x - kb * v1 - v2;
        }
        const v3 = x - ic2;
        const v1 = a1 * ic1 + a2 * v3;
        const v2 = ic2 + a2 * ic1 + a3 * v3;
        ic1 = 2 * v1 - ic1;
        ic2 = 2 * v2 - ic2;
        let y;
        switch (type) {
          case F_LP12: case F_LP24: y = v2; break;
          case F_HP12: case F_HP24: y = x - k * v1 - v2; break;
          case F_BP: y = k * v1; break;
          case F_NOTCH: y = x - k * v1; break;
          default: {
            const lp = v2, bp = k * v1, hp = x - k * v1 - v2, notch = x - k * v1;
            const m = F.morph * 3;
            if (m < 1) y = lp + (bp - lp) * m;
            else if (m < 2) y = bp + (hp - bp) * (m - 1);
            else y = hp + (notch - hp) * (m - 2);
          }
        }
        X[i] = dry + (y - dry) * mix;
        a1 += F.a1D; a2 += F.a2D; a3 += F.a3D; k += F.kD;
      }
      st[si] = ic1; st[si + 1] = ic2; st[si + 2] = jc1; st[si + 3] = jc2;
    }
    F.a1 += F.a1D * len; F.a2 += F.a2D * len; F.a3 += F.a3D * len; F.k += F.kD * len;
  }

  renderVoice(v, outL, outR, off, len) {
    const s = this.s;
    const bus = this.bus;
    const use = this.use;
    if (use.f1) { bus.f1L.fill(0, off, off + len); bus.f1R.fill(0, off, off + len); }
    if (use.f2) { bus.f2L.fill(0, off, off + len); bus.f2R.fill(0, off, off + len); }
    if (use.d) { bus.dL.fill(0, off, off + len); bus.dR.fill(0, off, off + len); }
    // A modulator renders first so the other oscillator can read it.
    const first = s.osc[0].warp === W_FM || s.osc[0].warp === W_RM ? 1 : 0;
    // renderOsc writes each oscillator's own samples at buf[0..len).
    this.renderOsc(v, first, off, len);
    this.renderOsc(v, 1 - first, off, len);
    this.renderSources(v, off, len);
    const f = s.filters;
    let useF1 = use.f1;
    if (useF1 && f[0].on) this.filter(v.filt[0], f[0].type, bus.f1L, bus.f1R, off, len);
    if (s.serial) {
      if (use.f2 && f[1].on) {
        if (useF1) for (let i = off; i < off + len; i++) { bus.f2L[i] += bus.f1L[i]; bus.f2R[i] += bus.f1R[i]; }
        this.filter(v.filt[1], f[1].type, bus.f2L, bus.f2R, off, len);
        useF1 = false;
      }
    } else if (use.f2 && f[1].on) this.filter(v.filt[1], f[1].type, bus.f2L, bus.f2R, off, len);
    // The mix of whichever buses are live goes to f1 (reused as the sum).
    const sumL = bus.f1L, sumR = bus.f1R;
    if (!useF1) { sumL.fill(0, off, off + len); sumR.fill(0, off, off + len); }
    if (use.f2) for (let i = off; i < off + len; i++) { sumL[i] += bus.f2L[i]; sumR[i] += bus.f2R[i]; }
    if (use.d) for (let i = off; i < off + len; i++) { sumL[i] += bus.dL[i]; sumR[i] += bus.dR[i]; }
    let amp = v.amp;
    const ampD = v.ampD;
    let peak = 0;
    for (let i = off; i < off + len; i++) {
      const l = sumL[i] * amp;
      const r = sumR[i] * amp;
      outL[i] += l;
      outR[i] += r;
      const a = Math.abs(l) + Math.abs(r);
      if (a > peak) peak = a;
      amp += ampD;
    }
    v.amp = amp;
    if (!(peak < 1e4)) {
      // A filter blew up (or NaN): silence this voice's state.
      v.filt.forEach((F) => this.resetFilter(F));
      for (let i = off; i < off + len; i++) { outL[i] = 0; outR[i] = 0; }
    }
  }

  /** Renders n samples into outL/outR (cleared here). now: the context time (s) of sample 0. */
  process(outL, outR, n, now) {
    outL.fill(0, 0, n);
    outR.fill(0, 0, n);
    if (!this.s) return;
    const sr = this.sr;
    let f = 0;
    while (f < n) {
      // Events due by this sample.
      while (this.events.length > 0) {
        const e = this.events[0];
        const at = Math.round((e.time - now) * sr);
        if (at > f) break;
        this.events.shift();
        if (e.type === "on") this.noteOn(e.note, e.vel);
        else if (e.type === "off") this.noteOff(e.note);
        else this.allOff(e.type === "panic");
      }
      if (this.ctrlLeft <= 0) {
        const dt = STEP / sr;
        for (let i = 0; i < 3; i++) {
          this.globalLfo[i] += this.lfoRate(i, null) * dt;
          this.globalLfo[i] -= Math.floor(this.globalLfo[i]);
        }
        for (const v of this.voices) if (v.active) this.control(v, false);
        this.ctrlLeft = STEP;
      }
      let len = Math.min(n - f, this.ctrlLeft);
      if (this.events.length > 0) {
        const at = Math.round((this.events[0].time - now) * sr);
        if (at > f && at - f < len) len = at - f;
      }
      for (const v of this.voices) if (v.active) this.renderVoice(v, outL, outR, f, len);
      f += len;
      this.ctrlLeft -= len;
    }
    // Voices whose amp envelope (or steal fade) has finished.
    for (const v of this.voices) {
      if (!v.active) continue;
      const done = (v.env[0].stage === 0 && !v.gate) || (v.stealing && v.fade <= 0);
      if (done && Math.abs(v.amp) < 1e-4) v.active = false;
    }
    let pl = this.peakL, pr = this.peakR;
    for (let i = 0; i < n; i++) {
      const l = Math.abs(outL[i]), r = Math.abs(outR[i]);
      if (l > pl) pl = l;
      if (r > pr) pr = r;
      this.scope[this.scopeW] = (outL[i] + outR[i]) * 0.5;
      this.scopeW = (this.scopeW + 1) & 1023;
    }
    this.peakL = pl;
    this.peakR = pr;
    this.frame += n;
  }

  activeCount() {
    let c = 0;
    for (const v of this.voices) if (v.active && !v.stealing) c++;
    return c;
  }

  /** What the window shows: the newest voice's modulated knobs, envelopes
   * and LFOs, the output level and the last 1024 samples. */
  takeState() {
    let v = null;
    for (const x of this.voices) if (x.active && !x.stealing && (!v || x.age > v.age)) v = x;
    const scope = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) scope[i] = this.scope[(this.scopeW + i) & 1023];
    const state = {
      voices: this.activeCount(),
      mod: v ? Array.from(v.mod) : null,
      env: v ? v.env.map((e) => [e.stage, e.level]) : null,
      lfo: v ? v.lfo.map((l) => [l.done ? 1 : l.phase, l.value]) : this.globalLfo.map((p) => [p, 0]),
      peak: [this.peakL, this.peakR],
      scope,
    };
    this.peakL = 0;
    this.peakR = 0;
    return state;
  }
}
`;
