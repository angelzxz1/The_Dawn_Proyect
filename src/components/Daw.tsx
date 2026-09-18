"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { TrackHeader } from "./TrackHeader";
import { TrackLane } from "./TrackLane";
import { TimelineRuler } from "./TimelineRuler";
import { Playhead } from "./Playhead";
import { TransportBar } from "./TransportBar";
import { PianoKeyboard } from "./PianoKeyboard";
import { PianoRollEditor } from "./PianoRollEditor";
import { ScaleSelector } from "./ScaleSelector";
import { audioEngine } from "@/lib/audioEngine";
import { downloadMidiFile, parseMidiFile } from "@/lib/midiFile";
import { midiToNoteName } from "@/lib/piano";
import { listenToWebMidi } from "@/lib/webMidi";
import { trackColorForIndex } from "@/lib/colors";
import { copyClip, getCopiedClip } from "@/lib/clipboard";
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
import type { ChannelConfig, NoteEvent, TimeSignature } from "@/lib/types";

type TransportState = "stopped" | "playing" | "paused" | "recording";

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
        audioEngine.addChannel(c.id);
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
      if (selectedChannelId === id) {
        const fallback = channels.find((c) => c.id !== id);
        if (fallback) setSelectedChannelId(fallback.id);
      }
      if (editingChannelId === id) setEditingChannelId(null);
    },
    [selectedChannelId, channels, editingChannelId]
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

  const handleImportMidi = useCallback(
    async (id: string, file: File) => {
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
    [offsetOf, bpm, beatsPerBar]
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
      audioEngine.setClip(id, [], offsetOf(id));
      setClips((prev) => ({ ...prev, [id]: [] }));
    },
    [offsetOf]
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
      audioEngine.setClip(id, clips[id] ?? [], newOffset);
    },
    [clips]
  );

  const handleResizeClip = useCallback((id: string, newLength: number) => {
    setClipLengths((prev) => ({ ...prev, [id]: newLength }));
  }, []);

  const handleSeek = useCallback((seconds: number) => {
    audioEngine.seekTo(seconds);
  }, []);

  const handleCopyClip = useCallback(() => {
    copyClip({ notes: clips[selectedChannelId] ?? [], length: lengthOf(selectedChannelId) });
  }, [clips, selectedChannelId, lengthOf]);

  const handlePasteClip = useCallback(() => {
    const copied = getCopiedClip();
    if (!copied) return;
    const bar = secondsPerBar(bpm, beatsPerBar);
    const anchor = Math.max(0, Math.round(audioEngine.getTransportSeconds() / bar) * bar);
    setClipOffsets((prev) => ({ ...prev, [selectedChannelId]: anchor }));
    setClipLengths((prev) => ({ ...prev, [selectedChannelId]: copied.length }));
    setClips((prev) => ({ ...prev, [selectedChannelId]: copied.notes }));
    audioEngine.setClip(selectedChannelId, copied.notes, anchor);
  }, [selectedChannelId, bpm, beatsPerBar]);

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
                canRemove={channels.length > 1}
                onSelect={() => setSelectedChannelId(channel.id)}
                onEdit={() => setEditingChannelId(channel.id)}
                onVolumeChange={(db) => handleVolumeChange(channel.id, db)}
                onPanChange={(pan) => handlePanChange(channel.id, pan)}
                onImportMidi={(file) => void handleImportMidi(channel.id, file)}
                onExportMidi={() => handleExportMidi(channel.id)}
                onClearClip={() => handleClearClip(channel.id)}
                onRemove={() => handleRemoveChannel(channel.id)}
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
                notes={clips[channel.id] ?? []}
                color={trackColorForIndex(channel.colorIndex)}
                offset={offsetOf(channel.id)}
                length={lengthOf(channel.id)}
                bpm={bpm}
                beatsPerBar={beatsPerBar}
                totalSeconds={totalSeconds}
                pxPerSecond={pxPerSecond}
                selected={channel.id === selectedChannelId}
                onSelect={() => setSelectedChannelId(channel.id)}
                onEdit={() => setEditingChannelId(channel.id)}
                onMoveClip={(offset) => handleMoveClip(channel.id, offset)}
                onResizeClip={(length) => handleResizeClip(channel.id, length)}
              />
            ))}
            <Playhead pxPerSecond={pxPerSecond} height={lanesHeight} />
          </div>
        </div>
      </div>

      <div className="shrink-0 rounded-lg border border-border bg-surface p-3">
        <PianoKeyboard
          activeNotes={activeNotes}
          onNoteOn={handleNoteOn}
          onNoteOff={handleNoteOff}
          scaleSetting={scaleSetting}
          keyboardShortcutsEnabled={!editingChannelId}
        />
      </div>

      {editingChannel && (
        <PianoRollEditor
          key={editingChannel.id}
          channelName={editingChannel.name}
          color={trackColorForIndex(editingChannel.colorIndex)}
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
    </div>
  );
}
