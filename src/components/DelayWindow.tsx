"use client";

import { Power, X } from "lucide-react";
import { PluginKnob } from "./PluginKnob";
import { DelayGraph } from "./DelayGraph";
import { PluginIcon } from "./PluginIcon";
import { paramSpecs } from "@/lib/effects";
import { snapToDivision, formatDivision } from "@/lib/delayDivisions";
import { fraunces, spaceGrotesk } from "@/lib/pluginFonts";

interface DelayWindowProps {
  channelName: string;
  bpm: number;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

function TogglePill({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide"
      style={{
        background: on ? "rgba(230,173,94,0.14)" : "#23242B",
        border: `1px solid ${on ? "#E6AD5E" : "#2E2F37"}`,
        color: on ? "#E6AD5E" : "#6E6E78",
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: on ? "#E6AD5E" : "#5A5B64" }} />
      {label}
    </button>
  );
}

/** The full Delay plugin window - a live tap-decay graph, every knob with
 * its numeric readout, a Sync/Time mode toggle for the Time L/R knobs, and
 * Link/Ping-Pong/Freeze/Filter toggles, opened from the compact FX rack
 * card's expand button. */
export function DelayWindow({
  channelName,
  bpm,
  params,
  bypass,
  onBypassToggle,
  onClose,
  onParamChange,
  onParamDragStart,
}: DelayWindowProps) {
  const [timeLSpec, timeRSpec, feedbackSpec, lowCutSpec, highCutSpec, wetSpec] = paramSpecs("delay");
  const value = (key: string, fallback: number) => params[key] ?? fallback;

  const syncOn = value("sync", 1) >= 0.5;
  const linkOn = value("link", 0) >= 0.5;
  const pingPongOn = value("pingPong", 0) >= 0.5;
  const freezeOn = value("freeze", 0) >= 0.5;
  const filterOn = value("filterOn", 1) >= 0.5;
  const delayTimeL = value("delayTimeL", timeLSpec.default);
  const delayTimeR = linkOn ? delayTimeL : value("delayTimeR", timeRSpec.default);
  const feedback = value("feedback", feedbackSpec.default);
  const lowCut = value("lowCut", lowCutSpec.default);
  const highCut = value("highCut", highCutSpec.default);
  const wet = value("wet", wetSpec.default);

  const timeFormat = (v: number) => (syncOn ? formatDivision(v, bpm) : timeLSpec.format(v));

  const changeTime = (key: "delayTimeL" | "delayTimeR", raw: number) => {
    const next = syncOn ? snapToDivision(raw, bpm) : raw;
    onParamChange(key, next);
    if (linkOn) onParamChange(key === "delayTimeL" ? "delayTimeR" : "delayTimeL", next);
  };

  const toggle = (key: string, current: boolean) => {
    onParamDragStart?.();
    onParamChange(key, current ? 0 : 1);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className={`${spaceGrotesk.className} flex w-[760px] flex-col gap-4 rounded-2xl shadow-2xl`}
        style={{ background: "#1B1C22", border: "1px solid #2E2F37", padding: "18px 22px 20px" }}
      >
        <div className="flex h-[30px] items-center justify-between">
          <div className="flex items-center gap-2">
            <PluginIcon />
            <h2 className={`${fraunces.className} text-[19px] font-semibold text-[#F4EDE2]`} style={{ letterSpacing: "-0.2px" }}>
              Delay
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

        <DelayGraph
          delayTimeL={delayTimeL}
          delayTimeR={delayTimeR}
          feedback={feedback}
          wet={wet}
          pingPong={pingPongOn}
          filterOn={filterOn}
          lowCut={lowCut}
          highCut={highCut}
        />

        <div className="flex justify-between px-1 pt-1">
          <PluginKnob
            label={timeLSpec.label}
            value={delayTimeL}
            min={timeLSpec.min}
            max={timeLSpec.max}
            defaultValue={timeLSpec.default}
            mode="log"
            size={54}
            showReadout
            onChange={(v) => changeTime("delayTimeL", v)}
            onDragStart={onParamDragStart}
            formatValue={timeFormat}
          />
          <PluginKnob
            label={timeRSpec.label}
            value={delayTimeR}
            min={timeRSpec.min}
            max={timeRSpec.max}
            defaultValue={timeRSpec.default}
            mode="log"
            size={54}
            showReadout
            disabled={linkOn}
            onChange={(v) => changeTime("delayTimeR", v)}
            onDragStart={onParamDragStart}
            formatValue={timeFormat}
          />
          <PluginKnob
            label={feedbackSpec.label}
            value={feedback}
            min={feedbackSpec.min}
            max={feedbackSpec.max}
            defaultValue={feedbackSpec.default}
            mode="linear"
            size={54}
            showReadout
            onChange={(v) => onParamChange("feedback", v)}
            onDragStart={onParamDragStart}
            formatValue={feedbackSpec.format}
          />
          <PluginKnob
            label={lowCutSpec.label}
            value={lowCut}
            min={lowCutSpec.min}
            max={lowCutSpec.max}
            defaultValue={lowCutSpec.default}
            mode="log"
            size={54}
            showReadout
            onChange={(v) => onParamChange("lowCut", v)}
            onDragStart={onParamDragStart}
            formatValue={lowCutSpec.format}
          />
          <PluginKnob
            label={highCutSpec.label}
            value={highCut}
            min={highCutSpec.min}
            max={highCutSpec.max}
            defaultValue={highCutSpec.default}
            mode="log"
            size={54}
            showReadout
            onChange={(v) => onParamChange("highCut", v)}
            onDragStart={onParamDragStart}
            formatValue={highCutSpec.format}
          />
          <PluginKnob
            label={wetSpec.label}
            value={wet}
            min={wetSpec.min}
            max={wetSpec.max}
            defaultValue={wetSpec.default}
            mode="linear"
            size={54}
            showReadout
            onChange={(v) => onParamChange("wet", v)}
            onDragStart={onParamDragStart}
            formatValue={wetSpec.format}
          />
        </div>

        <div style={{ height: 1, background: "#2E2F37" }} />

        <div className="flex items-center justify-between">
          <div className="flex overflow-hidden rounded-lg" style={{ border: "1px solid #2E2F37" }}>
            <button
              type="button"
              onClick={() => toggle("sync", syncOn)}
              className="px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide"
              style={{ background: syncOn ? "#F4EDE2" : "transparent", color: syncOn ? "#14151A" : "#6E6E78" }}
            >
              Sync
            </button>
            <button
              type="button"
              onClick={() => toggle("sync", syncOn)}
              className="px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide"
              style={{ background: !syncOn ? "#F4EDE2" : "transparent", color: !syncOn ? "#14151A" : "#6E6E78" }}
            >
              Time
            </button>
          </div>

          <div className="flex items-center gap-2">
            <TogglePill label="Link" on={linkOn} onClick={() => toggle("link", linkOn)} />
            <TogglePill label="Ping-Pong" on={pingPongOn} onClick={() => toggle("pingPong", pingPongOn)} />
            <TogglePill label="Freeze" on={freezeOn} onClick={() => toggle("freeze", freezeOn)} />
            <TogglePill label="Filter" on={filterOn} onClick={() => toggle("filterOn", filterOn)} />
          </div>

          <span className="font-mono text-[11px] text-muted">@ {Math.round(bpm)} BPM</span>
        </div>
      </div>
    </div>
  );
}
