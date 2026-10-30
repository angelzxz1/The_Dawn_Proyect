"use client";

import { useEffect, useRef, useState } from "react";
import { formatPosition, snapBeats } from "@/project/arrangementLoop";
import { MAX_MARKER_NAME, SECTION_NAMES, suggestMarkerName, type SongMarker } from "@/project/markers";
import { beatAtSeconds, secondsAtBeat, type TempoMap } from "@/project/tempoMap";
import { ContextMenu, type ContextMenuEntry } from "@/studio/shell/ContextMenu";

export const MARKER_LANE_HEIGHT = 16;

interface MarkerLaneProps {
  markers: SongMarker[];
  tempo: TempoMap;
  pxPerSecond: number;
  totalSeconds: number;
  beatsPerBar: number;
  /** The grid a dragged marker snaps to, in beats (it follows the zoom). */
  snapUnit: number;
  onAdd: (beat: number, name: string) => void;
  onRename: (id: string, name: string) => void;
  onMove: (id: string, beat: number) => void;
  onRemove: (id: string) => void;
  /** Moves the playhead to a marker. */
  onJump: (beat: number) => void;
  /** Loops a marker's section. */
  onLoop: (id: string) => void;
}

/** Which name is being typed: a marker's, or a new marker's at a beat. */
type Editing = { id: string } | { beat: number };
type Drag = { id: string; x0: number; beat: number; moved: boolean };
type Menu = { x: number; y: number } & ({ id: string } | { beat: number });

/** The section lane, under the tempo lane: the song's sections (Intro,
 * Verse, Chorus), each from its marker to the next. Double-click to add a
 * marker on the nearest bar, click one to jump there, drag it along the
 * beats (Alt: off the grid), double-click it to rename it, right-click it
 * to loop its section, pick a name or remove it. */
export function MarkerLane({ markers, tempo, pxPerSecond, totalSeconds, beatsPerBar, snapUnit, onAdd, onRename, onMove, onRemove, onJump, onLoop }: MarkerLaneProps) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const strip = useRef<HTMLDivElement>(null);

  const xAt = (beat: number) => secondsAtBeat(tempo, beat) * pxPerSecond;
  const beatAtX = (clientX: number) => {
    const el = strip.current;
    if (!el) return 0;
    return beatAtSeconds(tempo, Math.max(0, (clientX - el.getBoundingClientRect().left) / pxPerSecond));
  };
  const nearestBar = (clientX: number) => Math.max(0, Math.round(beatAtX(clientX) / beatsPerBar)) * beatsPerBar;

  const commit = (value: string) => {
    const target = editing;
    setEditing(null);
    if (!target) return;
    if ("beat" in target) onAdd(target.beat, value);
    else onRename(target.id, value);
  };

  const onMarkerDown = (m: SongMarker, e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const d = { id: m.id, x0: e.clientX, beat: m.beat, moved: false };
    dragRef.current = d;
    setDrag(d);
  };

  const onMarkerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return;
    const next = { ...d, beat: Math.max(0, snapBeats(beatAtX(e.clientX), e.altKey ? 0 : snapUnit)), moved: true };
    dragRef.current = next;
    setDrag(next);
  };

  const onMarkerUp = (m: SongMarker, e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (!d.moved) onJump(m.beat);
    else if (Math.abs(d.beat - m.beat) > 1e-9) onMove(m.id, d.beat);
  };

  const shown = markers.map((m) => (drag?.moved && drag.id === m.id ? { ...m, beat: drag.beat } : m)).sort((a, b) => a.beat - b.beat);
  const width = totalSeconds * pxPerSecond;
  const newAt = editing && "beat" in editing ? editing.beat : null;

  const menuItems = (target: Menu): ContextMenuEntry[] => {
    if ("beat" in target) {
      return [{ label: `Add a marker at ${formatPosition(target.beat, beatsPerBar)}`, onSelect: () => setEditing({ beat: target.beat }) }];
    }
    const m = markers.find((x) => x.id === target.id);
    if (!m) return [];
    return [
      { label: `Go to ${m.name}`, onSelect: () => onJump(m.beat) },
      { label: `Loop ${m.name}`, onSelect: () => onLoop(m.id) },
      { label: "Rename…", onSelect: () => setEditing({ id: m.id }) },
      {
        row: "Name",
        options: SECTION_NAMES.map((name) => ({ label: name, selected: name === m.name, onSelect: () => onRename(m.id, name) })),
      },
      "separator",
      { label: "Remove marker", danger: true, onSelect: () => onRemove(m.id) },
    ];
  };

  return (
    <div
      ref={strip}
      data-testid="marker-lane"
      className="relative select-none border-t border-border/60 bg-surface"
      style={{ height: MARKER_LANE_HEIGHT, width }}
      onDoubleClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const bar = nearestBar(e.clientX);
        const at = markers.find((m) => Math.abs(m.beat - bar) < 1e-6);
        setEditing(at ? { id: at.id } : { beat: bar });
      }}
      onContextMenu={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, beat: nearestBar(e.clientX) });
      }}
      title="Sections: double-click to add a marker on the nearest bar · click a marker to jump there · drag it to move it (Alt: off the grid) · double-click it to rename it · right-click it to loop its section · Shift+M adds one at the playhead, Shift+←/→ jump between them"
    >
      {shown.map((m, i) => {
        const left = xAt(m.beat);
        const end = i + 1 < shown.length ? xAt(shown[i + 1].beat) : width;
        const typing = editing && "id" in editing && editing.id === m.id;
        return (
          // Only its flag takes the pointer: the strip under it is for adding.
          <div key={m.id} className="pointer-events-none absolute top-0 h-full" style={{ left, width: Math.max(0, end - left) }}>
            <span className={`absolute inset-0 ${i % 2 === 0 ? "bg-[#B79BE6]/[0.10]" : "bg-[#B79BE6]/[0.04]"}`} />
            <span className="absolute left-0 top-0 h-full w-px bg-[#B79BE6]/80" />
            {typing ? (
              <NameInput initial={m.name} onCommit={commit} onCancel={() => setEditing(null)} />
            ) : (
              <button
                type="button"
                data-marker={m.id}
                aria-label={`${m.name}, from ${formatPosition(m.beat, beatsPerBar)}: click to jump there`}
                className="pointer-events-auto absolute left-px top-[2px] max-w-full truncate rounded-[2px] bg-[#B79BE6]/25 px-1 text-[8.5px] font-semibold leading-[11px] text-[#D5C6F2] hover:bg-[#B79BE6]/40"
                style={{ cursor: "grab", touchAction: "none" }}
                onPointerDown={(e) => onMarkerDown(m, e)}
                onPointerMove={onMarkerMove}
                onPointerUp={(e) => onMarkerUp(m, e)}
                onPointerCancel={() => {
                  dragRef.current = null;
                  setDrag(null);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditing({ id: m.id });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu({ x: e.clientX, y: e.clientY, id: m.id });
                }}
              >
                {m.name}
              </button>
            )}
          </div>
        );
      })}
      {newAt !== null && (
        <div className="absolute top-0 h-full" style={{ left: xAt(newAt) }}>
          <span className="pointer-events-none absolute left-0 top-0 h-full w-px bg-[#B79BE6]" />
          <NameInput initial={suggestMarkerName(markers)} onCommit={commit} onCancel={() => setEditing(null)} />
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Typing a name: Enter (or leaving it) sets it, Escape doesn't. */
function NameInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (value: string) => void; onCancel: () => void }) {
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
      aria-label="Section name"
      defaultValue={initial}
      maxLength={MAX_MARKER_NAME}
      className="pointer-events-auto absolute left-px top-[1px] z-10 w-24 rounded-[2px] border border-[#B79BE6] bg-surface-raised px-1 text-[9px] leading-[11px] text-foreground outline-none"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(() => onCommit(e.currentTarget.value));
        else if (e.key === "Escape") finish(onCancel);
      }}
      onBlur={(e) => finish(() => onCommit(e.currentTarget.value))}
    />
  );
}
