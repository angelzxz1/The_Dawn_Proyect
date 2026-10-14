"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ChevronRight, Play, Plus, Square } from "lucide-react";
import { allGrooveGenres, allGrooves, GROOVE_DRAG_MIME, GROOVE_GENRES, SECTION_LABELS, subscribeGrooves, type Groove } from "@/library/grooves";

interface GrooveBrowserProps {
  /** Plays the groove once (resolves when it has finished or was replaced). */
  onPreview: (groove: Groove) => void;
  onStopPreview: () => void;
  /** Adds the groove at the playhead on the selected track. */
  onAdd: (groove: Groove) => void;
  /** Whether there's a MIDI track selected to add to. */
  canAdd: boolean;
}

/** The Grooves tab of the left browser: drum patterns by genre. Click one to
 * hear it, drag it onto a MIDI track (it becomes a clip there, at the
 * project's tempo), or press + to add it at the playhead. */
export function GrooveBrowser({ onPreview, onStopPreview, onAdd, canAdd }: GrooveBrowserProps) {
  const [open, setOpen] = useState<Set<string>>(new Set(["rock"]));
  const [playing, setPlaying] = useState<string | null>(null);
  const genres = useSyncExternalStore(subscribeGrooves, allGrooveGenres, () => GROOVE_GENRES);

  // A preview stops on its own; this is only for the button's state.
  useEffect(() => {
    if (!playing) return;
    const g = allGrooves().find((x) => x.id === playing);
    const ms = g ? (g.bars * ((g.genre.meter[0] * 4) / g.genre.meter[1]) * 60000) / g.genre.bpm + 600 : 0;
    const t = window.setTimeout(() => setPlaying(null), ms);
    return () => window.clearTimeout(t);
  }, [playing]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const play = (g: Groove) => {
    if (playing === g.id) {
      onStopPreview();
      setPlaying(null);
      return;
    }
    onPreview(g);
    setPlaying(g.id);
  };

  return (
    <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
      <p className="px-1 pb-1.5 text-[10.5px] leading-snug text-muted">
        Click to hear · drag onto a MIDI track · they follow the project tempo
      </p>
      {genres.map((genre) => {
        const isOpen = open.has(genre.id);
        return (
          <div key={genre.id}>
            <button
              type="button"
              onClick={() => toggle(genre.id)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-1 rounded px-1 py-1.5 text-left text-[11px] font-medium text-foreground/80 hover:bg-surface-raised"
            >
              <ChevronRight size={11} className={`shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
              <span className="flex-1 truncate">{genre.name}</span>
              {genre.pack && <span className="rounded bg-accent/15 px-1 text-[9px] font-normal text-accent">pack</span>}
              <span className="font-mono text-[9.5px] font-normal text-muted">
                {genre.meter[0] === 4 && genre.meter[1] === 4 ? "" : `${genre.meter[0]}/${genre.meter[1]} · `}
                {genre.bpm}
              </span>
            </button>
            {isOpen && (
              <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-1">
                {allGrooves().filter((g) => g.genre.id === genre.id).map((g) => (
                  <div
                    key={g.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(GROOVE_DRAG_MIME, g.id);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    className="group flex cursor-grab items-center gap-1 rounded px-1 py-[3px] text-[10.5px] text-muted hover:bg-surface-raised hover:text-accent active:cursor-grabbing"
                    title={`${g.name}: ${g.bars} bar${g.bars > 1 ? "s" : ""}, made at ${genre.bpm} BPM on the ${genre.kit} kit. Drag onto a MIDI track.`}
                  >
                    <button
                      type="button"
                      onClick={() => play(g)}
                      aria-label={`${playing === g.id ? "Stop" : "Play"} ${g.name}`}
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted hover:text-accent"
                    >
                      {playing === g.id ? <Square size={9} /> : <Play size={9} />}
                    </button>
                    <span className="flex-1 select-none truncate" onClick={() => play(g)}>
                      {SECTION_LABELS[g.section]}
                    </span>
                    <span className="font-mono text-[9.5px] text-muted/70">{g.bars}</span>
                    <button
                      type="button"
                      onClick={() => onAdd(g)}
                      disabled={!canAdd}
                      aria-label={`Add ${g.name} at the playhead`}
                      title={canAdd ? "Add at the playhead on the selected track" : "Select a MIDI track to add it to"}
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:text-accent group-hover:opacity-100 disabled:opacity-0"
                    >
                      <Plus size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
