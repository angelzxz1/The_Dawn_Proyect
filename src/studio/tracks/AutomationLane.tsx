"use client";

import { useState } from "react";
import type { AutomationPoint } from "@/project/types";
import type { TrackColor } from "@/project/colors";
import { computeAdaptiveMarks } from "@/studio/timeline/layout";
import { NO_GRID, type Grid, type TempoMap } from "@/project/tempoMap";
import type { ClipTool } from "@/studio/timeline/clipTools";
import { curveShape } from "@/engine/automation";
import { bendSegment, drawLine, drawStroke, eraseSpan, segmentAt, type CurvePoint } from "@/project/curveEdits";

let pointIdCounter = 0;
function newPointId(): string {
  pointIdCounter += 1;
  return `autopt-${pointIdCounter}`;
}

const POINT_RADIUS = 4;
/** With the grid off, a freehand stroke keeps a point this often (px). */
const FREEHAND_STEP_PX = 8;
/** A bent segment is drawn in steps this long (px). */
const CURVE_STEP_PX = 4;

const byTime = (a: AutomationPoint, b: AutomationPoint) => a.time - b.time;

interface AutomationLaneProps {
  points: AutomationPoint[];
  valueMin: number;
  valueMax: number;
  /** The target's own live value (the channel's Vol/Pan ValueBar, or the
   * effect's own knob) - drawn as a dashed reference line, Ableton-style,
   * showing where the parameter actually sits when no automation point is
   * driving it at the playhead's current time. */
  currentValue: number;
  totalSeconds: number;
  pxPerSecond: number;
  /** Where the beats are, for the grid. */
  tempo: TempoMap;
  beatsPerBar: number;
  height: number;
  color: TrackColor;
  formatValue?: (v: number) => string;
  /** The arrangement's edit tool: the draw tool draws freehand, the erase
   * tool erases; the others edit points. */
  tool?: ClipTool;
  /** The snap grid lines and freehand strokes keep to (Alt: free). */
  grid?: Grid;
  /** The new points, sorted by time. */
  onChange: (points: AutomationPoint[]) => void;
  /** Fired once at the start of an add/move/delete gesture, so the caller
   * can push one undo checkpoint per gesture. */
  onDragStart?: () => void;
}

const TITLES: Partial<Record<ClipTool, string>> & { pointer: string } = {
  pointer:
    "Click to add a point · drag a point to move it · right-click a point to delete it · Shift-drag to draw a straight line (a ramp) · Alt-drag a segment to bend it into a curve",
  draw: "Drag to draw the curve freehand, a point per grid line · Shift-drag for a straight line",
  erase: "Drag across points to delete them",
};

/**
 * One channel's automation curve for a single target (volume, pan, or one
 * effect param), drawn across the arrangement timeline. Points are joined
 * by lines, each bent by its first point's curve; flat before the first
 * point and after the last, as the engine reads it (engine/automation.ts).
 * With the pointer: click to add a point, drag one to move it, right-click
 * it to delete it, Shift-drag for a straight line over what's there,
 * Alt-drag a segment to bend it. The draw tool draws freehand; the erase
 * tool erases what it passes over.
 */
export function AutomationLane({
  points,
  valueMin,
  valueMax,
  currentValue,
  totalSeconds,
  pxPerSecond,
  tempo,
  beatsPerBar,
  height,
  color,
  formatValue,
  tool = "pointer",
  grid = NO_GRID,
  onChange,
  onDragStart,
}: AutomationLaneProps) {
  const width = totalSeconds * pxPerSecond;
  const range = valueMax - valueMin || 1;
  const marks = computeAdaptiveMarks(tempo, totalSeconds, pxPerSecond, beatsPerBar);
  /** A straight line being drawn (from, to), to show it as it goes. */
  const [line, setLine] = useState<[CurvePoint, CurvePoint] | null>(null);

  const valueToY = (v: number) => height - ((v - valueMin) / range) * height;
  const yToValue = (y: number) => Math.min(valueMax, Math.max(valueMin, valueMin + (1 - y / height) * range));
  const xToTime = (x: number) => Math.min(totalSeconds, Math.max(0, x / pxPerSecond));
  const change = (next: AutomationPoint[]) => onChange([...next].sort(byTime));

  const sorted = [...points].sort(byTime);
  const freehand = tool === "draw";
  const erasing = tool === "erase";

  /** Follows a drag on the lane: `move` gets each place the pointer goes. */
  const follow = (e: React.PointerEvent<HTMLDivElement>, move: (at: CurvePoint, ev: PointerEvent) => void, done?: () => void) => {
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    target.setPointerCapture(e.pointerId);
    const at = (ev: { clientX: number; clientY: number }) => ({ time: xToTime(ev.clientX - rect.left), value: yToValue(ev.clientY - rect.top) });
    onDragStart?.();
    move(at(e), e.nativeEvent);
    const onMove = (ev: PointerEvent) => move(at(ev), ev);
    const onUp = () => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      done?.();
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  const handleBackgroundPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const base = sorted;
    const onGrid = (time: number, free: boolean) => (free ? time : Math.min(totalSeconds, Math.max(0, grid.snap(time))));

    if (erasing) {
      let from: number | null = null;
      return follow(e, (at) => {
        from ??= at.time;
        change(eraseSpan(base, from - POINT_RADIUS / pxPerSecond, at.time + POINT_RADIUS / pxPerSecond));
      });
    }
    if (e.shiftKey) {
      // A straight line from where the drag began.
      let from: CurvePoint | null = null;
      return follow(
        e,
        (at, ev) => {
          from ??= { time: onGrid(at.time, ev.altKey), value: at.value };
          const to = { time: onGrid(at.time, ev.altKey), value: at.value };
          setLine([from, to]);
          change(drawLine(base, from, to, newPointId));
        },
        () => setLine(null)
      );
    }
    if (freehand) {
      // A point per grid line the stroke crosses (or every few pixels),
      // each where the pointer last was over it.
      const stroke = new Map<number, CurvePoint>();
      const step = FREEHAND_STEP_PX / pxPerSecond;
      return follow(e, (at, ev) => {
        const time = grid.stepBeats > 0 && !ev.altKey ? onGrid(at.time, false) : Math.round(at.time / step) * step;
        stroke.set(Math.round(time * 1e6), { time, value: at.value });
        change(drawStroke(base, [...stroke.values()], newPointId));
      });
    }
    if (e.altKey) {
      // Bend the segment under the pointer toward it.
      const rect = e.currentTarget.getBoundingClientRect();
      const i = segmentAt(base, xToTime(e.clientX - rect.left));
      if (i < 0) return;
      return follow(e, (at) => change(bendSegment(base, i, at.value)));
    }
    const rect = e.currentTarget.getBoundingClientRect();
    onDragStart?.();
    change([...base, { id: newPointId(), time: xToTime(e.clientX - rect.left), value: yToValue(e.clientY - rect.top) }]);
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
      change(points.map((p) => (p.id === id ? { ...p, time, value } : p)));
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
    change(points.filter((p) => p.id !== id));
  };

  /** The curve as drawn: flat to the first point, each segment (bent ones
   * in small steps), flat from the last. */
  const linePoints = (() => {
    if (sorted.length === 0) return "";
    const xy = (time: number, value: number) => `${time * pxPerSecond},${valueToY(value)}`;
    const out = [`0,${valueToY(sorted[0].value)}`];
    sorted.forEach((p, i) => {
      out.push(xy(p.time, p.value));
      const next = sorted[i + 1];
      if (!next || !p.curve) return;
      const steps = Math.max(2, Math.ceil(((next.time - p.time) * pxPerSecond) / CURVE_STEP_PX));
      for (let s = 1; s < steps; s++) {
        const r = s / steps;
        out.push(xy(p.time + (next.time - p.time) * r, p.value + (next.value - p.value) * curveShape(r, p.curve)));
      }
    });
    out.push(`${width},${valueToY(sorted[sorted.length - 1].value)}`);
    return out.join(" ");
  })();

  return (
    <div
      onPointerDown={handleBackgroundPointerDown}
      title={TITLES[tool] ?? TITLES.pointer}
      data-automation-lane
      className="relative cursor-crosshair"
      style={{ width, height, touchAction: "none" }}
    >
      {marks.map((mark) => (
        <div
          key={mark.index}
          className="pointer-events-none absolute top-0 h-full"
          style={{
            left: mark.left,
            borderLeft: `1px solid ${
              mark.strength === "bar"
                ? "rgba(230,230,235,0.22)"
                : mark.strength === "beat"
                  ? "rgba(230,230,235,0.1)"
                  : "rgba(230,230,235,0.045)"
            }`,
          }}
        />
      ))}
      <svg className="pointer-events-none absolute inset-0" width={width} height={height}>
        <line
          x1={0}
          y1={valueToY(currentValue)}
          x2={width}
          y2={valueToY(currentValue)}
          stroke={color.accent}
          strokeWidth={1}
          strokeDasharray="3,3"
          opacity={0.5}
        />
        {sorted.length > 0 && <polyline data-automation-curve points={linePoints} fill="none" stroke={color.accent} strokeWidth={1.5} />}
        {line && (
          <line
            x1={line[0].time * pxPerSecond}
            y1={valueToY(line[0].value)}
            x2={line[1].time * pxPerSecond}
            y2={valueToY(line[1].value)}
            stroke="white"
            strokeWidth={1}
            strokeDasharray="2,2"
            opacity={0.6}
          />
        )}
      </svg>
      {sorted.map((p) => (
        <div
          key={p.id}
          data-automation-point={p.id}
          onPointerDown={(e) => handlePointPointerDown(e, p.id)}
          onContextMenu={(e) => handlePointContextMenu(e, p.id)}
          title={formatValue ? formatValue(p.value) : String(p.value)}
          // The draw and erase tools work across the points.
          className={`absolute cursor-grab rounded-full border border-black/40 active:cursor-grabbing ${freehand || erasing ? "pointer-events-none" : ""}`}
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
