"use client";

import type { AutomationPoint } from "@/lib/types";
import type { TrackColor } from "@/lib/colors";

let pointIdCounter = 0;
function newPointId(): string {
  pointIdCounter += 1;
  return `autopt-${pointIdCounter}`;
}

const POINT_RADIUS = 4;

interface AutomationLaneProps {
  points: AutomationPoint[];
  valueMin: number;
  valueMax: number;
  totalSeconds: number;
  pxPerSecond: number;
  height: number;
  color: TrackColor;
  formatValue?: (v: number) => string;
  onChange: (points: AutomationPoint[]) => void;
  /** Fired once at the start of an add/move/delete gesture, so the caller
   * can push one undo checkpoint per gesture. */
  onDragStart?: () => void;
}

/**
 * One channel's automation curve for a single target (volume, pan, or one
 * effect param), drawn across the arrangement timeline: click empty space
 * to add a point, drag a point to move it, right-click a point to delete
 * it. Flat before the first point and after the last, matching exactly how
 * the engine's playback interpolation (see audioEngine.ts) reads the curve.
 */
export function AutomationLane({
  points,
  valueMin,
  valueMax,
  totalSeconds,
  pxPerSecond,
  height,
  color,
  formatValue,
  onChange,
  onDragStart,
}: AutomationLaneProps) {
  const width = totalSeconds * pxPerSecond;
  const range = valueMax - valueMin || 1;

  const valueToY = (v: number) => height - ((v - valueMin) / range) * height;
  const yToValue = (y: number) =>
    Math.min(valueMax, Math.max(valueMin, valueMin + (1 - y / height) * range));
  const xToTime = (x: number) => Math.min(totalSeconds, Math.max(0, x / pxPerSecond));

  const sorted = [...points].sort((a, b) => a.time - b.time);

  const handleBackgroundPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const time = xToTime(e.clientX - rect.left);
    const value = yToValue(e.clientY - rect.top);
    onDragStart?.();
    onChange([...points, { id: newPointId(), time, value }]);
  };

  const handlePointPointerDown = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const container = e.currentTarget.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let started = false;

    const onMove = (ev: PointerEvent) => {
      if (!started) {
        started = true;
        onDragStart?.();
      }
      const time = xToTime(ev.clientX - rect.left);
      const value = yToValue(ev.clientY - rect.top);
      onChange(points.map((p) => (p.id === id ? { ...p, time, value } : p)));
    };
    const onUp = () => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  const handlePointContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    onDragStart?.();
    onChange(points.filter((p) => p.id !== id));
  };

  const linePoints: string =
    sorted.length === 0
      ? ""
      : sorted.length === 1
        ? `0,${valueToY(sorted[0].value)} ${width},${valueToY(sorted[0].value)}`
        : [
            `0,${valueToY(sorted[0].value)}`,
            ...sorted.map((p) => `${p.time * pxPerSecond},${valueToY(p.value)}`),
            `${width},${valueToY(sorted[sorted.length - 1].value)}`,
          ].join(" ");

  return (
    <div
      onPointerDown={handleBackgroundPointerDown}
      title="Click to add an automation point · drag a point to move it · right-click a point to delete it"
      className="relative cursor-crosshair"
      style={{ width, height }}
    >
      {sorted.length > 0 && (
        <svg className="pointer-events-none absolute inset-0" width={width} height={height}>
          <polyline points={linePoints} fill="none" stroke={color.accent} strokeWidth={1.5} />
        </svg>
      )}
      {sorted.map((p) => (
        <div
          key={p.id}
          onPointerDown={(e) => handlePointPointerDown(e, p.id)}
          onContextMenu={(e) => handlePointContextMenu(e, p.id)}
          title={formatValue ? formatValue(p.value) : String(p.value)}
          className="absolute cursor-grab rounded-full border border-black/40 active:cursor-grabbing"
          style={{
            left: p.time * pxPerSecond - POINT_RADIUS,
            top: valueToY(p.value) - POINT_RADIUS,
            width: POINT_RADIUS * 2,
            height: POINT_RADIUS * 2,
            background: color.accent,
          }}
        />
      ))}
    </div>
  );
}
