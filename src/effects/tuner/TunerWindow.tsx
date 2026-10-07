"use client";

import { PluginKnob } from "@/effects/ui/PluginKnob";
import { PluginToggle, PluginWindow } from "@/effects/ui/PluginChrome";
import { Segmented } from "@/effects/ui/PluginSegmented";
import { TunerHistory, TunerNeedle, tuneColor, useTuner } from "./TunerDisplay";
import { paramSpecs } from "@/effects/registry";

interface TunerWindowProps {
  hostId: string;
  effectId: string;
  channelName: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

const spec = (key: string) => paramSpecs("tuner").find((s) => s.key === key)!;

/** The full Tuner: the needle, the note's frequency and how far off it
 * is, a few seconds of history, and the reference pitch. */
export function TunerWindow({ hostId, effectId, channelName, params, bypass, onBypassToggle, onClose, onParamChange, onParamDragStart }: TunerWindowProps) {
  const reference = params.reference ?? 440;
  const flats = (params.flats ?? 0) >= 0.5;
  const muted = (params.mute ?? 0) >= 0.5;
  const { note, history } = useTuner(bypass ? undefined : hostId, effectId, reference, flats);

  return (
    <PluginWindow title="Tuner" channelName={channelName} bypass={bypass} onBypassToggle={onBypassToggle} onClose={onClose} width={620}>
      <div className="flex flex-col items-center gap-1 rounded-xl py-3" style={{ background: "#14151A", border: "1px solid #2E2F37" }}>
        <TunerNeedle note={note} size={360} />
        <div className="flex items-baseline gap-5 font-mono text-[13px]">
          <span style={{ color: note ? tuneColor(note.cents) : "#5A5B64" }}>
            {note ? `${note.cents > 0 ? "+" : ""}${note.cents.toFixed(1)} ct` : "no signal"}
          </span>
          <span className="text-muted">{note ? `${note.freq.toFixed(2)} Hz` : ""}</span>
          <span className="text-muted">{note ? `target ${note.targetHz.toFixed(2)} Hz` : ""}</span>
        </div>
        {bypass && <p className="text-[11px] text-muted">The tuner is bypassed - turn it on to see the pitch.</p>}
      </div>

      <TunerHistory history={history} width={576} height={90} />

      <div className="flex items-center gap-5">
        <PluginKnob
          label="Reference"
          value={reference}
          min={410}
          max={480}
          defaultValue={440}
          mode="linear"
          size={36}
          layout="inline"
          showReadout
          onChange={(v) => onParamChange("reference", Math.round(v * 10) / 10)}
          onDragStart={onParamDragStart}
          formatValue={spec("reference").format}
        />
        <Segmented
          label="Note names"
          options={[
            { value: 0, label: "♯ Sharps" },
            { value: 1, label: "♭ Flats" },
          ]}
          value={flats ? 1 : 0}
          onSelect={(v) => onParamChange("flats", v)}
        />
        <div className="ml-auto">
          <PluginToggle
            label="Mute while tuning"
            active={muted}
            danger
            title="Silence the track's output (the tuner still listens)"
            onClick={() => {
              onParamDragStart?.();
              onParamChange("mute", muted ? 0 : 1);
            }}
          />
        </div>
      </div>
    </PluginWindow>
  );
}
