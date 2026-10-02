"use client";

import { useEffect, useState } from "react";
import { AudioLines, BookOpen, Clock, FilePlus2, FolderOpen, Guitar, Mic2, X } from "lucide-react";
import type { RecentProject } from "@/lib/projectFiles";
import { PROJECT_TEMPLATES, type ProjectTemplate, type TemplateId } from "@/lib/templates";

const ICONS: Record<TemplateId, typeof Guitar> = {
  "guitar-demo": Guitar,
  beat: AudioLines,
  "voice-guitar": Mic2,
  empty: FilePlus2,
};

export const GUIDE_URL = "/how-it-works#setup";

/** Shown on the first visit and from File → New: start from a template,
 * open a project, or pick a recent one. */
export function StartScreen({
  firstVisit,
  folders,
  listRecent,
  onTemplate,
  onOpen,
  onOpenRecent,
  onImport,
  onClose,
}: {
  firstVisit: boolean;
  /** Projects can be opened as folders (else as files). */
  folders: boolean;
  listRecent: () => Promise<RecentProject[]>;
  onTemplate: (t: ProjectTemplate) => void;
  onOpen: () => void;
  onOpenRecent: (r: RecentProject) => void;
  onImport: (file: File) => void;
  onClose: () => void;
}) {
  const [recent, setRecent] = useState<RecentProject[]>([]);

  useEffect(() => {
    if (folders) void listRecent().then((r) => setRecent(r.slice(0, 5)));
  }, [folders, listRecent]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div role="dialog" aria-label="Start" className="flex max-h-full w-[860px] max-w-full flex-col gap-5 overflow-y-auto rounded-2xl border border-border bg-surface-raised p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon.png" alt="" className="h-10 w-10 rounded-lg" />
            <div>
              <h2 className="text-lg font-semibold">{firstVisit ? "Welcome to The Dawn Project" : "New project"}</h2>
              <p className="text-[12.5px] text-muted">
                {firstVisit ? "A studio in a tab. Pick a starting point - you can change everything later." : "Pick a starting point."}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded text-muted hover:bg-surface">
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-[1fr_230px] gap-5 max-md:grid-cols-1">
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            {PROJECT_TEMPLATES.map((t) => {
              const Icon = ICONS[t.id];
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onTemplate(t)}
                  className="group flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-accent hover:bg-accent/5"
                >
                  <span className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
                      <Icon size={16} />
                    </span>
                    <span className="text-[14px] font-semibold">{t.name}</span>
                  </span>
                  <span className="text-[12px] text-foreground/85">{t.description}</span>
                  <ul className="flex flex-col gap-0.5 text-[11px] text-muted">
                    {t.contents.map((c) => (
                      <li key={c}>· {c}</li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Open</h3>
              {folders ? (
                <button type="button" onClick={onOpen} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[12.5px] hover:bg-surface">
                  <FolderOpen size={14} /> Open a project folder…
                </button>
              ) : (
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-[12.5px] hover:bg-surface">
                  <FolderOpen size={14} /> Open a project file…
                  <input
                    type="file"
                    accept=".dawnproject"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onImport(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
            {recent.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Recent</h3>
                {recent.map((r) => (
                  <button
                    key={`${r.name}-${r.openedAt}`}
                    type="button"
                    onClick={() => onOpenRecent(r)}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-surface"
                  >
                    <Clock size={12} className="shrink-0 text-muted" />
                    <span className="truncate">{r.name}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Learn</h3>
              <a href={GUIDE_URL} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[12.5px] hover:bg-surface">
                <BookOpen size={14} /> Setup guide and user guide
              </a>
              <p className="text-[11px] leading-snug text-muted">
                Works best in Chrome or Edge on a computer, with headphones. For guitar, an audio interface is recommended.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
