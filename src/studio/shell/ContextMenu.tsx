"use client";

import { useEffect, useRef } from "react";
import { useShortcuts } from "@/ui/shortcuts";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
}

/** A label and a row of small choices after it: color swatches (a choice
 * with `swatch`) or short words. */
export interface ContextMenuRow {
  row: string;
  options: { label: string; title?: string; swatch?: string; selected?: boolean; onSelect: () => void }[];
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuRow | "separator";

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

/** A small floating menu anchored at a screen point, closed by clicking
 * outside, pressing Escape, or picking an item. Used for right-click menus
 * on clips and track lanes. */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose]);
  useShortcuts("menu", [{ keys: "escape", run: onClose, whileTyping: true }]);

  // Keep the menu on-screen near the edges.
  const style: React.CSSProperties = {
    left: Math.min(x, (typeof window !== "undefined" ? window.innerWidth : x) - 200),
    top: Math.min(y, (typeof window !== "undefined" ? window.innerHeight : y) - items.length * 30 - 16),
  };

  return (
    <div
      ref={ref}
      style={style}
      className="fixed z-50 min-w-[190px] rounded-md border border-border bg-surface-raised py-1 text-sm shadow-2xl"
    >
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={`sep-${i}`} className="my-1 border-t border-border" />
        ) : "row" in item ? (
          <div key={item.row} role="group" aria-label={item.row} className="flex items-center gap-2 px-3 py-1.5">
            <span className="w-11 shrink-0 text-xs text-muted">{item.row}</span>
            <div className="flex flex-wrap items-center gap-1">
              {item.options.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  aria-label={option.label}
                  aria-pressed={option.selected}
                  title={option.title ?? option.label}
                  onClick={() => {
                    option.onSelect();
                    onClose();
                  }}
                  className={
                    option.swatch
                      ? `h-4 w-4 rounded-full ring-1 hover:ring-white/70 ${option.selected ? "ring-2 ring-white" : "ring-black/30"}`
                      : `rounded border px-1.5 py-0.5 text-[11px] hover:bg-surface ${option.selected ? "border-accent text-accent" : "border-border text-foreground"}`
                  }
                  style={option.swatch ? { background: option.swatch } : undefined}
                >
                  {option.swatch ? null : option.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <button
            key={item.label}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40 ${
              item.danger ? "text-record" : "text-foreground"
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        )
      )}
    </div>
  );
}
