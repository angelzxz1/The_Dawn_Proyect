"use client";

import { useState, useSyncExternalStore } from "react";
import { ChevronRight, FolderPlus, RefreshCw, Search, X } from "lucide-react";
import { plugins as pluginStore } from "@/engine/native/plugins";
import type { PluginFormat, PluginInfo } from "@/engine/native/bridge";

const GROUPS: { kind: PluginInfo["kind"]; name: string }[] = [
  { kind: "instrument", name: "Instruments" },
  { kind: "effect", name: "Effects" },
  { kind: "noteEffect", name: "Note effects" },
];

const FORMAT_LABELS: Record<PluginFormat, string> = { vst3: "VST3", clap: "CLAP" };

/** The last part of a path, whichever way its separators lean. */
const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

const matches = (p: PluginInfo, query: string) =>
  [p.name, p.vendor, FORMAT_LABELS[p.format], ...p.categories].some((t) => t.toLowerCase().includes(query));

/**
 * The browser's Plugins tab (desktop app only): the VST3 and CLAP plugins
 * the desktop app found on this computer, as instruments, effects and note
 * effects, with how the scan is going, the files that couldn't be read
 * (and why), and the folders it looks in, to which more can be added.
 */
export function PluginBrowser() {
  const { list, error } = useSyncExternalStore(pluginStore.subscribe, () => pluginStore.current, () => pluginStore.current);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showFailed, setShowFailed] = useState(false);
  const [showFolders, setShowFolders] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const q = query.trim().toLowerCase();

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const addFolder = async () => {
    if (!newFolder.trim()) return;
    try {
      await pluginStore.addFolder(newFolder);
      setNewFolder("");
      setFolderError(null);
    } catch (e) {
      setFolderError(String(e));
    }
  };

  const scan = list?.scan ?? null;
  const shown = (list?.plugins ?? []).filter((p) => !q || matches(p, q));
  const groups = GROUPS.map((g) => ({ ...g, plugins: shown.filter((p) => p.kind === g.kind) })).filter((g) => g.plugins.length > 0);

  return (
    <>
      <div className="border-b border-border p-2">
        <label className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1 focus-within:border-accent">
          <Search size={11} className="shrink-0 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search plugins, makers"
            aria-label="Search plugins"
            className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} title="Clear search" className="text-muted hover:text-foreground">
              <X size={11} />
            </button>
          )}
        </label>
      </div>

      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5 text-[10.5px] text-muted" aria-live="polite">
        {scan ? (
          <span className="flex min-w-0 flex-1 flex-col gap-1" aria-label="Plugin scan">
            <span className="truncate" title={scan.reading.map(fileName).join(", ")}>
              Looking for plugins{scan.total > 0 ? `: ${scan.done} of ${scan.total}` : "…"}
              {scan.reading[0] ? ` · ${fileName(scan.reading[0])}` : ""}
            </span>
            <span className="h-0.5 overflow-hidden rounded bg-surface-raised">
              <span className="block h-full bg-accent transition-all" style={{ width: `${scan.total ? (scan.done / scan.total) * 100 : 0}%` }} />
            </span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate">
            {error ? "The plugin list couldn't be read." : list ? `${list.plugins.length} plugin${list.plugins.length === 1 ? "" : "s"} found` : "Looking for plugins…"}
          </span>
        )}
        <button
          type="button"
          onClick={() => void pluginStore.rescan()}
          disabled={!!scan}
          title="Look again, for plugins installed or updated since"
          aria-label="Rescan plugins"
          className="shrink-0 rounded p-0.5 hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw size={11} className={scan ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {list && list.plugins.length > 0 && (
          <p className="px-1 pb-1 text-[10.5px] leading-snug text-muted">Putting them on tracks comes in the next update.</p>
        )}
        {list && !scan && list.plugins.length === 0 && (
          <p className="px-1 py-2 text-[11px] leading-snug text-muted">
            No VST3 or CLAP plugins were found in the folders below. Installed somewhere else? Add that folder.
          </p>
        )}
        {q && list && list.plugins.length > 0 && groups.length === 0 && (
          <p className="px-1 py-2 text-[11px] text-muted">Nothing matches “{query.trim()}”.</p>
        )}
        {groups.map((group) => {
          const isCollapsed = !q && collapsed.has(group.kind);
          return (
            <div key={group.kind}>
              <button
                type="button"
                onClick={() => toggle(group.kind)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-1 rounded px-1 py-1.5 text-left text-[11px] font-medium text-foreground/80 hover:bg-surface-raised"
              >
                <ChevronRight size={11} className={`shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
                {group.name}
                <span className="ml-auto font-normal text-muted">{group.plugins.length}</span>
              </button>
              {!isCollapsed && (
                <ul className="ml-3 flex flex-col gap-0.5 border-l border-border pl-1" aria-label={group.name}>
                  {group.plugins.map((p) => (
                    <li
                      key={`${p.format}:${p.id}`}
                      title={`${p.name}${p.vendor ? ` by ${p.vendor}` : ""} · ${FORMAT_LABELS[p.format]}${p.version ? ` ${p.version}` : ""}\n${p.path}`}
                      className="flex min-w-0 items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted"
                    >
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="shrink-0 rounded border border-border px-1 text-[9px] font-semibold tracking-wide">{FORMAT_LABELS[p.format]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {list && list.failed.length > 0 && (
          <div className="mt-2 border-t border-border pt-1.5">
            <button
              type="button"
              onClick={() => setShowFailed((v) => !v)}
              aria-expanded={showFailed}
              className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-[11px] text-[#E6AD5E] hover:bg-surface-raised"
            >
              <ChevronRight size={11} className={`shrink-0 transition-transform ${showFailed ? "rotate-90" : ""}`} />
              {list.failed.length} couldn&apos;t be read
            </button>
            {showFailed && (
              <div className="ml-3 flex flex-col gap-1.5 border-l border-border py-1 pl-2">
                <ul className="flex flex-col gap-1.5" aria-label="Plugins that couldn't be read">
                  {list.failed.map((f) => (
                    <li key={f.path} title={f.path} className="flex flex-col text-[10.5px] leading-snug">
                      <span className="truncate text-foreground/80">{fileName(f.path)}</span>
                      <span className="text-muted">{f.error}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => void pluginStore.rescan(true)}
                  disabled={!!scan}
                  className="self-start rounded border border-border px-1.5 py-0.5 text-[10.5px] text-muted hover:border-accent hover:text-accent disabled:opacity-40"
                >
                  Try them again
                </button>
              </div>
            )}
          </div>
        )}

        {list && (
          <div className="mt-2 border-t border-border pt-1.5">
            <button
              type="button"
              onClick={() => setShowFolders((v) => !v)}
              aria-expanded={showFolders}
              className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-[11px] text-foreground/80 hover:bg-surface-raised"
            >
              <ChevronRight size={11} className={`shrink-0 transition-transform ${showFolders ? "rotate-90" : ""}`} />
              Folders
            </button>
            {showFolders && (
              <div className="ml-3 flex flex-col gap-1.5 border-l border-border py-1 pl-2">
                <ul className="flex flex-col gap-1" aria-label="Plugin folders">
                  {list.folders.map((f) => (
                    <li key={f.path} className="flex items-start gap-1 text-[10px] leading-snug">
                      <span className={`min-w-0 flex-1 break-all ${f.exists ? "text-muted" : "text-muted/50"}`} title={f.exists ? f.path : `${f.path} (not on this computer)`}>
                        {f.path}
                      </span>
                      {!f.standard && (
                        <button
                          type="button"
                          onClick={() => void pluginStore.removeFolder(f.path)}
                          title="Stop looking in this folder"
                          aria-label={`Stop looking in ${f.path}`}
                          className="shrink-0 text-muted hover:text-foreground"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void addFolder();
                  }}
                >
                  <input
                    value={newFolder}
                    onChange={(e) => setNewFolder(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="Another folder's path"
                    aria-label="Folder to add"
                    className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10.5px] text-foreground outline-none placeholder:text-muted focus:border-accent"
                  />
                  <button type="submit" title="Look in this folder too" aria-label="Add folder" className="shrink-0 text-muted hover:text-accent">
                    <FolderPlus size={12} />
                  </button>
                </form>
                {folderError && <p className="text-[10.5px] leading-snug text-[#FF6B6B]">{folderError}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
