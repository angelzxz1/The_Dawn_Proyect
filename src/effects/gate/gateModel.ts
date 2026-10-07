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
//
// The detector hears the key signal: the gate's own input, or a sidechain
// (see sidechainModel.ts), through the sidechain gain and filters.

import { KEY_FILTER_SOURCE, type KeySettings } from "../sidechain/sidechainModel";

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

export type GateKernelSettings = GateSettings & Partial<KeySettings>;

export const GATE_KERNEL_SOURCE = `
${KEY_FILTER_SOURCE}
class NoiseGateKernel {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.level = 0;
    this.gain = 0;
    this.open = false;
    this.holdLeft = 0;
    this.detectorFall = Math.exp(-1 / (0.02 * sampleRate));
    this.key = new KeyFilter(sampleRate);
    this.external = false;
    this.listen = false;
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
    this.external = !!s.external;
    this.listen = !!s.listen;
    this.key.set(s);
  }

  // Gates n frames of inL/inR (inR may be null for mono) into outL/outR;
  // keyL/keyR is the sidechain (null when nothing is connected). Returns
  // the loudest key sample (what the threshold is compared with) and the
  // lowest gain applied.
  process(inL, inR, outL, outR, n, keyL, keyR) {
    let peakIn = 0;
    let minGain = 1;
    const kf = this.key;
    for (let i = 0; i < n; i++) {
      const l = inL ? inL[i] : 0;
      const r = inR ? inR[i] : l;
      let kl = l;
      let kr = r;
      if (this.external) {
        kl = keyL ? keyL[i] : 0;
        kr = keyR ? keyR[i] : kl;
      }
      kl = kf.run(kl, 0);
      kr = kf.run(kr, 1);
      const x = Math.max(Math.abs(kl), Math.abs(kr));
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
      if (this.listen) {
        outL[i] = kl;
        if (outR) outR[i] = kr;
      } else {
        outL[i] = l * this.gain;
        if (outR) outR[i] = r * this.gain;
      }
    }
    return { peakIn, minGain };
  }
}
`;
