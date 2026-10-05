"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Clipboard,
  Copy,
  CopyPlus,
  Download,
  FileAudio,
  FilePlus2,
  FolderInput,
  FolderOutput,
  FolderPlus,
  ChevronsDownUp,
  Heart,
  Info,
  Loader2,
  MessageSquare,
  Pencil,
  Redo2,
  Repeat,
  Scissors,
  Sliders,
  KeyboardMusic,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { TrackHeader } from "./TrackHeader";
import { TrackLane } from "./TrackLane";
import { TimelineScrollbar } from "./TimelineScrollbar";
import { ValueBar } from "./ValueBar";
import { Meter } from "./Meter";
import { TimelineRuler } from "./TimelineRuler";
import { Playhead } from "./Playhead";
import { TransportBar } from "./TransportBar";
import { PianoKeyboard } from "./PianoKeyboard";
import { NoteInputWindow } from "./NoteInputWindow";
import { EffectWindow } from "./daw/EffectWindow";
import { trackActions } from "@/state/trackActions";
import { effectActions } from "@/state/effectActions";
import { clipActions, isMidiClip, rebuildMidiPart } from "@/state/clipActions";
import { DrumPads } from "./DrumPads";
import { LOOP_BAR_HEIGHT, LoopBar, LoopFields } from "./LoopBar";
import { DrumRackWindow } from "./DrumRackWindow";
import { ExpressionControls } from "./ExpressionControls";
import { PianoRollEditor } from "./PianoRollEditor";
import { ScaleSelector } from "./ScaleSelector";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { FxRack } from "./FxRack";
import { SynthWindow } from "./SynthWindow";
import type { SidechainSource } from "./SidechainPanel";
import { SIDECHAIN_TAP_LABELS } from "@/lib/sidechainModel";
import { AudioStatus } from "./AudioStatus";
import { EffectBrowser } from "./EffectBrowser";
import { AutomationLane as AutomationLaneEditor } from "./AutomationLane";
import { audioEngine, bumpEffectIdCounter } from "@/lib/audioEngine";
import { type DrumKitParams } from "@/lib/drumParams";
import { beatsToSeconds, defaultLoop, formatPosition, loopAround, loopsFrom, nudgeLoop, secondsToBeats, type ArrangementLoop } from "@/lib/arrangementLoop";
import { downloadMidiFile, parseMidiFile } from "@/lib/midiFile";
import { midiToNoteName } from "@/lib/piano";
import { listenToWebMidi } from "@/lib/webMidi";
import { MASTER_COLOR, trackColorOf } from "@/lib/colors";
import { canMoveTrack, hiddenByFoldedGroups, inputSources, MASTER_OUTPUT, outputTargets, routeMap } from "@/lib/routing";
import { getCopiedClip } from "@/lib/clipboard";
import { decodeAudioFile } from "@/lib/audioFile";
import { hydrateEngine, type ProjectState } from "@/lib/project";
import { projectSetter, projectStore, useHistoryState, useProjectValue } from "@/state/projectStore";
import { audioBlobs } from "@/state/audioBlobs";
import { bumpIdFrom, newAutomationLaneId, newBusId } from "@/state/ids";
import { loadProject, saveProject } from "@/lib/persistence";
import { ProjectMenu } from "./ProjectMenu";
import { AboutWindow, type AboutTab } from "./AboutWindow";
import { TelemetrySwitch } from "./TelemetrySwitch";
import { startTelemetry, track, trackAppOpened, trackOnce } from "@/lib/telemetry";
import {
  BUNDLE_EXTENSION,
  MAX_SAVED_HISTORY,
  createProjectFolder,
  decodeBundle,
  deserializeClips,
  encodeBundle,
  ensurePermission,
  isBrave,
  loadFromFolder,
  pickProjectFolder,
  readOpenProject,
  recentProjects,
  referencedClipIds,
  rememberRecent,
  safeName,
  saveToFolder,
  serializeClips,
  serializeSnapshot,
  supportsFolders,
  writeOpenProject,
  type ProjectDocument,
  type ProjectFolder,
  type RecentProject,
  type SavedHistory,
  type SerializedSnapshot,
} from "@/lib/projectFiles";
import { PROJECT_VERSION, type SerializedProject } from "@/lib/projectSchema";
import {
  clearRecoveryNotice,
  downloadLatestBackup,
  readRecoveryNotice,
  startFreshKeepingBackup,
} from "@/lib/projectRecovery";
import type { BounceParams } from "@/lib/bounce";
import { ExportDialog } from "./ExportDialog";
import { GrooveBrowser } from "./GrooveBrowser";
import { StartScreen } from "./StartScreen";
import { Tour, tourDone } from "./Tour";
import { HelpMenu } from "./HelpMenu";
import { fetchDemoSong } from "@/lib/demoSong";
import { PacksWindow } from "./PacksWindow";
import { AppUpdater } from "./AppUpdater";
import { installPack, removePack, restorePacks } from "@/lib/packStore";
import { PACK_EXTENSION } from "@/lib/dawnPack";
import { openFeedback, PostExportNote } from "./SupportViews";
import { shouldAskAfterExport, supportLinks } from "@/lib/support";
import { LATEST_VERSION } from "@/content/whatsNew";
import type { ProjectTemplate } from "@/lib/templates";
import { grooveById, grooveHits, grooveKit, type Groove } from "@/lib/grooves";
import { loadAudioPrefs } from "@/lib/audioPrefs";
import { EFFECT_LABELS, automatableParamSpecs, paramSpecs, type EffectInstance, type EffectType } from "@/lib/effects";
import { effectFileBlob, referencedEffectFiles, registerEffectFile } from "@/lib/effectFiles";
import type { ScaleSetting } from "@/lib/scales";
import {
  DEFAULT_PX_PER_SECOND,
  MAX_PX_PER_SECOND,
  MIN_PX_PER_SECOND,
  MIN_TIMELINE_SECONDS,
  RULER_HEIGHT,
  SNAP_RESOLUTIONS,
  SNAP_RESOLUTION_LABELS,
  TRACK_HEADER_WIDTH,
  rowHeightOf,
  quarterNotesPerBar,
  roundUpToBar,
  secondsPerBar,
  snapSecondsForResolution,
  snapUnitFor,
  type SnapResolution,
} from "@/lib/timeline";
import type { AutomationLane, AutomationPoint, AutomationTarget, ChannelConfig, ChannelType, ClipInstance, SynthParams, TimeSignature } from "@/lib/types";

type TransportState = "stopped" | "playing" | "paused" | "recording";

/** How many semitones a full pitch-bend deflection (wheel or hardware
 * controller at its extreme) shifts a note by - the usual default range on
 * most synths/keyboards. */
const PITCH_BEND_RANGE_SEMITONES = 2;

const AUTOMATION_LANE_HEIGHT = 56;

/** The value range and display format an automation target's curve should
 * be edited in - matches the same range each target's own live control
 * (the volume/pan ValueBars, or the effect's own param knob) uses. */
function automationRange(
  target: AutomationTarget,
  channelEffects: EffectInstance[]
): { min: number; max: number; format: (v: number) => string } {
  if (target.kind === "volume") {
    return { min: -60, max: 6, format: (v) => (v <= -60 ? "-∞" : `${v.toFixed(1)}dB`) };
  }
  if (target.kind === "pan") {
    return {
      min: -1,
      max: 1,
      format: (v) => (Math.abs(v) < 0.02 ? "C" : v < 0 ? `${Math.round(-v * 100)}L` : `${Math.round(v * 100)}R`),
    };
  }
  const fx = channelEffects.find((e) => e.id === target.effectId);
  const spec = fx && paramSpecs(fx.type).find((s) => s.key === target.paramKey);
  if (spec) return { min: spec.min, max: spec.max, format: spec.format };
  return { min: 0, max: 1, format: (v) => v.toFixed(2) };
}

/** An automation target's own live value right now - the channel's Vol/Pan
 * ValueBar, or the effect's own param - drawn as the lane's dashed
 * reference line. */
function automationCurrentValue(
  target: AutomationTarget,
  channel: ChannelConfig,
  channelEffects: EffectInstance[]
): number {
  if (target.kind === "volume") return channel.volume;
  if (target.kind === "pan") return channel.pan;
  const fx = channelEffects.find((e) => e.id === target.effectId);
  return fx?.params[target.paramKey] ?? 0;
}

/** All targets a channel's automation dropdown can offer: its own
 * volume/pan, plus one entry per param of each of its active effects. */
function automationTargetOptions(
  channelEffects: EffectInstance[]
): { target: AutomationTarget; label: string }[] {
  const options: { target: AutomationTarget; label: string }[] = [
    { target: { kind: "volume" }, label: "Volume" },
    { target: { kind: "pan" }, label: "Pan" },
  ];
  channelEffects.forEach((fx) => {
    automatableParamSpecs(fx).forEach((spec) => {
      options.push({
        target: { kind: "effect", effectId: fx.id, paramKey: spec.key },
        label: `${EFFECT_LABELS[fx.type]}: ${spec.label}`,
      });
    });
  });
  return options;
}

type ContextMenuState =
  | { kind: "clip"; channelId: string; clipId: string; x: number; y: number }
  | { kind: "lane"; channelId: string; x: number; y: number; atSeconds: number }
  | { kind: "header"; channelId: string; x: number; y: number };

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
}



/** A stable string key for an automation target, so two targets can be
 * compared for equality (e.g. "does this channel already have a lane for
 * Pan?") without a deep-equal check. */
function automationTargetKey(target: AutomationTarget): string {
  return target.kind === "effect" ? `effect:${target.effectId}:${target.paramKey}` : target.kind;
}

/** What an empty track lane suggests doing. */
function laneHint(channel: ChannelConfig, armed: boolean): string {
  if (channel.type === "group") return "A group: its tracks play through it. Ctrl/Cmd-click track headers and press Ctrl+G to group more";
  if (channel.type === "audio") {
    return armed
      ? "Press R to record here, or drop an audio file"
      : "Arm this track (the red button) and press R to record, or drop an audio file here";
  }
  if (!channel.instrument) return "Pick an instrument for this track in the rack below, or right-click to add a clip";
  if (channel.instrument === "drums") return "Drop a groove here from the Grooves tab, or right-click to add a clip";
  return armed
    ? "Press R and play your MIDI keyboard or computer keys, or right-click to add a clip"
    : "Arm this track to play and record it, or right-click to add a clip";
}

// The document's setters (stable: they write to the project store).
const setChannels = projectSetter("channels");
const setClipsByChannel = projectSetter("clipsByChannel");
const setBuses = projectSetter("buses");
const setBusEffects = projectSetter("busEffects");
const setBpm = projectSetter("bpm");
const setTimeSignature = projectSetter("timeSignature");
const setMasterName = projectSetter("masterName");
const setMasterVolume = projectSetter("masterVolume");
const setMasterPan = projectSetter("masterPan");

export function Daw() {
  // The document lives in the project store (src/state/projectStore.ts),
  // with its undo history.
  const channels = useProjectValue("channels");
  // Every track can hold any number of independent clips, each its own box
  // on the timeline - not a single clip slot per track.
  const clipsByChannel = useProjectValue("clipsByChannel");
  const channelEffects = useProjectValue("channelEffects");
  const buses = useProjectValue("buses");
  const busEffects = useProjectValue("busEffects");
  // Which track (or, exclusively, which bus) the persistent FX rack at the
  // bottom of the screen currently shows - defaults to the first channel so
  // the rack is never empty, matching Ableton's "always shows the selected
  // track's device chain" behavior.
  const [fxChannelId, setFxChannelId] = useState<string | null>(
    () => channels[0]?.id ?? null
  );
  const [fxBusId, setFxBusId] = useState<string | null>(null);
  /** Whether the FX rack at the bottom of the screen is currently showing
   * the master bus's own effects chain instead of a track's or a bus's. */
  const [fxMasterOpen, setFxMasterOpen] = useState(false);
  /** Whether the dedicated Synth Settings window is open, for whichever
   * channel the FX rack is currently showing. */
  const [synthWindowOpen, setSynthWindowOpen] = useState(false);
  const [drumWindowOpen, setDrumWindowOpen] = useState(false);
  const [aboutTab, setAboutTab] = useState<AboutTab | null>(null);
  /** The start screen: on the first visit, and from File > New. */
  const [startScreen, setStartScreen] = useState<null | "welcome" | "new">(null);
  const [tourOpen, setTourOpen] = useState(false);
  /** The start screen is the first visit's welcome: the tour follows it. */
  const welcomeRef = useRef(false);
  /** The first visit went straight to the demo song: the tour follows the
   * first stop or pause. */
  const tourAfterListenRef = useRef(false);
  const tourAfterListen = () => {
    if (!tourAfterListenRef.current) return;
    tourAfterListenRef.current = false;
    if (!tourDone()) setTourOpen(true);
  };
  const closeStartScreen = useCallback(() => {
    setStartScreen(null);
    if (!welcomeRef.current) return;
    welcomeRef.current = false;
    if (!tourDone()) setTourOpen(true);
  }, []);
  const [supportAsk, setSupportAsk] = useState(false);
  /** The Sound Packs window, with the outcome of a pack dropped on the app. */
  const [packs, setPacks] = useState<{ message: { ok: boolean; text: string } | null } | null>(null);
  const hasSupportLinks = supportLinks().length > 0;

  // Usage statistics (only when set up for this deployment and allowed).
  useEffect(() => {
    startTelemetry();
    trackAppOpened();
  }, []);
  /** The id of an effect instance (EQ Three, Compressor, ...) whose full
   * custom-UI window is open, or null - effects can appear on any track/
   * bus/master, so this is an id rather than a boolean. */
  const [expandedEffectId, setExpandedEffectId] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  /** Set when a file dropped onto a track couldn't be read as audio (e.g.
   * the wrong file type) - drag-and-drop has no OS-level file-type filter
   * the way the "Import audio" picker's `accept="audio/*"` does. */
  const [importError, setImportError] = useState<string | null>(null);
  useEffect(() => {
    if (micError) track("error_shown", { area: "input" });
  }, [micError]);
  useEffect(() => {
    if (importError) track("error_shown", { area: "import" });
  }, [importError]);
  /** The browser's available audio input devices, and which one
   * recordings currently use (null = the browser's default). Refreshed on
   * mount and whenever the OS reports a device was plugged/unplugged. */
  const [inputDevices, setInputDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState<string | null>(null);
  /** Audio tracks whose input is heard live (through their effects) - each
   * track's headphones button. Session-only: not part of the undo-tracked
   * document, and never reopened on load (that would prompt for the mic). */
  const [monitoredChannelIds, setMonitoredChannelIds] = useState<ReadonlySet<string>>(() => new Set());
  /** Which channel (if any) currently has its automation lane expanded
   * under its track in the arrangement - a view-only toggle, not part of
   * the undo-tracked document. */
  const [automationChannelId, setAutomationChannelId] = useState<string | null>(null);
  /** Whether the note-input panel (piano keyboard / drum pads) at the
   * bottom of the screen is collapsed - a view-only toggle. */
  /** The floating keyboard / drum pads window (remembered between visits). */
  const [noteInputOpen, setNoteInputOpen] = useState(() => {
    try {
      return localStorage.getItem("dawn.noteInputOpen") === "1";
    } catch {
      return false;
    }
  });
  const busRowRef = useRef<HTMLDivElement>(null);
  const toggleNoteInput = useCallback((open: boolean) => {
    setNoteInputOpen(open);
    try {
      localStorage.setItem("dawn.noteInputOpen", open ? "1" : "0");
    } catch {
      // Not remembered in a private window.
    }
  }, []);
  /** Which of that channel's targets (volume/pan/an effect param) the
   * expanded lane is currently showing/editing. */
  const [automationTarget, setAutomationTarget] = useState<AutomationTarget>({ kind: "volume" });
  // Ableton-style start marker: wherever you last clicked on the ruler.
  // Play always resumes from the transport's current position (unchanged);
  // Stop rewinds to this marker instead of always jumping back to 0.
  const [cursorSeconds, setCursorSeconds] = useState(0);
  const [selectedChannelId, setSelectedChannelId] = useState(
    () => channels[0].id
  );
  /** Which clips (if any) are currently selected on the timeline - by clip
   * id, since ids are unique across the whole project - distinct from the
   * armed/selected track. Plain click replaces the selection; Ctrl/Cmd+click
   * toggles a clip in or out of it. Delete/duplicate/drag-move all operate
   * on the whole selection at once. */
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const [editingClip, setEditingClip] = useState<{ channelId: string; clipId: string } | null>(
    null
  );
  const bpm = useProjectValue("bpm");
  const timeSignature = useProjectValue("timeSignature");
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [transportState, setTransportState] = useState<TransportState>(
    "stopped"
  );
  const [activeNotes, setActiveNotes] = useState<Set<string>>(new Set());
  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SECOND);
  const [scaleSetting, setScaleSetting] = useState<ScaleSetting>({
    root: "C",
    scale: "Major",
    enabled: false,
  });
  const masterName = useProjectValue("masterName");
  const [editingMasterName, setEditingMasterName] = useState(false);
  const [masterNameDraft, setMasterNameDraft] = useState("Master");
  const masterVolume = useProjectValue("masterVolume");
  const masterPan = useProjectValue("masterPan");
  const [masterLimiterThreshold, setMasterLimiterThreshold] = useState(-1);
  const masterEffects = useProjectValue("masterEffects");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // --- Snap-to-grid, loop region, count-in ---
  const [snapResolution, setSnapResolution] = useState<SnapResolution>("bar");
  // The arrangement loop, in beats (it stays on its bars when the tempo changes).
  const [loop, setLoop] = useState<ArrangementLoop>(() => defaultLoop());
  const loopEnabled = loop.on;
  const toggleLoop = useCallback(() => setLoop((l) => ({ ...l, on: !l.on })), []);
  /** The loop brace is selected: the arrow keys move and resize it. */
  const [loopSelected, setLoopSelected] = useState(false);
  // Where playback last started: like Ableton, starting past the loop plays on through.
  const [playFromSeconds, setPlayFromSeconds] = useState(0);
  const [countInBars, setCountInBars] = useState(0);


  // --- Save/load ---
  const projectLoadedRef = useRef(false);
  const [isLoadingProject, setIsLoadingProject] = useState(true);
  // Set when the last saved project couldn't be opened and the studio
  // started fresh (the old project is kept as a backup in this browser).
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(() => readRecoveryNotice());
  const [backupDownloadFailed, setBackupDownloadFailed] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // The open project: its name, the folder it's saved in (if any), and
  // whether it has changes that aren't saved there yet.
  const [projectName, setProjectName] = useState("Untitled");
  const projectFolderRef = useRef<ProjectFolder | null>(null);
  const [projectFolderName, setProjectFolderName] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectNotice, setProjectNotice] = useState<string | null>(null);
  const markCleanRef = useRef(true);
  /** The next autosave rewrites all stored audio (another project opened). */
  const fullAutosaveRef = useRef(false);
  const forceDirtyRef = useRef(false);
  const [exportOpen, setExportOpen] = useState(false);
  const samplesReady = useSyncExternalStore(
    useCallback((listener) => audioEngine.onReadyChange(listener), []),
    () => audioEngine.samplesReady,
    () => true
  );

  const beatsPerBar = quarterNotesPerBar(
    timeSignature.numerator,
    timeSignature.denominator
  );
  const snapSeconds = snapSecondsForResolution(snapResolution, bpm, beatsPerBar);

  // Exactly one channel can be record-armed at a time - it's what Record
  // captures and the only channel whose instrument sounds for incoming
  // notes, independent of which track is merely clicked/selected.
  const armedChannel = channels.find((c) => c.armed) ?? null;
  const armedChannelId = armedChannel?.id ?? null;
  // The armed MIDI track is played live, so it can skip delay compensation.
  useEffect(() => audioEngine.setArmedChannel(armedChannelId), [armedChannelId]);
  // Arming an audio track opens the input, so its meter shows the level
  // before recording. Not on the first render: a restored project
  // shouldn't ask for the microphone before anyone touches anything.
  // (Not when its input is another track: no interface involved.)
  const armedAudio = armedChannel?.type === "audio" && !armedChannel.input ? armedChannelId : null;
  const firstArmRender = useRef(true);
  useEffect(() => {
    if (firstArmRender.current) {
      firstArmRender.current = false;
      return;
    }
    if (!armedAudio) return;
    audioEngine
      .openInput()
      .then(() => setMicError(null))
      .catch(() =>
        setMicError("Couldn't open your audio input - allow microphone access in the browser, and pick your interface in the track's Input menu.")
      );
  }, [armedAudio]);

  const registeredChannelIds = useRef(new Set<string>());
  const registeredBusIds = useRef(new Set<string>());

  // --- Undo/redo (the project store keeps the steps) ---

  /** Records the document as it is now as an undo step - call at the very
   * top of a handler, before changing anything, or right as a drag gesture
   * starts, so the step is genuinely the "before". */
  const pushHistory = useCallback(() => projectStore.push(), []);

  /** After undo/redo replaced the document: the view lets go of what may
   * be gone, and the engine is rebuilt from it. */
  const afterRestore = useCallback((s: ProjectState) => {
    setSelectedClipIds(new Set());
    setEditingClip(null);
    hydrateEngine(s, registeredChannelIds.current);
  }, []);

  const undo = useCallback(() => {
    const restored = projectStore.undo();
    if (restored) afterRestore(restored);
  }, [afterRestore]);

  const redo = useCallback(() => {
    const restored = projectStore.redo();
    if (restored) afterRestore(restored);
  }, [afterRestore]);
  const { canUndo, canRedo } = useHistoryState();

  const clipsOf = useCallback(
    (channelId: string): ClipInstance[] => clipsByChannel[channelId] ?? [],
    [clipsByChannel]
  );
  const channelTypeOf = useCallback(
    (id: string): ChannelType => channels.find((c) => c.id === id)?.type ?? "midi",
    [channels]
  );
  /** Where a new clip added from a track-header-level action (import, or
   * the header's "add" menu item) should land - right after whatever's
   * already there, so it doesn't silently overlap an existing clip. */
  const endOfContent = useCallback(
    (channelId: string) =>
      clipsOf(channelId).reduce((max, c) => Math.max(max, c.offset + c.length), 0),
    [clipsOf]
  );


  const addMidiClip = clipActions.addMidi;

  const addAudioClip = clipActions.addAudio;

  /** Deletes the selected clips (Delete, or the clip menu - which selects
   * the right-clicked clip first, see openClipMenu). */
  const handleDeleteSelectedClips = useCallback(() => {
    clipActions.remove(selectedClipIds);
    setSelectedClipIds(new Set());
  }, [selectedClipIds]);

  /** Duplicates the selected clips and selects the copies. */
  const handleDuplicateSelectedClips = useCallback(() => {
    if (selectedClipIds.size > 0) setSelectedClipIds(clipActions.duplicate(selectedClipIds));
  }, [selectedClipIds]);

  /** Splits a clip at the playhead and selects both halves. */
  const handleSplitClipAtPlayhead = useCallback((channelId: string, clipId: string) => {
    const halves = clipActions.split(channelId, clipId, audioEngine.getTransportSeconds());
    if (halves) setSelectedClipIds(new Set(halves));
  }, []);

  const handleToggleLoopClip = clipActions.toggleLoop;

  /** Empties a whole track - every clip on it, gone. */
  const handleClearTrack = useCallback((channelId: string) => {
    const removed = clipActions.clearTrack(channelId);
    if (removed.length === 0) return;
    setSelectedClipIds((prev) => {
      const next = new Set(prev);
      removed.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const rulerViewportRef = useRef<HTMLDivElement>(null);
  const lanesScrollRef = useRef<HTMLDivElement>(null);

  const handleLanesScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (rulerViewportRef.current) {
      rulerViewportRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  }, []);

  // Suppress the browser's native right-click menu everywhere in the app -
  // only our own context menus (clip/lane/header, and any added later)
  // should ever appear.
  useEffect(() => {
    const suppressContextMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", suppressContextMenu);
    return () => window.removeEventListener("contextmenu", suppressContextMenu);
  }, []);

  // Dragging a file in from the OS anywhere the app itself doesn't handle
  // it (outside a track lane, or over a MIDI track) would otherwise make
  // the browser navigate to/open that file, losing the whole session - an
  // audio track's own lane calls preventDefault itself and stops
  // propagation for a drop it actually handles, so this is purely the
  // catch-all for everywhere else.
  const installPackRef = useRef<(file: File) => Promise<{ ok: boolean; message: string }>>(async () => ({ ok: false, message: "" }));
  useEffect(() => {
    const suppressFileDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      // A sound pack dropped anywhere installs, and the packs window says how it went.
      const file = e.type === "drop" ? e.dataTransfer.files[0] : undefined;
      if (file && file.name.toLowerCase().endsWith(PACK_EXTENSION)) {
        void installPackRef.current(file).then((r) => setPacks({ message: { ok: r.ok, text: r.message } }));
      }
    };
    window.addEventListener("dragover", suppressFileDrop);
    window.addEventListener("drop", suppressFileDrop);
    return () => {
      window.removeEventListener("dragover", suppressFileDrop);
      window.removeEventListener("drop", suppressFileDrop);
    };
  }, []);

  // Keep the audio engine's channels in sync with React state.
  useEffect(() => {
    const currentIds = new Set(channels.map((c) => c.id));
    channels.forEach((c) => {
      if (!registeredChannelIds.current.has(c.id)) {
        audioEngine.addChannel(c.id, c.type, c.instrument, c.synthParams, c.drumParams);
        audioEngine.setVolume(c.id, c.volume);
        audioEngine.setPan(c.id, c.pan);
        audioEngine.setMute(c.id, c.muted);
        audioEngine.setSolo(c.id, c.solo);
        Object.entries(c.sends ?? {}).forEach(([busId, db]) => audioEngine.setSend(c.id, busId, db));
        audioEngine.setAutomation(c.id, c.automationLanes ?? []);
        registeredChannelIds.current.add(c.id);
      }
    });
    registeredChannelIds.current.forEach((id) => {
      if (!currentIds.has(id)) {
        audioEngine.removeChannel(id);
        registeredChannelIds.current.delete(id);
      }
    });
  }, [channels]);

  // Tell the engine where each track's audio goes (groups, outputs), when
  // that changes.
  const routingKey = channels
    .map((c) => `${c.id}:${c.type}:${c.groupId ?? ""}:${c.output ?? ""}:${c.input ? `${c.input.track}/${c.input.tap}` : ""}`)
    .join("|");
  useEffect(() => {
    audioEngine.setRouting(channels.map((c) => ({ id: c.id, type: c.type, groupId: c.groupId, output: c.output, input: c.input })));
    // Only the routing fields matter (routingKey covers them).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routingKey]);

  // Keep the audio engine's buses in sync with React state too.
  useEffect(() => {
    const currentIds = new Set(buses.map((b) => b.id));
    buses.forEach((b) => {
      if (!registeredBusIds.current.has(b.id)) {
        audioEngine.addBus(b.id);
        registeredBusIds.current.add(b.id);
      }
    });
    registeredBusIds.current.forEach((id) => {
      if (!currentIds.has(id)) {
        audioEngine.removeBus(id);
        registeredBusIds.current.delete(id);
      }
    });
  }, [buses]);

  useEffect(() => {
    audioEngine.setBpm(bpm);
  }, [bpm]);

  useEffect(() => {
    audioEngine.setTimeSignature(beatsPerBar);
  }, [beatsPerBar]);

  useEffect(() => {
    audioEngine.setMetronome(metronomeEnabled);
  }, [metronomeEnabled]);

  useEffect(() => {
    audioEngine.setMasterVolume(masterVolume);
  }, [masterVolume]);

  useEffect(() => {
    audioEngine.setMasterPan(masterPan);
  }, [masterPan]);

  useEffect(() => {
    audioEngine.setMasterLimiterThreshold(masterLimiterThreshold);
  }, [masterLimiterThreshold]);

  useEffect(() => {
    // Recording runs straight through (a take is one pass).
    const looping =
      transportState !== "recording" && (transportState === "stopped" ? loop.on : loopsFrom(loop, secondsToBeats(playFromSeconds, bpm)));
    audioEngine.setLoop(looping, beatsToSeconds(loop.start, bpm), beatsToSeconds(loop.end, bpm));
  }, [loop, bpm, transportState, playFromSeconds]);

  // Ctrl/Cmd+L loops the selected clips (or switches the loop on and off
  // when none are selected); with the loop brace selected, the arrow keys
  // move it (up/down by its own length, left/right by the grid) and
  // Ctrl/Cmd+left/right shorten or lengthen it - Ableton's keys.
  useEffect(() => {
    if (editingClip) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        const ranges = Object.values(clipsByChannel)
          .flat()
          .filter((c) => selectedClipIds.has(c.id))
          .map((c) => ({ start: secondsToBeats(c.offset, bpm), end: secondsToBeats(c.offset + c.length, bpm) }));
        const around = loopAround(ranges);
        if (around) {
          setLoop({ on: true, ...around });
          setLoopSelected(true);
        } else toggleLoop();
        return;
      }
      if (!loopSelected || !e.key.startsWith("Arrow")) return;
      const unit = secondsToBeats(snapUnitFor(bpm, pxPerSecond, beatsPerBar), bpm);
      const next = nudgeLoop(loop, e.key, unit, mod);
      e.preventDefault();
      if (next) setLoop(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingClip, clipsByChannel, selectedClipIds, bpm, pxPerSecond, beatsPerBar, loop, loopSelected, toggleLoop]);

  // Notes (computer keyboard, the on-screen piano/pads, or a MIDI
  // controller) only reach the armed channel - merely clicking a track to
  // select it never makes it sound.
  const handleNoteOn = useCallback(
    async (note: string, velocity: number) => {
      if (!armedChannelId) return;
      await audioEngine.ensureStarted();
      audioEngine.noteOn(armedChannelId, note, velocity);
      trackOnce("sound_made", { via: "note" });
      setActiveNotes((prev) => {
        const next = new Set(prev);
        next.add(note);
        return next;
      });
    },
    [armedChannelId]
  );

  const handleNoteOff = useCallback(
    (note: string) => {
      if (!armedChannelId) return;
      audioEngine.noteOff(armedChannelId, note);
      setActiveNotes((prev) => {
        const next = new Set(prev);
        next.delete(note);
        return next;
      });
    },
    [armedChannelId]
  );

  // Sustain pedal (CC64), mod wheel (CC1), and pitch bend from a hardware
  // MIDI controller all target the armed channel, exactly like note input.
  useEffect(() => {
    return listenToWebMidi((event) => {
      if (event.type === "noteon") {
        void handleNoteOn(midiToNoteName(event.midi), event.velocity || 0.8);
      } else if (event.type === "noteoff") {
        handleNoteOff(midiToNoteName(event.midi));
      } else if (!armedChannelId) {
        return;
      } else if (event.type === "cc" && event.controller === 64) {
        audioEngine.setSustain(armedChannelId, event.value >= 0.5);
      } else if (event.type === "cc" && event.controller === 1) {
        audioEngine.setModWheel(armedChannelId, event.value);
      } else if (event.type === "pitchbend") {
        audioEngine.setPitchBend(armedChannelId, event.value * PITCH_BEND_RANGE_SEMITONES);
      }
    });
  }, [handleNoteOn, handleNoteOff, armedChannelId]);

  // Available audio input devices (mic, or an interface's separate inputs),
  // refreshed on mount, whenever the OS reports one was plugged in or
  // removed, and after anything that grants mic permission (browsers only
  // return full, labeled devices - sometimes only a single generic one at
  // all - once permission has been granted at least once, so the list
  // starts out sparse until then).
  const refreshInputDevices = useCallback(() => {
    audioEngine.listInputDevices().then(setInputDevices);
  }, []);

  useEffect(() => {
    refreshInputDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshInputDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshInputDevices);
    };
  }, [refreshInputDevices]);

  const handleInputDeviceChange = useCallback((deviceId: string | null) => {
    setSelectedInputDeviceId(deviceId);
    audioEngine.setMicDevice(deviceId);
  }, []);

  /** Primes mic permission (e.g. from a track's Input select gaining
   * focus) and refreshes the device list right after, so the full set of
   * labeled devices shows up without the user needing to already be
   * recording first. A no-op (beyond a fresh label refresh) once
   * permission was already granted. */
  const handleRequestInputDevices = useCallback(() => {
    audioEngine
      .requestMicAccess()
      .then(refreshInputDevices)
      .catch(() =>
        setMicError(
          "Couldn't access audio input devices - check the browser's permission prompt or site settings."
        )
      );
  }, [refreshInputDevices]);

  // Opens/closes the engine's live input for each monitored audio track.
  // Only tracks that exist (and are audio tracks) count, so deleting one -
  // or undoing its creation - stops its monitoring, and redo resumes it.
  const monitoredAudioIds = useMemo(
    () => [...monitoredChannelIds].filter((id) => channels.some((c) => c.id === id && c.type === "audio")),
    [monitoredChannelIds, channels]
  );
  const openMonitorsRef = useRef(new Set<string>());
  useEffect(() => {
    const open = openMonitorsRef.current;
    monitoredAudioIds.forEach((id) => {
      if (open.has(id)) return;
      open.add(id);
      void audioEngine.setInputMonitoring(id, true).then((ok) => {
        if (ok) {
          setMicError(null);
          trackOnce("sound_made", { via: "input" });
          return;
        }
        open.delete(id);
        setMonitoredChannelIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setMicError(
          "Couldn't open your audio input - allow microphone access in the browser, and pick your interface in the track's Input menu."
        );
      });
    });
    [...open].forEach((id) => {
      if (monitoredAudioIds.includes(id)) return;
      open.delete(id);
      void audioEngine.setInputMonitoring(id, false);
    });
  }, [monitoredAudioIds]);
  useEffect(() => {
    const open = openMonitorsRef.current;
    return () => open.forEach((id) => void audioEngine.setInputMonitoring(id, false));
  }, []);

  const handleMonitorToggle = useCallback((channelId: string) => {
    setMonitoredChannelIds((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  }, []);

  // Which channel a recording-in-progress targets - captured once at
  // Record time (not read live from `armedChannelId`) so re-arming a
  // different track mid-take (blocked by the UI, but not by anything else)
  // can never redirect where Stop files the result.
  const recordingChannelRef = useRef<string | null>(null);
  /** The same, as state, for drawing the take on its track. */
  const [recordingChannelId, setRecordingChannelId] = useState<string | null>(null);

  const handleStop = useCallback(async () => {
    tourAfterListen();
    if (transportState === "recording") {
      const recChannelId = recordingChannelRef.current;
      recordingChannelRef.current = null;
      if (recChannelId) {
        // The take starts where recording started (the marker).
        const takeFrom = audioEngine.recordingFrom ?? 0;
        if (channelTypeOf(recChannelId) === "audio") {
          const blob = await audioEngine.finishAudioRecording();
          if (blob && blob.size > 0) {
            const decoded = await decodeAudioFile(blob);
            const channelName = channels.find((c) => c.id === recChannelId)?.name ?? "take";
            addAudioClip(recChannelId, decoded, takeFrom, `${channelName} recording`, blob);
          }
        } else {
          const events = audioEngine.finishRecording();
          if (events.length > 0) {
            const lastEnd = events.reduce(
              (m, n) => Math.max(m, n.time + n.duration),
              0
            );
            addMidiClip(recChannelId, takeFrom, roundUpToBar(lastEnd, bpm, beatsPerBar), events);
          }
        }
      }
    }
    setTransportState("stopped");
    setRecordingChannelId(null);
    audioEngine.stopAll();
    audioEngine.seekTo(cursorSeconds);
    setActiveNotes(new Set());
  }, [transportState, bpm, beatsPerBar, channelTypeOf, channels, addAudioClip, addMidiClip, cursorSeconds]);

  // Play always starts from the marker (the last point you clicked on the
  // ruler) - pausing doesn't change where the next Play picks up from, it
  // always snaps back to that marker, the same spot Stop rewinds to.
  const handlePlay = useCallback(async () => {
    if (transportState === "recording") return;
    setPlayFromSeconds(cursorSeconds);
    audioEngine.seekTo(cursorSeconds);
    await audioEngine.startPlayback();
    setTransportState("playing");
    trackOnce("sound_made", { via: "playback" });
  }, [transportState, cursorSeconds]);

  const playRef = useRef(handlePlay);
  useEffect(() => {
    playRef.current = handlePlay;
  }, [handlePlay]);

  const handlePause = useCallback(() => {
    if (transportState !== "playing") return;
    tourAfterListen();
    audioEngine.pauseAll();
    setTransportState("paused");
    setActiveNotes(new Set());
  }, [transportState]);

  const handleTogglePlay = useCallback(() => {
    if (transportState === "playing") void handlePause();
    else if (transportState !== "recording") void handlePlay();
  }, [transportState, handlePlay, handlePause]);

  const handleRecord = useCallback(async () => {
    if (transportState === "recording") {
      void handleStop();
      return;
    }
    if (!armedChannelId) return;
    recordingChannelRef.current = armedChannelId;
    setRecordingChannelId(armedChannelId);
    if (channelTypeOf(armedChannelId) === "audio") {
      try {
        await audioEngine.startAudioRecording(armedChannelId, countInBars * beatsPerBar, cursorSeconds);
        setMicError(null);
        setTransportState("recording");
        track("recording_started", { kind: "audio" });
        refreshInputDevices();
      } catch {
        recordingChannelRef.current = null;
        setRecordingChannelId(null);
        setMicError(
          "Couldn't access the microphone - check the browser's permission prompt or site settings."
        );
      }
      return;
    }
    setTransportState("recording");
    track("recording_started", { kind: "midi" });
    await audioEngine.startRecording(armedChannelId, countInBars * beatsPerBar, cursorSeconds);
  }, [transportState, armedChannelId, handleStop, channelTypeOf, countInBars, beatsPerBar, refreshInputDevices, cursorSeconds]);

  const handleAddChannel = trackActions.add;

  const handleRemoveChannel = useCallback(
    (id: string) => {
      trackActions.remove(id);
      const fallback = channels.find((c) => c.id !== id);
      if (fxChannelId === id) setFxChannelId(fallback?.id ?? null);
      if (selectedChannelId === id && fallback) setSelectedChannelId(fallback.id);
      if (editingClip?.channelId === id) setEditingClip(null);
      const removedClipIds = new Set((clipsByChannel[id] ?? []).map((c) => c.id));
      setSelectedClipIds((prev) => {
        if (![...prev].some((cid) => removedClipIds.has(cid))) return prev;
        const next = new Set(prev);
        removedClipIds.forEach((cid) => next.delete(cid));
        return next;
      });
    },
    [selectedChannelId, channels, clipsByChannel, editingClip, fxChannelId]
  );

  const handleVolumeChange = trackActions.setVolume;

  const handlePanChange = trackActions.setPan;

  const handleMuteToggle = trackActions.toggleMute;

  const handleSoloToggle = trackActions.toggleSolo;

  /** Exclusive record-arm: arming a channel disarms every other one. Also
   * selects it, so the copy/paste-at-playhead target and header highlight
   * naturally follow whichever track you just armed. Refuses to change
   * anything mid-recording, since the engine is already mid-take on
   * whichever channel was armed when Record was pressed. */
  const handleArmToggle = useCallback(
    (id: string) => {
      if (transportState === "recording") return;
      if (!trackActions.toggleArm(id)) return;
      setSelectedChannelId(id);
      setSelectedClipIds(new Set());
    },
    [transportState]
  );

  const handleInstrumentChange = trackActions.setInstrument;

  const handleImportMidi = useCallback(
    async (channelId: string, file: File) => {
      const notes = await parseMidiFile(file, bpm);
      const lastEnd = notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0);
      addMidiClip(channelId, endOfContent(channelId), roundUpToBar(lastEnd, bpm, beatsPerBar), notes);
    },
    [bpm, beatsPerBar, endOfContent, addMidiClip]
  );

  const handleImportAudioAt = useCallback(
    async (channelId: string, file: File, atSeconds: number) => {
      const decoded = await decodeAudioFile(file);
      const bar = secondsPerBar(bpm, beatsPerBar);
      const anchor = Math.max(0, Math.round(atSeconds / bar) * bar);
      addAudioClip(channelId, decoded, anchor, file.name, file);
    },
    [bpm, beatsPerBar, addAudioClip]
  );

  /** Drag-and-drop entry point: unlike the "Import audio" file picker
   * (`accept="audio/*"`), the OS drag-and-drop API applies no file-type
   * filter at all, so this is far more likely to actually be handed
   * something `decodeAudioFile` can't read - caught here and surfaced in
   * the header status line instead of an unhandled rejection. */
  const handleDropAudioFile = useCallback(
    async (channelId: string, file: File, atSeconds: number) => {
      try {
        await handleImportAudioAt(channelId, file, atSeconds);
        setImportError(null);
      } catch {
        setImportError(`Couldn't import "${file.name}" — not a readable audio file.`);
      }
    },
    [handleImportAudioAt]
  );

  const handleImportAudioAppend = useCallback(
    async (channelId: string, file: File) => {
      await handleImportAudioAt(channelId, file, endOfContent(channelId));
    },
    [handleImportAudioAt, endOfContent]
  );

  /** Exports a track's whole content (every MIDI clip merged) as one .mid file. */
  const handleExportChannelMidi = useCallback(
    (channelId: string) => {
      const channel = channels.find((c) => c.id === channelId);
      const flattened = clipsOf(channelId)
        .filter(isMidiClip)
        .flatMap((c) => c.notes.map((n) => ({ ...n, time: c.offset + n.time })));
      downloadMidiFile(flattened, channel?.name ?? "track", bpm);
    },
    [channels, clipsOf, bpm]
  );

  /** Exports just one clip's notes as a .mid file. */
  const handleExportClipMidi = useCallback(
    (channelId: string, clipId: string) => {
      const channel = channels.find((c) => c.id === channelId);
      const clip = clipsOf(channelId).find((c) => c.id === clipId);
      const notes = clip?.kind === "midi" ? clip.notes : [];
      downloadMidiFile(notes, channel?.name ?? "clip", bpm);
    },
    [channels, clipsOf, bpm]
  );

  const handleEditorChange = clipActions.setNotes;


  /** Moving one of several selected clips moves them all. */
  const handleMoveClip = useCallback(
    (channelId: string, clipId: string, offset: number) => clipActions.move(channelId, clipId, offset, selectedClipIds),
    [selectedClipIds]
  );

  const handleResizeClip = clipActions.resize;

  const handleFadeChange = clipActions.setFades;

  const handleGainChange = clipActions.setGain;

  const handleSeek = useCallback((seconds: number) => {
    audioEngine.seekTo(seconds);
    setCursorSeconds(seconds);
  }, []);

  const handleRenameChannel = trackActions.rename;

  const handleReorderChannel = trackActions.move;

  const handleRecolorChannel = trackActions.recolor;

  const openFx = useCallback((channelId: string) => {
    setFxChannelId(channelId);
    setFxBusId(null);
    setFxMasterOpen(false);
  }, []);

  // --- Groups, routing and folding (routing.ts) ---

  /** Tracks picked with Ctrl/Cmd-click on their headers, for grouping. */
  const [trackPicks, setTrackPicks] = useState<Set<string>>(new Set());

  /** Groups the picked tracks (or the selected one) into a new group. */
  const handleGroupTracks = useCallback(
    (ids: string[]) => {
      const groupId = trackActions.group(ids);
      if (!groupId) return;
      setTrackPicks(new Set());
      setSelectedChannelId(groupId);
      openFx(groupId);
    },
    [openFx]
  );

  const handleSetTrackGroup = trackActions.setGroup;

  const handleSetInput = trackActions.setInput;

  const handleSetOutput = trackActions.setOutput;

  const handleToggleFold = trackActions.toggleFold;

  const allFolded = channels.length > 0 && channels.every((c) => c.folded);
  const handleFoldAll = trackActions.foldAll;

  /** Ctrl/Cmd-click on a header: picks or unpicks a track for grouping. */
  const handlePickTrack = useCallback((id: string) => {
    setTrackPicks((prev) => {
      const next = new Set(prev);
      // The selected track counts as picked when picking starts.
      if (next.size === 0 && selectedChannelId && selectedChannelId !== id) next.add(selectedChannelId);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [selectedChannelId]);

  // Ctrl/Cmd+G groups the picked tracks, or the selected one; Escape
  // forgets the picks.
  useEffect(() => {
    if (editingClip) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        handleGroupTracks(trackPicks.size > 0 ? [...trackPicks] : selectedChannelId ? [selectedChannelId] : []);
      } else if (e.key === "Escape" && trackPicks.size > 0) {
        setTrackPicks(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingClip, trackPicks, selectedChannelId, handleGroupTracks]);

  const copyClipInstance = clipActions.copy;

  const handleCopyClip = useCallback(
    (channelId: string, clipId: string) => {
      const clip = clipsOf(channelId).find((c) => c.id === clipId);
      if (clip) copyClipInstance(clip);
    },
    [clipsOf, copyClipInstance]
  );

  /** Ctrl/Cmd+C: copies whichever clip on the armed track sits under the
   * playhead right now, if any. */
  const handleCopyAtPlayhead = useCallback(() => {
    const t = audioEngine.getTransportSeconds();
    const clip = clipsOf(selectedChannelId).find((c) => t >= c.offset && t < c.offset + c.length);
    if (clip) copyClipInstance(clip);
  }, [clipsOf, selectedChannelId, copyClipInstance]);

  const pasteClipAt = clipActions.paste;

  const pasteReplaceClip = clipActions.pasteOver;

  const handlePasteClip = useCallback(() => {
    const bar = secondsPerBar(bpm, beatsPerBar);
    const anchor = Math.round(audioEngine.getTransportSeconds() / bar) * bar;
    pasteClipAt(selectedChannelId, anchor);
  }, [selectedChannelId, bpm, beatsPerBar, pasteClipAt]);

  const handlePasteClipAtBar = useCallback(
    (channelId: string, atSeconds: number) => {
      const bar = secondsPerBar(bpm, beatsPerBar);
      pasteClipAt(channelId, Math.round(atSeconds / bar) * bar);
    },
    [bpm, beatsPerBar, pasteClipAt]
  );

  /** Puts a groove from the browser on a MIDI track, snapped to the
   * nearest bar, and selects it. */
  const handleAddGroove = useCallback(
    (channelId: string, groove: Groove, atSeconds: number) => {
      const bar = secondsPerBar(bpm, beatsPerBar);
      const id = clipActions.addGroove(channelId, groove, Math.max(0, Math.round(atSeconds / bar) * bar));
      if (id) setSelectedClipIds(new Set([id]));
    },
    [bpm, beatsPerBar]
  );

  const handleAddEmptyClipAt = useCallback(
    (channelId: string, atSeconds: number) => {
      const bar = secondsPerBar(bpm, beatsPerBar);
      const anchor = Math.max(0, Math.round(atSeconds / bar) * bar);
      addMidiClip(channelId, anchor, bar, []);
    },
    [bpm, beatsPerBar, addMidiClip]
  );

  const handleToggleAutomation = useCallback((channelId: string) => {
    setAutomationChannelId((prev) => (prev === channelId ? null : channelId));
    setAutomationTarget({ kind: "volume" });
  }, []);

  const handleDrumKitChange = useCallback(
    (kit: DrumKitParams) => {
      if (fxChannelId) trackActions.setDrumKit(fxChannelId, kit);
    },
    [fxChannelId]
  );

  const handleSynthParamsChange = useCallback(
    (params: SynthParams) => {
      if (fxChannelId) trackActions.setSynthParams(fxChannelId, params);
    },
    [fxChannelId]
  );

  const handleSendChange = useCallback(
    (busId: string, db: number | null) => {
      if (fxChannelId) trackActions.setSend(fxChannelId, busId, db);
    },
    [fxChannelId]
  );

  // --- Send/return buses ---

  const handleAddBus = useCallback(() => {
    pushHistory();
    const id = newBusId();
    setBuses((prev) => [...prev, { id, name: `Bus ${prev.length + 1}`, colorIndex: prev.length }]);
  }, [pushHistory]);

  const handleRemoveBus = useCallback(
    (id: string) => {
      pushHistory();
      audioEngine.removeBus(id);
      setBuses((prev) => prev.filter((b) => b.id !== id));
      setBusEffects((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setChannels((prev) =>
        prev.map((c) => {
          if (!c.sends || !(id in c.sends)) return c;
          const sends = { ...c.sends };
          delete sends[id];
          return { ...c, sends };
        })
      );
      if (fxBusId === id) setFxBusId(null);
    },
    [pushHistory, fxBusId]
  );

  const handleRenameBus = useCallback(
    (id: string, name: string) => {
      pushHistory();
      setBuses((prev) => prev.map((b) => (b.id === id ? { ...b, name } : b)));
    },
    [pushHistory]
  );

  const openBusFx = useCallback((busId: string) => {
    setFxBusId(busId);
    setFxChannelId(null);
    setFxMasterOpen(false);
  }, []);

  const openMasterFx = useCallback(() => {
    setFxMasterOpen(true);
    setFxChannelId(null);
    setFxBusId(null);
  }, []);

  // --- Master bus effects chain ---

  /** Adds an effect (from the EffectBrowser sidebar, dragged or clicked) to
   * whichever target - a track, a bus, or the master bus - the FX rack
   * currently shows. */
  const handleSidebarAddEffect = useCallback(
    (type: EffectType, presetId?: string) => {
      const hostId = fxMasterOpen ? "master" : fxBusId ?? fxChannelId;
      if (hostId) effectActions.add(hostId, type, undefined, presetId);
    },
    [fxMasterOpen, fxBusId, fxChannelId]
  );

  // --- Automation lanes ---

  const setChannelAutomationLanes = useCallback(
    (channelId: string, updater: (lanes: AutomationLane[]) => AutomationLane[]) => {
      const current = channels.find((c) => c.id === channelId);
      if (!current) return;
      const lanes = updater(current.automationLanes ?? []);
      audioEngine.setAutomation(channelId, lanes);
      setChannels((prev) => prev.map((c) => (c.id === channelId ? { ...c, automationLanes: lanes } : c)));
    },
    [channels]
  );

  /** Gets (creating an empty one first if needed) the lane for a target. */
  const handleAutomationPointsChange = useCallback(
    (channelId: string, target: AutomationTarget, points: AutomationPoint[]) => {
      setChannelAutomationLanes(channelId, (lanes) => {
        const idx = lanes.findIndex((l) => automationTargetKey(l.target) === automationTargetKey(target));
        if (idx === -1) {
          return [...lanes, { id: newAutomationLaneId(), target, points }];
        }
        const next = [...lanes];
        next[idx] = { ...next[idx], points };
        return next;
      });
    },
    [setChannelAutomationLanes]
  );

  // Space to play/pause, Ctrl/Cmd+C/V to copy/paste whatever's under the
  // playhead on the armed track, Delete/Backspace to remove the selected
  // clip - all suspended while the piano roll editor is open (it handles
  // its own shortcuts) or while typing.
  useEffect(() => {
    if (editingClip) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        handleTogglePlay();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        e.preventDefault();
        handleCopyAtPlayhead();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        handlePasteClip();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedClipIds.size > 0) {
        e.preventDefault();
        handleDeleteSelectedClips();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && selectedClipIds.size > 0) {
        e.preventDefault();
        handleDuplicateSelectedClips();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    editingClip,
    handleTogglePlay,
    handleCopyAtPlayhead,
    handlePasteClip,
    selectedClipIds,
    handleDeleteSelectedClips,
    handleDuplicateSelectedClips,
    undo,
    redo,
  ]);

  /** Opening the piano roll editor is the undo checkpoint for everything
   * done inside it - note-by-note edits aren't pushed individually, so
   * exiting the editor undoes as one step (its own shortcuts are suspended
   * while it's open, so Ctrl+Z can't reach mid-session anyway). */
  const handleEditClip = useCallback(
    (channelId: string, clipId: string) => {
      if (channelTypeOf(channelId) === "audio") return; // no piano roll for an audio clip
      pushHistory();
      setEditingClip({ channelId, clipId });
    },
    [channelTypeOf, pushHistory]
  );

  const [audioImportTarget, setAudioImportTarget] = useState<
    { channelId: string; atSeconds: number } | null
  >(null);
  const audioImportInputRef = useRef<HTMLInputElement>(null);

  // Clicking the hidden file input is a side effect of `audioImportTarget`
  // changing, kept out of render (and thus out of any menu-building
  // useMemo) by running it here instead of inline in an onSelect handler.
  useEffect(() => {
    if (audioImportTarget) audioImportInputRef.current?.click();
  }, [audioImportTarget]);

  const triggerAudioImport = useCallback((channelId: string, atSeconds: number) => {
    setAudioImportTarget({ channelId, atSeconds });
  }, []);

  /** Right-clicking a clip that's already part of the current multi-
   * selection keeps the whole selection (so the menu's actions apply to
   * the group); right-clicking outside it replaces the selection with
   * just this clip, matching how most apps handle right-click on a list. */
  const openClipMenu = useCallback(
    (channelId: string, clipId: string, e: React.MouseEvent) => {
      setSelectedClipIds((prev) => (prev.has(clipId) ? prev : new Set([clipId])));
      setSelectedChannelId(channelId);
      setContextMenu({ kind: "clip", channelId, clipId, x: e.clientX, y: e.clientY });
    },
    []
  );

  const openLaneMenu = useCallback(
    (channelId: string, e: React.MouseEvent, atSeconds: number) => {
      setContextMenu({ kind: "lane", channelId, x: e.clientX, y: e.clientY, atSeconds });
    },
    []
  );

  const openHeaderMenu = useCallback((channelId: string, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ kind: "header", channelId, x: e.clientX, y: e.clientY });
  }, []);

  const clipMenuItems = useMemo((): (ContextMenuItem | "separator")[] => {
    if (!contextMenu || contextMenu.kind !== "clip") return [];
    const { channelId, clipId } = contextMenu;
    const clip = clipsOf(channelId).find((c) => c.id === clipId);
    if (!clip) return [];
    const hasNotes = clip.kind === "midi" && clip.notes.length > 0;
    const copied = getCopiedClip();
    const pasteDisabled = !copied || copied.kind !== channelTypeOf(channelId);
    const t = audioEngine.getTransportSeconds();
    const canSplit = t > clip.offset && t < clip.offset + clip.length;
    const groupSize = selectedClipIds.size;
    const deleteLabel = groupSize > 1 ? `Delete ${groupSize} clips` : "Delete clip";
    const duplicateLabel = groupSize > 1 ? `Duplicate ${groupSize} clips` : "Duplicate clip";

    const commonTail: (ContextMenuItem | "separator")[] = [
      {
        label: "Split at playhead",
        icon: <Scissors size={13} />,
        disabled: !canSplit,
        onSelect: () => handleSplitClipAtPlayhead(channelId, clipId),
      },
      {
        label: duplicateLabel,
        icon: <CopyPlus size={13} />,
        onSelect: () => handleDuplicateSelectedClips(),
      },
      {
        label: clip.loopLength ? "Stop looping clip" : "Loop clip",
        icon: <Repeat size={13} />,
        onSelect: () => handleToggleLoopClip(channelId, clipId),
      },
      "separator",
      {
        label: deleteLabel,
        icon: <Trash2 size={13} />,
        danger: true,
        onSelect: () => handleDeleteSelectedClips(),
      },
    ];

    if (clip.kind === "audio") {
      return [
        { label: "Copy clip", icon: <Copy size={13} />, onSelect: () => handleCopyClip(channelId, clipId) },
        {
          label: "Paste clip here",
          icon: <Clipboard size={13} />,
          disabled: pasteDisabled,
          onSelect: () => pasteReplaceClip(channelId, clipId),
        },
        "separator",
        ...commonTail,
      ];
    }
    return [
      { label: "Edit in piano roll", icon: <Pencil size={13} />, onSelect: () => handleEditClip(channelId, clipId) },
      "separator",
      { label: "Copy clip", icon: <Copy size={13} />, onSelect: () => handleCopyClip(channelId, clipId) },
      {
        label: "Paste clip here",
        icon: <Clipboard size={13} />,
        disabled: pasteDisabled,
        onSelect: () => pasteReplaceClip(channelId, clipId),
      },
      "separator",
      { label: "Export .mid", icon: <Download size={13} />, disabled: !hasNotes, onSelect: () => handleExportClipMidi(channelId, clipId) },
      ...commonTail,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenu, clipsOf, channelTypeOf, selectedClipIds]);

  const laneMenuItems = useMemo((): (ContextMenuItem | "separator")[] => {
    if (!contextMenu || contextMenu.kind !== "lane") return [];
    const { channelId, atSeconds } = contextMenu;
    const copied = getCopiedClip();
    const pasteDisabled = !copied || copied.kind !== channelTypeOf(channelId);
    // A group's lane holds no clips.
    if (channelTypeOf(channelId) === "group") return [];
    const items: (ContextMenuItem | "separator")[] =
      channelTypeOf(channelId) === "midi"
        ? [
            {
              label: "Add empty MIDI clip here",
              icon: <FilePlus2 size={13} />,
              onSelect: () => handleAddEmptyClipAt(channelId, atSeconds),
            },
          ]
        : [
            {
              label: "Import audio clip here…",
              icon: <FileAudio size={13} />,
              onSelect: () => triggerAudioImport(channelId, atSeconds),
            },
          ];
    items.push({
      label: "Paste clip here",
      icon: <Clipboard size={13} />,
      disabled: pasteDisabled,
      onSelect: () => handlePasteClipAtBar(channelId, atSeconds),
    });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenu, channelTypeOf]);

  const headerMenuItems = useMemo((): (ContextMenuItem | "separator")[] => {
    if (!contextMenu || contextMenu.kind !== "header") return [];
    const id = contextMenu.channelId;
    const channel = channels.find((c) => c.id === id);
    if (!channel) return [];
    const isGroup = channel.type === "group";
    const clipItems: ContextMenuItem[] = isGroup
      ? []
      : channel.type === "midi"
        ? [
            {
              label: "Add empty MIDI clip",
              icon: <FilePlus2 size={13} />,
              onSelect: () => handleAddEmptyClipAt(id, endOfContent(id)),
            },
          ]
        : [
            {
              label: "Import audio clip…",
              icon: <FileAudio size={13} />,
              onSelect: () => triggerAudioImport(id, endOfContent(id)),
            },
          ];
    // Grouping: the Ctrl/Cmd-clicked tracks (with this one), or this one.
    const picked = trackPicks.has(id) ? [...trackPicks] : [id];
    const groups = channels.filter((c) => c.type === "group" && c.id !== channel.groupId);
    const groupItems: ContextMenuItem[] = isGroup
      ? [{ label: "Ungroup (keep the tracks)", icon: <FolderOutput size={13} />, onSelect: () => handleRemoveChannel(id) }]
      : [
          {
            label: picked.length > 1 ? `Group ${picked.length} tracks (Ctrl+G)` : "Group this track (Ctrl+G)",
            icon: <FolderPlus size={13} />,
            onSelect: () => handleGroupTracks(picked),
          },
          ...groups.map((g) => ({ label: `Move into “${g.name}”`, icon: <FolderInput size={13} />, onSelect: () => handleSetTrackGroup(id, g.id) })),
          ...(channel.groupId ? [{ label: "Take out of the group", icon: <FolderOutput size={13} />, onSelect: () => handleSetTrackGroup(id, null) }] : []),
        ];
    const foldItem: ContextMenuItem = {
      label: channel.folded ? (isGroup ? "Unfold the group" : "Unfold track") : isGroup ? "Fold the group (hide its tracks)" : "Fold track",
      icon: <ChevronsDownUp size={13} />,
      onSelect: () => handleToggleFold(id),
    };
    const removeItems: (ContextMenuItem | "separator")[] =
      channels.length > 1 && !isGroup
        ? [
            "separator",
            {
              label: "Remove track",
              icon: <X size={13} />,
              danger: true,
              onSelect: () => handleRemoveChannel(id),
            },
          ]
        : [];
    const items: (ContextMenuItem | "separator")[] = [...clipItems, ...(clipItems.length ? ["separator" as const] : []), ...groupItems, foldItem, ...removeItems];
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenu, channels, trackPicks, channelTypeOf, endOfContent]);

  const handlePreviewNote = useCallback(
    (channelId: string, note: string) => {
      audioEngine.ensureStarted().then(() => {
        audioEngine.noteOn(channelId, note, 0.85);
        setTimeout(() => audioEngine.noteOff(channelId, note), 150);
      });
    },
    []
  );

  const totalSeconds = useMemo(() => {
    const longest = channels.reduce((max, c) => Math.max(max, endOfContent(c.id)), 0);
    return Math.max(MIN_TIMELINE_SECONDS, Math.ceil(longest + 8));
  }, [channels, endOfContent]);

  // MIDI clip notes (and their clip boxes) are stored as absolute seconds
  // at whatever tempo was in effect when they were written - nothing else
  // in the engine treats them as beat-relative. Left alone, changing the
  // project tempo would silently change every existing MIDI clip's
  // playback speed relative to the new tempo and knock it off the beat
  // grid instead of following the tempo change like a DAW clip should.
  // Rescale every MIDI clip's timing by the ratio between the old and new
  // tempo so each note stays on the same beat, then rebuild the engine's
  // scheduled parts to match. Audio clips are left untouched - there's no
  // time-stretching here, so (as in most DAWs for unwarped audio) they
  // keep their absolute position rather than being resampled.
  const handleBpmCommit = useCallback(
    (value: number) => {
      if (value === bpm) return;
      pushHistory();
      // Tone.js converts a scheduled note's time to ticks at the moment
      // it's scheduled, using whatever tempo is active right then - the
      // separate effect that calls audioEngine.setBpm(bpm) only runs on
      // the NEXT render, which is too late: rebuilding the (rescaled)
      // parts below before the engine's tempo actually changes would
      // schedule them against the OLD tempo, then have their real
      // playback position silently shift again once the new tempo lands.
      // Setting it here first, synchronously, avoids that double-shift.
      audioEngine.setBpm(value);
      const ratio = bpm / value;
      const rescaled: Record<string, ClipInstance[]> = {};
      Object.entries(clipsByChannel).forEach(([chId, clips]) => {
        rescaled[chId] = clips.map((c) =>
          c.kind === "midi"
            ? {
                ...c,
                offset: c.offset * ratio,
                length: c.length * ratio,
                loopLength: c.loopLength ? c.loopLength * ratio : c.loopLength,
                notes: c.notes.map((n) => ({
                  ...n,
                  time: n.time * ratio,
                  duration: n.duration * ratio,
                })),
              }
            : c
        );
      });
      setClipsByChannel(rescaled);
      channels.forEach((c) => {
        if (c.type === "midi") rebuildMidiPart(c.id, (rescaled[c.id] ?? []).filter(isMidiClip));
      });
      setBpm(value);
    },
    [bpm, clipsByChannel, channels, pushHistory]
  );

  const handleTimeSignatureCommit = useCallback(
    (value: TimeSignature) => {
      pushHistory();
      setTimeSignature(value);
    },
    [pushHistory]
  );

  /** The project as it is right now, for an offline render (export). */
  const buildBounceParams = useCallback(
    (): BounceParams => ({
      channels,
      clipsByChannel,
      channelEffects,
      buses,
      busEffects,
      masterVolume,
      masterPan,
      masterLimiterThreshold,
      masterEffects,
      contentEndSeconds: channels.reduce((max, c) => Math.max(max, endOfContent(c.id)), 0),
      delayCompensation: loadAudioPrefs().delayCompensation,
      monitored: [...monitoredChannelIds],
    }),
    [channels, endOfContent, clipsByChannel, channelEffects, buses, busEffects, masterVolume, masterPan, masterLimiterThreshold, masterEffects, monitoredChannelIds]
  );

  // --- Save/load: the whole project autosaves to IndexedDB a moment after
  // any change (a working copy that survives a reload or a crash), and is
  // saved to a folder on the computer (or one project file) with Save. ---

  /** The project as saved (clips without their session-only URLs). */
  const buildProject = useCallback(
    (): SerializedProject => ({
      version: PROJECT_VERSION,
      savedAt: Date.now(),
      channels,
      clipsByChannel: serializeClips(clipsByChannel),
      channelEffects,
      buses,
      busEffects,
      bpm,
      timeSignature,
      masterVolume,
      masterPan,
      masterName,
      masterLimiterThreshold,
      masterEffects,
      scaleSetting,
      snapResolution,
      countInBars,
      metronomeEnabled,
      loop,
    }),
    [
      channels,
      clipsByChannel,
      channelEffects,
      buses,
      busEffects,
      bpm,
      timeSignature,
      masterVolume,
      masterPan,
      masterName,
      masterLimiterThreshold,
      masterEffects,
      scaleSetting,
      snapResolution,
      countInBars,
      metronomeEnabled,
      loop,
    ]
  );

  const persistNow = useCallback(async () => {
    setSaveStatus("saving");
    try {
      // Audio clips plus every uploaded effect file (IRs) still in use.
      const blobsToSave = audioBlobs.snapshot();
      referencedEffectFiles([...Object.values(channelEffects), ...Object.values(busEffects), masterEffects], channels).forEach(
        (ref) => {
          const blob = effectFileBlob(ref.id);
          if (blob) blobsToSave.set(ref.id, blob);
        }
      );
      const replaceAll = fullAutosaveRef.current;
      await saveProject(buildProject(), blobsToSave, replaceAll);
      if (replaceAll) fullAutosaveRef.current = false;
      await writeOpenProject({ name: projectName, folder: projectFolderRef.current, dirty });
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }, [buildProject, channels, channelEffects, busEffects, masterEffects, projectName, dirty]);

  /** Makes a project (from the working copy, a folder, a project file, or a
   * new one) the open one: its state, the audio engine, and its undo
   * history. The previous project's audio is let go of. */
  const applyDocument = useCallback((project: SerializedProject, blobs: Map<string, Blob>, history: SavedHistory | null) => {
    const oldUrls = new Set<string>();
    const collectUrls = (st: ProjectState) =>
      Object.values(st.clipsByChannel).forEach((l) => l.forEach((c) => c.kind === "audio" && c.url && oldUrls.add(c.url)));
    const steps = projectStore.allSteps();
    [steps.doc, ...steps.past, ...steps.future].forEach(collectUrls);
    oldUrls.forEach((u) => URL.revokeObjectURL(u));
    audioBlobs.clear();

    // One playable URL per recording/imported file, shared by the song and
    // its history.
    const urls = new Map<string, string>();
    const urlFor = (id: string) => {
      let url = urls.get(id);
      if (url) return url;
      const blob = blobs.get(id);
      if (!blob) return "";
      url = URL.createObjectURL(blob);
      urls.set(id, url);
      audioBlobs.set(id, blob);
      return url;
    };
    const snapshots: SerializedSnapshot[] = [project, ...(history?.past ?? []), ...(history?.future ?? [])];
    // New ids must never collide with restored ones.
    let maxEffectN = 0;
    snapshots.forEach((snap) => {
      Object.values(snap.clipsByChannel).forEach((l) => l.forEach((c) => bumpIdFrom(c.id)));
      snap.channels.forEach((c) => {
        bumpIdFrom(c.id);
        (c.automationLanes ?? []).forEach((lane) => bumpIdFrom(lane.id));
      });
      snap.buses.forEach((b) => bumpIdFrom(b.id));
      [...Object.values(snap.channelEffects).flat(), ...Object.values(snap.busEffects).flat(), ...snap.masterEffects].forEach((fx) => {
        const match = fx.id.match(/^fx-(\d+)$/);
        if (match) maxEffectN = Math.max(maxEffectN, parseInt(match[1], 10));
      });
      referencedEffectFiles([...Object.values(snap.channelEffects), ...Object.values(snap.busEffects), snap.masterEffects], snap.channels).forEach((ref) => {
        const blob = blobs.get(ref.id);
        if (blob) registerEffectFile(ref.id, blob);
      });
    });
    bumpEffectIdCounter(maxEffectN);

    const toState = (snap: SerializedSnapshot): ProjectState => ({ ...snap, clipsByChannel: deserializeClips(snap.clipsByChannel, urlFor) });
    const state = toState(project);
    projectStore.load(
      {
        channels: state.channels,
        clipsByChannel: state.clipsByChannel,
        channelEffects: state.channelEffects,
        buses: state.buses,
        busEffects: state.busEffects,
        bpm: state.bpm,
        timeSignature: state.timeSignature,
        masterVolume: state.masterVolume,
        masterPan: state.masterPan,
        masterName: state.masterName,
        masterEffects: state.masterEffects,
      },
      (history?.past ?? []).map(toState),
      (history?.future ?? []).map(toState)
    );
    setMasterLimiterThreshold(project.masterLimiterThreshold);
    setScaleSetting(project.scaleSetting);
    setSnapResolution(project.snapResolution);
    setCountInBars(project.countInBars);
    setMetronomeEnabled(project.metronomeEnabled);
    setLoop(project.loop);
    setSelectedClipIds(new Set());
    setEditingClip(null);
    setExpandedEffectId(null);
    setFxBusId(null);
    setFxMasterOpen(false);
    setFxChannelId(state.channels[0]?.id ?? null);
    if (state.channels[0]) setSelectedChannelId(state.channels[0].id);
    hydrateEngine(state, registeredChannelIds.current);
    markCleanRef.current = true;
  }, []);

  // Restore the working copy on mount, before autosave is allowed to run (so
  // a fresh page load never overwrites a real saved project with the
  // starter 3-channel default before the load has even been tried).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [result, info] = await Promise.all([
        loadProject().catch(() => null),
        readOpenProject().catch(() => null),
        restorePacks().catch(() => undefined),
      ]);
      if (cancelled) return;
      if (result) {
        try {
          // normalizeProject returns null for data that isn't a project at
          // all; anything else has already been repaired into a valid shape.
          if (!result.project) throw new Error("the saved data isn't a project");
          applyDocument(result.project, result.blobs, null);
        } catch (err) {
          // Never leave the studio stuck on a project it can't open: keep a
          // backup of it, start fresh, and say what happened.
          await startFreshKeepingBackup(
            `Couldn't open the saved project (${err instanceof Error ? err.message : String(err)}).`
          );
          return;
        }
      }
      if (info) {
        setProjectName(info.name || "Untitled");
        projectFolderRef.current = info.folder;
        setProjectFolderName(info.folder?.name ?? null);
        // Unsaved changes stay unsaved across a reload.
        if (info.dirty) forceDirtyRef.current = true;
      }
      projectLoadedRef.current = true;
      setIsLoadingProject(false);
      // Nothing saved in this browser yet: a first visit. Someone coming
      // back after an update sees what's new, once.
      if (!result) {
        welcomeRef.current = true;
        setStartScreen("welcome");
      }
      try {
        const seen = localStorage.getItem("dawn.lastSeenVersion");
        if (result && seen !== LATEST_VERSION) setAboutTab("news");
        localStorage.setItem("dawn.lastSeenVersion", LATEST_VERSION);
      } catch {
        // No storage: skip the release notes.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Unsaved changes. `buildProject` is a new function exactly when the
  // song changes, so "saved" is simply which one was last written. ---
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

  /** Marks the song as it was when `doc` was taken as saved. */
  const markSaved = useCallback((doc: unknown) => {
    savedDocRef.current = doc;
    setDirty(currentDocRef.current !== doc);
  }, []);

  const flashProjectNotice = useCallback((text: string) => {
    setProjectNotice(text);
    window.setTimeout(() => setProjectNotice((cur) => (cur === text ? null : cur)), 5000);
  }, []);

  /** Everything Save writes: the song, the last undo/redo steps, and the
   * audio and effect files either of them uses. */
  const buildDocument = useCallback((): ProjectDocument => {
    const project = buildProject();
    const history: SavedHistory = {
      past: projectStore.allSteps().past.slice(-MAX_SAVED_HISTORY).map(serializeSnapshot),
      future: projectStore.allSteps().future.slice(-MAX_SAVED_HISTORY).map(serializeSnapshot),
    };
    const clipIds = referencedClipIds({ project, history });
    const blobs = new Map<string, Blob>();
    audioBlobs.forEach((blob, id) => clipIds.has(id) && blobs.set(id, blob));
    const steps: SerializedSnapshot[] = [project, ...history.past, ...history.future];
    referencedEffectFiles(
      steps.flatMap((st) => [...Object.values(st.channelEffects), ...Object.values(st.busEffects), st.masterEffects]),
      steps.flatMap((st) => st.channels)
    ).forEach((ref) => {
      const blob = effectFileBlob(ref.id);
      if (blob) blobs.set(ref.id, blob);
    });
    return { name: projectName, project, history, blobs };
  }, [buildProject, projectName]);

  const saveInto = useCallback(
    async (folder: ProjectFolder, name: string) => {
      setProjectBusy(true);
      const doc = currentDocRef.current;
      try {
        if (!(await ensurePermission(folder))) throw new Error("permission to write to the folder was refused");
        await saveToFolder(folder, { ...buildDocument(), name });
        projectFolderRef.current = folder;
        setProjectFolderName(folder.name);
        setProjectName(name);
        markSaved(doc);
        await rememberRecent(name, folder);
        flashProjectNotice(`Saved to the folder "${folder.name}"`);
        track("project_saved", { target: "folder" });
      } catch (err) {
        flashProjectNotice(`Couldn't save: ${err instanceof Error ? err.message : String(err)}`);
        track("error_shown", { area: "save" });
      } finally {
        setProjectBusy(false);
      }
    },
    [buildDocument, markSaved, flashProjectNotice]
  );

  const downloadProjectFile = useCallback(
    async (name: string) => {
      const blob = await encodeBundle({ ...buildDocument(), name });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName(name)}${BUNDLE_EXTENSION}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      track("project_saved", { target: "file" });
    },
    [buildDocument]
  );

  const handleSaveAs = useCallback(
    async (name: string) => {
      if (!supportsFolders()) {
        const doc = currentDocRef.current;
        await downloadProjectFile(name);
        setProjectName(name);
        markSaved(doc);
        return;
      }
      const folder = await createProjectFolder(name).catch(() => null);
      if (folder) await saveInto(folder, name);
    },
    [downloadProjectFile, saveInto, markSaved]
  );

  const [saveAsRequest, setSaveAsRequest] = useState(0);
  const handleSave = useCallback(async () => {
    if (projectFolderRef.current) await saveInto(projectFolderRef.current, projectName);
    else setSaveAsRequest((n) => n + 1);
  }, [saveInto, projectName]);

  const confirmDiscard = useCallback(
    () => !dirty || window.confirm(`"${projectName}" has unsaved changes. Discard them?`),
    [dirty, projectName]
  );

  const openDocument = useCallback(
    (doc: ProjectDocument, folder: ProjectFolder | null) => {
      audioEngine.stopAll();
      setTransportState("stopped");
      applyDocument(doc.project, doc.blobs, doc.history);
      fullAutosaveRef.current = true;
      setProjectName(doc.name);
      projectFolderRef.current = folder;
      setProjectFolderName(folder?.name ?? null);
      flashProjectNotice(`Opened "${doc.name}"`);
    },
    [applyDocument, flashProjectNotice]
  );

  const handleInstallPack = useCallback(async (file: File): Promise<{ ok: boolean; message: string }> => {
    if (file.size > 400 * 1024 * 1024) return { ok: false, message: `"${file.name}" is too large to be a Dawn pack.` };
    const result = await installPack(new Uint8Array(await file.arrayBuffer()), audioEngine.sampleRate);
    if (!result.ok) {
      track("error_shown", { area: "pack" });
      return { ok: false, message: result.error };
    }
    track("pack_imported", { kind: result.replaced ? "update" : "new" });
    const p = result.pack;
    const skipped = result.skipped.length ? ` ${result.skipped.length} file${result.skipped.length === 1 ? " was" : "s were"} damaged and left out.` : "";
    return { ok: true, message: `${result.replaced ? "Updated" : "Installed"} "${p.name}" ${p.version} by ${p.author}.${skipped}` };
  }, []);
  useEffect(() => {
    installPackRef.current = handleInstallPack;
  }, [handleInstallPack]);

  /** File > New: the start screen, once unsaved changes are dealt with. */
  const handleNewProject = useCallback(() => {
    if (confirmDiscard()) setStartScreen("new");
  }, [confirmDiscard]);

  /** Starts a new project from a template (the start screen's cards). */
  const handleTemplate = useCallback(
    (template: ProjectTemplate) => {
      audioEngine.stopAll();
      setTransportState("stopped");
      applyDocument(template.build(), new Map(), null);
      fullAutosaveRef.current = true;
      setProjectName(template.id === "empty" ? "Untitled" : template.name);
      projectFolderRef.current = null;
      setProjectFolderName(null);
      setCursorSeconds(0);
      closeStartScreen();
      track("template_chosen", { template: template.id });
    },
    [applyDocument, closeStartScreen]
  );

  const openFolder = useCallback(
    async (folder: ProjectFolder) => {
      setProjectBusy(true);
      try {
        if (!(await ensurePermission(folder))) throw new Error("permission to read the folder was refused");
        const doc = await loadFromFolder(folder);
        openDocument(doc, folder);
        await rememberRecent(doc.name, folder);
      } catch (err) {
        flashProjectNotice(`Couldn't open it: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setProjectBusy(false);
      }
    },
    [openDocument, flashProjectNotice]
  );

  const handleOpenProject = useCallback(async () => {
    if (!confirmDiscard()) return;
    try {
      const folder = await pickProjectFolder();
      if (folder) await openFolder(folder);
    } catch (err) {
      flashProjectNotice(err instanceof Error ? err.message : String(err));
    }
  }, [confirmDiscard, openFolder, flashProjectNotice]);

  const handleOpenRecent = useCallback(
    async (r: RecentProject) => {
      if (!confirmDiscard()) return;
      await openFolder(r.folder);
    },
    [confirmDiscard, openFolder]
  );

  const handleImportProjectFile = useCallback(
    async (file: File) => {
      if (!confirmDiscard()) return;
      try {
        openDocument(await decodeBundle(file), null);
        // An imported file isn't anywhere on disk until it's saved.
        forceDirtyRef.current = true;
      } catch (err) {
        flashProjectNotice(`Couldn't open "${file.name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [confirmDiscard, openDocument, flashProjectNotice]
  );

  /** Opens the demo song (the start screen's offer, and the first visit). */
  const handleLoadDemo = useCallback(async (): Promise<boolean> => {
    try {
      openDocument(await decodeBundle(await fetchDemoSong()), null);
      track("template_chosen", { template: "demo" });
      return true;
    } catch (err) {
      flashProjectNotice(`Couldn't open the demo song: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }, [openDocument, flashProjectNotice]);

  // Ctrl/Cmd+S saves, +Shift saves as, Ctrl/Cmd+O opens - everywhere, even
  // while typing or in the piano roll.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        if (e.shiftKey) setSaveAsRequest((n) => n + 1);
        else void handleSave();
      } else if (key === "o" && !e.shiftKey) {
        e.preventDefault();
        if (supportsFolders()) void handleOpenProject();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave, handleOpenProject]);

  // Debounced autosave - fires a moment after the document settles, not on
  // every keystroke/drag frame.
  useEffect(() => {
    if (!projectLoadedRef.current) return;
    const timer = setTimeout(() => {
      void persistNow();
    }, 1200);
    return () => clearTimeout(timer);
  }, [persistNow]);

  const editingChannel = channels.find((c) => c.id === editingClip?.channelId);
  const editingClipInstance = editingClip
    ? clipsOf(editingClip.channelId).find((c) => c.id === editingClip.clipId)
    : undefined;
  const fxChannel = channels.find((c) => c.id === fxChannelId);
  const fxBus = buses.find((b) => b.id === fxBusId);
  const rackEffects = fxChannel ? channelEffects[fxChannel.id] ?? [] : fxBus ? busEffects[fxBus.id] ?? [] : masterEffects;
  const expandedEffect = expandedEffectId ? rackEffects.find((e) => e.id === expandedEffectId) : undefined;
  const fxHostId = fxChannel?.id ?? fxBus?.id ?? "master";
  const sidechainSources: SidechainSource[] = [
    ...channels.map((c) => ({ id: c.id, name: c.name, kind: "track" as const })),
    ...buses.map((b) => ({ id: b.id, name: b.name, kind: "bus" as const })),
  ];
  // Folded groups hide their tracks; folded tracks are a short row.
  const hiddenTracks = hiddenByFoldedGroups(channels);
  const visibleChannels = channels.filter((c) => !hiddenTracks.has(c.id));
  const trackRoutes = routeMap(channels);
  /** Where a track's audio goes when that isn't the default, for its header. */
  const outputNameOf = (c: ChannelConfig): string | null => {
    if (!c.output) return null;
    const dest = trackRoutes.get(c.id) ?? null;
    if (!dest) return c.groupId ? "Master" : null;
    return dest === c.groupId ? null : channels.find((k) => k.id === dest)?.name ?? null;
  };
  /** A track's "Audio to" choices: the default (its group, else the
   * master), the master past its group, and the groups and audio tracks
   * that don't already feed it. */
  /** An audio track's "Audio From" choices: the interface, or any track
   * whose audio doesn't already come from it. */
  const inputOptionsFor = (c: ChannelConfig) => [
    { value: "", label: "Audio interface" },
    ...inputSources(c.id, channels).map((t) => ({ value: t.id, label: `${t.type === "group" ? "Group" : "Track"}: ${t.name}` })),
  ];
  /** Where a track's audio comes from when that's another track, for its header. */
  const inputNameOf = (c: ChannelConfig): string | null => {
    if (c.type !== "audio" || !c.input) return null;
    const source = channels.find((k) => k.id === c.input!.track);
    return source ? `${source.name} · ${SIDECHAIN_TAP_LABELS[c.input.tap]}` : null;
  };
  const outputOptionsFor = (c: ChannelConfig) => {
    const group = c.groupId ? channels.find((g) => g.id === c.groupId) : undefined;
    const options = [{ value: "", label: group ? `${group.name} (its group)` : "Master" }];
    if (group) options.push({ value: MASTER_OUTPUT, label: "Master" });
    outputTargets(c.id, channels)
      .filter((t) => t.id !== c.groupId)
      .forEach((t) => options.push({ value: t.id, label: `${t.type === "group" ? "Group" : "Track"}: ${t.name}` }));
    return options;
  };
  const lanesHeight =
    visibleChannels.reduce((sum, c) => sum + rowHeightOf(c), 0) +
    (automationChannelId && visibleChannels.some((c) => c.id === automationChannelId) ? AUTOMATION_LANE_HEIGHT : 0);

  return (
    <div className="flex h-screen overflow-hidden">
      {isLoadingProject && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90">
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 size={16} className="animate-spin" />
            Loading project…
          </div>
        </div>
      )}
      {recoveryNotice && (
        <div
          role="alert"
          className="fixed left-1/2 top-3 z-[90] flex w-[min(640px,calc(100vw-32px))] -translate-x-1/2 items-start gap-3 rounded-lg border border-border bg-surface-raised p-3 text-sm shadow-2xl"
        >
          <div className="flex-1">
            <p className="font-medium">The studio started with a fresh project.</p>
            <p className="mt-1 text-xs text-muted">
              {recoveryNotice} A backup of it is kept in this browser.
              {backupDownloadFailed && " (No backup was found to download.)"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void downloadLatestBackup()
                .then((found) => setBackupDownloadFailed(!found))
                .catch(() => setBackupDownloadFailed(true));
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-surface"
          >
            <Download size={13} />
            Download backup
          </button>
          <button
            type="button"
            title="Dismiss"
            onClick={() => {
              clearRecoveryNotice();
              setRecoveryNotice(null);
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-surface"
          >
            <X size={14} />
          </button>
        </div>
      )}
      <EffectBrowser
        onAddEffect={handleSidebarAddEffect}
        onAddChain={fxChannel ? (chain) => effectActions.addChain(fxChannel.id, chain) : undefined}
        grooves={
          <GrooveBrowser
            canAdd={fxChannel?.type === "midi"}
            onAdd={(g) => fxChannel && handleAddGroove(fxChannel.id, g, cursorSeconds)}
            onPreview={(g) => {
              // On the selected track's kit when it has one, else the groove's own.
              const kit = fxChannel?.instrument === "drums" && fxChannel.drumParams ? fxChannel.drumParams : grooveKit(g);
              const spb = 60 / bpm;
              void audioEngine.previewDrums(kit, grooveHits(g).map((h) => ({ pad: h.pad, time: h.beat * spb, velocity: h.velocity })));
            }}
            onStopPreview={() => audioEngine.stopPreview()}
          />
        }
      />
      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3">
      <header className="flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-icon.png" alt="" className="h-6 w-6 rounded-md" />
          <h1 className="whitespace-nowrap text-lg font-semibold tracking-tight">
            The Dawn Project
          </h1>
          <div className="ml-3">
            <ProjectMenu
              name={projectName}
              dirty={dirty}
              folders={supportsFolders()}
              brave={isBrave()}
              folderName={projectFolderName}
              busy={projectBusy}
              onNew={handleNewProject}
              onOpen={() => void handleOpenProject()}
              onOpenRecent={(r) => void handleOpenRecent(r)}
              listRecent={recentProjects}
              onSave={() => void handleSave()}
              onSaveAs={(n) => void handleSaveAs(n)}
              onImport={(f) => void handleImportProjectFile(f)}
              onExport={() => void downloadProjectFile(projectName)}
              onPacks={() => setPacks({ message: null })}
              saveAsRequest={saveAsRequest}
            />
          </div>
          {projectNotice && <span className="max-w-[220px] truncate text-xs text-muted">{projectNotice}</span>}
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <p className={`truncate text-xs ${micError || importError ? "text-record" : "hidden text-muted 2xl:block"}`}>
            {micError
              ? micError
              : importError
                ? importError
                : samplesReady
                  ? "double-click a clip to edit it in the piano roll · space to play/pause · ctrl/cmd+C/V to copy/paste the clip at the playhead"
                  : "loading piano sounds…"}
          </p>
          <HelpMenu onTour={() => setTourOpen(true)} onFeedback={() => openFeedback("help")} />
          <button
            type="button"
            onClick={() => openFeedback("header")}
            title="Send feedback or report a problem (your browser and Dawn's version are filled in)"
            className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-surface-raised hover:text-foreground"
          >
            <MessageSquare size={12} />
            Feedback
          </button>
          {hasSupportLinks && (
            <button
              type="button"
              onClick={() => {
                track("support_link_clicked", { where: "header" });
                setAboutTab("about");
              }}
              title="Dawn is free: support it"
              className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-surface-raised hover:text-foreground"
            >
              <Heart size={12} className="text-record" />
              Support
            </button>
          )}
          <button
            type="button"
            onClick={() => setAboutTab("about")}
            title="About Dawn: credits, privacy and license"
            className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-surface-raised hover:text-foreground"
          >
            <Info size={12} />
            About
          </button>
        </div>
      </header>

      <div className="shrink-0" data-tour="transport">
        <TransportBar
          status={<AudioStatus />}
          bpm={bpm}
          onBpmChange={handleBpmCommit}
          timeSignature={timeSignature}
          onTimeSignatureChange={handleTimeSignatureCommit}
          metronomeEnabled={metronomeEnabled}
          onToggleMetronome={() => setMetronomeEnabled((v) => !v)}
          isPlaying={transportState === "playing"}
          isPaused={transportState === "paused"}
          isRecording={transportState === "recording"}
          canRecord={transportState === "recording" || !!armedChannelId}
          recordingMode={armedChannel?.type === "audio" ? "audio" : "midi"}
          armedChannelName={armedChannel?.name ?? null}
          loopEnabled={loopEnabled}
          onToggleLoop={toggleLoop}
          countInBars={countInBars}
          onCountInChange={setCountInBars}
          onPlay={handlePlay}
          onPause={handlePause}
          onStop={() => void handleStop()}
          onRecord={handleRecord}
        />
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              title="Undo (Ctrl/Cmd+Z)"
              className="flex h-6 w-6 items-center justify-center rounded border border-border hover:bg-surface-raised disabled:opacity-30"
            >
              <Undo2 size={12} />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              title="Redo (Ctrl/Cmd+Shift+Z)"
              className="flex h-6 w-6 items-center justify-center rounded border border-border hover:bg-surface-raised disabled:opacity-30"
            >
              <Redo2 size={12} />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() =>
                setPxPerSecond((z) => Math.max(MIN_PX_PER_SECOND, z - 20))
              }
              title="Zoom out"
              className="flex h-6 w-6 items-center justify-center rounded border border-border hover:bg-surface-raised"
            >
              <ZoomOut size={12} />
            </button>
            <button
              type="button"
              onClick={() =>
                setPxPerSecond((z) => Math.min(MAX_PX_PER_SECOND, z + 20))
              }
              title="Zoom in"
              className="flex h-6 w-6 items-center justify-center rounded border border-border hover:bg-surface-raised"
            >
              <ZoomIn size={12} />
            </button>
          </div>
          <label className="flex items-center gap-1.5">
            Snap
            <select
              value={snapResolution}
              onChange={(e) => setSnapResolution(e.target.value as SnapResolution)}
              className="rounded border border-border bg-surface-raised px-1.5 py-1 font-mono text-foreground"
            >
              {SNAP_RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {SNAP_RESOLUTION_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={toggleLoop}
            aria-pressed={loopEnabled}
            title="Loop the arrangement between the loop brace's ends (Ctrl+L)"
            className={`flex h-6 items-center gap-1 rounded border px-1.5 ${
              loopEnabled
                ? "border-accent bg-accent/20 text-accent"
                : "border-border text-muted hover:bg-surface-raised"
            }`}
          >
            <Repeat size={12} />
            Loop
          </button>
          <LoopFields loop={loop} beatsPerBar={beatsPerBar} onChange={setLoop} />
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            data-tour="export"
            title="Export the song (or the loop) as WAV or MP3, or one file per track (stems)"
            className="flex h-6 items-center gap-1 rounded border border-border px-1.5 text-muted hover:bg-surface-raised"
          >
            <Download size={12} />
            Export
          </button>
          <span className="text-muted/70" title="A working copy is kept in this browser as you go, so a reload or crash loses nothing. File > Save writes the project to your computer.">
            {saveStatus === "saving" ? "autosaving…" : saveStatus === "saved" ? "autosaved" : saveStatus === "error" ? "autosave failed" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => toggleNoteInput(!noteInputOpen)}
            aria-pressed={noteInputOpen}
            title="Show or hide the on-screen keyboard and drum pads (your computer keyboard plays the armed track either way)"
            className={`flex h-6 items-center gap-1 rounded border px-1.5 text-xs ${
              noteInputOpen ? "border-accent bg-accent/20 text-accent" : "border-border text-muted hover:bg-surface-raised"
            }`}
          >
            <KeyboardMusic size={12} />
            Keys
          </button>
          <ScaleSelector value={scaleSetting} onChange={setScaleSetting} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg border border-border">
        {/* Sticky ruler row - a direct child of the vertical scroller (not
            nested inside the horizontally-scrolling lanes column), so
            position: sticky actually has that scroller as its containing
            block instead of getting stuck relative to an inner element. */}
        <div className="sticky top-0 z-20 flex shrink-0 bg-surface">
          <div
            style={{ width: TRACK_HEADER_WIDTH, height: RULER_HEIGHT + LOOP_BAR_HEIGHT }}
            className="flex shrink-0 items-end justify-end gap-2 border-b border-r border-border bg-surface px-2 pb-[1px]"
          >
            <button
              type="button"
              onClick={() => handleFoldAll()}
              aria-pressed={allFolded}
              disabled={channels.length === 0}
              title={allFolded ? "Unfold all tracks" : "Fold all tracks to one short row each (Alt-click a track's arrow does the same)"}
              className={`flex items-center gap-1 rounded px-1 text-[9px] font-semibold uppercase tracking-wider ${allFolded ? "text-accent" : "text-muted hover:text-foreground"}`}
            >
              <ChevronsDownUp size={9} /> {allFolded ? "Unfold" : "Fold"}
            </button>
            <button
              type="button"
              onClick={toggleLoop}
              aria-pressed={loop.on}
              title={`Loop ${loop.on ? "on" : "off"} (Ctrl+L)`}
              className={`flex items-center gap-1 rounded px-1 text-[9px] font-semibold uppercase tracking-wider ${loop.on ? "text-accent" : "text-muted hover:text-foreground"}`}
            >
              <Repeat size={9} /> Loop
            </button>
          </div>
          <div ref={rulerViewportRef} className="flex-1 overflow-hidden border-b border-border">
            <TimelineRuler
              bpm={bpm}
              totalSeconds={totalSeconds}
              pxPerSecond={pxPerSecond}
              beatsPerBar={beatsPerBar}
              onSeek={handleSeek}
              loopStart={loop.on ? beatsToSeconds(loop.start, bpm) : 0}
              loopEnd={loop.on ? beatsToSeconds(loop.end, bpm) : 0}
              onSetLoopRegion={(start, end) => {
                setLoop({ on: true, start: secondsToBeats(start, bpm), end: secondsToBeats(end, bpm) });
                setLoopSelected(true);
              }}
            />
            <LoopBar
              loop={loop}
              bpm={bpm}
              pxPerSecond={pxPerSecond}
              totalSeconds={totalSeconds}
              beatsPerBar={beatsPerBar}
              snapUnit={secondsToBeats(snapUnitFor(bpm, pxPerSecond, beatsPerBar), bpm)}
              selected={loopSelected}
              onSelect={setLoopSelected}
              onChange={setLoop}
            />
          </div>
        </div>

        <div className="flex flex-1">
          <div className="flex shrink-0 flex-col">
            {visibleChannels.map((channel, idx) => (
              <div key={channel.id} data-tour={idx === 0 ? "track" : undefined}>
                <TrackHeader
                  channel={channel}
                  color={trackColorOf(channel)}
                  rowHeight={rowHeightOf(channel)}
                  onToggleFold={(all) => (all ? handleFoldAll(!channel.folded) : handleToggleFold(channel.id))}
                  groupColor={(() => {
                    const group = channel.groupId ? channels.find((g) => g.id === channel.groupId) : undefined;
                    return group ? trackColorOf(group) : undefined;
                  })()}
                  memberCount={channel.type === "group" ? channels.filter((m) => m.groupId === channel.id).length : 0}
                  picked={trackPicks.has(channel.id)}
                  onPick={() => handlePickTrack(channel.id)}
                  outputName={outputNameOf(channel)}
                  inputName={inputNameOf(channel)}
                  selected={channel.id === selectedChannelId}
                  recording={transportState === "recording" && channel.id === recordingChannelId}
                  hasNotes={clipsOf(channel.id).some((c) => c.kind === "midi" && c.notes.length > 0)}
                  hasClipContent={clipsOf(channel.id).length > 0}
                  effectsCount={(channelEffects[channel.id] ?? []).length}
                  canRemove={channels.length > 1}
                  canMoveUp={canMoveTrack(channels, channel.id, -1)}
                  canMoveDown={canMoveTrack(channels, channel.id, 1)}
                  showAutomation={automationChannelId === channel.id}
                  onToggleAutomation={() => handleToggleAutomation(channel.id)}
                  inputDevices={inputDevices}
                  selectedInputDeviceId={selectedInputDeviceId}
                  onInputDeviceChange={handleInputDeviceChange}
                  onRequestInputDevices={handleRequestInputDevices}
                  onSelect={() => {
                    setSelectedChannelId(channel.id);
                    setSelectedClipIds(new Set());
                    setTrackPicks(new Set());
                    openFx(channel.id);
                  }}
                  onRename={(name) => handleRenameChannel(channel.id, name)}
                  onRecolor={(pick) => handleRecolorChannel(channel.id, pick)}
                  onMoveUp={() => handleReorderChannel(channel.id, -1)}
                  onMoveDown={() => handleReorderChannel(channel.id, 1)}
                  onVolumeChange={(db) => handleVolumeChange(channel.id, db)}
                  onPanChange={(pan) => handlePanChange(channel.id, pan)}
                  onAdjustStart={pushHistory}
                  onMuteToggle={() => handleMuteToggle(channel.id)}
                  onSoloToggle={() => handleSoloToggle(channel.id)}
                  onArmToggle={() => handleArmToggle(channel.id)}
                  monitoring={monitoredChannelIds.has(channel.id)}
                  onMonitorToggle={() => handleMonitorToggle(channel.id)}
                  onOpenFx={() => openFx(channel.id)}
                  onImportMidi={(file) => void handleImportMidi(channel.id, file)}
                  onExportMidi={() => handleExportChannelMidi(channel.id)}
                  onImportAudio={(file) => void handleImportAudioAppend(channel.id, file)}
                  onClearClip={() => handleClearTrack(channel.id)}
                  onRemove={() => handleRemoveChannel(channel.id)}
                  onContextMenu={(e) => openHeaderMenu(channel.id, e)}
                />
                {automationChannelId === channel.id && (
                  <div
                    className="flex shrink-0 items-center border-b border-r border-border bg-surface px-2"
                    style={{ width: TRACK_HEADER_WIDTH, height: AUTOMATION_LANE_HEIGHT }}
                  >
                    <select
                      value={automationTargetKey(automationTarget)}
                      onChange={(e) => {
                        const opt = automationTargetOptions(channelEffects[channel.id] ?? []).find(
                          (o) => automationTargetKey(o.target) === e.target.value
                        );
                        if (opt) setAutomationTarget(opt.target);
                      }}
                      className="w-full rounded border border-border bg-surface-raised px-1.5 py-1 text-[11px]"
                    >
                      {automationTargetOptions(channelEffects[channel.id] ?? []).map((opt) => (
                        <option key={automationTargetKey(opt.target)} value={automationTargetKey(opt.target)}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            ))}
            <div className="flex shrink-0" style={{ width: TRACK_HEADER_WIDTH }}>
              <button
                type="button"
                onClick={() => handleAddChannel("midi")}
                className="flex h-9 flex-1 items-center justify-center border-r border-border text-xs text-muted hover:bg-surface-raised hover:text-accent"
              >
                + MIDI
              </button>
              <button
                type="button"
                onClick={() => handleAddChannel("audio")}
                className="flex h-9 flex-1 items-center justify-center border-r border-border text-xs text-muted hover:bg-surface-raised hover:text-accent"
              >
                + Audio
              </button>
              <button
                type="button"
                onClick={() => handleAddChannel("group")}
                title="Add an empty group track. To group tracks you have, Ctrl/Cmd-click their headers and press Ctrl+G"
                className="flex h-9 flex-1 items-center justify-center border-r border-border text-xs text-muted hover:bg-surface-raised hover:text-accent"
              >
                + Group
              </button>
            </div>
          </div>

          <div
            ref={lanesScrollRef}
            id="arrangement-lanes"
            onScroll={handleLanesScroll}
            className="relative flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {visibleChannels.map((channel) => (
              <div key={channel.id}>
                <TrackLane
                  clips={clipsOf(channel.id)}
                  color={trackColorOf(channel)}
                  rowHeight={rowHeightOf(channel)}
                  overview={
                    channel.type === "group"
                      ? channels
                          .filter((m) => m.groupId === channel.id)
                          .map((m) => ({ id: m.id, clips: clipsOf(m.id), color: trackColorOf(m) }))
                      : undefined
                  }
                  bpm={bpm}
                  beatsPerBar={beatsPerBar}
                  totalSeconds={totalSeconds}
                  pxPerSecond={pxPerSecond}
                  snapSeconds={snapSeconds}
                  selected={channel.id === selectedChannelId}
                  armed={channel.id === armedChannelId}
                  recording={transportState === "recording" && channel.id === recordingChannelId}
                  channelId={channel.id}
                  selectedClipIds={selectedClipIds}
                  onSelectTrack={() => {
                    setSelectedChannelId(channel.id);
                    setSelectedClipIds(new Set());
                    openFx(channel.id);
                  }}
                  onSelectClip={(clipId, additive) => {
                    setSelectedChannelId(channel.id);
                    openFx(channel.id);
                    setSelectedClipIds((prev) => {
                      if (additive) {
                        const next = new Set(prev);
                        if (next.has(clipId)) next.delete(clipId);
                        else next.add(clipId);
                        return next;
                      }
                      return new Set([clipId]);
                    });
                  }}
                  onEditClip={(clipId) => handleEditClip(channel.id, clipId)}
                  onMoveClip={(clipId, offset) => handleMoveClip(channel.id, clipId, offset)}
                  onResizeClip={(clipId, length) => handleResizeClip(channel.id, clipId, length)}
                  onFadeChange={(clipId, fadeIn, fadeOut) => handleFadeChange(channel.id, clipId, fadeIn, fadeOut)}
                  onGainChange={(clipId, gainDb) => handleGainChange(channel.id, clipId, gainDb)}
                  onClipContextMenu={(clipId, e) => openClipMenu(channel.id, clipId, e)}
                  onLaneContextMenu={(e, atSeconds) => openLaneMenu(channel.id, e, atSeconds)}
                  onClipDragStart={pushHistory}
                  acceptsFileDrop={channel.type === "audio"}
                  hint={laneHint(channel, channel.id === armedChannelId)}
                  onDropAudioFile={(file, atSeconds) => void handleDropAudioFile(channel.id, file, atSeconds)}
                  onDropGroove={
                    channel.type === "midi"
                      ? (id, atSeconds) => {
                          const groove = grooveById(id);
                          if (groove) handleAddGroove(channel.id, groove, atSeconds);
                        }
                      : undefined
                  }
                />
                {automationChannelId === channel.id && (
                  <div className="border-b border-border bg-surface-raised/30">
                    <AutomationLaneEditor
                      points={
                        (channel.automationLanes ?? []).find(
                          (l) => automationTargetKey(l.target) === automationTargetKey(automationTarget)
                        )?.points ?? []
                      }
                      valueMin={automationRange(automationTarget, channelEffects[channel.id] ?? []).min}
                      valueMax={automationRange(automationTarget, channelEffects[channel.id] ?? []).max}
                      currentValue={automationCurrentValue(automationTarget, channel, channelEffects[channel.id] ?? [])}
                      formatValue={automationRange(automationTarget, channelEffects[channel.id] ?? []).format}
                      totalSeconds={totalSeconds}
                      pxPerSecond={pxPerSecond}
                      bpm={bpm}
                      beatsPerBar={beatsPerBar}
                      height={AUTOMATION_LANE_HEIGHT}
                      color={trackColorOf(channel)}
                      onChange={(points) => handleAutomationPointsChange(channel.id, automationTarget, points)}
                      onDragStart={pushHistory}
                    />
                  </div>
                )}
              </div>
            ))}
            {loop.on && (
              <div
                className="pointer-events-none absolute top-0 z-10 h-full border-x border-accent/60 bg-accent/[0.07]"
                style={{ left: beatsToSeconds(loop.start, bpm) * pxPerSecond, width: beatsToSeconds(loop.end - loop.start, bpm) * pxPerSecond }}
              />
            )}
            <Playhead pxPerSecond={pxPerSecond} height={lanesHeight} />
          </div>
        </div>

        {/* The timeline's horizontal scrollbar, pinned to the bottom of the
            arrangement like Ableton's, so it stays in reach however many
            tracks there are (the lanes' own scrollbar is hidden). */}
        <div className="sticky bottom-0 z-20 flex shrink-0 border-t border-border bg-surface">
          <div className="shrink-0 border-r border-border" style={{ width: TRACK_HEADER_WIDTH }} />
          <TimelineScrollbar target={lanesScrollRef} controls="arrangement-lanes" contentWidth={totalSeconds * pxPerSecond} />
        </div>
      </div>

      <input
        ref={audioImportInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && audioImportTarget) {
            void handleImportAudioAt(audioImportTarget.channelId, file, audioImportTarget.atSeconds);
          }
          setAudioImportTarget(null);
          e.target.value = "";
        }}
      />

      {/* Master and the send/return buses share one row, so the tracks keep
          the room. The buses scroll sideways when there are many. */}
      <div className="flex shrink-0 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-1.5">
        <div className="flex shrink-0 items-center gap-2" title="Master output: every track routes through here before the speakers.">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: MASTER_COLOR.accent }} />
          {editingMasterName ? (
            <input
              autoFocus
              value={masterNameDraft}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setMasterNameDraft(e.target.value)}
              onBlur={() => {
                const trimmed = masterNameDraft.trim();
                if (trimmed && trimmed !== masterName) setMasterName(trimmed);
                setEditingMasterName(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") setEditingMasterName(false);
              }}
              className="w-20 rounded border border-accent bg-surface px-1 text-xs font-medium outline-none"
            />
          ) : (
            <span
              title="Double-click to rename"
              onDoubleClick={() => {
                setMasterNameDraft(masterName);
                setEditingMasterName(true);
              }}
              className="w-20 shrink-0 truncate text-xs font-medium"
            >
              {masterName}
            </span>
          )}
          <div className="h-8">
            <Meter channelId="master" />
          </div>
          <ValueBar
            label="Pan"
            value={masterPan}
            min={-1}
            max={1}
            defaultValue={0}
            onChange={setMasterPan}
            onDragStart={pushHistory}
            formatValue={(v) => (Math.abs(v) < 0.02 ? "C" : v < 0 ? `${Math.round(-v * 100)}L` : `${Math.round(v * 100)}R`)}
            bipolar
          />
          <ValueBar
            label="Vol"
            value={masterVolume}
            min={-60}
            max={6}
            defaultValue={0}
            onChange={setMasterVolume}
            onDragStart={pushHistory}
            formatValue={(v) => (v <= -60 ? "-∞" : `${v.toFixed(1)}dB`)}
          />
          <ValueBar
            label="Ceiling"
            value={masterLimiterThreshold}
            min={-24}
            max={0}
            defaultValue={-1}
            onChange={setMasterLimiterThreshold}
            onDragStart={pushHistory}
            formatValue={(v) => `${v.toFixed(1)}dB`}
          />
          <span className="text-[10px] text-muted/70">limiter</span>
          <button
            type="button"
            title={`FX${masterEffects.length > 0 ? ` (${masterEffects.length})` : ""} — master bus effects`}
            onClick={openMasterFx}
            className={`relative flex h-5 items-center gap-1 rounded border border-border px-1.5 text-[10px] font-medium hover:bg-surface-raised ${
              masterEffects.length > 0 ? "text-accent" : "text-muted"
            }`}
          >
            <Sliders size={11} />
            FX
            {masterEffects.length > 0 && (
              <span className="flex h-3 w-3 items-center justify-center rounded-full bg-accent text-[7px] font-bold text-black">
                {masterEffects.length}
              </span>
            )}
          </button>
        </div>
        <div className="h-8 w-px shrink-0 bg-border" />
        <span
          className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted"
          title="Send/return buses: set each track's send level to a bus in its FX rack."
        >
          Buses
        </span>
        <button
          type="button"
          onClick={() => {
            handleAddBus();
            // Bring the new bus into view at the end of the row.
            setTimeout(() => busRowRef.current?.scrollTo({ left: busRowRef.current.scrollWidth, behavior: "smooth" }), 50);
          }}
          title="Add a send/return bus"
          className="shrink-0 rounded border border-border px-2 py-1 text-[11px] text-muted hover:border-accent hover:text-accent"
        >
          + Bus
        </button>
        <div ref={busRowRef} className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-0.5">
          {buses.map((bus) => (
            <div
              key={bus.id}
              className="flex shrink-0 items-center gap-1 rounded border border-border bg-surface-raised px-1.5 py-1"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: trackColorOf(bus).accent }}
              />
              <input
                value={bus.name}
                onChange={(e) => handleRenameBus(bus.id, e.target.value)}
                className="w-20 bg-transparent text-xs outline-none"
                title="Bus name"
              />
              <button
                type="button"
                title="Open bus effects"
                onClick={() => openBusFx(bus.id)}
                className="rounded px-1 text-[10px] text-muted hover:bg-surface hover:text-accent"
              >
                FX{(busEffects[bus.id]?.length ?? 0) > 0 ? ` (${busEffects[bus.id]!.length})` : ""}
              </button>
              <button
                type="button"
                title="Remove bus"
                onClick={() => handleRemoveBus(bus.id)}
                className="rounded px-1 text-[10px] text-muted hover:bg-surface hover:text-record"
              >
                ✕
              </button>
            </div>
          ))}
          {buses.length === 0 && <span className="text-[10px] text-muted/70">No buses yet: add one for a shared reverb or delay.</span>}
        </div>
      </div>

      <NoteInputWindow
        open={noteInputOpen}
        title={armedChannel && armedChannel.type !== "audio" ? `${armedChannel.name} — keys` : "Keys"}
        onClose={() => toggleNoteInput(false)}
      >
        {!armedChannel || armedChannel.type === "audio" ? (
          <p className="py-3 text-center text-xs text-muted">
            {armedChannel ? `${armedChannel.name} is an audio track: it records your microphone or interface.` : "No track armed"} — arm a MIDI
            track (its red button) to play it here.
          </p>
        ) : armedChannel.instrument === "drums" ? (
          <DrumPads
            kit={armedChannel.drumParams}
            activeNotes={activeNotes}
            onNoteOn={handleNoteOn}
            onNoteOff={handleNoteOff}
            keyboardShortcutsEnabled={!editingClip}
          />
        ) : armedChannel.instrument === null ? (
          <div className="flex items-center justify-center gap-3 py-3 text-xs text-muted">
            <span>{armedChannel.name} has no instrument loaded.</span>
            <button
              type="button"
              onClick={() => openFx(armedChannel.id)}
              className="rounded border border-border px-2 py-1 text-accent hover:bg-surface-raised"
            >
              Open FX to add one
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <ExpressionControls
              pitchBendRangeSemitones={PITCH_BEND_RANGE_SEMITONES}
              onPitchBend={(semitones) => armedChannelId && audioEngine.setPitchBend(armedChannelId, semitones)}
              onModWheel={(amount) => armedChannelId && audioEngine.setModWheel(armedChannelId, amount)}
              onSustainChange={(down) => armedChannelId && audioEngine.setSustain(armedChannelId, down)}
            />
            <div className="flex-1">
              <PianoKeyboard
                activeNotes={activeNotes}
                onNoteOn={handleNoteOn}
                onNoteOff={handleNoteOff}
                scaleSetting={scaleSetting}
                keyboardShortcutsEnabled={!editingClip}
              />
            </div>
          </div>
        )}
      </NoteInputWindow>

      {editingChannel && editingClipInstance && editingClipInstance.kind === "midi" && (
        <PianoRollEditor
          key={editingClipInstance.id}
          channelName={editingChannel.name}
          color={trackColorOf(editingChannel)}
          instrument={editingChannel.instrument ?? "piano"}
          drumKit={editingChannel.drumParams}
          notes={editingClipInstance.notes}
          length={editingClipInstance.length}
          bpm={bpm}
          beatsPerBar={beatsPerBar}
          offset={editingClipInstance.offset}
          scaleSetting={scaleSetting}
          onScaleChange={setScaleSetting}
          onChange={(notes) => handleEditorChange(editingChannel.id, editingClipInstance.id, notes)}
          onClose={() => setEditingClip(null)}
          onPreviewNote={(note) => handlePreviewNote(editingChannel.id, note)}
          isPlaying={transportState === "playing"}
          onPlay={handlePlay}
          onPause={handlePause}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={
            contextMenu.kind === "clip"
              ? clipMenuItems
              : contextMenu.kind === "lane"
                ? laneMenuItems
                : headerMenuItems
          }
        />
      )}

      {(fxChannel || fxBus || fxMasterOpen) && (
        <FxRack
          channelName={fxChannel?.name ?? fxBus?.name ?? masterName}
          hostId={fxHostId}
          sidechainSources={sidechainSources}
          onPresetChange={(effectId, change) => effectActions.changePreset(fxHostId, effectId, change)}
          channelType={fxChannel?.type}
          color={fxChannel ? trackColorOf(fxChannel) : fxBus ? trackColorOf(fxBus) : MASTER_COLOR}
          instrument={fxChannel?.instrument}
          synthParams={fxChannel?.synthParams}
          drumParams={fxChannel?.drumParams}
          onOpenDrumRack={() => setDrumWindowOpen(true)}
          effects={rackEffects}
          bpm={bpm}
          buses={buses}
          sends={fxChannel?.sends}
          onInstrumentChange={fxChannel ? (type) => handleInstrumentChange(fxChannel.id, type) : undefined}
          onOpenSynthSettings={() => setSynthWindowOpen(true)}
          onSynthParamsChange={fxChannel ? handleSynthParamsChange : undefined}
          onSendChange={fxChannel ? handleSendChange : undefined}
          onAddEffect={(type, atIndex, presetId) => effectActions.add(fxHostId, type, atIndex, presetId)}
          onRemoveEffect={(effectId) => effectActions.remove(fxHostId, effectId)}
          onMoveEffect={(effectId, toIndex) => effectActions.move(fxHostId, effectId, toIndex)}
          onBypassToggle={(effectId) => effectActions.toggleBypass(fxHostId, effectId)}
          onParamDragStart={pushHistory}
          onParamChange={(effectId, key, value) => effectActions.setParam(fxHostId, effectId, key, value)}
          onOpenEffectWindow={setExpandedEffectId}
          onLoadEffectFile={(effectId, file) => effectActions.loadFile(fxHostId, effectId, file)}
          onClearEffectFile={(effectId) => effectActions.setFile(fxHostId, effectId, null)}
          inputOptions={fxChannel?.type === "audio" ? inputOptionsFor(fxChannel) : undefined}
          inputValue={fxChannel?.input?.track ?? ""}
          inputTap={fxChannel?.input?.tap ?? "postFx"}
          onInputChange={
            fxChannel ? (track, tap) => handleSetInput(fxChannel.id, track ? { track, tap } : null) : undefined
          }
          outputOptions={fxChannel ? outputOptionsFor(fxChannel) : undefined}
          outputValue={fxChannel?.output ?? ""}
          onOutputChange={fxChannel ? (value) => handleSetOutput(fxChannel.id, value || null) : undefined}
        />
      )}

      {exportOpen && (
        <ExportDialog
          songName={projectName}
          buildParams={buildBounceParams}
          loop={loop.on ? { start: beatsToSeconds(loop.start, bpm), end: beatsToSeconds(loop.end, bpm) } : null}
          loopLabel={`${formatPosition(loop.start, beatsPerBar)}–${formatPosition(loop.end, beatsPerBar)}`}
          onClose={() => setExportOpen(false)}
          onExported={(result, settings) => {
            track("export_completed", { format: settings.format, kind: settings.what, where: settings.range });
            flashProjectNotice(result.files > 1 ? `Exported ${result.files} stems` : `Exported "${result.fileName}"`);
            setExportOpen(false);
            if (shouldAskAfterExport()) setSupportAsk(true);
          }}
        />
      )}

      {startScreen && (
        <StartScreen
          firstVisit={startScreen === "welcome"}
          folders={supportsFolders()}
          listRecent={recentProjects}
          onTemplate={handleTemplate}
          onOpen={() => {
            closeStartScreen();
            void handleOpenProject();
          }}
          onOpenRecent={(r) => {
            closeStartScreen();
            void handleOpenRecent(r);
          }}
          onImport={(f) => {
            closeStartScreen();
            void handleImportProjectFile(f);
          }}
          onLoadDemo={handleLoadDemo}
          onListenDemo={() => {
            // The tour waits until the song has been heard: it opens on the
            // first stop or pause.
            tourAfterListenRef.current = welcomeRef.current;
            welcomeRef.current = false;
            setStartScreen(null);
            // After the song's tracks reach the engine (the next render).
            setTimeout(() => void playRef.current(), 200);
          }}
          onClose={closeStartScreen}
        />
      )}

      {tourOpen && <Tour onClose={() => setTourOpen(false)} />}

      {packs && (
        <PacksWindow
          initialMessage={packs.message}
          onInstall={handleInstallPack}
          onRemove={removePack}
          onClose={() => setPacks(null)}
        />
      )}

      <AppUpdater />

      {supportAsk && <PostExportNote onClose={() => setSupportAsk(false)} />}

      {aboutTab && <AboutWindow initialTab={aboutTab} onClose={() => setAboutTab(null)} privacyExtra={<TelemetrySwitch />} />}

      {drumWindowOpen && fxChannel?.instrument === "drums" && fxChannel.drumParams && (
        <DrumRackWindow
          channelId={fxChannel.id}
          channelName={fxChannel.name}
          kit={fxChannel.drumParams}
          onChange={handleDrumKitChange}
          onClose={() => setDrumWindowOpen(false)}
          onDragStart={pushHistory}
        />
      )}

      {synthWindowOpen && fxChannel?.instrument === "synth" && fxChannel.synthParams && (
        <SynthWindow
          channelId={fxChannel.id}
          channelName={fxChannel.name}
          color={trackColorOf(fxChannel)}
          params={fxChannel.synthParams}
          onChange={handleSynthParamsChange}
          onClose={() => setSynthWindowOpen(false)}
          onDragStart={pushHistory}
        />
      )}

      {expandedEffectId && expandedEffect && (
        <EffectWindow
          hostId={fxHostId}
          hostName={fxChannel?.name ?? fxBus?.name ?? masterName}
          effect={expandedEffect}
          bpm={bpm}
          sidechainSources={sidechainSources}
          onClose={() => setExpandedEffectId(null)}
        />
      )}
      </div>
    </div>
  );
}
