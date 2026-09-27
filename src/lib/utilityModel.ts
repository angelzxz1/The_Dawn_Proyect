// The Utility's DSP (Ableton-style): the kernel is kept as source text
// because it runs inside an AudioWorklet (utility.ts); the unit tests
// evaluate this same text, so what they check is exactly what plays.
//
// Signal flow, per sample:
//   DC filter -> channel mode (Left / Stereo / Right / Swap) -> polarity
//   invert per side -> width (mid/side: 0% mono, 100% as is, up to 400%)
//   with bass mono (the side signal high-passed, so everything below the
//   frequency is mono) -> gain -> balance -> mute.
// Gain, width, balance and mute glide over ~10 ms so moving them never
// clicks. No latency.

export const UTILITY_CHANNEL_MODES = ["stereo", "left", "right", "swap"] as const;
export type UtilityChannelMode = (typeof UTILITY_CHANNEL_MODES)[number];
export const UTILITY_CHANNEL_LABELS: Record<UtilityChannelMode, string> = {
  stereo: "Stereo",
  left: "Left",
  right: "Right",
  swap: "Swap",
};

/** Gain at or below this is silence (-inf dB). */
export const UTILITY_GAIN_FLOOR = -60;

export interface UtilitySettings {
  gainDb: number;
  /** 0..4 (0% .. 400%). */
  width: number;
  mono: boolean;
  bassMono: boolean;
  bassFreq: number;
  invertL: boolean;
  invertR: boolean;
  /** Index into UTILITY_CHANNEL_MODES. */
  channel: number;
  /** -1 (left) .. 1 (right). */
  balance: number;
  dcFilter: boolean;
  mute: boolean;
}

export function utilitySettingsFromParams(p: Record<string, number>): UtilitySettings {
  return {
    gainDb: p.gain ?? 0,
    width: p.width ?? 1,
    mono: (p.mono ?? 0) >= 0.5,
    bassMono: (p.bassMono ?? 0) >= 0.5,
    bassFreq: p.bassFreq ?? 120,
    invertL: (p.invertL ?? 0) >= 0.5,
    invertR: (p.invertR ?? 0) >= 0.5,
    channel: Math.round(p.channel ?? 0),
    balance: p.balance ?? 0,
    dcFilter: (p.dcFilter ?? 0) >= 0.5,
    mute: (p.mute ?? 0) >= 0.5,
  };
}

/** The output gains (L, R) for a balance setting: the far side is turned
 * down, the near side is left alone. */
export function balanceGains(balance: number): [number, number] {
  const b = Math.max(-1, Math.min(1, balance));
  return [b > 0 ? 1 - b : 1, b < 0 ? 1 + b : 1];
}

export const UTILITY_SOURCE = `
// Bass mono's filters at one frequency, each [b0, b1, b2, a1, a2]: a
// Butterworth high pass (run twice on the side: Linkwitz-Riley) and the
// matching all pass (run on the mid), so both halves get the same phase
// shift and the stereo image above the frequency is untouched.
function utilityBassMono(freq, sr) {
  const w0 = (2 * Math.PI * Math.min(freq, sr * 0.45)) / sr;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  return {
    hp: [(1 + cos) / 2 / a0, -(1 + cos) / a0, (1 + cos) / 2 / a0, a1, a2],
    ap: [(1 - alpha) / a0, a1, 1, a1, a2],
  };
}

class UtilityKernel {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.smooth = 1 - Math.exp(-1 / (0.01 * sampleRate));
    this.dcCoef = Math.exp((-2 * Math.PI * 5) / sampleRate);
    this.dc = [0, 0, 0, 0]; // x1/y1 per channel
    this.hp = new Float64Array(4); // two cascaded high passes' state, on the side
    this.ap = new Float64Array(2); // the all pass's state, on the mid
    this.bass = utilityBassMono(120, sampleRate);
    this.gain = 1;
    this.width = 1;
    this.balL = 1;
    this.balR = 1;
    this.started = false;
    // Meters, read and reset by the processor.
    this.peakL = 0;
    this.peakR = 0;
    this.sumLR = 0;
    this.sumLL = 0;
    this.sumRR = 0;
  }

  set(s) {
    this.s = s;
    this.gainTarget = s.mute || s.gainDb <= ${UTILITY_GAIN_FLOOR} ? 0 : Math.pow(10, s.gainDb / 20);
    this.widthTarget = s.mono ? 0 : Math.max(0, Math.min(4, s.width));
    const b = Math.max(-1, Math.min(1, s.balance));
    this.balLTarget = b > 0 ? 1 - b : 1;
    this.balRTarget = b < 0 ? 1 + b : 1;
    this.bass = utilityBassMono(s.bassFreq, this.sr);
    if (!this.started) {
      this.started = true;
      this.gain = this.gainTarget;
      this.width = this.widthTarget;
      this.balL = this.balLTarget;
      this.balR = this.balRTarget;
    }
  }

  process(inL, inR, outL, outR, n) {
    const s = this.s;
    const k = this.smooth;
    const c = this.bass.hp;
    const a = this.bass.ap;
    const hp = this.hp;
    const ap = this.ap;
    for (let i = 0; i < n; i++) {
      let l = inL ? inL[i] : 0;
      let r = inR ? inR[i] : l;
      if (s.dcFilter) {
        // One-pole DC blocker (~5 Hz).
        const yl = l - this.dc[0] + this.dcCoef * this.dc[1];
        this.dc[0] = l;
        this.dc[1] = yl;
        const yr = r - this.dc[2] + this.dcCoef * this.dc[3];
        this.dc[2] = r;
        this.dc[3] = yr;
        l = yl;
        r = yr;
      }
      if (s.channel === 1) r = l;
      else if (s.channel === 2) l = r;
      else if (s.channel === 3) {
        const t = l;
        l = r;
        r = t;
      }
      if (s.invertL) l = -l;
      if (s.invertR) r = -r;
      this.width += (this.widthTarget - this.width) * k;
      this.gain += (this.gainTarget - this.gain) * k;
      this.balL += (this.balLTarget - this.balL) * k;
      this.balR += (this.balRTarget - this.balR) * k;
      let mid = (l + r) * 0.5;
      let side = (l - r) * 0.5;
      if (s.bassMono) {
        const m = a[0] * mid + ap[0];
        ap[0] = a[1] * mid - a[3] * m + ap[1];
        ap[1] = a[2] * mid - a[4] * m;
        mid = m;
        // Two Butterworth high passes (24 dB/oct) on the side: the lows
        // lose their stereo, the rest keeps it.
        let y = c[0] * side + hp[0];
        hp[0] = c[1] * side - c[3] * y + hp[1];
        hp[1] = c[2] * side - c[4] * y;
        const x2 = y;
        y = c[0] * x2 + hp[2];
        hp[2] = c[1] * x2 - c[3] * y + hp[3];
        hp[3] = c[2] * x2 - c[4] * y;
        side = y;
      }
      side *= this.width;
      const oL = (mid + side) * this.gain * this.balL;
      const oR = (mid - side) * this.gain * this.balR;
      outL[i] = oL;
      if (outR) outR[i] = oR;
      const aL = Math.abs(oL);
      const aR = Math.abs(oR);
      if (aL > this.peakL) this.peakL = aL;
      if (aR > this.peakR) this.peakR = aR;
      this.sumLR += oL * oR;
      this.sumLL += oL * oL;
      this.sumRR += oR * oR;
    }
  }

  /** Output peaks and L/R correlation (-1 out of phase .. 1 mono) since
   * the last call. */
  takeMeters() {
    const denom = Math.sqrt(this.sumLL * this.sumRR);
    const m = { peakL: this.peakL, peakR: this.peakR, correlation: denom > 1e-12 ? this.sumLR / denom : 1 };
    this.peakL = this.peakR = this.sumLR = this.sumLL = this.sumRR = 0;
    return m;
  }
}
`;
