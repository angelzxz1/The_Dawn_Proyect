"use client";

import { X } from "lucide-react";
import { ValueBar } from "./ValueBar";
import { SYNTH_PRESETS, WAVETABLE_OPTIONS } from "@/lib/synth";
import type { OscillatorParams, SynthParams } from "@/lib/types";
import type { TrackColor } from "@/lib/colors";

interface SynthWindowProps {
  channelName: string;
  color: TrackColor;
  params: SynthParams;
  onChange: (params: SynthParams) => void;
  onClose: () => void;
  /** Fired once at the start of a param drag/edit gesture - lets the caller
   * push one undo checkpoint per gesture. */
  onDragStart?: () => void;
}

const FILTER_TYPES: SynthParams["filterType"][] = ["lowpass", "highpass", "bandpass", "notch"];
const LFO_TARGETS: SynthParams["lfoTarget"][] = ["pitch", "filter"];

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface-raised p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      {children}
    </div>
  );
}

function ButtonGroup<T extends string>({
  options,
  value,
  onSelect,
  labelFor,
}: {
  options: T[];
  value: T;
  onSelect: (v: T) => void;
  labelFor?: (v: T) => string;
}) {
  return (
    <div className="flex overflow-hidden rounded border border-border">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onSelect(opt)}
          className={`flex-1 border-l border-border py-1 text-[11px] capitalize first:border-l-0 ${
            value === opt ? "bg-accent/25 text-accent" : "text-muted hover:bg-surface"
          }`}
        >
          {labelFor ? labelFor(opt) : opt}
        </button>
      ))}
    </div>
  );
}

function OscillatorSection({
  label,
  osc,
  enabled,
  onToggleEnabled,
  onChange,
  onDragStart,
}: {
  label: string;
  osc: OscillatorParams;
  enabled?: boolean;
  onToggleEnabled?: () => void;
  onChange: (osc: OscillatorParams) => void;
  onDragStart?: () => void;
}) {
  return (
    <Section
      title={
        onToggleEnabled ? (
          <button type="button" onClick={onToggleEnabled} className="flex items-center gap-1.5">
            <span
              className={`h-2.5 w-2.5 rounded-full border ${enabled ? "border-accent bg-accent" : "border-border"}`}
            />
            <span>{label}</span>
          </button>
        ) : (
          label
        )
      }
    >
      <select
        value={osc.wavetable}
        onChange={(e) => {
          onDragStart?.();
          onChange({ ...osc, wavetable: e.target.value as OscillatorParams["wavetable"] });
        }}
        className="rounded border border-border bg-surface px-1.5 py-1 text-[11px]"
        title="Wavetable"
      >
        {WAVETABLE_OPTIONS.map((w) => (
          <option key={w.value} value={w.value}>
            {w.label}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2">
        <ValueBar
          label="Position"
          value={osc.position}
          min={0}
          max={1}
          defaultValue={0.4}
          onChange={(v) => onChange({ ...osc, position: v })}
          onDragStart={onDragStart}
          formatValue={(v) => `${Math.round(v * 100)}%`}
        />
        <ValueBar
          label="Level"
          value={osc.level}
          min={0}
          max={1}
          defaultValue={0.8}
          onChange={(v) => onChange({ ...osc, level: v })}
          onDragStart={onDragStart}
          formatValue={(v) => `${Math.round(v * 100)}%`}
        />
        <ValueBar
          label="Octave"
          value={osc.octave}
          min={-2}
          max={2}
          defaultValue={0}
          onChange={(v) => onChange({ ...osc, octave: Math.round(v) })}
          onDragStart={onDragStart}
          formatValue={(v) => `${v >= 0 ? "+" : ""}${Math.round(v)}`}
        />
        <ValueBar
          label="Semi"
          value={osc.semitone}
          min={-12}
          max={12}
          defaultValue={0}
          onChange={(v) => onChange({ ...osc, semitone: Math.round(v) })}
          onDragStart={onDragStart}
          formatValue={(v) => `${v >= 0 ? "+" : ""}${Math.round(v)}`}
        />
        <ValueBar
          label="Fine"
          value={osc.fineCents}
          min={-50}
          max={50}
          defaultValue={0}
          onChange={(v) => onChange({ ...osc, fineCents: v })}
          onDragStart={onDragStart}
          formatValue={(v) => `${v >= 0 ? "+" : ""}${Math.round(v)}c`}
        />
        <ValueBar
          label="Unison"
          value={osc.unisonVoices}
          min={1}
          max={8}
          defaultValue={1}
          onChange={(v) => onChange({ ...osc, unisonVoices: Math.round(v) })}
          onDragStart={onDragStart}
          formatValue={(v) => `${Math.round(v)}`}
        />
        <ValueBar
          label="Spread"
          value={osc.unisonSpread}
          min={0}
          max={50}
          defaultValue={12}
          onChange={(v) => onChange({ ...osc, unisonSpread: v })}
          onDragStart={onDragStart}
          formatValue={(v) => `${Math.round(v)}c`}
        />
      </div>
    </Section>
  );
}

/**
 * A dedicated floating window for the synth instrument's full sound-design
 * surface - two wavetable oscillators, a sub, a filter with its own
 * envelope, an amp envelope, and an LFO - opened from a button on the synth
 * instrument card in the FX rack instead of cramming all of this into the
 * rack itself. Reuses the same fixed/centered modal chrome as the piano
 * roll editor.
 */
export function SynthWindow({ channelName, color, params, onChange, onClose, onDragStart }: SynthWindowProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="relative flex max-h-[90vh] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
        style={{ width: "min(880px, 96vw)" }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-raised px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: color.accent }} />
            <span className="text-sm font-medium">Synth — {channelName}</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value=""
              onChange={(e) => {
                const preset = SYNTH_PRESETS.find((p) => p.name === e.target.value);
                if (preset) {
                  onDragStart?.();
                  onChange(structuredClone(preset.params));
                }
              }}
              className="rounded border border-border bg-surface px-1.5 py-1 text-[11px]"
              title="Load a preset"
            >
              <option value="" disabled>
                Presets…
              </option>
              {SYNTH_PRESETS.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onClose}
              title="Close"
              className="flex h-7 w-7 items-center justify-center rounded border border-border hover:bg-surface"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-2 overflow-y-auto p-3 sm:grid-cols-2">
          <OscillatorSection
            label="Oscillator A"
            osc={params.oscA}
            onChange={(oscA) => onChange({ ...params, oscA })}
            onDragStart={onDragStart}
          />
          <OscillatorSection
            label="Oscillator B"
            osc={params.oscB}
            enabled={params.oscBEnabled}
            onToggleEnabled={() => {
              onDragStart?.();
              onChange({ ...params, oscBEnabled: !params.oscBEnabled });
            }}
            onChange={(oscB) => onChange({ ...params, oscB })}
            onDragStart={onDragStart}
          />

          <Section title="Sub Oscillator">
            <div className="flex flex-wrap gap-2">
              <ValueBar
                label="Level"
                value={params.subLevel}
                min={0}
                max={1}
                defaultValue={0.2}
                onChange={(v) => onChange({ ...params, subLevel: v })}
                onDragStart={onDragStart}
                formatValue={(v) => `${Math.round(v * 100)}%`}
              />
              <ValueBar
                label="Octave"
                value={params.subOctaveDown}
                min={1}
                max={2}
                defaultValue={1}
                onChange={(v) => onChange({ ...params, subOctaveDown: Math.round(v) as 1 | 2 })}
                onDragStart={onDragStart}
                formatValue={(v) => `-${Math.round(v)}`}
              />
              <ValueBar
                label="Glide"
                value={params.glide}
                min={0}
                max={1}
                defaultValue={0}
                onChange={(v) => onChange({ ...params, glide: v })}
                onDragStart={onDragStart}
                formatValue={(v) => `${Math.round(v * 1000)}ms`}
              />
            </div>
          </Section>

          <Section title="LFO">
            <ButtonGroup
              options={LFO_TARGETS}
              value={params.lfoTarget}
              onSelect={(v) => {
                onDragStart?.();
                onChange({ ...params, lfoTarget: v });
              }}
            />
            <div className="flex flex-wrap gap-2">
              <ValueBar
                label="Rate"
                value={params.lfoRate}
                min={0.05}
                max={20}
                defaultValue={5}
                onChange={(v) => onChange({ ...params, lfoRate: v })}
                onDragStart={onDragStart}
                formatValue={(v) => `${v.toFixed(1)}Hz`}
              />
              <ValueBar
                label="Amount"
                value={params.lfoAmount}
                min={0}
                max={1}
                defaultValue={0}
                onChange={(v) => onChange({ ...params, lfoAmount: v })}
                onDragStart={onDragStart}
                formatValue={(v) => `${Math.round(v * 100)}%`}
              />
            </div>
          </Section>

          <Section title="Filter">
            <ButtonGroup
              options={FILTER_TYPES}
              value={params.filterType}
              onSelect={(v) => {
                onDragStart?.();
                onChange({ ...params, filterType: v });
              }}
            />
            <div className="flex flex-wrap gap-2">
              <ValueBar
                label="Cutoff"
                value={params.filterCutoff}
                min={40}
                max={12000}
                defaultValue={2000}
                onChange={(v) => onChange({ ...params, filterCutoff: v })}
                onDragStart={onDragStart}
                formatValue={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz`)}
              />
              <ValueBar
                label="Reso"
                value={params.filterResonance}
                min={0.1}
                max={20}
                defaultValue={1}
                onChange={(v) => onChange({ ...params, filterResonance: v })}
                onDragStart={onDragStart}
                formatValue={(v) => v.toFixed(1)}
              />
              <ValueBar
                label="Env amt"
                value={params.filterEnvAmount}
                min={-4}
                max={4}
                defaultValue={0}
                bipolar
                onChange={(v) => onChange({ ...params, filterEnvAmount: v })}
                onDragStart={onDragStart}
                formatValue={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}oct`}
              />
            </div>
          </Section>

          <Section title="Filter Envelope">
            <div className="flex flex-wrap gap-2">
              <ValueBar
                label="Attack"
                value={params.filterAttack}
                min={0.001}
                max={2}
                defaultValue={0.01}
                onChange={(v) => onChange({ ...params, filterAttack: v })}
                onDragStart={onDragStart}
                formatValue={(v) => `${Math.round(v * 1000)}ms`}
              />
              <ValueBar
                label="Decay"
                value={params.filterDecay}
                min={0.01}
                max={2}
                defaultValue={0.2}
                onChange={(v) => onChange({ ...params, filterDecay: v })}
                onDragStart={onDragStart}
                formatValue={(v) => `${Math.round(v * 1000)}ms`}
              />
              <ValueBar
                label="Sustain"
                value={params.filterSustain}
                min={0}
                max={1}
                defaultValue={0.5}
                onChange={(v) => onChange({ ...params, filterSustain: v })}
                onDragStart={onDragStart}
                formatValue={(v) => `${Math.round(v * 100)}%`}
              />
              <ValueBar
                label="Release"
                value={params.filterRelease}
                min={0.01}
                max={3}
                defaultValue={0.2}
                onChange={(v) => onChange({ ...params, filterRelease: v })}
                onDragStart={onDragStart}
                formatValue={(v) => `${v.toFixed(2)}s`}
              />
            </div>
          </Section>

          <Section title="Amp Envelope">
            <div className="flex flex-wrap gap-2">
              <ValueBar
                label="Attack"
                value={params.ampAttack}
                min={0.001}
                max={2}
                defaultValue={0.01}
                onChange={(v) => onChange({ ...params, ampAttack: v })}
                onDragStart={onDragStart}
                formatValue={(v) => `${Math.round(v * 1000)}ms`}
              />
              <ValueBar
                label="Decay"
                value={params.ampDecay}
                min={0.01}
                max={2}
                defaultValue={0.2}
                onChange={(v) => onChange({ ...params, ampDecay: v })}
                onDragStart={onDragStart}
                formatValue={(v) => `${Math.round(v * 1000)}ms`}
              />
              <ValueBar
                label="Sustain"
                value={params.ampSustain}
                min={0}
                max={1}
                defaultValue={0.5}
                onChange={(v) => onChange({ ...params, ampSustain: v })}
                onDragStart={onDragStart}
                formatValue={(v) => `${Math.round(v * 100)}%`}
              />
              <ValueBar
                label="Release"
                value={params.ampRelease}
                min={0.01}
                max={3}
                defaultValue={0.2}
                onChange={(v) => onChange({ ...params, ampRelease: v })}
                onDragStart={onDragStart}
                formatValue={(v) => `${v.toFixed(2)}s`}
              />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
