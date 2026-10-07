// Ready-made effect chains: several devices added to a track at once, set
// up for one job (a guitar amp tone, a bass DI, a vocal). They're built from
// factory presets and Dawn's own cabinets, so they work with nothing to
// download: the Furnace or the Saturator plays the amp until you load a
// NAM capture.

import type { EffectFileRef, EffectType } from "./effects";
import { factoryCab } from "./cabIrs";

export interface ChainStep {
  type: EffectType;
  /** A factory preset's id (see presets.ts). */
  preset?: string;
  /** Settings on top of the preset. */
  params?: Record<string, number>;
  /** The file it loads (a factory cabinet). */
  file?: EffectFileRef;
}

export interface EffectChain {
  id: string;
  name: string;
  description: string;
  steps: ChainStep[];
}

const cab = (id: string): EffectFileRef => ({ id, name: factoryCab(id)?.name ?? id });

export const EFFECT_CHAINS: EffectChain[] = [
  {
    id: "clean-guitar",
    name: "Clean Guitar",
    description: "Gate, a touch of warmth, an open-back 1x12, a little chorus and a small room.",
    steps: [
      { type: "gate", preset: "factory:gate:guitar-hiss" },
      { type: "distortion", preset: "factory:distortion:soft-sine-glow", params: { distortion: 0.12, tone: 9000 } },
      { type: "irLoader", preset: "factory:irLoader:tight-guitar-cab", file: cab("factory-ir:1x12-open") },
      { type: "paramEq", params: { b1On: 1, b1Shape: 2, b1Freq: 90, b1Q: 0.71, b1Slope: 18, b2On: 1, b2Shape: 0, b2Freq: 2500, b2Gain: 1.5, b2Q: 0.9 } },
      { type: "chorus", preset: "factory:chorus:subtle-widener" },
      { type: "reverb", preset: "factory:reverb:small-room", params: { wet: 0.15 } },
    ],
  },
  {
    id: "crunch-guitar",
    name: "Crunch Guitar",
    description: "Edge-of-breakup drive into a 2x12, mids forward: classic rock rhythm.",
    steps: [
      { type: "gate", preset: "factory:gate:guitar-hiss" },
      { type: "distortion", preset: "factory:distortion:crunch", params: { distortion: 0.45, colorOn: 1, colorMode: 0, colorFreq: 800, colorQ: 0.7, colorDepth: 4 } },
      { type: "irLoader", preset: "factory:irLoader:tight-guitar-cab", file: cab("factory-ir:2x12-combo") },
      { type: "paramEq", params: { b1On: 1, b1Shape: 2, b1Freq: 90, b1Q: 0.71, b1Slope: 18, b2On: 1, b2Shape: 0, b2Freq: 350, b2Gain: -2, b2Q: 1.2, b3On: 1, b3Shape: 0, b3Freq: 1800, b3Gain: 2, b3Q: 0.9 } },
      { type: "reverb", preset: "factory:reverb:small-room", params: { wet: 0.12 } },
    ],
  },
  {
    id: "high-gain-guitar",
    name: "High-Gain Guitar",
    description: "A tight gate, the Furnace's Modern channel and a closed 4x12, low end and fizz trimmed.",
    steps: [
      { type: "gate", preset: "factory:gate:guitar-hiss", params: { threshold: -50, release: 0.08 } },
      { type: "tubeAmp", preset: "factory:tubeAmp:modern-rhythm" },
      { type: "irLoader", preset: "factory:irLoader:tight-guitar-cab", file: cab("factory-ir:4x12-closed") },
      { type: "paramEq", params: { b1On: 1, b1Shape: 2, b1Freq: 80, b1Q: 0.71, b1Slope: 24, b4On: 1, b4Shape: 4, b4Freq: 10000, b4Q: 0.71 } },
    ],
  },
  {
    id: "bass-di",
    name: "Bass",
    description: "Even dynamics, a little grit that keeps the lows clean, and an 8x10 blended in.",
    steps: [
      { type: "compressor", preset: "factory:compressor:bass-tamer" },
      { type: "distortion", preset: "factory:distortion:bass-grit-clean-lows", params: { distortion: 0.3 } },
      { type: "irLoader", file: cab("factory-ir:8x10-bass"), params: { wet: 0.6 } },
      { type: "paramEq", preset: "factory:paramEq:bass-clean-up" },
    ],
  },
  {
    id: "acoustic-guitar",
    name: "Acoustic Guitar",
    description: "Gentle compression, the boom tamed, a bit of air and a small room.",
    steps: [
      { type: "compressor", preset: "factory:compressor:gentle-glue" },
      { type: "paramEq", params: { b1On: 1, b1Shape: 2, b1Freq: 80, b1Q: 0.71, b1Slope: 18, b2On: 1, b2Shape: 0, b2Freq: 220, b2Gain: -3, b2Q: 1.2, b3On: 1, b3Shape: 3, b3Freq: 9000, b3Gain: 2, b3Q: 0.71 } },
      { type: "reverb", preset: "factory:reverb:small-room", params: { wet: 0.18 } },
    ],
  },
  {
    id: "vocal",
    name: "Vocal",
    description: "Breath gate, leveling compression, clarity EQ and a plate.",
    steps: [
      { type: "gate", preset: "factory:gate:vocal-breaths" },
      { type: "compressor", preset: "factory:compressor:vocal-leveler" },
      { type: "paramEq", preset: "factory:paramEq:vocal-clarity" },
      { type: "reverb", preset: "factory:reverb:vocal-plate" },
    ],
  },
];

export function chainById(id: string): EffectChain | undefined {
  return EFFECT_CHAINS.find((c) => c.id === id);
}
