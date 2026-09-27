"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Headphones, Power, Trash2, X } from "lucide-react";
import { PluginKnob } from "./PluginKnob";
import { PluginIcon } from "./PluginIcon";
import { Segmented } from "./PluginSegmented";
import { ParamEqGraph, eqBandColor } from "./ParamEqGraph";
import { audioEngine } from "@/lib/audioEngine";
import { paramSpecs, type ParamSpec } from "@/lib/effects";
import {
  EQ_PLACEMENTS,
  EQ_PLACEMENT_LABELS,
  EQ_SHAPES,
  EQ_SHAPE_LABELS,
  EQ_SLOPES,
  MAX_EQ_BANDS,
  designEqBand,
  eqBandsFromParams,
  eqSectionsDb,
  shapeUsesGain,
  shapeUsesSlope,
  type EqBand,
  type EqShape,
} from "@/lib/paramEqModel";
import { fraunces, spaceGrotesk } from "@/lib/pluginFonts";

interface ParamEqWindowProps {
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

const GRAPH_W = 1000;
const GRAPH_H = 380;

function spec(key: string): ParamSpec {
  return paramSpecs("paramEq").find((s) => s.key === key)!;
}

/** A tiny drawing of a shape's curve, for the shape buttons. */
function ShapeIcon({ shape, active }: { shape: EqShape; active: boolean }) {
  const d = useMemo(() => {
    const sr = 48000;
    const index = EQ_SHAPES.indexOf(shape);
    const gain = shape === "tiltShelf" ? 12 : 9;
    const q = shape === "notch" || shape === "bandPass" ? 2 : shape === "bell" ? 1.4 : Math.SQRT1_2;
    const sections = designEqBand(index, 1000, gain, q, 24, sr);
    const pts = Array.from({ length: 40 }, (_, i) => {
      const f = 20 * Math.pow(1000, i / 39);
      const db = Math.max(-14, Math.min(14, eqSectionsDb(sections, f, sr)));
      return `${(i * (26 / 39)).toFixed(1)},${(9 - (db / 14) * 7).toFixed(1)}`;
    });
    return `M${pts.join(" L")}`;
  }, [shape]);
  return (
    <svg width={26} height={18} viewBox="0 0 26 18" aria-hidden="true">
      <path d={d} fill="none" stroke={active ? "#F4EDE2" : "#8A8A94"} strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  );
}

/** The Parametric EQ window: the interactive graph, the selected band's
 * controls, and output/analyzer/range settings. */
export function ParamEqWindow({
  hostId,
  effectId,
  channelName,
  params,
  bypass,
  onBypassToggle,
  onClose,
  onParamChange,
  onParamDragStart,
}: ParamEqWindowProps) {
  const bands = useMemo(() => eqBandsFromParams(params), [params]);
  const [selected, setSelected] = useState<number | null>(() => {
    const first = bands.findIndex((b) => b.on !== 0);
    return first === -1 ? null : first;
  });
  const [solo, setSolo] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const band: EqBand | null = selected !== null && bands[selected]?.on ? bands[selected] : null;
  const shape = band ? EQ_SHAPES[band.shape] : null;
  const activeCount = bands.filter((b) => b.on !== 0).length;

  useEffect(() => rootRef.current?.focus(), []);

  // Solo follows the selected band, and never outlives the window.
  useEffect(() => {
    audioEngine.setBandSolo(hostId, effectId, solo && band ? selected! : -1);
  }, [hostId, effectId, solo, band, selected]);
  useEffect(() => () => audioEngine.setBandSolo(hostId, effectId, -1), [hostId, effectId]);

  const set = (index: number, field: string, value: number) => onParamChange(`b${index + 1}${field}`, value);

  const addBand = (newShape: EqShape, freq: number, gain: number) => {
    const index = bands.findIndex((b) => b.on === 0);
    if (index === -1) return;
    onParamDragStart?.();
    set(index, "Shape", EQ_SHAPES.indexOf(newShape));
    set(index, "Freq", freq);
    set(index, "Gain", gain);
    set(index, "Q", newShape === "bell" ? 1 : Math.SQRT1_2);
    set(index, "Slope", newShape === "lowCut" || newShape === "highCut" ? 24 : 12);
    set(index, "Place", 0);
    set(index, "On", 1);
    setSelected(index);
  };

  const removeBand = (index: number) => {
    onParamDragStart?.();
    set(index, "On", 0);
    set(index, "Gain", 0);
    if (selected === index) {
      setSelected(null);
      setSolo(false);
    }
  };

  const toggleBypass = (index: number) => {
    onParamDragStart?.();
    set(index, "On", bands[index].on === 2 ? 1 : 2);
  };

  const knob = (field: "Freq" | "Gain" | "Q", mode: "log" | "bipolar", disabled = false) => {
    const s = spec(`b${selected! + 1}${field}`);
    return (
      <PluginKnob
        label={field === "Freq" ? "Frequency" : field}
        value={params[s.key] ?? s.default}
        min={s.min}
        max={s.max}
        defaultValue={field === "Q" ? (shape === "bell" ? 1 : Math.SQRT1_2) : s.default}
        mode={mode}
        size={50}
        showReadout
        disabled={disabled}
        onChange={(v) => onParamChange(s.key, v)}
        onDragStart={onParamDragStart}
        formatValue={s.format}
      />
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={rootRef}
        tabIndex={-1}
        onKeyDown={(e) => {
          if ((e.key === "Delete" || e.key === "Backspace") && band && selected !== null) {
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
              Parametric EQ
            </h2>
            <span className="text-xs text-muted">— {channelName}</span>
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

        <div style={{ border: "1px solid #2E2F37", borderRadius: 10, overflow: "hidden" }}>
          <ParamEqGraph
            params={params}
            width={GRAPH_W}
            height={GRAPH_H}
            hostId={hostId}
            effectId={effectId}
            selected={selected}
            onSelect={setSelected}
            onBandChange={(index, change) => {
              if (change.freq !== undefined) set(index, "Freq", change.freq);
              if (change.gain !== undefined) set(index, "Gain", change.gain);
              if (change.q !== undefined) set(index, "Q", change.q);
            }}
            onAddBand={addBand}
            onToggleBypass={toggleBypass}
            onRemoveBand={removeBand}
            onGestureStart={onParamDragStart}
          />
        </div>

        {/* Selected band */}
        <div className="flex min-h-[112px] items-center gap-5 rounded-xl px-4 py-3" style={{ background: "#14151A", border: "1px solid #2E2F37" }}>
          {band && shape && selected !== null ? (
            <>
              <div className="flex w-[330px] shrink-0 flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: eqBandColor(selected), color: "#101115" }}>
                    {selected + 1}
                  </span>
                  <span className="text-[13px] font-semibold text-[#F4EDE2]">{EQ_SHAPE_LABELS[shape]}</span>
                  {band.on === 2 && <span className="text-[11px] uppercase tracking-wide text-muted">bypassed</span>}
                </div>
                <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Band shape">
                  {EQ_SHAPES.map((s, i) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={band.shape === i}
                      title={EQ_SHAPE_LABELS[s]}
                      onClick={() => {
                        if (band.shape === i) return;
                        onParamDragStart?.();
                        set(selected, "Shape", i);
                        if (!shapeUsesGain(s)) set(selected, "Gain", 0);
                        if (s === "lowCut" || s === "highCut") set(selected, "Q", Math.SQRT1_2);
                      }}
                      className="flex h-7 w-9 items-center justify-center rounded-md"
                      style={{ background: band.shape === i ? "#2E2F37" : "transparent", border: "1px solid #2E2F37" }}
                    >
                      <ShapeIcon shape={s} active={band.shape === i} />
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Segmented
                    label="Stereo placement"
                    options={EQ_PLACEMENTS.map((p, i) => ({ value: i, label: p === "stereo" ? "Stereo" : EQ_PLACEMENT_LABELS[p][0] }))}
                    value={band.place}
                    onSelect={(v) => {
                      onParamDragStart?.();
                      set(selected, "Place", v);
                    }}
                  />
                  {shapeUsesSlope(shape) && (
                    <select
                      aria-label="Slope"
                      value={EQ_SLOPES.reduce((best, s) => (Math.abs(s - band.slope) < Math.abs(best - band.slope) ? s : best), 12)}
                      onChange={(e) => {
                        onParamDragStart?.();
                        set(selected, "Slope", Number(e.target.value));
                      }}
                      className="h-7 rounded-md px-1.5 text-[11px] font-bold"
                      style={{ background: "#1B1C22", border: "1px solid #2E2F37", color: "#F4EDE2" }}
                    >
                      {EQ_SLOPES.map((s) => (
                        <option key={s} value={s}>
                          {s} dB/oct
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="flex flex-1 justify-around">
                {knob("Freq", "log")}
                {knob("Gain", "bipolar", !shapeUsesGain(shape))}
                {knob("Q", "log")}
              </div>

              <div className="flex shrink-0 flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => setSolo((v) => !v)}
                  aria-pressed={solo}
                  title="Solo - hear only this band's frequency range"
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
                  style={solo ? { background: "rgba(230,173,94,0.18)", color: "#E6AD5E", border: "1px solid #E6AD5E" } : { color: "#9A9AA4", border: "1px solid #2E2F37" }}
                >
                  <Headphones size={12} /> Solo
                </button>
                <button
                  type="button"
                  onClick={() => toggleBypass(selected)}
                  aria-pressed={band.on === 2}
                  title="Bypass this band (Alt-click its node)"
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
                  style={{ color: band.on === 2 ? "#5A5B64" : "#E6AD5E", border: "1px solid #2E2F37" }}
                >
                  <Power size={12} /> {band.on === 2 ? "Off" : "On"}
                </button>
                <button
                  type="button"
                  onClick={() => removeBand(selected)}
                  title="Delete this band (Delete key, or right-click its node)"
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
                  style={{ color: "#FF7A7A", border: "1px solid #2E2F37" }}
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            </>
          ) : (
            <p className="w-full text-center text-[12px] leading-relaxed text-muted">
              Double-click the graph to add a band. Drag a band to move it (hold Shift for fine moves), scroll to change its Q,
              Alt-click to bypass it, right-click or press Delete to remove it.
            </p>
          )}
        </div>

        <div className="flex items-center gap-4">
          <PluginKnob
            label="Output"
            value={params.output ?? 0}
            min={-24}
            max={24}
            defaultValue={0}
            mode="bipolar"
            size={36}
            layout="inline"
            showReadout
            onChange={(v) => onParamChange("output", v)}
            onDragStart={onParamDragStart}
            formatValue={spec("output").format}
          />
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
            options={[3, 6, 12, 30].map((v) => ({ value: v, label: `±${v}` }))}
            value={Math.round(params.scale ?? 12)}
            onSelect={(v) => onParamChange("scale", v)}
          />
          <span className="ml-auto font-mono text-[11px] text-muted">
            {activeCount}/{MAX_EQ_BANDS} bands
          </span>
        </div>
      </div>
    </div>
  );
}
