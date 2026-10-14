"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { GripHorizontal, X } from "lucide-react";

// The on-screen keyboard / drum pads, in a window that floats over the
// studio instead of taking a row of it: drag it by its title bar, close it
// with ✕ or the Keys button. It stays mounted while closed, so the computer
// keyboard keeps playing the armed track either way.

const POS_KEY = "dawn.noteInputPos";

type Pos = { x: number; y: number };

function readPos(): Pos | null {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  } catch {
    return null;
  }
}

/** Keeps a window this wide on screen, with its title bar reachable. */
function clampPos(p: Pos, w: number): Pos {
  return {
    x: Math.max(8, Math.min(window.innerWidth - Math.min(w, window.innerWidth - 16) - 8, p.x)),
    y: Math.max(8, Math.min(window.innerHeight - 40, p.y)),
  };
}

export function NoteInputWindow({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  // Until it's been dragged: centered near the bottom of the screen.
  const [pos, setPos] = useState<Pos | null>(readPos);

  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      const el = panel.current;
      if (el && pos) setPos(clampPos(pos, el.offsetWidth));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, pos]);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const el = panel.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let last: Pos = { x: rect.left, y: rect.top };
    const onMove = (ev: PointerEvent) => {
      last = clampPos({ x: ev.clientX - dx, y: ev.clientY - dy }, rect.width);
      setPos(last);
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(last));
      } catch {
        // Not remembered in a private window.
      }
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={title}
      hidden={!open}
      className="fixed z-40 w-[min(1100px,calc(100vw-32px))] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
      style={pos ? { left: pos.x, top: pos.y } : { left: "50%", bottom: 24, transform: "translateX(-50%)" }}
    >
      <div onPointerDown={startDrag} className="flex cursor-grab touch-none select-none items-center gap-2 border-b border-border bg-surface-raised px-3 py-1.5 active:cursor-grabbing">
        <GripHorizontal size={13} className="text-muted" />
        <span className="flex-1 text-xs font-medium">{title}</span>
        <button type="button" onClick={onClose} aria-label="Close the keyboard window" className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface hover:text-foreground">
          <X size={13} />
        </button>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}
