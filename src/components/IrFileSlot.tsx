"use client";

import { useEffect, useRef, useState } from "react";
import { FileAudio, Loader2, X } from "lucide-react";
import { audioEngine } from "@/lib/audioEngine";
import { decodeEffectFileAudio, hasEffectFile } from "@/lib/effectFiles";
import type { EffectFileRef } from "@/lib/effects";

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

interface IrFileSlotProps {
  file: EffectFileRef | undefined;
  impulse: ImpulseState;
  onLoad: (file: File) => Promise<string | null>;
  onClear: () => void;
  compact?: boolean;
}

const ACCEPT = ".wav,.wave,.aif,.aiff,.flac,.mp3,.ogg,audio/*";

/** Shows the loaded IR (or that none is loaded) and loads a new one from a
 * file picker or a file dropped onto it. */
export function IrFileSlot({ file, impulse, onLoad, onClear, compact = false }: IrFileSlotProps) {
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
  else if (impulse.status === "ready") {
    const { buffer } = impulse;
    const ms = buffer.duration * 1000;
    const length = ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
    const channels = buffer.numberOfChannels === 1 ? "mono" : buffer.numberOfChannels === 2 ? "stereo" : `${buffer.numberOfChannels} ch`;
    detail = `${length} · ${channels}`;
  } else if (impulse.status === "missing") detail = "File missing - load it again";
  else if (impulse.status === "loading") detail = "Reading…";
  else detail = compact ? "Click or drop a .wav" : "Click to choose a file, or drop one here";

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
          title="Load an impulse response"
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
              style={{ color: impulse.status === "missing" ? "#FF7A7A" : "#F4EDE2" }}
            >
              {file ? file.name : "Load IR…"}
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
            title="Unload IR"
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
          accept={ACCEPT}
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
