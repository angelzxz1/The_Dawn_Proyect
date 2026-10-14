"use client";

import { useRef, useState } from "react";
import { FileAudio, Loader2, X } from "lucide-react";
import type { EffectFileRef } from "@/effects/registry";

export interface EffectFileSlotLabels {
  /** Shown in place of a file name when nothing is loaded ("Load IR…"). */
  empty: string;
  /** Hover text of the slot ("Load an impulse response"). */
  loadTitle: string;
  /** Hover text of the unload button ("Unload IR"). */
  unloadTitle: string;
  /** Hint under an empty slot, full and compact. */
  hint: string;
  hintCompact: string;
}

interface EffectFileSlotProps {
  file: EffectFileRef | undefined;
  /** The file is referenced but its data isn't in this browser. */
  missing: boolean;
  /** What to say about the loaded file (length, type, ...), if known yet. */
  detail: string | null;
  labels: EffectFileSlotLabels;
  accept: string;
  onLoad: (file: File) => Promise<string | null>;
  onClear: () => void;
  compact?: boolean;
}

/** Shows an effect's loaded file (or that none is loaded) and loads a new
 * one from a file picker or a file dropped onto it. Load errors show under
 * the slot (in the compact rack card, in place of the detail line). */
export function EffectFileSlot({ file, missing, detail: fileDetail, labels, accept, onLoad, onClear, compact = false }: EffectFileSlotProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const load = async (picked: File | undefined) => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      setError(await onLoad(picked));
    } finally {
      setBusy(false);
    }
  };

  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

  let detail: string;
  if (busy) detail = "Loading…";
  else if (!file) detail = compact ? labels.hintCompact : labels.hint;
  else if (missing) detail = "File missing - load it again";
  else detail = fileDetail ?? "Reading…";

  return (
    <div className="flex flex-col gap-1">
      <div
        onDragOver={(e) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          void load(e.dataTransfer.files[0]);
        }}
        className="flex items-center gap-2 rounded-lg"
        style={{
          background: "#14151A",
          border: `1px ${dragOver ? "solid #E6AD5E" : "dashed #3A3B44"}`,
          padding: compact ? "6px 8px" : "10px 12px",
        }}
      >
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          title={labels.loadTitle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {busy ? (
            <Loader2 size={compact ? 14 : 18} className="shrink-0 animate-spin" color="#E6AD5E" />
          ) : (
            <FileAudio size={compact ? 14 : 18} className="shrink-0" color={file ? "#E6AD5E" : "#8A8A94"} />
          )}
          <span className="flex min-w-0 flex-col">
            <span
              className={`truncate font-semibold ${compact ? "text-[11px]" : "text-[13px]"}`}
              style={{ color: file && missing ? "#FF7A7A" : "#F4EDE2" }}
            >
              {file ? file.name : labels.empty}
            </span>
            {/* In the compact card an error takes the detail line's place so
                the knobs below don't move; hover shows all of it. */}
            <span
              className={`truncate ${compact ? "text-[10px]" : "text-[11px]"}`}
              style={{ color: compact && error ? "#FF7A7A" : "#8A8A94" }}
              title={compact && error ? error : undefined}
            >
              {compact && error ? error : detail}
            </span>
          </span>
        </button>
        {file && !busy && (
          <button
            type="button"
            title={labels.unloadTitle}
            onClick={() => {
              setError(null);
              onClear();
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-black/30"
          >
            <X size={12} color="#8A8A94" />
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            void load(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {error && !compact && (
        <p className={`${compact ? "text-[10px]" : "text-[11px]"} leading-snug`} style={{ color: "#FF7A7A" }}>
          {error}
        </p>
      )}
    </div>
  );
}
