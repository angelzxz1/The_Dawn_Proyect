"use client";

// The full-size window of the effect opened from the FX rack - each effect
// type has its own. Every change goes through effectActions, whichever host
// (a track, a bus or the master) the effect is on.

import { CompressorWindow } from "../CompressorWindow";
import { ChorusWindow } from "../ChorusWindow";
import { DelayWindow } from "../DelayWindow";
import { DistortionWindow } from "../DistortionWindow";
import { EQThreeWindow } from "../EQThreeWindow";
import { FilterWindow } from "../FilterWindow";
import { GateWindow } from "../GateWindow";
import { GlueWindow } from "../GlueWindow";
import { FurnaceWindow } from "../FurnaceWindow";
import { IrLoaderWindow } from "../IrLoaderWindow";
import { LimiterWindow } from "../LimiterWindow";
import { MbDynamicsWindow } from "../MbDynamicsWindow";
import { MultibandWindow } from "../MultibandWindow";
import { NamAmpWindow } from "../NamAmpWindow";
import { ParamEqWindow } from "../ParamEqWindow";
import { PitchShiftWindow } from "../PitchShiftWindow";
import { EffectPresetContext } from "../PresetMenu";
import { ReverbWindow } from "../ReverbWindow";
import type { SidechainSource } from "../SidechainPanel";
import { TunerWindow } from "../TunerWindow";
import { UtilityWindow } from "../UtilityWindow";
import type { EffectInstance } from "@/lib/effects";
import { track } from "@/lib/telemetry";
import { effectActions } from "@/state/effectActions";
import { projectStore } from "@/state/projectStore";
import { useShortcuts } from "@/lib/shortcuts";

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
  return (
    <EffectPresetContext.Provider value={{ effect, bpm, onChange: (change) => effectActions.changePreset(hostId, effect.id, change) }}>
        {effect.type === "eq3" && (
          <EQThreeWindow
            channelName={hostName}
            params={effect.params}
            bypass={!!effect.bypass}
            onBypassToggle={() =>
              effectActions.toggleBypass(hostId, effect.id)
            }
            onClose={onClose}
            onParamChange={(key, v) =>
              effectActions.setParam(hostId, effect.id, key, v)
            }
            onParamDragStart={startEdit}
          />
        )}

        {effect.type === "compressor" && (
          <CompressorWindow
            channelName={hostName}
            hostId={hostId}
            effectId={effect.id}
            params={effect.params}
            bypass={!!effect.bypass}
            onBypassToggle={() =>
              effectActions.toggleBypass(hostId, effect.id)
            }
            onClose={onClose}
            onParamChange={(key, v) =>
              effectActions.setParam(hostId, effect.id, key, v)
            }
            onParamDragStart={startEdit}
            sidechain={effect.sidechain}
            sidechainSources={sidechainSources}
            onSidechainChange={(routing) => effectActions.setSidechain(hostId, effect.id, routing)}
          />
        )}
        {effect.type === "tubeAmp" && (
          <FurnaceWindow
            channelName={hostName}
            params={effect.params}
            bypass={!!effect.bypass}
            onBypassToggle={() =>
              effectActions.toggleBypass(hostId, effect.id)
            }
            onClose={onClose}
            onParamChange={(key, v) =>
              effectActions.setParam(hostId, effect.id, key, v)
            }
            onParamDragStart={startEdit}
          />
        )}
        {effect.type === "glue" && (
          <GlueWindow
            channelName={hostName}
            hostId={hostId}
            effectId={effect.id}
            params={effect.params}
            bypass={!!effect.bypass}
            onBypassToggle={() =>
              effectActions.toggleBypass(hostId, effect.id)
            }
            onClose={onClose}
            onParamChange={(key, v) =>
              effectActions.setParam(hostId, effect.id, key, v)
            }
            onParamDragStart={startEdit}
            sidechain={effect.sidechain}
            sidechainSources={sidechainSources}
            onSidechainChange={(routing) => effectActions.setSidechain(hostId, effect.id, routing)}
          />
        )}
        {effect.type === "mbDynamics" && (
          <MbDynamicsWindow
            channelName={hostName}
            hostId={hostId}
            effectId={effect.id}
            params={effect.params}
            bypass={!!effect.bypass}
            onBypassToggle={() =>
              effectActions.toggleBypass(hostId, effect.id)
            }
            onClose={onClose}
            onParamChange={(key, v) =>
              effectActions.setParam(hostId, effect.id, key, v)
            }
            onParamDragStart={startEdit}
            sidechain={effect.sidechain}
            sidechainSources={sidechainSources}
            onSidechainChange={(routing) => effectActions.setSidechain(hostId, effect.id, routing)}
          />
        )}

        {effect.type === "paramEq" && (
          <ParamEqWindow
            hostId={hostId}
            effectId={effect.id}
            channelName={hostName}
            params={effect.params}
            bypass={!!effect.bypass}
            onBypassToggle={() =>
              effectActions.toggleBypass(hostId, effect.id)
            }
            onClose={onClose}
            onParamChange={(key, v) =>
              effectActions.setParam(hostId, effect.id, key, v)
            }
            onParamDragStart={startEdit}
          />
        )}

        {effect.type === "utility" && (
          <UtilityWindow
            hostId={hostId}
            effectId={effect.id}
            channelName={hostName}
            params={effect.params}
            bypass={!!effect.bypass}
            onBypassToggle={() =>
              effectActions.toggleBypass(hostId, effect.id)
            }
            onClose={onClose}
            onParamChange={(key, v) =>
              effectActions.setParam(hostId, effect.id, key, v)
            }
            onParamDragStart={startEdit}
          />
        )}

        {effect.type === "tuner" && (
          <TunerWindow
            hostId={hostId}
            effectId={effect.id}
            channelName={hostName}
            params={effect.params}
            bypass={!!effect.bypass}
            onBypassToggle={() =>
              effectActions.toggleBypass(hostId, effect.id)
            }
            onClose={onClose}
            onParamChange={(key, v) =>
              effectActions.setParam(hostId, effect.id, key, v)
            }
            onParamDragStart={startEdit}
          />
        )}

        {effect.type === "multiband" && (
          <MultibandWindow
            hostId={hostId}
            effectId={effect.id}
            channelName={hostName}
            params={effect.params}
            bypass={!!effect.bypass}
            onBypassToggle={() =>
              effectActions.toggleBypass(hostId, effect.id)
            }
            onClose={onClose}
            onParamChange={(key, v) =>
              effectActions.setParam(hostId, effect.id, key, v)
            }
            onParamDragStart={startEdit}
            sidechain={effect.sidechain}
            sidechainSources={sidechainSources}
            onSidechainChange={(routing) => effectActions.setSidechain(hostId, effect.id, routing)}
          />
        )}

        {effect.type === "gate" && (
          <GateWindow
            hostId={hostId}
            effectId={effect.id}
            channelName={hostName}
            params={effect.params}
            bypass={!!effect.bypass}
            onBypassToggle={() =>
              effectActions.toggleBypass(hostId, effect.id)
            }
            onClose={onClose}
            onParamChange={(key, v) =>
              effectActions.setParam(hostId, effect.id, key, v)
            }
            onParamDragStart={startEdit}
            sidechain={effect.sidechain}
            sidechainSources={sidechainSources}
            onSidechainChange={(routing) => effectActions.setSidechain(hostId, effect.id, routing)}
          />
        )}

        {effect.type === "namAmp" && (
          <NamAmpWindow
            hostId={hostId}
            effectId={effect.id}
            channelName={hostName}
            params={effect.params}
            file={effect.file}
            bypass={!!effect.bypass}
            onBypassToggle={() =>
              effectActions.toggleBypass(hostId, effect.id)
            }
            onClose={onClose}
            onParamChange={(key, v) =>
              effectActions.setParam(hostId, effect.id, key, v)
            }
            onParamDragStart={startEdit}
            onLoadFile={(file) => effectActions.loadFile(hostId, effect.id, file)}
            onClearFile={() => effectActions.setFile(hostId, effect.id, null)}
            onPickFile={(ref) => {
              effectActions.setFile(hostId, effect.id, ref);
              track(effect.type === "namAmp" ? "nam_model_loaded" : "ir_loaded", { via: "browser" });
            }}
          />
        )}

        {effect.type === "irLoader" && (
          <IrLoaderWindow
            channelName={hostName}
            params={effect.params}
            file={effect.file}
            bypass={!!effect.bypass}
            onBypassToggle={() =>
              effectActions.toggleBypass(hostId, effect.id)
            }
            onClose={onClose}
            onParamChange={(key, v) =>
              effectActions.setParam(hostId, effect.id, key, v)
            }
            onParamDragStart={startEdit}
            onLoadFile={(file) => effectActions.loadFile(hostId, effect.id, file)}
            onClearFile={() => effectActions.setFile(hostId, effect.id, null)}
            onPickFile={(ref) => {
              effectActions.setFile(hostId, effect.id, ref);
              track(effect.type === "namAmp" ? "nam_model_loaded" : "ir_loaded", { via: "browser" });
            }}
          />
        )}

        {effect.type === "distortion" && (
          <DistortionWindow
            channelName={hostName}
            params={effect.params}
            bypass={!!effect.bypass}
            onBypassToggle={() =>
              effectActions.toggleBypass(hostId, effect.id)
            }
            onClose={onClose}
            onParamChange={(key, v) =>
              effectActions.setParam(hostId, effect.id, key, v)
            }
            onParamDragStart={startEdit}
          />
        )}

        {effect.type === "pitchShift" && (
          <PitchShiftWindow
            channelName={hostName}
            params={effect.params}
            bypass={!!effect.bypass}
            onBypassToggle={() =>
              effectActions.toggleBypass(hostId, effect.id)
            }
            onClose={onClose}
            onParamChange={(key, v) =>
              effectActions.setParam(hostId, effect.id, key, v)
            }
            onParamDragStart={startEdit}
          />
        )}

        {effect.type === "chorus" && (
          <ChorusWindow
            channelName={hostName}
            params={effect.params}
            bypass={!!effect.bypass}
            onBypassToggle={() =>
              effectActions.toggleBypass(hostId, effect.id)
            }
            onClose={onClose}
            onParamChange={(key, v) =>
              effectActions.setParam(hostId, effect.id, key, v)
            }
            onParamDragStart={startEdit}
          />
        )}

        {effect.type === "filter" && (
          <FilterWindow
            channelName={hostName}
            params={effect.params}
            bypass={!!effect.bypass}
            onBypassToggle={() =>
              effectActions.toggleBypass(hostId, effect.id)
            }
            onClose={onClose}
            onParamChange={(key, v) =>
              effectActions.setParam(hostId, effect.id, key, v)
            }
            onParamDragStart={startEdit}
          />
        )}

        {effect.type === "limiter" && (
          <LimiterWindow
            channelName={hostName}
            hostId={hostId}
            effectId={effect.id}
            params={effect.params}
            bypass={!!effect.bypass}
            onBypassToggle={() =>
              effectActions.toggleBypass(hostId, effect.id)
            }
            onClose={onClose}
            onParamChange={(key, v) =>
              effectActions.setParam(hostId, effect.id, key, v)
            }
            onParamDragStart={startEdit}
          />
        )}

        {effect.type === "reverb" && (
          <ReverbWindow
            channelName={hostName}
            params={effect.params}
            bypass={!!effect.bypass}
            onBypassToggle={() =>
              effectActions.toggleBypass(hostId, effect.id)
            }
            onClose={onClose}
            onParamChange={(key, v) =>
              effectActions.setParam(hostId, effect.id, key, v)
            }
            onParamDragStart={startEdit}
          />
        )}

        {effect.type === "delay" && (
          <DelayWindow
            channelName={hostName}
            bpm={bpm}
            params={effect.params}
            bypass={!!effect.bypass}
            onBypassToggle={() =>
              effectActions.toggleBypass(hostId, effect.id)
            }
            onClose={onClose}
            onParamChange={(key, v) =>
              effectActions.setParam(hostId, effect.id, key, v)
            }
            onParamDragStart={startEdit}
          />
        )}
    </EffectPresetContext.Provider>
  );
}
