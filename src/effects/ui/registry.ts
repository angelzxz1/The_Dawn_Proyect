// Every effect's rack card and window, from each effect folder's ui.ts.

import type { EffectType } from "../registry";
import type { EffectUi } from "./types";
import { compressorUi } from "../compressor/ui";
import { glueUi } from "../glue/ui";
import { multibandUi } from "../multiband/ui";
import { multibandDynamicsUi } from "../multiband-dynamics/ui";
import { limiterUi } from "../limiter/ui";
import { gateUi } from "../gate/ui";
import { parametricEqUi } from "../parametric-eq/ui";
import { eqThreeUi } from "../eq-three/ui";
import { filterUi } from "../filter/ui";
import { chorusUi } from "../chorus/ui";
import { pitchShiftUi } from "../pitch-shift/ui";
import { saturatorUi } from "../saturator/ui";
import { reverbUi } from "../reverb/ui";
import { delayUi } from "../delay/ui";
import { furnaceUi } from "../furnace/ui";
import { namAmpUi } from "../nam-amp/ui";
import { irLoaderUi } from "../ir-loader/ui";
import { utilityUi } from "../utility/ui";
import { tunerUi } from "../tuner/ui";

export const EFFECT_UI: Record<EffectType, EffectUi> = {
  compressor: compressorUi,
  glue: glueUi,
  multiband: multibandUi,
  mbDynamics: multibandDynamicsUi,
  limiter: limiterUi,
  gate: gateUi,
  paramEq: parametricEqUi,
  eq3: eqThreeUi,
  filter: filterUi,
  chorus: chorusUi,
  pitchShift: pitchShiftUi,
  distortion: saturatorUi,
  reverb: reverbUi,
  delay: delayUi,
  tubeAmp: furnaceUi,
  namAmp: namAmpUi,
  irLoader: irLoaderUi,
  utility: utilityUi,
  tuner: tunerUi,
};
