"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FilePlus2, FolderOpen, History, Package, Save, Upload } from "lucide-react";
import type { RecentProject } from "@/lib/projectFiles";
import { useShortcuts } from "@/lib/shortcuts";

/** The project's name (with a dot while there are unsaved changes) and
 * its File menu: New, Open, recent projects, Save, Save As, and a single
 * project file to import or export. */
export function ProjectMenu({
  name,
  dirty,
  folders,
  brave,
  folderName,
  busy,
  onNew,
  onOpen,
  onOpenRecent,
  listRecent,
  onSave,
  onSaveAs,
  onImport,
  onExport,
  onPacks,
  saveAsRequest,
}: {
  name: string;
  dirty: boolean;
  /** Whether this browser can save to folders. */
  folders: boolean;
  /** Brave, which can save to folders once a setting is turned on. */
  brave: boolean;
  /** The folder the project is saved in, if any. */
  folderName: string | null;
  busy: boolean;
  onNew: () => void;
  onOpen: () => void;
  onOpenRecent: (r: RecentProject) => void;
  listRecent: () => Promise<RecentProject[]>;
  onSave: () => void;
  onSaveAs: (name: string) => void;
  onImport: (file: File) => void;
  onExport: () => void;
  /** Opens the sound packs window. */
  onPacks?: () => void;
  /** Bumped to open the Save As dialog from outside (a shortcut). */
  saveAsRequest: number;
}) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [asking, setAsking] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null);
  const lastRequest = useRef(saveAsRequest);
  useEffect(() => {
    if (saveAsRequest === lastRequest.current) return;
    lastRequest.current = saveAsRequest;
    // Opening a dialog in answer to a shortcut.
    setAsking(true);
  }, [saveAsRequest]);

  useEffect(() => {
    if (!open) return;
    if (folders) void listRecent().then(setRecent);
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, folders, listRecent]);
  useShortcuts("menu", [{ keys: "escape", run: () => setOpen(false), whileTyping: true }], { enabled: open });

  const item = (label: string, icon: React.ReactNode, onClick: () => void, hint?: string) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-surface"
    >
      <span className="text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[10px] text-muted">{hint}</span>}
    </button>
  );
  const mod = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+";

  return (
    <div ref={root} className="relative flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        className="flex h-7 items-center gap-1 rounded border border-border px-2 text-[12px] text-foreground/90 hover:bg-surface-raised disabled:opacity-50"
      >
        File <ChevronDown size={12} className="text-muted" />
      </button>
      <span
        className="max-w-[220px] truncate text-[13px] font-medium"
        title={folderName ? `Saved in the folder "${folderName}"${dirty ? " - unsaved changes" : ""}` : dirty ? "Not saved to your computer yet" : "Not saved to your computer yet"}
      >
        {name}
      </span>
      {dirty && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" title="Unsaved changes" aria-label="Unsaved changes" />}

      {open && (
        <div role="menu" className="absolute left-0 top-8 z-[60] w-64 rounded-lg border border-border bg-surface-raised p-1 shadow-2xl">
          {item("New Project", <FilePlus2 size={13} />, onNew)}
          {item(folders ? "Open Project…" : "Open Project File…", <FolderOpen size={13} />, folders ? onOpen : () => fileInput?.click(), `${mod}O`)}
          {folders && recent.length > 0 && (
            <div className="my-1 border-t border-border pt-1">
              <div className="flex items-center gap-1 px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                <History size={10} /> Recent
              </div>
              {recent.map((r) => (
                <button
                  key={`${r.name}-${r.openedAt}`}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onOpenRecent(r);
                  }}
                  className="block w-full truncate rounded px-2 py-1 pl-6 text-left text-[12px] hover:bg-surface"
                  title={`Folder: ${r.folder.name}`}
                >
                  {r.name}
                </button>
              ))}
            </div>
          )}
          <div className="my-1 border-t border-border" />
          {item("Save", <Save size={13} />, onSave, `${mod}S`)}
          {item("Save As…", <Save size={13} />, () => setAsking(true), `${mod}⇧S`)}
          <div className="my-1 border-t border-border" />
          {item("Export Project File…", <Download size={13} />, onExport)}
          {item("Import Project File…", <Upload size={13} />, () => fileInput?.click())}
          {onPacks && (
            <>
              <div className="my-1 border-t border-border" />
              {item("Sound Packs…", <Package size={13} />, onPacks)}
            </>
          )}
          <p className="px-2 pb-1 pt-1.5 text-[10.5px] leading-snug text-muted">
            {folders
              ? "Projects are saved to a folder on your computer: the song, its samples and its undo history."
              : brave
                ? <>Brave has saving to folders turned off, so projects are saved as one .dawnproject file. To save to folders, open <span className="select-all font-mono text-foreground/80">brave://flags/#file-system-access-api</span>, set it to Enabled and restart Brave.</>
                : "This browser can't save to folders, so projects are saved as one .dawnproject file (use Chrome or Edge for folders)."}
          </p>
        </div>
      )}
      <input
        ref={setFileInput}
        type="file"
        accept=".dawnproject,application/octet-stream"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onImport(file);
        }}
      />
      {asking && (
        <NameDialog
          initial={name === "Untitled" ? "" : name}
          folders={folders}
          onCancel={() => setAsking(false)}
          onConfirm={(n) => {
            setAsking(false);
            onSaveAs(n);
          }}
        />
      )}
    </div>
  );
}

function NameDialog({ initial, folders, onCancel, onConfirm }: { initial: string; folders: boolean; onCancel: () => void; onConfirm: (name: string) => void }) {
  const [value, setValue] = useState(initial);
  const clean = value.trim();
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        role="dialog"
        aria-label="Save project as"
        className="flex w-[380px] flex-col gap-3 rounded-xl border border-border bg-surface-raised p-4 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (clean) onConfirm(clean);
        }}
      >
        <h2 className="text-sm font-semibold">Save project as</h2>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="Project name"
          aria-label="Project name"
          maxLength={80}
          className="rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
        <p className="text-[11px] text-muted">
          {folders
            ? "Next, choose where to put it - a folder with this name is created there for the song, its samples and its history."
            : "It's saved as one .dawnproject file in your downloads."}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded px-3 py-1.5 text-xs text-muted hover:bg-surface">
            Cancel
          </button>
          <button type="submit" disabled={!clean} className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-background disabled:opacity-40">
            {folders ? "Choose Location…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
