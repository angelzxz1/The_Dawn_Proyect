"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Headphones, Power, Trash2, X } from "lucide-react";
import { PluginKnob, type KnobMode } from "@/effects/ui/PluginKnob";
import { PluginIcon } from "@/effects/ui/PluginIcon";
import { Segmented } from "@/effects/ui/PluginSegmented";
import { MultibandGraph, mbBandColor } from "./MultibandGraph";
import { formatHz } from "@/effects/parametric-eq/ParamEqGraph";
import { audioEngine } from "@/lib/audioEngine";
import type { MultibandMeters } from "./multiband";
import { paramSpecs, type ParamSpec } from "@/effects/registry";
import {
  MB_MAX_BANDS,
  MB_MAX_FREQ,
  MB_MIN_FREQ,
  MB_MODES,
  MB_MODE_LABELS,
  mbBandCount,
  mbBandFromParams,
  mbCrossovers,
  mbKey,
  mbRemoveChanges,
  mbSplitChanges,
  mbStaticGain,
  type MbBand,
  type MbBandField,
} from "./multibandModel";
import { SidechainPanel, type SidechainSource } from "@/effects/sidechain/SidechainPanel";
import type { SidechainRouting } from "@/effects/sidechain/sidechainModel";
import { fraunces, spaceGrotesk } from "@/effects/ui/pluginFonts";
import { WindowPresetMenu } from "@/effects/ui/PresetMenu";

interface MultibandWindowProps {
  hostId: string;
  effectId: string;
  channelName: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
  /** The key input's routing, and the tracks/buses it could come from. */
  sidechain?: SidechainRouting;
  sidechainSources: SidechainSource[];
  onSidechainChange: (routing: SidechainRouting) => void;
}

const GRAPH_W = 1000;
const GRAPH_H = 340;

function spec(key: string): ParamSpec {
  return paramSpecs("multiband").find((s) => s.key === key)!;
}

/** The effect's live meters, re-read ~30 times a second. Levels fall
 * back gradually (~45 dB/s) so they're readable between peaks. */
function useMeters(hostId: string, effectId: string): MultibandMeters | null {
  const [meters, setMeters] = useState<MultibandMeters | null>(null);
  useEffect(() => {
    let frame: number;
    let last = 0;
    let held: number[] = [];
    const tick = (now: number) => {
      if (now - last > 33) {
        last = now;
        const m = audioEngine.getMultibandMeters(hostId, effectId);
        if (m) held = m.levelDb.map((v, b) => Math.max(v, (held[b] ?? -Infinity) - 1.5));
        setMeters(m && { gainDb: m.gainDb, levelDb: held });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hostId, effectId]);
  return meters;
}

/** A band's gain meter: how far its dynamics are moving it right now
 * (left for cut, right for boost). */
function GainMeter({ gainDb, color }: { gainDb: number; color: string }) {
  const w = Math.min(1, Math.abs(gainDb) / 24) * 50;
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full" style={{ background: "#23242B" }}>
      <div className="absolute top-0 h-full" style={{ left: gainDb < 0 ? `${50 - w}%` : "50%", width: `${w}%`, background: color }} />
      <div className="absolute top-0 h-full w-px" style={{ left: "50%", background: "#5A5B64" }} />
    </div>
  );
}

const T_MIN = -60;
const T_SIZE = 116;

/** The selected band's transfer curve (input level -> output level, before
 * makeup) with a dot at its live level. */
function TransferCurve({ band, color, levelDb, gainDb }: { band: MbBand; color: string; levelDb: number; gainDb: number }) {
  const pos = (db: number) => ((db - T_MIN) / -T_MIN) * T_SIZE;
  const d = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 60; i++) {
      const x = T_MIN + i;
      const y = Math.max(T_MIN, Math.min(0, x + mbStaticGain(x, band)));
      pts.push(`${pos(x).toFixed(1)},${(T_SIZE - pos(y)).toFixed(1)}`);
    }
    return `M${pts.join(" L")}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band.thresh, band.ratio, band.knee, band.mode, band.range]);
  const live = levelDb > T_MIN && Number.isFinite(levelDb);
  const outDb = Math.max(T_MIN, Math.min(0, levelDb + gainDb));
  return (
    <svg width={T_SIZE} height={T_SIZE} viewBox={`0 0 ${T_SIZE} ${T_SIZE}`} style={{ background: "#101115", borderRadius: 8, flexShrink: 0 }} aria-label="Transfer curve">
      {[-48, -36, -24, -12].map((db) => (
        <g key={db}>
          <line x1={pos(db)} y1={0} x2={pos(db)} y2={T_SIZE} stroke="#1D1E24" />
          <line x1={0} y1={T_SIZE - pos(db)} x2={T_SIZE} y2={T_SIZE - pos(db)} stroke="#1D1E24" />
        </g>
      ))}
      <line x1={0} y1={T_SIZE} x2={T_SIZE} y2={0} stroke="#2A2B33" strokeDasharray="3 3" />
      <line x1={pos(band.thresh)} y1={0} x2={pos(band.thresh)} y2={T_SIZE} stroke={color} strokeOpacity={0.35} />
      <path d={d} stroke={color} strokeWidth={2} fill="none" />
      {live && <circle cx={pos(Math.min(0, levelDb))} cy={T_SIZE - pos(outDb)} r={3.5} fill="#F4EDE2" />}
    </svg>
  );
}

const KNOBS: { field: MbBandField; label: string; mode: KnobMode }[] = [
  { field: "Thresh", label: "Threshold", mode: "linear" },
  { field: "Ratio", label: "Ratio", mode: "log" },
  { field: "Attack", label: "Attack", mode: "log" },
  { field: "Release", label: "Release", mode: "log" },
  { field: "Knee", label: "Knee", mode: "linear" },
  { field: "Range", label: "Range", mode: "linear" },
  { field: "Gain", label: "Gain", mode: "bipolar" },
];

/** The Multiband Compressor window: the band graph, a strip of bands with
 * live gain meters, the selected band's controls, and mix/output/view
 * settings. */
export function MultibandWindow({
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
}: MultibandWindowProps) {
  const count = mbBandCount(params);
  const crossovers = mbCrossovers(params);
  const [selectedRaw, setSelected] = useState(0);
  const selected = Math.min(selectedRaw, count - 1);
  const [solo, setSolo] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const meters = useMeters(hostId, effectId);
  const band = mbBandFromParams(params, selected);
  const edges = [MB_MIN_FREQ, ...crossovers, MB_MAX_FREQ];

  useEffect(() => rootRef.current?.focus(), []);

  // Solo follows the selected band, and never outlives the window.
  useEffect(() => {
    audioEngine.setBandSolo(hostId, effectId, solo ? selected : -1);
  }, [hostId, effectId, solo, selected]);
  useEffect(() => () => audioEngine.setBandSolo(hostId, effectId, -1), [hostId, effectId]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2200);
    return () => clearTimeout(t);
  }, [notice]);

  const set = (b: number, field: MbBandField, value: number) => onParamChange(mbKey(b, field), value);
  const applyAll = (changes: Record<string, number>) => {
    onParamDragStart?.();
    for (const [key, value] of Object.entries(changes)) onParamChange(key, value);
  };

  const split = (freq: number) => {
    const changes = mbSplitChanges(params, freq);
    if (!changes) {
      setNotice(count >= MB_MAX_BANDS ? `${MB_MAX_BANDS} bands is the most` : "Too close to a crossover to split there");
      return;
    }
    applyAll(changes);
    const xs = Object.keys(changes)
      .filter((k) => /^x\d+$/.test(k))
      .map((k) => changes[k]);
    setSelected(xs.indexOf(Math.round(freq)) + 1);
  };

  const removeBand = (b: number) => {
    const changes = mbRemoveChanges(params, b);
    if (!changes) return;
    applyAll(changes);
    setSelected(Math.max(0, b - 1));
    setSolo(false);
  };

  const toggleBypass = (b: number) => {
    onParamDragStart?.();
    set(b, "Bypass", mbBandFromParams(params, b).bypass >= 0.5 ? 0 : 1);
  };

  const color = mbBandColor(selected);
  const mode = MB_MODES[Math.round(band.mode)] ?? "compress";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={rootRef}
        tabIndex={-1}
        onKeyDown={(e) => {
          if ((e.key === "Delete" || e.key === "Backspace") && count > 1) {
            e.preventDefault();
            e.stopPropagation();
            removeBand(selected);
          }
        }}
        className={`${spaceGrotesk.className} flex w-[1060px] max-w-full flex-col gap-3 rounded-2xl shadow-2xl outline-none`}
        style={{ background: "#1B1C22", border: "1px solid #2E2F37", padding: "18px 22px 18px" }}
      >
        <div className="flex h-[30px] items-center justify-between">
          <div className="flex items-center gap-2">
            <PluginIcon />
            <h2 className={`${fraunces.className} text-[19px] font-semibold text-[#F4EDE2]`} style={{ letterSpacing: "-0.2px" }}>
              Multiband Compressor
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
            <button type="button" title="Close" onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center rounded-lg">
              <X size={14} color="#9A9AA4" />
            </button>
          </div>
        </div>

        <div className="relative" style={{ border: "1px solid #2E2F37", borderRadius: 10, overflow: "hidden" }}>
          <MultibandGraph
            params={params}
            width={GRAPH_W}
            height={GRAPH_H}
            hostId={hostId}
            effectId={effectId}
            selected={selected}
            onSelect={setSelected}
            onCrossoverChange={(k, freq) => onParamChange(`x${k + 1}`, freq)}
            onBandGainChange={(b, gain) => set(b, "Gain", gain)}
            onThresholdNudge={(b, delta) => {
              const t = mbBandFromParams(params, b).thresh + delta;
              set(b, "Thresh", Math.round(Math.max(-60, Math.min(0, t)) * 10) / 10);
            }}
            onSplit={split}
            onRemoveCrossover={(k) => removeBand(k + 1)}
            onToggleBypass={toggleBypass}
            onGestureStart={onParamDragStart}
          />
          {notice && (
            <div className="pointer-events-none absolute left-1/2 top-9 -translate-x-1/2 rounded-md px-3 py-1 text-[12px] text-[#F4EDE2]" style={{ background: "#2E2F37" }}>
              {notice}
            </div>
          )}
        </div>

        {/* Bands */}
        <div className="flex gap-1.5" role="tablist" aria-label="Bands">
          {Array.from({ length: count }, (_, b) => {
            const bb = mbBandFromParams(params, b);
            const gain = meters?.gainDb[b] ?? 0;
            return (
              <button
                key={b}
                type="button"
                role="tab"
                aria-selected={selected === b}
                onClick={() => setSelected(b)}
                className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg px-2.5 py-2 text-left"
                style={{
                  background: selected === b ? "#23242B" : "transparent",
                  border: `1px solid ${selected === b ? mbBandColor(b) : "#2E2F37"}`,
                  opacity: bb.bypass >= 0.5 ? 0.5 : 1,
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9.5px] font-bold" style={{ background: mbBandColor(b), color: "#101115" }}>
                    {b + 1}
                  </span>
                  <span className="truncate font-mono text-[10.5px] text-muted">
                    {formatHz(edges[b]).replace(" ", "")}–{formatHz(edges[b + 1]).replace(" ", "")}
                  </span>
                  <span className="ml-auto font-mono text-[10.5px]" style={{ color: Math.abs(gain) >= 0.1 ? "#F4EDE2" : "#5A5B64" }}>
                    {gain > 0.05 ? "+" : ""}
                    {gain.toFixed(1)}
                  </span>
                </div>
                <GainMeter gainDb={gain} color={mbBandColor(b)} />
              </button>
            );
          })}
        </div>

        {/* Selected band */}
        <div className="flex items-center gap-4 rounded-xl px-4 py-3" style={{ background: "#14151A", border: "1px solid #2E2F37" }}>
          <div className="flex shrink-0 flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: color, color: "#101115" }}>
                {selected + 1}
              </span>
              <span className="font-mono text-[12px] text-[#F4EDE2]">
                {formatHz(edges[selected])} – {formatHz(edges[selected + 1])}
              </span>
            </div>
            <Segmented
              label="Band mode"
              options={MB_MODES.map((m, i) => ({ value: i, label: MB_MODE_LABELS[m] }))}
              value={Math.round(band.mode)}
              onSelect={(v) => {
                onParamDragStart?.();
                set(selected, "Mode", v);
              }}
            />
            <p className="w-[250px] text-[11px] leading-snug text-muted">
              {mode === "compress"
                ? "Turns this band down when it goes above the threshold."
                : mode === "expand"
                  ? "Turns this band down when it falls below the threshold."
                  : "Brings this band up when it falls below the threshold."}
            </p>
          </div>

          <TransferCurve band={band} color={color} levelDb={meters?.levelDb[selected] ?? -Infinity} gainDb={meters?.gainDb[selected] ?? 0} />

          <div className="flex flex-1 justify-around">
            {KNOBS.map(({ field, label, mode: knobMode }) => {
              const s = spec(mbKey(selected, field));
              return (
                <PluginKnob
                  key={field}
                  label={label}
                  value={params[s.key] ?? s.default}
                  min={s.min}
                  max={s.max}
                  defaultValue={s.default}
                  mode={knobMode}
                  size={44}
                  showReadout
                  onChange={(v) => onParamChange(s.key, v)}
                  onDragStart={onParamDragStart}
                  formatValue={s.format}
                />
              );
            })}
          </div>

          <div className="flex shrink-0 flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setSolo((v) => !v)}
              aria-pressed={solo}
              title="Solo - hear only this band"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
              style={solo ? { background: "rgba(230,173,94,0.18)", color: "#E6AD5E", border: "1px solid #E6AD5E" } : { color: "#9A9AA4", border: "1px solid #2E2F37" }}
            >
              <Headphones size={12} /> Solo
            </button>
            <button
              type="button"
              onClick={() => toggleBypass(selected)}
              aria-pressed={band.bypass >= 0.5}
              title="Bypass this band (Alt-click its handle)"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
              style={{ color: band.bypass >= 0.5 ? "#5A5B64" : "#E6AD5E", border: "1px solid #2E2F37" }}
            >
              <Power size={12} /> {band.bypass >= 0.5 ? "Off" : "On"}
            </button>
            <button
              type="button"
              onClick={() => removeBand(selected)}
              disabled={count <= 1}
              title="Remove this band - its neighbour takes over its range (Delete key)"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide disabled:opacity-40"
              style={{ color: "#FF7A7A", border: "1px solid #2E2F37" }}
            >
              <Trash2 size={12} /> Remove
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {(["mix", "output"] as const).map((key) => {
            const s = spec(key);
            return (
              <PluginKnob
                key={key}
                label={s.label}
                value={params[key] ?? s.default}
                min={s.min}
                max={s.max}
                defaultValue={s.default}
                mode={key === "output" ? "bipolar" : "linear"}
                size={36}
                layout="inline"
                showReadout
                onChange={(v) => onParamChange(key, v)}
                onDragStart={onParamDragStart}
                formatValue={s.format}
              />
            );
          })}
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted">Analyzer</span>
          <Segmented
            label="Analyzer"
            options={[
              { value: 0, label: "Off" },
              { value: 1, label: "Post" },
              { value: 2, label: "Pre + Post" },
            ]}
            value={Math.round(params.analyzer ?? 2)}
            onSelect={(v) => onParamChange("analyzer", v)}
          />
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted">Range</span>
          <Segmented
            label="Display range"
            options={[6, 12, 24, 48].map((v) => ({ value: v, label: `±${v}` }))}
            value={Math.round(params.scale ?? 24)}
            onSelect={(v) => onParamChange("scale", v)}
          />
          <span className="ml-auto text-right text-[11px] leading-snug text-muted" title="Double-click the graph to split a band there. Drag a crossover to move it; right-click or double-click it to remove it. Drag a band's handle for its gain, scroll over a band for its threshold, Alt-click a handle to bypass the band.">
            Double-click to split · right-click a crossover to remove
            <br />
            scroll over a band for its threshold · {count}/{MB_MAX_BANDS} bands
          </span>
        </div>

        <SidechainPanel
          type="multiband"
          hostId={hostId}
          effectId={effectId}
          params={params}
          routing={sidechain}
          sources={sidechainSources}
          onRoutingChange={onSidechainChange}
          onParamChange={onParamChange}
          onParamDragStart={onParamDragStart}
        />
      </div>
    </div>
  );
}
