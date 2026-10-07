// Builds any effect's audio node and applies its parameters, from each
// effect folder's audio.ts. Shared by the live engine and the export, so
// both build identical chains.

import type * as Tone from "tone";
import { type EffectType, defaultParams } from "./registry";
import type { EffectAudio } from "./types";
import { compressorAudio } from "./compressor/audio";
import { glueAudio } from "./glue/audio";
import { multibandAudio } from "./multiband/audio";
import { multibandDynamicsAudio } from "./multiband-dynamics/audio";
import { limiterAudio } from "./limiter/audio";
import { gateAudio } from "./gate/audio";
import { parametricEqAudio } from "./parametric-eq/audio";
import { eqThreeAudio } from "./eq-three/audio";
import { filterAudio } from "./filter/audio";
import { chorusAudio } from "./chorus/audio";
import { pitchShiftAudio } from "./pitch-shift/audio";
import { saturatorAudio } from "./saturator/audio";
import { reverbAudio } from "./reverb/audio";
import { delayAudio } from "./delay/audio";
import { furnaceAudio } from "./furnace/audio";
import { namAmpAudio } from "./nam-amp/audio";
import { irLoaderAudio } from "./ir-loader/audio";
import { utilityAudio } from "./utility/audio";
import { tunerAudio } from "./tuner/audio";

export { DelayChain } from "./delay/delayChain";
export { ReverbChain } from "./reverb/reverbChain";
export { FilterChain } from "./filter/filterChain";
export { ChorusChain } from "./chorus/chorusChain";
export { IrLoaderChain } from "./ir-loader/irLoaderChain";

const AUDIO: Record<EffectType, EffectAudio> = {
  compressor: compressorAudio,
  glue: glueAudio,
  multiband: multibandAudio,
  mbDynamics: multibandDynamicsAudio,
  limiter: limiterAudio,
  gate: gateAudio,
  paramEq: parametricEqAudio,
  eq3: eqThreeAudio,
  filter: filterAudio,
  chorus: chorusAudio,
  pitchShift: pitchShiftAudio,
  distortion: saturatorAudio,
  reverb: reverbAudio,
  delay: delayAudio,
  tubeAmp: furnaceAudio,
  namAmp: namAmpAudio,
  irLoader: irLoaderAudio,
  utility: utilityAudio,
  tuner: tunerAudio,
};

export function createEffectNode(type: EffectType, savedParams: Record<string, number>): Tone.ToneAudioNode {
  // Params saved before an effect gained new controls lack those keys (the
  // live engine fills them via addEffect's defaults, but the WAV export
  // builds straight from saved params) - fill them in so nothing gets NaN.
  return AUDIO[type].create({ ...defaultParams(type), ...savedParams });
}

export function applyEffectParam(node: Tone.ToneAudioNode, type: EffectType, key: string, value: number): void {
  AUDIO[type].set(node, key, value);
}
