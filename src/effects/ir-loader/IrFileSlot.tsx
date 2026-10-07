"use client";

import { useEffect, useState } from "react";
import { EffectFileSlot, type EffectFileSlotLabels } from "@/effects/ui/EffectFileSlot";
import { audioEngine } from "@/lib/audioEngine";
import { decodeEffectFileAudio, hasEffectFile } from "@/effects/effectFiles";
import type { EffectFileRef } from "@/effects/registry";

export type ImpulseState =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; buffer: AudioBuffer };

/** The effect's IR, decoded at the engine's sample rate, for display. */
export function useImpulseResponse(file: EffectFileRef | undefined): ImpulseState {
  const fileId = file?.id;
  const [decoded, setDecoded] = useState<{ id: string; buffer: AudioBuffer | null } | null>(null);

  useEffect(() => {
    if (!fileId || !hasEffectFile(fileId)) return;
    let cancelled = false;
    void decodeEffectFileAudio(fileId, audioEngine.sampleRate).then((buffer) => {
      if (!cancelled) setDecoded({ id: fileId, buffer });
    });
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  if (!fileId) return { status: "empty" };
  if (!hasEffectFile(fileId)) return { status: "missing" };
  if (decoded?.id !== fileId) return { status: "loading" };
  return decoded.buffer ? { status: "ready", buffer: decoded.buffer } : { status: "missing" };
}

const IR_LABELS: EffectFileSlotLabels = {
  empty: "Load IR…",
  loadTitle: "Load an impulse response",
  unloadTitle: "Unload IR",
  hint: "Click to choose a file, or drop one here",
  hintCompact: "Click or drop a .wav",
};

const ACCEPT = ".wav,.wave,.aif,.aiff,.flac,.mp3,.ogg,audio/*";

/** The IR Loader's file slot: the loaded IR's length and channel layout. */
export function IrFileSlot({
  file,
  impulse,
  onLoad,
  onClear,
  compact = false,
}: {
  file: EffectFileRef | undefined;
  impulse: ImpulseState;
  onLoad: (file: File) => Promise<string | null>;
  onClear: () => void;
  compact?: boolean;
}) {
  let detail: string | null = null;
  if (impulse.status === "ready") {
    const { buffer } = impulse;
    const ms = buffer.duration * 1000;
    const length = ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
    const channels =
      buffer.numberOfChannels === 1 ? "mono" : buffer.numberOfChannels === 2 ? "stereo" : `${buffer.numberOfChannels} ch`;
    detail = `${length} · ${channels}`;
  }
  return (
    <EffectFileSlot
      file={file}
      missing={impulse.status === "missing"}
      detail={detail}
      labels={IR_LABELS}
      accept={ACCEPT}
      onLoad={onLoad}
      onClear={onClear}
      compact={compact}
    />
  );
}
