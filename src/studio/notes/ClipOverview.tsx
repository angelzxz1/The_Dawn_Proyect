"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/** Height of the overview strip (px). */
export const OVERVIEW_H = 24;
/** Bar lines closer than this (px) are thinned out. */
const MIN_BAR_GAP = 6;

export interface OverviewNote {
  midi: number;
  time: number;
  duration: number;
}

type Part = "start" | "end" | "box";

/** The whole clip in miniature over the piano roll, like Ableton's clip
 * overview: a box marks the part the editor shows. Drag the box to scroll,
 * drag either of its edges to zoom (the other edge stays put), click
 * outside it to jump there, and double-click to show the whole clip. It
 * follows `target`, the note grid's scroll container. */
export function ClipOverview({
  target,
  controls,
  length,
  pxPerSecond,
  secondsPerBar,
  notes,
  color,
  playheadRef,
  onScroll,
  onShow,
}: {
  target: RefObject<HTMLDivElement | null>;
  /** The id of the element it scrolls. */
  controls: string;
  /** The clip's length (seconds): the strip's whole width. */
  length: number;
  pxPerSecond: number;
  secondsPerBar: number;
  notes: readonly OverviewNote[];
  color: string;
  /** The playhead's mark, moved by the editor's animation loop. */
  playheadRef: RefObject<HTMLDivElement | null>;
  /** Moves the view so it starts at this time (seconds). */
  onScroll: (left: number) => void;
  /** Zooms so the span from `left` (seconds) fills the view, keeping its
   * start or its end where it is. */
  onShow: (left: number, span: number, keep: "start" | "end") => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  /** What the editor shows, in seconds, and the strip's width. */
  const [view, setView] = useState({ left: 0, span: length, width: 0 });
  const drag = useRef<{ part: Part; startX: number; left: number; span: number } | null>(null);

  useEffect(() => {
    const el = target.current;
    const strip = stripRef.current;
    if (!el || !strip) return;
    const measure = () =>
      setView({ left: el.scrollLeft / pxPerSecond, span: Math.min(length, el.clientWidth / pxPerSecond), width: strip.clientWidth });
    measure();
    // The wheel over the strip scrolls sideways (so it can't be React's
    // passive listener).
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      el.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(strip);
    return () => {
      el.removeEventListener("scroll", measure);
      strip.removeEventListener("wheel", onWheel);
      observer.disconnect();
    };
  }, [target, pxPerSecond, length]);

  /** Strip pixels -> seconds. */
  const secondsPerPx = () => length / Math.max(1, stripRef.current?.clientWidth ?? 1);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const part = (e.target as HTMLElement).dataset.part as Part | undefined;
    let left = view.left;
    if (!part) {
      // Outside the box: center the view there, then drag on from it.
      const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
      left = Math.max(0, Math.min(length - view.span, x * secondsPerPx() - view.span / 2));
      onScroll(left);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { part: part ?? "box", startX: e.clientX, left, span: view.span };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const delta = (e.clientX - d.startX) * secondsPerPx();
    const right = d.left + d.span;
    if (d.part === "box") {
      onScroll(Math.max(0, Math.min(length - d.span, d.left + delta)));
    } else if (d.part === "start") {
      const left = Math.max(0, Math.min(right - 0.01, d.left + delta));
      onShow(left, right - left, "end");
    } else {
      const end = Math.max(d.left + 0.01, Math.min(length, right + delta));
      onShow(d.left, end - d.left, "start");
    }
  };

  const endDrag = () => (drag.current = null);

  // Bar lines, thinned out to every 2nd, 4th... bar when they'd crowd.
  const bars = Math.ceil(length / secondsPerBar - 1e-6);
  let every = 1;
  while (view.width > 0 && (every * secondsPerBar * view.width) / length < MIN_BAR_GAP) every *= 2;
  const barLines: number[] = [];
  for (let b = every; b < bars; b += every) barLines.push((b * secondsPerBar) / length);

  // The notes, squeezed into the strip's height by their pitch range.
  const midis = notes.map((n) => n.midi);
  const high = midis.length ? Math.max(...midis) : 0;
  const rows = midis.length ? high - Math.min(...midis) + 1 : 1;
  const rowH = (OVERVIEW_H - 6) / rows;
  const pct = (seconds: number) => `${(seconds / length) * 100}%`;

  return (
    <div
      ref={stripRef}
      role="scrollbar"
      aria-label="Scroll and zoom the notes"
      aria-orientation="horizontal"
      aria-controls={controls}
      aria-valuemin={0}
      aria-valuemax={Math.round(Math.max(0, length - view.span) * 1000)}
      aria-valuenow={Math.round(view.left * 1000)}
      title="Drag to scroll · drag the box's edges to zoom · double-click to show the whole clip"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onShow(0, length, "start")}
      className="relative min-w-0 flex-1 cursor-pointer select-none overflow-hidden bg-black/40"
      style={{ height: OVERVIEW_H }}
    >
      {barLines.map((x) => (
        <div key={x} className="pointer-events-none absolute top-0 h-full border-l border-white/10" style={{ left: `${x * 100}%` }} />
      ))}
      {notes.map((n, i) => (
        <div
          key={i}
          className="pointer-events-none absolute rounded-[1px]"
          style={{
            left: pct(n.time),
            width: `max(1px, ${pct(n.duration)})`,
            top: 3 + (high - n.midi) * rowH,
            height: Math.max(1, rowH),
            background: color,
          }}
        />
      ))}
      <div
        data-part="box"
        title="Drag to scroll"
        className="absolute top-0 h-full cursor-grab rounded-[2px] border border-foreground/70 bg-foreground/10 active:cursor-grabbing"
        style={{ left: pct(view.left), width: pct(view.span) }}
      >
        <div data-part="start" title="Drag to zoom" className="absolute -left-1 top-0 h-full w-2 cursor-ew-resize" />
        <div data-part="end" title="Drag to zoom" className="absolute -right-1 top-0 h-full w-2 cursor-ew-resize" />
      </div>
      <div ref={playheadRef} className="pointer-events-none absolute top-0 h-full w-px bg-record" style={{ left: 0, opacity: 0 }} />
    </div>
  );
}
