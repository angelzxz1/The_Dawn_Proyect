"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, Drum, Link2, Search, Sliders, X } from "lucide-react";
import { EFFECT_CHAINS, type EffectChain } from "@/lib/chains";
import { EFFECT_GROUPS, EFFECT_LABELS, type EffectType } from "@/lib/effects";
import { presetsFor, type EffectPreset } from "@/lib/presets";
import { useUserPresets } from "./PresetMenu";

/** The MIME type used to carry an effect type through HTML5 drag-and-drop
 * from this sidebar to the FX rack - shared with FxRack.tsx. */
export const EFFECT_DRAG_MIME = "application/x-dawn-effect-type";
/** Carried alongside EFFECT_DRAG_MIME when a preset is dragged: its id. */
export const PRESET_DRAG_MIME = "application/x-dawn-effect-preset";

interface EffectBrowserProps {
  /** Adds the effect (with a preset loaded, if given) to whatever
   * track/bus the FX rack currently targets - the click-to-add alternative
   * to dragging. */
  onAddEffect: (type: EffectType, presetId?: string) => void;
  /** The Grooves tab's contents. */
  grooves?: ReactNode;
  /** Adds a ready-made chain of effects to the selected track. */
  onAddChain?: (chain: EffectChain) => void;
}

const matches = (text: string, query: string) => text.toLowerCase().includes(query);

/**
 * An Ableton-style device browser docked to the left of the whole app:
 * every audio effect, grouped by category, each collapsible, and under
 * each device its presets (factory and your own). A device or preset is
 * both draggable (drop it onto the FX rack at the bottom of the screen)
 * and clickable (adds it straight to the currently selected track/bus).
 * The search box filters devices and presets by name.
 */
export function EffectBrowser({ onAddEffect, grooves, onAddChain }: EffectBrowserProps) {
  const [tab, setTab] = useState<"effects" | "grooves">("effects");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [openDevices, setOpenDevices] = useState<Set<EffectType>>(new Set());
  const [query, setQuery] = useState("");
  const user = useUserPresets();
  const q = query.trim().toLowerCase();

  const toggle = <T,>(set: React.Dispatch<React.SetStateAction<Set<T>>>, key: T) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const dragProps = (type: EffectType, preset?: EffectPreset) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(EFFECT_DRAG_MIME, type);
      if (preset) e.dataTransfer.setData(PRESET_DRAG_MIME, preset.id);
      e.dataTransfer.effectAllowed = "copy";
    },
  });

  const chains = EFFECT_CHAINS.filter((c) => !q || matches(c.name, q) || matches("chains", q));

  // Filtered view: which devices show, and which of their presets.
  const view = EFFECT_GROUPS.map((group) => ({
    name: group.name,
    devices: group.types
      .map((type) => {
        const { factory, user: mine } = presetsFor(type, user);
        const all = [...factory, ...mine];
        const label = EFFECT_LABELS[type];
        if (!q) return { type, presets: all, expanded: openDevices.has(type) };
        const deviceHit = matches(label, q) || matches(group.name, q);
        const hits = all.filter((p) => matches(p.name, q));
        if (!deviceHit && !hits.length) return null;
        return { type, presets: deviceHit ? all : hits, expanded: hits.length > 0 || openDevices.has(type) };
      })
      .filter((d): d is { type: EffectType; presets: EffectPreset[]; expanded: boolean } => !!d),
  })).filter((g) => g.devices.length > 0);

  return (
    <div className="flex w-48 shrink-0 flex-col overflow-hidden border-r border-border bg-surface">
      <div role="tablist" aria-label="Browser" className="flex border-b border-border">
        {(
          [
            ["effects", "Effects", <Sliders key="i" size={12} />],
            ["grooves", "Grooves", <Drum key="i" size={12} />],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-xs font-semibold uppercase tracking-wide ${
              tab === id ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>
      {tab === "grooves" ? (
        grooves
      ) : (
        <>
          <div className="border-b border-border p-2">
            <label className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1 focus-within:border-accent">
              <Search size={11} className="shrink-0 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") setQuery("");
                }}
                placeholder="Search devices, presets"
                aria-label="Search devices and presets"
                className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} title="Clear search" className="text-muted hover:text-foreground">
                  <X size={11} />
                </button>
              )}
            </label>
          </div>
          <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
            {onAddChain && chains.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => toggle<string>(setCollapsedGroups, "Chains")}
                  className="flex w-full items-center gap-1 rounded px-1 py-1.5 text-left text-[11px] font-medium text-foreground/80 hover:bg-surface-raised"
                >
                  <ChevronRight size={11} className={`shrink-0 transition-transform ${!q && collapsedGroups.has("Chains") ? "" : "rotate-90"}`} />
                  Chains
                </button>
                {(q || !collapsedGroups.has("Chains")) && (
                  <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-1">
                    {chains.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => onAddChain(c)}
                        title={`${c.description} Click to add it to the selected track.`}
                        className="flex min-w-0 items-center gap-1.5 rounded border border-transparent px-1.5 py-1 text-left text-[11px] text-muted hover:border-accent hover:bg-surface-raised hover:text-accent"
                      >
                        <Link2 size={10} className="shrink-0" />
                        <span className="truncate">{c.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {view.length === 0 && chains.length === 0 && <p className="px-1 py-2 text-[11px] text-muted">Nothing matches “{query.trim()}”.</p>}
            {view.map((group) => {
              const isCollapsed = !q && collapsedGroups.has(group.name);
              return (
                <div key={group.name}>
                  <button
                    type="button"
                    onClick={() => toggle(setCollapsedGroups, group.name)}
                    className="flex w-full items-center gap-1 rounded px-1 py-1.5 text-left text-[11px] font-medium text-foreground/80 hover:bg-surface-raised"
                  >
                    <ChevronRight size={11} className={`shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
                    {group.name}
                  </button>
                  {!isCollapsed && (
                    <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-1">
                      {group.devices.map(({ type, presets, expanded }) => (
                        <div key={type}>
                          <div className="flex items-center">
                            <button
                              type="button"
                              onClick={() => toggle(setOpenDevices, type)}
                              title={expanded ? "Hide presets" : "Show presets"}
                              aria-label={`${expanded ? "Hide" : "Show"} ${EFFECT_LABELS[type]} presets`}
                              aria-expanded={expanded}
                              className="flex h-5 w-4 shrink-0 items-center justify-center rounded text-muted hover:text-foreground"
                            >
                              <ChevronRight size={10} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
                            </button>
                            <div
                              {...dragProps(type)}
                              onClick={() => onAddEffect(type)}
                              title="Drag onto the FX rack, or click to add it to the selected track/bus"
                              className="min-w-0 flex-1 cursor-grab select-none truncate rounded border border-transparent px-1.5 py-1 text-[11px] text-muted hover:border-accent hover:bg-surface-raised hover:text-accent active:cursor-grabbing"
                            >
                              {EFFECT_LABELS[type]}
                            </div>
                          </div>
                          {expanded && (
                            <div className="mb-1 ml-4 flex flex-col border-l border-border/60 pl-1">
                              {presets.map((p) => (
                                <div
                                  key={p.id}
                                  {...dragProps(type, p)}
                                  onClick={() => onAddEffect(type, p.id)}
                                  title={`${EFFECT_LABELS[type]}: ${p.name}${p.factory ? "" : " (your preset)"} - drag onto the FX rack, or click to add`}
                                  className="flex min-w-0 cursor-grab select-none items-center gap-1 rounded px-1.5 py-[3px] text-[10.5px] text-muted hover:bg-surface-raised hover:text-accent active:cursor-grabbing"
                                >
                                  {!p.factory && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />}
                                  <span className="truncate">{p.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
