"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Download, ChevronsDownUp, Heart, Info, Loader2, MessageSquare, Redo2, Repeat, KeyboardMusic, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { TrackHeader } from "./TrackHeader";
import { TrackLane } from "./TrackLane";
import { TimelineScrollbar } from "./TimelineScrollbar";
import { TimelineRuler } from "./TimelineRuler";
import { Playhead } from "./Playhead";
import { TransportBar } from "./TransportBar";
import { PianoKeyboard } from "./PianoKeyboard";
import { NoteInputWindow } from "./NoteInputWindow";
import { EffectWindow } from "./daw/EffectWindow";
import { MasterBusRow } from "./daw/MasterBusRow";
import { RecoveryNotice } from "./daw/RecoveryNotice";
import { automationCurrentValue, automationRange, automationTargetKey, automationTargetOptions } from "@/lib/automationTargets";
import { contextMenuItems, type ContextMenuState } from "./daw/contextMenus";
import { busActions } from "@/state/busActions";
import { useProjectFiles } from "./daw/useProjectFiles";
import { useShortcuts } from "@/lib/shortcuts";
import { trackActions } from "@/state/trackActions";
import { effectActions } from "@/state/effectActions";
import { clipActions, isMidiClip, rebuildMidiPart } from "@/state/clipActions";
import { DrumPads } from "./DrumPads";
import { LOOP_BAR_HEIGHT, LoopBar, LoopFields } from "./LoopBar";
import { DrumRackWindow } from "./DrumRackWindow";
import { ExpressionControls } from "./ExpressionControls";
import { PianoRollEditor } from "./PianoRollEditor";
import { ScaleSelector } from "./ScaleSelector";
import { ContextMenu } from "./ContextMenu";
import { FxRack } from "./FxRack";
import { SynthWindow } from "./SynthWindow";
import type { SidechainSource } from "@/effects/sidechain/SidechainPanel";
import { SIDECHAIN_TAP_LABELS } from "@/effects/sidechain/sidechainModel";
import { AudioStatus } from "./AudioStatus";
import { EffectBrowser } from "./EffectBrowser";
import { AutomationLane as AutomationLaneEditor } from "./AutomationLane";
import { audioEngine } from "@/lib/audioEngine";
import { type DrumKitParams } from "@/lib/drumParams";
import { beatsToSeconds, defaultLoop, formatPosition, loopAround, loopsFrom, nudgeLoop, secondsToBeats, type ArrangementLoop } from "@/lib/arrangementLoop";
import { downloadMidiFile, parseMidiFile } from "@/lib/midiFile";
import { midiToNoteName } from "@/lib/piano";
import { listenToWebMidi } from "@/lib/webMidi";
import { MASTER_COLOR, trackColorOf } from "@/lib/colors";
import { canMoveTrack, hiddenByFoldedGroups, inputSources, MASTER_OUTPUT, outputTargets, routeMap } from "@/lib/routing";
import { decodeAudioFile } from "@/lib/audioFile";
import type { ProjectState } from "@/lib/project";
import { hydrateEngine, syncEngine } from "@/lib/engineSync";
import { projectSetter, projectStore, useHistoryState, useProjectValue } from "@/state/projectStore";
import { ProjectMenu } from "./ProjectMenu";
import { AboutWindow, type AboutTab } from "./AboutWindow";
import { TelemetrySwitch } from "./TelemetrySwitch";
import { startTelemetry, track, trackAppOpened, trackOnce } from "@/lib/telemetry";
import { isBrave, recentProjects, supportsFolders } from "@/lib/projectFiles";
import { type SerializedProject } from "@/lib/projectSchema";
import type { BounceParams } from "@/lib/bounce";
import { ExportDialog } from "./ExportDialog";
import { GrooveBrowser } from "./GrooveBrowser";
import { StartScreen } from "./StartScreen";
import { Tour, tourDone } from "./Tour";
import { HelpMenu } from "./HelpMenu";
import { PacksWindow } from "./PacksWindow";
import { AppUpdater } from "./AppUpdater";
import { installPack, removePack } from "@/lib/packStore";
import { PACK_EXTENSION } from "@/lib/dawnPack";
import { openFeedback, PostExportNote } from "./SupportViews";
import { shouldAskAfterExport, supportLinks } from "@/lib/support";
import type { ProjectTemplate } from "@/lib/templates";
import { grooveById, grooveHits, grooveKit, type Groove } from "@/lib/grooves";
import { loadAudioPrefs } from "@/lib/audioPrefs";
import { type EffectType } from "@/effects/registry";
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
import type { AutomationTarget, ChannelConfig, ChannelType, ClipInstance, SynthParams, TimeSignature } from "@/lib/types";
import { noteIssue } from "@/lib/issues";
import { flushSync } from "react-dom";
import { microphoneAllowed } from "@/lib/engine/inputs";

type TransportState = "stopped" | "playing" | "paused" | "recording";

/** How many semitones a full pitch-bend deflection (wheel or hardware
 * controller at its extreme) shifts a note by - the usual default range on
 * most synths/keyboards. */
const PITCH_BEND_RANGE_SEMITONES = 2;

const AUTOMATION_LANE_HEIGHT = 56;


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
    ? "Press Shift+R and play your MIDI keyboard or computer keys, or right-click to add a clip"
    : "Arm this track to play and record it, or right-click to add a clip";
}

// The document's setters (stable: they write to the project store).
const setClipsByChannel = projectSetter("clipsByChannel");
const setBpm = projectSetter("bpm");
const setTimeSignature = projectSetter("timeSignature");

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
      .catch((error) => {
        noteIssue("input.open", error, { report: false });
        setMicError("Couldn't open your audio input - allow microphone access in the browser, and pick your interface in the track's Input menu.");
      });
  }, [armedAudio]);

  const registeredChannelIds = useRef(new Set<string>());
  const registeredBusIds = useRef(new Set<string>());

  // --- Undo/redo (the project store keeps the steps) ---

  /** Records the document as it is now as an undo step - call at the very
   * top of a handler, before changing anything, or right as a drag gesture
   * starts, so the step is genuinely the "before". */
  const pushHistory = useCallback(() => projectStore.push(), []);

  /** After undo/redo replaced the document: the view lets go of what may
   * be gone, and the engine changes what differs (engineSync.ts). */
  const afterRestore = useCallback((before: ProjectState, restored: ProjectState) => {
    setSelectedClipIds(new Set());
    setEditingClip(null);
    syncEngine(before, restored, registeredChannelIds.current, audioEngine);
  }, []);

  const undo = useCallback(() => {
    const before = projectStore.get();
    const restored = projectStore.undo();
    if (restored) afterRestore(before, restored);
  }, [afterRestore]);

  const redo = useCallback(() => {
    const before = projectStore.get();
    const restored = projectStore.redo();
    if (restored) afterRestore(before, restored);
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
      .catch((error) => {
        noteIssue("input.devices", error, { report: false });
        setMicError("Couldn't access audio input devices - check the browser's permission prompt or site settings.");
      });
  }, [refreshInputDevices]);

  // Opens/closes the engine's live input for each monitored audio track.
  // Only tracks that exist (and are audio tracks) count, so deleting one -
  // or undoing its creation - stops its monitoring, and redo resumes it.
  const monitoredAudioIds = useMemo(
    () => [...monitoredChannelIds].filter((id) => channels.some((c) => c.id === id && c.type === "audio")),
    [monitoredChannelIds, channels]
  );
  // Saved with the project (sorted, so the same set saves the same).
  const monitoredTracks = useMemo(() => [...monitoredChannelIds].sort(), [monitoredChannelIds]);

  // The browser lets audio start only after the page is clicked or a key
  // pressed; monitors restored with a project wait for that.
  const [audioUnlocked, setAudioUnlocked] = useState(() => audioEngine.isStarted);
  useEffect(() => {
    if (audioUnlocked) return;
    const unlock = () => void audioEngine.ensureStarted().then(() => setAudioUnlocked(true));
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, [audioUnlocked]);

  /** A project's monitors come back when it opens: a track listening to
   * another track's audio always; one listening to the audio interface
   * only if the browser already lets Dawn use it, so opening a project
   * never asks for the microphone. */
  const restoreToken = useRef(0);
  const restoreMonitoring = useCallback((ids: string[], tracks: ChannelConfig[]) => {
    const token = ++restoreToken.current;
    const fromTracks = ids.filter((id) => tracks.some((c) => c.id === id && c.input));
    const fromInterface = ids.filter((id) => !fromTracks.includes(id));
    setMonitoredChannelIds(new Set(fromTracks));
    if (fromInterface.length === 0) return;
    void microphoneAllowed().then((allowed) => {
      if (allowed && token === restoreToken.current) setMonitoredChannelIds((prev) => new Set([...prev, ...fromInterface]));
    });
  }, []);

  const openMonitorsRef = useRef(new Set<string>());
  useEffect(() => {
    if (!audioUnlocked) return;
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
  }, [monitoredAudioIds, audioUnlocked]);
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

  /** The page switches to recording right before the transport starts:
   * its redraw (the transport bar, the live take on the timeline) is the
   * heaviest of the session, and done after the start it would hold up the
   * first beat's scheduling. */
  const showRecording = useCallback(() => {
    flushSync(() => {
      setMicError(null);
      setTransportState("recording");
    });
  }, []);

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
        await audioEngine.startAudioRecording(armedChannelId, countInBars * beatsPerBar, cursorSeconds, showRecording);
        track("recording_started", { kind: "audio" });
        refreshInputDevices();
      } catch (error) {
        noteIssue("record.audio", error, { report: false });
        recordingChannelRef.current = null;
        setRecordingChannelId(null);
        setMicError(
          "Couldn't access the microphone - check the browser's permission prompt or site settings."
        );
      }
      return;
    }
    track("recording_started", { kind: "midi" });
    await audioEngine.startRecording(armedChannelId, countInBars * beatsPerBar, cursorSeconds, showRecording);
  }, [transportState, armedChannelId, handleStop, channelTypeOf, countInBars, beatsPerBar, refreshInputDevices, cursorSeconds, showRecording]);

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
      try {
        const notes = await parseMidiFile(file, bpm);
        const lastEnd = notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0);
        addMidiClip(channelId, endOfContent(channelId), roundUpToBar(lastEnd, bpm, beatsPerBar), notes);
        setImportError(null);
      } catch (error) {
        noteIssue("import.midi", error, { report: false });
        setImportError(`Couldn't import "${file.name}" — not a readable MIDI file.`);
      }
    },
    [bpm, beatsPerBar, endOfContent, addMidiClip]
  );

  /** Imports an audio file onto a track, snapped to the nearest bar - from
   * the file picker or a drop. A file that can't be read as audio (likelier
   * from a drop, which has no file-type filter) is said so in the header
   * status line. */
  const handleImportAudioAt = useCallback(
    async (channelId: string, file: File, atSeconds: number) => {
      try {
        const decoded = await decodeAudioFile(file);
        const bar = secondsPerBar(bpm, beatsPerBar);
        const anchor = Math.max(0, Math.round(atSeconds / bar) * bar);
        addAudioClip(channelId, decoded, anchor, file.name, file);
        setImportError(null);
      } catch (error) {
        noteIssue("import.audio", error, { report: false });
        setImportError(`Couldn't import "${file.name}" — not a readable audio file.`);
      }
    },
    [bpm, beatsPerBar, addAudioClip]
  );
  const handleDropAudioFile = handleImportAudioAt;

  const handleImportAudioAppend = useCallback(
    (channelId: string, file: File) => handleImportAudioAt(channelId, file, endOfContent(channelId)),
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

  const handleRemoveBus = useCallback(
    (id: string) => {
      busActions.remove(id);
      if (fxBusId === id) setFxBusId(null);
    },
    [fxBusId]
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

  const handleAutomationPointsChange = trackActions.setAutomation;

  // The studio's keys (shortcuts.ts). The piano roll, dialogs and the note
  // keys sit above them: while the note keys play a MIDI track, R is a note
  // and Shift+R records.
  const nudgeLoopWith = (e: KeyboardEvent) => {
    if (!loopSelected) return false;
    // Arrows move the loop (up/down by its length, left/right by the grid);
    // Ctrl/Cmd+left/right shorten or lengthen it - Ableton's keys.
    const unit = secondsToBeats(snapUnitFor(bpm, pxPerSecond, beatsPerBar), bpm);
    const next = nudgeLoop(loop, e.key, unit, e.ctrlKey || e.metaKey);
    if (next) setLoop(next);
  };
  useShortcuts("studio", [
    { keys: "space", label: "Play / pause", run: () => handleTogglePlay() },
    { keys: ["r", "shift+r"], label: "Record", run: () => void handleRecord() },
    { keys: "mod+z", label: "Undo", run: () => undo() },
    { keys: ["mod+shift+z", "mod+y"], label: "Redo", run: () => redo() },
    { keys: "mod+c", label: "Copy the clip under the playhead", run: () => handleCopyAtPlayhead() },
    { keys: "mod+v", label: "Paste the copied clip at the playhead", run: () => handlePasteClip() },
    {
      keys: "mod+d",
      label: "Duplicate the selected clips",
      run: () => {
        if (selectedClipIds.size === 0) return false;
        handleDuplicateSelectedClips();
      },
    },
    {
      keys: "delete",
      label: "Delete the selected clips",
      run: () => {
        if (selectedClipIds.size === 0) return false;
        handleDeleteSelectedClips();
      },
    },
    {
      keys: "mod+l",
      label: "Loop the selected clips, or switch the loop on/off",
      run: () => {
        const ranges = Object.values(clipsByChannel)
          .flat()
          .filter((c) => selectedClipIds.has(c.id))
          .map((c) => ({ start: secondsToBeats(c.offset, bpm), end: secondsToBeats(c.offset + c.length, bpm) }));
        const around = loopAround(ranges);
        if (around) {
          setLoop({ on: true, ...around });
          setLoopSelected(true);
        } else toggleLoop();
      },
    },
    {
      keys: ["arrowup", "arrowdown", "arrowleft", "arrowright", "mod+arrowleft", "mod+arrowright"],
      label: "Move the selected loop brace (Ctrl/Cmd: resize it)",
      run: nudgeLoopWith,
    },
    {
      keys: "mod+g",
      label: "Group the picked tracks, or the selected one",
      run: () => handleGroupTracks(trackPicks.size > 0 ? [...trackPicks] : selectedChannelId ? [selectedChannelId] : []),
    },
    {
      keys: "escape",
      label: "Forget the tracks picked for grouping",
      run: () => {
        if (trackPicks.size === 0) return false;
        setTrackPicks(new Set());
      },
    },
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

  // Built when a menu opens (what's under the playhead, what's copied).
  const contextMenuList = useMemo(
    () =>
      contextMenu
        ? contextMenuItems(
            contextMenu,
            { channels, clipsOf, selectedClips: selectedClipIds.size, trackPicks },
            {
              editClip: handleEditClip,
              copyClip: handleCopyClip,
              pasteOver: pasteReplaceClip,
              exportClipMidi: handleExportClipMidi,
              splitAtPlayhead: handleSplitClipAtPlayhead,
              toggleLoop: handleToggleLoopClip,
              duplicateSelected: handleDuplicateSelectedClips,
              deleteSelected: handleDeleteSelectedClips,
              addEmptyClip: handleAddEmptyClipAt,
              importAudio: triggerAudioImport,
              pasteAt: handlePasteClipAtBar,
              groupTracks: handleGroupTracks,
              setTrackGroup: handleSetTrackGroup,
              toggleFold: handleToggleFold,
              removeTrack: handleRemoveChannel,
            }
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contextMenu, channels, clipsOf, selectedClipIds, trackPicks]
  );

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

  // --- The project's files: autosave, Save, Open (useProjectFiles.ts) ---

  /** A project was opened: its session settings, a fresh view, and the
   * engine rebuilt from it. */
  const applyOpened = useCallback((project: SerializedProject, state: ProjectState) => {
    setMasterLimiterThreshold(project.masterLimiterThreshold);
    setScaleSetting(project.scaleSetting);
    setSnapResolution(project.snapResolution);
    setCountInBars(project.countInBars);
    setMetronomeEnabled(project.metronomeEnabled);
    restoreMonitoring(project.monitoredTracks, state.channels);
    setLoop(project.loop);
    setSelectedClipIds(new Set());
    setEditingClip(null);
    setExpandedEffectId(null);
    setFxBusId(null);
    setFxMasterOpen(false);
    setFxChannelId(state.channels[0]?.id ?? null);
    if (state.channels[0]) setSelectedChannelId(state.channels[0].id);
    hydrateEngine(state, registeredChannelIds.current, audioEngine);
  }, [restoreMonitoring]);
  const {
    isLoading: isLoadingProject,
    saveStatus,
    name: projectName,
    folderName: projectFolderName,
    dirty,
    busy: projectBusy,
    notice: projectNotice,
    flashNotice: flashProjectNotice,
    saveAsRequest,
    save: handleSave,
    saveAs: handleSaveAs,
    downloadFile: downloadProjectFile,
    confirmDiscard,
    open: handleOpenProject,
    openRecent: handleOpenRecent,
    importFile: handleImportProjectFile,
    loadDemo: handleLoadDemo,
    startNew,
  } = useProjectFiles(
    { masterLimiterThreshold, scaleSetting, snapResolution, countInBars, metronomeEnabled, loop, monitoredTracks },
    {
      beforeOpen: () => {
        audioEngine.stopAll();
        setTransportState("stopped");
      },
      opened: applyOpened,
      started: ({ firstVisit, newVersion }) => {
        // A first visit gets the start screen; someone back after an
        // update sees what's new, once.
        if (firstVisit) {
          welcomeRef.current = true;
          setStartScreen("welcome");
        }
        if (newVersion) setAboutTab("news");
      },
    }
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
      startNew(template.build(), template.id === "empty" ? "Untitled" : template.name);
      setCursorSeconds(0);
      closeStartScreen();
      track("template_chosen", { template: template.id });
    },
    [startNew, closeStartScreen]
  );

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
      <RecoveryNotice />
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

      <MasterBusRow
        limiterThreshold={masterLimiterThreshold}
        onLimiterThresholdChange={setMasterLimiterThreshold}
        onOpenMasterFx={openMasterFx}
        onOpenBusFx={openBusFx}
        onRemoveBus={handleRemoveBus}
      />

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
          items={contextMenuList}
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
