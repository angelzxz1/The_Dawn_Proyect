"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Download, Loader2, Package, Trash2, Upload, X } from "lucide-react";
import { PACK_EXTENSION } from "@/lib/dawnPack";
import { buildMyPresetsPack, installedPacks, subscribePacks, type InstalledPack } from "@/lib/packStore";
import { downloadBlob } from "@/lib/exportProject";
import { safeFileName } from "@/lib/exportFormats";

const EMPTY: InstalledPack[] = [];

function describe(p: InstalledPack): string {
  const c = p.counts;
  const parts = [
    [c.effectPresets, "effect preset"],
    [c.synthPresets, "synth preset"],
    [c.kits, "kit"],
    [c.grooves, "groove"],
    [c.irs, "cabinet"],
    [c.amps, "amp capture"],
    [c.samples, "sample"],
  ] as const;
  return (
    parts
      .filter(([n]) => n > 0)
      .map(([n, label]) => `${n} ${label}${n === 1 ? "" : "s"}`)
      .join(" · ") || "Nothing"
  );
}

/** File → Sound Packs: install .dawnpack files (supporter packs, backups),
 * see and remove installed ones, and save your own presets as a pack. */
export function PacksWindow({
  initialMessage,
  onInstall,
  onRemove,
  onClose,
}: {
  /** The outcome of a pack dropped onto the app, shown when the window opens. */
  initialMessage?: { ok: boolean; text: string } | null;
  /** Installs a pack file; resolves with a message for the person. */
  onInstall: (file: File) => Promise<{ ok: boolean; message: string }>;
  onRemove: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const packs = useSyncExternalStore(subscribePacks, installedPacks, () => EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(initialMessage ?? null);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState({ name: "My Presets", author: "", license: "Personal use" });
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const install = async (file: File) => {
    setBusy("install");
    setMessage(null);
    const r = await onInstall(file);
    setMessage({ ok: r.ok, text: r.message });
    setBusy(null);
  };

  const exportMine = async () => {
    setBusy("export");
    setMessage(null);
    try {
      const { bytes, counts, missingFiles } = await buildMyPresetsPack(info);
      const total = counts.effectPresets + counts.synthPresets + counts.kits;
      if (total === 0) {
        setMessage({ ok: false, text: "You haven't saved any presets or kits of your own yet." });
        return;
      }
      downloadBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${safeFileName(info.name, "My Presets")}${PACK_EXTENSION}`);
      setMessage({
        ok: true,
        text:
          `Saved ${total} preset${total === 1 ? "" : "s"} and kit${total === 1 ? "" : "s"}${counts.files ? ` with ${counts.files} file${counts.files === 1 ? "" : "s"}` : ""}.` +
          (missingFiles ? ` ${missingFiles} sample${missingFiles === 1 ? " wasn't" : "s weren't"} loaded in this session, so ${missingFiles === 1 ? "it was" : "they were"} left out; open a project that uses ${missingFiles === 1 ? "it" : "them"} first.` : ""),
      });
      setSaving(false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-label="Sound Packs"
        className={`flex max-h-full w-[560px] max-w-full flex-col gap-4 overflow-y-auto rounded-2xl border bg-surface-raised p-5 shadow-2xl ${dragOver ? "border-accent" : "border-border"}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) void install(file);
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <Package size={16} /> Sound Packs
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-surface">
            <X size={15} />
          </button>
        </div>
        <p className="text-[12px] leading-relaxed text-muted">
          Packs add presets, drum kits, grooves, cabinets and amp captures. They&rsquo;re kept in this browser; projects
          that use a pack&rsquo;s sounds keep their own copies, so they still open after the pack is removed.
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={!!busy}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-black hover:brightness-110 disabled:opacity-50"
          >
            {busy === "install" ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            Install a pack…
          </button>
          <button
            type="button"
            onClick={() => setSaving((v) => !v)}
            disabled={!!busy}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-surface disabled:opacity-50"
          >
            <Download size={13} /> Save my presets as a pack…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={`${PACK_EXTENSION},.zip`}
            className="hidden"
            aria-label="Pack file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void install(f);
              e.target.value = "";
            }}
          />
        </div>
        <p className="-mt-2 text-[11px] text-muted">…or drop a {PACK_EXTENSION} file here.</p>

        {saving && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
            <p className="text-[12px] text-muted">Your effect presets, Daybreak presets and drum kits, in one file: a backup, or something to share.</p>
            {(["name", "author", "license"] as const).map((key) => (
              <label key={key} className="grid grid-cols-[70px_1fr] items-center gap-2 text-[12px]">
                <span className="capitalize text-muted">{key}</span>
                <input
                  value={info[key]}
                  onChange={(e) => setInfo((prev) => ({ ...prev, [key]: e.target.value }))}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="rounded border border-border bg-surface-raised px-2 py-1 outline-none focus:border-accent"
                />
              </label>
            ))}
            <button
              type="button"
              onClick={() => void exportMine()}
              disabled={!!busy}
              className="flex items-center gap-1.5 self-end rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-black hover:brightness-110 disabled:opacity-50"
            >
              {busy === "export" ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Save pack
            </button>
          </div>
        )}

        {message && (
          <p role="status" className={`rounded-md border px-3 py-2 text-[12px] ${message.ok ? "border-success/40 bg-success/10 text-foreground" : "border-record/40 bg-record/10 text-record"}`}>
            {message.text}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Installed</h3>
          {packs.length === 0 && <p className="text-[12px] text-muted">No packs installed.</p>}
          {packs.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[13px] font-medium">
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">
                      {p.name}
                    </a>
                  ) : (
                    p.name
                  )}{" "}
                  <span className="font-mono text-[10.5px] text-muted">{p.version}</span>
                </p>
                <p className="text-[11.5px] text-muted">
                  by {p.author} · {p.license}
                </p>
                {p.description && <p className="mt-0.5 text-[11.5px] text-foreground/80">{p.description}</p>}
                <p className="mt-0.5 text-[11px] text-muted">{describe(p)}</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!window.confirm(`Remove "${p.name}" and everything it added?`)) return;
                  setBusy(p.id);
                  await onRemove(p.id);
                  setBusy(null);
                  setMessage({ ok: true, text: `Removed "${p.name}".` });
                }}
                disabled={!!busy}
                aria-label={`Remove ${p.name}`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted hover:bg-surface-raised hover:text-record disabled:opacity-40"
              >
                {busy === p.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
