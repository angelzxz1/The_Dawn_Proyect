"use client";

import { useEffect, useMemo, useRef } from "react";
import { Headphones } from "lucide-react";
import { PluginKnob, type KnobMode } from "./PluginKnob";
import { PluginToggle } from "./PluginChrome";
import { Segmented } from "./PluginSegmented";
import { audioEngine } from "@/lib/audioEngine";
import { paramSpecs, type EffectType } from "@/lib/effects";
import {
  DEFAULT_SIDECHAIN,
  SIDECHAIN_TAPS,
  SIDECHAIN_TAP_LABELS,
  type SidechainRouting,
  type SidechainTap,
} from "@/lib/sidechainModel";

/** A track or bus an effect could take its key from. */
export interface SidechainSource {
  id: string;
  name: string;
  kind: "track" | "bus";
}

const KNOBS: { key: string; label: string; mode: KnobMode }[] = [
  { key: "scGain", label: "Gain", mode: "bipolar" },
  { key: "scHpf", label: "Low Cut", mode: "log" },
  { key: "scLpf", label: "High Cut", mode: "log" },
];

/** The name shown for an effect's key source, or null when it has none
 * (off, unset, or the track was deleted). */
export function sidechainSourceName(routing: SidechainRouting | undefined, sources: SidechainSource[]): string | null {
  if (!routing?.on || !routing.source) return null;
  return sources.find((s) => s.id === routing.source)?.name ?? null;
}

/** The Sidechain section of a dynamics plugin's window: where its detector
 * listens (its own input, or another track or bus, tapped before its
 * effects, after them or after its fader), plus the gain and low/high cut
 * shaping what it hears, and Listen to hear that. */
export function SidechainPanel({
  type,
  hostId,
  effectId,
  params,
  routing,
  sources,
  onRoutingChange,
  onParamChange,
  onParamDragStart,
}: {
  type: EffectType;
  hostId: string;
  effectId: string;
  params: Record<string, number>;
  routing: SidechainRouting | undefined;
  sources: SidechainSource[];
  onRoutingChange: (routing: SidechainRouting) => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}) {
  const sc = routing ?? DEFAULT_SIDECHAIN;
  const specs = paramSpecs(type);
  const spec = (key: string) => specs.find((s) => s.key === key)!;
  const value = (key: string) => params[key] ?? spec(key).default;
  const listen = value("scListen") >= 0.5;
  const candidates = sources.filter((s) => s.id !== hostId);
  // Choices that would feed this track back into itself are greyed out.
  const allowed = useMemo(
    () => audioEngine.sidechainSourcesAllowed(hostId, effectId),
    // Re-checked whenever the routing or the list of tracks changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hostId, effectId, sc.on, sc.source, sources]
  );
  const sourceName = sidechainSourceName(sc, sources);

  const meterFill = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const state = audioEngine.getSidechainState(hostId, effectId);
      const db = state?.connected ? state.levelDb : -Infinity;
      const fraction = Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 60) / 66)) : 0;
      if (meterFill.current) meterFill.current.style.width = `${fraction * 100}%`;
      if (status.current) {
        const text = !sc.on
          ? "Listening to its own input"
          : !sc.source
            ? "Choose a track to listen to"
            : !sourceName
              ? "That track was deleted"
              : state && !state.connected
                ? `${sourceName} is fed by this track, so it can't key it (it would loop)`
                : `Listening to ${sourceName} · ${SIDECHAIN_TAP_LABELS[sc.tap]}`;
        if (status.current.textContent !== text) status.current.textContent = text;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hostId, effectId, sc.on, sc.source, sc.tap, sourceName]);

  const change = (next: Partial<SidechainRouting>) => onRoutingChange({ ...sc, ...next });

  return (
    <section
      aria-label="Sidechain"
      className="flex flex-col gap-2.5 rounded-xl px-3.5 py-3"
      style={{ background: "#16171C", border: "1px solid #2A2B33" }}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <PluginToggle label="Sidechain" active={sc.on} onClick={() => change({ on: !sc.on })} title="Listen to another track instead of this one" />
        <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#8A8A94]">
          Audio From
          <select
            value={sc.source ?? ""}
            onChange={(e) => change({ source: e.target.value || null, on: e.target.value ? true : sc.on })}
            className="h-7 max-w-[180px] rounded-md px-2 text-[12px] font-medium normal-case tracking-normal text-[#F4EDE2] outline-none"
            style={{ background: "#23242B", border: "1px solid #2E2F37" }}
          >
            <option value="">None</option>
            {(["track", "bus"] as const).map((kind) => {
              const list = candidates.filter((s) => s.kind === kind);
              if (!list.length) return null;
              return (
                <optgroup key={kind} label={kind === "track" ? "Tracks" : "Buses"}>
                  {list.map((s) => (
                    <option key={s.id} value={s.id} disabled={!allowed.has(s.id) && s.id !== sc.source}>
                      {s.name}
                      {!allowed.has(s.id) ? " (loop)" : ""}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </label>
        <Segmented<SidechainTap>
          label="Tap point"
          options={SIDECHAIN_TAPS.map((t) => ({ value: t, label: SIDECHAIN_TAP_LABELS[t] }))}
          value={sc.tap}
          onSelect={(tap) => change({ tap })}
        />
        <div className="ml-auto flex items-center gap-2">
          <div
            className="relative h-1.5 w-24 overflow-hidden rounded-full"
            style={{ background: "#23242B" }}
            title="Key level"
            aria-hidden
          >
            <div ref={meterFill} className="absolute inset-y-0 left-0 rounded-full" style={{ width: 0, background: "#6BD68B" }} />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {KNOBS.map((k) => {
          const s = spec(k.key);
          return (
            <PluginKnob
              key={k.key}
              label={k.label}
              value={value(k.key)}
              min={s.min}
              max={s.max}
              defaultValue={s.default}
              mode={k.mode}
              size={34}
              layout="inline"
              showReadout
              onChange={(v) => onParamChange(k.key, v)}
              onDragStart={onParamDragStart}
              formatValue={s.format}
            />
          );
        })}
        <PluginToggle
          label={
            <span className="flex items-center gap-1">
              <Headphones size={12} /> Listen
            </span>
          }
          active={listen}
          onClick={() => {
            onParamDragStart?.();
            onParamChange("scListen", listen ? 0 : 1);
          }}
          title="Hear what the detector hears (the key after its gain and filters)"
        />
        <span ref={status} className="ml-auto text-[11px] text-muted" />
      </div>
    </section>
  );
}

/** A small "SC" chip for a rack card's header, naming the source on hover. */
export function SidechainBadge({ name }: { name: string | null }) {
  if (!name) return null;
  return (
    <span
      title={`Sidechain from ${name}`}
      className="shrink-0 rounded px-1 text-[9.5px] font-bold uppercase tracking-wide"
      style={{ color: "#E6AD5E", border: "1px solid rgba(230,173,94,0.5)" }}
    >
      SC
    </span>
  );
}
