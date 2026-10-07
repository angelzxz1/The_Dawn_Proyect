"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { PluginKnob, type KnobMode } from "@/effects/ui/PluginKnob";
import { PluginToggle, PluginWindow } from "@/effects/ui/PluginChrome";
import { SidechainPanel, type SidechainSource } from "@/effects/sidechain/SidechainPanel";
import { audioEngine } from "@/lib/audioEngine";
import { paramSpecs, type ParamSpec } from "@/effects/registry";
import type { SidechainRouting } from "@/effects/sidechain/sidechainModel";

export function glueSpec(key: string): ParamSpec {
  return paramSpecs("glue").find((s) => s.key === key)!;
}

export function glueValue(params: Record<string, number>, key: string): number {
  return params[key] ?? glueSpec(key).default;
}

/** Ratio, Attack and Release move in steps, like the hardware's switches. */
export const GLUE_STEPPED = new Set(["ratio", "attack", "release"]);

export const GLUE_KNOBS: { key: string; mode: KnobMode }[] = [
  { key: "threshold", mode: "linear" },
  { key: "ratio", mode: "linear" },
  { key: "attack", mode: "linear" },
  { key: "release", mode: "linear" },
];

/** Gain reduction (dB) the needle spans. */
const NEEDLE_MAX = 20;
const TICKS = [0, 1, 2, 4, 6, 10, 15, 20];
/** Rest (0 dB) at the right, full reduction at the left; spread so small
 * amounts are readable, like a real GR meter. */
const needleAngle = (gr: number) => 50 - 100 * Math.sqrt(Math.max(0, Math.min(NEEDLE_MAX, gr)) / NEEDLE_MAX);
const LED = { off: "#2A2B33", soft: "#E6C04E", over: "#FF5A5A" };

/** The needle gain-reduction meter and the Clip LED. The needle is moved
 * directly each frame, with meter-like ballistics. */
export function GlueNeedle({ hostId, effectId, width = 300 }: { hostId?: string; effectId: string; width?: number }) {
  const needle = useRef<SVGGElement>(null);
  const led = useRef<SVGCircleElement>(null);
  const readout = useRef<SVGTextElement>(null);
  useEffect(() => {
    let frame = 0;
    let shown = 0;
    const tick = () => {
      const m = hostId ? audioEngine.getGlueMeters(hostId, effectId) : null;
      const target = m?.gainReduction ?? 0;
      shown += (target - shown) * (target > shown ? 0.35 : 0.12);
      needle.current?.setAttribute("transform", `rotate(${needleAngle(shown).toFixed(2)})`);
      led.current?.setAttribute("fill", LED[m?.clip ?? "off"]);
      if (readout.current) readout.current.textContent = shown > 0.05 ? `-${shown.toFixed(1)} dB` : "0.0 dB";
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hostId, effectId]);

  const compact = width < 200;
  const h = width * 0.56;
  const cx = width / 2;
  const cy = h * 0.92;
  const r = width * 0.4;
  const at = (deg: number, radius: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: cx + radius * Math.sin(a), y: cy - radius * Math.cos(a) };
  };
  return (
    <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} role="img" aria-label="Gain reduction" style={{ display: "block", background: "#E9E1D2", borderRadius: 10 }}>
      <path d={`M${at(-50, r).x},${at(-50, r).y} A${r},${r} 0 0 1 ${at(50, r).x},${at(50, r).y}`} stroke="#3A3530" strokeWidth={1.5} fill="none" />
      {TICKS.map((t) => {
        const a = needleAngle(t);
        const p1 = at(a, r);
        const p2 = at(a, r + (t % 2 === 0 || t === 15 || t === 1 ? 9 : 6));
        const label = at(a, r + 20);
        return (
          <g key={t}>
            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#3A3530" strokeWidth={1.4} />
            {!compact && (
              <text x={label.x} y={label.y + 4} fill="#3A3530" fontSize={11} fontFamily="monospace" textAnchor="middle">
                {t}
              </text>
            )}
          </g>
        );
      })}
      {!compact && (
        <text x={cx} y={cy - r * 0.42} fill="#6B6358" fontSize={10} fontFamily="monospace" textAnchor="middle" letterSpacing={1}>
          GAIN REDUCTION dB
        </text>
      )}
      <text ref={readout} x={cx} y={compact ? cy - r * 0.35 : cy - r * 0.2} fill="#3A3530" fontSize={compact ? 9 : 13} fontWeight={700} fontFamily="monospace" textAnchor="middle">
        0.0 dB
      </text>
      <g transform={`translate(${cx},${cy})`}>
        <g ref={needle} transform={`rotate(${needleAngle(0)})`}>
          <line x1={0} y1={0} x2={0} y2={-r * 1.05} stroke="#C8422F" strokeWidth={2} strokeLinecap="round" />
        </g>
        <circle r={compact ? 3 : 6} fill="#3A3530" />
      </g>
      <g>
        <circle ref={led} cx={width - (compact ? 8 : 22)} cy={compact ? 8 : 20} r={compact ? 3.5 : 6} fill={LED.off} stroke="#3A3530" strokeWidth={1} />
        {!compact && (
          <text x={width - 36} y={24} fill="#3A3530" fontSize={10} fontFamily="monospace" textAnchor="end">
            CLIP
          </text>
        )}
      </g>
    </svg>
  );
}

/** The full Glue Compressor window: Threshold/Ratio/Attack/Release on the
 * left, the needle meter, Makeup and Dry/Wet on the right, Range, Soft
 * Clip and Oversampling below, and the sidechain section, unfolded from
 * its button. */
export function GlueWindow({
  hostId,
  effectId,
  channelName,
  params,
  bypass,
  onBypassToggle,
  onClose,
  onParamChange,
  onParamDragStart,
  sidechain,
  sidechainSources,
  onSidechainChange,
}: {
  hostId: string;
  effectId: string;
  channelName: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
  sidechain?: SidechainRouting;
  sidechainSources: SidechainSource[];
  onSidechainChange: (routing: SidechainRouting) => void;
}) {
  const [showSidechain, setShowSidechain] = useState(!!sidechain?.on);
  const value = (key: string) => glueValue(params, key);
  const set = (key: string, v: number) => onParamChange(key, GLUE_STEPPED.has(key) ? Math.round(v) : v);
  const toggle = (key: string) => {
    onParamDragStart?.();
    onParamChange(key, value(key) >= 0.5 ? 0 : 1);
  };
  const knob = (key: string, mode: KnobMode, size = 56) => {
    const spec = glueSpec(key);
    return (
      <PluginKnob
        key={key}
        label={spec.label}
        value={value(key)}
        min={spec.min}
        max={spec.max}
        defaultValue={spec.default}
        mode={mode}
        size={size}
        showReadout
        onChange={(v) => set(key, v)}
        onDragStart={onParamDragStart}
        formatValue={spec.format}
      />
    );
  };
  const range = glueSpec("range");

  return (
    <PluginWindow title="Glue Compressor" channelName={channelName} bypass={bypass} onBypassToggle={onBypassToggle} onClose={onClose} width={900}>
      <div className="flex items-center gap-5">
        <div className="grid grid-cols-2 gap-x-3 gap-y-4">{GLUE_KNOBS.map(({ key, mode }) => knob(key, mode))}</div>
        <div className="flex flex-1 justify-center">
          <GlueNeedle hostId={hostId} effectId={effectId} width={320} />
        </div>
        <div className="flex flex-col gap-4">
          {knob("makeup", "linear")}
          {knob("dryWet", "linear")}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-xl px-3.5 py-2.5" style={{ background: "#16171C", border: "1px solid #2A2B33" }}>
        <label className="flex flex-1 items-center gap-3 text-[11px] font-bold uppercase tracking-wide text-[#8A8A94]">
          Range
          <input
            type="range"
            min={range.min}
            max={range.max}
            step={0.5}
            value={value("range")}
            onPointerDown={onParamDragStart}
            onChange={(e) => onParamChange("range", Number(e.target.value))}
            onDoubleClick={() => onParamChange("range", range.default)}
            aria-label="Range"
            className="flex-1 accent-[#E6AD5E]"
          />
          <span className="w-16 text-right font-mono text-[12px] normal-case tracking-normal text-[#F4EDE2]">{range.format(value("range"))}</span>
        </label>
        <PluginToggle label="Soft Clip" active={value("softClip") >= 0.5} onClick={() => toggle("softClip")} title="A fixed waveshaper on the output - it never goes past -0.5 dB, and colors loud peaks" />
        <PluginToggle label="Oversampling" active={value("oversample") >= 0.5} onClick={() => toggle("oversample")} title="Process at twice the sample rate - less aliasing and transient harshness, 15 samples of latency" />
        <button
          type="button"
          onClick={() => setShowSidechain((v) => !v)}
          aria-expanded={showSidechain}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-[#9A9AA4] hover:text-[#F4EDE2]"
          style={{ border: `1px solid ${sidechain?.on ? "#E6AD5E" : "#2E2F37"}` }}
        >
          {showSidechain ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Sidechain
        </button>
      </div>

      {showSidechain && (
        <SidechainPanel
          type="glue"
          hostId={hostId}
          effectId={effectId}
          params={params}
          routing={sidechain}
          sources={sidechainSources}
          onRoutingChange={onSidechainChange}
          onParamChange={onParamChange}
          onParamDragStart={onParamDragStart}
        />
      )}

      <p className="text-[12px] leading-snug text-muted">
        Range -60 to -70 dB behaves like the original hardware; -15 to -40 dB is a gentler alternative to Dry/Wet. Set Makeup near where the
        needle sits to get back to the level you started with. Release A adapts to the material.
      </p>
    </PluginWindow>
  );
}
