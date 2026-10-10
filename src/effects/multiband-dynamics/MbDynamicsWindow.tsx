"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Power } from "lucide-react";
import { PluginKnob, type KnobMode } from "@/ui/PluginKnob";
import { PluginToggle, PluginWindow } from "@/effects/ui/PluginChrome";
import { Segmented } from "@/effects/ui/PluginSegmented";
import { SidechainPanel, type SidechainSource } from "@/effects/sidechain/SidechainPanel";
import { MBD_COLORS, MBD_ROWS, MbDynamicsDisplay, mbdBandExists, useMbdMeters } from "./MbDynamicsDisplay";
import { paramSpecs } from "@/effects/registry";
import { MBD_BAND_LABELS, mbdKey, type MbdBand, type MbdField } from "./mbDynamicsModel";
import type { SidechainRouting } from "@/effects/sidechain/sidechainModel";

const ROW_H = 78;
const DISPLAY_W = 520;

export const mbdSpec = (key: string) => paramSpecs("mbDynamics").find((s) => s.key === key)!;
export const mbdValue = (params: Record<string, number>, key: string) => params[key] ?? mbdSpec(key).default;

/** The T / B / A column: per band, Attack and Release, or the Below or
 * Above threshold and ratio. */
const VIEWS: { label: string; fields: [MbdField, string, KnobMode][] }[] = [
  { label: "T", fields: [["Attack", "Attack", "log"], ["Release", "Release", "log"]] },
  { label: "B", fields: [["BelowT", "Threshold", "linear"], ["BelowR", "Ratio", "log"]] },
  { label: "A", fields: [["AboveT", "Threshold", "linear"], ["AboveR", "Ratio", "log"]] },
];

export function MbDynamicsWindow({
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
  const meters = useMbdMeters(bypass ? undefined : hostId, effectId);
  const value = (key: string) => mbdValue(params, key);
  const view = Math.round(value("view"));
  const toggle = (key: string) => {
    onParamDragStart?.();
    onParamChange(key, value(key) >= 0.5 ? 0 : 1);
  };
  const knob = (key: string, label: string, mode: KnobMode, size = 30, disabled = false) => {
    const s = mbdSpec(key);
    return (
      <PluginKnob
        key={key}
        label={label}
        value={value(key)}
        min={s.min}
        max={s.max}
        defaultValue={s.default}
        mode={mode}
        size={size}
        layout="inline"
        showReadout
        disabled={disabled}
        onChange={(v) => onParamChange(key, v)}
        onDragStart={onParamDragStart}
        formatValue={s.format}
      />
    );
  };
  const rowBox = (band: MbdBand, children: React.ReactNode) => (
    <div key={band} className="flex items-center" style={{ height: ROW_H, opacity: mbdBandExists(params, band) ? 1 : 0.35 }}>
      {children}
    </div>
  );

  return (
    <PluginWindow title="Multiband Dynamics" channelName={channelName} bypass={bypass} onBypassToggle={onBypassToggle} onClose={onClose} width={1040}>
      <div className="flex flex-wrap items-center gap-4">
        {(["highOn", "lowOn"] as const).map((key) => {
          const band = key === "highOn" ? "h" : "l";
          const on = value(key) >= 0.5;
          return (
            <div key={key} className="flex items-center gap-2">
              <PluginToggle label={key === "highOn" ? "High" : "Low"} active={on} onClick={() => toggle(key)} title={`Split off a ${key === "highOn" ? "high" : "low"} band`} />
              <div style={{ opacity: on ? 1 : 0.4 }}>{knob(band === "h" ? "xHigh" : "xLow", "Crossover", "log", 28, !on)}</div>
            </div>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <PluginToggle label="Soft Knee" active={value("softKnee") >= 0.5} onClick={() => toggle("softKnee")} title="Start compressing or expanding gradually as the level nears a threshold" />
          <Segmented<number>
            label="Detection"
            options={[
              { value: 0, label: "Peak" },
              { value: 1, label: "RMS" },
            ]}
            value={value("rms") >= 0.5 ? 1 : 0}
            onSelect={(v) => {
              onParamDragStart?.();
              onParamChange("rms", v);
            }}
          />
        </div>
      </div>

      <div className="flex items-start gap-3">
        {/* Per band: on, solo, Input. */}
        <div className="flex w-[168px] shrink-0 flex-col">
          {MBD_ROWS.map((band) =>
            rowBox(
              band,
              <div className="flex w-full items-center gap-1.5">
                <button
                  type="button"
                  title={`${MBD_BAND_LABELS[band]} band on/off`}
                  aria-pressed={value(mbdKey(band, "On")) >= 0.5}
                  onClick={() => toggle(mbdKey(band, "On"))}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
                  style={{ border: "1px solid #2E2F37" }}
                >
                  <Power size={12} color={value(mbdKey(band, "On")) >= 0.5 ? MBD_COLORS[band] : "#5A5B64"} />
                </button>
                <button
                  type="button"
                  title={`Solo the ${MBD_BAND_LABELS[band].toLowerCase()} band`}
                  aria-pressed={value(mbdKey(band, "Solo")) >= 0.5}
                  onClick={() => toggle(mbdKey(band, "Solo"))}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-bold"
                  style={value(mbdKey(band, "Solo")) >= 0.5 ? { background: "#E6AD5E", color: "#14151A" } : { border: "1px solid #2E2F37", color: "#8A8A94" }}
                >
                  S
                </button>
                {knob(mbdKey(band, "In"), "Input", "bipolar", 28)}
              </div>
            )
          )}
        </div>

        <div className="min-w-0 flex-1">
          <MbDynamicsDisplay params={params} meters={meters} width={DISPLAY_W} rowHeight={ROW_H} onParamChange={onParamChange} onDragStart={onParamDragStart} />
        </div>

        {/* Per band Output. */}
        <div className="flex w-[118px] shrink-0 flex-col">{MBD_ROWS.map((band) => rowBox(band, knob(mbdKey(band, "Out"), "Output", "bipolar", 28)))}</div>

        {/* T / B / A. */}
        <div className="flex w-[164px] shrink-0 flex-col">
          {MBD_ROWS.map((band) =>
            rowBox(
              band,
              <div className="flex gap-2">
                {VIEWS[view].fields.map(([field, label, mode]) => {
                  const key = mbdKey(band, field);
                  const sp = mbdSpec(key);
                  return (
                    <PluginKnob
                      key={key}
                      label={label}
                      value={value(key)}
                      min={sp.min}
                      max={sp.max}
                      defaultValue={sp.default}
                      mode={mode}
                      size={26}
                      showReadout
                      onChange={(v) => onParamChange(key, v)}
                      onDragStart={onParamDragStart}
                      formatValue={sp.format}
                    />
                  );
                })}
              </div>
            )
          )}
          <div className="mt-1">
            <Segmented<number>
              label="Show"
              options={VIEWS.map((v, i) => ({ value: i, label: v.label }))}
              value={view}
              onSelect={(v) => onParamChange("view", v)}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-5 rounded-xl px-3.5 py-2.5" style={{ background: "#16171C", border: "1px solid #2A2B33" }}>
        {knob("output", "Output", "bipolar", 34)}
        {knob("time", "Time", "log", 34)}
        {knob("amount", "Amount", "linear", 34)}
        <button
          type="button"
          onClick={() => setShowSidechain((v) => !v)}
          aria-expanded={showSidechain}
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-[#9A9AA4] hover:text-[#F4EDE2]"
          style={{ border: `1px solid ${sidechain?.on ? "#E6AD5E" : "#2E2F37"}` }}
        >
          {showSidechain ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Sidechain
        </button>
      </div>

      {showSidechain && (
        <SidechainPanel
          type="mbDynamics"
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
        Drag a block&apos;s inner edge to move its threshold, and inside it up (louder) or down (quieter) for its ratio: above the Above threshold,
        down compresses and up expands; below the Below threshold, down expands and up compresses. Ctrl/Cmd: all bands · Alt: Above and Below
        together · Shift: finer · double-click: reset.
      </p>
    </PluginWindow>
  );
}
