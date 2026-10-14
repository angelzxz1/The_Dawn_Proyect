// Every effect Dawn has, collected from the effect folders (each one's
// index.ts says what it is: key, name, browser group, parameters). Shared
// by the engine, the project schema, the UI and the site. To add an effect,
// give it a folder with index.ts, audio.ts and ui.ts and list it here, in
// nodes.ts and in ui/registry.ts.

import type { PresetRef } from "./presets";
import type { SidechainRouting } from "./sidechain/sidechainModel";
import { mbBandCount } from "./multiband/multibandModel";
import { EFFECT_GROUP_NAMES, type EffectDefinition, type EffectFileRef, type EffectGroup, type ParamSpec } from "./types";
import { compressorEffect } from "./compressor";
import { glueEffect } from "./glue";
import { multibandEffect } from "./multiband";
import { multibandDynamicsEffect } from "./multiband-dynamics";
import { limiterEffect } from "./limiter";
import { gateEffect } from "./gate";
import { parametricEqEffect } from "./parametric-eq";
import { eqThreeEffect } from "./eq-three";
import { filterEffect } from "./filter";
import { chorusEffect } from "./chorus";
import { pitchShiftEffect } from "./pitch-shift";
import { saturatorEffect } from "./saturator";
import { reverbEffect } from "./reverb";
import { delayEffect } from "./delay";
import { furnaceEffect } from "./furnace";
import { namAmpEffect } from "./nam-amp";
import { irLoaderEffect } from "./ir-loader";
import { utilityEffect } from "./utility";
import { tunerEffect } from "./tuner";

export type { EffectFileRef, EffectGroup, ParamSpec };

/** In the effect browser's order. */
const EFFECTS = [
  compressorEffect,
  glueEffect,
  multibandEffect,
  multibandDynamicsEffect,
  limiterEffect,
  gateEffect,
  parametricEqEffect,
  eqThreeEffect,
  filterEffect,
  chorusEffect,
  pitchShiftEffect,
  saturatorEffect,
  reverbEffect,
  delayEffect,
  furnaceEffect,
  namAmpEffect,
  irLoaderEffect,
  utilityEffect,
  tunerEffect,
] as const;

export type EffectType = (typeof EFFECTS)[number]["type"];

const ALL: EffectDefinition<EffectType>[] = [...EFFECTS];
const BY_TYPE = new Map(ALL.map((e) => [e.type, e]));

export function effectDefinition(type: EffectType): EffectDefinition<EffectType> {
  return BY_TYPE.get(type)!;
}

export const EFFECT_TYPES: EffectType[] = ALL.map((e) => e.type);

/** Groups the effect palette the way an Ableton-style device browser would
 * - the sidebar renders one collapsible section per group. */
export const EFFECT_GROUPS: { name: string; types: EffectType[] }[] = EFFECT_GROUP_NAMES.map((name) => ({
  name,
  types: ALL.filter((e) => e.group === name).map((e) => e.type),
}));

export const EFFECT_LABELS = Object.fromEntries(ALL.map((e) => [e.type, e.label])) as Record<EffectType, string>;

/** Effect types whose detector can listen to another track (a sidechain). */
export const SIDECHAIN_EFFECT_TYPES: EffectType[] = ALL.filter((e) => e.sidechain).map((e) => e.type);

export function hasSidechain(type: EffectType): boolean {
  return SIDECHAIN_EFFECT_TYPES.includes(type);
}

/** Effect types that take an uploaded file (an impulse response, ...) in
 * addition to their knobs. */
export const FILE_EFFECT_TYPES: EffectType[] = ALL.filter((e) => e.file).map((e) => e.type);

export interface EffectInstance {
  id: string;
  type: EffectType;
  params: Record<string, number>;
  /** Skipped in the signal chain (as if unplugged) without losing its
   * params or its position in the chain, so it can be flipped back on. */
  bypass?: boolean;
  /** Only for FILE_EFFECT_TYPES - absent until a file is loaded. */
  file?: EffectFileRef;
  /** Only for SIDECHAIN_EFFECT_TYPES - absent until one is set up. */
  sidechain?: SidechainRouting;
  /** The preset it was last loaded from or saved as (see presets.ts). */
  preset?: PresetRef;
}

/** The params an effect offers as automation targets: continuous ones, and
 * for the Parametric EQ and Multiband Compressor only the bands (and
 * crossovers) that exist. */
export function automatableParamSpecs(fx: EffectInstance): ParamSpec[] {
  const bandCount = fx.type === "multiband" ? mbBandCount(fx.params) : 0;
  return paramSpecs(fx.type).filter((spec) => {
    if (spec.automatable === false) return false;
    if (fx.type === "multiband") {
      const m = /^([bx])(\d+)/.exec(spec.key);
      if (!m) return true;
      return m[1] === "b" ? Number(m[2]) <= bandCount : Number(m[2]) < bandCount;
    }
    if (fx.type === "mbDynamics") {
      const b = /^([lh])[A-Z]/.exec(spec.key)?.[1];
      if (b === "l") return (fx.params.lowOn ?? 1) >= 0.5;
      if (b === "h") return (fx.params.highOn ?? 1) >= 0.5;
      return true;
    }
    const band = fx.type === "paramEq" ? /^b(\d+)/.exec(spec.key) : null;
    return !band || (fx.params[`b${band[1]}On`] ?? 0) >= 0.5;
  });
}

export function paramSpecs(type: EffectType): ParamSpec[] {
  return effectDefinition(type).params;
}

export function defaultParams(type: EffectType): Record<string, number> {
  return Object.fromEntries(paramSpecs(type).map((s) => [s.key, s.default]));
}
