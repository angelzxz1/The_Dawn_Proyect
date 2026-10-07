// The Drum Rack's DSP: every pad's voice, in an AudioWorklet (drums.ts).
// Kept as source text like the other kernels, so the tests run exactly
// what plays.
//
// A hit starts a voice on its exact sample. Synth pads model classic drum
// machine circuits: the kick and toms are sines with a pitch drop, the
// snare a tuned body plus filtered noise, the clap a few quick noise bursts
// and a tail, hats and cymbals six detuned square waves (the 808 recipe)
// through band and high passes, and so on. Sample pads play their file,
// tuned by resampling, optionally reversed and faded out. Each voice then
// goes through its pad's filter, drive, level and pan. Pads in the same
// choke group cut each other off with a 4 ms fade.

import { PAD_COUNT, FIRST_PAD_NOTE } from "./drumParams";

export const DRUM_SOURCE = `
const MAXV = 32;
const PER_PAD = 4;
const NPADS = ${PAD_COUNT};
const FIRST_NOTE = ${FIRST_PAD_NOTE};
const M_KICK = 0, M_SNARE = 1, M_CLAP = 2, M_HAT = 3, M_CYMBAL = 4, M_TOM = 5, M_RIM = 6, M_COWBELL = 7, M_SHAKER = 8, M_CLAVE = 9;
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
const LN1000 = 6.907755;

function sat(x) {
  if (x < -3) return -1;
  if (x > 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/** Per-sample factor for an exponential fall of 60 dB over t seconds. */
function decayCoef(t, sr) {
  return Math.exp(-LN1000 / (Math.max(1e-4, t) * sr));
}

/** Coefficients of a TPT state-variable filter: [a1, a2, a3, k]. */
function svfCoefs(fc, q, sr) {
  const g = Math.tan(Math.PI * Math.min(fc, sr * 0.45) / sr);
  const k = 1 / q;
  const a1 = 1 / (1 + g * (g + k));
  return [a1, g * a1, g * g * a1, k];
}

/** One step of the SVF; state is s[i], s[i+1]. Returns [low, band, high]. */
function svf(c, s, i, x, out) {
  const v3 = x - s[i + 1];
  const v1 = c[0] * s[i] + c[1] * v3;
  const v2 = s[i + 1] + c[1] * s[i] + c[2] * v3;
  s[i] = 2 * v1 - s[i];
  s[i + 1] = 2 * v2 - s[i + 1];
  out[0] = v2;
  out[1] = c[3] * v1;
  out[2] = x - c[3] * v1 - v2;
}

function makeVoice() {
  return {
    active: false, pad: 0, age: 0, n: 0, vel: 1,
    fade: 1, fadeStep: 0,
    ph: new Float64Array(8),
    s: new Float64Array(16),
    e: new Float64Array(6),
    k: new Float64Array(6),
    c: [null, null, null, null],
    f: null, fs: new Float64Array(4),
    p: null, seed: 1,
    // sample playback
    pos: 0, inc: 1, len: 0,
    // derived settings (see start)
    r: 1, tone: 0.5, ch: 0.5, dec: 0.5,
  };
}

class DawnDrumKernel {
  constructor(sr) {
    this.sr = sr;
    this.pads = null;
    this.volume = 1;
    this.samples = [];
    for (let i = 0; i < NPADS; i++) this.samples.push(null);
    this.voices = [];
    for (let i = 0; i < MAXV; i++) this.voices.push(makeVoice());
    this.events = [];
    this.counter = 0;
    this.hits = 0;
    this.peak = 0;
    this.bufL = new Float32Array(128);
    this.bufR = new Float32Array(128);
    this.tmp = new Float64Array(3);
  }

  setSettings(s) {
    this.pads = s.pads;
    this.volume = s.volume;
  }

  /** data: [left, right?] Float32Arrays at this sample rate, or null. */
  setSample(pad, data) {
    this.samples[pad] = data && data[0] && data[0].length ? data : null;
  }

  addEvent(e) {
    const list = this.events;
    let i = list.length;
    while (i > 0 && list[i - 1].time > e.time) i--;
    list.splice(i, 0, e);
  }

  // --- voices ---

  fadeOut(v) {
    if (v.fadeStep === 0) v.fadeStep = 1 / (0.004 * this.sr);
  }

  hit(padIndex, vel) {
    const pads = this.pads;
    if (!pads || padIndex < 0 || padIndex >= NPADS) return;
    const p = pads[padIndex];
    if (!p.on) return;
    if (p.sample && !this.samples[padIndex]) return;
    this.hits |= 1 << padIndex;
    // Choke: this pad's group (itself included) stops.
    let own = 0;
    for (const v of this.voices) {
      if (!v.active) continue;
      if (p.choke > 0 && pads[v.pad].choke === p.choke) this.fadeOut(v);
      else if (v.pad === padIndex && v.fadeStep === 0) own++;
    }
    // Too many of this pad's hits ringing: fade the oldest.
    while (own >= PER_PAD) {
      let oldest = null;
      for (const v of this.voices) if (v.active && v.pad === padIndex && v.fadeStep === 0 && (!oldest || v.age < oldest.age)) oldest = v;
      if (!oldest) break;
      this.fadeOut(oldest);
      own--;
    }
    let voice = null;
    for (const v of this.voices) if (!v.active) { voice = v; break; }
    if (!voice) for (const v of this.voices) if (!voice || v.age < voice.age) voice = v;
    this.start(voice, padIndex, p, vel);
  }

  start(v, padIndex, p, vel) {
    const sr = this.sr;
    v.active = true;
    v.pad = padIndex;
    v.p = p;
    v.age = ++this.counter;
    v.n = 0;
    v.fade = 1;
    v.fadeStep = 0;
    v.ph.fill(0);
    v.s.fill(0);
    v.fs.fill(0);
    v.e.fill(0);
    v.seed = (this.counter * 2654435761) >>> 0 || 1;
    const vs = p.velocity;
    v.vel = (1 - vs + vs * vel) * p.gain;
    v.r = Math.pow(2, p.tune / 12);
    v.tone = Math.min(1, Math.max(0, p.tone + vs * (vel - 0.8) * 0.25));
    v.ch = p.character;
    v.dec = p.decay;
    // The pad's filter: below 0 a low pass closes down, above 0 a high pass opens up.
    if (Math.abs(p.filter) > 0.005) {
      const fc = p.filter < 0 ? 20000 * Math.pow(2, p.filter * 10) : 20 * Math.pow(2, p.filter * 10);
      v.f = svfCoefs(fc, 0.5 * Math.pow(40, p.resonance), sr);
    } else v.f = null;
    if (p.sample) {
      const data = this.samples[padIndex];
      v.len = data[0].length;
      v.inc = v.r;
      v.pos = p.start * v.len;
      // A decay under the top fades the sample out; at the top it plays to its end.
      v.e[0] = 1;
      v.k[0] = p.decay >= 0.98 ? 1 : decayCoef(0.03 + p.decay * p.decay * 4, sr);
      return;
    }
    const D = p.decay, C = p.character, T = v.tone, r = v.r;
    const e = v.e, k = v.k, c = v.c;
    switch (p.model) {
      case M_KICK:
        e[0] = 1; k[0] = decayCoef(0.08 + Math.pow(D, 1.5) * 1.6, sr);
        e[1] = 1; k[1] = Math.exp(-1 / ((0.008 + (1 - C) * 0.02) * sr));
        e[2] = 1; k[2] = Math.exp(-1 / (0.0012 * sr));
        break;
      case M_SNARE:
        e[0] = 1; k[0] = decayCoef(0.05 + D * 0.2, sr);
        e[1] = 1; k[1] = decayCoef(0.06 + D * 0.45, sr);
        e[2] = 1; k[2] = Math.exp(-1 / (0.01 * sr));
        c[0] = svfCoefs(1500 + T * 6000, 0.8, sr);
        c[1] = svfCoefs(900, 0.7, sr);
        break;
      case M_CLAP:
        e[0] = 1; k[0] = Math.exp(-1 / (0.0045 * sr));
        e[1] = 0; k[1] = decayCoef(0.05 + D * 0.6, sr);
        c[0] = svfCoefs(700 + T * 2600, 1.6, sr);
        break;
      case M_HAT:
        e[0] = 1; k[0] = decayCoef(0.02 + D * D * 1.2, sr);
        c[0] = svfCoefs(6500 + T * 5000, 1.1, sr);
        c[1] = svfCoefs(5500, 0.7, sr);
        break;
      case M_CYMBAL:
        e[0] = 1; k[0] = decayCoef(0.4 + D * 3.5, sr);
        e[1] = 1; k[1] = decayCoef(0.25 + D * 1.6, sr);
        c[0] = svfCoefs(3000 + T * 6000, 0.6, sr);
        c[1] = svfCoefs(2200, 0.7, sr);
        c[2] = svfCoefs(1400 + T * 1200, 2.5, sr);
        break;
      case M_TOM:
        e[0] = 1; k[0] = decayCoef(0.1 + D * 1.0, sr);
        e[1] = 1; k[1] = Math.exp(-1 / (0.04 * sr));
        e[2] = 1; k[2] = Math.exp(-1 / (0.008 * sr));
        c[0] = svfCoefs(1200, 1, sr);
        break;
      case M_RIM:
        e[0] = 1; k[0] = decayCoef(0.015 + D * 0.12, sr);
        c[0] = svfCoefs(1700 * r, 5 + C * 25, sr);
        c[1] = svfCoefs(500 * r, 3 + C * 10, sr);
        break;
      case M_COWBELL:
        e[0] = 1; k[0] = decayCoef(0.05 + D * 0.8, sr);
        e[1] = 1; k[1] = Math.exp(-1 / (0.012 * sr));
        c[0] = svfCoefs(800 + T * 2000, 1.2, sr);
        break;
      case M_SHAKER:
        e[0] = 0; k[0] = decayCoef(0.03 + D * 0.4, sr);
        e[1] = 1 / ((0.002 + C * 0.04) * sr);
        c[0] = svfCoefs(3000 + T * 6000, 0.7, sr);
        break;
      default: // clave
        e[0] = 1; k[0] = decayCoef(0.02 + D * 0.3, sr);
        e[1] = 1; k[1] = Math.exp(-1 / (0.003 * sr));
        break;
    }
  }

  noise(v) {
    let x = v.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    v.seed = x >>> 0;
    return v.seed / 2147483648 - 1;
  }

  /** Renders a synth voice (mono) into buf; returns false once it has died
   * away (70 dB down). */
  renderSynth(v, buf, len) {
    const sr = this.sr;
    const p = v.p;
    const e = v.e, k = v.k, c = v.c, s = v.s, ph = v.ph, o = this.tmp;
    const r = v.r, T = v.tone, C = v.ch;
    const TWO_PI = 2 * Math.PI;
    let alive = true;
    switch (p.model) {
      case M_KICK: {
        const f0 = 48 * r;
        const sweep = 1 + C * 9;
        for (let i = 0; i < len; i++) {
          const f = f0 * (1 + sweep * e[1]);
          ph[0] += f / sr;
          if (ph[0] >= 1) ph[0] -= 1;
          const click = this.noise(v) * e[2] * T * 0.9;
          buf[i] = (Math.sin(TWO_PI * ph[0]) + click) * e[0];
          e[0] *= k[0]; e[1] *= k[1]; e[2] *= k[2];
        }
        alive = e[0] > 3e-4;
        break;
      }
      case M_SNARE: {
        const snappy = 0.3 + C * 1.3;
        const body = 1 - C * 0.5;
        for (let i = 0; i < len; i++) {
          const drop = 1 + 0.4 * e[2];
          ph[0] += (185 * r * drop) / sr; if (ph[0] >= 1) ph[0] -= 1;
          ph[1] += (330 * r * drop) / sr; if (ph[1] >= 1) ph[1] -= 1;
          const b = (Math.sin(TWO_PI * ph[0]) * 0.6 + Math.sin(TWO_PI * ph[1]) * 0.4) * e[0];
          svf(c[1], s, 2, this.noise(v), o);
          svf(c[0], s, 0, o[2], o);
          buf[i] = b * body + o[1] * 1.1 * e[1] * snappy;
          e[0] *= k[0]; e[1] *= k[1]; e[2] *= k[2];
        }
        alive = e[0] > 3e-4 || e[1] > 3e-4;
        break;
      }
      case M_CLAP: {
        const spacing = Math.round((0.005 + C * 0.012) * sr);
        for (let i = 0; i < len; i++) {
          const n = v.n + i;
          // Four bursts, then the tail.
          if (n > 0 && n % spacing === 0 && n <= spacing * 3) {
            e[0] = 1 - (n / spacing) * 0.12;
            if (n === spacing * 3) e[1] = 0.55;
          }
          svf(c[0], s, 0, this.noise(v), o);
          buf[i] = o[1] * 2.2 * (e[0] + e[1]);
          e[0] *= k[0]; e[1] *= k[1];
        }
        alive = v.n < spacing * 4 || e[1] > 3e-4;
        break;
      }
      case M_HAT:
      case M_CYMBAL: {
        const cym = p.model === M_CYMBAL;
        const metal = cym ? 0.65 : 0.25 + C * 0.75;
        const bell = cym ? C : 0;
        for (let i = 0; i < len; i++) {
          let sq = 0;
          for (let j = 0; j < 6; j++) {
            ph[j] += (METAL[j] * r * (cym ? 1.0 : 1.9)) / sr;
            if (ph[j] >= 1) ph[j] -= 1;
            sq += ph[j] < 0.5 ? 1 : -1;
          }
          sq /= 6;
          const x = sq * metal + this.noise(v) * (1 - metal) * 0.8;
          svf(c[0], s, 0, x, o);
          svf(c[1], s, 2, o[1], o);
          let y = o[2] * 2.4 * e[0];
          if (cym) {
            svf(c[2], s, 4, sq, o);
            y += o[1] * 1.6 * bell * e[1];
            e[1] *= k[1];
          }
          buf[i] = y;
          e[0] *= k[0];
        }
        alive = e[0] > 3e-4;
        break;
      }
      case M_TOM: {
        const f0 = 110 * r;
        const sweep = 0.3 + C * 1.2;
        for (let i = 0; i < len; i++) {
          ph[0] += (f0 * (1 + sweep * e[1])) / sr;
          if (ph[0] >= 1) ph[0] -= 1;
          svf(c[0], s, 0, this.noise(v), o);
          buf[i] = (Math.sin(TWO_PI * ph[0]) + o[1] * e[2] * T * 0.8) * e[0];
          e[0] *= k[0]; e[1] *= k[1]; e[2] *= k[2];
        }
        alive = e[0] > 3e-4;
        break;
      }
      case M_RIM: {
        for (let i = 0; i < len; i++) {
          const n = v.n + i;
          const x = (n === 0 ? 1 : 0) + (n < sr * 0.001 ? this.noise(v) * 0.4 : 0);
          svf(c[0], s, 0, x, o);
          const hi = o[1];
          svf(c[1], s, 2, x, o);
          buf[i] = (hi * (0.4 + T) * 30 + o[1] * (1.4 - T) * 20) * e[0];
          e[0] *= k[0];
        }
        alive = e[0] > 3e-4;
        break;
      }
      case M_COWBELL: {
        for (let i = 0; i < len; i++) {
          ph[0] += (540 * r) / sr; if (ph[0] >= 1) ph[0] -= 1;
          ph[1] += (800 * r) / sr; if (ph[1] >= 1) ph[1] -= 1;
          const x = (ph[0] < 0.5 ? 1 : -1) * (1 - C * 0.6) + (ph[1] < 0.5 ? 1 : -1) * (0.4 + C * 0.6);
          svf(c[0], s, 0, x, o);
          buf[i] = o[1] * 1.3 * (e[0] * 0.55 + e[1] * 0.45);
          e[0] *= k[0]; e[1] *= k[1];
        }
        alive = e[0] > 3e-4;
        break;
      }
      case M_SHAKER: {
        for (let i = 0; i < len; i++) {
          // A linear rise, then the decay.
          if (e[1] > 0) {
            e[0] += e[1];
            if (e[0] >= 1) { e[0] = 1; e[1] = 0; }
          } else e[0] *= k[0];
          svf(c[0], s, 0, this.noise(v), o);
          buf[i] = o[2] * 0.8 * e[0];
        }
        alive = e[1] > 0 || e[0] > 3e-4;
        break;
      }
      default: {
        const f0 = (1200 + T * 1800) * r;
        for (let i = 0; i < len; i++) {
          const f = f0 * (1 + C * 0.6 * e[1]);
          ph[0] += f / sr; if (ph[0] >= 1) ph[0] -= 1;
          ph[1] += (f * 2.71) / sr; if (ph[1] >= 1) ph[1] -= 1;
          buf[i] = (Math.sin(TWO_PI * ph[0]) + 0.2 * Math.sin(TWO_PI * ph[1])) * e[0];
          e[0] *= k[0]; e[1] *= k[1];
        }
        alive = e[0] > 3e-4;
      }
    }
    return alive;
  }

  /** Renders a sample voice into bufL (and bufR if the sample is stereo). */
  renderSample(v, bufL, bufR, len) {
    const data = this.samples[v.pad];
    if (!data) return false;
    const L = data[0];
    const R = data[1] || null;
    const p = v.p;
    const last = v.len - 1;
    let pos = v.pos;
    let env = v.e[0];
    const k = v.k[0];
    let i = 0;
    for (; i < len; i++) {
      if (pos >= last) break;
      const x = p.reverse ? last - pos : pos;
      const i0 = Math.floor(x);
      const i1 = Math.min(last, i0 + 1);
      const fr = x - i0;
      bufL[i] = (L[i0] + (L[i1] - L[i0]) * fr) * env;
      if (R) bufR[i] = (R[i0] + (R[i1] - R[i0]) * fr) * env;
      pos += v.inc;
      env *= k;
    }
    for (; i < len; i++) {
      bufL[i] = 0;
      if (R) bufR[i] = 0;
    }
    v.pos = pos;
    v.e[0] = env;
    return pos < last && env > 1e-4;
  }

  renderVoice(v, outL, outR, off, len) {
    const bufL = this.bufL, bufR = this.bufR;
    const p = v.p;
    const stereo = p.sample && this.samples[v.pad] && this.samples[v.pad][1];
    const alive = p.sample ? this.renderSample(v, bufL, bufR, len) : this.renderSynth(v, bufL, len);
    const f = v.f, fs = v.fs, o = this.tmp;
    const drive = p.drive > 0.001;
    const g = 1 + p.drive * 9;
    const makeup = 1 / (1 + p.drive * 0.25);
    const panL = Math.cos(((p.pan + 1) * Math.PI) / 4) * Math.SQRT2;
    const panR = Math.sin(((p.pan + 1) * Math.PI) / 4) * Math.SQRT2;
    const low = p.filter < 0;
    let fade = v.fade;
    const step = v.fadeStep;
    for (let i = 0; i < len; i++) {
      let l = bufL[i];
      let r = stereo ? bufR[i] : l;
      if (f) {
        svf(f, fs, 0, l, o);
        l = low ? o[0] : o[2];
        if (stereo) {
          svf(f, fs, 2, r, o);
          r = low ? o[0] : o[2];
        } else r = l;
      }
      if (drive) {
        l = sat(l * g) * makeup;
        r = stereo ? sat(r * g) * makeup : l;
      }
      const a = v.vel * fade;
      outL[off + i] += l * a * panL;
      outR[off + i] += r * a * panR;
      if (step) {
        fade -= step;
        if (fade <= 0) { fade = 0; break; }
      }
    }
    v.fade = fade;
    v.n += len;
    if (!alive || fade <= 0) v.active = false;
  }

  /** Renders n samples into outL/outR (cleared here); now: context time (s) of sample 0. */
  process(outL, outR, n, now) {
    outL.fill(0, 0, n);
    outR.fill(0, 0, n);
    if (!this.pads) return;
    const sr = this.sr;
    let f = 0;
    while (f < n) {
      while (this.events.length > 0) {
        const e = this.events[0];
        if (Math.round((e.time - now) * sr) > f) break;
        this.events.shift();
        if (e.type === "on") this.hit(e.note - FIRST_NOTE, e.vel);
        else if (e.type === "panic") for (const v of this.voices) if (v.active) this.fadeOut(v);
      }
      let len = n - f;
      if (this.events.length > 0) {
        const at = Math.round((this.events[0].time - now) * sr);
        if (at > f && at - f < len) len = at - f;
      }
      for (const v of this.voices) if (v.active) this.renderVoice(v, outL, outR, f, len);
      f += len;
    }
    const vol = this.volume;
    let peak = this.peak;
    for (let i = 0; i < n; i++) {
      outL[i] *= vol;
      outR[i] *= vol;
      const a = Math.max(Math.abs(outL[i]), Math.abs(outR[i]));
      if (a > peak) peak = a;
    }
    this.peak = peak;
  }

  activeCount() {
    let c = 0;
    for (const v of this.voices) if (v.active) c++;
    return c;
  }

  /** Pads hit since the last call (a bit each), and the output peak. */
  takeState() {
    const s = { hits: this.hits, peak: this.peak, voices: this.activeCount() };
    this.hits = 0;
    this.peak = 0;
    return s;
  }
}
`;
