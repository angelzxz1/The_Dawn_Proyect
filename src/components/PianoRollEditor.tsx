"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { isBlackKey, midiToNoteName } from "@/lib/piano";
import { isNoteInScale, SCALE_ROOTS, type ScaleSetting } from "@/lib/scales";
import type { NoteEvent } from "@/lib/types";
import type { TrackColor } from "@/lib/colors";
import { ScaleSelector } from "./ScaleSelector";

interface PianoRollEditorProps {
  channelName: string;
  color: TrackColor;
  notes: NoteEvent[];
  bpm: number;
  scaleSetting: ScaleSetting;
  onScaleChange: (setting: ScaleSetting) => void;
  onChange: (notes: NoteEvent[]) => void;
  onClose: () => void;
  onPreviewNote: (note: string) => void;
}

interface EditableNote extends NoteEvent {
  id: string;
}

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
const PX_PER_SECOND = 130;
const MIN_EDITOR_SECONDS = 8;
const DEFAULT_NOTE_BEATS = 1; // default drawn-note length, in beats

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

export function PianoRollEditor({
  channelName,
  color,
  notes: initialNotes,
  bpm,
  scaleSetting,
  onScaleChange,
  onChange,
  onClose,
  onPreviewNote,
}: PianoRollEditorProps) {
  const [notes, setNotes] = useState<EditableNote[]>(() => withIds(initialNotes));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const gridScrollRef = useRef<HTMLDivElement>(null);
  const keysViewportRef = useRef<HTMLDivElement>(null);
  const rulerViewportRef = useRef<HTMLDivElement>(null);
  const velocityViewportRef = useRef<HTMLDivElement>(null);

  const secondsPerBeat = 60 / bpm;
  const secondsPer16th = secondsPerBeat / 4;
  const defaultNoteDuration = secondsPerBeat * DEFAULT_NOTE_BEATS;

  const editorSeconds = useMemo(() => {
    const end = notes.reduce((max, n) => Math.max(max, n.time + n.duration), 0);
    return Math.max(MIN_EDITOR_SECONDS, Math.ceil(end + 4));
  }, [notes]);

  const contentWidth = editorSeconds * PX_PER_SECOND;
  const contentHeight = (MAX_MIDI - MIN_MIDI + 1) * ROW_H;

  const snapTime = (t: number) =>
    Math.max(0, Math.round(t / secondsPer16th) * secondsPer16th);

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

  const handleGridScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollLeft } = e.currentTarget;
    if (keysViewportRef.current) keysViewportRef.current.scrollTop = scrollTop;
    if (rulerViewportRef.current) rulerViewportRef.current.scrollLeft = scrollLeft;
    if (velocityViewportRef.current) velocityViewportRef.current.scrollLeft = scrollLeft;
  };

  const xToTime = (clientX: number) => {
    const rect = gridScrollRef.current!.getBoundingClientRect();
    const scrollLeft = gridScrollRef.current!.scrollLeft;
    return Math.max(0, (clientX - rect.left + scrollLeft) / PX_PER_SECOND);
  };
  const yToMidi = (clientY: number) => {
    const rect = gridScrollRef.current!.getBoundingClientRect();
    const scrollTop = gridScrollRef.current!.scrollTop;
    const rowIndex = Math.floor((clientY - rect.top + scrollTop) / ROW_H);
    return Math.min(MAX_MIDI, Math.max(MIN_MIDI, MAX_MIDI - rowIndex));
  };

  // --- Draw a new note by click-dragging on empty grid space ---
  const handleGridPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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
    setSelectedId(id);
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

  // --- Move an existing note (drag body) ---
  const handleNotePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    n: EditableNote
  ) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    setSelectedId(n.id);
    onPreviewNote(n.note);
    const baseNotes = notes;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startTime = n.time;
    const startMidi = noteNameToMidi(n.note);
    let finalTime = startTime;
    let finalNoteName = n.note;

    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const applyMove = (clientX: number, clientY: number) => {
      const deltaSeconds = (clientX - startClientX) / PX_PER_SECOND;
      const deltaRows = Math.round((clientY - startClientY) / ROW_H);
      finalTime = snapTime(startTime + deltaSeconds);
      const newMidi = Math.min(MAX_MIDI, Math.max(MIN_MIDI, startMidi - deltaRows));
      finalNoteName = midiToNoteName(newMidi);
      setNotes((prev) =>
        prev.map((note) =>
          note.id === n.id
            ? { ...note, time: finalTime, note: finalNoteName }
            : note
        )
      );
    };
    const onMove = (ev: PointerEvent) => applyMove(ev.clientX, ev.clientY);
    const onUp = (ev: PointerEvent) => {
      applyMove(ev.clientX, ev.clientY);
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      commit(
        baseNotes.map((note) =>
          note.id === n.id
            ? { ...note, time: finalTime, note: finalNoteName }
            : note
        )
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
    setSelectedId(n.id);
    const baseNotes = notes;
    const startClientX = e.clientX;
    const startDuration = n.duration;
    let finalDuration = startDuration;

    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const applyResize = (clientX: number) => {
      const deltaSeconds = (clientX - startClientX) / PX_PER_SECOND;
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

  const handleDeleteNote = (id: string) => {
    commit(notes.filter((n) => n.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  // --- Velocity lane: drag a note's bar vertically to change its velocity ---
  const handleVelocityPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    n: EditableNote
  ) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    setSelectedId(n.id);
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

  const gridLines = useMemo(() => {
    const totalTicks = Math.ceil(editorSeconds / secondsPer16th);
    return Array.from({ length: totalTicks + 1 }, (_, i) => {
      const strength = i % 16 === 0 ? "bar" : i % 4 === 0 ? "beat" : "tick";
      return { left: i * secondsPer16th * PX_PER_SECOND, strength, index: i };
    });
  }, [editorSeconds, secondsPer16th]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="flex max-h-[90vh] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
        style={{ width: "min(1120px, 96vw)" }}
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
          drag on empty space to draw a note · drag a note to move it · drag its
          right edge to resize · double-click a note to delete it · drag a
          velocity bar to change velocity
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
                  .filter((l) => l.strength === "bar")
                  .map((l) => (
                    <div
                      key={l.index}
                      className="absolute top-0 h-full border-l border-border/70 pl-1 pt-0.5 text-[9px] text-muted"
                      style={{ left: l.left }}
                    >
                      {l.index / 16 + 1}
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
                className="relative cursor-crosshair"
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
                  const left = n.time * PX_PER_SECOND;
                  const width = Math.max(n.duration * PX_PER_SECOND, 6);
                  const selected = n.id === selectedId;
                  return (
                    <div
                      key={n.id}
                      data-note-id={n.id}
                      onPointerDown={(e) => handleNotePointerDown(e, n)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        handleDeleteNote(n.id);
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
                  const selected = n.id === selectedId;
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
                        left: n.time * PX_PER_SECOND,
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
