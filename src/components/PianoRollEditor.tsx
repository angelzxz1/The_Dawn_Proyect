"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, MousePointer2, X, ZoomIn, ZoomOut } from "lucide-react";
import { isBlackKey, midiToNoteName } from "@/lib/piano";
import { isNoteInScale, SCALE_ROOTS, type ScaleSetting } from "@/lib/scales";
import type { NoteEvent } from "@/lib/types";
import type { TrackColor } from "@/lib/colors";
import { ScaleSelector } from "./ScaleSelector";

interface PianoRollEditorProps {
  channelName: string;
  color: TrackColor;
  notes: NoteEvent[];
  length: number;
  bpm: number;
  beatsPerBar: number;
  scaleSetting: ScaleSetting;
  onScaleChange: (setting: ScaleSetting) => void;
  onChange: (notes: NoteEvent[]) => void;
  onClose: () => void;
  onPreviewNote: (note: string) => void;
}

interface EditableNote extends NoteEvent {
  id: string;
}

type Mode = "draw" | "select";

let idCounter = 0;
function withIds(notes: NoteEvent[]): EditableNote[] {
  return notes.map((n) => ({ ...n, id: `n${idCounter++}` }));
}
function stripIds(notes: EditableNote[]): NoteEvent[] {
  return notes.map((n) => ({
    note: n.note,
    time: n.time,
    duration: n.duration,
    velocity: n.velocity,
  }));
}

const MIN_MIDI = 24; // C1
const MAX_MIDI = 108; // C8
const ROW_H = 14;
const KEY_COL_WIDTH = 44;
const RULER_H = 22;
const GRID_VIEWPORT_H = 380;
const VELOCITY_H = 72;
const DEFAULT_PX_PER_SECOND = 130;
const MIN_PX_PER_SECOND = 40;
const MAX_PX_PER_SECOND = 500;
const DEFAULT_NOTE_BEATS = 1; // default drawn-note length, in beats
const DRAG_THRESHOLD_PX = 3;

function noteNameToMidi(name: string): number {
  const match = name.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return 60;
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const [, pitch, octave] = match;
  return NOTE_NAMES.indexOf(pitch) + (parseInt(octave, 10) + 1) * 12;
}

function rowTop(midi: number): number {
  return (MAX_MIDI - midi) * ROW_H;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

export function PianoRollEditor({
  channelName,
  color,
  notes: initialNotes,
  length,
  bpm,
  beatsPerBar,
  scaleSetting,
  onScaleChange,
  onChange,
  onClose,
  onPreviewNote,
}: PianoRollEditorProps) {
  const [notes, setNotes] = useState<EditableNote[]>(() => withIds(initialNotes));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>("draw");
  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SECOND);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null
  );

  const gridScrollRef = useRef<HTMLDivElement>(null);
  const keysViewportRef = useRef<HTMLDivElement>(null);
  const rulerViewportRef = useRef<HTMLDivElement>(null);
  const velocityViewportRef = useRef<HTMLDivElement>(null);

  const secondsPerBeat = 60 / bpm;
  const secondsPer16th = secondsPerBeat / 4;
  const ticksPerBar = Math.max(1, Math.round(beatsPerBar * 4));
  const defaultNoteDuration = secondsPerBeat * DEFAULT_NOTE_BEATS;

  const contentWidth = length * pxPerSecond;
  const contentHeight = (MAX_MIDI - MIN_MIDI + 1) * ROW_H;

  const snapTime = (t: number) =>
    Math.min(length, Math.max(0, Math.round(t / secondsPer16th) * secondsPer16th));

  const commit = (next: EditableNote[]) => {
    setNotes(next);
    onChange(stripIds(next));
  };

  // Center the initial vertical scroll on the notes (or middle C if empty).
  useEffect(() => {
    const centerMidi =
      notes.length > 0
        ? notes.reduce((sum, n) => sum + noteNameToMidi(n.note), 0) / notes.length
        : 60;
    const top = rowTop(centerMidi) - GRID_VIEWPORT_H / 2 + ROW_H / 2;
    if (gridScrollRef.current) gridScrollRef.current.scrollTop = Math.max(0, top);
    if (keysViewportRef.current) keysViewportRef.current.scrollTop = Math.max(0, top);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    commit(notes.filter((n) => !selectedIds.has(n.id)));
    setSelectedIds(new Set());
  };

  const handleDeleteNote = (id: string) => {
    commit(notes.filter((n) => n.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  // Mode toggle ('b') and Delete/Backspace for the current selection.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIds.size > 0) {
          e.preventDefault();
          handleDeleteSelected();
        }
      } else if (e.key.toLowerCase() === "b") {
        setMode((m) => (m === "draw" ? "select" : "draw"));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, notes]);

  const handleGridScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollLeft } = e.currentTarget;
    if (keysViewportRef.current) keysViewportRef.current.scrollTop = scrollTop;
    if (rulerViewportRef.current) rulerViewportRef.current.scrollLeft = scrollLeft;
    if (velocityViewportRef.current) velocityViewportRef.current.scrollLeft = scrollLeft;
  };

  /** Content-pixel coordinates (accounting for scroll) for a client point. */
  const contentPoint = (clientX: number, clientY: number) => {
    const rect = gridScrollRef.current!.getBoundingClientRect();
    const scrollLeft = gridScrollRef.current!.scrollLeft;
    const scrollTop = gridScrollRef.current!.scrollTop;
    return {
      x: clientX - rect.left + scrollLeft,
      y: clientY - rect.top + scrollTop,
    };
  };
  const xToTime = (clientX: number) =>
    Math.max(0, contentPoint(clientX, 0).x / pxPerSecond);
  const yToMidi = (clientY: number) => {
    const rowIndex = Math.floor(contentPoint(0, clientY).y / ROW_H);
    return Math.min(MAX_MIDI, Math.max(MIN_MIDI, MAX_MIDI - rowIndex));
  };

  // --- Draw a new note by click-dragging on empty grid space ---
  const handleDrawPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const time = snapTime(xToTime(e.clientX));
    const midi = yToMidi(e.clientY);
    const note = midiToNoteName(midi);
    const id = `n${idCounter++}`;
    const draft: EditableNote = {
      id,
      note,
      time,
      duration: Math.max(secondsPer16th, defaultNoteDuration),
      velocity: 0.8,
    };
    const baseNotes = notes;
    setNotes((prev) => [...prev, draft]);
    setSelectedIds(new Set([id]));
    onPreviewNote(note);

    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let finalDuration = draft.duration;

    const applyDuration = (clientX: number) => {
      const endTime = Math.max(time + secondsPer16th, snapTime(xToTime(clientX)));
      finalDuration = endTime - time;
      setNotes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, duration: finalDuration } : n))
      );
    };
    const onMove = (ev: PointerEvent) => applyDuration(ev.clientX);
    const onUp = (ev: PointerEvent) => {
      applyDuration(ev.clientX);
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      commit([...baseNotes, { ...draft, duration: finalDuration }]);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  // --- Rubber-band select notes in Select mode ---
  const handleMarqueePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const start = contentPoint(e.clientX, e.clientY);
    let moved = false;

    const rectAt = (clientX: number, clientY: number) => {
      const cur = contentPoint(clientX, clientY);
      return {
        x: Math.min(start.x, cur.x),
        y: Math.min(start.y, cur.y),
        w: Math.abs(cur.x - start.x),
        h: Math.abs(cur.y - start.y),
      };
    };

    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - e.clientX) > DRAG_THRESHOLD_PX ||
          Math.abs(ev.clientY - e.clientY) > DRAG_THRESHOLD_PX) {
        moved = true;
      }
      setMarquee(rectAt(ev.clientX, ev.clientY));
    };
    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      if (moved) {
        const rect = rectAt(ev.clientX, ev.clientY);
        const hits = notes.filter((n) => {
          const midi = noteNameToMidi(n.note);
          const nx = n.time * pxPerSecond;
          const nw = Math.max(n.duration * pxPerSecond, 6);
          const ny = rowTop(midi);
          return (
            nx < rect.x + rect.w &&
            nx + nw > rect.x &&
            ny < rect.y + rect.h &&
            ny + ROW_H > rect.y
          );
        });
        setSelectedIds(new Set(hits.map((n) => n.id)));
      } else {
        setSelectedIds(new Set());
      }
      setMarquee(null);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  const handleGridPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (mode === "select") handleMarqueePointerDown(e);
    else handleDrawPointerDown(e);
  };

  // --- Move a note (or the whole selected group if it's part of one) ---
  const handleNotePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    n: EditableNote
  ) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const activeSelection = selectedIds.has(n.id) ? selectedIds : new Set([n.id]);
    if (!selectedIds.has(n.id)) setSelectedIds(activeSelection);
    onPreviewNote(n.note);

    const baseNotes = notes;
    const groupStart = new Map<string, { time: number; midi: number }>();
    baseNotes.forEach((note) => {
      if (activeSelection.has(note.id)) {
        groupStart.set(note.id, { time: note.time, midi: noteNameToMidi(note.note) });
      }
    });
    const primaryStart = groupStart.get(n.id)!;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    let deltaTime = 0;
    let deltaRows = 0;

    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const applyMove = (clientX: number, clientY: number) => {
      const rawDeltaSeconds = (clientX - startClientX) / pxPerSecond;
      deltaRows = Math.round((clientY - startClientY) / ROW_H);
      const newPrimaryTime = snapTime(primaryStart.time + rawDeltaSeconds);
      deltaTime = newPrimaryTime - primaryStart.time;
      setNotes((prev) =>
        prev.map((note) => {
          const gs = groupStart.get(note.id);
          if (!gs) return note;
          const newMidi = Math.min(MAX_MIDI, Math.max(MIN_MIDI, gs.midi - deltaRows));
          return { ...note, time: Math.max(0, gs.time + deltaTime), note: midiToNoteName(newMidi) };
        })
      );
    };
    const onMove = (ev: PointerEvent) => applyMove(ev.clientX, ev.clientY);
    const onUp = (ev: PointerEvent) => {
      applyMove(ev.clientX, ev.clientY);
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      commit(
        baseNotes.map((note) => {
          const gs = groupStart.get(note.id);
          if (!gs) return note;
          const newMidi = Math.min(MAX_MIDI, Math.max(MIN_MIDI, gs.midi - deltaRows));
          return { ...note, time: Math.max(0, gs.time + deltaTime), note: midiToNoteName(newMidi) };
        })
      );
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  // --- Resize an existing note (drag right edge) ---
  const handleResizePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    n: EditableNote
  ) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    setSelectedIds(new Set([n.id]));
    const baseNotes = notes;
    const startClientX = e.clientX;
    const startDuration = n.duration;
    let finalDuration = startDuration;

    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const applyResize = (clientX: number) => {
      const deltaSeconds = (clientX - startClientX) / pxPerSecond;
      const rawDuration = startDuration + deltaSeconds;
      finalDuration = Math.max(
        secondsPer16th,
        Math.round(rawDuration / secondsPer16th) * secondsPer16th
      );
      setNotes((prev) =>
        prev.map((note) => (note.id === n.id ? { ...note, duration: finalDuration } : note))
      );
    };
    const onMove = (ev: PointerEvent) => applyResize(ev.clientX);
    const onUp = (ev: PointerEvent) => {
      applyResize(ev.clientX);
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      commit(
        baseNotes.map((note) =>
          note.id === n.id ? { ...note, duration: finalDuration } : note
        )
      );
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  // --- Velocity lane: drag a note's bar vertically to change its velocity ---
  const handleVelocityPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    n: EditableNote
  ) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    setSelectedIds(new Set([n.id]));
    const baseNotes = notes;
    let finalVelocity = n.velocity;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const updateFromY = (clientY: number) => {
      const rect = velocityViewportRef.current!.getBoundingClientRect();
      const ratio = 1 - (clientY - rect.top) / VELOCITY_H;
      finalVelocity = Math.min(1, Math.max(0.05, ratio));
      setNotes((prev) =>
        prev.map((note) => (note.id === n.id ? { ...note, velocity: finalVelocity } : note))
      );
    };
    updateFromY(e.clientY);

    const onMove = (ev: PointerEvent) => updateFromY(ev.clientY);
    const onUp = (ev: PointerEvent) => {
      updateFromY(ev.clientY);
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      commit(
        baseNotes.map((note) =>
          note.id === n.id ? { ...note, velocity: finalVelocity } : note
        )
      );
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  const pitchRows = useMemo(() => {
    const rows: number[] = [];
    for (let m = MAX_MIDI; m >= MIN_MIDI; m--) rows.push(m);
    return rows;
  }, []);

  // Adaptive grid: bars always shown; beat/16th subdivisions and their
  // labels fade in as you zoom in, like Ableton's ruler.
  const gridLines = useMemo(() => {
    const totalTicks = Math.ceil(length / secondsPer16th);
    const beatPx = secondsPerBeat * pxPerSecond;
    const sixteenthPx = secondsPer16th * pxPerSecond;
    const showBeats = beatPx >= 26;
    const show16ths = sixteenthPx >= 18;
    const lines: {
      left: number;
      strength: "bar" | "beat" | "tick";
      index: number;
      label: string | null;
    }[] = [];
    for (let i = 0; i <= totalTicks; i++) {
      const withinBar = i % ticksPerBar;
      const bar = Math.floor(i / ticksPerBar) + 1;
      const beat = Math.floor(withinBar / 4) + 1;
      const sixteenth = (withinBar % 4) + 1;
      let strength: "bar" | "beat" | "tick" = "tick";
      let label: string | null = null;
      if (withinBar === 0) {
        strength = "bar";
        label = `${bar}`;
      } else if (withinBar % 4 === 0) {
        strength = "beat";
        if (showBeats) label = `${bar}.${beat}`;
      } else if (show16ths) {
        label = `${bar}.${beat}.${sixteenth}`;
      }
      lines.push({ left: i * secondsPer16th * pxPerSecond, strength, index: i, label });
    }
    return lines;
  }, [length, secondsPer16th, secondsPerBeat, pxPerSecond, ticksPerBar]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="relative flex max-h-[90vh] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
        style={{ width: "min(1160px, 96vw)" }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-raised px-3 py-2">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: color.accent }}
            />
            <span className="text-sm font-medium">Piano Roll — {channelName}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPxPerSecond((z) => Math.max(MIN_PX_PER_SECOND, z - 40))}
                title="Zoom out"
                className="flex h-7 w-7 items-center justify-center rounded border border-border text-muted hover:bg-surface"
              >
                <ZoomOut size={13} />
              </button>
              <button
                type="button"
                onClick={() => setPxPerSecond((z) => Math.min(MAX_PX_PER_SECOND, z + 40))}
                title="Zoom in"
                className="flex h-7 w-7 items-center justify-center rounded border border-border text-muted hover:bg-surface"
              >
                <ZoomIn size={13} />
              </button>
            </div>
            <ScaleSelector value={scaleSetting} onChange={onScaleChange} />
            <button
              type="button"
              onClick={onClose}
              title="Close"
              className="flex h-7 w-7 items-center justify-center rounded border border-border hover:bg-surface"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="px-3 pt-2 text-[11px] text-muted">
          {mode === "draw"
            ? "drag on empty space to draw a note · drag a note to move it · drag its right edge to resize · right-click a note to delete it"
            : "drag on empty space to box-select notes · drag a note (or selection) to move it · Delete to remove selected notes"}
          {" · press B to toggle mode · drag a velocity bar to change velocity"}
        </div>

        <div
          className="pointer-events-none absolute left-3 top-12 z-30 flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white"
        >
          {mode === "draw" ? <Pencil size={11} /> : <MousePointer2 size={11} />}
          {mode}
          <span className="font-normal normal-case text-white/60">(b)</span>
        </div>

        <div className="flex flex-col overflow-hidden p-3">
          {/* Ruler row */}
          <div className="flex">
            <div style={{ width: KEY_COL_WIDTH, height: RULER_H }} className="shrink-0 border-b border-r border-border" />
            <div
              ref={rulerViewportRef}
              style={{ height: RULER_H }}
              className="flex-1 overflow-hidden border-b border-border"
            >
              <div className="relative" style={{ width: contentWidth, height: RULER_H }}>
                {gridLines
                  .filter((l) => l.label !== null)
                  .map((l) => (
                    <div
                      key={l.index}
                      className={`absolute top-0 h-full pl-1 pt-0.5 text-[9px] ${
                        l.strength === "bar"
                          ? "border-l border-border/70 text-muted"
                          : "text-muted/50"
                      }`}
                      style={{ left: l.left }}
                    >
                      {l.label}
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {/* Keys + grid row */}
          <div className="flex">
            <div
              ref={keysViewportRef}
              style={{ width: KEY_COL_WIDTH, height: GRID_VIEWPORT_H }}
              className="shrink-0 overflow-hidden border-r border-border"
            >
              <div className="relative" style={{ height: contentHeight, width: KEY_COL_WIDTH }}>
                {pitchRows.map((midi) => {
                  const black = isBlackKey(midi);
                  const inScale = scaleSetting.enabled && isNoteInScale(midi, scaleSetting);
                  return (
                    <div
                      key={midi}
                      onPointerDown={() => onPreviewNote(midiToNoteName(midi))}
                      title={midiToNoteName(midi)}
                      className={`absolute left-0 w-full cursor-pointer border-b border-black/30 text-right pr-1 text-[8px] leading-[13px] ${
                        black ? "bg-[#0d0d10] text-muted/60" : "bg-[#e9e9ec] text-black/50"
                      } ${inScale ? "ring-1 ring-inset ring-accent/40" : ""}`}
                      style={{ top: rowTop(midi), height: ROW_H }}
                    >
                      {midi % 12 === 0 ? midiToNoteName(midi) : ""}
                    </div>
                  );
                })}
              </div>
            </div>

            <div
              ref={gridScrollRef}
              onScroll={handleGridScroll}
              style={{ height: GRID_VIEWPORT_H }}
              className="flex-1 overflow-auto"
            >
              <div
                onPointerDown={handleGridPointerDown}
                className={`relative ${mode === "draw" ? "cursor-crosshair" : "cursor-default"}`}
                style={{ width: contentWidth, height: contentHeight }}
              >
                {pitchRows.map((midi) => {
                  const black = isBlackKey(midi);
                  const inScale = scaleSetting.enabled && isNoteInScale(midi, scaleSetting);
                  const isRoot =
                    scaleSetting.enabled &&
                    ((((midi % 12) + 12) % 12) ===
                      SCALE_ROOTS.indexOf(
                        scaleSetting.root as (typeof SCALE_ROOTS)[number]
                      ));
                  return (
                    <div
                      key={midi}
                      className="absolute left-0 w-full border-b border-black/20"
                      style={{
                        top: rowTop(midi),
                        height: ROW_H,
                        background: inScale
                          ? isRoot
                            ? color.accentSoft
                            : "rgba(94,177,255,0.07)"
                          : black
                            ? "rgba(0,0,0,0.22)"
                            : "transparent",
                      }}
                    />
                  );
                })}
                {gridLines.map((l) => (
                  <div
                    key={l.index}
                    className="absolute top-0 h-full"
                    style={{
                      left: l.left,
                      borderLeft: `1px solid ${
                        l.strength === "bar"
                          ? "rgba(230,230,235,0.35)"
                          : l.strength === "beat"
                            ? "rgba(230,230,235,0.18)"
                            : "rgba(230,230,235,0.07)"
                      }`,
                    }}
                  />
                ))}
                {notes.map((n) => {
                  const midi = noteNameToMidi(n.note);
                  const left = n.time * pxPerSecond;
                  const width = Math.max(n.duration * pxPerSecond, 6);
                  const selected = selectedIds.has(n.id);
                  return (
                    <div
                      key={n.id}
                      data-note-id={n.id}
                      onPointerDown={(e) => handleNotePointerDown(e, n)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (mode === "draw") handleDeleteNote(n.id);
                      }}
                      className={`absolute flex items-center rounded-[3px] border ${
                        selected ? "ring-2 ring-white/80" : ""
                      }`}
                      style={{
                        left,
                        top: rowTop(midi) + 1,
                        width,
                        height: ROW_H - 2,
                        background: color.accent,
                        borderColor: "rgba(0,0,0,0.4)",
                        opacity: 0.55 + n.velocity * 0.45,
                      }}
                    >
                      <div
                        onPointerDown={(e) => handleResizePointerDown(e, n)}
                        className="ml-auto h-full w-1.5 cursor-ew-resize bg-black/20"
                      />
                    </div>
                  );
                })}
                {marquee && (
                  <div
                    className="absolute border border-accent bg-accent/15"
                    style={{
                      left: marquee.x,
                      top: marquee.y,
                      width: marquee.w,
                      height: marquee.h,
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Velocity lane */}
          <div className="flex">
            <div
              style={{ width: KEY_COL_WIDTH, height: VELOCITY_H }}
              className="flex shrink-0 items-center justify-center border-r border-t border-border text-[9px] text-muted"
            >
              vel
            </div>
            <div
              ref={velocityViewportRef}
              style={{ height: VELOCITY_H }}
              className="flex-1 overflow-hidden border-t border-border"
            >
              <div className="relative" style={{ width: contentWidth, height: VELOCITY_H }}>
                {notes.map((n) => {
                  const selected = selectedIds.has(n.id);
                  const h = Math.max(3, n.velocity * (VELOCITY_H - 6));
                  return (
                    <div
                      key={n.id}
                      data-velocity-id={n.id}
                      onPointerDown={(e) => handleVelocityPointerDown(e, n)}
                      className={`absolute bottom-0 w-1.5 cursor-ns-resize rounded-t-sm ${
                        selected ? "ring-1 ring-white/80" : ""
                      }`}
                      style={{
                        left: n.time * pxPerSecond,
                        height: h,
                        background: color.accent,
                      }}
                      title={`velocity ${Math.round(n.velocity * 127)}`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
