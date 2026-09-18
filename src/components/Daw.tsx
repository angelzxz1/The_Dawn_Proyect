"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ChannelStrip } from "./ChannelStrip";
import { TransportBar } from "./TransportBar";
import { PianoKeyboard } from "./PianoKeyboard";
import { audioEngine } from "@/lib/audioEngine";
import { downloadMidiFile, parseMidiFile } from "@/lib/midiFile";
import { midiToNoteName } from "@/lib/piano";
import { listenToWebMidi } from "@/lib/webMidi";
import type { ChannelConfig, NoteEvent } from "@/lib/types";

type TransportState = "stopped" | "playing" | "recording";

let channelCounter = 0;
function nextChannelId(): string {
  channelCounter += 1;
  return `ch-${channelCounter}`;
}

function createChannel(name: string): ChannelConfig {
  return { id: nextChannelId(), name, volume: 0, pan: 0 };
}

export function Daw() {
  const [channels, setChannels] = useState<ChannelConfig[]>(() => [
    createChannel("Piano 1"),
    createChannel("Piano 2"),
    createChannel("Piano 3"),
  ]);
  const [clips, setClips] = useState<Record<string, NoteEvent[]>>({});
  const [selectedChannelId, setSelectedChannelId] = useState(
    () => channels[0].id
  );
  const [bpm, setBpm] = useState(120);
  const [transportState, setTransportState] = useState<TransportState>(
    "stopped"
  );
  const [activeNotes, setActiveNotes] = useState<Set<string>>(new Set());
  const [elapsed, setElapsed] = useState(0);
  const samplesReady = useSyncExternalStore(
    useCallback((listener) => audioEngine.onReadyChange(listener), []),
    () => audioEngine.samplesReady,
    () => true
  );

  const registeredChannelIds = useRef(new Set<string>());

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
      const events = audioEngine.finishRecording();
      setClips((prev) => ({ ...prev, [selectedChannelId]: events }));
    }
    setTransportState("stopped");
    audioEngine.stopAll();
    setActiveNotes(new Set());
    setElapsed(0);
  }, [transportState, selectedChannelId]);

  const handlePlay = useCallback(async () => {
    if (transportState === "recording") return;
    await audioEngine.startPlayback();
    setTransportState("playing");
  }, [transportState]);

  const handleRecord = useCallback(async () => {
    if (transportState === "recording") {
      handleStop();
      return;
    }
    await audioEngine.startRecording(selectedChannelId);
    setTransportState("recording");
  }, [transportState, selectedChannelId, handleStop]);

  // Live elapsed-time display while the transport is running.
  useEffect(() => {
    if (transportState === "stopped") {
      return;
    }
    let frame: number;
    const tick = () => {
      setElapsed(audioEngine.getTransportSeconds());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [transportState]);

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
      if (selectedChannelId === id) {
        const fallback = channels.find((c) => c.id !== id);
        if (fallback) setSelectedChannelId(fallback.id);
      }
    },
    [selectedChannelId, channels]
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

  const handleImportMidi = useCallback(async (id: string, file: File) => {
    const notes = await parseMidiFile(file);
    audioEngine.setClip(id, notes);
    setClips((prev) => ({ ...prev, [id]: notes }));
  }, []);

  const handleExportMidi = useCallback(
    (id: string) => {
      const channel = channels.find((c) => c.id === id);
      downloadMidiFile(clips[id] ?? [], channel?.name ?? "clip", bpm);
    },
    [channels, clips, bpm]
  );

  const handleClearClip = useCallback((id: string) => {
    audioEngine.setClip(id, []);
    setClips((prev) => ({ ...prev, [id]: [] }));
  }, []);

  const selectedChannel = channels.find((c) => c.id === selectedChannelId);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">
          The Dawn Project
        </h1>
        <p className="text-xs text-muted">
          {samplesReady
            ? "click a channel to select it, then record or play with the piano below"
            : "loading piano sounds…"}
        </p>
      </header>

      <TransportBar
        bpm={bpm}
        onBpmChange={setBpm}
        isPlaying={transportState === "playing"}
        isRecording={transportState === "recording"}
        elapsedSeconds={elapsed}
        selectedChannelName={selectedChannel?.name ?? ""}
        onPlay={handlePlay}
        onStop={handleStop}
        onRecord={handleRecord}
      />

      <div className="flex flex-1 gap-3 overflow-x-auto pb-2">
        {channels.map((channel) => (
          <ChannelStrip
            key={channel.id}
            channel={channel}
            notes={clips[channel.id] ?? []}
            selected={channel.id === selectedChannelId}
            recording={
              transportState === "recording" &&
              channel.id === selectedChannelId
            }
            canRemove={channels.length > 1}
            onSelect={() => setSelectedChannelId(channel.id)}
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
          className="flex w-44 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted hover:border-accent hover:text-accent"
        >
          + Add channel
        </button>
      </div>

      <div className="rounded-lg border border-border bg-surface p-3">
        <PianoKeyboard
          activeNotes={activeNotes}
          onNoteOn={handleNoteOn}
          onNoteOff={handleNoteOff}
        />
      </div>
    </div>
  );
}
