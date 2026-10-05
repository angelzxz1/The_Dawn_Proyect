"use client";

import { useRef, useState } from "react";
import { Sliders } from "lucide-react";
import { MASTER_COLOR, trackColorOf } from "@/lib/colors";
import { busActions } from "@/state/busActions";
import { projectSetter, projectStore, useProjectValue } from "@/state/projectStore";
import { Meter } from "../Meter";
import { ValueBar } from "../ValueBar";

const setMasterName = projectSetter("masterName");
const setMasterVolume = projectSetter("masterVolume");
const setMasterPan = projectSetter("masterPan");
const pushHistory = () => projectStore.push();

interface MasterBusRowProps {
  /** The master limiter's ceiling (dB). */
  limiterThreshold: number;
  onLimiterThresholdChange: (db: number) => void;
  onOpenMasterFx: () => void;
  onOpenBusFx: (busId: string) => void;
  onRemoveBus: (busId: string) => void;
}

/** The master (name, meter, pan, volume, limiter, FX) and the send/return
 * buses, in one row so the tracks keep the room. The buses scroll sideways
 * when there are many. */
export function MasterBusRow({ limiterThreshold, onLimiterThresholdChange, onOpenMasterFx, onOpenBusFx, onRemoveBus }: MasterBusRowProps) {
  const masterName = useProjectValue("masterName");
  const masterVolume = useProjectValue("masterVolume");
  const masterPan = useProjectValue("masterPan");
  const masterEffects = useProjectValue("masterEffects");
  const buses = useProjectValue("buses");
  const busEffects = useProjectValue("busEffects");
  const [editingMasterName, setEditingMasterName] = useState(false);
  const [masterNameDraft, setMasterNameDraft] = useState("Master");
  const busRowRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex shrink-0 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-1.5">
      <div className="flex shrink-0 items-center gap-2" title="Master output: every track routes through here before the speakers.">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: MASTER_COLOR.accent }} />
        {editingMasterName ? (
          <input
            autoFocus
            value={masterNameDraft}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setMasterNameDraft(e.target.value)}
            onBlur={() => {
              const trimmed = masterNameDraft.trim();
              if (trimmed && trimmed !== masterName) setMasterName(trimmed);
              setEditingMasterName(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              else if (e.key === "Escape") setEditingMasterName(false);
            }}
            className="w-20 rounded border border-accent bg-surface px-1 text-xs font-medium outline-none"
          />
        ) : (
          <span
            title="Double-click to rename"
            onDoubleClick={() => {
              setMasterNameDraft(masterName);
              setEditingMasterName(true);
            }}
            className="w-20 shrink-0 truncate text-xs font-medium"
          >
            {masterName}
          </span>
        )}
        <div className="h-8">
          <Meter channelId="master" />
        </div>
        <ValueBar
          label="Pan"
          value={masterPan}
          min={-1}
          max={1}
          defaultValue={0}
          onChange={setMasterPan}
          onDragStart={pushHistory}
          formatValue={(v) => (Math.abs(v) < 0.02 ? "C" : v < 0 ? `${Math.round(-v * 100)}L` : `${Math.round(v * 100)}R`)}
          bipolar
        />
        <ValueBar
          label="Vol"
          value={masterVolume}
          min={-60}
          max={6}
          defaultValue={0}
          onChange={setMasterVolume}
          onDragStart={pushHistory}
          formatValue={(v) => (v <= -60 ? "-∞" : `${v.toFixed(1)}dB`)}
        />
        <ValueBar
          label="Ceiling"
          value={limiterThreshold}
          min={-24}
          max={0}
          defaultValue={-1}
          onChange={onLimiterThresholdChange}
          onDragStart={pushHistory}
          formatValue={(v) => `${v.toFixed(1)}dB`}
        />
        <span className="text-[10px] text-muted/70">limiter</span>
        <button
          type="button"
          title={`FX${masterEffects.length > 0 ? ` (${masterEffects.length})` : ""} — master bus effects`}
          onClick={onOpenMasterFx}
          className={`relative flex h-5 items-center gap-1 rounded border border-border px-1.5 text-[10px] font-medium hover:bg-surface-raised ${
            masterEffects.length > 0 ? "text-accent" : "text-muted"
          }`}
        >
          <Sliders size={11} />
          FX
          {masterEffects.length > 0 && (
            <span className="flex h-3 w-3 items-center justify-center rounded-full bg-accent text-[7px] font-bold text-black">
              {masterEffects.length}
            </span>
          )}
        </button>
      </div>
      <div className="h-8 w-px shrink-0 bg-border" />
      <span
        className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted"
        title="Send/return buses: set each track's send level to a bus in its FX rack."
      >
        Buses
      </span>
      <button
        type="button"
        onClick={() => {
          busActions.add();
          // Bring the new bus into view at the end of the row.
          setTimeout(() => busRowRef.current?.scrollTo({ left: busRowRef.current.scrollWidth, behavior: "smooth" }), 50);
        }}
        title="Add a send/return bus"
        className="shrink-0 rounded border border-border px-2 py-1 text-[11px] text-muted hover:border-accent hover:text-accent"
      >
        + Bus
      </button>
      <div ref={busRowRef} className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-0.5">
        {buses.map((bus) => (
          <div
            key={bus.id}
            className="flex shrink-0 items-center gap-1 rounded border border-border bg-surface-raised px-1.5 py-1"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: trackColorOf(bus).accent }}
            />
            <input
              value={bus.name}
              onChange={(e) => busActions.rename(bus.id, e.target.value)}
              className="w-20 bg-transparent text-xs outline-none"
              title="Bus name"
            />
            <button
              type="button"
              title="Open bus effects"
              onClick={() => onOpenBusFx(bus.id)}
              className="rounded px-1 text-[10px] text-muted hover:bg-surface hover:text-accent"
            >
              FX{(busEffects[bus.id]?.length ?? 0) > 0 ? ` (${busEffects[bus.id]!.length})` : ""}
            </button>
            <button
              type="button"
              title="Remove bus"
              onClick={() => onRemoveBus(bus.id)}
              className="rounded px-1 text-[10px] text-muted hover:bg-surface hover:text-record"
            >
              ✕
            </button>
          </div>
        ))}
        {buses.length === 0 && <span className="text-[10px] text-muted/70">No buses yet: add one for a shared reverb or delay.</span>}
      </div>
    </div>
  );
}
