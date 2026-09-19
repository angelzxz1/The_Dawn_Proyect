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
  Download,
  FileAudio,
  FilePlus2,
  Loader2,
  Pencil,
  Redo2,
  Repeat,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { TrackHeader } from "./TrackHeader";
import { TrackLane } from "./TrackLane";
import { ValueBar } from "./ValueBar";
import { TimelineRuler } from "./TimelineRuler";
import { Playhead } from "./Playhead";
import { TransportBar } from "./TransportBar";
import { PianoKeyboard } from "./PianoKeyboard";
import { DrumPads } from "./DrumPads";
import { PianoRollEditor } from "./PianoRollEditor";
import { ScaleSelector } from "./ScaleSelector";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { FxWindow } from "./FxWindow";
import { audioEngine, bumpEffectIdCounter } from "@/lib/audioEngine";
import { downloadMidiFile, parseMidiFile } from "@/lib/midiFile";
import { midiToNoteName } from "@/lib/piano";
import { listenToWebMidi } from "@/lib/webMidi";
import { trackColorForIndex, MASTER_COLOR } from "@/lib/colors";
import { copyClip, getCopiedClip } from "@/lib/clipboard";
import { decodeAudioFile, type DecodedAudioClip } from "@/lib/audioFile";
import { hydrateEngine, type ProjectState } from "@/lib/project";
import { loadProject, saveProject, type SerializedClip } from "@/lib/persistence";
import { bounceProjectToWav, downloadWavBlob } from "@/lib/bounce";
import type { EffectInstance, EffectType } from "@/lib/effects";
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
  ChannelConfig,
  ChannelType,
  ClipInstance,
  InstrumentType,
  MidiClipInstance,
  NoteEvent,
  TimeSignature,
} from "@/lib/types";

type TransportState = "stopped" | "playing" | "paused" | "recording";

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
  const [fxChannelId, setFxChannelId] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  // Ableton-style start marker: wherever you last clicked on the ruler.
  // Play always resumes from the transport's current position (unchanged);
  // Stop rewinds to this marker instead of always jumping back to 0.
  const [cursorSeconds, setCursorSeconds] = useState(0);
  const [selectedChannelId, setSelectedChannelId] = useState(
    () => channels[0].id
  );
  /** The one clip (if any) currently selected on the timeline - distinct
   * from the armed/selected track - so Delete/Backspace knows what to
   * remove. */
  const [selectedClip, setSelectedClip] = useState<{ channelId: string; clipId: string } | null>(
    null
  );
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
  const [masterVolume, setMasterVolume] = useState(0);
  const [masterPan, setMasterPan] = useState(0);
  const [masterLimiterThreshold, setMasterLimiterThreshold] = useState(-1);
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
    bpm,
    timeSignature,
    masterVolume,
    masterPan,
    masterName,
  });
  liveProjectRef.current = {
    channels,
    clipsByChannel,
    channelEffects,
    bpm,
    timeSignature,
    masterVolume,
    masterPan,
    masterName,
  };

  const MAX_HISTORY = 100;

  /** Pushes the CURRENT (pre-mutation) state onto the undo stack - call at
   * the very top of a handler, before any setState, or right as a drag
   * gesture starts, so the captured snapshot is genuinely "before". */
  const pushHistory = useCallback(() => {
    historyPast.current.push(liveProjectRef.current);
    if (historyPast.current.length > MAX_HISTORY) historyPast.current.shift();
    historyFuture.current = [];
    setHistoryTick((t) => t + 1);
  }, []);

  const applySnapshot = useCallback((s: ProjectState) => {
    setChannels(s.channels);
    setClipsByChannel(s.clipsByChannel);
    setChannelEffects(s.channelEffects);
    setBpm(s.bpm);
    setTimeSignature(s.timeSignature);
    setMasterVolume(s.masterVolume);
    setMasterPan(s.masterPan);
    setMasterName(s.masterName);
    setSelectedClip(null);
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
      c.notes.map((n) => ({ ...n, time: c.offset + n.time }))
    );
    audioEngine.setClip(channelId, flattened, 0);
  }, []);

  const addMidiClip = useCallback(
    (channelId: string, offset: number, length: number, notes: NoteEvent[] = []): string => {
      pushHistory();
      const clip: MidiClipInstance = { id: newClipId(), kind: "midi", offset, length, notes };
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
    (channelId: string, decoded: DecodedAudioClip, offset: number, fileName: string, sourceBlob: Blob): string => {
      pushHistory();
      const clip: AudioClipInstance = {
        id: newClipId(),
        kind: "audio",
        offset,
        length: decoded.durationSeconds,
        url: decoded.url,
        fileName,
        durationSeconds: decoded.durationSeconds,
        peaks: decoded.peaks,
      };
      audioBlobsRef.current.set(clip.id, sourceBlob);
      setClipsByChannel((prev) => ({ ...prev, [channelId]: [...clipsOf(channelId), clip] }));
      audioEngine.loadAudioClip(channelId, clip.id, decoded.url, offset);
      return clip.id;
    },
    [clipsOf, pushHistory]
  );

  const handleDeleteClip = useCallback(
    (channelId: string, clipId: string) => {
      const existing = clipsOf(channelId);
      const clip = existing.find((c) => c.id === clipId);
      if (!clip) return;
      pushHistory();
      const updated = existing.filter((c) => c.id !== clipId);
      setClipsByChannel((prev) => ({ ...prev, [channelId]: updated }));
      if (clip.kind === "audio") {
        URL.revokeObjectURL(clip.url);
        audioEngine.removeAudioClip(channelId, clipId);
        audioBlobsRef.current.delete(clipId);
      } else {
        rebuildMidiPart(channelId, updated.filter(isMidiClip));
      }
      setSelectedClip((prev) =>
        prev?.channelId === channelId && prev.clipId === clipId ? null : prev
      );
    },
    [clipsOf, rebuildMidiPart, pushHistory]
  );

  /** Empties a whole track - every clip on it, gone. */
  const handleClearTrack = useCallback(
    (channelId: string) => {
      const existing = clipsOf(channelId);
      if (existing.length === 0) return;
      pushHistory();
      existing.forEach((c) => {
        if (c.kind === "audio") {
          URL.revokeObjectURL(c.url);
          audioBlobsRef.current.delete(c.id);
        }
      });
      setClipsByChannel((prev) => ({ ...prev, [channelId]: [] }));
      setSelectedClip((prev) => (prev?.channelId === channelId ? null : prev));
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

  // Keep the audio engine's channels in sync with React state.
  useEffect(() => {
    const currentIds = new Set(channels.map((c) => c.id));
    channels.forEach((c) => {
      if (!registeredChannelIds.current.has(c.id)) {
        audioEngine.addChannel(c.id, c.type, c.instrument);
        audioEngine.setVolume(c.id, c.volume);
        audioEngine.setPan(c.id, c.pan);
        audioEngine.setMute(c.id, c.muted);
        audioEngine.setSolo(c.id, c.solo);
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

  useEffect(() => {
    return listenToWebMidi((event) => {
      const note = midiToNoteName(event.midi);
      if (event.type === "noteon") {
        void handleNoteOn(note, event.velocity || 0.8);
      } else {
        handleNoteOff(note);
      }
    });
  }, [handleNoteOn, handleNoteOff]);

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
  }, [transportState, armedChannelId, handleStop, channelTypeOf, countInBars, beatsPerBar]);

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
        (prev[id] ?? []).forEach((c) => {
          if (c.kind === "audio") {
            URL.revokeObjectURL(c.url);
            audioBlobsRef.current.delete(c.id);
          }
        });
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setChannelEffects((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (fxChannelId === id) setFxChannelId(null);
      if (selectedChannelId === id) {
        const fallback = channels.find((c) => c.id !== id);
        if (fallback) setSelectedChannelId(fallback.id);
      }
      if (editingClip?.channelId === id) setEditingClip(null);
      setSelectedClip((prev) => (prev?.channelId === id ? null : prev));
    },
    [selectedChannelId, channels, editingClip, fxChannelId, pushHistory]
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
      setSelectedClip(null);
    },
    [transportState, pushHistory]
  );

  const handleInstrumentChange = useCallback(
    (id: string, type: InstrumentType | null) => {
      pushHistory();
      audioEngine.setInstrument(id, type);
      setChannels((prev) =>
        prev.map((c) => (c.id === id ? { ...c, instrument: type } : c))
      );
    },
    [pushHistory]
  );

  const handleImportMidi = useCallback(
    async (channelId: string, file: File) => {
      const notes = await parseMidiFile(file);
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

  const handleMoveClip = useCallback(
    (channelId: string, clipId: string, newOffset: number) => {
      const updated = clipsOf(channelId).map((c) =>
        c.id === clipId ? { ...c, offset: newOffset } : c
      );
      setClipsByChannel((prev) => ({ ...prev, [channelId]: updated }));
      const clip = updated.find((c) => c.id === clipId);
      if (!clip) return;
      if (clip.kind === "audio") {
        audioEngine.moveAudioClip(channelId, clipId, newOffset, clip.length);
      } else {
        rebuildMidiPart(channelId, updated.filter(isMidiClip));
      }
    },
    [clipsOf, rebuildMidiPart]
  );

  const handleResizeClip = useCallback(
    (channelId: string, clipId: string, newLength: number) => {
      const updated = clipsOf(channelId).map((c) =>
        c.id === clipId ? { ...c, length: newLength } : c
      );
      setClipsByChannel((prev) => ({ ...prev, [channelId]: updated }));
      const clip = updated.find((c) => c.id === clipId);
      // A MIDI clip's length is purely the visual box - its scheduled notes
      // don't depend on it. An audio clip's length also trims playback.
      if (clip?.kind === "audio") {
        audioEngine.moveAudioClip(channelId, clipId, clip.offset, newLength);
      }
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
      });
    } else {
      copyClip({ kind: "midi", notes: clip.notes, length: clip.length });
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
          blob
        );
      } else {
        addMidiClip(channelId, at, copied.length, copied.notes);
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
        };
        setClipsByChannel((prev) => ({
          ...prev,
          [channelId]: existing.map((c) => (c.id === clipId ? updatedClip : c)),
        }));
        audioEngine.loadAudioClip(channelId, clipId, copied.url, target.offset, copied.length);
      } else {
        const updatedClip: MidiClipInstance = {
          id: clipId,
          kind: "midi",
          offset: target.offset,
          length: copied.length,
          notes: copied.notes,
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
  }, []);

  const handleAddEffect = useCallback(
    (type: EffectType) => {
      if (!fxChannelId) return;
      pushHistory();
      const created = audioEngine.addEffect(fxChannelId, type);
      if (created) {
        setChannelEffects((prev) => ({
          ...prev,
          [fxChannelId]: [...(prev[fxChannelId] ?? []), created],
        }));
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

  const handleReorderEffect = useCallback(
    (effectId: string, direction: -1 | 1) => {
      if (!fxChannelId) return;
      pushHistory();
      audioEngine.reorderEffect(fxChannelId, effectId, direction);
      setChannelEffects((prev) => {
        const list = [...(prev[fxChannelId] ?? [])];
        const idx = list.findIndex((e) => e.id === effectId);
        const target = idx + direction;
        if (idx === -1 || target < 0 || target >= list.length) return prev;
        const [entry] = list.splice(idx, 1);
        list.splice(target, 0, entry);
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
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedClip) {
        e.preventDefault();
        handleDeleteClip(selectedClip.channelId, selectedClip.clipId);
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
    selectedClip,
    handleDeleteClip,
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

  const openClipMenu = useCallback((channelId: string, clipId: string, e: React.MouseEvent) => {
    setContextMenu({ kind: "clip", channelId, clipId, x: e.clientX, y: e.clientY });
  }, []);

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
        {
          label: "Delete clip",
          icon: <Trash2 size={13} />,
          danger: true,
          onSelect: () => handleDeleteClip(channelId, clipId),
        },
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
      {
        label: "Delete clip",
        icon: <Trash2 size={13} />,
        danger: true,
        onSelect: () => handleDeleteClip(channelId, clipId),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenu, clipsOf, channelTypeOf]);

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

  const handleBpmCommit = useCallback(
    (value: number) => {
      pushHistory();
      setBpm(value);
    },
    [pushHistory]
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
        masterVolume,
        masterPan,
        masterLimiterThreshold,
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
    masterVolume,
    masterPan,
    masterLimiterThreshold,
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
              }
            : {
                id: c.id,
                kind: "midi" as const,
                offset: c.offset,
                length: c.length,
                notes: c.notes,
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
          bpm,
          timeSignature,
          masterVolume,
          masterPan,
          masterName,
          masterLimiterThreshold,
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
    bpm,
    timeSignature,
    masterVolume,
    masterPan,
    masterName,
    masterLimiterThreshold,
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
              };
              return restored;
            }
            const restored: MidiClipInstance = {
              id: c.id,
              kind: "midi",
              offset: c.offset,
              length: c.length,
              notes: c.notes,
            };
            return restored;
          });
        });
        project.channels.forEach((c) => bumpCounterFromId(c.id, "ch"));
        Object.values(project.channelEffects)
          .flat()
          .forEach((fx) => {
            const match = fx.id.match(/^fx-(\d+)$/);
            if (match) maxEffectN = Math.max(maxEffectN, parseInt(match[1], 10));
          });
        bumpEffectIdCounter(maxEffectN);

        setChannels(project.channels);
        setClipsByChannel(restoredClips);
        setChannelEffects(project.channelEffects);
        setBpm(project.bpm);
        setTimeSignature(project.timeSignature);
        setMasterVolume(project.masterVolume);
        setMasterPan(project.masterPan);
        setMasterName(project.masterName);
        setMasterLimiterThreshold(project.masterLimiterThreshold);
        setScaleSetting(project.scaleSetting);
        setSnapResolution(project.snapResolution);
        setCountInBars(project.countInBars);
        setMetronomeEnabled(project.metronomeEnabled);
        hydrateEngine(
          {
            channels: project.channels,
            clipsByChannel: restoredClips,
            channelEffects: project.channelEffects,
            bpm: project.bpm,
            timeSignature: project.timeSignature,
            masterVolume: project.masterVolume,
            masterPan: project.masterPan,
            masterName: project.masterName,
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
  const lanesHeight = channels.length * TRACK_ROW_HEIGHT;

  return (
    <div className="flex h-screen flex-col gap-4 overflow-hidden p-4">
      {isLoadingProject && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90">
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 size={16} className="animate-spin" />
            Loading project…
          </div>
        </div>
      )}
      <header className="flex shrink-0 items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">
          The Dawn Project
        </h1>
        <p className={`text-xs ${micError ? "text-record" : "text-muted"}`}>
          {micError
            ? micError
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
            {channels.map((channel) => (
              <TrackHeader
                key={channel.id}
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
                onSelect={() => {
                  setSelectedChannelId(channel.id);
                  setSelectedClip(null);
                }}
                onRename={(name) => handleRenameChannel(channel.id, name)}
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
              <TrackLane
                key={channel.id}
                clips={clipsOf(channel.id)}
                color={trackColorForIndex(channel.colorIndex)}
                bpm={bpm}
                beatsPerBar={beatsPerBar}
                totalSeconds={totalSeconds}
                pxPerSecond={pxPerSecond}
                snapSeconds={snapSeconds}
                selected={channel.id === selectedChannelId}
                armed={channel.id === armedChannelId}
                selectedClipId={selectedClip?.channelId === channel.id ? selectedClip.clipId : null}
                onSelectTrack={() => {
                  setSelectedChannelId(channel.id);
                  setSelectedClip(null);
                }}
                onSelectClip={(clipId) => {
                  setSelectedChannelId(channel.id);
                  setSelectedClip({ channelId: channel.id, clipId });
                }}
                onEditClip={(clipId) => handleEditClip(channel.id, clipId)}
                onMoveClip={(clipId, offset) => handleMoveClip(channel.id, clipId, offset)}
                onResizeClip={(clipId, length) => handleResizeClip(channel.id, clipId, length)}
                onClipContextMenu={(clipId, e) => openClipMenu(channel.id, clipId, e)}
                onLaneContextMenu={(e, atSeconds) => openLaneMenu(channel.id, e, atSeconds)}
                onClipDragStart={pushHistory}
              />
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

      <div className="flex shrink-0 rounded-lg border border-border bg-surface">
        <TrackHeader
          channel={{
            id: "master",
            name: masterName,
            volume: masterVolume,
            pan: masterPan,
            colorIndex: -1,
            type: "midi",
            instrument: null,
            muted: false,
            solo: false,
            armed: false,
          }}
          color={MASTER_COLOR}
          selected={false}
          recording={false}
          hasNotes={false}
          canRemove={false}
          isMaster
          onSelect={() => {}}
          onRename={setMasterName}
          onVolumeChange={setMasterVolume}
          onPanChange={setMasterPan}
          onAdjustStart={pushHistory}
        />
        <div className="flex flex-1 items-center gap-3 px-3 text-xs text-muted">
          <span>Master output — every track routes through here before the speakers.</span>
          <div className="flex items-center gap-1.5">
            <ValueBar
              label="Ceiling"
              value={masterLimiterThreshold}
              min={-24}
              max={0}
              defaultValue={-1}
              onChange={setMasterLimiterThreshold}
              formatValue={(v) => `${v.toFixed(1)}dB`}
            />
            <span className="text-[10px] text-muted/70">limiter</span>
          </div>
        </div>
      </div>

      <div className="shrink-0 rounded-lg border border-border bg-surface p-3">
        {!armedChannel ? (
          <p className="py-3 text-center text-xs text-muted">
            No track armed — click a track&apos;s Record button to play or record it.
          </p>
        ) : armedChannel.type === "audio" ? (
          <p className="py-3 text-center text-xs text-muted">
            {armedChannel.name} is an audio track — arm a MIDI track to play an instrument.
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
          <PianoKeyboard
            activeNotes={activeNotes}
            onNoteOn={handleNoteOn}
            onNoteOff={handleNoteOff}
            scaleSetting={scaleSetting}
            keyboardShortcutsEnabled={!editingClip}
          />
        )}
      </div>

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

      {fxChannel && (
        <FxWindow
          channelName={fxChannel.name}
          channelType={fxChannel.type}
          color={trackColorForIndex(fxChannel.colorIndex)}
          instrument={fxChannel.instrument}
          effects={channelEffects[fxChannel.id] ?? []}
          onInstrumentChange={(type) => handleInstrumentChange(fxChannel.id, type)}
          onAdd={handleAddEffect}
          onRemove={handleRemoveEffect}
          onReorder={handleReorderEffect}
          onParamDragStart={pushHistory}
          onParamChange={handleEffectParamChange}
          onClose={() => setFxChannelId(null)}
        />
      )}
    </div>
  );
}
