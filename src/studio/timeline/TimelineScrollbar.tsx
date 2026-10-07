"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/** Height of the timeline scrollbar strip (px). */
export const TIMELINE_SCROLLBAR_HEIGHT = 14;
const MIN_THUMB = 28;

/** An always-visible horizontal scrollbar for the arrangement, pinned under
 * the tracks like Ableton's: drag the thumb, click the track to jump there,
 * or use the mouse wheel over it. It drives (and follows) `target`, the
 * lanes' scroll container, whose own scrollbar is hidden. Drawn by hand so
 * it shows the same everywhere (overlay scrollbars hide until used).
 * `contentWidth` is only there so a zoom re-measures it. */
export function TimelineScrollbar({
  target,
  controls,
  contentWidth,
}: {
  target: RefObject<HTMLDivElement | null>;
  /** The id of the element it scrolls. */
  controls: string;
  contentWidth: number;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, visible: 1, total: 1, track: 1 });
  const drag = useRef<{ startX: number; startLeft: number } | null>(null);

  useEffect(() => {
    const el = target.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const measure = () =>
      setView({ left: el.scrollLeft, visible: el.clientWidth, total: Math.max(el.scrollWidth, 1), track: track.clientWidth });
    measure();
    // The wheel over the bar scrolls sideways only (not the track list too),
    // so it can't be React's passive listener.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      el.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    };
    track.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(track);
    return () => {
      el.removeEventListener("scroll", measure);
      track.removeEventListener("wheel", onWheel);
      observer.disconnect();
    };
  }, [target, contentWidth]);

  const scrollable = view.total - view.visible;
  const thumb = scrollable > 0 ? Math.max(MIN_THUMB, (view.visible / view.total) * view.track) : view.track;
  const room = Math.max(view.track - thumb, 0);
  const thumbLeft = scrollable > 0 ? (view.left / scrollable) * room : 0;
  /** Track pixels -> content pixels. */
  const ratio = room > 0 ? scrollable / room : 0;

  const scrollTo = (left: number) => {
    target.current?.scrollTo({ left: Math.max(0, Math.min(scrollable, left)) });
  };

  return (
    <div
      ref={trackRef}
      role="scrollbar"
      aria-label="Scroll the timeline"
      aria-orientation="horizontal"
      aria-controls={controls}
      aria-valuemin={0}
      aria-valuemax={Math.round(scrollable)}
      aria-valuenow={Math.round(view.left)}
      onPointerDown={(e) => {
        // Clicking the track (not the thumb) centers the view there.
        if (e.target !== e.currentTarget) return;
        const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
        scrollTo((x - thumb / 2) * ratio);
      }}
      className="relative min-w-0 flex-1 cursor-pointer"
      style={{ height: TIMELINE_SCROLLBAR_HEIGHT }}
    >
      {scrollable > 0 && (
        <div
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { startX: e.clientX, startLeft: view.left };
          }}
          onPointerMove={(e) => {
            if (drag.current) scrollTo(drag.current.startLeft + (e.clientX - drag.current.startX) * ratio);
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          title="Drag to scroll the timeline"
          className="absolute top-[3px] h-2 cursor-grab rounded-full bg-muted/50 hover:bg-muted/80 active:cursor-grabbing active:bg-accent/70"
          style={{ left: thumbLeft, width: thumb }}
        />
      )}
    </div>
  );
}
