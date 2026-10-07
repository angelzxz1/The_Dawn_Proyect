"use client";

import { useEffect, useRef, useState } from "react";
import { PluginKnob, type KnobMode } from "@/effects/ui/PluginKnob";
import { PluginToggle, PluginWindow } from "@/effects/ui/PluginChrome";
import { Segmented } from "@/effects/ui/PluginSegmented";
import { audioEngine } from "@/lib/audioEngine";
import { paramSpecs } from "@/effects/registry";
import type { UtilityMeters } from "./utility";
import { UTILITY_CHANNEL_LABELS, UTILITY_CHANNEL_MODES } from "./utilityModel";

interface UtilityWindowProps {
  hostId: string;
  effectId: string;
  channelName: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

export const utilitySpec = (key: string) => paramSpecs("utility").find((s) => s.key === key)!;
export const utilityValue = (params: Record<string, number>, key: string) => params[key] ?? utilitySpec(key).default;

export const UTILITY_KNOBS: { key: string; mode: KnobMode }[] = [
  { key: "gain", mode: "linear" },
  { key: "width", mode: "linear" },
  { key: "balance", mode: "bipolar" },
];

/** The on/off settings, as toggles. */
export const UTILITY_TOGGLES: { key: string; label: string; title: string; danger?: boolean }[] = [
  { key: "mono", label: "Mono", title: "Sum to mono (width 0%)" },
  { key: "bassMono", label: "Bass Mono", title: "Make everything below the Bass Mono frequency mono" },
  { key: "invertL", label: "Ø L", title: "Invert the left channel's polarity" },
  { key: "invertR", label: "Ø R", title: "Invert the right channel's polarity" },
  { key: "dcFilter", label: "DC", title: "Remove DC offset" },
  { key: "mute", label: "Mute", title: "Silence the output", danger: true },
];

/** Reads the Utility's meters ~30 times a second. */
function useUtilityMeters(hostId: string, effectId: string): UtilityMeters | null {
  const [meters, setMeters] = useState<UtilityMeters | null>(null);
  useEffect(() => {
    const t = setInterval(() => setMeters(audioEngine.getUtilityMeters(hostId, effectId)), 33);
    return () => clearInterval(t);
  }, [hostId, effectId]);
  return meters;
}

/** Output level bar, -60..0 dBFS. */
function LevelBar({ label, db }: { label: string; db: number }) {
  const t = Math.max(0, Math.min(1, (db + 60) / 60));
  const color = db > -0.5 ? "#FF6B6B" : db > -6 ? "#E6AD5E" : "#6BD68B";
  return (
    <div className="flex items-center gap-2">
      <span className="w-3 text-[10px] font-bold text-muted">{label}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full" style={{ background: "#23242B" }}>
        <div className="h-full" style={{ width: `${t * 100}%`, background: color }} />
      </div>
      <span className="w-14 text-right font-mono text-[10.5px] text-muted">{Number.isFinite(db) && db > -100 ? `${db.toFixed(1)}` : "-∞"}</span>
    </div>
  );
}

/** A vectorscope: recent samples plotted mid-up, side-across, so mono is a
 * vertical line, wide stereo a cloud, and out-of-phase audio lies flat. */
function Vectorscope({ points, size }: { points: Float32Array | null; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);
    const c = size / 2;
    ctx.strokeStyle = "#23242B";
    ctx.beginPath();
    ctx.moveTo(c, 0);
    ctx.lineTo(c, size);
    ctx.moveTo(0, c);
    ctx.lineTo(size, c);
    ctx.moveTo(0, 0);
    ctx.lineTo(size, size);
    ctx.moveTo(size, 0);
    ctx.lineTo(0, size);
    ctx.stroke();
    if (!points) return;
    let peak = 0.05;
    for (let i = 0; i < points.length; i++) peak = Math.max(peak, Math.abs(points[i]));
    const scale = (c - 6) / Math.min(1, peak * 1.2);
    ctx.fillStyle = "rgba(94,177,255,0.55)";
    for (let i = 0; i < points.length; i += 2) {
      const l = points[i];
      const r = points[i + 1];
      const x = c + ((l - r) / Math.SQRT2) * scale;
      const y = c - ((l + r) / Math.SQRT2) * scale;
      ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
    }
  }, [points, size]);
  return <canvas ref={ref} style={{ width: size, height: size, background: "#101115", borderRadius: 8 }} aria-label="Vectorscope" />;
}

/** The full Utility window: gain/width/balance, the channel and polarity
 * settings, bass mono, and output meters with correlation and a scope. */
export function UtilityWindow({ hostId, effectId, channelName, params, bypass, onBypassToggle, onClose, onParamChange, onParamDragStart }: UtilityWindowProps) {
  const meters = useUtilityMeters(hostId, effectId);
  const value = (key: string) => utilityValue(params, key);
  const toggle = (key: string) => {
    onParamDragStart?.();
    onParamChange(key, value(key) >= 0.5 ? 0 : 1);
  };
  const correlation = meters?.correlation ?? 0;

  return (
    <PluginWindow title="Utility" channelName={channelName} bypass={bypass} onBypassToggle={onBypassToggle} onClose={onClose} width={760}>
      <div className="flex gap-4">
        <div className="flex flex-1 flex-col gap-4 rounded-xl p-4" style={{ background: "#14151A", border: "1px solid #2E2F37" }}>
          <div className="flex justify-around">
            {UTILITY_KNOBS.map(({ key, mode }) => {
              const s = utilitySpec(key);
              return (
                <PluginKnob
                  key={key}
                  label={s.label}
                  value={value(key)}
                  min={s.min}
                  max={s.max}
                  defaultValue={s.default}
                  mode={mode}
                  size={58}
                  showReadout
                  disabled={key === "width" && value("mono") >= 0.5}
                  onChange={(v) => onParamChange(key, v)}
                  onDragStart={onParamDragStart}
                  formatValue={s.format}
                />
              );
            })}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted">Channel</span>
            <Segmented
              label="Channel"
              options={UTILITY_CHANNEL_MODES.map((m, i) => ({ value: i, label: UTILITY_CHANNEL_LABELS[m] }))}
              value={Math.round(value("channel"))}
              onSelect={(v) => {
                onParamDragStart?.();
                onParamChange("channel", v);
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {UTILITY_TOGGLES.map((t) => (
              <PluginToggle key={t.key} label={t.label} title={t.title} danger={t.danger} active={value(t.key) >= 0.5} onClick={() => toggle(t.key)} />
            ))}
          </div>
          <div className={value("bassMono") >= 0.5 ? "" : "opacity-40"}>
            <PluginKnob
              label="Bass Mono below"
              value={value("bassFreq")}
              min={50}
              max={500}
              defaultValue={120}
              mode="log"
              size={34}
              layout="inline"
              showReadout
              disabled={value("bassMono") < 0.5}
              onChange={(v) => onParamChange("bassFreq", v)}
              onDragStart={onParamDragStart}
              formatValue={utilitySpec("bassFreq").format}
            />
          </div>
        </div>

        <div className="flex w-[230px] flex-col gap-3 rounded-xl p-4" style={{ background: "#14151A", border: "1px solid #2E2F37" }}>
          <Vectorscope points={meters?.points ?? null} size={196} />
          <LevelBar label="L" db={meters?.peakL ?? -Infinity} />
          <LevelBar label="R" db={meters?.peakR ?? -Infinity} />
          <div className="flex flex-col gap-1" title="How alike left and right are: +1 mono, 0 unrelated, -1 out of phase (it would cancel in mono)">
            <div className="flex justify-between text-[10px] font-bold uppercase tracking-wide text-muted">
              <span>-1</span>
              <span>Correlation</span>
              <span>+1</span>
            </div>
            <div className="relative h-2 rounded-full" style={{ background: "#23242B" }}>
              <div className="absolute top-0 h-full w-px" style={{ left: "50%", background: "#5A5B64" }} />
              {meters && (
                <div
                  className="absolute top-[-3px] h-[14px] w-1 rounded-full"
                  style={{ left: `calc(${((correlation + 1) / 2) * 100}% - 2px)`, background: correlation < 0 ? "#FF6B6B" : "#6BD68B" }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </PluginWindow>
  );
}
