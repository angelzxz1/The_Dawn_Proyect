"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { FINE_FACTOR } from "@/lib/knobInput";
import { useKnobWheel } from "./useKnobWheel";
import {
  BIPOLAR_SOURCES,
  DEST_INDEX,
  DEST_SPECS,
  MAX_MODS,
  MOD_SOURCE_LABELS,
  newModId,
  toNorm,
  fromNorm,
  type ModDest,
  type ModSource,
  type SynthParams,
} from "@/lib/synthParams";
import type { SynthLiveState } from "@/lib/synth";

// Daybreak's look: night-blue panels, a dawn gradient for what's alive,
// each modulation source with its own color.

export const SYN = {
  bg: "#12131B",
  panel: "#191A25",
  panelHi: "#1F2030",
  border: "#2A2B3C",
  track: "#2C2D40",
  text: "#F4EDE2",
  muted: "#8B8CA3",
  dim: "#5D5E75",
  accent: "#F5A45D",
  coral: "#F2706B",
  violet: "#9B7CF4",
  gradient: "linear-gradient(90deg, #F5A45D 0%, #F2706B 50%, #9B7CF4 100%)",
};

export const SOURCE_COLORS: Record<ModSource, string> = {
  env1: "#F5A45D",
  env2: "#F2706B",
  env3: "#EC6BA8",
  lfo1: "#62D2E8",
  lfo2: "#7FA2F7",
  lfo3: "#A98BF5",
  velocity: "#F2D16B",
  note: "#9BE28F",
  modwheel: "#5FE0B5",
  bend: "#7FD1C7",
  random: "#C9CAD9",
  macro1: "#FFB38A",
  macro2: "#F79AC0",
  macro3: "#8FD3FF",
  macro4: "#B8F28F",
};

export const MOD_MIME = "application/x-daybreak-source";

// --- context ---

interface SynthUiContext {
  params: SynthParams;
  /** Applies an edit (on a copy) and sends it on. */
  update: (edit: (p: SynthParams) => void) => void;
  /** Call once at the start of a gesture (one undo step per gesture). */
  begin: () => void;
  live: React.RefObject<SynthLiveState | null>;
  /** Runs `cb` every animation frame with the latest live state. */
  onFrame: (cb: (s: SynthLiveState | null) => void) => () => void;
  dragging: ModSource | null;
  setDragging: (s: ModSource | null) => void;
  focus: ModSource | null;
  setFocus: (s: ModSource | null) => void;
}

export const SynthContext = createContext<SynthUiContext | null>(null);

export function useSynth(): SynthUiContext {
  const ctx = useContext(SynthContext);
  if (!ctx) throw new Error("useSynth outside the synth window");
  return ctx;
}

/** A frame loop that reads the live state without re-rendering React. */
export function useLiveFrames(live: React.RefObject<SynthLiveState | null>) {
  const subs = useRef(new Set<(s: SynthLiveState | null) => void>());
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      subs.current.forEach((cb) => cb(live.current));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live]);
  return useCallback((cb: (s: SynthLiveState | null) => void) => {
    subs.current.add(cb);
    return () => {
      subs.current.delete(cb);
    };
  }, []);
}

/** Adds a modulation from `source` to `dest` (or returns the existing one). */
export function addModulation(p: SynthParams, source: ModSource, dest: ModDest, amount = 0.35): void {
  if (p.mods.some((m) => m.source === source && m.dest === dest)) return;
  if (p.mods.length >= MAX_MODS) return;
  const bipolar = BIPOLAR_SOURCES.includes(source);
  p.mods.push({ id: newModId(), source, dest, amount: bipolar ? amount * 0.7 : amount, bipolar });
}

// --- knob ---

const CENTER = 30;
const START = -135;
const SWEEP = 270;
const DRAG_PX = 140;

function pt(deg: number, r: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: CENTER + r * Math.sin(rad), y: CENTER - r * Math.cos(rad) };
}

function arc(f0: number, f1: number, r: number): string {
  const a0 = START + Math.max(0, Math.min(1, Math.min(f0, f1))) * SWEEP;
  const a1 = START + Math.max(0, Math.min(1, Math.max(f0, f1))) * SWEEP;
  if (a1 - a0 < 0.3) return "";
  const p0 = pt(a0, r);
  const p1 = pt(a1, r);
  return `M${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

export type KnobScale = "linear" | "log" | "bipolar";

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  /** Makes the knob a modulation target. Its scale then follows the destination. */
  dest?: ModDest;
  scale?: KnobScale;
  size?: number;
  step?: number;
  disabled?: boolean;
  title?: string;
  /** Label and value beside the knob instead of above and below it. */
  inline?: boolean;
}

/** A knob: drag (Shift for fine), click to type, double-click to reset.
 * A modulation target also takes dropped sources, shows each modulation as
 * a colored ring whose end you drag to set the amount, and (right-click)
 * lists them. While a note plays, a dot follows the modulated value. */
export function SynthKnob({ label, value, min, max, defaultValue, onChange, format, dest, scale = "linear", size = 38, step, disabled, title, inline }: KnobProps) {
  const ui = useSynth();
  const spec = dest ? DEST_SPECS[DEST_INDEX[dest]] : null;
  const mode: KnobScale = spec ? (spec.scale === "log" ? "log" : min < 0 && max > 0 ? "bipolar" : "linear") : scale;
  const toF = (v: number) => (mode === "log" ? toNorm({ min, max, scale: "log" }, v) : toNorm({ min, max, scale: "linear" }, v));
  const fromF = (f: number) => {
    const v = mode === "log" ? fromNorm({ min, max, scale: "log" }, f) : fromNorm({ min, max, scale: "linear" }, f);
    return step ? Math.round(v / step) * step : v;
  };
  const fraction = toF(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState(false);
  const [over, setOver] = useState(false);
  const drag = useRef<{ y: number; f: number; moved: boolean } | null>(null);
  const liveDot = useRef<SVGCircleElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const mods = dest ? ui.params.mods.filter((m) => m.dest === dest) : [];

  useEffect(() => {
    if (!dest) return;
    const idx = DEST_INDEX[dest];
    return ui.onFrame((s) => {
      const el = liveDot.current;
      if (!el) return;
      const n = s?.mod && s.voices > 0 ? s.mod[idx] : null;
      if (n === null || n === undefined || mods.length === 0) {
        el.setAttribute("opacity", "0");
        return;
      }
      const p = pt(START + Math.max(0, Math.min(1, n)) * SWEEP, 22);
      el.setAttribute("cx", p.x.toFixed(2));
      el.setAttribute("cy", p.y.toFixed(2));
      el.setAttribute("opacity", "1");
    });
  }, [dest, ui, mods.length]);

  const setModAmount = (id: string, amount: number) =>
    ui.update((p) => {
      const m = p.mods.find((x) => x.id === id);
      if (m) m.amount = Math.max(-1, Math.min(1, amount));
    });

  useKnobWheel(
    knobRef,
    fraction,
    (next, fresh) => {
      if (fresh) ui.begin();
      onChange(Math.min(max, Math.max(min, fromF(next))));
    },
    !disabled && !editing
  );

  const angle = START + fraction * SWEEP;
  const needle0 = pt(angle, 6);
  const needle1 = pt(angle, 14);
  const valueArc = mode === "bipolar" ? arc(0.5, fraction, 22) : arc(0, fraction, 22);

  const commit = () => {
    const parsed = parseFloat(draft);
    if (Number.isFinite(parsed)) {
      ui.begin();
      onChange(Math.min(max, Math.max(min, step ? Math.round(parsed / step) * step : parsed)));
    }
    setEditing(false);
  };

  return (
    <div className={inline ? "relative flex items-center gap-2" : "relative flex flex-col items-center gap-0.5"} style={inline ? undefined : { width: size + 18 }}>
      {!inline && (
        <span className="w-full truncate text-center text-[9.5px] font-semibold uppercase tracking-[0.1em]" style={{ color: disabled ? SYN.dim : SYN.muted }}>
          {label}
        </span>
      )}
      <div
        ref={knobRef}
        role="slider"
        aria-label={`${label}, ${format(value)}`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={disabled ? -1 : 0}
        title={title ?? (dest ? "Drag or scroll (Shift for fine) · click to type · double-click to reset · drop a modulation source here · right-click for modulations" : "Drag or scroll (Shift for fine) · click to type · double-click to reset")}
        className={`relative rounded-full ${disabled ? "opacity-40" : "cursor-ns-resize"}`}
        style={{ width: size, height: size, touchAction: "none", boxShadow: over ? `0 0 0 2px ${SOURCE_COLORS[ui.dragging ?? "env1"]}` : undefined }}
        onPointerDown={(e) => {
          if (disabled || editing || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, f: fraction, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dy = d.y - e.clientY;
          if (!d.moved && Math.abs(dy) > 3) {
            d.moved = true;
            ui.begin();
          }
          if (!d.moved) return;
          // Added up step by step, so Shift (fine) can come and go mid-drag.
          d.f = Math.max(0, Math.min(1, d.f + (dy / DRAG_PX) * (e.shiftKey ? FINE_FACTOR : 1)));
          d.y = e.clientY;
          onChange(Math.min(max, Math.max(min, fromF(d.f))));
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) {
            setDraft(String(Math.round(value * 1000) / 1000));
            setEditing(true);
          }
        }}
        onDoubleClick={() => {
          if (disabled) return;
          setEditing(false);
          ui.begin();
          onChange(defaultValue);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (disabled) return;
          if (dest) setMenu(true);
          else {
            setDraft(String(Math.round(value * 1000) / 1000));
            setEditing(true);
          }
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          const d = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          ui.begin();
          onChange(Math.min(max, Math.max(min, fromF(Math.max(0, Math.min(1, fraction + d * 0.01 * (e.shiftKey ? FINE_FACTOR : 1)))))));
        }}
        onDragOver={(e) => {
          if (!dest || !e.dataTransfer.types.includes(MOD_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "link";
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          if (!dest) return;
          const source = e.dataTransfer.getData(MOD_MIME) as ModSource;
          if (!source) return;
          e.preventDefault();
          ui.begin();
          ui.update((p) => addModulation(p, source, dest));
          ui.setFocus(source);
        }}
      >
        <svg width={size} height={size} viewBox="0 0 60 60" aria-hidden="true" className="overflow-visible">
          <path d={arc(0, 1, 22)} stroke={SYN.track} strokeWidth={4.5} strokeLinecap="round" fill="none" />
          {valueArc && <path d={valueArc} stroke={SYN.accent} strokeWidth={4.5} strokeLinecap="round" fill="none" />}
          <circle cx={30} cy={30} r={15} fill="#252638" stroke="#34354A" strokeWidth={1} />
          <line x1={needle0.x} y1={needle0.y} x2={needle1.x} y2={needle1.y} stroke={SYN.text} strokeWidth={2.6} strokeLinecap="round" />
          {mods.slice(0, 3).map((m, i) => (
            <ModRing
              key={m.id}
              r={27 + i * 4.2}
              base={fraction}
              amount={m.amount}
              bipolar={m.bipolar}
              color={SOURCE_COLORS[m.source]}
              dim={ui.focus !== null && ui.focus !== m.source}
              onBegin={ui.begin}
              onChange={(a) => setModAmount(m.id, a)}
            />
          ))}
          <circle ref={liveDot} r={3} fill="#fff" opacity={0} style={{ filter: "drop-shadow(0 0 3px #fff)" }} />
        </svg>
        {editing && (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={commit}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") setEditing(false);
            }}
            className="absolute left-1/2 top-1/2 z-20 w-16 -translate-x-1/2 -translate-y-1/2 rounded border px-1 py-0.5 text-center font-mono text-[11px] outline-none"
            style={{ background: SYN.bg, borderColor: SYN.accent, color: SYN.text }}
          />
        )}
      </div>
      {inline ? (
        <div className="flex flex-col gap-1">
          <span className="text-[9.5px] font-semibold uppercase leading-none tracking-[0.1em]" style={{ color: disabled ? SYN.dim : SYN.muted }}>
            {label}
          </span>
          <span className="whitespace-nowrap font-mono text-[10.5px] leading-none" style={{ color: disabled ? SYN.dim : SYN.text }}>
            {format(value)}
          </span>
        </div>
      ) : (
        <span className="whitespace-nowrap font-mono text-[10px] leading-none" style={{ color: disabled ? SYN.dim : SYN.text }}>
          {format(value)}
        </span>
      )}
      {menu && dest && <ModMenu dest={dest} onClose={() => setMenu(false)} />}
    </div>
  );
}

/** A modulation ring: its end handle drags the amount. */
function ModRing({
  r,
  base,
  amount,
  bipolar,
  color,
  dim,
  onBegin,
  onChange,
}: {
  r: number;
  base: number;
  amount: number;
  bipolar: boolean;
  color: string;
  dim: boolean;
  onBegin: () => void;
  onChange: (amount: number) => void;
}) {
  const drag = useRef<{ y: number; a: number } | null>(null);
  const end = Math.max(0, Math.min(1, base + amount));
  const from = bipolar ? base - amount : base;
  const handle = pt(START + end * SWEEP, r);
  return (
    <g opacity={dim ? 0.3 : 1}>
      <path d={arc(from, base + amount, r)} stroke={color} strokeWidth={3.4} strokeLinecap="round" fill="none" />
      <circle
        cx={handle.x}
        cy={handle.y}
        r={4.2}
        fill={color}
        stroke="#12131B"
        strokeWidth={1}
        style={{ cursor: "ns-resize" }}
        onPointerDown={(e) => {
          e.stopPropagation();
          (e.target as Element).setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, a: amount };
          onBegin();
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          onChange(d.a + ((d.y - e.clientY) / DRAG_PX) * (e.shiftKey ? 0.2 : 1));
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          drag.current = null;
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <title>Drag to set how much this modulates</title>
      </circle>
    </g>
  );
}

/** The modulations on one knob: amount, direction, remove. */
function ModMenu({ dest, onClose }: { dest: ModDest; onClose: () => void }) {
  const ui = useSynth();
  const ref = useRef<HTMLDivElement>(null);
  const mods = ui.params.mods.filter((m) => m.dest === dest);
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Just this menu, not the window behind it.
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="absolute left-1/2 top-full z-40 mt-1 w-56 -translate-x-1/2 rounded-lg p-2 shadow-2xl"
      style={{ background: SYN.panelHi, border: `1px solid ${SYN.border}` }}
    >
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: SYN.muted }}>
        Modulations
      </div>
      {mods.length === 0 && (
        <p className="text-[11px] leading-snug" style={{ color: SYN.muted }}>
          None yet. Drag a source&apos;s handle (from the envelopes, LFOs or the sources on the right) onto this knob.
        </p>
      )}
      {mods.map((m) => (
        <ModRow key={m.id} id={m.id} />
      ))}
    </div>
  );
}

/** One modulation: source, amount slider, bipolar, remove. */
export function ModRow({ id, compact }: { id: string; compact?: boolean }) {
  const ui = useSynth();
  const m = ui.params.mods.find((x) => x.id === id);
  if (!m) return null;
  const color = SOURCE_COLORS[m.source];
  return (
    <div className="flex items-center gap-1.5 py-1 text-[11px]">
      {!compact && (
        <>
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
          <span className="w-[62px] shrink-0 truncate" style={{ color: SYN.text }}>
            {MOD_SOURCE_LABELS[m.source]}
          </span>
        </>
      )}
      <input
        type="range"
        min={-100}
        max={100}
        value={Math.round(m.amount * 100)}
        onPointerDown={ui.begin}
        onChange={(e) =>
          ui.update((p) => {
            const x = p.mods.find((y) => y.id === id);
            if (x) x.amount = Number(e.target.value) / 100;
          })
        }
        className="min-w-0 flex-1"
        style={{ accentColor: color }}
        aria-label={`${MOD_SOURCE_LABELS[m.source]} amount`}
      />
      <span className="w-9 shrink-0 text-right font-mono text-[10px]" style={{ color: SYN.text }}>
        {Math.round(m.amount * 100)}%
      </span>
      <button
        type="button"
        title={m.bipolar ? "Bipolar: swings both ways around the knob" : "Unipolar: pushes one way from the knob"}
        onClick={() => {
          ui.begin();
          ui.update((p) => {
            const x = p.mods.find((y) => y.id === id);
            if (x) x.bipolar = !x.bipolar;
          });
        }}
        className="w-6 shrink-0 rounded text-[10px] font-bold"
        style={{ color: m.bipolar ? color : SYN.dim, border: `1px solid ${m.bipolar ? color : SYN.border}` }}
      >
        ±
      </button>
      <button
        type="button"
        title="Remove this modulation"
        onClick={() => {
          ui.begin();
          ui.update((p) => {
            p.mods = p.mods.filter((y) => y.id !== id);
          });
        }}
        className="shrink-0 rounded p-0.5 hover:bg-black/30"
        style={{ color: SYN.muted }}
      >
        <X size={11} />
      </button>
    </div>
  );
}

// --- sources ---

/** A modulation source's handle: drag it onto a knob. Click to show where it goes. */
export function SourceHandle({ source, size = 16 }: { source: ModSource; size?: number }) {
  const ui = useSynth();
  const color = SOURCE_COLORS[source];
  const count = ui.params.mods.filter((m) => m.source === source).length;
  const focused = ui.focus === source;
  return (
    <span
      draggable
      role="button"
      tabIndex={0}
      title={`${MOD_SOURCE_LABELS[source]}: drag onto a knob to modulate it${count ? ` (modulating ${count})` : ""} · click to highlight its modulations`}
      onDragStart={(e) => {
        e.dataTransfer.setData(MOD_MIME, source);
        e.dataTransfer.effectAllowed = "link";
        ui.setDragging(source);
      }}
      onDragEnd={() => ui.setDragging(null)}
      onClick={(e) => {
        e.stopPropagation();
        ui.setFocus(focused ? null : source);
      }}
      className="relative inline-flex shrink-0 cursor-grab items-center justify-center rounded-full active:cursor-grabbing"
      style={{
        width: size,
        height: size,
        background: focused ? color : `${color}26`,
        border: `1.5px solid ${color}`,
      }}
    >
      <svg width={size - 6} height={size - 6} viewBox="0 0 10 10" aria-hidden="true">
        <path d="M5 0.5v9M0.5 5h9" stroke={focused ? SYN.bg : color} strokeWidth={1.6} strokeLinecap="round" />
      </svg>
      {count > 0 && (
        <span
          className="absolute -right-1.5 -top-1.5 flex h-3 min-w-3 items-center justify-center rounded-full px-0.5 text-[8px] font-bold"
          style={{ background: color, color: SYN.bg }}
        >
          {count}
        </span>
      )}
    </span>
  );
}

// --- small controls ---

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  labels,
  title,
  small,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: (v: T) => React.ReactNode;
  title?: string;
  small?: boolean;
}) {
  return (
    <div className="flex overflow-hidden rounded-md" style={{ border: `1px solid ${SYN.border}` }} title={title} role="radiogroup">
      {options.map((o) => {
        const on = o === value;
        return (
          <button
            key={String(o)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o)}
            className={`${small ? "px-1.5 py-[1px] text-[9.5px]" : "px-2 py-0.5 text-[10.5px]"} font-semibold uppercase tracking-wide`}
            style={{ background: on ? "rgba(245,164,93,0.18)" : "transparent", color: on ? SYN.accent : SYN.muted }}
          >
            {labels ? labels(o) : String(o)}
          </button>
        );
      })}
    </div>
  );
}

export function Power({ on, onClick, title }: { on: boolean; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className="flex h-4 w-4 items-center justify-center rounded-full"
      style={{ border: `1.5px solid ${on ? SYN.accent : SYN.dim}`, background: on ? "rgba(245,164,93,0.25)" : "transparent" }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: on ? SYN.accent : "transparent" }} />
    </button>
  );
}

export function Panel({
  title,
  on,
  onToggle,
  right,
  children,
  className = "",
  style,
}: {
  title: React.ReactNode;
  on?: boolean;
  onToggle?: () => void;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section className={`flex flex-col rounded-xl ${className}`} style={{ background: SYN.panel, border: `1px solid ${SYN.border}`, ...style }}>
      <header className="flex h-7 shrink-0 items-center gap-2 px-2.5" style={{ borderBottom: `1px solid ${SYN.border}` }}>
        {onToggle && <Power on={!!on} onClick={onToggle} title={on ? "Turn off" : "Turn on"} />}
        <h3 className="text-[10.5px] font-bold uppercase tracking-[0.16em]" style={{ color: on === false ? SYN.dim : SYN.text }}>
          {title}
        </h3>
        <div className="ml-auto flex items-center gap-1.5">{right}</div>
      </header>
      <div className={`flex min-h-0 flex-1 ${on === false ? "opacity-45" : ""}`}>{children}</div>
    </section>
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  title,
  width,
}: {
  value: T;
  options: { value: T; label: string; group?: string }[];
  onChange: (v: T) => void;
  title?: string;
  width?: number;
}) {
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  return (
    <select
      value={String(value)}
      title={title}
      aria-label={title}
      onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value);
        if (o) onChange(o.value);
      }}
      className="rounded-md px-1.5 py-[2px] text-[11px] outline-none"
      style={{ background: SYN.bg, border: `1px solid ${SYN.border}`, color: SYN.text, width }}
    >
      {groups.map((g) =>
        g ? (
          <optgroup key={g} label={g}>
            {options
              .filter((o) => o.group === g)
              .map((o) => (
                <option key={String(o.value)} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
          </optgroup>
        ) : (
          options
            .filter((o) => !o.group)
            .map((o) => (
              <option key={String(o.value)} value={String(o.value)}>
                {o.label}
              </option>
            ))
        )
      )}
    </select>
  );
}

// --- formatting ---

export const fmt = {
  pct: (v: number) => `${Math.round(v * 100)}%`,
  pan: (v: number) => (Math.abs(v) < 0.005 ? "C" : `${Math.round(Math.abs(v) * 100)}${v < 0 ? "L" : "R"}`),
  hz: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)}k` : `${Math.round(v)}`),
  st: (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)} st`,
  ct: (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)} ct`,
  db: (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`,
  time: (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`),
  int: (v: number) => `${Math.round(v)}`,
  rate: (v: number) => (v < 1 ? `${v.toFixed(2)} Hz` : `${v.toFixed(1)} Hz`),
};
