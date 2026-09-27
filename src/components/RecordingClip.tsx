"use client";

import { useEffect, useState } from "react";
import { Circle } from "lucide-react";
import { audioEngine } from "@/lib/audioEngine";
import { TRACK_ROW_HEIGHT } from "@/lib/timeline";
import type { NoteEvent } from "@/lib/types";
import type { Waveform } from "@/lib/waveform";
import { noteNameToMidi } from "./ClipBlock";
import { WaveformCanvas } from "./WaveformCanvas";

const LANE_PADDING = 10;
const HEADER = 18;
const MIN_MIDI = 36;
const MAX_MIDI = 96;
const RECORD_RED = "#FF5A5A";

type Preview =
  | { kind: "audio"; waveform: Waveform | null; version: number }
  | { kind: "midi"; notes: NoteEvent[] };

/** The take being recorded, drawn on its track as it comes in: a red clip
 * from the start that grows with the playhead, showing the audio's
 * waveform (or the notes played) so far. It's replaced by the real clip
 * once recording stops. */
export function RecordingClip({ channelId, pxPerSecond }: { channelId: string; pxPerSecond: number }) {
  const [state, setState] = useState<{ seconds: number; preview: Preview | null }>({ seconds: 0, preview: null });

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
          setState({
            seconds: Math.max(0, audioEngine.getTransportSeconds()),
            preview: live.kind === "audio" ? { kind: "audio", waveform: live.waveform, version: live.version } : { kind: "midi", notes: live.notes },
          });
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [channelId]);

  const height = TRACK_ROW_HEIGHT - LANE_PADDING * 2;
  const bodyHeight = height - HEADER;
  const widthPx = Math.max(2, state.seconds * pxPerSecond);
  const preview = state.preview;

  return (
    <div
      className="pointer-events-none absolute left-0 top-2.5 z-[1] flex flex-col overflow-hidden rounded-md border"
      style={{ width: widthPx, height, borderColor: RECORD_RED, background: "rgba(255,90,90,0.14)" }}
      aria-label="Recording"
    >
      <div className="flex shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap px-1.5 text-[10px] font-semibold" style={{ height: HEADER, background: RECORD_RED, color: "#1a0a0a" }}>
        <Circle size={7} fill="currentColor" className="shrink-0 animate-pulse" />
        Recording…
      </div>
      <div className="relative flex-1">
        {preview?.kind === "audio" && (
          <WaveformCanvas
            waveform={preview.waveform}
            version={preview.version}
            width={widthPx}
            height={bodyHeight}
            view={{ pxPerSecond, sourceOffset: 0, length: state.seconds, color: "#FFB3B3" }}
          />
        )}
        {preview?.kind === "midi" &&
          preview.notes.map((n, i) => {
            const y = bodyHeight - ((noteNameToMidi(n.note) - MIN_MIDI) / (MAX_MIDI - MIN_MIDI)) * bodyHeight;
            return (
              <div
                key={i}
                className="absolute h-[2px] rounded-full"
                style={{
                  left: n.time * pxPerSecond,
                  width: Math.max(2, n.duration * pxPerSecond),
                  top: Math.min(Math.max(y, 0), bodyHeight - 2),
                  background: "#FFB3B3",
                }}
              />
            );
          })}
      </div>
    </div>
  );
}
