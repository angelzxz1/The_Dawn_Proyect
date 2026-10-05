// Automation targets: what a track's automation lane can draw (its
// volume, its pan, or any automatable parameter of its effects), with the
// range and format each is edited in.

import { EFFECT_LABELS, automatableParamSpecs, paramSpecs, type EffectInstance } from "./effects";
import type { AutomationTarget, ChannelConfig } from "./types";

/** A stable string key for an automation target, so two targets can be
 * compared for equality (e.g. "does this channel already have a lane for
 * Pan?") without a deep-equal check. */
export function automationTargetKey(target: AutomationTarget): string {
  return target.kind === "effect" ? `effect:${target.effectId}:${target.paramKey}` : target.kind;
}

/** The value range and display format an automation target's curve should
 * be edited in - matches the same range each target's own live control
 * (the volume/pan ValueBars, or the effect's own param knob) uses. */
export function automationRange(
  target: AutomationTarget,
  channelEffects: EffectInstance[]
): { min: number; max: number; format: (v: number) => string } {
  if (target.kind === "volume") {
    return { min: -60, max: 6, format: (v) => (v <= -60 ? "-∞" : `${v.toFixed(1)}dB`) };
  }
  if (target.kind === "pan") {
    return {
      min: -1,
      max: 1,
      format: (v) => (Math.abs(v) < 0.02 ? "C" : v < 0 ? `${Math.round(-v * 100)}L` : `${Math.round(v * 100)}R`),
    };
  }
  const fx = channelEffects.find((e) => e.id === target.effectId);
  const spec = fx && paramSpecs(fx.type).find((s) => s.key === target.paramKey);
  if (spec) return { min: spec.min, max: spec.max, format: spec.format };
  return { min: 0, max: 1, format: (v) => v.toFixed(2) };
}

/** An automation target's own live value right now - the channel's Vol/Pan
 * ValueBar, or the effect's own param - drawn as the lane's dashed
 * reference line. */
export function automationCurrentValue(
  target: AutomationTarget,
  channel: ChannelConfig,
  channelEffects: EffectInstance[]
): number {
  if (target.kind === "volume") return channel.volume;
  if (target.kind === "pan") return channel.pan;
  const fx = channelEffects.find((e) => e.id === target.effectId);
  return fx?.params[target.paramKey] ?? 0;
}

/** All targets a channel's automation dropdown can offer: its own
 * volume/pan, plus one entry per param of each of its active effects. */
export function automationTargetOptions(
  channelEffects: EffectInstance[]
): { target: AutomationTarget; label: string }[] {
  const options: { target: AutomationTarget; label: string }[] = [
    { target: { kind: "volume" }, label: "Volume" },
    { target: { kind: "pan" }, label: "Pan" },
  ];
  channelEffects.forEach((fx) => {
    automatableParamSpecs(fx).forEach((spec) => {
      options.push({
        target: { kind: "effect", effectId: fx.id, paramKey: spec.key },
        label: `${EFFECT_LABELS[fx.type]}: ${spec.label}`,
      });
    });
  });
  return options;
}
