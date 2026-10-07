// The Parametric EQ's DSP: filter design and the per-sample kernel. It's
// kept as source text because it runs inside an AudioWorklet (paramEq.ts);
// the graph evaluates this same text to draw its curves and the unit tests
// check it, so what's drawn and tested is exactly what plays.
//
// Every band is one or more biquad sections (a0 normalized to 1):
// - Bell / Notch / Band Pass: one RBJ-cookbook section.
// - Low / High Shelf: one RBJ shelf section; Q shapes the knee (0.71 is a
//   plain shelf, higher adds the resonant bump/dip).
// - Low / High Cut: a Butterworth cascade of slope/6 poles (a first-order
//   section for odd orders), flat at Q 0.71; raising Q adds resonance at the
//   cutoff by sharpening the cascade's most resonant section.
// - Tilt Shelf: a low shelf at -gain/2 and a high shelf at +gain/2, pivoting
//   around the frequency.
// Stereo placement runs a band on both channels, only left/right, or on the
// mid/side signal. Coefficient changes glide over RAMP samples so dragging a
// band never zippers; changing a band's shape or slope (which changes how
// many sections it has) restarts it.

export const MAX_EQ_BANDS = 24;

export const EQ_SHAPES = ["bell", "lowShelf", "lowCut", "highShelf", "highCut", "notch", "bandPass", "tiltShelf"] as const;
export type EqShape = (typeof EQ_SHAPES)[number];
export const EQ_SHAPE_LABELS: Record<EqShape, string> = {
  bell: "Bell",
  lowShelf: "Low Shelf",
  lowCut: "Low Cut",
  highShelf: "High Shelf",
  highCut: "High Cut",
  notch: "Notch",
  bandPass: "Band Pass",
  tiltShelf: "Tilt Shelf",
};

export const EQ_SLOPES = [6, 12, 18, 24, 36, 48, 72, 96] as const;

export const EQ_PLACEMENTS = ["stereo", "left", "right", "mid", "side"] as const;
export type EqPlacement = (typeof EQ_PLACEMENTS)[number];
export const EQ_PLACEMENT_LABELS: Record<EqPlacement, string> = {
  stereo: "Stereo",
  left: "Left",
  right: "Right",
  mid: "Mid",
  side: "Side",
};

/** Shapes the Gain control applies to. */
export function shapeUsesGain(shape: EqShape): boolean {
  return shape === "bell" || shape === "lowShelf" || shape === "highShelf" || shape === "tiltShelf";
}

/** Shapes the Slope control applies to. */
export function shapeUsesSlope(shape: EqShape): boolean {
  return shape === "lowCut" || shape === "highCut";
}

/** One band, as the kernel takes it. `on` is 0 (no band), 1 (active) or 2
 * (bypassed); shape and placement are indexes into EQ_SHAPES/EQ_PLACEMENTS. */
export interface EqBand {
  on: number;
  shape: number;
  freq: number;
  gain: number;
  q: number;
  slope: number;
  place: number;
}

export interface EqSection {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export const EQ_SOURCE = `
const EQ_SLOPE_STEPS = [6, 12, 18, 24, 36, 48, 72, 96];
const EQ_RAMP = 256;

function eqNearestSlope(s) {
  let best = 12;
  for (const v of EQ_SLOPE_STEPS) if (Math.abs(v - s) < Math.abs(best - s)) best = v;
  return best;
}

function eqNorm(b0, b1, b2, a0, a1, a2) {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function eqShelf(high, freq, gainDb, q, sr) {
  const w0 = (2 * Math.PI * freq) / sr;
  const cos = Math.cos(w0);
  const A = Math.pow(10, gainDb / 40);
  const alpha = Math.sin(w0) / (2 * q);
  const k = 2 * Math.sqrt(A) * alpha;
  if (!high) {
    return eqNorm(
      A * (A + 1 - (A - 1) * cos + k), 2 * A * (A - 1 - (A + 1) * cos), A * (A + 1 - (A - 1) * cos - k),
      A + 1 + (A - 1) * cos + k, -2 * (A - 1 + (A + 1) * cos), A + 1 + (A - 1) * cos - k
    );
  }
  return eqNorm(
    A * (A + 1 + (A - 1) * cos + k), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - k),
    A + 1 - (A - 1) * cos + k, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - k
  );
}

function eqCutSections(high, freq, q, slope, sr) {
  const order = Math.round(eqNearestSlope(slope) / 6);
  const w0 = (2 * Math.PI * freq) / sr;
  const cos = Math.cos(w0);
  const sections = [];
  if (order % 2 === 1) {
    const K = Math.tan(w0 / 2);
    if (high) sections.push(eqNorm(K, K, 0, 1 + K, K - 1, 0));
    else sections.push(eqNorm(1, -1, 0, 1 + K, K - 1, 0));
  }
  const pairs = Math.floor(order / 2);
  for (let k = 1; k <= pairs; k++) {
    // Butterworth pole pairs sit at these angles from the negative real
    // axis: (2k-1)pi/2n for even orders, k*pi/n for odd ones (whose real
    // pole is the first-order section above).
    const angle = order % 2 === 0 ? ((2 * k - 1) * Math.PI) / (2 * order) : (k * Math.PI) / order;
    let sq = 1 / (2 * Math.cos(angle));
    if (k === pairs) sq *= q / Math.SQRT1_2;
    const alpha = Math.sin(w0) / (2 * sq);
    if (high) sections.push(eqNorm((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha));
    else sections.push(eqNorm((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha));
  }
  return sections;
}

// The biquad sections for one band. shape: 0 bell, 1 low shelf, 2 low cut,
// 3 high shelf, 4 high cut, 5 notch, 6 band pass, 7 tilt shelf.
function eqDesignBand(shape, freq, gainDb, q, slope, sr) {
  const f = Math.min(Math.max(freq, 5), sr * 0.49);
  const Q = Math.min(Math.max(q, 0.025), 40);
  const w0 = (2 * Math.PI * f) / sr;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  switch (shape) {
    case 0: {
      const A = Math.pow(10, gainDb / 40);
      return [eqNorm(1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A)];
    }
    case 1: return [eqShelf(false, f, gainDb, Q, sr)];
    case 2: return eqCutSections(false, f, Q, slope, sr);
    case 3: return [eqShelf(true, f, gainDb, Q, sr)];
    case 4: return eqCutSections(true, f, Q, slope, sr);
    case 5: return [eqNorm(1, -2 * cos, 1, 1 + alpha, -2 * cos, 1 - alpha)];
    case 6: return [eqNorm(alpha, 0, -alpha, 1 + alpha, -2 * cos, 1 - alpha)];
    case 7: return [eqShelf(false, f, -gainDb / 2, Q, sr), eqShelf(true, f, gainDb / 2, Q, sr)];
    default: return [];
  }
}

// Magnitude (dB) of a list of sections at frequency f.
function eqSectionsDb(sections, f, sr) {
  const w = (2 * Math.PI * f) / sr;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  let mag2 = 1;
  for (const s of sections) {
    const nr = s.b0 + s.b1 * c1 + s.b2 * c2;
    const ni = -(s.b1 * s1 + s.b2 * s2);
    const dr = 1 + s.a1 * c1 + s.a2 * c2;
    const di = -(s.a1 * s1 + s.a2 * s2);
    mag2 *= (nr * nr + ni * ni) / (dr * dr + di * di);
  }
  return 10 * Math.log10(Math.max(mag2, 1e-30));
}

class EqStage {
  constructor(target) {
    this.cur = { ...target };
    this.step = { b0: 0, b1: 0, b2: 0, a1: 0, a2: 0 };
    this.left = 0;
    // Transposed direct form II state, per channel.
    this.z = [0, 0, 0, 0];
  }
  glideTo(target) {
    for (const k of ["b0", "b1", "b2", "a1", "a2"]) this.step[k] = (target[k] - this.cur[k]) / EQ_RAMP;
    this.left = EQ_RAMP;
  }
  tick() {
    if (this.left > 0) {
      const c = this.cur, s = this.step;
      c.b0 += s.b0; c.b1 += s.b1; c.b2 += s.b2; c.a1 += s.a1; c.a2 += s.a2;
      this.left--;
    }
  }
  run(x, ch) {
    const c = this.cur, z = this.z, i = ch * 2;
    const y = c.b0 * x + z[i];
    z[i] = c.b1 * x - c.a1 * y + z[i + 1];
    z[i + 1] = c.b2 * x - c.a2 * y;
    return y;
  }
}

class ParamEqKernel {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.bands = [];
    this.outGain = 1;
    this.outTarget = 1;
    this.solo = null;
  }

  // state: { bands: [{ on, shape, freq, gain, q, slope, place }], outputDb, solo }
  // solo is a band index to audition (only its region passes) or -1.
  set(state) {
    const sr = this.sampleRate;
    state.bands.forEach((b, i) => {
      const prev = this.bands[i];
      if (!b || b.on !== 1) {
        this.bands[i] = null;
        return;
      }
      const sections = eqDesignBand(b.shape, b.freq, b.gain, b.q, b.slope, sr);
      if (prev && prev.shape === b.shape && prev.stages.length === sections.length) {
        prev.stages.forEach((st, k) => st.glideTo(sections[k]));
        prev.place = b.place;
      } else {
        this.bands[i] = { shape: b.shape, place: b.place, stages: sections.map((s) => new EqStage(s)) };
      }
    });
    this.bands.length = state.bands.length;
    this.outTarget = Math.pow(10, (state.outputDb || 0) / 20);
    const soloBand = state.solo >= 0 ? state.bands[state.solo] : null;
    if (soloBand && soloBand.on) {
      const q = Math.max(0.5, Math.min(soloBand.q, 8));
      const target = eqDesignBand(6, soloBand.freq, 0, q, 12, sr)[0];
      if (this.solo) this.solo.glideTo(target);
      else this.solo = new EqStage(target);
    } else {
      this.solo = null;
    }
  }

  process(inL, inR, outL, outR, n) {
    const bands = this.bands;
    for (let i = 0; i < n; i++) {
      let l = inL ? inL[i] : 0;
      let r = inR ? inR[i] : l;
      if (this.solo) {
        this.solo.tick();
        l = this.solo.run(l, 0);
        r = this.solo.run(r, 1);
      } else {
        for (let b = 0; b < bands.length; b++) {
          const band = bands[b];
          if (!band) continue;
          const stages = band.stages;
          const place = band.place;
          if (place === 3 || place === 4) {
            let m = (l + r) * 0.5;
            let s = (l - r) * 0.5;
            for (let k = 0; k < stages.length; k++) {
              stages[k].tick();
              if (place === 3) m = stages[k].run(m, 0);
              else s = stages[k].run(s, 0);
            }
            l = m + s;
            r = m - s;
          } else {
            for (let k = 0; k < stages.length; k++) {
              const st = stages[k];
              st.tick();
              if (place !== 2) l = st.run(l, 0);
              if (place !== 1) r = st.run(r, 1);
            }
          }
        }
      }
      this.outGain += (this.outTarget - this.outGain) * 0.002;
      outL[i] = l * this.outGain;
      if (outR) outR[i] = r * this.outGain;
    }
  }
}
`;

type DesignBand = (shape: number, freq: number, gainDb: number, q: number, slope: number, sampleRate: number) => EqSection[];
type SectionsDb = (sections: EqSection[], freq: number, sampleRate: number) => number;

const evaluated = new Function(`${EQ_SOURCE}; return { eqDesignBand, eqSectionsDb };`)() as {
  eqDesignBand: DesignBand;
  eqSectionsDb: SectionsDb;
};

/** The biquad sections a band runs as (same code as the worklet). */
export const designEqBand: DesignBand = evaluated.eqDesignBand;
/** Magnitude in dB of sections at a frequency (same code as the worklet). */
export const eqSectionsDb: SectionsDb = evaluated.eqSectionsDb;

/** Default frequency for a new band slot, spread across the spectrum. */
export function defaultBandFreq(index: number): number {
  return Math.round(40 * Math.pow(2, (index * 9) / MAX_EQ_BANDS) * 10) / 10;
}

/** Reads band `index` (0-based) out of the effect's flat params. */
export function eqBandFromParams(params: Record<string, number>, index: number): EqBand {
  const p = (k: string, d: number) => params[`b${index + 1}${k}`] ?? d;
  return {
    on: Math.round(p("On", 0)),
    shape: Math.round(p("Shape", 0)),
    freq: p("Freq", defaultBandFreq(index)),
    gain: p("Gain", 0),
    q: p("Q", 1),
    slope: p("Slope", 12),
    place: Math.round(p("Place", 0)),
  };
}

export function eqBandsFromParams(params: Record<string, number>): EqBand[] {
  return Array.from({ length: MAX_EQ_BANDS }, (_, i) => eqBandFromParams(params, i));
}
