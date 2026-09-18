"use client";

import { useCallback, useRef, useState } from "react";

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
}

const MIN_ANGLE = -135;
const MAX_ANGLE = 135;
const DRAG_RANGE_PX = 160; // vertical pixels for a full sweep

export function Knob({
  label,
  value,
  min,
  max,
  defaultValue,
  onChange,
  formatValue,
}: KnobProps) {
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ startY: number; startValue: number } | null>(
    null
  );

  const clamp = useCallback(
    (v: number) => Math.min(max, Math.max(min, v)),
    [min, max]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { startY: e.clientY, startValue: value };
    setDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    const delta = dragState.current.startY - e.clientY;
    const range = max - min;
    const next = clamp(
      dragState.current.startValue + (delta / DRAG_RANGE_PX) * range
    );
    onChange(next);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragState.current = null;
    setDragging(false);
  };

  const handleDoubleClick = () => onChange(defaultValue);

  const ratio = (clamp(value) - min) / (max - min);
  const angle = MIN_ANGLE + ratio * (MAX_ANGLE - MIN_ANGLE);
  const display = formatValue ? formatValue(value) : value.toFixed(1);

  return (
    <div className="flex flex-col items-center gap-1 select-none">
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
        onDoubleClick={handleDoubleClick}
        onKeyDown={(e) => {
          const step = (max - min) / 100;
          if (e.key === "ArrowUp" || e.key === "ArrowRight") {
            onChange(clamp(value + step));
          } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
            onChange(clamp(value - step));
          }
        }}
        className={`relative h-11 w-11 cursor-ns-resize rounded-full border border-border bg-surface-raised shadow-inner touch-none ${
          dragging ? "ring-2 ring-accent" : ""
        }`}
        style={{
          background:
            "radial-gradient(circle at 35% 30%, #2c2c33, #17171a 70%)",
        }}
      >
        <div
          className="absolute inset-0"
          style={{ transform: `rotate(${angle}deg)` }}
        >
          <div className="absolute left-1/2 top-1 h-3.5 w-[3px] -translate-x-1/2 rounded-full bg-accent" />
        </div>
      </div>
      <span className="text-[10px] uppercase tracking-wide text-muted">
        {label}
      </span>
      <span className="font-mono text-[11px] text-foreground/90">
        {display}
      </span>
    </div>
  );
}
