// What you can do to an effects chain - on a track, a bus or the master
// ("master") alike: add (with a preset, or a whole chain), remove, move,
// tweak, bypass, load a preset, a file or a sidechain. Each changes the
// audio engine and the project together, as one undo step where it's an
// edit (a knob turn records its step when the drag starts).

import { audioEngine } from "@/engine/audioEngine";
import type { EffectChain } from "@/effects/chains";
import { discardEffectFile, importAudioEffectFile, importNamModelFile } from "@/effects/effectFiles";
import type { EffectFileRef, EffectInstance, EffectType } from "@/effects/registry";
import { MAX_IR_SECONDS } from "@/effects/ir-loader/irModel";
import { findPreset, paramsFromPreset } from "@/effects/presets";
import type { SidechainRouting } from "@/effects/sidechain/sidechainModel";
import { track } from "@/services/telemetry";
import type { PresetChange } from "@/effects/ui/PresetMenu";
import { projectStore } from "./projectStore";

/** A track's, a bus's or the master's effects, as the project has them. */
export function effectsOf(hostId: string): EffectInstance[] {
  const doc = projectStore.get();
  if (hostId === "master") return doc.masterEffects;
  return doc.channelEffects[hostId] ?? doc.busEffects[hostId] ?? [];
}

/** Changes a host's effects list in the project. */
function updateEffects(hostId: string, update: (list: EffectInstance[]) => EffectInstance[]): void {
  if (hostId === "master") projectStore.set("masterEffects", update);
  else if (projectStore.get().channels.some((c) => c.id === hostId))
    projectStore.set("channelEffects", (prev) => ({ ...prev, [hostId]: update(prev[hostId] ?? []) }));
  else projectStore.set("busEffects", (prev) => ({ ...prev, [hostId]: update(prev[hostId] ?? []) }));
}

const updateEffect = (hostId: string, effectId: string, change: (e: EffectInstance) => EffectInstance) =>
  updateEffects(hostId, (list) => list.map((e) => (e.id === effectId ? change(e) : e)));

/** A newly added effect with a preset loaded into it (as is, if there's no
 * such preset). */
function withPreset(hostId: string, created: EffectInstance, presetId: string | undefined): EffectInstance {
  const preset = findPreset(presetId);
  if (!preset || preset.type !== created.type) return created;
  const params = paramsFromPreset(preset, created.params, projectStore.get().bpm);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== created.params[key]) audioEngine.setEffectParam(hostId, created.id, key, value);
  });
  return { ...created, params, preset: { id: preset.id, name: preset.name } };
}

export const effectActions = {
  /** Adds an effect at `atIndex` (or the end), optionally with a preset. */
  add(hostId: string, type: EffectType, atIndex?: number, presetId?: string): void {
    projectStore.push();
    const added = audioEngine.addEffect(hostId, type, undefined, atIndex);
    if (!added) return;
    const created = withPreset(hostId, added, presetId);
    updateEffects(hostId, (prev) => {
      const list = [...prev];
      if (atIndex !== undefined && atIndex >= 0 && atIndex <= list.length) list.splice(atIndex, 0, created);
      else list.push(created);
      return list;
    });
  },

  /** Adds a ready-made chain (see chains.ts) to the end, as one undo step. */
  addChain(hostId: string, chain: EffectChain): void {
    projectStore.push();
    const added: EffectInstance[] = [];
    chain.steps.forEach((step) => {
      const fx = audioEngine.addEffect(hostId, step.type);
      if (!fx) return;
      let created = withPreset(hostId, fx, step.preset);
      if (step.params) {
        Object.entries(step.params).forEach(([key, value]) => audioEngine.setEffectParam(hostId, created.id, key, value));
        created = { ...created, params: { ...created.params, ...step.params } };
      }
      if (step.file) {
        created = { ...created, file: step.file };
        void audioEngine.setEffectFile(hostId, created.id, step.file.id);
      }
      added.push(created);
    });
    updateEffects(hostId, (prev) => [...prev, ...added]);
  },

  remove(hostId: string, effectId: string): void {
    projectStore.push();
    audioEngine.removeEffect(hostId, effectId);
    updateEffects(hostId, (list) => list.filter((e) => e.id !== effectId));
  },

  /** Moves an effect to a position in its chain (dragging a card). */
  move(hostId: string, effectId: string, toIndex: number): void {
    projectStore.push();
    audioEngine.moveEffect(hostId, effectId, toIndex);
    updateEffects(hostId, (prev) => {
      const list = [...prev];
      const idx = list.findIndex((e) => e.id === effectId);
      if (idx === -1) return prev;
      const [entry] = list.splice(idx, 1);
      list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, entry);
      return list;
    });
  },

  /** A knob or field (no undo step: that's taken when the gesture starts). */
  setParam(hostId: string, effectId: string, key: string, value: number): void {
    audioEngine.setEffectParam(hostId, effectId, key, value);
    updateEffect(hostId, effectId, (e) => ({ ...e, params: { ...e.params, [key]: value } }));
  },

  toggleBypass(hostId: string, effectId: string): void {
    const effect = effectsOf(hostId).find((e) => e.id === effectId);
    if (!effect) return;
    projectStore.push();
    const bypass = !effect.bypass;
    audioEngine.setEffectBypass(hostId, effectId, bypass);
    updateEffect(hostId, effectId, (e) => ({ ...e, bypass }));
  },

  /** Loads a preset into an effect (or marks the one it was saved as). */
  changePreset(hostId: string, effectId: string, change: PresetChange): void {
    const effect = effectsOf(hostId).find((e) => e.id === effectId);
    if (!effect) return;
    projectStore.push();
    Object.entries(change.params).forEach(([key, value]) => {
      if (value !== effect.params[key]) audioEngine.setEffectParam(hostId, effectId, key, value);
    });
    updateEffect(hostId, effectId, (e) => {
      const next: EffectInstance = { ...e, params: { ...change.params } };
      if (change.preset) next.preset = change.preset;
      else delete next.preset;
      return next;
    });
  },

  /** Sets (or clears) the file a file-based effect plays (an IR, an amp
   * model). */
  setFile(hostId: string, effectId: string, file: EffectFileRef | null): void {
    projectStore.push();
    updateEffect(hostId, effectId, (e) => {
      const next = { ...e };
      if (file) next.file = file;
      else delete next.file;
      return next;
    });
    void audioEngine.setEffectFile(hostId, effectId, file?.id ?? null);
  },

  /** Sets where a dynamics effect listens (its sidechain). */
  setSidechain(hostId: string, effectId: string, routing: SidechainRouting): void {
    projectStore.push();
    updateEffect(hostId, effectId, (e) => ({ ...e, sidechain: routing }));
    audioEngine.setEffectSidechain(hostId, effectId, routing);
  },

  /** Loads an uploaded file (an IR, an amp model) into a file-based effect.
   * Resolves with an error message if the file can't be used, leaving the
   * effect unchanged. */
  async loadFile(hostId: string, effectId: string, file: File): Promise<string | null> {
    const effect = effectsOf(hostId).find((e) => e.id === effectId);
    if (effect?.type === "namAmp") {
      // The engine is the real judge of a model file, so it's loaded there
      // first; only a model that loads becomes part of the project.
      const result = await importNamModelFile(file);
      if ("error" in result) return result.error;
      const error = await audioEngine.setEffectFile(hostId, effectId, result.ref.id);
      if (error) {
        discardEffectFile(result.ref.id);
        void audioEngine.setEffectFile(hostId, effectId, effect.file?.id ?? null);
        return `Couldn't load "${file.name}": ${error}`;
      }
      effectActions.setFile(hostId, effectId, result.ref);
      track("nam_model_loaded", { via: "file" });
      return null;
    }
    const result = await importAudioEffectFile(file, audioEngine.sampleRate, MAX_IR_SECONDS);
    if ("error" in result) return result.error;
    effectActions.setFile(hostId, effectId, result.ref);
    track("ir_loaded", { via: "file" });
    return null;
  },
};
