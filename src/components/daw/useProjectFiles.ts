// The open project's files. It autosaves to IndexedDB a moment after any
// change: a working copy that survives a reload or a crash, restored on
// start. Save writes it to a folder on the computer (or one project file).
// Also here: the project's name and folder, unsaved changes, and opening
// another project (a folder, a file, a recent one, the demo, a template).

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDemoSong } from "@/project/demoSong";
import { restorePacks } from "@/project/packStore";
import { loadProject, saveProject } from "@/project/persistence";
import type { ProjectState } from "@/project/project";
import {
  BUNDLE_EXTENSION,
  createProjectFolder,
  decodeBundle,
  encodeBundle,
  ensurePermission,
  loadFromFolder,
  pickProjectFolder,
  readOpenProject,
  rememberRecent,
  safeName,
  saveToFolder,
  supportsFolders,
  writeOpenProject,
  type ProjectDocument,
  type ProjectFolder,
  type RecentProject,
} from "@/project/projectFiles";
import { startFreshKeepingBackup } from "@/project/projectRecovery";
import type { SerializedProject } from "@/project/projectSchema";
import { track } from "@/lib/telemetry";
import { autosaveBlobs, documentToSave, openInStore, serializeProject, type SessionSettings } from "@/state/projectDocument";
import { projectStore, useProjectDoc } from "@/state/projectStore";
import { LATEST_VERSION } from "@/content/whatsNew";
import { useShortcuts } from "@/lib/shortcuts";
import { noteIssue } from "@/lib/issues";

export interface ProjectFilesEvents {
  /** Another project is about to open: stop playing. */
  beforeOpen: () => void;
  /** A project was opened: take on its session settings, reset the view,
   * rebuild the engine. */
  opened: (project: SerializedProject, state: ProjectState) => void;
  /** The working copy was restored on start (or there was none: a first
   * visit); `newVersion` when the studio was updated since the last visit. */
  started: (info: { firstVisit: boolean; newVersion: boolean }) => void;
}

export function useProjectFiles(session: SessionSettings, events: ProjectFilesEvents) {
  const doc = useProjectDoc();
  const { masterLimiterThreshold, scaleSetting, snapResolution, countInBars, metronomeEnabled, loop, monitoredTracks } = session;

  const eventsRef = useRef(events);
  useEffect(() => {
    eventsRef.current = events;
  });

  const loadedRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // The open project: its name, the folder it's saved in (if any), and
  // whether it has changes that aren't saved there yet.
  const [name, setName] = useState("Untitled");
  const folderRef = useRef<ProjectFolder | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const markCleanRef = useRef(true);
  /** The next autosave rewrites all stored audio (another project opened). */
  const fullAutosaveRef = useRef(false);
  const forceDirtyRef = useRef(false);
  /** Bumped to have the project menu ask for a name (Save with no folder
   * yet, Ctrl+Shift+S). */
  const [saveAsRequest, setSaveAsRequest] = useState(0);

  /** The project as saved. A new function exactly when the song changes,
   * which is what tells unsaved changes and autosave something changed. */
  const buildProject = useCallback(
    (): SerializedProject =>
      serializeProject(doc, { masterLimiterThreshold, scaleSetting, snapResolution, countInBars, metronomeEnabled, loop, monitoredTracks }),
    [doc, masterLimiterThreshold, scaleSetting, snapResolution, countInBars, metronomeEnabled, loop, monitoredTracks]
  );

  const persistNow = useCallback(async () => {
    setSaveStatus("saving");
    try {
      const replaceAll = fullAutosaveRef.current;
      await saveProject(buildProject(), autosaveBlobs(projectStore.get()), replaceAll);
      if (replaceAll) fullAutosaveRef.current = false;
      await writeOpenProject({ name, folder: folderRef.current, dirty });
      setSaveStatus("saved");
    } catch (error) {
      setSaveStatus("error");
      noteIssue("autosave", error);
    }
  }, [buildProject, name, dirty]);

  const apply = useCallback((project: SerializedProject, blobs: Map<string, Blob>, history: ProjectDocument["history"]) => {
    const state = openInStore(project, blobs, history);
    eventsRef.current.opened(project, state);
    markCleanRef.current = true;
  }, []);

  // Restore the working copy on mount, before autosave may run - so a page
  // load never overwrites a saved project with the starter one before the
  // load has even been tried.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [result, info] = await Promise.all([
        loadProject().catch((error) => {
          noteIssue("load.workingcopy", error);
          return null;
        }),
        readOpenProject().catch((error) => {
          noteIssue("load.openinfo", error);
          return null;
        }),
        restorePacks().catch((error) => noteIssue("load.packs", error)),
      ]);
      if (cancelled) return;
      if (result) {
        try {
          // normalizeProject returns null for data that isn't a project at
          // all; anything else has already been repaired into a valid shape.
          if (!result.project) throw new Error("the saved data isn't a project");
          apply(result.project, result.blobs, null);
        } catch (err) {
          // Never leave the studio stuck on a project it can't open: keep a
          // backup of it, start fresh, and say what happened.
          await startFreshKeepingBackup(`Couldn't open the saved project (${err instanceof Error ? err.message : String(err)}).`);
          return;
        }
      }
      if (info) {
        setName(info.name || "Untitled");
        folderRef.current = info.folder;
        setFolderName(info.folder?.name ?? null);
        // Unsaved changes stay unsaved across a reload.
        if (info.dirty) forceDirtyRef.current = true;
      }
      loadedRef.current = true;
      setIsLoading(false);
      let newVersion = false;
      try {
        newVersion = !!result && localStorage.getItem("dawn.lastSeenVersion") !== LATEST_VERSION;
        localStorage.setItem("dawn.lastSeenVersion", LATEST_VERSION);
      } catch {
        // No storage: skip the release notes.
      }
      eventsRef.current.started({ firstVisit: !result, newVersion });
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  // --- Unsaved changes: "saved" is which buildProject was last written. ---
  const savedDocRef = useRef<unknown>(null);
  const currentDocRef = useRef<unknown>(null);
  useEffect(() => {
    currentDocRef.current = buildProject;
    if (markCleanRef.current) {
      markCleanRef.current = false;
      savedDocRef.current = buildProject;
    }
    if (forceDirtyRef.current) {
      forceDirtyRef.current = false;
      savedDocRef.current = null;
    }
    setDirty(buildProject !== savedDocRef.current);
  }, [buildProject]);

  /** Marks the song as it was when `saved` was taken as saved. */
  const markSaved = useCallback((saved: unknown) => {
    savedDocRef.current = saved;
    setDirty(currentDocRef.current !== saved);
  }, []);

  const flashNotice = useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((cur) => (cur === text ? null : cur)), 5000);
  }, []);

  const saveInto = useCallback(
    async (folder: ProjectFolder, saveName: string) => {
      setBusy(true);
      const saved = currentDocRef.current;
      try {
        if (!(await ensurePermission(folder))) throw new Error("permission to write to the folder was refused");
        await saveToFolder(folder, documentToSave(buildProject(), saveName));
        folderRef.current = folder;
        setFolderName(folder.name);
        setName(saveName);
        markSaved(saved);
        await rememberRecent(saveName, folder);
        flashNotice(`Saved to the folder "${folder.name}"`);
        track("project_saved", { target: "folder" });
      } catch (err) {
        flashNotice(`Couldn't save: ${err instanceof Error ? err.message : String(err)}`);
        track("error_shown", { area: "save" });
      } finally {
        setBusy(false);
      }
    },
    [buildProject, markSaved, flashNotice]
  );

  /** Downloads the project as one file. */
  const downloadFile = useCallback(
    async (fileName: string) => {
      const blob = await encodeBundle(documentToSave(buildProject(), fileName));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName(fileName)}${BUNDLE_EXTENSION}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      track("project_saved", { target: "file" });
    },
    [buildProject]
  );

  const saveAs = useCallback(
    async (saveName: string) => {
      if (!supportsFolders()) {
        const saved = currentDocRef.current;
        await downloadFile(saveName);
        setName(saveName);
        markSaved(saved);
        return;
      }
      const folder = await createProjectFolder(saveName).catch(() => null);
      if (folder) await saveInto(folder, saveName);
    },
    [downloadFile, saveInto, markSaved]
  );

  const save = useCallback(async () => {
    if (folderRef.current) await saveInto(folderRef.current, name);
    else setSaveAsRequest((n) => n + 1);
  }, [saveInto, name]);

  /** Whether it's fine to close the project: no unsaved changes, or the
   * user agrees to lose them. */
  const confirmDiscard = useCallback(() => !dirty || window.confirm(`"${name}" has unsaved changes. Discard them?`), [dirty, name]);

  const openDocument = useCallback(
    (opened: ProjectDocument, folder: ProjectFolder | null) => {
      eventsRef.current.beforeOpen();
      apply(opened.project, opened.blobs, opened.history);
      fullAutosaveRef.current = true;
      setName(opened.name);
      folderRef.current = folder;
      setFolderName(folder?.name ?? null);
      flashNotice(`Opened "${opened.name}"`);
    },
    [apply, flashNotice]
  );

  /** Starts a new, unsaved project from `project` (a template). */
  const startNew = useCallback(
    (project: SerializedProject, newName: string) => {
      eventsRef.current.beforeOpen();
      apply(project, new Map(), null);
      fullAutosaveRef.current = true;
      setName(newName);
      folderRef.current = null;
      setFolderName(null);
    },
    [apply]
  );

  const openFolder = useCallback(
    async (folder: ProjectFolder) => {
      setBusy(true);
      try {
        if (!(await ensurePermission(folder))) throw new Error("permission to read the folder was refused");
        const opened = await loadFromFolder(folder);
        openDocument(opened, folder);
        await rememberRecent(opened.name, folder);
      } catch (err) {
        flashNotice(`Couldn't open it: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [openDocument, flashNotice]
  );

  const open = useCallback(async () => {
    if (!confirmDiscard()) return;
    try {
      const folder = await pickProjectFolder();
      if (folder) await openFolder(folder);
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : String(err));
    }
  }, [confirmDiscard, openFolder, flashNotice]);

  const openRecent = useCallback(
    async (r: RecentProject) => {
      if (!confirmDiscard()) return;
      await openFolder(r.folder);
    },
    [confirmDiscard, openFolder]
  );

  const importFile = useCallback(
    async (file: File) => {
      if (!confirmDiscard()) return;
      try {
        openDocument(await decodeBundle(file), null);
        // An imported file isn't anywhere on disk until it's saved.
        forceDirtyRef.current = true;
      } catch (err) {
        flashNotice(`Couldn't open "${file.name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [confirmDiscard, openDocument, flashNotice]
  );

  /** Opens the demo song (the start screen's offer, and the first visit). */
  const loadDemo = useCallback(async (): Promise<boolean> => {
    try {
      openDocument(await decodeBundle(await fetchDemoSong()), null);
      track("template_chosen", { template: "demo" });
      return true;
    } catch (err) {
      flashNotice(`Couldn't open the demo song: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }, [openDocument, flashNotice]);

  // Ctrl/Cmd+S saves, +Shift saves as, Ctrl/Cmd+O opens - everywhere, even
  // while typing, in the piano roll or with a dialog open.
  useShortcuts("global", [
    { keys: "mod+s", label: "Save", whileTyping: true, run: () => void save() },
    { keys: "mod+shift+s", label: "Save As", whileTyping: true, run: () => setSaveAsRequest((n) => n + 1) },
    {
      keys: "mod+o",
      label: "Open a project",
      whileTyping: true,
      run: () => {
        if (supportsFolders()) void open();
      },
    },
  ]);

  // Autosave a moment after the project settles, not on every keystroke
  // or drag frame.
  useEffect(() => {
    if (!loadedRef.current) return;
    const timer = setTimeout(() => void persistNow(), 1200);
    return () => clearTimeout(timer);
  }, [persistNow]);

  return {
    isLoading,
    saveStatus,
    name,
    folderName,
    dirty,
    busy,
    notice,
    flashNotice,
    saveAsRequest,
    save,
    saveAs,
    downloadFile,
    confirmDiscard,
    open,
    openRecent,
    importFile,
    loadDemo,
    startNew,
  };
}
