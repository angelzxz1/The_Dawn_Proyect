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
  ChevronDown,
  ChevronUp,
  Clipboard,
  Copy,
  CopyPlus,
  Download,
  FileAudio,
  FilePlus2,
  Loader2,
  Pencil,
  Redo2,
  Repeat,
  Scissors,
  Sliders,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { TrackHeader } from "./TrackHeader";
import { TrackLane } from "./TrackLane";
import { ValueBar } from "./ValueBar";
import { Meter } from "./Meter";
import { TimelineRuler } from "./TimelineRuler";
import { Playhead } from "./Playhead";
import { TransportBar } from "./TransportBar";
import { PianoKeyboard } from "./PianoKeyboard";
import { DrumPads } from "./DrumPads";
import { ExpressionControls } from "./ExpressionControls";
import { PianoRollEditor } from "./PianoRollEditor";
import { ScaleSelector } from "./ScaleSelector";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { FxRack } from "./FxRack";
import { EffectBrowser } from "./EffectBrowser";
import { AutomationLane as AutomationLaneEditor } from "./AutomationLane";
import { audioEngine, bumpEffectIdCounter, type AudioClipTiming } from "@/lib/audioEngine";
import { defaultSynthParams } from "@/lib/synth";
import { downloadMidiFile, parseMidiFile } from "@/lib/midiFile";
import { midiToNoteName } from "@/lib/piano";
import { listenToWebMidi } from "@/lib/webMidi";
import { trackColorForIndex, MASTER_COLOR } from "@/lib/colors";
import { copyClip, getCopiedClip } from "@/lib/clipboard";
import { decodeAudioFile, type DecodedAudioClip } from "@/lib/audioFile";
import { hydrateEngine, notesWithinClip, type ProjectState } from "@/lib/project";
import { loadProject, saveProject, type SerializedClip } from "@/lib/persistence";
import { bounceProjectToWav, downloadWavBlob } from "@/lib/bounce";
import { EFFECT_LABELS, paramSpecs, type EffectInstance, type EffectType } from "@/lib/effects";
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
  TRACK_ROW_HEIGHT,
  quarterNotesPerBar,
  roundUpToBar,
  secondsPerBar,
  snapSecondsForResolution,
  type SnapResolution,
} from "@/lib/timeline";
import type {
  AudioClipInstance,
  AutomationLane,
  AutomationPoint,
  AutomationTarget,
  BusConfig,
  ChannelConfig,
  ChannelType,
  ClipInstance,
  InstrumentType,
  MidiClipInstance,
  NoteEvent,
  SynthParams,
  TimeSignature,
} from "@/lib/types";

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
    paramSpecs(fx.type).forEach((spec) => {
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

function isMidiClip(c: ClipInstance): c is MidiClipInstance {
  return c.kind === "midi";
}

function isAudioClip(c: ClipInstance): c is AudioClipInstance {
  return c.kind === "audio";
}

/** Builds the engine's timing options from an audio clip's own fields -
 * shared by every call site that (re)schedules an audio clip's player, so
 * they can't drift out of sync with each other. */
function audioClipTiming(clip: AudioClipInstance): AudioClipTiming {
  return {
    offsetSeconds: clip.offset,
    bufferOffsetSeconds: clip.sourceOffset,
    trimSeconds: clip.length,
    loopLength: clip.loopLength,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
  };
}

let channelCounter = 0;
function createChannel(name: string, type: ChannelType): ChannelConfig {
  channelCounter += 1;
  return {
    id: `ch-${channelCounter}`,
    name,
    volume: 0,
    pan: 0,
    colorIndex: channelCounter - 1,
    type,
    instrument: null,
    muted: false,
    solo: false,
    armed: false,
  };
}

/** After restoring ids from a saved project, makes sure the next
 * auto-generated id (`ch-N` / `clip-N`) can't collide with a restored one. */
function bumpCounterFromId(id: string, prefix: string): void {
  const match = id.match(new RegExp(`^${prefix}-(\\d+)$`));
  if (!match) return;
  const n = parseInt(match[1], 10);
  if (prefix === "ch") channelCounter = Math.max(channelCounter, n);
  else if (prefix === "clip") clipIdCounter = Math.max(clipIdCounter, n);
}

let clipIdCounter = 0;
function newClipId(): string {
  clipIdCounter += 1;
  return `clip-${clipIdCounter}`;
}

let busCounter = 0;
function newBusId(): string {
  busCounter += 1;
  return `bus-${busCounter}`;
}

let automationLaneCounter = 0;
function newAutomationLaneId(): string {
  automationLaneCounter += 1;
  return `auto-${automationLaneCounter}`;
}

/** A stable string key for an automation target, so two targets can be
 * compared for equality (e.g. "does this channel already have a lane for
 * Pan?") without a deep-equal check. */
function automationTargetKey(target: AutomationTarget): string {
  return target.kind === "effect" ? `effect:${target.effectId}:${target.paramKey}` : target.kind;
}

export function Daw() {
  const [channels, setChannels] = useState<ChannelConfig[]>(() => [
    createChannel("MIDI 1", "midi"),
    createChannel("MIDI 2", "midi"),
    createChannel("Audio 1", "audio"),
  ]);
  // Every track can hold any number of independent clips, each its own box
  // on the timeline - not a single clip slot per track.
  const [clipsByChannel, setClipsByChannel] = useState<Record<string, ClipInstance[]>>({});
  const [channelEffects, setChannelEffects] = useState<Record<string, EffectInstance[]>>({});
  const [buses, setBuses] = useState<BusConfig[]>([]);
  const [busEffects, setBusEffects] = useState<Record<string, EffectInstance[]>>({});
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
  const [micError, setMicError] = useState<string | null>(null);
  /** Set when a file dropped onto a track couldn't be read as audio (e.g.
   * the wrong file type) - drag-and-drop has no OS-level file-type filter
   * the way the "Import audio" picker's `accept="audio/*"` does. */
  const [importError, setImportError] = useState<string | null>(null);
  /** The browser's available audio input devices, and which one
   * recordings currently use (null = the browser's default). Refreshed on
   * mount and whenever the OS reports a device was plugged/unplugged. */
  const [inputDevices, setInputDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState<string | null>(null);
  /** Whether the currently record-armed audio track's input is monitored
   * live (heard through its volume/pan while armed) - a view/session-only
   * toggle, not part of the undo-tracked document. */
  const [inputMonitoringEnabled, setInputMonitoringEnabled] = useState(false);
  /** Which channel (if any) currently has its automation lane expanded
   * under its track in the arrangement - a view-only toggle, not part of
   * the undo-tracked document. */
  const [automationChannelId, setAutomationChannelId] = useState<string | null>(null);
  /** Whether the note-input panel (piano keyboard / drum pads) at the
   * bottom of the screen is collapsed - a view-only toggle. */
  const [instrumentPanelCollapsed, setInstrumentPanelCollapsed] = useState(false);
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
  const [bpm, setBpm] = useState(120);
  const [timeSignature, setTimeSignature] = useState<TimeSignature>({
    numerator: 4,
    denominator: 4,
  });
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
  const [masterName, setMasterName] = useState("Master");
  const [editingMasterName, setEditingMasterName] = useState(false);
  const [masterNameDraft, setMasterNameDraft] = useState("Master");
  const [masterVolume, setMasterVolume] = useState(0);
  const [masterPan, setMasterPan] = useState(0);
  const [masterLimiterThreshold, setMasterLimiterThreshold] = useState(-1);
  const [masterEffects, setMasterEffects] = useState<EffectInstance[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // --- Snap-to-grid, loop region, count-in ---
  const [snapResolution, setSnapResolution] = useState<SnapResolution>("bar");
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(0);
  const [countInBars, setCountInBars] = useState(0);

  // --- Undo/redo: a stack of full-project snapshots. Refs (not state) so
  // pushing doesn't itself trigger a re-render - `historyTick` is bumped
  // separately just to refresh the undo/redo buttons' enabled state. ---
  const historyPast = useRef<ProjectState[]>([]);
  const historyFuture = useRef<ProjectState[]>([]);
  // Bumped after every push/undo/redo purely to trigger a re-render so the
  // undo/redo buttons' disabled state (read from the refs above) refreshes.
  const [, setHistoryTick] = useState(0);

  // --- Save/load ---
  const audioBlobsRef = useRef(new Map<string, Blob>());
  const projectLoadedRef = useRef(false);
  const [isLoadingProject, setIsLoadingProject] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [isExporting, setIsExporting] = useState(false);
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

  const registeredChannelIds = useRef(new Set<string>());
  const registeredBusIds = useRef(new Set<string>());

  // --- Undo/redo -------------------------------------------------------
  // A snapshot covers the "document" - channels/clips/effects/tempo/master
  // - not transport or view state like the playhead, zoom, or selection,
  // matching what a DAW's undo stack usually covers. `liveProjectRef` is
  // refreshed every render so `pushHistory` (called from inside other
  // handlers, some with narrower dependency arrays) always snapshots the
  // truly current state rather than a stale closure.
  const liveProjectRef = useRef<ProjectState>({
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
    masterEffects,
  });
  liveProjectRef.current = {
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
    masterEffects,
  };

  const MAX_HISTORY = 100;

  /** Releases an audio clip's blob/object-URL for good - only safe to call
   * once nothing in the live document or the undo/redo stacks can still
   * reference it (see `pushHistory` below). Deleting a clip must NOT call
   * this directly: undo has to bring the actual audio back, not just the
   * clip's visual box, so the blob has to outlive the delete until the
   * snapshot that could restore it is itself gone for good. */
  const releaseOrphanedAudioBlobs = useCallback((discarded: ProjectState[]) => {
    if (discarded.length === 0) return;
    const reachable = new Set<string>();
    const collectReachable = (s: ProjectState) =>
      Object.values(s.clipsByChannel).forEach((clips) =>
        clips.forEach((c) => {
          if (c.kind === "audio") reachable.add(c.id);
        })
      );
    collectReachable(liveProjectRef.current);
    historyPast.current.forEach(collectReachable);
    historyFuture.current.forEach(collectReachable);
    discarded.forEach((s) =>
      Object.values(s.clipsByChannel).forEach((clips) =>
        clips.forEach((c) => {
          if (c.kind === "audio" && !reachable.has(c.id)) {
            URL.revokeObjectURL(c.url);
            audioBlobsRef.current.delete(c.id);
          }
        })
      )
    );
  }, []);

  /** Pushes the CURRENT (pre-mutation) state onto the undo stack - call at
   * the very top of a handler, before any setState, or right as a drag
   * gesture starts, so the captured snapshot is genuinely "before". */
  const pushHistory = useCallback(() => {
    historyPast.current.push(liveProjectRef.current);
    const evicted: ProjectState[] =
      historyPast.current.length > MAX_HISTORY ? [historyPast.current.shift()!] : [];
    const discardedFuture = historyFuture.current;
    historyFuture.current = [];
    releaseOrphanedAudioBlobs([...evicted, ...discardedFuture]);
    setHistoryTick((t) => t + 1);
  }, [releaseOrphanedAudioBlobs]);

  const applySnapshot = useCallback((s: ProjectState) => {
    setChannels(s.channels);
    setClipsByChannel(s.clipsByChannel);
    setChannelEffects(s.channelEffects);
    setBuses(s.buses);
    setBusEffects(s.busEffects);
    setBpm(s.bpm);
    setTimeSignature(s.timeSignature);
    setMasterVolume(s.masterVolume);
    setMasterPan(s.masterPan);
    setMasterName(s.masterName);
    setMasterEffects(s.masterEffects);
    setSelectedClipIds(new Set());
    setEditingClip(null);
    hydrateEngine(s, registeredChannelIds.current);
  }, []);

  const undo = useCallback(() => {
    if (historyPast.current.length === 0) return;
    const prev = historyPast.current.pop()!;
    historyFuture.current.push(liveProjectRef.current);
    applySnapshot(prev);
    setHistoryTick((t) => t + 1);
  }, [applySnapshot]);

  const redo = useCallback(() => {
    if (historyFuture.current.length === 0) return;
    const next = historyFuture.current.pop()!;
    historyPast.current.push(liveProjectRef.current);
    applySnapshot(next);
    setHistoryTick((t) => t + 1);
  }, [applySnapshot]);

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

  /** Rebuilds a MIDI channel's single merged Tone.Part from every one of
   * its clips' notes (each shifted by that clip's own offset) - the engine
   * doesn't need to know about "clips", just the flattened absolute-time
   * note list. Called after any add/remove/move/edit of a MIDI clip. */
  const rebuildMidiPart = useCallback((channelId: string, midiClips: MidiClipInstance[]) => {
    const flattened: NoteEvent[] = midiClips.flatMap((c) =>
      notesWithinClip(c).map((n) => ({ ...n, time: c.offset + n.time }))
    );
    audioEngine.setClip(channelId, flattened, 0);
  }, []);

  const addMidiClip = useCallback(
    (
      channelId: string,
      offset: number,
      length: number,
      notes: NoteEvent[] = [],
      loopLength: number | null = null
    ): string => {
      pushHistory();
      const clip: MidiClipInstance = { id: newClipId(), kind: "midi", offset, length, notes, loopLength };
      const updated = [...clipsOf(channelId), clip];
      setClipsByChannel((prev) => ({ ...prev, [channelId]: updated }));
      rebuildMidiPart(channelId, updated.filter(isMidiClip));
      return clip.id;
    },
    [clipsOf, rebuildMidiPart, pushHistory]
  );

  /** `sourceBlob` is the clip's original file bytes (an imported File, a mic
   * recording's Blob, or a re-fetched copy of another clip's audio when
   * pasting) - kept around (keyed by clip id) purely so autosave can persist
   * the clip's actual audio, not just its decoded object URL which won't
   * survive a reload. */
  const addAudioClip = useCallback(
    (
      channelId: string,
      decoded: DecodedAudioClip,
      offset: number,
      fileName: string,
      sourceBlob: Blob,
      extra?: Partial<
        Pick<AudioClipInstance, "length" | "sourceOffset" | "fadeIn" | "fadeOut" | "gainDb" | "loopLength">
      >
    ): string => {
      pushHistory();
      const clip: AudioClipInstance = {
        id: newClipId(),
        kind: "audio",
        offset,
        length: extra?.length ?? decoded.durationSeconds,
        url: decoded.url,
        fileName,
        durationSeconds: decoded.durationSeconds,
        peaks: decoded.peaks,
        sourceOffset: extra?.sourceOffset ?? 0,
        fadeIn: extra?.fadeIn ?? 0,
        fadeOut: extra?.fadeOut ?? 0,
        gainDb: extra?.gainDb ?? 0,
        loopLength: extra?.loopLength ?? null,
      };
      audioBlobsRef.current.set(clip.id, sourceBlob);
      setClipsByChannel((prev) => ({ ...prev, [channelId]: [...clipsOf(channelId), clip] }));
      audioEngine.loadAudioClip(channelId, clip.id, decoded.url, audioClipTiming(clip), clip.gainDb);
      return clip.id;
    },
    [clipsOf, pushHistory]
  );

  /** Deletes every currently-selected clip, across however many tracks
   * they're on, as a single undo step. A right-click's "Delete clip" menu
   * item and the Delete/Backspace shortcut both route through this - by
   * the time either fires, the right-clicked/only clip is guaranteed to be
   * part of the selection (see openClipMenu). */
  const handleDeleteSelectedClips = useCallback(() => {
    if (selectedClipIds.size === 0) return;
    pushHistory();
    const next: Record<string, ClipInstance[]> = { ...clipsByChannel };
    Object.entries(clipsByChannel).forEach(([chId, clips]) => {
      const toDelete = clips.filter((c) => selectedClipIds.has(c.id));
      if (toDelete.length === 0) return;
      toDelete.forEach((c) => {
        if (c.kind === "audio") {
          // The clip's blob/object-URL stays alive - it's still referenced
          // by the snapshot pushHistory() just captured, so undo can bring
          // the actual audio back, not just the clip's visual box. It's
          // released later, once that snapshot itself ages out of history.
          audioEngine.removeAudioClip(chId, c.id);
        }
      });
      const remaining = clips.filter((c) => !selectedClipIds.has(c.id));
      next[chId] = remaining;
      if (channelTypeOf(chId) === "midi") {
        rebuildMidiPart(chId, remaining.filter(isMidiClip));
      }
    });
    setClipsByChannel(next);
    setSelectedClipIds(new Set());
  }, [selectedClipIds, clipsByChannel, channelTypeOf, rebuildMidiPart, pushHistory]);

  /** Duplicates every selected clip, each placed right after itself on its
   * own track, and selects the new copies. */
  const handleDuplicateSelectedClips = useCallback(() => {
    if (selectedClipIds.size === 0) return;
    pushHistory();
    const next: Record<string, ClipInstance[]> = { ...clipsByChannel };
    const newlySelected = new Set<string>();
    Object.entries(clipsByChannel).forEach(([chId, clips]) => {
      const toDuplicate = clips.filter((c) => selectedClipIds.has(c.id));
      if (toDuplicate.length === 0) return;
      const additions: ClipInstance[] = toDuplicate.map((c) => {
        const id = newClipId();
        const dupOffset = c.offset + c.length;
        newlySelected.add(id);
        if (c.kind === "audio") {
          const dup: AudioClipInstance = { ...c, id, offset: dupOffset };
          const blob = audioBlobsRef.current.get(c.id);
          if (blob) audioBlobsRef.current.set(id, blob);
          audioEngine.loadAudioClip(chId, id, dup.url, audioClipTiming(dup), dup.gainDb);
          return dup;
        }
        const dup: MidiClipInstance = { ...c, id, offset: dupOffset, notes: c.notes.map((n) => ({ ...n })) };
        return dup;
      });
      next[chId] = [...clips, ...additions];
      if (channelTypeOf(chId) === "midi") {
        rebuildMidiPart(chId, next[chId].filter(isMidiClip));
      }
    });
    setClipsByChannel(next);
    setSelectedClipIds(newlySelected);
  }, [selectedClipIds, clipsByChannel, channelTypeOf, rebuildMidiPart, pushHistory]);

  /** Splits one clip into two at the current playhead position - only
   * meaningful (and only enabled in the context menu) when the playhead
   * sits strictly inside the clip. */
  const handleSplitClipAtPlayhead = useCallback(
    (channelId: string, clipId: string) => {
      const clip = clipsOf(channelId).find((c) => c.id === clipId);
      if (!clip) return;
      const splitAt = audioEngine.getTransportSeconds() - clip.offset;
      if (splitAt <= 0 || splitAt >= clip.length) return;
      pushHistory();
      const firstId = newClipId();
      const secondId = newClipId();
      let first: ClipInstance;
      let second: ClipInstance;
      if (clip.kind === "audio") {
        // A split falls in the interior, so the outgoing fade of the first
        // half and the incoming fade of the second half no longer make
        // sense at what's now a hard edge - only the original clip's own
        // outer fades (fade-in on the first half, fade-out on the second)
        // carry over. Looping doesn't carry across a split either.
        const firstAudio: AudioClipInstance = {
          ...clip,
          id: firstId,
          length: splitAt,
          fadeOut: 0,
          loopLength: null,
        };
        const secondAudio: AudioClipInstance = {
          ...clip,
          id: secondId,
          offset: clip.offset + splitAt,
          length: clip.length - splitAt,
          sourceOffset: clip.sourceOffset + splitAt,
          fadeIn: 0,
          loopLength: null,
        };
        const blob = audioBlobsRef.current.get(clip.id);
        if (blob) {
          audioBlobsRef.current.set(firstId, blob);
          audioBlobsRef.current.set(secondId, blob);
        }
        audioEngine.loadAudioClip(channelId, firstId, clip.url, audioClipTiming(firstAudio), firstAudio.gainDb);
        audioEngine.loadAudioClip(channelId, secondId, clip.url, audioClipTiming(secondAudio), secondAudio.gainDb);
        first = firstAudio;
        second = secondAudio;
      } else {
        const firstNotes = clip.notes
          .filter((n) => n.time < splitAt)
          .map((n) => ({ ...n, duration: Math.min(n.duration, splitAt - n.time) }));
        const secondNotes = clip.notes
          .filter((n) => n.time >= splitAt)
          .map((n) => ({ ...n, time: n.time - splitAt }));
        first = { ...clip, id: firstId, length: splitAt, notes: firstNotes, loopLength: null };
        second = {
          ...clip,
          id: secondId,
          offset: clip.offset + splitAt,
          length: clip.length - splitAt,
          notes: secondNotes,
          loopLength: null,
        };
      }
      const updated = clipsOf(channelId).filter((c) => c.id !== clipId).concat([first, second]);
      setClipsByChannel((prev) => ({ ...prev, [channelId]: updated }));
      if (clip.kind === "audio") {
        audioEngine.removeAudioClip(channelId, clipId);
        audioBlobsRef.current.delete(clip.id);
      } else {
        rebuildMidiPart(channelId, updated.filter(isMidiClip));
      }
      setSelectedClipIds(new Set([firstId, secondId]));
    },
    [clipsOf, rebuildMidiPart, pushHistory]
  );

  /** Toggles looping for one clip. Turning it on snapshots the clip's
   * CURRENT length as the repeat unit - nothing audibly changes until you
   * then drag the clip's right edge out past that length, at which point
   * the content tiles to fill the extra space instead of trailing into
   * silence. */
  const handleToggleLoopClip = useCallback(
    (channelId: string, clipId: string) => {
      const clip = clipsOf(channelId).find((c) => c.id === clipId);
      if (!clip) return;
      pushHistory();
      const newLoopLength = clip.loopLength ? null : clip.length;
      const updated = clipsOf(channelId).map((c) =>
        c.id === clipId ? { ...c, loopLength: newLoopLength } : c
      );
      setClipsByChannel((prev) => ({ ...prev, [channelId]: updated }));
      const updatedClip = updated.find((c) => c.id === clipId)!;
      if (updatedClip.kind === "midi") {
        rebuildMidiPart(channelId, updated.filter(isMidiClip));
      } else {
        audioEngine.moveAudioClip(channelId, clipId, audioClipTiming(updatedClip));
      }
    },
    [clipsOf, rebuildMidiPart, pushHistory]
  );

  /** Empties a whole track - every clip on it, gone. */
  const handleClearTrack = useCallback(
    (channelId: string) => {
      const existing = clipsOf(channelId);
      if (existing.length === 0) return;
      pushHistory();
      // No blob/URL cleanup here - the snapshot pushHistory() just captured
      // still references these clips, so undo can restore their audio, not
      // just the clip boxes. It's released once that snapshot ages out.
      setClipsByChannel((prev) => ({ ...prev, [channelId]: [] }));
      setSelectedClipIds((prev) => {
        const next = new Set(prev);
        existing.forEach((c) => next.delete(c.id));
        return next;
      });
      if (channelTypeOf(channelId) === "audio") audioEngine.clearAllAudioClips(channelId);
      else audioEngine.setClip(channelId, [], 0);
    },
    [clipsOf, channelTypeOf, pushHistory]
  );

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
  useEffect(() => {
    const suppressFileDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
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
        audioEngine.addChannel(c.id, c.type, c.instrument, c.synthParams);
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
    audioEngine.setLoop(loopEnabled, loopStart, loopEnd);
  }, [loopEnabled, loopStart, loopEnd]);

  // Notes (computer keyboard, the on-screen piano/pads, or a MIDI
  // controller) only reach the armed channel - merely clicking a track to
  // select it never makes it sound.
  const handleNoteOn = useCallback(
    async (note: string, velocity: number) => {
      if (!armedChannelId) return;
      await audioEngine.ensureStarted();
      audioEngine.noteOn(armedChannelId, note, velocity);
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

  // Live input monitoring follows whichever audio channel is currently
  // armed - opens a monitor tap on it while enabled, and tears it back
  // down (on disarm, a device change already handles reopening itself, or
  // toggling monitoring off) so a stale tap never outlives its channel.
  useEffect(() => {
    if (!armedChannelId || channelTypeOf(armedChannelId) !== "audio" || !inputMonitoringEnabled) {
      return;
    }
    const channelId = armedChannelId;
    void audioEngine.setInputMonitoring(channelId, true);
    return () => {
      void audioEngine.setInputMonitoring(channelId, false);
    };
  }, [armedChannelId, inputMonitoringEnabled, channelTypeOf]);

  // Which channel a recording-in-progress targets - captured once at
  // Record time (not read live from `armedChannelId`) so re-arming a
  // different track mid-take (blocked by the UI, but not by anything else)
  // can never redirect where Stop files the result.
  const recordingChannelRef = useRef<string | null>(null);

  const handleStop = useCallback(async () => {
    if (transportState === "recording") {
      const recChannelId = recordingChannelRef.current;
      recordingChannelRef.current = null;
      if (recChannelId) {
        if (channelTypeOf(recChannelId) === "audio") {
          const blob = await audioEngine.finishAudioRecording();
          if (blob && blob.size > 0) {
            const decoded = await decodeAudioFile(blob);
            const channelName = channels.find((c) => c.id === recChannelId)?.name ?? "take";
            addAudioClip(recChannelId, decoded, 0, `${channelName} recording`, blob);
          }
        } else {
          const events = audioEngine.finishRecording();
          if (events.length > 0) {
            const lastEnd = events.reduce(
              (m, n) => Math.max(m, n.time + n.duration),
              0
            );
            addMidiClip(recChannelId, 0, roundUpToBar(lastEnd, bpm, beatsPerBar), events);
          }
        }
      }
    }
    setTransportState("stopped");
    audioEngine.stopAll();
    audioEngine.seekTo(cursorSeconds);
    setActiveNotes(new Set());
  }, [transportState, bpm, beatsPerBar, channelTypeOf, channels, addAudioClip, addMidiClip, cursorSeconds]);

  // Play always starts from the marker (the last point you clicked on the
  // ruler) - pausing doesn't change where the next Play picks up from, it
  // always snaps back to that marker, the same spot Stop rewinds to.
  const handlePlay = useCallback(async () => {
    if (transportState === "recording") return;
    audioEngine.seekTo(cursorSeconds);
    await audioEngine.startPlayback();
    setTransportState("playing");
  }, [transportState, cursorSeconds]);

  const handlePause = useCallback(() => {
    if (transportState !== "playing") return;
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
    if (channelTypeOf(armedChannelId) === "audio") {
      try {
        await audioEngine.startAudioRecording(armedChannelId, countInBars * beatsPerBar);
        setMicError(null);
        setTransportState("recording");
        refreshInputDevices();
      } catch {
        recordingChannelRef.current = null;
        setMicError(
          "Couldn't access the microphone - check the browser's permission prompt or site settings."
        );
      }
      return;
    }
    setTransportState("recording");
    await audioEngine.startRecording(armedChannelId, countInBars * beatsPerBar);
  }, [transportState, armedChannelId, handleStop, channelTypeOf, countInBars, beatsPerBar, refreshInputDevices]);

  const handleAddChannel = useCallback(
    (type: ChannelType) => {
      pushHistory();
      setChannels((prev) => {
        const countOfType = prev.filter((c) => c.type === type).length;
        const name = type === "midi" ? `MIDI ${countOfType + 1}` : `Audio ${countOfType + 1}`;
        return [...prev, createChannel(name, type)];
      });
    },
    [pushHistory]
  );

  const handleRemoveChannel = useCallback(
    (id: string) => {
      pushHistory();
      setChannels((prev) => prev.filter((c) => c.id !== id));
      setClipsByChannel((prev) => {
        // No blob/URL cleanup here - the snapshot pushHistory() just
        // captured still references these clips, so undoing the channel
        // removal can restore their audio, not just the clip boxes. It's
        // released once that snapshot ages out of history.
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setChannelEffects((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (fxChannelId === id) {
        const fallback = channels.find((c) => c.id !== id);
        setFxChannelId(fallback?.id ?? null);
      }
      if (selectedChannelId === id) {
        const fallback = channels.find((c) => c.id !== id);
        if (fallback) setSelectedChannelId(fallback.id);
      }
      if (editingClip?.channelId === id) setEditingClip(null);
      const removedClipIds = new Set((clipsByChannel[id] ?? []).map((c) => c.id));
      setSelectedClipIds((prev) => {
        if (![...prev].some((cid) => removedClipIds.has(cid))) return prev;
        const next = new Set(prev);
        removedClipIds.forEach((cid) => next.delete(cid));
        return next;
      });
    },
    [selectedChannelId, channels, clipsByChannel, editingClip, fxChannelId, pushHistory]
  );

  const handleVolumeChange = useCallback((id: string, db: number) => {
    audioEngine.setVolume(id, db);
    setChannels((prev) =>
      prev.map((c) => (c.id === id ? { ...c, volume: db } : c))
    );
  }, []);

  const handlePanChange = useCallback((id: string, pan: number) => {
    audioEngine.setPan(id, pan);
    setChannels((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pan } : c))
    );
  }, []);

  const handleMuteToggle = useCallback(
    (id: string) => {
      pushHistory();
      setChannels((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          const muted = !c.muted;
          audioEngine.setMute(id, muted);
          return { ...c, muted };
        })
      );
    },
    [pushHistory]
  );

  const handleSoloToggle = useCallback(
    (id: string) => {
      pushHistory();
      setChannels((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          const solo = !c.solo;
          audioEngine.setSolo(id, solo);
          return { ...c, solo };
        })
      );
    },
    [pushHistory]
  );

  /** Exclusive record-arm: arming a channel disarms every other one. Also
   * selects it, so the copy/paste-at-playhead target and header highlight
   * naturally follow whichever track you just armed. Refuses to change
   * anything mid-recording, since the engine is already mid-take on
   * whichever channel was armed when Record was pressed. */
  const handleArmToggle = useCallback(
    (id: string) => {
      if (transportState === "recording") return;
      pushHistory();
      setChannels((prev) => prev.map((c) => ({ ...c, armed: c.id === id ? !c.armed : false })));
      setSelectedChannelId(id);
      setSelectedClipIds(new Set());
    },
    [transportState, pushHistory]
  );

  const handleInstrumentChange = useCallback(
    (id: string, type: InstrumentType | null) => {
      const current = channels.find((c) => c.id === id);
      if (!current) return;
      pushHistory();
      // Picking "synth" for the first time seeds it with the first preset's
      // params so there's always something to hear and edit, not a bank of
      // zeros; switching away and back keeps whatever was last dialed in
      // instead of resetting it.
      const synthParams =
        type === "synth" ? current.synthParams ?? defaultSynthParams() : current.synthParams;
      audioEngine.setInstrument(id, type, synthParams);
      setChannels((prev) =>
        prev.map((c) => (c.id === id ? { ...c, instrument: type, synthParams } : c))
      );
    },
    [channels, pushHistory]
  );

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

  const handleEditorChange = useCallback(
    (channelId: string, clipId: string, notes: NoteEvent[]) => {
      const updated = clipsOf(channelId).map((c) =>
        c.id === clipId && c.kind === "midi" ? { ...c, notes } : c
      );
      setClipsByChannel((prev) => ({ ...prev, [channelId]: updated }));
      rebuildMidiPart(channelId, updated.filter(isMidiClip));
    },
    [clipsOf, rebuildMidiPart]
  );

  /** Moving a clip that's part of a multi-selection drags the whole group
   * together, applying the same offset delta to every selected clip across
   * however many tracks they're on. */
  const handleMoveClip = useCallback(
    (channelId: string, clipId: string, newOffset: number) => {
      const draggedBefore = clipsOf(channelId).find((c) => c.id === clipId);
      if (!draggedBefore) return;
      const isGroupMove = selectedClipIds.size > 1 && selectedClipIds.has(clipId);
      const delta = newOffset - draggedBefore.offset;
      const movedIds = isGroupMove ? selectedClipIds : new Set([clipId]);

      const nextByChannel: Record<string, ClipInstance[]> = { ...clipsByChannel };
      const touchedChannels = new Set<string>();
      Object.entries(clipsByChannel).forEach(([chId, clips]) => {
        if (!clips.some((c) => movedIds.has(c.id))) return;
        touchedChannels.add(chId);
        nextByChannel[chId] = clips.map((c) => {
          if (!movedIds.has(c.id)) return c;
          const offset = c.id === clipId ? newOffset : Math.max(0, c.offset + delta);
          return { ...c, offset };
        });
      });

      setClipsByChannel(nextByChannel);
      touchedChannels.forEach((chId) => {
        const clips = nextByChannel[chId];
        if (channelTypeOf(chId) === "midi") {
          rebuildMidiPart(chId, clips.filter(isMidiClip));
        } else {
          clips.forEach((c) => {
            if (movedIds.has(c.id) && c.kind === "audio") {
              audioEngine.moveAudioClip(chId, c.id, audioClipTiming(c));
            }
          });
        }
      });
    },
    [clipsOf, clipsByChannel, channelTypeOf, rebuildMidiPart, selectedClipIds]
  );

  const handleResizeClip = useCallback(
    (channelId: string, clipId: string, newLength: number) => {
      const updated = clipsOf(channelId).map((c) =>
        c.id === clipId ? { ...c, length: newLength } : c
      );
      setClipsByChannel((prev) => ({ ...prev, [channelId]: updated }));
      const clip = updated.find((c) => c.id === clipId);
      if (clip?.kind === "audio") {
        // An audio clip's length also trims playback.
        audioEngine.moveAudioClip(channelId, clipId, audioClipTiming(clip));
      } else {
        // A MIDI clip's box hides any note at/after `length` (ClipBlock's
        // own rendering already does this) - rebuild the engine's
        // scheduled part so a shortened clip actually stops sounding the
        // notes its new boundary now hides, instead of playing everything
        // it ever had regardless of the box you're looking at.
        rebuildMidiPart(channelId, updated.filter(isMidiClip));
      }
    },
    [clipsOf, rebuildMidiPart]
  );

  const handleFadeChange = useCallback(
    (channelId: string, clipId: string, fadeIn: number, fadeOut: number) => {
      const updated = clipsOf(channelId).map((c) =>
        c.id === clipId && c.kind === "audio" ? { ...c, fadeIn, fadeOut } : c
      );
      setClipsByChannel((prev) => ({ ...prev, [channelId]: updated }));
      const clip = updated.find((c) => c.id === clipId);
      if (clip?.kind === "audio") audioEngine.moveAudioClip(channelId, clipId, audioClipTiming(clip));
    },
    [clipsOf]
  );

  const handleGainChange = useCallback(
    (channelId: string, clipId: string, gainDb: number) => {
      const updated = clipsOf(channelId).map((c) =>
        c.id === clipId && c.kind === "audio" ? { ...c, gainDb } : c
      );
      setClipsByChannel((prev) => ({ ...prev, [channelId]: updated }));
      audioEngine.setAudioClipGain(channelId, clipId, gainDb);
    },
    [clipsOf]
  );

  const handleSeek = useCallback((seconds: number) => {
    audioEngine.seekTo(seconds);
    setCursorSeconds(seconds);
  }, []);

  const handleRenameChannel = useCallback(
    (id: string, name: string) => {
      pushHistory();
      setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
    },
    [pushHistory]
  );

  /** Swaps a channel one slot earlier (-1) or later (+1) in the track
   * order - a channel keeps its own color when it moves, since color is
   * tied to the channel itself, not its position. */
  const handleReorderChannel = useCallback(
    (id: string, direction: -1 | 1) => {
      pushHistory();
      setChannels((prev) => {
        const idx = prev.findIndex((c) => c.id === id);
        const target = idx + direction;
        if (idx === -1 || target < 0 || target >= prev.length) return prev;
        const next = [...prev];
        [next[idx], next[target]] = [next[target], next[idx]];
        return next;
      });
    },
    [pushHistory]
  );

  const handleRecolorChannel = useCallback(
    (id: string, colorIndex: number) => {
      pushHistory();
      setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, colorIndex } : c)));
    },
    [pushHistory]
  );

  /** Copies one clip instance's content into the shared clipboard. */
  const copyClipInstance = useCallback((clip: ClipInstance) => {
    if (clip.kind === "audio") {
      copyClip({
        kind: "audio",
        url: clip.url,
        fileName: clip.fileName,
        durationSeconds: clip.durationSeconds,
        peaks: clip.peaks,
        length: clip.length,
        sourceOffset: clip.sourceOffset,
        fadeIn: clip.fadeIn,
        fadeOut: clip.fadeOut,
        gainDb: clip.gainDb,
        loopLength: clip.loopLength,
      });
    } else {
      copyClip({ kind: "midi", notes: clip.notes, length: clip.length, loopLength: clip.loopLength });
    }
  }, []);

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

  /** Pastes the clipboard's clip as a brand-new clip at `anchor`, alongside
   * whatever else is already on the track. */
  const pasteClipAt = useCallback(
    async (channelId: string, anchor: number) => {
      const copied = getCopiedClip();
      if (!copied || copied.kind !== channelTypeOf(channelId)) return;
      const at = Math.max(0, anchor);
      if (copied.kind === "audio") {
        // Re-fetch the source clip's own object URL to get an independent
        // Blob for the pasted copy - needed so autosave can persist this
        // clip's audio too, not just its (shared) decoded preview.
        const blob = await fetch(copied.url).then((r) => r.blob());
        addAudioClip(
          channelId,
          { url: copied.url, durationSeconds: copied.durationSeconds, peaks: copied.peaks },
          at,
          copied.fileName,
          blob,
          {
            length: copied.length,
            sourceOffset: copied.sourceOffset,
            fadeIn: copied.fadeIn,
            fadeOut: copied.fadeOut,
            gainDb: copied.gainDb,
            loopLength: copied.loopLength,
          }
        );
      } else {
        addMidiClip(channelId, at, copied.length, copied.notes, copied.loopLength ?? null);
      }
    },
    [channelTypeOf, addAudioClip, addMidiClip]
  );

  /** Replaces one specific clip's content with the clipboard's clip,
   * keeping that clip's id and position. */
  const pasteReplaceClip = useCallback(
    async (channelId: string, clipId: string) => {
      const copied = getCopiedClip();
      if (!copied || copied.kind !== channelTypeOf(channelId)) return;
      const existing = clipsOf(channelId);
      const target = existing.find((c) => c.id === clipId);
      if (!target) return;
      pushHistory();
      if (copied.kind === "audio") {
        const blob = await fetch(copied.url).then((r) => r.blob());
        audioBlobsRef.current.set(clipId, blob);
        const updatedClip: AudioClipInstance = {
          id: clipId,
          kind: "audio",
          offset: target.offset,
          length: copied.length,
          url: copied.url,
          fileName: copied.fileName,
          durationSeconds: copied.durationSeconds,
          peaks: copied.peaks,
          sourceOffset: copied.sourceOffset,
          fadeIn: copied.fadeIn,
          fadeOut: copied.fadeOut,
          gainDb: copied.gainDb,
          loopLength: copied.loopLength,
        };
        setClipsByChannel((prev) => ({
          ...prev,
          [channelId]: existing.map((c) => (c.id === clipId ? updatedClip : c)),
        }));
        audioEngine.loadAudioClip(channelId, clipId, copied.url, audioClipTiming(updatedClip), updatedClip.gainDb);
      } else {
        const updatedClip: MidiClipInstance = {
          id: clipId,
          kind: "midi",
          offset: target.offset,
          length: copied.length,
          notes: copied.notes,
          loopLength: copied.loopLength,
        };
        const updated = existing.map((c) => (c.id === clipId ? updatedClip : c));
        setClipsByChannel((prev) => ({ ...prev, [channelId]: updated }));
        rebuildMidiPart(channelId, updated.filter(isMidiClip));
      }
    },
    [channelTypeOf, clipsOf, rebuildMidiPart, pushHistory]
  );

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

  const handleAddEmptyClipAt = useCallback(
    (channelId: string, atSeconds: number) => {
      const bar = secondsPerBar(bpm, beatsPerBar);
      const anchor = Math.max(0, Math.round(atSeconds / bar) * bar);
      addMidiClip(channelId, anchor, bar, []);
    },
    [bpm, beatsPerBar, addMidiClip]
  );

  const openFx = useCallback((channelId: string) => {
    setFxChannelId(channelId);
    setFxBusId(null);
    setFxMasterOpen(false);
  }, []);

  const handleToggleAutomation = useCallback((channelId: string) => {
    setAutomationChannelId((prev) => (prev === channelId ? null : channelId));
    setAutomationTarget({ kind: "volume" });
  }, []);

  const handleAddEffect = useCallback(
    (type: EffectType, atIndex?: number) => {
      if (!fxChannelId) return;
      pushHistory();
      const created = audioEngine.addEffect(fxChannelId, type, undefined, atIndex);
      if (created) {
        setChannelEffects((prev) => {
          const list = [...(prev[fxChannelId] ?? [])];
          if (atIndex !== undefined && atIndex >= 0 && atIndex <= list.length) {
            list.splice(atIndex, 0, created);
          } else {
            list.push(created);
          }
          return { ...prev, [fxChannelId]: list };
        });
      }
    },
    [fxChannelId, pushHistory]
  );

  const handleRemoveEffect = useCallback(
    (effectId: string) => {
      if (!fxChannelId) return;
      pushHistory();
      audioEngine.removeEffect(fxChannelId, effectId);
      setChannelEffects((prev) => ({
        ...prev,
        [fxChannelId]: (prev[fxChannelId] ?? []).filter((e) => e.id !== effectId),
      }));
    },
    [fxChannelId, pushHistory]
  );

  /** Moves an existing effect to an absolute position in the chain - what
   * dragging a device card to a new slot in the FX rack calls. */
  const handleMoveEffect = useCallback(
    (effectId: string, toIndex: number) => {
      if (!fxChannelId) return;
      pushHistory();
      audioEngine.moveEffect(fxChannelId, effectId, toIndex);
      setChannelEffects((prev) => {
        const list = [...(prev[fxChannelId] ?? [])];
        const idx = list.findIndex((e) => e.id === effectId);
        if (idx === -1) return prev;
        const [entry] = list.splice(idx, 1);
        const clamped = Math.max(0, Math.min(list.length, toIndex));
        list.splice(clamped, 0, entry);
        return { ...prev, [fxChannelId]: list };
      });
    },
    [fxChannelId, pushHistory]
  );

  const handleEffectParamChange = useCallback(
    (effectId: string, key: string, value: number) => {
      if (!fxChannelId) return;
      audioEngine.setEffectParam(fxChannelId, effectId, key, value);
      setChannelEffects((prev) => ({
        ...prev,
        [fxChannelId]: (prev[fxChannelId] ?? []).map((e) =>
          e.id === effectId ? { ...e, params: { ...e.params, [key]: value } } : e
        ),
      }));
    },
    [fxChannelId]
  );

  const handleEffectBypassToggle = useCallback(
    (effectId: string) => {
      if (!fxChannelId) return;
      pushHistory();
      setChannelEffects((prev) => {
        const list = prev[fxChannelId] ?? [];
        const effect = list.find((e) => e.id === effectId);
        if (!effect) return prev;
        const bypass = !effect.bypass;
        audioEngine.setEffectBypass(fxChannelId, effectId, bypass);
        return {
          ...prev,
          [fxChannelId]: list.map((e) => (e.id === effectId ? { ...e, bypass } : e)),
        };
      });
    },
    [fxChannelId, pushHistory]
  );

  const handleSynthParamsChange = useCallback(
    (params: SynthParams) => {
      if (!fxChannelId) return;
      audioEngine.setSynthParams(fxChannelId, params);
      setChannels((prev) =>
        prev.map((c) => (c.id === fxChannelId ? { ...c, synthParams: params } : c))
      );
    },
    [fxChannelId]
  );

  const handleSendChange = useCallback(
    (busId: string, db: number | null) => {
      if (!fxChannelId) return;
      audioEngine.setSend(fxChannelId, busId, db);
      setChannels((prev) =>
        prev.map((c) => {
          if (c.id !== fxChannelId) return c;
          const sends = { ...(c.sends ?? {}) };
          if (db === null) delete sends[busId];
          else sends[busId] = db;
          return { ...c, sends };
        })
      );
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

  const handleBusAddEffect = useCallback(
    (type: EffectType, atIndex?: number) => {
      if (!fxBusId) return;
      pushHistory();
      const created = audioEngine.addEffect(fxBusId, type, undefined, atIndex);
      if (created) {
        setBusEffects((prev) => {
          const list = [...(prev[fxBusId] ?? [])];
          if (atIndex !== undefined && atIndex >= 0 && atIndex <= list.length) {
            list.splice(atIndex, 0, created);
          } else {
            list.push(created);
          }
          return { ...prev, [fxBusId]: list };
        });
      }
    },
    [fxBusId, pushHistory]
  );

  const handleBusRemoveEffect = useCallback(
    (effectId: string) => {
      if (!fxBusId) return;
      pushHistory();
      audioEngine.removeEffect(fxBusId, effectId);
      setBusEffects((prev) => ({
        ...prev,
        [fxBusId]: (prev[fxBusId] ?? []).filter((e) => e.id !== effectId),
      }));
    },
    [fxBusId, pushHistory]
  );

  const handleBusMoveEffect = useCallback(
    (effectId: string, toIndex: number) => {
      if (!fxBusId) return;
      pushHistory();
      audioEngine.moveEffect(fxBusId, effectId, toIndex);
      setBusEffects((prev) => {
        const list = [...(prev[fxBusId] ?? [])];
        const idx = list.findIndex((e) => e.id === effectId);
        if (idx === -1) return prev;
        const [entry] = list.splice(idx, 1);
        const clamped = Math.max(0, Math.min(list.length, toIndex));
        list.splice(clamped, 0, entry);
        return { ...prev, [fxBusId]: list };
      });
    },
    [fxBusId, pushHistory]
  );

  const handleBusEffectParamChange = useCallback(
    (effectId: string, key: string, value: number) => {
      if (!fxBusId) return;
      audioEngine.setEffectParam(fxBusId, effectId, key, value);
      setBusEffects((prev) => ({
        ...prev,
        [fxBusId]: (prev[fxBusId] ?? []).map((e) =>
          e.id === effectId ? { ...e, params: { ...e.params, [key]: value } } : e
        ),
      }));
    },
    [fxBusId]
  );

  const handleBusEffectBypassToggle = useCallback(
    (effectId: string) => {
      if (!fxBusId) return;
      pushHistory();
      setBusEffects((prev) => {
        const list = prev[fxBusId] ?? [];
        const effect = list.find((e) => e.id === effectId);
        if (!effect) return prev;
        const bypass = !effect.bypass;
        audioEngine.setEffectBypass(fxBusId, effectId, bypass);
        return {
          ...prev,
          [fxBusId]: list.map((e) => (e.id === effectId ? { ...e, bypass } : e)),
        };
      });
    },
    [fxBusId, pushHistory]
  );

  // --- Master bus effects chain ---

  const handleMasterAddEffect = useCallback(
    (type: EffectType, atIndex?: number) => {
      pushHistory();
      const created = audioEngine.addEffect("master", type, undefined, atIndex);
      if (created) {
        setMasterEffects((prev) => {
          const list = [...prev];
          if (atIndex !== undefined && atIndex >= 0 && atIndex <= list.length) {
            list.splice(atIndex, 0, created);
          } else {
            list.push(created);
          }
          return list;
        });
      }
    },
    [pushHistory]
  );

  const handleMasterRemoveEffect = useCallback(
    (effectId: string) => {
      pushHistory();
      audioEngine.removeEffect("master", effectId);
      setMasterEffects((prev) => prev.filter((e) => e.id !== effectId));
    },
    [pushHistory]
  );

  const handleMasterMoveEffect = useCallback(
    (effectId: string, toIndex: number) => {
      pushHistory();
      audioEngine.moveEffect("master", effectId, toIndex);
      setMasterEffects((prev) => {
        const list = [...prev];
        const idx = list.findIndex((e) => e.id === effectId);
        if (idx === -1) return prev;
        const [entry] = list.splice(idx, 1);
        const clamped = Math.max(0, Math.min(list.length, toIndex));
        list.splice(clamped, 0, entry);
        return list;
      });
    },
    [pushHistory]
  );

  const handleMasterEffectParamChange = useCallback((effectId: string, key: string, value: number) => {
    audioEngine.setEffectParam("master", effectId, key, value);
    setMasterEffects((prev) =>
      prev.map((e) => (e.id === effectId ? { ...e, params: { ...e.params, [key]: value } } : e))
    );
  }, []);

  const handleMasterEffectBypassToggle = useCallback(
    (effectId: string) => {
      pushHistory();
      setMasterEffects((prev) => {
        const effect = prev.find((e) => e.id === effectId);
        if (!effect) return prev;
        const bypass = !effect.bypass;
        audioEngine.setEffectBypass("master", effectId, bypass);
        return prev.map((e) => (e.id === effectId ? { ...e, bypass } : e));
      });
    },
    [pushHistory]
  );

  /** Adds an effect (from the EffectBrowser sidebar, dragged or clicked) to
   * whichever target - a track, a bus, or the master bus - the FX rack
   * currently shows. */
  const handleSidebarAddEffect = useCallback(
    (type: EffectType) => {
      if (fxMasterOpen) handleMasterAddEffect(type);
      else if (fxBusId) handleBusAddEffect(type);
      else handleAddEffect(type);
    },
    [fxMasterOpen, fxBusId, handleMasterAddEffect, handleBusAddEffect, handleAddEffect]
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
    const items: (ContextMenuItem | "separator")[] =
      channelTypeOf(id) === "midi"
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
    if (channels.length > 1) {
      items.push("separator", {
        label: "Remove track",
        icon: <X size={13} />,
        danger: true,
        onSelect: () => handleRemoveChannel(id),
      });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenu, channels.length, channelTypeOf, endOfContent]);

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
    [bpm, clipsByChannel, channels, rebuildMidiPart, pushHistory]
  );

  const handleTimeSignatureCommit = useCallback(
    (value: TimeSignature) => {
      pushHistory();
      setTimeSignature(value);
    },
    [pushHistory]
  );

  const handleExportWav = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      await audioEngine.ensureStarted();
      const contentEnd = channels.reduce((max, c) => Math.max(max, endOfContent(c.id)), 0);
      const blob = await bounceProjectToWav({
        channels,
        clipsByChannel,
        channelEffects,
        buses,
        busEffects,
        masterVolume,
        masterPan,
        masterLimiterThreshold,
        masterEffects,
        contentEndSeconds: contentEnd,
      });
      downloadWavBlob(blob, masterName);
    } finally {
      setIsExporting(false);
    }
  }, [
    isExporting,
    channels,
    endOfContent,
    clipsByChannel,
    channelEffects,
    buses,
    busEffects,
    masterVolume,
    masterPan,
    masterLimiterThreshold,
    masterEffects,
    masterName,
  ]);

  // --- Save/load: the whole project autosaves to IndexedDB a moment after
  // any change, and is restored on mount if a saved project exists. ---
  const persistNow = useCallback(async () => {
    setSaveStatus("saving");
    try {
      const serializedClips: Record<string, SerializedClip[]> = {};
      Object.entries(clipsByChannel).forEach(([chId, clips]) => {
        serializedClips[chId] = clips.map((c) =>
          c.kind === "audio"
            ? {
                id: c.id,
                kind: "audio" as const,
                offset: c.offset,
                length: c.length,
                fileName: c.fileName,
                durationSeconds: c.durationSeconds,
                peaks: c.peaks,
                sourceOffset: c.sourceOffset,
                fadeIn: c.fadeIn,
                fadeOut: c.fadeOut,
                gainDb: c.gainDb,
                loopLength: c.loopLength,
              }
            : {
                id: c.id,
                kind: "midi" as const,
                offset: c.offset,
                length: c.length,
                notes: c.notes,
                loopLength: c.loopLength,
              }
        );
      });
      await saveProject(
        {
          version: 1,
          savedAt: Date.now(),
          channels,
          clipsByChannel: serializedClips,
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
        },
        audioBlobsRef.current
      );
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }, [
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
  ]);

  // Restore a saved project on mount, before autosave is allowed to run (so
  // a fresh page load never overwrites a real saved project with the
  // starter 3-channel default before the load has even been tried).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await loadProject().catch(() => null);
      if (cancelled) return;
      if (result) {
        const { project, blobs } = result;
        const restoredClips: Record<string, ClipInstance[]> = {};
        let maxEffectN = 0;
        Object.entries(project.clipsByChannel).forEach(([chId, clips]) => {
          restoredClips[chId] = clips.map((c) => {
            bumpCounterFromId(c.id, "clip");
            if (c.kind === "audio") {
              const blob = blobs.get(c.id);
              const url = blob ? URL.createObjectURL(blob) : "";
              if (blob) audioBlobsRef.current.set(c.id, blob);
              const restored: AudioClipInstance = {
                id: c.id,
                kind: "audio",
                offset: c.offset,
                length: c.length,
                url,
                fileName: c.fileName,
                durationSeconds: c.durationSeconds,
                peaks: c.peaks,
                sourceOffset: c.sourceOffset,
                fadeIn: c.fadeIn,
                fadeOut: c.fadeOut,
                gainDb: c.gainDb,
                loopLength: c.loopLength,
              };
              return restored;
            }
            const restored: MidiClipInstance = {
              id: c.id,
              kind: "midi",
              offset: c.offset,
              length: c.length,
              notes: c.notes,
              loopLength: c.loopLength,
            };
            return restored;
          });
        });
        project.channels.forEach((c) => bumpCounterFromId(c.id, "ch"));
        const buses = project.buses ?? [];
        const busEffects = project.busEffects ?? {};
        const masterEffects = project.masterEffects ?? [];
        buses.forEach((b) => {
          const match = b.id.match(/^bus-(\d+)$/);
          if (match) busCounter = Math.max(busCounter, parseInt(match[1], 10));
        });
        project.channels.forEach((c) =>
          (c.automationLanes ?? []).forEach((lane) => {
            const match = lane.id.match(/^auto-(\d+)$/);
            if (match) automationLaneCounter = Math.max(automationLaneCounter, parseInt(match[1], 10));
          })
        );
        [
          ...Object.values(project.channelEffects).flat(),
          ...Object.values(busEffects).flat(),
          ...masterEffects,
        ].forEach((fx) => {
          const match = fx.id.match(/^fx-(\d+)$/);
          if (match) maxEffectN = Math.max(maxEffectN, parseInt(match[1], 10));
        });
        bumpEffectIdCounter(maxEffectN);

        setChannels(project.channels);
        setClipsByChannel(restoredClips);
        setChannelEffects(project.channelEffects);
        setBuses(buses);
        setBusEffects(busEffects);
        setBpm(project.bpm);
        setTimeSignature(project.timeSignature);
        setMasterVolume(project.masterVolume);
        setMasterPan(project.masterPan);
        setMasterName(project.masterName);
        setMasterLimiterThreshold(project.masterLimiterThreshold);
        setMasterEffects(masterEffects);
        setScaleSetting(project.scaleSetting);
        setSnapResolution(project.snapResolution);
        setCountInBars(project.countInBars);
        setMetronomeEnabled(project.metronomeEnabled);
        hydrateEngine(
          {
            channels: project.channels,
            clipsByChannel: restoredClips,
            channelEffects: project.channelEffects,
            buses,
            busEffects,
            bpm: project.bpm,
            timeSignature: project.timeSignature,
            masterVolume: project.masterVolume,
            masterPan: project.masterPan,
            masterName: project.masterName,
            masterEffects,
          },
          registeredChannelIds.current
        );
      }
      projectLoadedRef.current = true;
      setIsLoadingProject(false);
    })();
    return () => {
      cancelled = true;
    };
    // Runs once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced autosave - fires a moment after the document settles, not on
  // every keystroke/drag frame.
  useEffect(() => {
    if (!projectLoadedRef.current) return;
    const timer = setTimeout(() => {
      void persistNow();
    }, 1200);
    return () => clearTimeout(timer);
  }, [persistNow]);

  const selectedChannel = channels.find((c) => c.id === selectedChannelId);
  const editingChannel = channels.find((c) => c.id === editingClip?.channelId);
  const editingClipInstance = editingClip
    ? clipsOf(editingClip.channelId).find((c) => c.id === editingClip.clipId)
    : undefined;
  const fxChannel = channels.find((c) => c.id === fxChannelId);
  const fxBus = buses.find((b) => b.id === fxBusId);
  const lanesHeight =
    channels.length * TRACK_ROW_HEIGHT + (automationChannelId ? AUTOMATION_LANE_HEIGHT : 0);

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
      <EffectBrowser onAddEffect={handleSidebarAddEffect} />
      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3">
      <header className="flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-icon.png" alt="" className="h-6 w-6 rounded-md" />
          <h1 className="text-lg font-semibold tracking-tight">
            The Dawn Project
          </h1>
        </div>
        <p className={`text-xs ${micError || importError ? "text-record" : "text-muted"}`}>
          {micError
            ? micError
            : importError
              ? importError
              : samplesReady
                ? "double-click a clip to edit it in the piano roll · space to play/pause · ctrl/cmd+C/V to copy/paste the clip at the playhead"
                : "loading piano sounds…"}
        </p>
      </header>

      <div className="shrink-0">
        <TransportBar
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
          monitoringEnabled={inputMonitoringEnabled}
          onToggleMonitoring={() => setInputMonitoringEnabled((v) => !v)}
          loopEnabled={loopEnabled}
          onToggleLoop={() => setLoopEnabled((v) => !v)}
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
              disabled={historyPast.current.length === 0}
              title="Undo (Ctrl/Cmd+Z)"
              className="flex h-6 w-6 items-center justify-center rounded border border-border hover:bg-surface-raised disabled:opacity-30"
            >
              <Undo2 size={12} />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={historyFuture.current.length === 0}
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
            onClick={() => setLoopEnabled((v) => !v)}
            aria-pressed={loopEnabled}
            title="Loop the region set by shift-dragging the ruler"
            className={`flex h-6 items-center gap-1 rounded border px-1.5 ${
              loopEnabled
                ? "border-accent bg-accent/20 text-accent"
                : "border-border text-muted hover:bg-surface-raised"
            }`}
          >
            <Repeat size={12} />
            Loop
          </button>
          <button
            type="button"
            onClick={() => void handleExportWav()}
            disabled={isExporting}
            title="Bounce the whole project to a WAV file"
            className="flex h-6 items-center gap-1 rounded border border-border px-1.5 text-muted hover:bg-surface-raised disabled:opacity-40"
          >
            {isExporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            {isExporting ? "Bouncing…" : "Export WAV"}
          </button>
          <span className="text-muted/70">
            {saveStatus === "saving" ? "saving…" : saveStatus === "saved" ? "saved" : saveStatus === "error" ? "save failed" : ""}
          </span>
        </div>
        <ScaleSelector value={scaleSetting} onChange={setScaleSetting} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg border border-border">
        {/* Sticky ruler row - a direct child of the vertical scroller (not
            nested inside the horizontally-scrolling lanes column), so
            position: sticky actually has that scroller as its containing
            block instead of getting stuck relative to an inner element. */}
        <div className="sticky top-0 z-20 flex shrink-0 bg-surface">
          <div
            style={{ width: TRACK_HEADER_WIDTH, height: RULER_HEIGHT }}
            className="shrink-0 border-b border-r border-border bg-surface"
          />
          <div ref={rulerViewportRef} className="flex-1 overflow-hidden border-b border-border">
            <TimelineRuler
              bpm={bpm}
              totalSeconds={totalSeconds}
              pxPerSecond={pxPerSecond}
              beatsPerBar={beatsPerBar}
              onSeek={handleSeek}
              loopStart={loopStart}
              loopEnd={loopEnd}
              onSetLoopRegion={(start, end) => {
                setLoopStart(start);
                setLoopEnd(end);
                setLoopEnabled(true);
              }}
            />
          </div>
        </div>

        <div className="flex">
          <div className="flex shrink-0 flex-col">
            {channels.map((channel, idx) => (
              <div key={channel.id}>
                <TrackHeader
                  channel={channel}
                  color={trackColorForIndex(channel.colorIndex)}
                  selected={channel.id === selectedChannelId}
                  recording={
                    transportState === "recording" &&
                    channel.id === recordingChannelRef.current
                  }
                  hasNotes={clipsOf(channel.id).some((c) => c.kind === "midi" && c.notes.length > 0)}
                  hasClipContent={clipsOf(channel.id).length > 0}
                  effectsCount={(channelEffects[channel.id] ?? []).length}
                  canRemove={channels.length > 1}
                  canMoveUp={idx > 0}
                  canMoveDown={idx < channels.length - 1}
                  showAutomation={automationChannelId === channel.id}
                  onToggleAutomation={() => handleToggleAutomation(channel.id)}
                  inputDevices={inputDevices}
                  selectedInputDeviceId={selectedInputDeviceId}
                  onInputDeviceChange={handleInputDeviceChange}
                  onRequestInputDevices={handleRequestInputDevices}
                  onSelect={() => {
                    setSelectedChannelId(channel.id);
                    setSelectedClipIds(new Set());
                    openFx(channel.id);
                  }}
                  onRename={(name) => handleRenameChannel(channel.id, name)}
                  onRecolor={(colorIndex) => handleRecolorChannel(channel.id, colorIndex)}
                  onMoveUp={() => handleReorderChannel(channel.id, -1)}
                  onMoveDown={() => handleReorderChannel(channel.id, 1)}
                  onVolumeChange={(db) => handleVolumeChange(channel.id, db)}
                  onPanChange={(pan) => handlePanChange(channel.id, pan)}
                  onAdjustStart={pushHistory}
                  onMuteToggle={() => handleMuteToggle(channel.id)}
                  onSoloToggle={() => handleSoloToggle(channel.id)}
                  onArmToggle={() => handleArmToggle(channel.id)}
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
            </div>
          </div>

          <div
            ref={lanesScrollRef}
            onScroll={handleLanesScroll}
            className="relative flex-1 overflow-x-auto"
          >
            {channels.map((channel) => (
              <div key={channel.id}>
                <TrackLane
                  clips={clipsOf(channel.id)}
                  color={trackColorForIndex(channel.colorIndex)}
                  bpm={bpm}
                  beatsPerBar={beatsPerBar}
                  totalSeconds={totalSeconds}
                  pxPerSecond={pxPerSecond}
                  snapSeconds={snapSeconds}
                  selected={channel.id === selectedChannelId}
                  armed={channel.id === armedChannelId}
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
                  onDropAudioFile={(file, atSeconds) => void handleDropAudioFile(channel.id, file, atSeconds)}
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
                      color={trackColorForIndex(channel.colorIndex)}
                      onChange={(points) => handleAutomationPointsChange(channel.id, automationTarget, points)}
                      onDragStart={pushHistory}
                    />
                  </div>
                )}
              </div>
            ))}
            {loopEnd > loopStart && (
              <div
                className="pointer-events-none absolute top-0 z-10 h-full border-x border-accent/60 bg-accent/10"
                style={{ left: loopStart * pxPerSecond, width: (loopEnd - loopStart) * pxPerSecond }}
              />
            )}
            <Playhead pxPerSecond={pxPerSecond} height={lanesHeight} />
          </div>
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

      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          Send/return buses
        </span>
        {buses.map((bus) => (
          <div
            key={bus.id}
            className="flex items-center gap-1 rounded border border-border bg-surface-raised px-1.5 py-1"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: trackColorForIndex(bus.colorIndex).accent }}
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
        <button
          type="button"
          onClick={handleAddBus}
          className="rounded border border-border px-2 py-1 text-[11px] text-muted hover:border-accent hover:text-accent"
        >
          + Bus
        </button>
        <span className="text-[10px] text-muted/70">
          Set each track&apos;s send level to a bus from its own FX window.
        </span>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
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
        <span className="text-[10px] text-muted/70">
          Master output — every track routes through here before the speakers.
        </span>
      </div>

      {armedChannel?.type !== "audio" && (
      <div className="shrink-0 overflow-hidden rounded-lg border border-border bg-surface">
        <button
          type="button"
          onClick={() => setInstrumentPanelCollapsed((v) => !v)}
          title={instrumentPanelCollapsed ? "Expand the note-input panel" : "Collapse the note-input panel"}
          className="flex w-full items-center gap-2 bg-surface-raised px-3 py-1.5 text-left"
        >
          {instrumentPanelCollapsed ? (
            <ChevronUp size={12} className="shrink-0 text-muted" />
          ) : (
            <ChevronDown size={12} className="shrink-0 text-muted" />
          )}
          <span className="text-xs font-medium">
            {armedChannel ? `${armedChannel.name} input` : "Note input"}
          </span>
        </button>
        {!instrumentPanelCollapsed && (
        <div className="p-3">
        {!armedChannel ? (
          <p className="py-3 text-center text-xs text-muted">
            No track armed — click a track&apos;s Record button to play or record it.
          </p>
        ) : armedChannel.instrument === "drums" ? (
          <DrumPads
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
        </div>
        )}
      </div>
      )}

      {editingChannel && editingClipInstance && editingClipInstance.kind === "midi" && (
        <PianoRollEditor
          key={editingClipInstance.id}
          channelName={editingChannel.name}
          color={trackColorForIndex(editingChannel.colorIndex)}
          instrument={editingChannel.instrument ?? "piano"}
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
          channelType={fxChannel?.type}
          color={fxChannel ? trackColorForIndex(fxChannel.colorIndex) : fxBus ? trackColorForIndex(fxBus.colorIndex) : MASTER_COLOR}
          instrument={fxChannel?.instrument}
          synthParams={fxChannel?.synthParams}
          effects={fxChannel ? channelEffects[fxChannel.id] ?? [] : fxBus ? busEffects[fxBus.id] ?? [] : masterEffects}
          buses={buses}
          sends={fxChannel?.sends}
          onInstrumentChange={fxChannel ? (type) => handleInstrumentChange(fxChannel.id, type) : undefined}
          onSynthParamsChange={fxChannel ? handleSynthParamsChange : undefined}
          onSendChange={fxChannel ? handleSendChange : undefined}
          onAddEffect={fxChannel ? handleAddEffect : fxBus ? handleBusAddEffect : handleMasterAddEffect}
          onRemoveEffect={fxChannel ? handleRemoveEffect : fxBus ? handleBusRemoveEffect : handleMasterRemoveEffect}
          onMoveEffect={fxChannel ? handleMoveEffect : fxBus ? handleBusMoveEffect : handleMasterMoveEffect}
          onBypassToggle={fxChannel ? handleEffectBypassToggle : fxBus ? handleBusEffectBypassToggle : handleMasterEffectBypassToggle}
          onParamDragStart={pushHistory}
          onParamChange={fxChannel ? handleEffectParamChange : fxBus ? handleBusEffectParamChange : handleMasterEffectParamChange}
        />
      )}
      </div>
    </div>
  );
}
