"use client";

import { X } from "lucide-react";
import { audioEngine } from "@/engine/audioEngine";
import { showRecordingSettings } from "./AudioStatus";
import { useAudioPrefs } from "./useAudioPrefs";

/** Shown after a take from the audio interface while Dawn only has the
 * browser's estimate of the audio delay, which is often short - takes
 * then land a little late. Offers to measure it. */
export function LatencyHint({ onClose }: { onClose: () => void }) {
  const [, update] = useAudioPrefs();
  const estimate = Math.round(audioEngine.getRoundTrip().seconds * 1000);
  return (
    <div
      role="status"
      aria-label="Recording timing"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-accent/40 bg-surface-raised px-3 py-2 text-[12px] text-foreground"
    >
      <span className="min-w-0 flex-1">
        Did that take land a little late? Dawn moves each take earlier by your setup&apos;s audio delay, and for now
        that&apos;s the browser&apos;s estimate ({estimate} ms), which is often too short. Measure it once and takes land on
        the beat.
      </span>
      <button
        type="button"
        onClick={() => {
          showRecordingSettings();
          onClose();
        }}
        className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-black hover:brightness-110"
      >
        Measure latency…
      </button>
      <button
        type="button"
        onClick={() => {
          update({ latencyHintDismissed: true });
          onClose();
        }}
        className="text-[11px] text-muted underline hover:text-foreground"
      >
        Don&apos;t show again
      </button>
      <button type="button" onClick={onClose} aria-label="Close" className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface">
        <X size={13} />
      </button>
    </div>
  );
}
