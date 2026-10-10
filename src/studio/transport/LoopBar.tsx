"use client";

import { useEffect, useRef } from "react";
import {
  beatsToSeconds,
  formatLength,
  formatPosition,
  moveLoop,
  parseLength,
  parsePosition,
  secondsToBeats,
  setLoopEdge,
  snapBeats,
  type ArrangementLoop,
} from "@/project/arrangementLoop";

export const LOOP_BAR_HEIGHT = 14;
const HANDLE_PX = 7;

interface LoopBarProps {
  loop: ArrangementLoop;
  bpm: number;
  pxPerSecond: number;
  totalSeconds: number;
  beatsPerBar: number;
  /** The grid to snap to, in beats (it follows the zoom, like the ruler). */
  snapUnit: number;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onChange: (loop: ArrangementLoop) => void;
}

type Drag = { kind: "move" | "start" | "end" | "draw"; x0: number; loop: ArrangementLoop; anchor: number; moved: boolean };

/** The loop brace, under the ruler (Ableton's): drag it to move the loop,
 * its ends to resize it, or drag on the strip to draw a new one (hold Alt
 * to skip the grid). Click it to select it for the arrow keys; double-click
 * to switch looping on or off. */
export function LoopBar({ loop, bpm, pxPerSecond, totalSeconds, beatsPerBar, snapUnit, selected, onSelect, onChange }: LoopBarProps) {
  const drag = useRef<Drag | null>(null);
  const brace = useRef<HTMLDivElement>(null);
  const toX = (beats: number) => beatsToSeconds(beats, bpm) * pxPerSecond;
  const left = toX(loop.start);
  const width = Math.max(4, toX(loop.end) - left);
  const color = loop.on ? "#E6AD5E" : "#6B6C78";

  // Clicking anywhere else lets go of the selection.
  useEffect(() => {
    if (!selected) return;
    const down = (e: PointerEvent) => !brace.current?.contains(e.target as Node) && onSelect(false);
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, [selected, onSelect]);

  const beatsAt = (clientX: number, el: HTMLElement) => secondsToBeats(Math.max(0, (clientX - el.getBoundingClientRect().left) / pxPerSecond), bpm);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const strip = e.currentTarget;
    strip.setPointerCapture(e.pointerId);
    const x = e.clientX - strip.getBoundingClientRect().left;
    let kind: Drag["kind"] = "draw";
    if (x >= left - 2 && x <= left + width + 2) {
      if (x <= left + HANDLE_PX) kind = "start";
      else if (x >= left + width - HANDLE_PX) kind = "end";
      else kind = "move";
      onSelect(true);
    }
    const anchor = snapBeats(beatsAt(e.clientX, strip), e.altKey ? 0 : snapUnit);
    drag.current = { kind, x0: e.clientX, loop, anchor, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return;
    d.moved = true;
    const unit = e.altKey ? 0 : snapUnit;
    const at = beatsAt(e.clientX, e.currentTarget);
    if (d.kind === "move") {
      const delta = secondsToBeats((e.clientX - d.x0) / pxPerSecond, bpm);
      onChange(moveLoop(d.loop, snapBeats(d.loop.start + delta, unit)));
    } else if (d.kind === "start" || d.kind === "end") {
      onChange(setLoopEdge(d.loop, d.kind, snapBeats(at, unit)));
    } else {
      const cur = snapBeats(at, unit);
      const lo = Math.min(d.anchor, cur);
      const hi = Math.max(d.anchor, cur, lo + Math.max(unit, 0.25));
      onChange({ on: true, start: lo, end: hi });
      onSelect(true);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    drag.current = null;
  };

  const lengthLabel = formatLength(loop.end - loop.start, beatsPerBar);
  return (
    <div
      className="relative select-none bg-surface"
      style={{ height: LOOP_BAR_HEIGHT, width: totalSeconds * pxPerSecond, touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        // The strip holds the pointer while dragging, so the double-click lands here.
        const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
        if (x >= left - 2 && x <= left + width + 2) onChange({ ...loop, on: !loop.on });
      }}
      title="Loop: drag on this strip to draw a loop · drag the brace to move it, its ends to resize it (Alt: off the grid) · double-click it to switch looping on or off · Ctrl+L loops the selected clips"
    >
      <div
        ref={brace}
        role="slider"
        aria-label={`Loop ${loop.on ? "on" : "off"}, from ${formatPosition(loop.start, beatsPerBar)}, length ${lengthLabel}`}
        aria-valuenow={loop.start}
        tabIndex={-1}
        className="absolute top-[2px] flex items-center justify-center overflow-hidden rounded-[3px]"
        style={{
          left,
          width,
          height: LOOP_BAR_HEIGHT - 4,
          background: loop.on ? "rgba(230,173,94,0.85)" : "rgba(120,121,135,0.55)",
          boxShadow: selected ? "0 0 0 1.5px #F4EDE2" : undefined,
          cursor: "grab",
        }}
      >
        <span className="absolute left-0 top-0 h-full cursor-ew-resize" style={{ width: HANDLE_PX, background: color, filter: "brightness(0.75)" }} />
        <span className="absolute right-0 top-0 h-full cursor-ew-resize" style={{ width: HANDLE_PX, background: color, filter: "brightness(0.75)" }} />
        {width > 60 && (
          <span className="pointer-events-none font-mono text-[8.5px] font-semibold leading-none" style={{ color: loop.on ? "#1a1408" : "#E6E6EC" }}>
            {lengthLabel}
          </span>
        )}
      </div>
    </div>
  );
}

/** A bar.beat.sixteenth field: type and press Enter (Escape puts it back). */
function BbsField({
  label,
  value,
  title,
  parse,
  format,
  onCommit,
}: {
  label: string;
  value: string;
  title: string;
  parse: (text: string) => number | null;
  format: (beats: number) => string;
  onCommit: (beats: number) => void;
}) {
  return (
    <label className="flex items-center gap-1" title={title}>
      <span className="text-muted">{label}</span>
      <input
        key={value}
        defaultValue={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            e.currentTarget.value = value;
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => {
          const beats = parse(e.currentTarget.value);
          if (beats === null) {
            e.currentTarget.value = value;
            return;
          }
          // Shown in full ("5" becomes "5.1.1"), even when it didn't change.
          e.currentTarget.value = format(beats);
          if (e.currentTarget.value !== value) onCommit(beats);
        }}
        className="w-[58px] rounded border border-border bg-surface-raised px-1 py-0.5 text-center font-mono text-[11px] text-foreground outline-none focus:border-accent"
      />
    </label>
  );
}

/** The loop's start and length, as bars.beats.sixteenths (like Ableton's control bar). */
export function LoopFields({ loop, beatsPerBar, onChange }: { loop: ArrangementLoop; beatsPerBar: number; onChange: (loop: ArrangementLoop) => void }) {
  return (
    <div className="flex items-center gap-2">
      <BbsField
        label="Start"
        title="Where the loop starts (bar.beat.sixteenth)"
        value={formatPosition(loop.start, beatsPerBar)}
        parse={(t) => parsePosition(t, beatsPerBar)}
        format={(b) => formatPosition(b, beatsPerBar)}
        onCommit={(b) => onChange(moveLoop(loop, b))}
      />
      <BbsField
        label="Length"
        title="How long the loop is (bars.beats.sixteenths)"
        value={formatLength(loop.end - loop.start, beatsPerBar)}
        parse={(t) => parseLength(t, beatsPerBar)}
        format={(b) => formatLength(b, beatsPerBar)}
        onCommit={(b) => onChange({ ...loop, end: loop.start + b })}
      />
    </div>
  );
}
