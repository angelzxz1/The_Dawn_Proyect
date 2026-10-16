"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatPosition, snapBeats } from "@/project/arrangementLoop";
import { beatAtSeconds, clampBpm, formatBpm, makeTempoMap, secondsAtBeat, type TempoChange, type TempoMap } from "@/project/tempoMap";

export const TEMPO_LANE_HEIGHT = 16;

interface TempoLaneProps {
  tempo: TempoMap;
  pxPerSecond: number;
  totalSeconds: number;
  beatsPerBar: number;
  /** The grid a dragged change snaps to, in beats (it follows the zoom). */
  snapUnit: number;
  /** A new map: the starting tempo and the changes after it. */
  onChange: (bpm: number, changes: TempoChange[]) => void;
}

/** Which marker is being typed into: the start (index 0), a change
 * (index into the changes + 1), or a new change at a beat. */
type Editing = { index: number } | { beat: number };
type Drag = { index: number; x0: number; beat: number; moved: boolean };

/** The tempo lane, under the loop brace: the song's tempo and where it
 * changes. Double-click to add a change on the nearest bar, click a tempo
 * to type a new one, drag a change along the beats (Alt: off the grid),
 * right-click one to remove it. Clips that follow the beat move with it
 * (tempoEdits.ts). */
export function TempoLane({ tempo, pxPerSecond, totalSeconds, beatsPerBar, snapUnit, onChange }: TempoLaneProps) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const { bpm, changes } = tempo;

  // While dragging, the map with the change where it's being dragged to.
  const shown = useMemo(() => {
    if (!drag?.moved) return tempo;
    return makeTempoMap(bpm, changes.map((c, i) => (i === drag.index - 1 ? { ...c, beat: drag.beat } : c)));
  }, [tempo, bpm, changes, drag]);

  const commit = (value: string) => {
    const target = editing;
    setEditing(null);
    const parsed = Number(value);
    if (!target || !Number.isFinite(parsed) || parsed <= 0) return;
    const next = clampBpm(parsed);
    if ("beat" in target) onChange(bpm, [...changes, { beat: target.beat, bpm: next }]);
    else if (target.index === 0) onChange(next, changes);
    else onChange(bpm, changes.map((c, i) => (i === target.index - 1 ? { ...c, bpm: next } : c)));
  };

  const beatAtX = (map: TempoMap, clientX: number, el: HTMLElement) =>
    beatAtSeconds(map, Math.max(0, (clientX - el.getBoundingClientRect().left) / pxPerSecond));

  const strip = useRef<HTMLDivElement>(null);

  const onMarkerDown = (index: number, e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const d = { index, x0: e.clientX, beat: index === 0 ? 0 : changes[index - 1].beat, moved: false };
    dragRef.current = d;
    setDrag(d);
  };

  const onMarkerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    const el = strip.current;
    // The start doesn't move.
    if (!d || !el || d.index === 0) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return;
    // Under the pointer on the map without this change (which is the new
    // map up to it), between its neighbours.
    const without = makeTempoMap(bpm, changes.filter((_, i) => i !== d.index - 1));
    const unit = e.altKey ? 0 : snapUnit;
    const lo = d.index > 1 ? changes[d.index - 2].beat : 0;
    const hi = d.index < changes.length ? changes[d.index].beat : Infinity;
    const step = unit > 0 ? unit : 0.25;
    const beat = Math.min(hi - step, Math.max(lo + step, snapBeats(beatAtX(without, e.clientX, el), unit)));
    const next = { ...d, beat, moved: true };
    dragRef.current = next;
    setDrag(next);
  };

  const onMarkerUp = (index: number, e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (!d.moved) setEditing({ index });
    else if (Math.abs(d.beat - changes[index - 1].beat) > 1e-9) {
      onChange(bpm, changes.map((c, i) => (i === index - 1 ? { ...c, beat: d.beat } : c)));
    }
  };

  // A double-click on the strip: a change on the nearest bar (or the one
  // already there, to type into).
  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const bar = Math.max(1, Math.round(beatAtX(tempo, e.clientX, e.currentTarget) / beatsPerBar)) * beatsPerBar;
    const at = changes.findIndex((c) => Math.abs(c.beat - bar) < 1e-6);
    setEditing(at >= 0 ? { index: at + 1 } : { beat: bar });
  };

  const markers = shown.segments.map((s, index) => ({ index, beat: s.beat, bpm: s.bpm, left: s.seconds * pxPerSecond }));
  const newAt = editing && "beat" in editing ? editing.beat : null;

  return (
    <div
      ref={strip}
      data-testid="tempo-lane"
      className="relative select-none border-t border-border/60 bg-surface"
      style={{ height: TEMPO_LANE_HEIGHT, width: totalSeconds * pxPerSecond }}
      onDoubleClick={onDoubleClick}
      title="Tempo: double-click to add a tempo change on the nearest bar · click a tempo to type a new one · drag a change to move it (Alt: off the grid) · right-click a change to remove it"
    >
      {markers.map((m) => {
        const typing = editing && "index" in editing && editing.index === m.index;
        return (
          <div key={m.index} className="absolute top-0 h-full" style={{ left: m.left }}>
            <span className="pointer-events-none absolute left-0 top-0 h-full w-px bg-[#7FB4E6]/70" />
            {typing ? (
              <BpmInput initial={m.bpm} onCommit={commit} onCancel={() => setEditing(null)} />
            ) : (
              <button
                type="button"
                data-tempo-marker={m.index}
                aria-label={`Tempo ${formatBpm(m.bpm)} BPM from ${formatPosition(m.beat, beatsPerBar)}${m.index === 0 ? " (the song's start)" : ""}`}
                className="absolute left-px top-[2px] rounded-[2px] bg-[#7FB4E6]/20 px-1 font-mono text-[8.5px] font-semibold leading-[11px] text-[#A9CDEE] hover:bg-[#7FB4E6]/35"
                style={{ cursor: m.index === 0 ? "text" : "grab", touchAction: "none" }}
                onPointerDown={(e) => onMarkerDown(m.index, e)}
                onPointerMove={onMarkerMove}
                onPointerUp={(e) => onMarkerUp(m.index, e)}
                onPointerCancel={() => {
                  dragRef.current = null;
                  setDrag(null);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (m.index > 0) onChange(bpm, changes.filter((_, i) => i !== m.index - 1));
                }}
              >
                {formatBpm(m.bpm)}
              </button>
            )}
          </div>
        );
      })}
      {newAt !== null && (
        <div className="absolute top-0 h-full" style={{ left: secondsAtBeat(tempo, newAt) * pxPerSecond }}>
          <span className="pointer-events-none absolute left-0 top-0 h-full w-px bg-[#7FB4E6]" />
          <BpmInput initial={tempo.segments.findLast((s) => s.beat <= newAt)?.bpm ?? bpm} onCommit={commit} onCancel={() => setEditing(null)} />
        </div>
      )}
    </div>
  );
}

/** Typing a tempo: Enter (or leaving it) sets it, Escape doesn't. */
function BpmInput({ initial, onCommit, onCancel }: { initial: number; onCommit: (value: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };
  return (
    <input
      ref={ref}
      aria-label="Tempo (BPM)"
      defaultValue={formatBpm(initial)}
      inputMode="decimal"
      className="absolute left-px top-[1px] z-10 w-11 rounded-[2px] border border-[#7FB4E6] bg-surface-raised px-1 font-mono text-[9px] leading-[11px] text-foreground outline-none"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(() => onCommit(e.currentTarget.value));
        else if (e.key === "Escape") finish(onCancel);
      }}
      onBlur={(e) => finish(() => onCommit(e.currentTarget.value))}
    />
  );
}
