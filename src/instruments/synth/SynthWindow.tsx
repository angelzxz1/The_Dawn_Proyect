"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Save, Search, Trash2, Upload, X } from "lucide-react";
import { audioEngine } from "@/lib/audioEngine";
import { newEffectFileId, registerEffectFile } from "@/effects/effectFiles";
import type { SynthLiveState } from "./synth";
import {
  DEST_SPECS,
  FILTER_LABELS,
  FILTER_MORPH_LABEL,
  FILTER_TYPES,
  LFO_DIVISIONS,
  LFO_MODES,
  LFO_MODE_LABELS,
  LFO_RATE_MAX,
  LFO_RATE_MIN,
  LFO_SHAPES,
  LFO_SHAPE_LABELS,
  MAX_MODS,
  MAX_POLYPHONY,
  MAX_UNISON,
  MOD_SOURCES,
  MOD_SOURCE_LABELS,
  OSC_DESTS,
  OSC_DEST_LABELS,
  SUB_SHAPES,
  VOICE_MODES,
  VOLUME_MAX,
  VOLUME_MIN,
  WARP_LABELS,
  WARP_MODES,
  newModId,
  type ModDest,
  type ModSource,
  type SynthOscParams,
  type SynthParams,
} from "./synthParams";
import {
  PRESET_CATEGORIES,
  allSynthPresets,
  deleteSynthPreset,
  presetParams,
  saveSynthPreset,
  serverSynthPresets,
  subscribeSynthPresets,
  type PresetCategory,
  type SynthPreset,
} from "./synthPresets";
import { WAVETABLE_IDS, WAVETABLE_INFO } from "./wavetableModel";
import { fraunces, spaceGrotesk } from "@/effects/ui/pluginFonts";
import type { TrackColor } from "@/lib/colors";
import { EnvelopeEditor, FilterView, LfoView, Scope, WavetableView } from "./SynthDisplays";
import {
  ModRow,
  Panel,
  SOURCE_COLORS,
  SYN,
  Segmented,
  Select,
  SourceHandle,
  SynthContext,
  SynthKnob,
  fmt,
  useLiveFrames,
  useSynth,
} from "./SynthUi";
import { useShortcuts } from "@/lib/shortcuts";

interface SynthWindowProps {
  channelId: string;
  channelName: string;
  color: TrackColor;
  params: SynthParams;
  onChange: (params: SynthParams) => void;
  onClose: () => void;
  /** Fired once at the start of each edit gesture (one undo step each). */
  onDragStart?: () => void;
}

const W = 1180;
const H = 740;

/** Daybreak, the synth's full window. */
export function SynthWindow({ channelId, channelName, params, onChange, onClose, onDragStart }: SynthWindowProps) {
  const live = useRef<SynthLiveState | null>(null);
  useEffect(() => {
    const stop = audioEngine.watchSynth(channelId, (s) => {
      live.current = s;
    });
    return () => {
      stop();
      live.current = null;
    };
  }, [channelId]);
  const onFrame = useLiveFrames(live);
  const [dragging, setDragging] = useState<ModSource | null>(null);
  const [focus, setFocus] = useState<ModSource | null>(null);
  const [tab, setTab] = useState<"synth" | "matrix">("synth");
  const latest = useRef(params);
  useEffect(() => {
    latest.current = params;
  }, [params]);
  const update = useCallback(
    (edit: (p: SynthParams) => void) => {
      const next = structuredClone(latest.current);
      edit(next);
      latest.current = next;
      onChange(next);
    },
    [onChange]
  );
  const begin = useCallback(() => onDragStart?.(), [onDragStart]);
  const ctx = useMemo(
    () => ({ params, update, begin, live, onFrame, dragging, setDragging, focus, setFocus }),
    [params, update, begin, onFrame, dragging, focus]
  );

  useShortcuts("window", [{ keys: "escape", run: onClose }]);

  const scale = useFitScale();

  return (
    <SynthContext.Provider value={ctx}>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65" onPointerDown={(e) => e.target === e.currentTarget && setFocus(null)}>
        <div style={{ width: W * scale, height: H * scale }}>
          <div
            role="dialog"
            aria-label={`Daybreak synth - ${channelName}`}
            className={`${spaceGrotesk.className} flex flex-col gap-2.5 rounded-2xl p-3 shadow-2xl`}
            style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: "top left", background: SYN.bg, border: `1px solid ${SYN.border}`, color: SYN.text }}
            onClick={() => focus && setFocus(null)}
          >
            <Header channelName={channelName} tab={tab} onTab={setTab} onClose={onClose} />
            {tab === "synth" ? (
              <>
                <div className="flex gap-2.5" style={{ height: 346 }}>
                  <div className="flex flex-col gap-2.5" style={{ width: 572 }}>
                    <OscPanel index={0} />
                    <OscPanel index={1} />
                  </div>
                  <div className="flex flex-col gap-2.5" style={{ width: 330 }}>
                    <FilterPanel index={0} />
                    <FilterPanel index={1} />
                  </div>
                  <div className="flex flex-col gap-2.5" style={{ width: 234 }}>
                    <SubPanel />
                    <NoisePanel />
                    <VoicePanel />
                  </div>
                </div>
                <div className="flex gap-2.5" style={{ height: 300 }}>
                  <EnvelopePanel />
                  <LfoPanel />
                  <SourcesPanel />
                </div>
              </>
            ) : (
              <MatrixTab />
            )}
          </div>
        </div>
      </div>
    </SynthContext.Provider>
  );
}

/** Shrinks the window to fit small screens. */
function useFitScale(): number {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("resize", cb);
      return () => window.removeEventListener("resize", cb);
    },
    () => Math.min(1, (window.innerWidth - 24) / W, (window.innerHeight - 24) / H),
    () => 1
  );
}

// --- header ---

function SunMark() {
  return (
    <svg width={26} height={26} viewBox="0 0 26 26" aria-hidden="true">
      <defs>
        <linearGradient id="dbk-sun" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#F5A45D" />
          <stop offset="0.55" stopColor="#F2706B" />
          <stop offset="1" stopColor="#9B7CF4" />
        </linearGradient>
      </defs>
      <path d="M4 17a9 9 0 0 1 18 0z" fill="url(#dbk-sun)" />
      <path d="M2 20h22M5 23h16" stroke="url(#dbk-sun)" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  );
}

function Header({ channelName, tab, onTab, onClose }: { channelName: string; tab: "synth" | "matrix"; onTab: (t: "synth" | "matrix") => void; onClose: () => void }) {
  const ui = useSynth();
  const [voices, setVoices] = useState(0);
  useEffect(() => ui.onFrame((s) => setVoices(s?.voices ?? 0)), [ui]);
  const v = ui.params.voice;
  return (
    <header className="flex h-[46px] shrink-0 items-center gap-3 rounded-xl px-3" style={{ background: SYN.panel, border: `1px solid ${SYN.border}` }}>
      <SunMark />
      <div className="flex flex-col leading-none">
        <span className={`${fraunces.className} text-[19px] font-semibold`} style={{ backgroundImage: SYN.gradient, WebkitBackgroundClip: "text", color: "transparent" }}>
          Daybreak
        </span>
        <span className="mt-0.5 text-[10px]" style={{ color: SYN.muted }}>
          wavetable synth · {channelName}
        </span>
      </div>
      <PresetBar />
      <Segmented
        options={["synth", "matrix"] as const}
        value={tab}
        onChange={onTab}
        labels={(t) => (t === "synth" ? "Synth" : `Matrix${ui.params.mods.length ? ` · ${ui.params.mods.length}` : ""}`)}
      />
      <div className="ml-auto flex items-center gap-3">
        <span className="w-14 text-right font-mono text-[10px]" style={{ color: voices ? SYN.accent : SYN.dim }} title="Notes sounding">
          {voices} {voices === 1 ? "voice" : "voices"}
        </span>
        <Scope width={132} height={32} />
        <div className="w-[92px]">
          <SynthKnob
            inline
            label="Volume"
            dest="voice.volume"
            value={v.volume}
            min={VOLUME_MIN}
            max={VOLUME_MAX}
            defaultValue={-6}
            size={30}
            format={fmt.db}
            onChange={(x) => ui.update((p) => (p.voice.volume = x))}
          />
        </div>
        <button type="button" title="Close (Esc)" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-white/5">
          <X size={15} color={SYN.muted} />
        </button>
      </div>
    </header>
  );
}

// --- presets ---

function usePresets(): SynthPreset[] {
  return useSyncExternalStore(subscribeSynthPresets, allSynthPresets, serverSynthPresets);
}

function PresetBar() {
  const ui = useSynth();
  const presets = usePresets();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const name = ui.params.preset ?? "Custom";
  const idx = presets.findIndex((p) => p.name === ui.params.preset);
  const load = (p: SynthPreset) => {
    ui.begin();
    ui.update((draft) => Object.assign(draft, presetParams(p)));
    setOpen(false);
  };
  const step = (d: number) => {
    const next = presets[(Math.max(0, idx) + d + presets.length) % presets.length];
    if (next) load(next);
  };
  const btn = "flex h-7 w-6 items-center justify-center rounded-md hover:bg-white/5";
  return (
    <div className="relative flex items-center gap-0.5 rounded-lg px-1" style={{ border: `1px solid ${SYN.border}`, background: SYN.bg }}>
      <button type="button" title="Previous preset" className={btn} onClick={() => step(-1)}>
        <ChevronLeft size={14} color={SYN.muted} />
      </button>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-7 w-48 items-center justify-between gap-1 px-1.5 text-[12.5px] font-semibold" title="Browse presets">
        <span className="truncate">{name}</span>
        <ChevronDown size={13} color={SYN.muted} />
      </button>
      <button type="button" title="Next preset" className={btn} onClick={() => step(1)}>
        <ChevronRight size={14} color={SYN.muted} />
      </button>
      <button type="button" title="Save as a preset" className={btn} onClick={() => setSaving(true)}>
        <Save size={13} color={SYN.muted} />
      </button>
      {open && <PresetBrowser presets={presets} current={ui.params.preset} onLoad={load} onClose={() => setOpen(false)} />}
      {saving && <SavePreset onClose={() => setSaving(false)} />}
    </div>
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

function PresetBrowser({ presets, current, onLoad, onClose }: { presets: SynthPreset[]; current?: string; onLoad: (p: SynthPreset) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, onClose);
  const [cat, setCat] = useState<PresetCategory | "All" | "Yours">("All");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const list = presets.filter(
    (p) => (cat === "All" || (cat === "Yours" ? !p.factory : p.category === cat)) && (!q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
  );
  return (
    <div ref={ref} className="absolute left-0 top-9 z-50 flex h-[380px] w-[440px] overflow-hidden rounded-xl shadow-2xl" style={{ background: SYN.panelHi, border: `1px solid ${SYN.border}` }}>
      <div className="flex w-[110px] shrink-0 flex-col gap-0.5 p-2" style={{ borderRight: `1px solid ${SYN.border}` }}>
        {(["All", ...PRESET_CATEGORIES, "Yours"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCat(c)}
            className="rounded-md px-2 py-1 text-left text-[12px]"
            style={{ background: cat === c ? "rgba(245,164,93,0.15)" : "transparent", color: cat === c ? SYN.accent : SYN.text }}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5 px-2 py-2" style={{ borderBottom: `1px solid ${SYN.border}` }}>
          <Search size={12} color={SYN.muted} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Search presets"
            className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
            style={{ color: SYN.text }}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {list.length === 0 && (
            <p className="p-3 text-[12px]" style={{ color: SYN.muted }}>
              {cat === "Yours" ? "Nothing saved yet. Use the save button to keep a sound." : "No presets match."}
            </p>
          )}
          {list.map((p) => (
            <div key={p.id} className="group flex items-center rounded-md hover:bg-white/5">
              <button type="button" onClick={() => onLoad(p)} className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-1.5 text-left">
                <span className="truncate text-[12.5px]" style={{ color: p.name === current ? SYN.accent : SYN.text }}>
                  {p.name}
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wider" style={{ color: SYN.dim }}>
                  {p.factory ? p.category : `yours · ${p.category}`}
                </span>
              </button>
              {!p.factory && (
                <button
                  type="button"
                  title="Delete this preset"
                  onClick={() => window.confirm(`Delete the preset "${p.name}"?`) && deleteSynthPreset(p.id)}
                  className="mr-1 hidden rounded p-1 hover:bg-black/30 group-hover:block"
                >
                  <Trash2 size={12} color={SYN.muted} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SavePreset({ onClose }: { onClose: () => void }) {
  const ui = useSynth();
  const ref = useRef<HTMLFormElement>(null);
  useOutside(ref, onClose);
  const [name, setName] = useState(ui.params.preset && ui.params.preset !== "Init" ? ui.params.preset : "");
  const [cat, setCat] = useState<PresetCategory>("Lead");
  return (
    <form
      ref={ref}
      className="absolute left-0 top-9 z-50 flex w-[300px] flex-col gap-2 rounded-xl p-3 shadow-2xl"
      style={{ background: SYN.panelHi, border: `1px solid ${SYN.border}` }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        const saved = saveSynthPreset(name, cat, ui.params);
        ui.update((p) => (p.preset = saved.name));
        onClose();
      }}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: SYN.muted }}>
        Save preset
      </span>
      <input
        autoFocus
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="Name"
        aria-label="Preset name"
        className="rounded-md px-2 py-1.5 text-[12.5px] outline-none"
        style={{ background: SYN.bg, border: `1px solid ${SYN.border}`, color: SYN.text }}
      />
      <div className="flex flex-wrap gap-1">
        {PRESET_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCat(c)}
            className="rounded-md px-2 py-0.5 text-[11px]"
            style={{ border: `1px solid ${cat === c ? SYN.accent : SYN.border}`, color: cat === c ? SYN.accent : SYN.muted }}
          >
            {c}
          </button>
        ))}
      </div>
      <p className="text-[10.5px]" style={{ color: SYN.dim }}>
        Saved in this browser. A preset with the same name is replaced.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md px-2.5 py-1 text-[11.5px]" style={{ color: SYN.muted }}>
          Cancel
        </button>
        <button type="submit" disabled={!name.trim()} className="rounded-md px-3 py-1 text-[11.5px] font-semibold disabled:opacity-40" style={{ background: SYN.accent, color: SYN.bg }}>
          Save
        </button>
      </div>
    </form>
  );
}

// --- oscillators ---

const TABLE_OPTIONS = WAVETABLE_IDS.map((id) => ({ value: id as string, label: WAVETABLE_INFO[id].name, group: WAVETABLE_INFO[id].group }));

function OscPanel({ index }: { index: 0 | 1 }) {
  const ui = useSynth();
  const key = index === 0 ? "osc1" : "osc2";
  const o = ui.params[key];
  const n = index + 1;
  const set = (edit: (x: SynthOscParams) => void) => ui.update((p) => edit(p[key]));
  const setNow = (edit: (x: SynthOscParams) => void) => {
    ui.begin();
    set(edit);
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const tableIdx = WAVETABLE_IDS.indexOf(o.table);
  const stepTable = (d: number) =>
    setNow((x) => {
      x.table = WAVETABLE_IDS[(tableIdx + d + WAVETABLE_IDS.length) % WAVETABLE_IDS.length];
      delete x.userTable;
    });
  const d = (k: string) => `osc${n}.${k}` as ModDest;
  const partner = index === 0 ? "Osc 2" : "Osc 1";
  return (
    <Panel
      title={`Osc ${n}`}
      on={o.on}
      onToggle={() => setNow((x) => (x.on = !x.on))}
      className="flex-1"
      right={
        <>
          <button type="button" title="Previous wavetable" onClick={() => stepTable(-1)} className="rounded p-0.5 hover:bg-white/5">
            <ChevronLeft size={12} color={SYN.muted} />
          </button>
          <Select
            title="Wavetable"
            width={138}
            value={o.userTable ? "user" : o.table}
            options={[...(o.userTable ? [{ value: "user", label: `⤓ ${o.userTable.name}`, group: "Imported" }] : []), ...TABLE_OPTIONS]}
            onChange={(v) =>
              v !== "user" &&
              setNow((x) => {
                x.table = v as SynthOscParams["table"];
                delete x.userTable;
              })
            }
          />
          <button type="button" title="Next wavetable" onClick={() => stepTable(1)} className="rounded p-0.5 hover:bg-white/5">
            <ChevronRight size={12} color={SYN.muted} />
          </button>
          <button
            type="button"
            title="Import a wavetable from an audio file (cut into 2048-sample cycles)"
            onClick={() => fileInput.current?.click()}
            className="rounded p-1 hover:bg-white/5"
          >
            <Upload size={12} color={SYN.muted} />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,.wav"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const id = newEffectFileId();
              registerEffectFile(id, file);
              setNow((x) => (x.userTable = { id, name: file.name.replace(/\.[^.]+$/, "").slice(0, 40) }));
            }}
          />
          <span className="mx-0.5 h-4 w-px" style={{ background: SYN.border }} />
          <Segmented small options={OSC_DESTS} value={o.dest} onChange={(v) => setNow((x) => (x.dest = v))} labels={(v) => OSC_DEST_LABELS[v]} title="Where it goes: filter 1, filter 2, both, or straight out" />
        </>
      }
    >
      <div className="flex w-full items-center gap-2 p-2">
        <div className="flex flex-col gap-1">
          <WavetableView osc={o} index={index} width={196} height={100} />
          <div className="flex items-center gap-1">
            <span className="text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: SYN.muted }}>
              Warp
            </span>
            <Select
              title="Warp: bends how the wave is read (FM and Ring use the other oscillator)"
              width={90}
              value={o.warp}
              options={WARP_MODES.map((w) => ({ value: w, label: w === "fm" || w === "rm" ? `${WARP_LABELS[w]} ← ${partner}` : WARP_LABELS[w] }))}
              onChange={(v) => setNow((x) => (x.warp = v))}
            />
          </div>
        </div>
        <div className="grid flex-1 grid-cols-6 gap-y-1">
          <SynthKnob label="Position" dest={d("position")} value={o.position} min={0} max={1} defaultValue={0.5} format={fmt.pct} size={32} onChange={(v) => set((x) => (x.position = v))} />
          <SynthKnob label="Warp" dest={d("warpAmount")} value={o.warpAmount} min={0} max={1} defaultValue={0} format={fmt.pct} size={32} disabled={o.warp === "none"} onChange={(v) => set((x) => (x.warpAmount = v))} />
          <SynthKnob label="Pitch" dest={d("transpose")} value={o.transpose} min={-48} max={48} step={1} defaultValue={0} format={fmt.st} size={32} onChange={(v) => set((x) => (x.transpose = v))} />
          <SynthKnob label="Fine" dest={d("fine")} value={o.fine} min={-100} max={100} defaultValue={0} format={fmt.ct} size={32} onChange={(v) => set((x) => (x.fine = v))} />
          <SynthKnob label="Level" dest={d("level")} value={o.level} min={0} max={1} defaultValue={0.7} format={fmt.pct} size={32} onChange={(v) => set((x) => (x.level = v))} />
          <SynthKnob label="Pan" dest={d("pan")} value={o.pan} min={-1} max={1} defaultValue={0} format={fmt.pan} size={32} onChange={(v) => set((x) => (x.pan = v))} />
          <SynthKnob label="Unison" value={o.unison} min={1} max={MAX_UNISON} step={1} defaultValue={1} format={fmt.int} size={32} onChange={(v) => set((x) => (x.unison = v))} />
          <SynthKnob label="Detune" dest={d("detune")} value={o.detune} min={0} max={1} defaultValue={0.25} format={fmt.pct} size={32} disabled={o.unison < 2} onChange={(v) => set((x) => (x.detune = v))} />
          <SynthKnob label="Blend" dest={d("blend")} value={o.blend} min={0} max={1} defaultValue={0.75} format={fmt.pct} size={32} disabled={o.unison < 3} onChange={(v) => set((x) => (x.blend = v))} />
          <SynthKnob label="Width" dest={d("width")} value={o.width} min={0} max={1} defaultValue={0.8} format={fmt.pct} size={32} disabled={o.unison < 2} onChange={(v) => set((x) => (x.width = v))} />
          <SynthKnob label="Phase" value={o.phase} min={0} max={1} defaultValue={0} format={(v) => `${Math.round(v * 360)}°`} size={32} onChange={(v) => set((x) => (x.phase = v))} />
          <SynthKnob label="Rand" value={o.randomPhase} min={0} max={1} defaultValue={1} format={fmt.pct} size={32} title="How much each note's start in the wave is randomized" onChange={(v) => set((x) => (x.randomPhase = v))} />
        </div>
      </div>
    </Panel>
  );
}

// --- filters ---

function FilterPanel({ index }: { index: 0 | 1 }) {
  const ui = useSynth();
  const key = index === 0 ? "filter1" : "filter2";
  const f = ui.params[key];
  const n = index + 1;
  const set = (edit: (x: SynthParams["filter1"]) => void) => ui.update((p) => edit(p[key]));
  const setNow = (edit: (x: SynthParams["filter1"]) => void) => {
    ui.begin();
    set(edit);
  };
  const d = (k: string) => `filter${n}.${k}` as ModDest;
  const morphLabel = FILTER_MORPH_LABEL[f.type];
  return (
    <Panel
      title={`Filter ${n}`}
      on={f.on}
      onToggle={() => setNow((x) => (x.on = !x.on))}
      className="flex-1"
      right={
        <>
          {index === 1 && (
            <Segmented
              small
              options={["serial", "parallel"] as const}
              value={ui.params.filterRouting}
              onChange={(v) => {
                ui.begin();
                ui.update((p) => (p.filterRouting = v));
              }}
              labels={(v) => (v === "serial" ? "1 → 2" : "1 | 2")}
              title="Serial: filter 1 feeds filter 2. Parallel: side by side."
            />
          )}
          <Select
            title="Filter type"
            width={92}
            value={f.type}
            options={FILTER_TYPES.map((t) => ({ value: t, label: FILTER_LABELS[t] }))}
            onChange={(v) => setNow((x) => (x.type = v))}
          />
        </>
      }
    >
      <div className="flex w-full items-center gap-2 p-2">
        <FilterView filter={f} index={index} width={122} height={112} />
        <div className="grid flex-1 grid-cols-3 gap-y-1">
          <SynthKnob label="Cutoff" dest={d("cutoff")} value={f.cutoff} min={20} max={20000} defaultValue={20000} format={fmt.hz} size={32} onChange={(v) => set((x) => (x.cutoff = v))} />
          <SynthKnob label="Reso" dest={d("resonance")} value={f.resonance} min={0} max={1} defaultValue={0.1} format={fmt.pct} size={32} onChange={(v) => set((x) => (x.resonance = v))} />
          <SynthKnob label="Drive" dest={d("drive")} value={f.drive} min={0} max={1} defaultValue={0} format={(v) => `+${(v * 24).toFixed(1)} dB`} size={32} onChange={(v) => set((x) => (x.drive = v))} />
          <SynthKnob label={morphLabel ?? "Morph"} dest={d("morph")} value={f.morph} min={0} max={1} defaultValue={0} format={fmt.pct} size={32} disabled={!morphLabel} onChange={(v) => set((x) => (x.morph = v))} />
          <SynthKnob label="Key" value={f.keytrack} min={0} max={1} defaultValue={0} format={fmt.pct} size={32} title="How far the cutoff follows the note" onChange={(v) => set((x) => (x.keytrack = v))} />
          <SynthKnob label="Mix" dest={d("mix")} value={f.mix} min={0} max={1} defaultValue={1} format={fmt.pct} size={32} onChange={(v) => set((x) => (x.mix = v))} />
        </div>
      </div>
    </Panel>
  );
}

// --- sub, noise, voice ---

/** Where the sub or noise goes, laid out like a knob (label above). */
function DestPicker({ value, onChange }: { value: (typeof OSC_DESTS)[number]; onChange: (v: (typeof OSC_DESTS)[number]) => void }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-[9.5px] font-semibold uppercase tracking-[0.1em]" style={{ color: SYN.muted }}>
        To
      </span>
      <Select title="Where it goes: filter 1, filter 2, both, or straight out" width={60} value={value} options={OSC_DESTS.map((v) => ({ value: v, label: OSC_DEST_LABELS[v] }))} onChange={onChange} />
    </div>
  );
}

function SubPanel() {
  const ui = useSynth();
  const s = ui.params.sub;
  const setNow = (edit: (x: SynthParams["sub"]) => void) => {
    ui.begin();
    ui.update((p) => edit(p.sub));
  };
  return (
    <Panel
      title="Sub"
      on={s.on}
      onToggle={() => setNow((x) => (x.on = !x.on))}
      style={{ height: 106 }}
      right={
        <>
          <Segmented small options={SUB_SHAPES} value={s.shape} onChange={(v) => setNow((x) => (x.shape = v))} labels={(v) => ({ sine: "Sin", triangle: "Tri", saw: "Saw", square: "Sqr" })[v]} />
        </>
      }
    >
      <div className="flex w-full items-center justify-around px-1">
        <SynthKnob label="Octave" value={s.octave} min={-2} max={0} step={1} defaultValue={-1} format={(v) => (v === 0 ? "0" : `${v} oct`)} size={30} onChange={(v) => ui.update((p) => (p.sub.octave = v))} />
        <SynthKnob label="Level" dest="sub.level" value={s.level} min={0} max={1} defaultValue={0.5} format={fmt.pct} size={30} onChange={(v) => ui.update((p) => (p.sub.level = v))} />
        <SynthKnob label="Pan" dest="sub.pan" value={s.pan} min={-1} max={1} defaultValue={0} format={fmt.pan} size={30} onChange={(v) => ui.update((p) => (p.sub.pan = v))} />
        <DestPicker value={s.dest} onChange={(v) => setNow((x) => (x.dest = v))} />
      </div>
    </Panel>
  );
}

function NoisePanel() {
  const ui = useSynth();
  const s = ui.params.noise;
  const setNow = (edit: (x: SynthParams["noise"]) => void) => {
    ui.begin();
    ui.update((p) => edit(p.noise));
  };
  return (
    <Panel
      title="Noise"
      on={s.on}
      onToggle={() => setNow((x) => (x.on = !x.on))}
      style={{ height: 100 }}
      right={
        <>
          <Segmented small options={["white", "pink"] as const} value={s.color} onChange={(v) => setNow((x) => (x.color = v))} labels={(v) => (v === "white" ? "White" : "Pink")} />
        </>
      }
    >
      <div className="flex w-full items-center justify-around px-1">
        <SynthKnob label="Level" dest="noise.level" value={s.level} min={0} max={1} defaultValue={0.25} format={fmt.pct} size={30} onChange={(v) => ui.update((p) => (p.noise.level = v))} />
        <SynthKnob label="Pan" dest="noise.pan" value={s.pan} min={-1} max={1} defaultValue={0} format={fmt.pan} size={30} onChange={(v) => ui.update((p) => (p.noise.pan = v))} />
        <DestPicker value={s.dest} onChange={(v) => setNow((x) => (x.dest = v))} />
      </div>
    </Panel>
  );
}

function VoicePanel() {
  const ui = useSynth();
  const v = ui.params.voice;
  const set = (edit: (x: SynthParams["voice"]) => void) => ui.update((p) => edit(p.voice));
  return (
    <Panel
      title="Voice"
      className="flex-1"
      right={
        <Segmented
          small
          options={VOICE_MODES}
          value={v.mode}
          onChange={(m) => {
            ui.begin();
            set((x) => (x.mode = m));
          }}
          labels={(m) => ({ poly: "Poly", mono: "Mono", legato: "Legato" })[m]}
          title="Poly plays chords. Mono plays one note at a time; Legato also doesn't restart the envelopes when notes overlap."
        />
      }
    >
      <div className="grid w-full grid-cols-3 content-center gap-y-0.5 px-1">
        <SynthKnob label="Voices" value={v.polyphony} min={1} max={MAX_POLYPHONY} step={1} defaultValue={8} format={fmt.int} size={26} disabled={v.mode !== "poly"} onChange={(x) => set((y) => (y.polyphony = x))} />
        <SynthKnob label="Glide" value={Math.max(v.glide, 0.001)} min={0.001} max={2} defaultValue={0.001} format={(x) => (x <= 0.0011 ? "Off" : fmt.time(x))} size={26} scale="log" onChange={(x) => set((y) => (y.glide = x <= 0.0011 ? 0 : x))} />
        <SynthKnob label="Pitch" dest="voice.transpose" value={v.transpose} min={-48} max={48} step={1} defaultValue={0} format={fmt.st} size={26} onChange={(x) => set((y) => (y.transpose = x))} />
        <SynthKnob label="Bend" value={v.bendRange} min={0} max={24} step={1} defaultValue={2} format={(x) => `±${x}`} size={26} title="Semitones for a full pitch bend" onChange={(x) => set((y) => (y.bendRange = x))} />
        <SynthKnob label="Vel" value={v.velocity} min={0} max={1} defaultValue={0.6} format={fmt.pct} size={26} title="How much velocity sets the loudness" onChange={(x) => set((y) => (y.velocity = x))} />
      </div>
    </Panel>
  );
}

// --- envelopes ---

function TabButton({ active, onClick, label, source }: { active: boolean; onClick: () => void; label: string; source: ModSource }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5" style={{ background: active ? "rgba(255,255,255,0.06)" : "transparent" }}>
      <button type="button" onClick={onClick} className="text-[10.5px] font-bold uppercase tracking-[0.14em]" style={{ color: active ? SOURCE_COLORS[source] : SYN.muted }}>
        {label}
      </button>
      <SourceHandle source={source} size={15} />
    </div>
  );
}

const timeKnob = (label: string, value: number, min: number, max: number, def: number, onChange: (v: number) => void) => (
  <SynthKnob label={label} value={value} min={min} max={max} defaultValue={def} scale="log" format={(v) => (v <= min * 1.01 && min < 0.001 ? "0 ms" : fmt.time(v))} size={30} onChange={onChange} />
);

function EnvelopePanel() {
  const ui = useSynth();
  const [i, setI] = useState<0 | 1 | 2>(0);
  const e = ui.params.envs[i];
  const set = (edit: (x: SynthParams["envs"][0]) => void) => ui.update((p) => edit(p.envs[i]));
  return (
    <Panel
      title={
        <span className="flex items-center gap-1">
          {([0, 1, 2] as const).map((k) => (
            <TabButton key={k} active={i === k} onClick={() => setI(k)} label={k === 0 ? "Env 1 · Amp" : `Env ${k + 1}`} source={`env${k + 1}` as ModSource} />
          ))}
        </span>
      }
      style={{ width: 572 }}
    >
      <div className="flex w-full gap-3 p-2.5">
        <div className="flex flex-col gap-1">
          <EnvelopeEditor index={i} width={330} height={200} />
          <p className="w-[330px] text-[10px]" style={{ color: SYN.dim }}>
            Drag the points to shape it; the small ones bend each slope.{i === 0 ? " Env 1 shapes each note's volume." : " Drag its handle onto a knob to use it."}
          </p>
        </div>
        <div className="grid flex-1 grid-cols-3 content-start gap-y-2 pt-1">
          {timeKnob("Delay", Math.max(e.delay, 0.0001), 0.0001, 4, 0.0001, (v) => set((x) => (x.delay = v <= 0.00011 ? 0 : v)))}
          {timeKnob("Attack", Math.max(e.attack, 0.0001), 0.0001, 20, 0.002, (v) => set((x) => (x.attack = v <= 0.00011 ? 0 : v)))}
          {timeKnob("Hold", Math.max(e.hold, 0.0001), 0.0001, 4, 0.0001, (v) => set((x) => (x.hold = v <= 0.00011 ? 0 : v)))}
          {timeKnob("Decay", e.decay, 0.001, 30, 0.6, (v) => set((x) => (x.decay = v)))}
          <SynthKnob label="Sustain" value={e.sustain} min={0} max={1} defaultValue={1} format={fmt.pct} size={30} onChange={(v) => set((x) => (x.sustain = v))} />
          {timeKnob("Release", e.release, 0.001, 30, 0.15, (v) => set((x) => (x.release = v)))}
        </div>
      </div>
    </Panel>
  );
}

// --- LFOs ---

function LfoPanel() {
  const ui = useSynth();
  const [i, setI] = useState<0 | 1 | 2>(0);
  const l = ui.params.lfos[i];
  const set = (edit: (x: SynthParams["lfos"][0]) => void) => ui.update((p) => edit(p.lfos[i]));
  const setNow = (edit: (x: SynthParams["lfos"][0]) => void) => {
    ui.begin();
    set(edit);
  };
  return (
    <Panel
      title={
        <span className="flex items-center gap-1">
          {([0, 1, 2] as const).map((k) => (
            <TabButton key={k} active={i === k} onClick={() => setI(k)} label={`LFO ${k + 1}`} source={`lfo${k + 1}` as ModSource} />
          ))}
        </span>
      }
      style={{ width: 330 }}
    >
      <div className="flex w-full flex-col gap-2 p-2.5">
        <LfoView index={i} width={306} height={96} />
        <div className="flex items-center gap-1.5">
          <Select title="Shape" width={112} value={l.shape} options={LFO_SHAPES.map((s) => ({ value: s, label: LFO_SHAPE_LABELS[s] }))} onChange={(v) => setNow((x) => (x.shape = v))} />
          <Segmented small options={LFO_MODES} value={l.mode} onChange={(v) => setNow((x) => (x.mode = v))} labels={(v) => LFO_MODE_LABELS[v]} title="Retrigger: restarts with each note. Free: keeps running. One Shot: runs once per note." />
        </div>
        <div className="flex items-end justify-around">
          <div className="flex flex-col items-center gap-1">
            {l.sync ? (
              <SynthKnob
                label="Rate"
                value={l.division}
                min={0}
                max={LFO_DIVISIONS.length - 1}
                step={1}
                defaultValue={7}
                format={(v) => LFO_DIVISIONS[Math.round(v)]?.label ?? ""}
                size={32}
                title="Rate in bars and beats (drag, or modulate LFO rate)"
                onChange={(v) => set((x) => (x.division = v))}
              />
            ) : (
              <SynthKnob label="Rate" dest={`lfo${i + 1}.rate` as ModDest} value={l.rate} min={LFO_RATE_MIN} max={LFO_RATE_MAX} defaultValue={2} format={fmt.rate} size={32} onChange={(v) => set((x) => (x.rate = v))} />
            )}
            <Segmented small options={["sync", "hz"] as const} value={l.sync ? "sync" : "hz"} onChange={(v) => setNow((x) => (x.sync = v === "sync"))} labels={(v) => (v === "sync" ? "Sync" : "Hz")} />
          </div>
          <SynthKnob label="Phase" value={l.phase} min={0} max={1} defaultValue={0} format={(v) => `${Math.round(v * 360)}°`} size={32} onChange={(v) => set((x) => (x.phase = v))} />
          <SynthKnob label="Fade In" value={Math.max(l.fade, 0.001)} min={0.001} max={10} scale="log" defaultValue={0.001} format={(v) => (v <= 0.0011 ? "Off" : fmt.time(v))} size={32} onChange={(v) => set((x) => (x.fade = v <= 0.0011 ? 0 : v))} />
        </div>
      </div>
    </Panel>
  );
}

// --- other sources and macros ---

function SourcesPanel() {
  const ui = useSynth();
  const others: ModSource[] = ["velocity", "note", "modwheel", "bend", "random"];
  const hints: Partial<Record<ModSource, string>> = {
    velocity: "How hard each note is played",
    note: "Which note (low to high)",
    modwheel: "Your controller's mod wheel",
    bend: "The pitch bend wheel",
    random: "A new random value per note",
  };
  return (
    <Panel title="Sources" style={{ width: 234 }}>
      <div className="flex w-full flex-col gap-2 p-2.5">
        <div className="flex flex-col gap-1">
          {others.map((s) => (
            <div key={s} className="flex items-center gap-2" title={hints[s]}>
              <SourceHandle source={s} />
              <span className="text-[11.5px]" style={{ color: SYN.text }}>
                {MOD_SOURCE_LABELS[s]}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: SYN.muted }}>
          Macros
        </div>
        <div className="grid grid-cols-4">
          {([0, 1, 2, 3] as const).map((m) => (
            <div key={m} className="flex flex-col items-center gap-1">
              <SynthKnob
                label={`M${m + 1}`}
                value={ui.params.macros[m]}
                min={0}
                max={1}
                defaultValue={0}
                format={fmt.pct}
                size={28}
                title="A macro: drag its handle onto knobs, then turn this to move them all"
                onChange={(v) => ui.update((p) => (p.macros[m] = v))}
              />
              <SourceHandle source={`macro${m + 1}` as ModSource} size={14} />
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// --- matrix ---

const DEST_OPTIONS = DEST_SPECS.map((d) => ({ value: d.key as string, label: `${d.group} · ${d.label}`, group: d.group }));

function MatrixTab() {
  const ui = useSynth();
  const mods = ui.params.mods;
  const add = () => {
    ui.begin();
    ui.update((p) => {
      if (p.mods.length >= MAX_MODS) return;
      p.mods.push({ id: newModId(), source: "env2", dest: "filter1.cutoff", amount: 0.3, bipolar: false });
    });
  };
  return (
    <div className="flex min-h-0 flex-1 gap-2.5">
      <Panel title={`Modulation matrix · ${mods.length} of ${MAX_MODS}`} className="min-w-0 flex-1">
        <div className="flex w-full flex-col p-3">
          <div className="grid grid-cols-[180px_1fr] gap-2 px-1 pb-1 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: SYN.dim }}>
            <span>Source → Destination</span>
            <span>Amount</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {mods.length === 0 && (
              <p className="p-4 text-[12.5px] leading-relaxed" style={{ color: SYN.muted }}>
                No modulations yet. Add one here, or on the Synth page drag a source&apos;s <span style={{ color: SYN.accent }}>+</span> handle (on the envelope and LFO tabs, the sources and the macros) onto any knob.
              </p>
            )}
            {mods.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-white/[0.03]">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SOURCE_COLORS[m.source] }} />
                <Select
                  title="Source"
                  width={96}
                  value={m.source}
                  options={MOD_SOURCES.map((s) => ({ value: s, label: MOD_SOURCE_LABELS[s] }))}
                  onChange={(v) => {
                    ui.begin();
                    ui.update((p) => {
                      const x = p.mods.find((y) => y.id === m.id);
                      if (x) x.source = v;
                    });
                  }}
                />
                <span style={{ color: SYN.dim }}>→</span>
                <Select
                  title="Destination"
                  width={170}
                  value={m.dest}
                  options={DEST_OPTIONS}
                  onChange={(v) => {
                    ui.begin();
                    ui.update((p) => {
                      const x = p.mods.find((y) => y.id === m.id);
                      if (x) x.dest = v as ModDest;
                    });
                  }}
                />
                <div className="min-w-0 flex-1">
                  <ModRow id={m.id} compact />
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={add}
            disabled={mods.length >= MAX_MODS}
            className="mt-2 flex items-center gap-1.5 self-start rounded-md px-2.5 py-1 text-[11.5px] font-semibold disabled:opacity-40"
            style={{ border: `1px solid ${SYN.border}`, color: SYN.accent }}
          >
            <Plus size={12} /> Add modulation
          </button>
        </div>
      </Panel>
      <Panel title="Sources" style={{ width: 260 }}>
        <div className="flex w-full flex-col gap-1.5 p-3">
          {MOD_SOURCES.map((s) => {
            const n = mods.filter((m) => m.source === s).length;
            return (
              <div key={s} className="flex items-center gap-2 text-[11.5px]">
                <SourceHandle source={s} />
                <span>{MOD_SOURCE_LABELS[s]}</span>
                <span className="ml-auto font-mono text-[10px]" style={{ color: n ? SOURCE_COLORS[s] : SYN.dim }}>
                  {n || "–"}
                </span>
              </div>
            );
          })}
          <p className="mt-2 text-[10.5px] leading-snug" style={{ color: SYN.dim }}>
            Amounts are a share of the knob&apos;s full travel. Bipolar (±) swings both ways around the knob.
          </p>
        </div>
      </Panel>
    </div>
  );
}

