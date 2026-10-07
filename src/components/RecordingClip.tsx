"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Circle } from "lucide-react";
import { audioEngine } from "@/engine/audioEngine";
import { TRACK_ROW_HEIGHT } from "@/lib/timeline";
import type { NoteEvent } from "@/lib/types";
import type { Waveform } from "@/lib/waveform";
import { COMPACT_BELOW, noteNameToMidi } from "./ClipBlock";
import { WaveformCanvas } from "./WaveformCanvas";

const LANE_PADDING = 10;
const HEADER = 18;
const MIN_MIDI = 36;
const MAX_MIDI = 96;
const RECORD_RED = "#FF5A5A";
const NOTE_COLOR = "#FFB3B3";
/** Canvas tiles for the notes (px wide). */
const TILE = 1024;

type Preview =
  | { kind: "audio"; waveform: Waveform | null; version: number }
  | { kind: "midi"; notes: readonly NoteEvent[]; count: number; held: NoteEvent[] };

/** The take being recorded, drawn on its track as it comes in: a red clip
 * from where recording started that grows with the playhead, showing the audio's
 * waveform (or the notes played) so far. It's replaced by the real clip
 * once recording stops. */
export function RecordingClip({ channelId, pxPerSecond, rowHeight = TRACK_ROW_HEIGHT }: { channelId: string; pxPerSecond: number; rowHeight?: number }) {
  // `from`: where the take starts on the timeline; `seconds`: how long it is.
  const [state, setState] = useState<{ from: number; seconds: number; preview: Preview | null }>({ from: 0, seconds: 0, preview: null });

  useEffect(() => {
    let frame: number;
    let last = 0;
    const tick = (now: number) => {
      // ~30 fps is plenty for a growing clip.
      if (now - last > 33) {
        last = now;
        const live = audioEngine.getRecordingPreview();
        // Once Stop is pressed the engine lets go of the take; hold the last
        // frame until the finished clip replaces this one.
        if (live && live.channelId === channelId) {
          const from = audioEngine.recordingFrom ?? 0;
          setState({
            from,
            seconds: Math.max(0, audioEngine.getTransportSeconds() - from),
            preview:
              live.kind === "audio"
                ? { kind: "audio", waveform: live.waveform, version: live.version }
                : { kind: "midi", notes: live.notes, count: live.notes.length, held: live.held },
          });
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [channelId]);

  // A folded (short) lane shows just the red bar.
  const compact = rowHeight < COMPACT_BELOW;
  const pad = compact ? 3 : LANE_PADDING;
  const height = rowHeight - pad * 2;
  const bodyHeight = height - HEADER;
  const widthPx = Math.max(2, state.seconds * pxPerSecond);
  const preview = state.preview;

  return (
    <div
      className="pointer-events-none absolute z-[1] flex flex-col overflow-hidden rounded-md border"
      style={{ left: state.from * pxPerSecond, top: pad, width: widthPx, height, borderColor: RECORD_RED, background: "rgba(255,90,90,0.14)" }}
      aria-label="Recording"
    >
      <div className="flex shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap px-1.5 text-[10px] font-semibold" style={{ height: HEADER, background: RECORD_RED, color: "#1a0a0a" }}>
        <Circle size={7} fill="currentColor" className="shrink-0 animate-pulse" />
        Recording…
      </div>
      {!compact && (
      <div className="relative flex-1">
        {preview?.kind === "audio" && (
          <WaveformCanvas
            waveform={preview.waveform}
            version={preview.version}
            width={widthPx}
            height={bodyHeight}
            view={{ pxPerSecond, sourceOffset: 0, length: state.seconds, color: NOTE_COLOR }}
          />
        )}
        {preview?.kind === "midi" && (
          <>
            <MidiTake notes={preview.notes} count={preview.count} width={widthPx} height={bodyHeight} pxPerSecond={pxPerSecond} />
            {/* The few notes still held are redrawn live as they grow. */}
            {preview.held.map((n) => (
              <div key={n.note} className="absolute h-[2px] rounded-full" style={noteStyle(n, pxPerSecond, bodyHeight)} />
            ))}
          </>
        )}
      </div>
      )}
    </div>
  );
}

function noteY(n: NoteEvent, bodyHeight: number): number {
  const y = bodyHeight - ((noteNameToMidi(n.note) - MIN_MIDI) / (MAX_MIDI - MIN_MIDI)) * bodyHeight;
  return Math.min(Math.max(y, 0), bodyHeight - 2);
}

function noteStyle(n: NoteEvent, pxPerSecond: number, bodyHeight: number): React.CSSProperties {
  return {
    left: n.time * pxPerSecond,
    width: Math.max(2, n.duration * pxPerSecond),
    top: noteY(n, bodyHeight),
    background: NOTE_COLOR,
  };
}

/** The finished notes of a take, on canvas tiles: each note is drawn once,
 * when it finishes, so a long, busy take costs no more per frame than a
 * short one. (Rendering every note as an element, 30 times a second, made
 * the whole app - and so playing - lag more and more as a take went on.) */
function MidiTake({ notes, count, width, height, pxPerSecond }: { notes: readonly NoteEvent[]; count: number; width: number; height: number; pxPerSecond: number }) {
  const tiles = Math.max(1, Math.ceil(width / TILE));
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const drawn = useRef(0);
  const drawnTiles = useRef(0);
  const drawnScale = useRef(pxPerSecond);

  useLayoutEffect(() => {
    const drawNote = (n: NoteEvent, only?: number) => {
      const x0 = n.time * pxPerSecond;
      const x1 = x0 + Math.max(2, n.duration * pxPerSecond);
      const first = Math.floor(x0 / TILE);
      const last = Math.min(tiles - 1, Math.floor(x1 / TILE));
      for (let t = first; t <= last; t++) {
        if (only !== undefined && t !== only) continue;
        const ctx = canvases.current[t]?.getContext("2d");
        if (!ctx) continue;
        ctx.fillStyle = NOTE_COLOR;
        ctx.fillRect(x0 - t * TILE, noteY(n, height), x1 - x0, 2);
      }
    };
    if (drawnScale.current !== pxPerSecond) {
      // Zoomed mid-take: start over at the new scale.
      canvases.current.forEach((c) => c?.getContext("2d")?.clearRect(0, 0, c.width, c.height));
      drawn.current = 0;
      drawnTiles.current = 0;
      drawnScale.current = pxPerSecond;
    }
    // A new tile catches up on notes that reach into it.
    for (let t = drawnTiles.current; t < tiles; t++) {
      if (t === 0) continue;
      for (let i = 0; i < drawn.current; i++) drawNote(notes[i], t);
    }
    drawnTiles.current = tiles;
    for (let i = drawn.current; i < count; i++) drawNote(notes[i]);
    drawn.current = count;
  }, [notes, count, tiles, height, pxPerSecond]);

  return (
    <>
      {Array.from({ length: tiles }, (_, t) => (
        <canvas
          key={t}
          ref={(el) => {
            canvases.current[t] = el;
          }}
          width={TILE}
          height={height}
          className="absolute top-0"
          style={{ left: t * TILE, width: TILE, height }}
        />
      ))}
    </>
  );
}
