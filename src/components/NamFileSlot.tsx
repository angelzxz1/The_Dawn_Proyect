"use client";

import { useEffect, useState } from "react";
import { EffectFileSlot, type EffectFileSlotLabels } from "./EffectFileSlot";
import { hasEffectFile, readEffectFileText } from "@/lib/effectFiles";
import { parseNamFile, type NamFileInfo } from "@/lib/namModel";
import type { EffectFileRef } from "@/lib/effects";

export type NamModelState =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; info: NamFileInfo };

/** What the amp's loaded .nam file says about itself, for display. */
export function useNamModel(file: EffectFileRef | undefined): NamModelState {
  const fileId = file?.id;
  const [parsed, setParsed] = useState<{ id: string; info: NamFileInfo | null } | null>(null);

  useEffect(() => {
    if (!fileId || !hasEffectFile(fileId)) return;
    let cancelled = false;
    void readEffectFileText(fileId).then((json) => {
      if (cancelled) return;
      const result = json === null ? null : parseNamFile(json);
      setParsed({ id: fileId, info: result && "info" in result ? result.info : null });
    });
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  if (!fileId) return { status: "empty" };
  if (!hasEffectFile(fileId)) return { status: "missing" };
  if (parsed?.id !== fileId) return { status: "loading" };
  return parsed.info ? { status: "ready", info: parsed.info } : { status: "missing" };
}

/** "A2 · 48 kHz" - the model's architecture and training rate. */
export function namModelSummary(info: NamFileInfo): string {
  return [info.architecture, info.sampleRate ? `${+(info.sampleRate / 1000).toFixed(1)} kHz` : null]
    .filter(Boolean)
    .join(" · ");
}

const NAM_LABELS: EffectFileSlotLabels = {
  empty: "Load .nam model…",
  loadTitle: "Load a NAM amp model (.nam)",
  unloadTitle: "Unload model",
  hint: "Click to choose a .nam file, or drop one here",
  hintCompact: "Click or drop a .nam file",
};

/** The NAM Amp's file slot. */
export function NamFileSlot({
  file,
  model,
  onLoad,
  onClear,
  compact = false,
}: {
  file: EffectFileRef | undefined;
  model: NamModelState;
  onLoad: (file: File) => Promise<string | null>;
  onClear: () => void;
  compact?: boolean;
}) {
  return (
    <EffectFileSlot
      file={file}
      missing={model.status === "missing"}
      detail={model.status === "ready" ? namModelSummary(model.info) : null}
      labels={NAM_LABELS}
      accept=".nam,application/json"
      onLoad={onLoad}
      onClear={onClear}
      compact={compact}
    />
  );
}
