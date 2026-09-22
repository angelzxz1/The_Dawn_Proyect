"use client";

import { useRef, useState } from "react";

interface ValueBarProps {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (value: number) => void;
  formatValue: (value: number) => string;
  /** Pan-style: fill grows from the center toward the sign of the value. */
  bipolar?: boolean;
  /** Fired once, right before the first actual value change of a gesture
   * (drag, typed entry, arrow-key nudge, or double-click reset) - never for
   * a click that just opens/cancels the edit box without changing anything.
   * Lets a caller push one undo checkpoint per gesture instead of one per
   * intermediate value. */
  onDragStart?: () => void;
}

const DRAG_RANGE_PX = 108; // vertical pixels for a full sweep
const CLICK_MOVE_THRESHOLD = 3;

export function ValueBar({
  label,
  value,
  min,
  max,
  defaultValue,
  onChange,
  formatValue,
  bipolar,
  onDragStart,
}: ValueBarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const dragState = useRef<{ startY: number; startValue: number; moved: boolean } | null>(
    null
  );

  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editing) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { startY: e.clientY, startValue: value, moved: false };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag) return;
    const delta = drag.startY - e.clientY;
    if (Math.abs(delta) > CLICK_MOVE_THRESHOLD) {
      if (!drag.moved) onDragStart?.();
      drag.moved = true;
    }
    if (!drag.moved) return;
    const range = max - min;
    onChange(clamp(drag.startValue + (delta / DRAG_RANGE_PX) * range));
  };

  const startEditing = () => {
    setDraft(String(Math.round(value * 100) / 100));
    setEditing(true);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const drag = dragState.current;
    dragState.current = null;
    if (drag && !drag.moved) startEditing();
  };

  const commitDraft = () => {
    const parsed = parseFloat(draft);
    if (Number.isFinite(parsed)) {
      onDragStart?.();
      onChange(clamp(parsed));
    }
    setEditing(false);
  };

  const clamped = clamp(value);
  // Unipolar (volume-style): fully filled at 0, draining out toward `min`.
  // Values above 0 are shown fully filled but tinted, since there's no more
  // width to show the boost with.
  const boosted = !bipolar && clamped > 0;
  const unipolarRatio = boosted ? 1 : (clamped - min) / (0 - min);
  const fillStyle: React.CSSProperties = bipolar
    ? clamped < 0
      ? { left: `${50 * (1 + clamped / -min)}%`, right: "50%" }
      : { left: "50%", right: `${50 - (clamped / max) * 50}%` }
    : { left: 0, width: `${Math.max(0, Math.min(1, unipolarRatio)) * 100}%` };

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[8px] uppercase leading-none tracking-wide text-muted">
        {label}
      </span>
      <div
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => {
          onDragStart?.();
          onChange(defaultValue);
        }}
        onKeyDown={(e) => {
          const step = (max - min) / 100;
          if (e.key === "ArrowUp" || e.key === "ArrowRight") {
            onDragStart?.();
            onChange(clamp(value + step));
          } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
            onDragStart?.();
            onChange(clamp(value - step));
          }
        }}
        className="relative h-4 w-[67px] cursor-ns-resize touch-none select-none overflow-hidden rounded-[3px] border border-border bg-black/40"
      >
        <div
          className="absolute inset-y-0"
          style={{
            ...fillStyle,
            background: boosted
              ? "#ffb454"
              : bipolar
                ? "#5eb1ff"
                : "rgba(94,177,255,0.55)",
          }}
        />
        {bipolar && (
          <div className="absolute inset-y-0 left-1/2 w-px bg-border/70" />
        )}
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={commitDraft}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitDraft();
              else if (e.key === "Escape") setEditing(false);
            }}
            className="relative z-10 h-full w-full bg-transparent text-center font-mono text-[10px] text-foreground outline-none"
          />
        ) : (
          <span className="pointer-events-none relative z-10 flex h-full items-center justify-center font-mono text-[10px] text-foreground/90">
            {formatValue(value)}
          </span>
        )}
      </div>
    </div>
  );
}
