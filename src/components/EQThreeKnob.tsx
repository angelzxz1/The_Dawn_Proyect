"use client";

import { useRef, useState } from "react";

export type EQKnobMode = "bipolar" | "log";

interface EQThreeKnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  mode: EQKnobMode;
  onChange: (value: number) => void;
  formatValue: (value: number) => string;
  /** Fired once, right before the first actual value change of a drag/type/
   * reset gesture - lets the caller push one undo checkpoint per gesture. */
  onDragStart?: () => void;
  /** Pixel diameter of the rendered knob - the full ("EQ Three" window) and
   * compact (FX rack card) views use different sizes of the same knob. */
  size?: number;
  /** Shows the JetBrains-Mono-style value readout box below the knob -
   * only the expanded window has room for it; the compact rack card omits
   * it, matching the design. */
  showReadout?: boolean;
  /** "stacked" (default): label above, knob, readout below, all centered -
   * used everywhere except the full window's crossover row, which instead
   * places the knob beside a [label, readout] column ("inline"). */
  layout?: "stacked" | "inline";
}

// All the knob's geometry lives in a fixed 60x60 viewBox so every size is
// just a CSS scale of the same paths - these constants match the exact
// arcs/radii from the supplied design.
const CENTER = 30;
const TRACK_R = 24;
const INDICATOR_INNER_R = 6;
const INDICATOR_OUTER_R = 14;
const START_ANGLE = -135;
const END_ANGLE = 135;
const SWEEP = END_ANGLE - START_ANGLE;
const DRAG_RANGE_PX = 120; // vertical pixels for a full sweep
const CLICK_MOVE_THRESHOLD = 3;

function pointAtAngle(deg: number, r: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: CENTER + r * Math.sin(rad), y: CENTER - r * Math.cos(rad) };
}

function arcPath(fromDeg: number, toDeg: number, r: number): string {
  if (Math.abs(toDeg - fromDeg) < 0.01) return "";
  const p0 = pointAtAngle(fromDeg, r);
  const p1 = pointAtAngle(toDeg, r);
  const largeArc = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A${r} ${r} 0 ${largeArc} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

/** A knob's "fraction" is its position (0..1) along the full -135..135
 * sweep - unifies dragging/keyboard-nudging across both value curves below. */
function valueToFraction(value: number, min: number, max: number, mode: EQKnobMode): number {
  const v = Math.min(max, Math.max(min, value));
  if (mode === "log") {
    return Math.log(v / min) / Math.log(max / min);
  }
  // bipolar: 0 sits at the knob's center (fraction 0.5); each side scales
  // independently against its own extreme, so turning off-center by the
  // same angle doesn't require the range to be symmetric.
  const angle = v === 0 ? 0 : (v / (v < 0 ? Math.abs(min) : max)) * 135;
  return (angle - START_ANGLE) / SWEEP;
}

function fractionToValue(fraction: number, min: number, max: number, mode: EQKnobMode): number {
  const f = Math.min(1, Math.max(0, fraction));
  if (mode === "log") return min * Math.pow(max / min, f);
  const angle = START_ANGLE + f * SWEEP;
  return angle >= 0 ? (angle / 135) * max : (angle / 135) * Math.abs(min);
}

export function EQThreeKnob({
  label,
  value,
  min,
  max,
  defaultValue,
  mode,
  onChange,
  formatValue,
  onDragStart,
  size = 48,
  showReadout = false,
  layout = "stacked",
}: EQThreeKnobProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const dragState = useRef<{ startY: number; startFraction: number; moved: boolean } | null>(null);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const fraction = valueToFraction(value, min, max, mode);
  const angle = START_ANGLE + fraction * SWEEP;

  const startEditing = () => {
    setDraft(String(Math.round(value * 100) / 100));
    setEditing(true);
  };

  const commitDraft = () => {
    const parsed = parseFloat(draft);
    if (Number.isFinite(parsed)) {
      onDragStart?.();
      onChange(clamp(parsed));
    }
    setEditing(false);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (editing || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { startY: e.clientY, startFraction: fraction, moved: false };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragState.current;
    if (!drag) return;
    const delta = drag.startY - e.clientY;
    if (Math.abs(delta) > CLICK_MOVE_THRESHOLD) {
      if (!drag.moved) onDragStart?.();
      drag.moved = true;
    }
    if (!drag.moved) return;
    const nextFraction = drag.startFraction + delta / DRAG_RANGE_PX;
    onChange(clamp(fractionToValue(nextFraction, min, max, mode)));
  };

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragState.current = null;
  };

  const trackPath = arcPath(START_ANGLE, END_ANGLE, TRACK_R);
  const valuePath =
    mode === "bipolar" ? arcPath(Math.min(0, angle), Math.max(0, angle), TRACK_R) : arcPath(START_ANGLE, angle, TRACK_R);
  const tick = pointAtAngle(0, TRACK_R);
  const indicatorInner = pointAtAngle(angle, INDICATOR_INNER_R);
  const indicatorOuter = pointAtAngle(angle, INDICATOR_OUTER_R);

  const labelEl = (
    <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted">{label}</span>
  );

  const knobEl = (
    <button
      type="button"
      aria-label={`${label}, ${formatValue(value)}`}
      title="Drag to change · right-click to type · double-click to reset"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onContextMenu={(e) => {
        e.preventDefault();
        startEditing();
      }}
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
      style={{ width: size, height: size, touchAction: "none" }}
      className="flex shrink-0 cursor-ns-resize items-center justify-center rounded-full border-0 bg-transparent p-0"
    >
      <svg width={size} height={size} viewBox="0 0 60 60" fill="none" aria-hidden="true">
        <path d={trackPath} stroke="#2E2F37" strokeWidth={4} strokeLinecap="round" />
        <circle cx={tick.x} cy={tick.y} r={1.5} fill="#5A5B64" />
        {valuePath && <path d={valuePath} stroke="#E6AD5E" strokeWidth={4} strokeLinecap="round" />}
        <circle cx={CENTER} cy={CENTER} r={16} fill="#23242B" stroke="#3A3B44" strokeWidth={1} />
        <line
          x1={indicatorInner.x}
          y1={indicatorInner.y}
          x2={indicatorOuter.x}
          y2={indicatorOuter.y}
          stroke="#F4EDE2"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      </svg>
    </button>
  );

  const readoutEl = showReadout ? (
    editing ? (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitDraft();
          else if (e.key === "Escape") setEditing(false);
        }}
        className="w-[60px] rounded border border-border bg-[#14151A] px-2 py-0.5 text-center font-mono text-xs text-[#F4EDE2] outline-none"
      />
    ) : (
      <button
        type="button"
        onContextMenu={(e) => {
          e.preventDefault();
          startEditing();
        }}
        className="min-w-[60px] rounded border border-border bg-[#14151A] px-2 py-0.5 text-center font-mono text-xs font-medium text-[#F4EDE2]"
      >
        {formatValue(value)}
      </button>
    )
  ) : null;

  if (layout === "inline") {
    return (
      <div className="flex items-center gap-2.5">
        {knobEl}
        <div className="flex flex-col gap-1">
          {labelEl}
          {readoutEl}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      {labelEl}
      {knobEl}
      {readoutEl}
    </div>
  );
}
