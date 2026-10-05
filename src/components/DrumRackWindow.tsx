"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ClipboardPaste, Copy, FileAudio, RotateCcw, Save, Trash2, Upload, Waves, X } from "lucide-react";
import { audioEngine } from "@/lib/audioEngine";
import { loadDrumSample } from "@/lib/drumRack";
import {
  CHOKE_GROUPS,
  DRUM_MODELS,
  DRUM_MODEL_INFO,
  LEVEL_MAX,
  LEVEL_MIN,
  PAD_KEYS,
  PAD_KEY_ORDER,
  defaultKitPads,
  padNote,
  type DrumKitParams,
  type DrumModel,
  type DrumPadParams,
} from "@/lib/drumParams";
import { allDrumKits, deleteDrumKit, saveDrumKit, serverDrumKits, subscribeDrumKits, type DrumKitPreset } from "@/lib/drumKits";
import { newEffectFileId, registerEffectFile } from "@/lib/effectFiles";
import { fraunces, spaceGrotesk } from "@/lib/pluginFonts";
import { PluginKnob } from "./PluginKnob";
import { useShortcuts } from "@/lib/shortcuts";

// The Drum Rack's window: 16 pads (C1 at the bottom left, like Ableton),
// and an editor for the selected pad.

const C = {
  bg: "#16171D",
  panel: "#1D1E26",
  raised: "#24252F",
  border: "#2E2F3A",
  text: "#F4EDE2",
  muted: "#9A9AA8",
  dim: "#5F6070",
  accent: "#E6AD5E",
};

/** A color per voice model, for the pads. */
export const MODEL_COLORS: Record<DrumModel, string> = {
  kick: "#F2706B",
  snare: "#F5A45D",
  clap: "#F2D16B",
  hat: "#62D2E8",
  cymbal: "#7FA2F7",
  tom: "#EC6BA8",
  rim: "#C9A0F5",
  cowbell: "#9BE28F",
  shaker: "#5FE0B5",
  clave: "#D9B38C",
};
export const SAMPLE_COLOR = "#E6E1D8";

export function padColor(p: DrumPadParams): string {
  return p.source === "sample" && p.sample ? SAMPLE_COLOR : MODEL_COLORS[p.model];
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
const keyFor = (pad: number) => PAD_KEYS[PAD_KEY_ORDER.indexOf(pad)]?.toUpperCase();

const fmtDb = (v: number) => (v <= LEVEL_MIN ? "-∞ dB" : `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`);
const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const fmtPan = (v: number) => (Math.abs(v) < 0.005 ? "C" : `${Math.round(Math.abs(v) * 100)}${v < 0 ? "L" : "R"}`);
const fmtSt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(Math.abs(v - Math.round(v)) < 0.01 ? 0 : 1)} st`;
function fmtFilter(v: number): string {
  if (Math.abs(v) <= 0.005) return "Off";
  const hz = v < 0 ? 20000 * Math.pow(2, v * 10) : 20 * Math.pow(2, v * 10);
  const f = hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`;
  return `${v < 0 ? "LP" : "HP"} ${f}`;
}

interface Props {
  channelId: string;
  channelName: string;
  kit: DrumKitParams;
  onChange: (kit: DrumKitParams) => void;
  onClose: () => void;
  /** Once per edit gesture (one undo step each). */
  onDragStart?: () => void;
}

let clipboard: DrumPadParams | null = null;

export function DrumRackWindow({ channelId, channelName, kit, onChange, onClose, onDragStart }: Props) {
  const [selected, setSelected] = useState(0);
  const [lit, setLit] = useState(0);
  const latest = useRef(kit);
  useEffect(() => {
    latest.current = kit;
  }, [kit]);
  const begin = useCallback(() => onDragStart?.(), [onDragStart]);
  const update = useCallback(
    (edit: (k: DrumKitParams) => void) => {
      const next = structuredClone(latest.current);
      edit(next);
      latest.current = next;
      onChange(next);
    },
    [onChange]
  );
  const setPad = useCallback((i: number, edit: (p: DrumPadParams) => void) => update((k) => edit(k.pads[i])), [update]);

  // Pads light up when they're hit (from the keyboard, a controller or a clip).
  useEffect(() => {
    let timer = 0;
    const stop = audioEngine.watchDrums(channelId, (s) => {
      if (!s.hits) return;
      setLit((l) => l | s.hits);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setLit(0), 140);
    });
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, [channelId]);

  useShortcuts("window", [{ keys: "escape", run: onClose }]);

  const loadFile = (pad: number, file: File) => {
    if (!file.type.startsWith("audio/") && !/\.(wav|aiff?|mp3|ogg|flac|m4a)$/i.test(file.name)) return;
    const id = newEffectFileId();
    registerEffectFile(id, file);
    begin();
    const name = file.name.replace(/\.[^.]+$/, "");
    setPad(pad, (p) => {
      p.sample = { id, name: name.slice(0, 60) };
      p.source = "sample";
      p.name = name.slice(0, 24);
      p.start = 0;
      p.reverse = false;
      p.decay = 1;
      p.tune = 0;
    });
    setSelected(pad);
  };

  const audition = (i: number) => audioEngine.auditionDrumPad(channelId, i);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
      <div
        role="dialog"
        aria-label={`Drum Rack - ${channelName}`}
        className={`${spaceGrotesk.className} flex max-h-full w-[1000px] max-w-full flex-col gap-3 overflow-auto rounded-2xl p-4 shadow-2xl`}
        style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }}
      >
        <Header channelName={channelName} kit={kit} update={update} begin={begin} onClose={onClose} />
        <div className="flex gap-3">
          <PadGrid kit={kit} selected={selected} lit={lit} onSelect={(i) => { setSelected(i); audition(i); }} onDropFile={loadFile} />
          <PadEditor
            index={selected}
            pad={kit.pads[selected]}
            setPad={(edit) => setPad(selected, edit)}
            begin={begin}
            onLoadFile={(f) => loadFile(selected, f)}
            onAudition={() => audition(selected)}
          />
        </div>
        <p className="text-[10.5px]" style={{ color: C.dim }}>
          Click a pad to hear and edit it · drop audio files onto pads · play with A S D F G H J K L ; and Q W E R T Y · pads in the same choke group cut each other off
        </p>
      </div>
    </div>
  );
}

// --- header ---

function useKits(): DrumKitPreset[] {
  return useSyncExternalStore(subscribeDrumKits, allDrumKits, serverDrumKits);
}

function Header({
  channelName,
  kit,
  update,
  begin,
  onClose,
}: {
  channelName: string;
  kit: DrumKitParams;
  update: (edit: (k: DrumKitParams) => void) => void;
  begin: () => void;
  onClose: () => void;
}) {
  const kits = useKits();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const idx = kits.findIndex((k) => k.name === kit.kit);
  const load = (preset: DrumKitPreset) => {
    begin();
    update((k) => Object.assign(k, structuredClone(preset.kit)));
    setOpen(false);
  };
  const step = (d: number) => {
    const next = kits[(Math.max(0, idx) + d + kits.length) % kits.length];
    if (next) load(next);
  };
  const btn = "flex h-7 w-6 items-center justify-center rounded-md hover:bg-white/5";
  return (
    <header className="flex items-center gap-3">
      <DrumMark />
      <div className="flex flex-col leading-none">
        <h2 className={`${fraunces.className} text-[19px] font-semibold`}>Drum Rack</h2>
        <span className="mt-0.5 text-[10px]" style={{ color: C.muted }}>
          {channelName}
        </span>
      </div>
      <div className="relative ml-2 flex items-center gap-0.5 rounded-lg px-1" style={{ border: `1px solid ${C.border}`, background: C.panel }}>
        <button type="button" title="Previous kit" className={btn} onClick={() => step(-1)}>
          <ChevronLeft size={14} color={C.muted} />
        </button>
        <button type="button" title="Browse kits" onClick={() => setOpen((o) => !o)} className="flex h-7 w-44 items-center justify-between px-1.5 text-[12.5px] font-semibold">
          <span className="truncate">{kit.kit ?? "Custom"}</span>
          <ChevronDown size={13} color={C.muted} />
        </button>
        <button type="button" title="Next kit" className={btn} onClick={() => step(1)}>
          <ChevronRight size={14} color={C.muted} />
        </button>
        <button type="button" title="Save this kit" className={btn} onClick={() => setSaving(true)}>
          <Save size={13} color={C.muted} />
        </button>
        {open && <KitList kits={kits} current={kit.kit} onLoad={load} onClose={() => setOpen(false)} />}
        {saving && (
          <SaveKit
            initial={kit.kit && !kits.find((k) => k.factory && k.name === kit.kit) ? kit.kit : ""}
            onSave={(name) => {
              const saved = saveDrumKit(name, kit);
              update((k) => (k.kit = saved.name));
              setSaving(false);
            }}
            onClose={() => setSaving(false)}
          />
        )}
      </div>
      <div className="ml-auto flex items-center gap-3">
        <PluginKnob
          label="Volume"
          value={kit.volume}
          min={LEVEL_MIN}
          max={LEVEL_MAX}
          defaultValue={0}
          mode="linear"
          size={30}
          layout="inline"
          onDragStart={begin}
          formatValue={fmtDb}
          onChange={(v) => update((k) => (k.volume = v))}
        />
        <button type="button" title="Close (Esc)" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-white/5">
          <X size={15} color={C.muted} />
        </button>
      </div>
    </header>
  );
}

function DrumMark() {
  return (
    <svg width={26} height={26} viewBox="0 0 26 26" aria-hidden="true">
      {[0, 1, 2, 3].map((r) =>
        [0, 1, 2, 3].map((c) => (
          <rect key={`${r}${c}`} x={2 + c * 6} y={2 + r * 6} width={4.6} height={4.6} rx={1.2} fill={r === 3 && c === 0 ? "#F2706B" : r + c === 3 ? "#E6AD5E" : "#3A3B48"} />
        ))
      )}
    </svg>
  );
}

function useOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, [ref, onClose]);
  useShortcuts("menu", [{ keys: "escape", run: onClose, whileTyping: true }]);
}

function KitList({ kits, current, onLoad, onClose }: { kits: DrumKitPreset[]; current?: string; onLoad: (k: DrumKitPreset) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, onClose);
  return (
    <div ref={ref} className="absolute left-0 top-9 z-50 max-h-[340px] w-[280px] overflow-y-auto rounded-xl p-1 shadow-2xl" style={{ background: C.raised, border: `1px solid ${C.border}` }}>
      {kits.map((k, i) => (
        <div key={k.id}>
          {i > 0 && kits[i - 1].factory && !k.factory && (
            <div className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.dim }}>
              Yours
            </div>
          )}
          <div className="group flex items-center rounded-md hover:bg-white/5">
            <button type="button" onClick={() => onLoad(k)} className="flex-1 px-2 py-1.5 text-left text-[12.5px]" style={{ color: k.name === current ? C.accent : C.text }}>
              {k.name}
            </button>
            {!k.factory && (
              <button
                type="button"
                title="Delete this kit"
                onClick={() => window.confirm(`Delete the kit "${k.name}"?`) && deleteDrumKit(k.id)}
                className="mr-1 hidden rounded p-1 hover:bg-black/30 group-hover:block"
              >
                <Trash2 size={12} color={C.muted} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SaveKit({ initial, onSave, onClose }: { initial: string; onSave: (name: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLFormElement>(null);
  useOutside(ref, onClose);
  const [name, setName] = useState(initial);
  return (
    <form
      ref={ref}
      className="absolute left-0 top-9 z-50 flex w-[280px] flex-col gap-2 rounded-xl p-3 shadow-2xl"
      style={{ background: C.raised, border: `1px solid ${C.border}` }}
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave(name);
      }}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.muted }}>
        Save kit
      </span>
      <input
        autoFocus
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="Name"
        aria-label="Kit name"
        className="rounded-md px-2 py-1.5 text-[12.5px] outline-none"
        style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }}
      />
      <p className="text-[10.5px]" style={{ color: C.dim }}>
        Saved in this browser. Pads with samples point at their files, which play in projects that include them.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md px-2.5 py-1 text-[11.5px]" style={{ color: C.muted }}>
          Cancel
        </button>
        <button type="submit" disabled={!name.trim()} className="rounded-md px-3 py-1 text-[11.5px] font-semibold disabled:opacity-40" style={{ background: C.accent, color: C.bg }}>
          Save
        </button>
      </div>
    </form>
  );
}

// --- pads ---

function PadGrid({
  kit,
  selected,
  lit,
  onSelect,
  onDropFile,
}: {
  kit: DrumKitParams;
  selected: number;
  lit: number;
  onSelect: (i: number) => void;
  onDropFile: (pad: number, file: File) => void;
}) {
  const [over, setOver] = useState<number | null>(null);
  // Rows top to bottom: pads 12-15, 8-11, 4-7, 0-3.
  const order = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3];
  return (
    <div className="grid shrink-0 grid-cols-4 gap-2 rounded-xl p-2" style={{ background: C.panel, border: `1px solid ${C.border}`, width: 440 }}>
      {order.map((i) => {
        const p = kit.pads[i];
        const color = padColor(p);
        const isLit = (lit >> i) & 1;
        const isSel = i === selected;
        const missing = p.source === "sample" && !p.sample;
        return (
          <button
            key={i}
            type="button"
            onPointerDown={() => onSelect(i)}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setOver(i);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const file = e.dataTransfer.files[0];
              if (file) onDropFile(i, file);
            }}
            title={`${p.name} (${noteName(padNote(i))}${keyFor(i) ? `, key ${keyFor(i)}` : ""}) · drop an audio file to use it here`}
            className="relative flex h-[92px] flex-col justify-between overflow-hidden rounded-lg p-2 text-left transition-colors"
            style={{
              background: isLit ? `${color}55` : over === i ? `${color}33` : C.raised,
              border: `1.5px solid ${isSel ? color : over === i ? color : C.border}`,
              opacity: p.mute ? 0.45 : 1,
              boxShadow: isLit ? `0 0 16px ${color}66` : undefined,
            }}
          >
            <span className="absolute left-0 top-0 h-full w-1" style={{ background: color }} />
            <span className="flex items-center justify-between pl-1 text-[10px] font-semibold" style={{ color: C.muted }}>
              <span>{noteName(padNote(i))}</span>
              {keyFor(i) && (
                <span className="rounded px-1 font-mono text-[9px]" style={{ border: `1px solid ${C.border}` }}>
                  {keyFor(i)}
                </span>
              )}
            </span>
            <span className="truncate pl-1 text-[12.5px] font-semibold" style={{ color: missing ? C.dim : C.text }}>
              {p.name}
            </span>
            <span className="flex items-center gap-1 pl-1 text-[9.5px] uppercase tracking-wider" style={{ color }}>
              {p.source === "sample" && p.sample ? <FileAudio size={10} /> : <Waves size={10} />}
              {p.source === "sample" && p.sample ? "Sample" : DRUM_MODEL_INFO[p.model].label}
              {p.choke > 0 && <span style={{ color: C.muted }}>· C{p.choke}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// --- pad editor ---

function Knob(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  def: number;
  fmt: (v: number) => string;
  onChange: (v: number) => void;
  begin: () => void;
  mode?: "linear" | "bipolar";
  disabled?: boolean;
}) {
  return (
    <PluginKnob
      label={props.label}
      value={props.value}
      min={props.min}
      max={props.max}
      defaultValue={props.def}
      mode={props.mode ?? "linear"}
      size={40}
      showReadout
      disabled={props.disabled}
      onDragStart={props.begin}
      formatValue={props.fmt}
      onChange={props.onChange}
    />
  );
}

function PadEditor({
  index,
  pad,
  setPad,
  begin,
  onLoadFile,
  onAudition,
}: {
  index: number;
  pad: DrumPadParams;
  setPad: (edit: (p: DrumPadParams) => void) => void;
  begin: () => void;
  onLoadFile: (f: File) => void;
  onAudition: () => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const isSample = pad.source === "sample";
  const info = DRUM_MODEL_INFO[pad.model];
  const now = (edit: (p: DrumPadParams) => void) => {
    begin();
    setPad(edit);
  };
  const color = padColor(pad);
  const seg = (on: boolean) => ({
    background: on ? "rgba(230,173,94,0.18)" : "transparent",
    color: on ? C.accent : C.muted,
  });
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-xl p-3" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-sm" style={{ background: color }} />
        <input
          value={pad.name}
          maxLength={24}
          onFocus={begin}
          onChange={(e) => setPad((p) => (p.name = e.target.value || "Pad"))}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label="Pad name"
          className="w-40 rounded-md bg-transparent px-1.5 py-0.5 text-[15px] font-semibold outline-none focus:bg-black/20"
          style={{ color: C.text }}
        />
        <span className="font-mono text-[11px]" style={{ color: C.muted }}>
          {noteName(padNote(index))}
        </span>
        <button type="button" onClick={onAudition} className="rounded-md px-2 py-0.5 text-[11px]" style={{ border: `1px solid ${C.border}`, color: C.muted }} title="Play this pad">
          ▶ Play
        </button>
        <div className="ml-auto flex overflow-hidden rounded-md" style={{ border: `1px solid ${C.border}` }} role="radiogroup" aria-label="Source">
          {(["synth", "sample"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={pad.source === s}
              onClick={() => {
                if (s === "sample" && !pad.sample) file.current?.click();
                else now((p) => (p.source = s));
              }}
              className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide"
              style={seg(pad.source === s)}
            >
              {s === "synth" ? "Synth" : "Sample"}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={pad.mute}
          onClick={() => now((p) => (p.mute = !p.mute))}
          className="rounded-md px-2 py-1 text-[11px] font-semibold uppercase"
          style={{ border: `1px solid ${pad.mute ? "#FF6B6B" : C.border}`, color: pad.mute ? "#FF6B6B" : C.muted }}
        >
          Mute
        </button>
      </div>

      {isSample ? (
        <SampleSection pad={pad} setPad={setPad} begin={begin} onPick={() => file.current?.click()} />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-5 gap-1">
            {DRUM_MODELS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => now((p) => (p.model = m))}
                className="rounded-md px-1.5 py-1 text-[11px] font-semibold"
                style={{
                  border: `1px solid ${pad.model === m ? MODEL_COLORS[m] : C.border}`,
                  color: pad.model === m ? MODEL_COLORS[m] : C.muted,
                  background: pad.model === m ? `${MODEL_COLORS[m]}1f` : "transparent",
                }}
              >
                {DRUM_MODEL_INFO[m].label}
              </button>
            ))}
          </div>
          <p className="text-[11px]" style={{ color: C.muted }}>
            {info.hint}
          </p>
          <div className="flex justify-between">
            <Knob label="Tune" value={pad.tune} min={-24} max={24} def={0} mode="bipolar" fmt={fmtSt} begin={begin} onChange={(v) => setPad((p) => (p.tune = Math.round(v * 10) / 10))} />
            <Knob label="Decay" value={pad.decay} min={0} max={1} def={0.5} fmt={fmtPct} begin={begin} onChange={(v) => setPad((p) => (p.decay = v))} />
            <Knob label={info.tone} value={pad.tone} min={0} max={1} def={0.5} fmt={fmtPct} begin={begin} onChange={(v) => setPad((p) => (p.tone = v))} />
            <Knob label={info.character} value={pad.character} min={0} max={1} def={0.5} fmt={fmtPct} begin={begin} onChange={(v) => setPad((p) => (p.character = v))} />
            <Knob label="Drive" value={pad.drive} min={0} max={1} def={0} fmt={fmtPct} begin={begin} onChange={(v) => setPad((p) => (p.drive = v))} />
          </div>
        </div>
      )}

      <div className="h-px" style={{ background: C.border }} />

      <div className="flex justify-between">
        <Knob label="Level" value={pad.level} min={LEVEL_MIN} max={LEVEL_MAX} def={-6} fmt={fmtDb} begin={begin} onChange={(v) => setPad((p) => (p.level = v))} />
        <Knob label="Pan" value={pad.pan} min={-1} max={1} def={0} mode="bipolar" fmt={fmtPan} begin={begin} onChange={(v) => setPad((p) => (p.pan = v))} />
        <Knob label="Filter" value={pad.filter} min={-1} max={1} def={0} mode="bipolar" fmt={fmtFilter} begin={begin} onChange={(v) => setPad((p) => (p.filter = Math.abs(v) < 0.01 ? 0 : v))} />
        <Knob label="Reso" value={pad.resonance} min={0} max={1} def={0.1} fmt={fmtPct} begin={begin} disabled={pad.filter === 0} onChange={(v) => setPad((p) => (p.resonance = v))} />
        <Knob label="Velocity" value={pad.velocity} min={0} max={1} def={0.7} fmt={fmtPct} begin={begin} onChange={(v) => setPad((p) => (p.velocity = v))} />
      </div>

      <div className="flex items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.13em]" style={{ color: C.muted }} title="Pads in the same group cut each other off (an open and a closed hi-hat)">
          Choke
        </span>
        <div className="flex overflow-hidden rounded-md" style={{ border: `1px solid ${C.border}` }} role="radiogroup" aria-label="Choke group">
          {Array.from({ length: CHOKE_GROUPS + 1 }, (_, g) => (
            <button key={g} type="button" role="radio" aria-checked={pad.choke === g} onClick={() => now((p) => (p.choke = g))} className="px-2.5 py-1 text-[11px] font-semibold" style={seg(pad.choke === g)}>
              {g === 0 ? "Off" : g}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            title="Copy this pad"
            onClick={() => {
              clipboard = structuredClone(pad);
            }}
          >
            <Copy size={13} />
          </IconButton>
          <IconButton title="Paste a copied pad here" onClick={() => clipboard && now((p) => Object.assign(p, structuredClone(clipboard!)))}>
            <ClipboardPaste size={13} />
          </IconButton>
          <IconButton title="Back to this pad's default sound" onClick={() => now((p) => Object.assign(p, defaultKitPads()[index]))}>
            <RotateCcw size={13} />
          </IconButton>
        </div>
      </div>

      <input
        ref={file}
        type="file"
        accept="audio/*,.wav,.aif,.aiff,.mp3,.ogg,.flac"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onLoadFile(f);
        }}
      />
    </div>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-white/5" style={{ color: C.muted, border: `1px solid ${C.border}` }}>
      {children}
    </button>
  );
}

// --- sample ---

function SampleSection({ pad, setPad, begin, onPick }: { pad: DrumPadParams; setPad: (edit: (p: DrumPadParams) => void) => void; begin: () => void; onPick: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <FileAudio size={14} color={SAMPLE_COLOR} />
        <span className="truncate text-[12px]" title={pad.sample?.name}>
          {pad.sample?.name ?? "No sample"}
        </span>
        <button type="button" onClick={onPick} className="ml-auto flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]" style={{ border: `1px solid ${C.border}`, color: C.muted }}>
          <Upload size={11} /> Replace…
        </button>
        <button
          type="button"
          aria-pressed={pad.reverse}
          onClick={() => {
            begin();
            setPad((p) => (p.reverse = !p.reverse));
          }}
          className="rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase"
          style={{ border: `1px solid ${pad.reverse ? C.accent : C.border}`, color: pad.reverse ? C.accent : C.muted }}
        >
          Reverse
        </button>
      </div>
      {pad.sample && <SampleWave id={pad.sample.id} start={pad.start} reverse={pad.reverse} onStart={(v) => setPad((p) => (p.start = v))} begin={begin} />}
      <div className="flex justify-around">
        <Knob label="Tune" value={pad.tune} min={-24} max={24} def={0} mode="bipolar" fmt={fmtSt} begin={begin} onChange={(v) => setPad((p) => (p.tune = Math.round(v * 10) / 10))} />
        <Knob label="Decay" value={pad.decay} min={0} max={1} def={1} fmt={(v) => (v >= 0.98 ? "Full" : fmtPct(v))} begin={begin} onChange={(v) => setPad((p) => (p.decay = v))} />
        <Knob label="Start" value={pad.start} min={0} max={0.99} def={0} fmt={fmtPct} begin={begin} onChange={(v) => setPad((p) => (p.start = v))} />
        <Knob label="Drive" value={pad.drive} min={0} max={1} def={0} fmt={fmtPct} begin={begin} onChange={(v) => setPad((p) => (p.drive = v))} />
      </div>
    </div>
  );
}

const WAVE_W = 480;
const WAVE_H = 64;

/** The sample's waveform, with its start point (drag to move it). */
function SampleWave({ id, start, reverse, onStart, begin }: { id: string; start: number; reverse: boolean; onStart: (v: number) => void; begin: () => void }) {
  const [data, setData] = useState<{ id: string; peaks: Float32Array } | null>(null);
  useEffect(() => {
    let alive = true;
    void loadDrumSample(id, 48000).then((chans) => {
      if (!alive || !chans) return;
      const src = chans[0];
      const peaks = new Float32Array(WAVE_W);
      const per = Math.max(1, Math.floor(src.length / WAVE_W));
      for (let x = 0; x < WAVE_W; x++) {
        let m = 0;
        for (let i = x * per; i < Math.min(src.length, (x + 1) * per); i++) m = Math.max(m, Math.abs(src[i]));
        peaks[x] = m;
      }
      setData({ id, peaks });
    });
    return () => {
      alive = false;
    };
  }, [id]);
  const peaks = data?.id === id ? data.peaks : null;
  const path = useMemo(() => {
    if (!peaks) return "";
    let top = "";
    let bottom = "";
    for (let x = 0; x < WAVE_W; x++) {
      const v = peaks[reverse ? WAVE_W - 1 - x : x];
      top += `${x === 0 ? "M" : "L"}${x} ${(WAVE_H / 2 - v * (WAVE_H / 2 - 2)).toFixed(1)} `;
      bottom = `L${x} ${(WAVE_H / 2 + v * (WAVE_H / 2 - 2)).toFixed(1)} ` + bottom;
    }
    return `${top}${bottom}Z`;
  }, [peaks, reverse]);
  const drag = useRef(false);
  const set = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onStart(Math.min(0.99, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  return (
    <svg
      viewBox={`0 0 ${WAVE_W} ${WAVE_H}`}
      className="h-16 w-full cursor-ew-resize rounded-md"
      style={{ background: C.bg }}
      preserveAspectRatio="none"
      aria-label="Sample waveform: drag to set where it starts"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = true;
        begin();
        set(e);
      }}
      onPointerMove={(e) => drag.current && set(e)}
      onPointerUp={() => (drag.current = false)}
    >
      <rect x={0} y={0} width={start * WAVE_W} height={WAVE_H} fill="rgba(0,0,0,0.45)" />
      {path ? <path d={path} fill={SAMPLE_COLOR} fillOpacity={0.75} /> : <text x={WAVE_W / 2} y={WAVE_H / 2 + 4} fill={C.dim} fontSize={11} textAnchor="middle">Loading…</text>}
      <line x1={start * WAVE_W} x2={start * WAVE_W} y1={0} y2={WAVE_H} stroke={C.accent} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

