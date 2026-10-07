// Shared sidechain pieces for the dynamics effects (Compressor, Noise Gate,
// Multiband Compressor): what their detectors listen to.
//
// A detector normally hears the effect's own input. With a sidechain it
// hears another track instead (a kick ducking a bass, a vocal ducking the
// music). Either way the detected signal first goes through a gain and a
// low-cut / high-cut filter pair ("sidechain EQ"): a low cut keeps a
// compressor from pumping on bass, a narrow band makes a de-esser. Listen
// sends that filtered key signal to the output so you can hear what the
// detector hears.

/** Where on the source track the key signal is taken. */
export const SIDECHAIN_TAPS = ["preFx", "postFx", "postFader"] as const;
export type SidechainTap = (typeof SIDECHAIN_TAPS)[number];
export const SIDECHAIN_TAP_LABELS: Record<SidechainTap, string> = {
  preFx: "Pre FX",
  postFx: "Post FX",
  postFader: "Post Fader",
};

/** A dynamics effect's external key input, saved with the effect. Off, or
 * with no (or a deleted) source, the effect listens to its own input. */
export interface SidechainRouting {
  on: boolean;
  /** A track or bus id. */
  source: string | null;
  tap: SidechainTap;
}

export const DEFAULT_SIDECHAIN: SidechainRouting = { on: false, source: null, tap: "postFx" };

/** Filter settings at these ends mean "off". */
export const SC_HPF_OFF = 20;
export const SC_LPF_OFF = 20000;

/** The key signal's settings, as the kernels take them. */
export interface KeySettings {
  /** Detect from the key input (true) or the effect's own input. */
  external: boolean;
  scGainDb: number;
  scHpf: number;
  scLpf: number;
  /** Output the filtered key signal instead of the processed audio. */
  listen: boolean;
}

export function keySettingsFromParams(params: Record<string, number>, external: boolean): KeySettings {
  return {
    external,
    scGainDb: params.scGain ?? 0,
    scHpf: params.scHpf ?? SC_HPF_OFF,
    scLpf: params.scLpf ?? SC_LPF_OFF,
    listen: (params.scListen ?? 0) >= 0.5,
  };
}

/** Kernel source: `KeyFilter`, a stereo 12 dB/oct low cut + high cut with
 * a gain, bypassed entirely while both are off and the gain is 0 dB. */
export const KEY_FILTER_SOURCE = `
function keyBiquad(type, freq, sr) {
  const w0 = (2 * Math.PI * Math.min(freq, sr * 0.45)) / sr;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b1 = type === "hp" ? -(1 + cos) : 1 - cos;
  const b0 = type === "hp" ? (1 + cos) / 2 : (1 - cos) / 2;
  return [b0 / a0, b1 / a0, b0 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

class KeyFilter {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.hp = null;
    this.lp = null;
    this.gain = 1;
    this.active = false;
    // Per channel: hp z1, z2, lp z1, z2.
    this.state = new Float64Array(8);
  }

  set(s) {
    this.hp = s.scHpf > ${SC_HPF_OFF} + 0.5 ? keyBiquad("hp", s.scHpf, this.sr) : null;
    this.lp = s.scLpf < ${SC_LPF_OFF} - 1 ? keyBiquad("lp", s.scLpf, this.sr) : null;
    this.gain = Math.pow(10, (s.scGainDb || 0) / 20);
    const wasActive = this.active;
    this.active = !!(this.hp || this.lp);
    if (!wasActive && this.active) this.state.fill(0);
  }

  // One sample of channel ch (0 or 1).
  run(x, ch) {
    if (!this.active) return x * this.gain;
    const s = this.state;
    const o = ch * 4;
    let y = x;
    if (this.hp) {
      const c = this.hp;
      const v = c[0] * y + s[o];
      s[o] = c[1] * y - c[3] * v + s[o + 1];
      s[o + 1] = c[2] * y - c[4] * v;
      y = v;
    }
    if (this.lp) {
      const c = this.lp;
      const v = c[0] * y + s[o + 2];
      s[o + 2] = c[1] * y - c[3] * v + s[o + 3];
      s[o + 3] = c[2] * y - c[4] * v;
      y = v;
    }
    return y * this.gain;
  }
}
`;
