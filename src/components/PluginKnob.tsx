"use client";

import { useRef, useState } from "react";

export type KnobMode = "bipolar" | "log" | "linear";

interface PluginKnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  mode: KnobMode;
  onChange: (value: number) => void;
  formatValue: (value: number) => string;
  /** Fired once, right before the first actual value change of a drag/type/
   * reset gesture - lets the caller push one undo checkpoint per gesture. */
  onDragStart?: () => void;
  /** Pixel diameter of the rendered knob - full plugin windows and compact
   * FX rack cards use different sizes of the same knob. */
  size?: number;
  /** Shows the JetBrains-Mono-style value readout box below the knob -
   * only the expanded windows have room for it; compact rack cards omit
   * it (though the knob is still directly click-to-edit either way). */
  showReadout?: boolean;
  /** "stacked" (default): label above, knob, readout below, all centered -
   * used everywhere except a window's crossover-style row, which instead
   * places the knob beside a [label, readout] column ("inline"). */
  layout?: "stacked" | "inline";
  /** Greys the knob out and disables its own interaction - used for the
   * Compressor's Makeup knob while Auto Makeup is on (it still shows the
   * live computed value, just can't be dragged/typed into). */
  disabled?: boolean;
}

// All the knob's geometry lives in a fixed 60x60 viewBox so every size is
// just a CSS scale of the same paths.
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
 * sweep - unifies dragging/keyboard-nudging across every value curve below. */
function valueToFraction(value: number, min: number, max: number, mode: KnobMode): number {
  const v = Math.min(max, Math.max(min, value));
  if (mode === "log") {
    return Math.log(v / min) / Math.log(max / min);
  }
  if (mode === "linear") {
    return (v - min) / (max - min);
  }
  // bipolar: 0 sits at the knob's center (fraction 0.5); each side scales
  // independently against its own extreme, so turning off-center by the
  // same angle doesn't require the range to be symmetric.
  const angle = v === 0 ? 0 : (v / (v < 0 ? Math.abs(min) : max)) * 135;
  return (angle - START_ANGLE) / SWEEP;
}

function fractionToValue(fraction: number, min: number, max: number, mode: KnobMode): number {
  const f = Math.min(1, Math.max(0, fraction));
  if (mode === "log") return min * Math.pow(max / min, f);
  if (mode === "linear") return min + f * (max - min);
  const angle = START_ANGLE + f * SWEEP;
  return angle >= 0 ? (angle / 135) * max : (angle / 135) * Math.abs(min);
}

/** A reusable circular plugin knob - drag to change, click (no movement) or
 * right-click to type an exact value, double-click to reset. Used by every
 * custom effect plugin UI (EQ Three, Compressor, ...) in both their compact
 * FX-rack card and their full floating window. */
export function PluginKnob({
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
  disabled = false,
}: PluginKnobProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const dragState = useRef<{ startY: number; startFraction: number; moved: boolean } | null>(null);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const fraction = valueToFraction(value, min, max, mode);
  const angle = START_ANGLE + fraction * SWEEP;

  const startEditing = () => {
    if (disabled) return;
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

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editing || disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { startY: e.clientY, startFraction: fraction, moved: false };
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
    const nextFraction = drag.startFraction + delta / DRAG_RANGE_PX;
    onChange(clamp(fractionToValue(nextFraction, min, max, mode)));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const drag = dragState.current;
    dragState.current = null;
    // A plain click (pointer never moved beyond the threshold) opens the
    // type-in editor, same convention as the generic ValueBar control.
    if (drag && !drag.moved) startEditing();
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

  // The interactive host is a plain div (not a button) so the edit input
  // below can live inside it as a sibling without creating invalid nested-
  // interactive-content markup - and, importantly, so a dblclick's second
  // click (which may land on that input once the first click opened it)
  // still bubbles up to this same persistent element's onDoubleClick.
  const knobEl = (
    <div
      role="slider"
      aria-label={`${label}, ${formatValue(value)}`}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      title={disabled ? undefined : "Drag to change · click or right-click to type · double-click to reset"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onContextMenu={(e) => {
        e.preventDefault();
        startEditing();
      }}
      onDoubleClick={() => {
        if (disabled) return;
        // The double-click's first click, taken alone, already looks like a
        // plain click and opens the editor above (see endDrag) - close it
        // back out here so a real double-click still resets cleanly instead
        // of leaving a stray input open.
        setEditing(false);
        onDragStart?.();
        onChange(defaultValue);
      }}
      onKeyDown={(e) => {
        if (disabled) return;
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
      className={`relative flex shrink-0 items-center justify-center rounded-full ${
        disabled ? "cursor-default opacity-45" : "cursor-ns-resize"
      }`}
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
      {editing && (
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
          className="absolute left-1/2 top-1/2 z-10 w-14 -translate-x-1/2 -translate-y-1/2 rounded border border-accent bg-[#14151A] px-1 py-0.5 text-center font-mono text-[11px] text-[#F4EDE2] outline-none"
        />
      )}
    </div>
  );

  const readoutEl = showReadout ? (
    <button
      type="button"
      tabIndex={-1}
      onClick={startEditing}
      onContextMenu={(e) => {
        e.preventDefault();
        startEditing();
      }}
      disabled={disabled}
      className="min-w-[60px] rounded border border-border bg-[#14151A] px-2 py-0.5 text-center font-mono text-xs font-medium text-[#F4EDE2] disabled:opacity-60"
    >
      {formatValue(value)}
    </button>
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
