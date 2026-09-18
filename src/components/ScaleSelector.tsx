"use client";

import { Music } from "lucide-react";
import { SCALE_NAMES, SCALE_ROOTS, type ScaleSetting } from "@/lib/scales";

interface ScaleSelectorProps {
  value: ScaleSetting;
  onChange: (value: ScaleSetting) => void;
}

export function ScaleSelector({ value, onChange }: ScaleSelectorProps) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <button
        type="button"
        onClick={() => onChange({ ...value, enabled: !value.enabled })}
        title="Highlight scale notes"
        aria-pressed={value.enabled}
        className={`flex items-center gap-1.5 rounded border px-2 py-1 transition-colors ${
          value.enabled
            ? "border-accent bg-accent/20 text-accent"
            : "border-border hover:bg-surface-raised"
        }`}
      >
        <Music size={13} />
        Scale
      </button>
      <select
        value={value.root}
        disabled={!value.enabled}
        onChange={(e) => onChange({ ...value, root: e.target.value })}
        className="rounded border border-border bg-surface-raised px-1.5 py-1 text-foreground disabled:opacity-40"
      >
        {SCALE_ROOTS.map((root) => (
          <option key={root} value={root}>
            {root}
          </option>
        ))}
      </select>
      <select
        value={value.scale}
        disabled={!value.enabled}
        onChange={(e) => onChange({ ...value, scale: e.target.value })}
        className="rounded border border-border bg-surface-raised px-1.5 py-1 text-foreground disabled:opacity-40"
      >
        {SCALE_NAMES.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}
