"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Clipboard, Copy, Download, FileAudio, FilePlus2, Pencil, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { TrackHeader } from "./TrackHeader";
import { TrackLane } from "./TrackLane";
import { TimelineRuler } from "./TimelineRuler";
import { Playhead } from "./Playhead";
import { TransportBar } from "./TransportBar";
import { PianoKeyboard } from "./PianoKeyboard";
import { DrumPads } from "./DrumPads";
import { PianoRollEditor } from "./PianoRollEditor";
import { ScaleSelector } from "./ScaleSelector";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { FxWindow } from "./FxWindow";
import { audioEngine } from "@/lib/audioEngine";
import { downloadMidiFile, parseMidiFile } from "@/lib/midiFile";
import { midiToNoteName } from "@/lib/piano";
import { listenToWebMidi } from "@/lib/webMidi";
import { trackColorForIndex, MASTER_COLOR } from "@/lib/colors";
import { copyClip, getCopiedClip } from "@/lib/clipboard";
import { decodeAudioFile, type DecodedAudioClip } from "@/lib/audioFile";
import type { EffectInstance, EffectType } from "@/lib/effects";
import type { ScaleSetting } from "@/lib/scales";
import {
  DEFAULT_PX_PER_SECOND,
  MAX_PX_PER_SECOND,
  MIN_PX_PER_SECOND,
  MIN_TIMELINE_SECONDS,
  RULER_HEIGHT,
  TRACK_HEADER_WIDTH,
  TRACK_ROW_HEIGHT,
  quarterNotesPerBar,
  roundUpToBar,
  secondsPerBar,
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
  };
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
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const samplesReady = useSyncExternalStore(
    useCallback((listener) => audioEngine.onReadyChange(listener), []),
    () => audioEngine.samplesReady,
    () => true
  );

  const beatsPerBar = quarterNotesPerBar(
    timeSignature.numerator,
    timeSignature.denominator
  );

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
      const clip: MidiClipInstance = { id: newClipId(), kind: "midi", offset, length, notes };
      const updated = [...clipsOf(channelId), clip];
      setClipsByChannel((prev) => ({ ...prev, [channelId]: updated }));
      rebuildMidiPart(channelId, updated.filter(isMidiClip));
      return clip.id;
    },
    [clipsOf, rebuildMidiPart]
  );

  const addAudioClip = useCallback(
    (channelId: string, decoded: DecodedAudioClip, offset: number, fileName: string): string => {
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
      setClipsByChannel((prev) => ({ ...prev, [channelId]: [...clipsOf(channelId), clip] }));
      audioEngine.loadAudioClip(channelId, clip.id, decoded.url, offset);
      return clip.id;
    },
    [clipsOf]
  );

  const handleDeleteClip = useCallback(
    (channelId: string, clipId: string) => {
      const existing = clipsOf(channelId);
      const clip = existing.find((c) => c.id === clipId);
      if (!clip) return;
      const updated = existing.filter((c) => c.id !== clipId);
      setClipsByChannel((prev) => ({ ...prev, [channelId]: updated }));
      if (clip.kind === "audio") {
        URL.revokeObjectURL(clip.url);
        audioEngine.removeAudioClip(channelId, clipId);
      } else {
        rebuildMidiPart(channelId, updated.filter(isMidiClip));
      }
    },
    [clipsOf, rebuildMidiPart]
  );

  /** Empties a whole track - every clip on it, gone. */
  const handleClearTrack = useCallback(
    (channelId: string) => {
      const existing = clipsOf(channelId);
      existing.forEach((c) => {
        if (c.kind === "audio") URL.revokeObjectURL(c.url);
      });
      setClipsByChannel((prev) => ({ ...prev, [channelId]: [] }));
      if (channelTypeOf(channelId) === "audio") audioEngine.clearAllAudioClips(channelId);
      else audioEngine.setClip(channelId, [], 0);
    },
    [clipsOf, channelTypeOf]
  );

  const registeredChannelIds = useRef(new Set<string>());
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

  const handleNoteOn = useCallback(
    async (note: string, velocity: number) => {
      await audioEngine.ensureStarted();
      audioEngine.noteOn(selectedChannelId, note, velocity);
      setActiveNotes((prev) => {
        const next = new Set(prev);
        next.add(note);
        return next;
      });
    },
    [selectedChannelId]
  );

  const handleNoteOff = useCallback(
    (note: string) => {
      audioEngine.noteOff(selectedChannelId, note);
      setActiveNotes((prev) => {
        const next = new Set(prev);
        next.delete(note);
        return next;
      });
    },
    [selectedChannelId]
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

  const handleStop = useCallback(async () => {
    if (transportState === "recording") {
      if (channelTypeOf(selectedChannelId) === "audio") {
        const blob = await audioEngine.finishAudioRecording();
        if (blob && blob.size > 0) {
          const decoded = await decodeAudioFile(blob);
          const channelName = channels.find((c) => c.id === selectedChannelId)?.name ?? "take";
          addAudioClip(selectedChannelId, decoded, 0, `${channelName} recording`);
        }
      } else {
        const events = audioEngine.finishRecording();
        if (events.length > 0) {
          const lastEnd = events.reduce(
            (m, n) => Math.max(m, n.time + n.duration),
            0
          );
          addMidiClip(selectedChannelId, 0, roundUpToBar(lastEnd, bpm, beatsPerBar), events);
        }
      }
    }
    setTransportState("stopped");
    audioEngine.stopAll();
    audioEngine.seekTo(cursorSeconds);
    setActiveNotes(new Set());
  }, [transportState, selectedChannelId, bpm, beatsPerBar, channelTypeOf, channels, addAudioClip, addMidiClip, cursorSeconds]);

  const handlePlay = useCallback(async () => {
    if (transportState === "recording") return;
    await audioEngine.startPlayback();
    setTransportState("playing");
  }, [transportState]);

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
    if (channelTypeOf(selectedChannelId) === "audio") {
      try {
        await audioEngine.startAudioRecording(selectedChannelId);
        setMicError(null);
        setTransportState("recording");
      } catch {
        setMicError(
          "Couldn't access the microphone - check the browser's permission prompt or site settings."
        );
      }
      return;
    }
    await audioEngine.startRecording(selectedChannelId);
    setTransportState("recording");
  }, [transportState, selectedChannelId, handleStop, channelTypeOf]);

  const handleAddChannel = useCallback((type: ChannelType) => {
    setChannels((prev) => {
      const countOfType = prev.filter((c) => c.type === type).length;
      const name = type === "midi" ? `MIDI ${countOfType + 1}` : `Audio ${countOfType + 1}`;
      return [...prev, createChannel(name, type)];
    });
  }, []);

  const handleRemoveChannel = useCallback(
    (id: string) => {
      setChannels((prev) => prev.filter((c) => c.id !== id));
      setClipsByChannel((prev) => {
        (prev[id] ?? []).forEach((c) => {
          if (c.kind === "audio") URL.revokeObjectURL(c.url);
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
    },
    [selectedChannelId, channels, editingClip, fxChannelId]
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

  const handleInstrumentChange = useCallback((id: string, type: InstrumentType | null) => {
    audioEngine.setInstrument(id, type);
    setChannels((prev) =>
      prev.map((c) => (c.id === id ? { ...c, instrument: type } : c))
    );
  }, []);

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
      addAudioClip(channelId, decoded, anchor, file.name);
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

  const handleRenameChannel = useCallback((id: string, name: string) => {
    setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
  }, []);

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
    (channelId: string, anchor: number) => {
      const copied = getCopiedClip();
      if (!copied || copied.kind !== channelTypeOf(channelId)) return;
      const at = Math.max(0, anchor);
      if (copied.kind === "audio") {
        addAudioClip(
          channelId,
          { url: copied.url, durationSeconds: copied.durationSeconds, peaks: copied.peaks },
          at,
          copied.fileName
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
    (channelId: string, clipId: string) => {
      const copied = getCopiedClip();
      if (!copied || copied.kind !== channelTypeOf(channelId)) return;
      const existing = clipsOf(channelId);
      const target = existing.find((c) => c.id === clipId);
      if (!target) return;
      if (copied.kind === "audio") {
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
    [channelTypeOf, clipsOf, rebuildMidiPart]
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
      const created = audioEngine.addEffect(fxChannelId, type);
      if (created) {
        setChannelEffects((prev) => ({
          ...prev,
          [fxChannelId]: [...(prev[fxChannelId] ?? []), created],
        }));
      }
    },
    [fxChannelId]
  );

  const handleRemoveEffect = useCallback(
    (effectId: string) => {
      if (!fxChannelId) return;
      audioEngine.removeEffect(fxChannelId, effectId);
      setChannelEffects((prev) => ({
        ...prev,
        [fxChannelId]: (prev[fxChannelId] ?? []).filter((e) => e.id !== effectId),
      }));
    },
    [fxChannelId]
  );

  const handleReorderEffect = useCallback(
    (effectId: string, direction: -1 | 1) => {
      if (!fxChannelId) return;
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
    [fxChannelId]
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
  // playhead on the armed track - both suspended while the piano roll
  // editor is open (it handles its own shortcuts) or while typing.
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
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingClip, handleTogglePlay, handleCopyAtPlayhead, handlePasteClip]);

  const handleEditClip = useCallback(
    (channelId: string, clipId: string) => {
      if (channelTypeOf(channelId) === "audio") return; // no piano roll for an audio clip
      setEditingClip({ channelId, clipId });
    },
    [channelTypeOf]
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

  const selectedChannel = channels.find((c) => c.id === selectedChannelId);
  const editingChannel = channels.find((c) => c.id === editingClip?.channelId);
  const editingClipInstance = editingClip
    ? clipsOf(editingClip.channelId).find((c) => c.id === editingClip.clipId)
    : undefined;
  const fxChannel = channels.find((c) => c.id === fxChannelId);
  const lanesHeight = channels.length * TRACK_ROW_HEIGHT;

  return (
    <div className="flex h-screen flex-col gap-4 overflow-hidden p-4">
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
          onBpmChange={setBpm}
          timeSignature={timeSignature}
          onTimeSignatureChange={setTimeSignature}
          metronomeEnabled={metronomeEnabled}
          onToggleMetronome={() => setMetronomeEnabled((v) => !v)}
          isPlaying={transportState === "playing"}
          isPaused={transportState === "paused"}
          isRecording={transportState === "recording"}
          recordingMode={selectedChannel?.type === "audio" ? "audio" : "midi"}
          selectedChannelName={selectedChannel?.name ?? ""}
          onPlay={handlePlay}
          onPause={handlePause}
          onStop={() => void handleStop()}
          onRecord={handleRecord}
        />
      </div>

      <div className="flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-1 text-xs text-muted">
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
                  channel.id === selectedChannelId
                }
                hasNotes={clipsOf(channel.id).some((c) => c.kind === "midi" && c.notes.length > 0)}
                hasClipContent={clipsOf(channel.id).length > 0}
                effectsCount={(channelEffects[channel.id] ?? []).length}
                canRemove={channels.length > 1}
                onSelect={() => setSelectedChannelId(channel.id)}
                onRename={(name) => handleRenameChannel(channel.id, name)}
                onVolumeChange={(db) => handleVolumeChange(channel.id, db)}
                onPanChange={(pan) => handlePanChange(channel.id, pan)}
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
                selected={channel.id === selectedChannelId}
                onSelect={() => setSelectedChannelId(channel.id)}
                onEditClip={(clipId) => handleEditClip(channel.id, clipId)}
                onMoveClip={(clipId, offset) => handleMoveClip(channel.id, clipId, offset)}
                onResizeClip={(clipId, length) => handleResizeClip(channel.id, clipId, length)}
                onClipContextMenu={(clipId, e) => openClipMenu(channel.id, clipId, e)}
                onLaneContextMenu={(e, atSeconds) => openLaneMenu(channel.id, e, atSeconds)}
              />
            ))}
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
        />
        <div className="flex flex-1 items-center px-3 text-xs text-muted">
          Master output — every track routes through here before the speakers
        </div>
      </div>

      <div className="shrink-0 rounded-lg border border-border bg-surface p-3">
        {selectedChannel && selectedChannel.type === "audio" ? (
          <p className="py-3 text-center text-xs text-muted">
            {selectedChannel.name} is an audio track — select a MIDI track to play an instrument.
          </p>
        ) : selectedChannel?.instrument === "drums" ? (
          <DrumPads
            activeNotes={activeNotes}
            onNoteOn={handleNoteOn}
            onNoteOff={handleNoteOff}
            keyboardShortcutsEnabled={!editingClip}
          />
        ) : selectedChannel?.instrument === null ? (
          <div className="flex items-center justify-center gap-3 py-3 text-xs text-muted">
            <span>{selectedChannel.name} has no instrument loaded.</span>
            <button
              type="button"
              onClick={() => openFx(selectedChannel.id)}
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
          onParamChange={handleEffectParamChange}
          onClose={() => setFxChannelId(null)}
        />
      )}
    </div>
  );
}
