"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, Loader2, X } from "lucide-react";
import type { BounceParams } from "@/lib/bounce";
import { downloadBlob, ExportCancelled, exportProject, stemTracks, type ExportResult, type ExportStatus } from "@/lib/exportProject";
import { loadExportSettings, MP3_BITRATES, saveExportSettings, safeFileName, TAIL_CHOICES, type ExportSettings } from "@/lib/exportFormats";
import { reportError } from "@/lib/telemetry";

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex overflow-hidden rounded-md border border-border">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`flex-1 whitespace-nowrap px-2.5 py-1 text-[12px] disabled:cursor-not-allowed disabled:opacity-35 ${
            value === o.value ? "bg-accent/20 text-foreground" : "text-muted hover:bg-surface"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] items-center gap-3">
      <span className="text-[12px] text-muted">{label}</span>
      {children}
    </div>
  );
}

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
      <span className="flex flex-col">
        <span className="text-[12px] text-foreground">{label}</span>
        {hint && <span className="text-[11px] leading-snug text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** File → Export: the mix or stems, as WAV or MP3, for the whole song or
 * the loop region. Remembers the last settings in this browser. */
export function ExportDialog({
  songName,
  buildParams,
  loop,
  loopLabel,
  onClose,
  onExported,
}: {
  songName: string;
  /** The project as it is now, for rendering. */
  buildParams: () => BounceParams;
  /** The loop region in seconds, or null when there's no loop to export. */
  loop: { start: number; end: number } | null;
  loopLabel: string;
  onClose: () => void;
  onExported: (result: ExportResult, settings: ExportSettings) => void;
}) {
  const [s, setS] = useState<ExportSettings>(() => {
    const saved = loadExportSettings();
    return loop ? saved : { ...saved, range: "song" };
  });
  const [name, setName] = useState(songName);
  const [status, setStatus] = useState<ExportStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const busy = status !== null;
  const tracks = stemTracks(buildParams());
  const update = (patch: Partial<ExportSettings>) => setS((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (busy) cancelRef.current = true;
      else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, onClose]);

  const run = async () => {
    setError(null);
    cancelRef.current = false;
    setStatus({ label: "Starting…", fraction: 0 });
    saveExportSettings(s);
    try {
      const result = await exportProject(buildParams(), s, {
        songName: safeFileName(name),
        loop: loop ?? undefined,
        onStatus: setStatus,
        cancelled: () => cancelRef.current,
      });
      downloadBlob(result.blob, result.fileName);
      onExported(result, s);
    } catch (err) {
      if (err instanceof ExportCancelled) {
        setStatus(null);
        return;
      }
      reportError(err, "export");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStatus(null);
    }
  };

  const stems = s.what === "stems";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onPointerDown={(e) => !busy && e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Export" className="flex w-[480px] max-w-full flex-col gap-4 rounded-2xl border border-border bg-surface-raised p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Export</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-surface disabled:opacity-30">
            <X size={15} />
          </button>
        </div>

        <fieldset disabled={busy} className="flex flex-col gap-3">
          <Row label="Export">
            <Segmented
              label="What to export"
              value={s.what}
              onChange={(what) => update({ what })}
              options={[
                { value: "mix", label: "Mix" },
                { value: "stems", label: `Stems${tracks.length ? ` (${tracks.length})` : ""}`, disabled: tracks.length === 0, title: "One file per track, in a ZIP" },
              ]}
            />
          </Row>
          <Row label="Format">
            <Segmented
              label="Format"
              value={s.format}
              onChange={(format) => update({ format })}
              options={[
                { value: "wav", label: "WAV" },
                { value: "mp3", label: "MP3" },
              ]}
            />
          </Row>
          <Row label="Quality">
            {s.format === "wav" ? (
              <Segmented
                label="Bit depth"
                value={s.wavBits}
                onChange={(wavBits) => update({ wavBits })}
                options={[
                  { value: 16, label: "16-bit" },
                  { value: 24, label: "24-bit" },
                ]}
              />
            ) : (
              <Segmented
                label="Bitrate"
                value={s.mp3Kbps}
                onChange={(mp3Kbps) => update({ mp3Kbps })}
                options={MP3_BITRATES.map((k) => ({ value: k, label: `${k} kbps` }))}
              />
            )}
          </Row>
          <Row label="Range">
            <Segmented
              label="Range"
              value={s.range}
              onChange={(range) => update({ range })}
              options={[
                { value: "song", label: "Whole song" },
                { value: "loop", label: loop ? `Loop ${loopLabel}` : "Loop", disabled: !loop, title: loop ? undefined : "Turn the loop on to export just that part" },
              ]}
            />
          </Row>
          <Row label="Tail">
            <select
              value={s.tail}
              onChange={(e) => update({ tail: Number(e.target.value) })}
              aria-label="Tail"
              className="w-40 rounded-md border border-border bg-surface px-2 py-1 text-[12px]"
              title="Extra time after the end so reverb and delay can ring out"
            >
              {TAIL_CHOICES.map((t) => (
                <option key={t} value={t}>
                  {t === 0 ? "None" : `${t} second${t > 1 ? "s" : ""}`}
                </option>
              ))}
            </select>
          </Row>
          {stems ? (
            <Check
              checked={s.stemMasterFx}
              onChange={(stemMasterFx) => update({ stemMasterFx })}
              label="Master effects on each stem"
              hint={
                s.stemMasterFx
                  ? "Each stem goes through the master effects and limiter on its own, so together they won't add up exactly to the mix."
                  : "Every stem starts at the same point and includes its sends to buses. Together they add up to the mix before the master effects."
              }
            />
          ) : (
            <Check checked={s.normalize} onChange={(normalize) => update({ normalize })} label="Normalize" hint="Raise or lower the whole mix so its loudest peak is at −1 dB." />
          )}
          <Row label="File name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              aria-label="File name"
              className="rounded-md border border-border bg-surface px-2 py-1 text-[12px] outline-none focus:border-accent"
            />
          </Row>
        </fieldset>

        <p className="text-[11px] leading-snug text-muted">
          Taking the parts to another DAW? MIDI tracks and clips export as .mid from the track header or the clip&rsquo;s
          right-click menu.
        </p>

        {error && <p className="rounded-md border border-record/40 bg-record/10 px-3 py-2 text-[12px] text-record">{error}</p>}

        {status ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-[12px] text-muted">
              <span className="flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                {status.label}
              </span>
              <span className="font-mono">{Math.round(status.fraction * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(status.fraction * 100)}%` }} />
            </div>
            <button type="button" onClick={() => (cancelRef.current = true)} className="self-end rounded-md border border-border px-3 py-1 text-[12px] hover:bg-surface">
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-surface">
              Cancel
            </button>
            <button type="button" onClick={() => void run()} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-black hover:brightness-110">
              <Download size={13} />
              Export {stems ? "stems" : s.format.toUpperCase()}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
