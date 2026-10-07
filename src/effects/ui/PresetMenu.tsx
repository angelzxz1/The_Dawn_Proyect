"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Pencil, RotateCcw, Save, Trash2 } from "lucide-react";
import { defaultParams, type EffectInstance } from "@/effects/registry";
import {
  deleteUserPreset,
  findPreset,
  matchesPreset,
  overwriteUserPreset,
  paramsFromPreset,
  presetsFor,
  renameUserPreset,
  saveUserPreset,
  subscribePresets,
  userPresets,
  type EffectPreset,
  type PresetRef,
} from "@/effects/presets";
import { useShortcuts } from "@/lib/shortcuts";

const NO_PRESETS: EffectPreset[] = [];

/** Every user preset, re-rendering when one is saved, renamed or deleted
 * (in this tab or another). */
export function useUserPresets(): EffectPreset[] {
  return useSyncExternalStore(subscribePresets, userPresets, () => NO_PRESETS);
}

/** New settings for an effect: its params, and which preset they're from
 * (undefined: none). */
export interface PresetChange {
  params: Record<string, number>;
  preset: PresetRef | undefined;
}

interface PresetMenuProps {
  effect: EffectInstance;
  /** The project's tempo - synced delay presets are stored in beats. */
  bpm: number;
  onChange: (change: PresetChange) => void;
  variant: "rack" | "window";
}

/** What's in the plugin window currently open, for its title bar's preset
 * menu (see WindowPresetMenu). */
export const EffectPresetContext = createContext<Omit<PresetMenuProps, "variant"> | null>(null);

/** The preset menu for a plugin window's title bar. */
export function WindowPresetMenu() {
  const ctx = useContext(EffectPresetContext);
  return ctx ? <PresetMenu {...ctx} variant="window" /> : null;
}

/** An effect's preset bar: the preset's name (with * once you've changed a
 * setting), arrows to step through presets, a menu to load, save, rename
 * and delete them, and a save button. */
export function PresetMenu({ effect, bpm, onChange, variant }: PresetMenuProps) {
  const user = useUserPresets();
  const { factory, user: mine } = presetsFor(effect.type, user);
  const all = [...factory, ...mine];
  const current = effect.preset ? findPreset(effect.preset.id) : undefined;
  const modified = !!current && !matchesPreset(current, effect.params, bpm);
  const name = current?.name ?? effect.preset?.name ?? "Default";
  const [open, setOpen] = useState<null | "list" | "save">(null);
  const anchor = useRef<HTMLDivElement>(null);

  const load = (preset: EffectPreset | null) => {
    if (!preset) onChange({ params: paramsFromPreset({ type: effect.type, params: defaultParams(effect.type) }, effect.params, bpm), preset: undefined });
    else onChange({ params: paramsFromPreset(preset, effect.params, bpm), preset: { id: preset.id, name: preset.name } });
  };
  const step = (dir: 1 | -1) => {
    if (!all.length) return;
    const i = all.findIndex((p) => p.id === current?.id);
    load(all[i === -1 ? (dir === 1 ? 0 : all.length - 1) : (i + dir + all.length) % all.length]);
  };

  const small = variant === "rack";
  const btn = `flex shrink-0 items-center justify-center rounded text-[#8A8A94] hover:bg-white/5 hover:text-[#F4EDE2] ${small ? "h-5 w-5" : "h-7 w-7"}`;
  return (
    <div
      ref={anchor}
      className={`flex min-w-0 items-center gap-0.5 rounded-md ${small ? "h-6 px-0.5" : "h-[30px] px-1"}`}
      style={{ background: "#14151A", border: "1px solid #2A2B33" }}
      data-preset-menu
    >
      <button type="button" className={btn} title="Previous preset" aria-label="Previous preset" onClick={() => step(-1)}>
        <ChevronLeft size={small ? 12 : 14} />
      </button>
      <button
        type="button"
        onClick={() => setOpen(open === "list" ? null : "list")}
        aria-haspopup="menu"
        aria-expanded={open === "list"}
        title={modified ? `${name} (changed)` : name}
        className={`flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 text-left hover:bg-white/5 ${small ? "h-5 text-[11px]" : "h-7 text-[12.5px]"}`}
        style={{ minWidth: small ? 0 : 150 }}
      >
        <span className={`min-w-0 flex-1 truncate ${current || effect.preset ? "text-[#F4EDE2]" : "text-[#8A8A94]"} ${modified ? "italic" : ""}`}>
          {name}
          {modified ? " *" : ""}
        </span>
        <ChevronDown size={small ? 11 : 13} className="shrink-0 text-[#8A8A94]" />
      </button>
      <button type="button" className={btn} title="Next preset" aria-label="Next preset" onClick={() => step(1)}>
        <ChevronRight size={small ? 12 : 14} />
      </button>
      <button type="button" className={btn} title="Save preset" aria-label="Save preset" onClick={() => setOpen(open === "save" ? null : "save")}>
        <Save size={small ? 11 : 13} />
      </button>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(null)}>
          {open === "save" ? (
            <SaveForm
              initial={current && !current.factory ? current.name : ""}
              existing={mine}
              onSave={(n) => {
                const saved = saveUserPreset(effect.type, n, effect.params, bpm);
                onChange({ params: effect.params, preset: { id: saved.id, name: saved.name } });
                setOpen(null);
              }}
              onCancel={() => setOpen(null)}
            />
          ) : (
            <PresetList
              factory={factory}
              mine={mine}
              currentId={current?.id}
              modified={modified}
              onLoad={(p) => {
                load(p);
                setOpen(null);
              }}
              onUpdate={
                current && !current.factory && modified
                  ? () => {
                      const saved = overwriteUserPreset(current.id, effect.params, bpm);
                      if (saved) onChange({ params: effect.params, preset: { id: saved.id, name: saved.name } });
                      setOpen(null);
                    }
                  : undefined
              }
              onSaveAs={() => setOpen("save")}
              onReset={() => {
                load(null);
                setOpen(null);
              }}
            />
          )}
        </Popover>
      )}
    </div>
  );
}

/** Floats over everything (the FX rack scrolls and clips), under or above
 * its anchor. Closes on a click outside or Escape. */
function Popover({ anchor, onClose, children }: { anchor: React.RefObject<HTMLDivElement | null>; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect();
    const el = ref.current;
    if (!a || !el) return;
    const width = Math.max(260, a.width);
    const h = el.offsetHeight;
    const below = a.bottom + 4 + h <= window.innerHeight - 8 || a.top < h + 12;
    setPos({
      left: Math.max(8, Math.min(a.left, window.innerWidth - width - 8)),
      top: below ? a.bottom + 4 : Math.max(8, a.top - 4 - h),
      width,
    });
  }, [anchor, children]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [anchor, onClose]);
  // A menu is above the plugin window: Escape closes just the menu.
  useShortcuts("menu", [{ keys: "escape", run: onClose, whileTyping: true }]);
  return createPortal(
    <div
      ref={ref}
      tabIndex={-1}
      role="menu"
      className="fixed z-[100] flex max-h-[360px] flex-col overflow-hidden rounded-lg text-[12px] shadow-2xl outline-none"
      style={{ ...pos, background: "#1F2027", border: "1px solid #34353E", color: "#F4EDE2" }}
    >
      {children}
    </div>,
    document.body
  );
}

function PresetList({
  factory,
  mine,
  currentId,
  modified,
  onLoad,
  onUpdate,
  onSaveAs,
  onReset,
}: {
  factory: EffectPreset[];
  mine: EffectPreset[];
  currentId: string | undefined;
  modified: boolean;
  onLoad: (p: EffectPreset) => void;
  onUpdate?: () => void;
  onSaveAs: () => void;
  onReset: () => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const row = (p: EffectPreset) => {
    const on = p.id === currentId;
    if (renaming === p.id) {
      return (
        <NameInput
          key={p.id}
          initial={p.name}
          onDone={(n) => {
            if (n === null || n === p.name) setRenaming(null);
            else if (renameUserPreset(p.id, n)) {
              setRenaming(null);
              setError(null);
            } else setError(`You already have a preset called "${n.trim()}".`);
          }}
        />
      );
    }
    return (
      <div key={p.id} className="group flex items-center rounded hover:bg-white/5">
        <button type="button" role="menuitem" onClick={() => onLoad(p)} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left">
          <Check size={12} className={`shrink-0 ${on ? "text-[#E6AD5E]" : "invisible"}`} />
          <span className={`truncate ${on ? "text-[#E6AD5E]" : ""}`}>
            {p.name}
            {on && modified ? " *" : ""}
          </span>
        </button>
        {!p.factory && (
          <span className="flex shrink-0 gap-0.5 pr-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            <button type="button" title="Rename" aria-label={`Rename ${p.name}`} onClick={() => setRenaming(p.id)} className="rounded p-1 text-[#8A8A94] hover:text-[#F4EDE2]">
              <Pencil size={11} />
            </button>
            <button
              type="button"
              title="Delete"
              aria-label={`Delete ${p.name}`}
              onClick={() => {
                if (window.confirm(`Delete the preset "${p.name}"?`)) deleteUserPreset(p.id);
              }}
              className="rounded p-1 text-[#8A8A94] hover:text-[#FF7A7A]"
            >
              <Trash2 size={11} />
            </button>
          </span>
        )}
      </div>
    );
  };
  const heading = (text: string) => <div className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-[#6E6E78]">{text}</div>;
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {heading("Factory")}
        {factory.map(row)}
        {heading("Your presets")}
        {mine.length ? mine.map(row) : <p className="px-2 pb-2 text-[11px] text-[#6E6E78]">Save the current settings to make your own.</p>}
        {error && <p className="px-2 pb-1 text-[11px] text-[#FF7A7A]">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-1 border-t p-1.5" style={{ borderColor: "#34353E" }}>
        {onUpdate && (
          <button type="button" onClick={onUpdate} className="rounded px-2 py-1 text-[11px] font-semibold text-[#E6AD5E] hover:bg-white/5">
            Update preset
          </button>
        )}
        <button type="button" onClick={onSaveAs} className="rounded px-2 py-1 text-[11px] font-semibold hover:bg-white/5">
          Save as new…
        </button>
        <button type="button" onClick={onReset} className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[#8A8A94] hover:bg-white/5" title="Back to the default settings">
          <RotateCcw size={11} /> Default
        </button>
      </div>
    </>
  );
}

function NameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      value={value}
      maxLength={60}
      aria-label="Preset name"
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && value.trim()) onDone(value);
        if (e.key === "Escape") onDone(null);
      }}
      onBlur={() => onDone(value.trim() ? value : null)}
      className="mx-1 my-0.5 w-[calc(100%-8px)] rounded px-2 py-1 text-[12px] outline-none"
      style={{ background: "#14151A", border: "1px solid #E6AD5E", color: "#F4EDE2" }}
    />
  );
}

function SaveForm({ initial, existing, onSave, onCancel }: { initial: string; existing: EffectPreset[]; onSave: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const clean = value.trim();
  const replaces = existing.some((p) => p.name.toLowerCase() === clean.toLowerCase());
  return (
    <form
      className="flex flex-col gap-2 p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (clean) onSave(clean);
      }}
    >
      <label className="text-[10px] font-bold uppercase tracking-wider text-[#6E6E78]" htmlFor="preset-name">
        Save preset as
      </label>
      <input
        id="preset-name"
        autoFocus
        value={value}
        maxLength={60}
        placeholder="Preset name"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onCancel();
        }}
        className="rounded px-2 py-1.5 text-[12.5px] outline-none"
        style={{ background: "#14151A", border: "1px solid #34353E", color: "#F4EDE2" }}
      />
      {replaces && <p className="text-[11px] text-[#E6AD5E]">Replaces your preset with this name.</p>}
      <div className="flex justify-end gap-1">
        <button type="button" onClick={onCancel} className="rounded px-2.5 py-1 text-[11px] text-[#8A8A94] hover:bg-white/5">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!clean}
          className="rounded px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40"
          style={{ background: "#E6AD5E", color: "#14151A" }}
        >
          Save
        </button>
      </div>
    </form>
  );
}
