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
import { EffectsRack } from "./EffectsRack";
import { audioEngine } from "@/lib/audioEngine";
import { downloadMidiFile, parseMidiFile } from "@/lib/midiFile";
import { midiToNoteName } from "@/lib/piano";
import { listenToWebMidi } from "@/lib/webMidi";
import { trackColorForIndex, MASTER_COLOR } from "@/lib/colors";
import { copyClip, getCopiedClip } from "@/lib/clipboard";
import { decodeAudioFile } from "@/lib/audioFile";
import type { EffectInstance, EffectType } from "@/lib/effects";
import type { ScaleSetting } from "@/lib/scales";
import {
  DEFAULT_PX_PER_SECOND,
  MAX_PX_PER_SECOND,
  MIN_EMPTY_CLIP_SECONDS,
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
  AudioClipData,
  ChannelConfig,
  ClipType,
  InstrumentType,
  NoteEvent,
  TimeSignature,
} from "@/lib/types";

type TransportState = "stopped" | "playing" | "paused" | "recording";

type ContextMenuState =
  | { kind: "clip"; channelId: string; x: number; y: number }
  | { kind: "lane"; channelId: string; x: number; y: number; atSeconds: number }
  | { kind: "header"; channelId: string; x: number; y: number };

interface FxPanelState {
  channelId: string;
  x: number;
  y: number;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
}

let channelCounter = 0;
function createChannel(name: string): ChannelConfig {
  channelCounter += 1;
  return {
    id: `ch-${channelCounter}`,
    name,
    volume: 0,
    pan: 0,
    colorIndex: channelCounter - 1,
    instrument: "piano",
  };
}

export function Daw() {
  const [channels, setChannels] = useState<ChannelConfig[]>(() => [
    createChannel("Piano 1"),
    createChannel("Piano 2"),
    createChannel("Piano 3"),
  ]);
  const [clips, setClips] = useState<Record<string, NoteEvent[]>>({});
  const [clipLengths, setClipLengths] = useState<Record<string, number>>({});
  const [clipOffsets, setClipOffsets] = useState<Record<string, number>>({});
  const [clipTypes, setClipTypes] = useState<Record<string, ClipType>>({});
  const [audioClips, setAudioClips] = useState<Record<string, AudioClipData>>({});
  const [channelEffects, setChannelEffects] = useState<Record<string, EffectInstance[]>>({});
  const [fxPanel, setFxPanel] = useState<FxPanelState | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState(
    () => channels[0].id
  );
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
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

  const lengthOf = useCallback(
    (id: string) => clipLengths[id] ?? MIN_EMPTY_CLIP_SECONDS,
    [clipLengths]
  );
  const offsetOf = useCallback(
    (id: string) => clipOffsets[id] ?? 0,
    [clipOffsets]
  );
  const clipTypeOf = useCallback(
    (id: string): ClipType => clipTypes[id] ?? "midi",
    [clipTypes]
  );

  const registeredChannelIds = useRef(new Set<string>());
  const rulerViewportRef = useRef<HTMLDivElement>(null);
  const lanesScrollRef = useRef<HTMLDivElement>(null);

  const handleLanesScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (rulerViewportRef.current) {
      rulerViewportRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  }, []);

  // Keep the audio engine's channels in sync with React state.
  useEffect(() => {
    const currentIds = new Set(channels.map((c) => c.id));
    channels.forEach((c) => {
      if (!registeredChannelIds.current.has(c.id)) {
        audioEngine.addChannel(c.id, c.instrument);
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

  const handleStop = useCallback(() => {
    if (transportState === "recording") {
      const events = audioEngine.finishRecording(offsetOf(selectedChannelId));
      setClips((prev) => ({ ...prev, [selectedChannelId]: events }));
      if (events.length > 0) {
        const lastEnd = events.reduce(
          (m, n) => Math.max(m, n.time + n.duration),
          0
        );
        setClipLengths((prev) => ({
          ...prev,
          [selectedChannelId]: Math.max(
            prev[selectedChannelId] ?? 0,
            roundUpToBar(lastEnd, bpm, beatsPerBar)
          ),
        }));
      }
    }
    setTransportState("stopped");
    audioEngine.stopAll();
    setActiveNotes(new Set());
  }, [transportState, selectedChannelId, bpm, beatsPerBar, offsetOf]);

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
      handleStop();
      return;
    }
    await audioEngine.startRecording(selectedChannelId);
    setTransportState("recording");
  }, [transportState, selectedChannelId, handleStop]);

  const handleAddChannel = useCallback(() => {
    setChannels((prev) => [...prev, createChannel(`Piano ${prev.length + 1}`)]);
  }, []);

  const handleRemoveChannel = useCallback(
    (id: string) => {
      setChannels((prev) => prev.filter((c) => c.id !== id));
      setClips((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setClipLengths((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setClipOffsets((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setClipTypes((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setAudioClips((prev) => {
        const existing = prev[id];
        if (existing) URL.revokeObjectURL(existing.url);
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setChannelEffects((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (fxPanel?.channelId === id) setFxPanel(null);
      if (selectedChannelId === id) {
        const fallback = channels.find((c) => c.id !== id);
        if (fallback) setSelectedChannelId(fallback.id);
      }
      if (editingChannelId === id) setEditingChannelId(null);
    },
    [selectedChannelId, channels, editingChannelId, fxPanel]
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

  const handleInstrumentChange = useCallback((id: string, type: InstrumentType) => {
    audioEngine.setInstrument(id, type);
    setChannels((prev) =>
      prev.map((c) => (c.id === id ? { ...c, instrument: type } : c))
    );
  }, []);

  /** Drops a channel's audio clip (revoking its object URL) so it can go
   * back to being a plain MIDI track - shared by clearing, importing a
   * .mid file, or adding an empty MIDI clip onto a track that currently
   * holds audio. */
  const discardAudioClip = useCallback(
    (id: string) => {
      const existing = audioClips[id];
      if (existing) URL.revokeObjectURL(existing.url);
      audioEngine.clearAudioClip(id);
      setClipTypes((prev) => ({ ...prev, [id]: "midi" }));
      setAudioClips((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [audioClips]
  );

  const handleImportMidi = useCallback(
    async (id: string, file: File) => {
      if (clipTypeOf(id) === "audio") discardAudioClip(id);
      const notes = await parseMidiFile(file);
      const offset = offsetOf(id);
      audioEngine.setClip(id, notes, offset);
      setClips((prev) => ({ ...prev, [id]: notes }));
      const lastEnd = notes.reduce(
        (m, n) => Math.max(m, n.time + n.duration),
        0
      );
      setClipLengths((prev) => ({
        ...prev,
        [id]: roundUpToBar(lastEnd, bpm, beatsPerBar),
      }));
    },
    [offsetOf, bpm, beatsPerBar, clipTypeOf, discardAudioClip]
  );

  const handleImportAudioAt = useCallback(
    async (id: string, file: File, atSeconds: number) => {
      const decoded = await decodeAudioFile(file);
      const bar = secondsPerBar(bpm, beatsPerBar);
      const anchor = Math.max(0, Math.round(atSeconds / bar) * bar);
      const previous = audioClips[id];
      if (previous) URL.revokeObjectURL(previous.url);
      audioEngine.setAudioClip(id, decoded.url, anchor);
      setClipTypes((prev) => ({ ...prev, [id]: "audio" }));
      setAudioClips((prev) => ({
        ...prev,
        [id]: {
          url: decoded.url,
          fileName: file.name,
          durationSeconds: decoded.durationSeconds,
          peaks: decoded.peaks,
        },
      }));
      setClipOffsets((prev) => ({ ...prev, [id]: anchor }));
      setClipLengths((prev) => ({ ...prev, [id]: decoded.durationSeconds }));
      setClips((prev) => ({ ...prev, [id]: [] }));
    },
    [bpm, beatsPerBar, audioClips]
  );

  const handleExportMidi = useCallback(
    (id: string) => {
      const channel = channels.find((c) => c.id === id);
      downloadMidiFile(clips[id] ?? [], channel?.name ?? "clip", bpm);
    },
    [channels, clips, bpm]
  );

  const handleClearClip = useCallback(
    (id: string) => {
      if (clipTypeOf(id) === "audio") {
        discardAudioClip(id);
        return;
      }
      audioEngine.setClip(id, [], offsetOf(id));
      setClips((prev) => ({ ...prev, [id]: [] }));
    },
    [offsetOf, clipTypeOf, discardAudioClip]
  );

  const handleEditorChange = useCallback(
    (id: string, notes: NoteEvent[]) => {
      audioEngine.setClip(id, notes, offsetOf(id));
      setClips((prev) => ({ ...prev, [id]: notes }));
    },
    [offsetOf]
  );

  const handleMoveClip = useCallback(
    (id: string, newOffset: number) => {
      setClipOffsets((prev) => ({ ...prev, [id]: newOffset }));
      if (clipTypeOf(id) === "audio") {
        audioEngine.setAudioTrim(id, newOffset, lengthOf(id));
      } else {
        audioEngine.setClip(id, clips[id] ?? [], newOffset);
      }
    },
    [clips, clipTypeOf, lengthOf]
  );

  const handleResizeClip = useCallback(
    (id: string, newLength: number) => {
      setClipLengths((prev) => ({ ...prev, [id]: newLength }));
      if (clipTypeOf(id) === "audio") {
        audioEngine.setAudioTrim(id, offsetOf(id), newLength);
      }
    },
    [clipTypeOf, offsetOf]
  );

  const handleSeek = useCallback((seconds: number) => {
    audioEngine.seekTo(seconds);
  }, []);

  const handleRenameChannel = useCallback((id: string, name: string) => {
    setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
  }, []);

  const pasteClipAt = useCallback(
    (id: string, anchor: number) => {
      const copied = getCopiedClip();
      if (!copied) return;
      const at = Math.max(0, anchor);
      setClipOffsets((prev) => ({ ...prev, [id]: at }));
      setClipLengths((prev) => ({ ...prev, [id]: copied.length }));
      if (copied.kind === "audio") {
        audioEngine.setAudioClip(id, copied.url, at, copied.length);
        setClipTypes((prev) => ({ ...prev, [id]: "audio" }));
        setAudioClips((prev) => ({
          ...prev,
          [id]: {
            url: copied.url,
            fileName: copied.fileName,
            durationSeconds: copied.durationSeconds,
            peaks: copied.peaks,
          },
        }));
        setClips((prev) => ({ ...prev, [id]: [] }));
      } else {
        if (clipTypeOf(id) === "audio") discardAudioClip(id);
        setClips((prev) => ({ ...prev, [id]: copied.notes }));
        audioEngine.setClip(id, copied.notes, at);
      }
    },
    [clipTypeOf, discardAudioClip]
  );

  const handleCopyClip = useCallback(
    (id: string = selectedChannelId) => {
      if (clipTypeOf(id) === "audio") {
        const audio = audioClips[id];
        if (!audio) return;
        copyClip({
          kind: "audio",
          url: audio.url,
          fileName: audio.fileName,
          durationSeconds: audio.durationSeconds,
          peaks: audio.peaks,
          length: lengthOf(id),
        });
      } else {
        copyClip({ kind: "midi", notes: clips[id] ?? [], length: lengthOf(id) });
      }
    },
    [clips, audioClips, selectedChannelId, lengthOf, clipTypeOf]
  );

  const handlePasteClip = useCallback(
    (id: string = selectedChannelId) => {
      const bar = secondsPerBar(bpm, beatsPerBar);
      const anchor = Math.round(audioEngine.getTransportSeconds() / bar) * bar;
      pasteClipAt(id, anchor);
    },
    [selectedChannelId, bpm, beatsPerBar, pasteClipAt]
  );

  const handlePasteClipAtBar = useCallback(
    (id: string, atSeconds: number) => {
      const bar = secondsPerBar(bpm, beatsPerBar);
      pasteClipAt(id, Math.round(atSeconds / bar) * bar);
    },
    [bpm, beatsPerBar, pasteClipAt]
  );

  const handleAddEmptyClipAt = useCallback(
    (id: string, atSeconds: number) => {
      if (clipTypeOf(id) === "audio") discardAudioClip(id);
      const bar = secondsPerBar(bpm, beatsPerBar);
      const anchor = Math.max(0, Math.round(atSeconds / bar) * bar);
      setClipOffsets((prev) => ({ ...prev, [id]: anchor }));
      setClipLengths((prev) => ({ ...prev, [id]: bar }));
      setClips((prev) => ({ ...prev, [id]: [] }));
      audioEngine.setClip(id, [], anchor);
    },
    [bpm, beatsPerBar, clipTypeOf, discardAudioClip]
  );

  const openEffects = useCallback((channelId: string, e: React.MouseEvent) => {
    setFxPanel({ channelId, x: e.clientX, y: e.clientY });
  }, []);

  const handleAddEffect = useCallback(
    (type: EffectType) => {
      if (!fxPanel) return;
      const created = audioEngine.addEffect(fxPanel.channelId, type);
      if (created) {
        setChannelEffects((prev) => ({
          ...prev,
          [fxPanel.channelId]: [...(prev[fxPanel.channelId] ?? []), created],
        }));
      }
    },
    [fxPanel]
  );

  const handleRemoveEffect = useCallback(
    (effectId: string) => {
      if (!fxPanel) return;
      audioEngine.removeEffect(fxPanel.channelId, effectId);
      setChannelEffects((prev) => ({
        ...prev,
        [fxPanel.channelId]: (prev[fxPanel.channelId] ?? []).filter((e) => e.id !== effectId),
      }));
    },
    [fxPanel]
  );

  const handleReorderEffect = useCallback(
    (effectId: string, direction: -1 | 1) => {
      if (!fxPanel) return;
      audioEngine.reorderEffect(fxPanel.channelId, effectId, direction);
      setChannelEffects((prev) => {
        const list = [...(prev[fxPanel.channelId] ?? [])];
        const idx = list.findIndex((e) => e.id === effectId);
        const target = idx + direction;
        if (idx === -1 || target < 0 || target >= list.length) return prev;
        const [entry] = list.splice(idx, 1);
        list.splice(target, 0, entry);
        return { ...prev, [fxPanel.channelId]: list };
      });
    },
    [fxPanel]
  );

  const handleEffectParamChange = useCallback(
    (effectId: string, key: string, value: number) => {
      if (!fxPanel) return;
      audioEngine.setEffectParam(fxPanel.channelId, effectId, key, value);
      setChannelEffects((prev) => ({
        ...prev,
        [fxPanel.channelId]: (prev[fxPanel.channelId] ?? []).map((e) =>
          e.id === effectId ? { ...e, params: { ...e.params, [key]: value } } : e
        ),
      }));
    },
    [fxPanel]
  );

  // Space to play/pause, Ctrl/Cmd+C/V to copy/paste the selected channel's
  // clip onto the bar nearest the playhead - both suspended while the piano
  // roll editor is open (it handles its own shortcuts) or while typing.
  useEffect(() => {
    if (editingChannelId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        handleTogglePlay();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        e.preventDefault();
        handleCopyClip();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        handlePasteClip();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingChannelId, handleTogglePlay, handleCopyClip, handlePasteClip]);

  const handleEditClip = useCallback(
    (id: string) => {
      if (clipTypeOf(id) === "audio") return; // no piano roll for an audio clip
      setEditingChannelId(id);
    },
    [clipTypeOf]
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

  const openClipMenu = useCallback((channelId: string, e: React.MouseEvent) => {
    setContextMenu({ kind: "clip", channelId, x: e.clientX, y: e.clientY });
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
    const id = contextMenu.channelId;
    const hasNotes = (clips[id] ?? []).length > 0;
    if (clipTypeOf(id) === "audio") {
      return [
        { label: "Copy clip", icon: <Copy size={13} />, onSelect: () => handleCopyClip(id) },
        {
          label: "Paste clip here",
          icon: <Clipboard size={13} />,
          disabled: !getCopiedClip(),
          onSelect: () => handlePasteClip(id),
        },
        "separator",
        {
          label: "Clear clip",
          icon: <Trash2 size={13} />,
          danger: true,
          onSelect: () => handleClearClip(id),
        },
      ];
    }
    return [
      { label: "Edit in piano roll", icon: <Pencil size={13} />, onSelect: () => setEditingChannelId(id) },
      "separator",
      { label: "Copy clip", icon: <Copy size={13} />, onSelect: () => handleCopyClip(id) },
      {
        label: "Paste clip here",
        icon: <Clipboard size={13} />,
        disabled: !getCopiedClip(),
        onSelect: () => handlePasteClip(id),
      },
      "separator",
      { label: "Export .mid", icon: <Download size={13} />, disabled: !hasNotes, onSelect: () => handleExportMidi(id) },
      {
        label: "Clear clip",
        icon: <Trash2 size={13} />,
        disabled: !hasNotes,
        danger: true,
        onSelect: () => handleClearClip(id),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenu, clips, clipTypeOf]);

  const laneMenuItems = useMemo((): (ContextMenuItem | "separator")[] => {
    if (!contextMenu || contextMenu.kind !== "lane") return [];
    const { channelId, atSeconds } = contextMenu;
    return [
      {
        label: "Add empty MIDI clip here",
        icon: <FilePlus2 size={13} />,
        onSelect: () => handleAddEmptyClipAt(channelId, atSeconds),
      },
      {
        label: "Import audio clip here…",
        icon: <FileAudio size={13} />,
        onSelect: () => triggerAudioImport(channelId, atSeconds),
      },
      {
        label: "Paste clip here",
        icon: <Clipboard size={13} />,
        disabled: !getCopiedClip(),
        onSelect: () => handlePasteClipAtBar(channelId, atSeconds),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenu]);

  const headerMenuItems = useMemo((): (ContextMenuItem | "separator")[] => {
    if (!contextMenu || contextMenu.kind !== "header") return [];
    const id = contextMenu.channelId;
    const items: (ContextMenuItem | "separator")[] = [
      {
        label: "Add empty MIDI clip",
        icon: <FilePlus2 size={13} />,
        onSelect: () => handleAddEmptyClipAt(id, 0),
      },
      {
        label: "Import audio clip…",
        icon: <FileAudio size={13} />,
        onSelect: () => triggerAudioImport(id, 0),
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
  }, [contextMenu, channels.length]);

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
    const longest = channels.reduce(
      (max, c) => Math.max(max, offsetOf(c.id) + lengthOf(c.id)),
      0
    );
    return Math.max(MIN_TIMELINE_SECONDS, Math.ceil(longest + 8));
  }, [channels, offsetOf, lengthOf]);

  const selectedChannel = channels.find((c) => c.id === selectedChannelId);
  const editingChannel = channels.find((c) => c.id === editingChannelId);
  const lanesHeight = channels.length * TRACK_ROW_HEIGHT;

  return (
    <div className="flex h-screen flex-col gap-4 overflow-hidden p-4">
      <header className="flex shrink-0 items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">
          The Dawn Project
        </h1>
        <p className="text-xs text-muted">
          {samplesReady
            ? "double-click a clip to edit it in the piano roll · space to play/pause · ctrl/cmd+C/V to copy/paste a clip"
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
          selectedChannelName={selectedChannel?.name ?? ""}
          onPlay={handlePlay}
          onPause={handlePause}
          onStop={handleStop}
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
                hasNotes={(clips[channel.id] ?? []).length > 0}
                hasClipContent={
                  clipTypeOf(channel.id) === "audio"
                    ? !!audioClips[channel.id]
                    : (clips[channel.id] ?? []).length > 0
                }
                clipType={clipTypeOf(channel.id)}
                effectsCount={(channelEffects[channel.id] ?? []).length}
                canRemove={channels.length > 1}
                onSelect={() => setSelectedChannelId(channel.id)}
                onEdit={() => handleEditClip(channel.id)}
                onRename={(name) => handleRenameChannel(channel.id, name)}
                onVolumeChange={(db) => handleVolumeChange(channel.id, db)}
                onPanChange={(pan) => handlePanChange(channel.id, pan)}
                onInstrumentChange={(type) => handleInstrumentChange(channel.id, type)}
                onOpenEffects={(e) => openEffects(channel.id, e)}
                onImportMidi={(file) => void handleImportMidi(channel.id, file)}
                onExportMidi={() => handleExportMidi(channel.id)}
                onClearClip={() => handleClearClip(channel.id)}
                onRemove={() => handleRemoveChannel(channel.id)}
                onContextMenu={(e) => openHeaderMenu(channel.id, e)}
              />
            ))}
            <button
              type="button"
              onClick={handleAddChannel}
              style={{ width: TRACK_HEADER_WIDTH }}
              className="flex h-9 shrink-0 items-center justify-center border-r border-border text-xs text-muted hover:bg-surface-raised hover:text-accent"
            >
              + Add track
            </button>
          </div>

          <div
            ref={lanesScrollRef}
            onScroll={handleLanesScroll}
            className="relative flex-1 overflow-x-auto"
          >
            {channels.map((channel) => (
              <TrackLane
                key={channel.id}
                clipType={clipTypeOf(channel.id)}
                notes={clips[channel.id] ?? []}
                audioPeaks={audioClips[channel.id]?.peaks}
                audioFileName={audioClips[channel.id]?.fileName}
                color={trackColorForIndex(channel.colorIndex)}
                offset={offsetOf(channel.id)}
                length={lengthOf(channel.id)}
                bpm={bpm}
                beatsPerBar={beatsPerBar}
                totalSeconds={totalSeconds}
                pxPerSecond={pxPerSecond}
                selected={channel.id === selectedChannelId}
                onSelect={() => setSelectedChannelId(channel.id)}
                onEdit={() => handleEditClip(channel.id)}
                onMoveClip={(offset) => handleMoveClip(channel.id, offset)}
                onResizeClip={(length) => handleResizeClip(channel.id, length)}
                onClipContextMenu={(e) => openClipMenu(channel.id, e)}
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
            instrument: "piano",
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
        {selectedChannel && clipTypeOf(selectedChannel.id) === "audio" ? (
          <p className="py-3 text-center text-xs text-muted">
            {selectedChannel.name} holds an audio clip — select a MIDI track to play an instrument.
          </p>
        ) : selectedChannel?.instrument === "drums" ? (
          <DrumPads
            activeNotes={activeNotes}
            onNoteOn={handleNoteOn}
            onNoteOff={handleNoteOff}
            keyboardShortcutsEnabled={!editingChannelId}
          />
        ) : (
          <PianoKeyboard
            activeNotes={activeNotes}
            onNoteOn={handleNoteOn}
            onNoteOff={handleNoteOff}
            scaleSetting={scaleSetting}
            keyboardShortcutsEnabled={!editingChannelId}
          />
        )}
      </div>

      {editingChannel && (
        <PianoRollEditor
          key={editingChannel.id}
          channelName={editingChannel.name}
          color={trackColorForIndex(editingChannel.colorIndex)}
          instrument={editingChannel.instrument}
          notes={clips[editingChannel.id] ?? []}
          length={lengthOf(editingChannel.id)}
          bpm={bpm}
          beatsPerBar={beatsPerBar}
          offset={offsetOf(editingChannel.id)}
          scaleSetting={scaleSetting}
          onScaleChange={setScaleSetting}
          onChange={(notes) => handleEditorChange(editingChannel.id, notes)}
          onClose={() => setEditingChannelId(null)}
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

      {fxPanel && (
        <EffectsRack
          x={fxPanel.x}
          y={fxPanel.y}
          channelName={channels.find((c) => c.id === fxPanel.channelId)?.name ?? ""}
          effects={channelEffects[fxPanel.channelId] ?? []}
          onAdd={handleAddEffect}
          onRemove={handleRemoveEffect}
          onReorder={handleReorderEffect}
          onParamChange={handleEffectParamChange}
          onClose={() => setFxPanel(null)}
        />
      )}
    </div>
  );
}
