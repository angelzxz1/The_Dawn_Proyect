// The Noise Gate's DSP kernel. It's kept as source text because it runs
// inside an AudioWorklet (see noiseGate.ts); the unit tests evaluate this
// same text, so what they check is exactly what plays.
//
// Detection: a stereo-linked peak follower (instant rise, 20 ms fall - slow
// enough that a low E string's wave doesn't read as silence between its own
// peaks). The gate opens when that level rises above Threshold and only
// starts closing once it falls HYSTERESIS_DB below it, so a note fading out
// right at the threshold doesn't chatter open/closed. After the level drops,
// Hold keeps the gate open a little longer; then the gain fades down over
// Release to Range (how far it turns down - -80 dB is effectively silence).
// Opening fades up over Attack. No lookahead, so no added latency.

export const HYSTERESIS_DB = 4;

export interface GateSettings {
  thresholdDb: number;
  /** Seconds. */
  attack: number;
  hold: number;
  release: number;
  /** dB of reduction when closed, <= 0. */
  rangeDb: number;
}

export const GATE_KERNEL_SOURCE = `
class NoiseGateKernel {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.level = 0;
    this.gain = 0;
    this.open = false;
    this.holdLeft = 0;
    this.detectorFall = Math.exp(-1 / (0.02 * sampleRate));
    this.set({ thresholdDb: -60, attack: 0.001, hold: 0.05, release: 0.15, rangeDb: -80 });
    this.gain = this.floor;
  }

  set(s) {
    const sr = this.sampleRate;
    this.openAt = Math.pow(10, s.thresholdDb / 20);
    this.closeAt = Math.pow(10, (s.thresholdDb - ${HYSTERESIS_DB}) / 20);
    this.attackCoef = 1 - Math.exp(-1 / (Math.max(0.00005, s.attack) * sr));
    this.releaseCoef = 1 - Math.exp(-1 / (Math.max(0.001, s.release) * sr));
    this.holdSamples = Math.round(Math.max(0, s.hold) * sr);
    this.floor = s.rangeDb <= -80 ? 0 : Math.pow(10, Math.min(0, s.rangeDb) / 20);
  }

  // Gates n frames of inL/inR (inR may be null for mono) into outL/outR.
  // Returns the loudest input sample and the lowest gain applied.
  process(inL, inR, outL, outR, n) {
    let peakIn = 0;
    let minGain = 1;
    for (let i = 0; i < n; i++) {
      const l = inL ? inL[i] : 0;
      const r = inR ? inR[i] : l;
      const x = Math.max(Math.abs(l), Math.abs(r));
      if (x > peakIn) peakIn = x;
      this.level = x > this.level ? x : this.level * this.detectorFall;

      if (this.level >= this.openAt) {
        this.open = true;
        this.holdLeft = this.holdSamples;
      } else if (this.open && this.level < this.closeAt) {
        if (this.holdLeft > 0) this.holdLeft--;
        else this.open = false;
      }

      const target = this.open ? 1 : this.floor;
      this.gain += (target - this.gain) * (target > this.gain ? this.attackCoef : this.releaseCoef);
      if (this.gain < minGain) minGain = this.gain;
      outL[i] = l * this.gain;
      if (outR) outR[i] = r * this.gain;
    }
    return { peakIn, minGain };
  }
}
`;
