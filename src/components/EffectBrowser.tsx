"use client";

import { useState } from "react";
import { ChevronRight, Sliders } from "lucide-react";
import { EFFECT_GROUPS, EFFECT_LABELS, type EffectType } from "@/lib/effects";

/** The MIME type used to carry an effect type through HTML5 drag-and-drop
 * from this sidebar to the FX rack - shared with FxRack.tsx. */
export const EFFECT_DRAG_MIME = "application/x-dawn-effect-type";

interface EffectBrowserProps {
  /** Adds the effect to whatever track/bus the FX rack currently targets -
   * the click-to-add alternative to dragging. */
  onAddEffect: (type: EffectType) => void;
}

/**
 * An Ableton-style device browser docked to the left of the whole app:
 * every audio effect, grouped by category, each collapsible. An entry is
 * both draggable (drop it onto the FX rack at the bottom of the screen)
 * and clickable (adds it straight to the currently selected track/bus).
 */
export function EffectBrowser({ onAddEffect }: EffectBrowserProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (name: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="flex w-44 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <Sliders size={12} />
        Audio Effects
      </div>
      <div className="flex flex-col gap-0.5 p-2">
        {EFFECT_GROUPS.map((group) => {
          const isCollapsed = collapsedGroups.has(group.name);
          return (
            <div key={group.name}>
              <button
                type="button"
                onClick={() => toggleGroup(group.name)}
                className="flex w-full items-center gap-1 rounded px-1 py-1.5 text-left text-[11px] font-medium text-foreground/80 hover:bg-surface-raised"
              >
                <ChevronRight
                  size={11}
                  className={`shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                />
                {group.name}
              </button>
              {!isCollapsed && (
                <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-2">
                  {group.types.map((type) => (
                    <div
                      key={type}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(EFFECT_DRAG_MIME, type);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={() => onAddEffect(type)}
                      title="Drag onto the FX rack, or click to add it to the selected track/bus"
                      className="cursor-grab select-none rounded border border-transparent px-2 py-1 text-[11px] text-muted hover:border-accent hover:bg-surface-raised hover:text-accent active:cursor-grabbing"
                    >
                      {EFFECT_LABELS[type]}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
