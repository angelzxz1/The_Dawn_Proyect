"use client";

// The full-size window of the effect opened from the FX rack - each effect
// type has its own (see effects/ui/registry.ts). Every change goes through
// effectActions, whichever host (a track, a bus or the master) the effect
// is on.

import { EFFECT_UI } from "@/effects/ui/registry";
import { EffectPresetContext } from "@/effects/ui/PresetMenu";
import type { SidechainSource } from "@/effects/sidechain/SidechainPanel";
import type { EffectInstance } from "@/effects/registry";
import { track } from "@/services/telemetry";
import { effectActions } from "@/state/effectActions";
import { projectStore } from "@/state/projectStore";
import { useShortcuts } from "@/ui/shortcuts";

/** A drag or edit gesture starts: one undo step for all of it. */
const startEdit = () => projectStore.push();

export function EffectWindow({
  hostId,
  hostName,
  effect,
  bpm,
  sidechainSources,
  onClose,
}: {
  /** The track, bus or "master" the effect is on. */
  hostId: string;
  hostName: string;
  effect: EffectInstance;
  bpm: number;
  /** Tracks and buses, for naming a dynamics effect's key. */
  sidechainSources: SidechainSource[];
  onClose: () => void;
}) {
  // Escape closes any effect's window (not while typing in one of its
  // fields; a menu open in it closes first).
  useShortcuts("window", [{ keys: "escape", run: onClose }]);
  const { Window } = EFFECT_UI[effect.type];
  return (
    <EffectPresetContext.Provider value={{ effect, bpm, onChange: (change) => effectActions.changePreset(hostId, effect.id, change) }}>
      <Window
        hostId={hostId}
        effectId={effect.id}
        channelName={hostName}
        params={effect.params}
        bypass={!!effect.bypass}
        bpm={bpm}
        file={effect.file}
        sidechain={effect.sidechain}
        sidechainSources={sidechainSources}
        onBypassToggle={() => effectActions.toggleBypass(hostId, effect.id)}
        onClose={onClose}
        onParamChange={(key, v) => effectActions.setParam(hostId, effect.id, key, v)}
        onParamDragStart={startEdit}
        onSidechainChange={(routing) => effectActions.setSidechain(hostId, effect.id, routing)}
        onLoadFile={(file) => effectActions.loadFile(hostId, effect.id, file)}
        onClearFile={() => effectActions.setFile(hostId, effect.id, null)}
        onPickFile={(ref) => {
          effectActions.setFile(hostId, effect.id, ref);
          track(effect.type === "namAmp" ? "nam_model_loaded" : "ir_loaded", { via: "browser" });
        }}
      />
    </EffectPresetContext.Provider>
  );
}
