"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { ValueBar } from "./ValueBar";
import {
  EFFECT_LABELS,
  EFFECT_TYPES,
  paramSpecs,
  type EffectInstance,
  type EffectType,
} from "@/lib/effects";

interface EffectsRackProps {
  x: number;
  y: number;
  channelName: string;
  effects: EffectInstance[];
  onAdd: (type: EffectType) => void;
  onRemove: (effectId: string) => void;
  onReorder: (effectId: string, direction: -1 | 1) => void;
  onParamChange: (effectId: string, key: string, value: number) => void;
  onClose: () => void;
}

/** A floating rack of insert effects for one track - add/remove/reorder
 * EQ3, Compressor, Delay and Reverb, each with its own live parameter
 * knobs. Anchored near the FX button that opened it, like ContextMenu. */
export function EffectsRack({
  x,
  y,
  channelName,
  effects,
  onAdd,
  onRemove,
  onReorder,
  onParamChange,
  onClose,
}: EffectsRackProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const width = 300;
  const style: React.CSSProperties = {
    left: Math.min(x, (typeof window !== "undefined" ? window.innerWidth : x) - width - 8),
    top: Math.min(y, (typeof window !== "undefined" ? window.innerHeight : y) - 420),
  };

  return (
    <div
      ref={ref}
      style={{ ...style, width }}
      className="fixed z-50 flex max-h-[70vh] flex-col overflow-hidden rounded-md border border-border bg-surface-raised shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium">Effects — {channelName}</span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-surface"
        >
          <X size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {effects.length === 0 && (
          <p className="px-1 py-2 text-[11px] text-muted">No effects yet — add one below.</p>
        )}
        <div className="flex flex-col gap-2">
          {effects.map((fx, i) => (
            <div key={fx.id} className="rounded border border-border bg-surface p-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold">{EFFECT_LABELS[fx.type]}</span>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    title="Move earlier in the chain"
                    disabled={i === 0}
                    onClick={() => onReorder(fx.id, -1)}
                    className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-surface-raised disabled:opacity-25"
                  >
                    <ChevronUp size={12} />
                  </button>
                  <button
                    type="button"
                    title="Move later in the chain"
                    disabled={i === effects.length - 1}
                    onClick={() => onReorder(fx.id, 1)}
                    className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-surface-raised disabled:opacity-25"
                  >
                    <ChevronDown size={12} />
                  </button>
                  <button
                    type="button"
                    title="Remove effect"
                    onClick={() => onRemove(fx.id)}
                    className="flex h-5 w-5 items-center justify-center rounded text-record hover:bg-surface-raised"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {paramSpecs(fx.type).map((spec) => (
                  <ValueBar
                    key={spec.key}
                    label={spec.label}
                    value={fx.params[spec.key]}
                    min={spec.min}
                    max={spec.max}
                    defaultValue={spec.default}
                    onChange={(v) => onParamChange(fx.id, spec.key, v)}
                    formatValue={spec.format}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border p-2">
        <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted">
          <Plus size={11} /> Add effect
        </div>
        <div className="grid grid-cols-2 gap-1">
          {EFFECT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onAdd(type)}
              className="rounded border border-border px-2 py-1 text-[11px] text-foreground hover:border-accent hover:text-accent"
            >
              {EFFECT_LABELS[type]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
