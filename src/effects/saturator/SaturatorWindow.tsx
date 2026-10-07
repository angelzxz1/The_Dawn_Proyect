"use client";

import { Power, X } from "lucide-react";
import { PluginKnob, type KnobMode } from "@/effects/ui/PluginKnob";
import { PluginIcon } from "@/effects/ui/PluginIcon";
import { SaturatorGraph } from "./SaturatorGraph";
import { paramSpecs, type ParamSpec } from "@/effects/registry";
import {
  COLOR_MODES,
  COLOR_MODE_LABELS,
  DISTORTION_SHAPES,
  OVERSAMPLE_OPTIONS,
  SHAPE_ORDER,
  colorSettingsFromParams,
  distortionShapeFromParam,
  oversampleFromParam,
  type DistortionShape,
} from "./saturatorModel";
import { Segmented } from "@/effects/ui/PluginSegmented";
import { PluginToggle } from "@/effects/ui/PluginChrome";
import { ColorEqGraph } from "./SaturatorGraph";
import { fraunces, spaceGrotesk } from "@/effects/ui/pluginFonts";
import { WindowPresetMenu } from "@/effects/ui/PresetMenu";

interface SaturatorWindowProps {
  channelName: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

export const DISTORTION_KNOBS: { key: string; mode: KnobMode }[] = [
  { key: "distortion", mode: "linear" },
  { key: "bias", mode: "linear" },
  { key: "tone", mode: "log" },
  { key: "output", mode: "bipolar" },
  { key: "wet", mode: "linear" },
];

export function saturatorSpec(key: string): ParamSpec {
  return paramSpecs("distortion").find((s) => s.key === key)!;
}

export function saturatorParam(params: Record<string, number>, key: string): number {
  return params[key] ?? saturatorSpec(key).default;
}

const SHAPE_SHORT: Record<DistortionShape, string> = {
  analog: "Analog",
  softSine: "Soft Sine",
  medium: "Medium",
  hard: "Hard",
  digital: "Digital",
  fold: "Fold",
};

const SHAPE_HINTS: Record<DistortionShape, string> = {
  analog: "Analog Clip: smooth and warm - rounds peaks off gradually, like tape or a tube stage.",
  softSine: "Soft Sine: gentle and clean, then flat at full scale. Good for subtle glue.",
  medium: "Medium Curve: the softest knee - saturates early and gently, for fattening without edge.",
  hard: "Hard Curve: clean until near full scale, then a firm knee. Punchy crunch.",
  digital: "Digital Clip: a hard ceiling - bright, buzzy and aggressive.",
  fold: "Sinoid Fold: past full scale the wave folds back, adding bright, metallic overtones.",
};

const COLOR_KNOBS: { key: string; label: string; mode: KnobMode }[] = [
  { key: "colorBase", label: "Base", mode: "bipolar" },
  { key: "colorFreq", label: "Freq", mode: "log" },
  { key: "colorQ", label: "Width", mode: "log" },
  { key: "colorDepth", label: "Depth", mode: "bipolar" },
];

const COLOR_MODE_HINTS = {
  pre: "Pre: shapes what gets saturated, and the tone.",
  post: "Post: shapes the tone after saturation.",
  emphasis: "Emphasis: boosts before and cuts the same after - only what saturates changes, not the tone.",
} as const;

/** The full Saturator window - the transfer curve and in/out waveform,
 * the curve picker, Drive/Bias/Tone/Output/Dry-Wet, oversampling and Soft
 * Clip, and the Color EQ (pre, post or emphasis) with its response -
 * opened from the compact FX rack card's expand button. */
export function SaturatorWindow({
  channelName,
  params,
  bypass,
  onBypassToggle,
  onClose,
  onParamChange,
  onParamDragStart,
}: SaturatorWindowProps) {
  const value = (key: string) => saturatorParam(params, key);
  const shape = distortionShapeFromParam(value("shape"));
  const oversample = oversampleFromParam(value("oversample"));
  const color = colorSettingsFromParams(params);
  const toggle = (key: string) => pick(key, value(key) >= 0.5 ? 0 : 1);
  const pick = (key: string, index: number) => {
    onParamDragStart?.();
    onParamChange(key, index);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className={`${spaceGrotesk.className} flex w-[880px] flex-col gap-4 rounded-2xl shadow-2xl`}
        style={{ background: "#1B1C22", border: "1px solid #2E2F37", padding: "18px 22px 20px" }}
      >
        <div className="flex h-[30px] items-center justify-between">
          <div className="flex items-center gap-2">
            <PluginIcon />
            <h2 className={`${fraunces.className} text-[19px] font-semibold text-[#F4EDE2]`} style={{ letterSpacing: "-0.2px" }}>
              Saturator
            </h2>
            <span className="text-xs text-muted">— {channelName}</span>
            <div className="ml-3">
              <WindowPresetMenu />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title={bypass ? "Enable effect" : "Bypass effect"}
              onClick={onBypassToggle}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-lg"
              style={{ background: "#23242B", border: "1px solid #2E2F37" }}
            >
              <Power size={16} color={bypass ? "#5A5B64" : "#E6AD5E"} />
            </button>
            <button
              type="button"
              title="Close"
              onClick={onClose}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-lg"
            >
              <X size={14} color="#9A9AA4" />
            </button>
          </div>
        </div>

        <SaturatorGraph
          shape={shape}
          drive={value("distortion")}
          bias={value("bias")}
          outputDb={value("output")}
          wet={value("wet")}
          softClip={value("softClip") >= 0.5}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Segmented<DistortionShape>
            label="Curve"
            options={SHAPE_ORDER.map((s) => ({ value: s, label: SHAPE_SHORT[s] }))}
            value={shape}
            onSelect={(s) => pick("shape", DISTORTION_SHAPES.indexOf(s))}
          />
          <Segmented<number>
            label="Oversampling"
            options={OVERSAMPLE_OPTIONS.map((o, i) => ({ value: i, label: o.label }))}
            value={OVERSAMPLE_OPTIONS.findIndex((o) => o.value === oversample)}
            onSelect={(i) => pick("oversample", i)}
          />
          <PluginToggle label="Soft Clip" active={value("softClip") >= 0.5} onClick={() => toggle("softClip")} title="Keep the output under 0 dB with a gentle knee" />
        </div>
        <p className="-mt-2 text-[12px] text-muted">{SHAPE_HINTS[shape]}</p>

        <div className="flex justify-around px-1">
          {DISTORTION_KNOBS.map(({ key, mode }) => {
            const spec = saturatorSpec(key);
            return (
              <PluginKnob
                key={key}
                label={spec.label}
                value={value(key)}
                min={spec.min}
                max={spec.max}
                defaultValue={spec.default}
                mode={mode}
                size={54}
                showReadout
                onChange={(v) => onParamChange(key, v)}
                onDragStart={onParamDragStart}
                formatValue={spec.format}
              />
            );
          })}
        </div>

        <section
          aria-label="Color"
          className="flex items-stretch gap-4 rounded-xl px-3.5 py-3"
          style={{ background: "#16171C", border: "1px solid #2A2B33" }}
        >
          <div className="flex w-[262px] shrink-0 flex-col gap-2">
            <div className="flex items-center gap-2">
              <PluginToggle label="Color" active={color.on} onClick={() => toggle("colorOn")} title="An EQ around the saturation" />
              <Segmented<number>
                label="Color mode"
                options={COLOR_MODES.map((m, i) => ({ value: i, label: COLOR_MODE_LABELS[m] }))}
                value={COLOR_MODES.indexOf(color.mode)}
                onSelect={(i) => pick("colorMode", i)}
              />
            </div>
            <p className="text-[11px] leading-snug text-muted">{COLOR_MODE_HINTS[color.mode]}</p>
          </div>
          <div className={`flex items-center gap-2 ${color.on ? "" : "opacity-45"}`}>
            {COLOR_KNOBS.map(({ key, label, mode }) => {
              const spec = saturatorSpec(key);
              return (
                <PluginKnob
                  key={key}
                  label={label}
                  value={value(key)}
                  min={spec.min}
                  max={spec.max}
                  defaultValue={spec.default}
                  mode={mode}
                  size={38}
                  showReadout
                  onChange={(v) => onParamChange(key, v)}
                  onDragStart={onParamDragStart}
                  formatValue={spec.format}
                />
              );
            })}
          </div>
          <div className="ml-auto self-center">
            <ColorEqGraph color={color} />
          </div>
        </section>
      </div>
    </div>
  );
}
