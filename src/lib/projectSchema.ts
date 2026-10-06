// Turns whatever was stored as the autosaved project back into a project
// the current code can safely render and play. A saved project may come
// from any older version of the app (effects gained controls, the synth
// was rebuilt, keys were renamed) or be damaged, and the UI trusts its
// state completely - one missing field used to be enough to crash the
// whole page on load. So nothing from storage is used as-is: every field is
// checked, anything missing or invalid falls back to its default, numbers
// are clamped to the ranges the UI allows, and entries that can't be made
// valid (an effect type that no longer exists, a clip on a deleted track)
// are dropped.

import { EFFECT_TYPES, FILE_EFFECT_TYPES, hasSidechain, paramSpecs, type EffectInstance, type EffectType } from "./effects";
import { SIDECHAIN_TAPS, type SidechainTap } from "./sidechainModel";
import { legacyFilterTypeToMode, migrateLegacyFilterParams } from "./filterModel";
import { SCALE_NAMES, SCALE_ROOTS, type ScaleSetting } from "./scales";
import { SNAP_RESOLUTIONS, quarterNotesPerBar, type SnapResolution } from "./timeline";
import { normalizeArrangementLoop, type ArrangementLoop } from "./arrangementLoop";
import { normalizeSynthParams } from "./synthParams";
import { normalizeDrumKit } from "./drumParams";
import { HEX_COLOR } from "./colors";
import { MASTER_OUTPUT, normalizeGroups } from "./routing";
import type {
  AutomationLane,
  AutomationPoint,
  BusConfig,
  ChannelConfig,
  InstrumentType,
  NoteEvent,
  TimeSignature,
  TrackInput,
} from "./types";

/** Bump whenever the saved format changes, and teach `normalizeProject`
 * how to read the older shape. */
export const PROJECT_VERSION = 2;

interface SerializedMidiClip {
  id: string;
  kind: "midi";
  offset: number;
  length: number;
  notes: NoteEvent[];
  loopLength?: number | null;
}

interface SerializedAudioClip {
  id: string;
  kind: "audio";
  offset: number;
  length: number;
  fileName: string;
  durationSeconds: number;
  peaks: number[];
  sourceOffset: number;
  fadeIn: number;
  fadeOut: number;
  gainDb: number;
  loopLength?: number | null;
}

export type SerializedClip = SerializedMidiClip | SerializedAudioClip;

export interface SerializedProject {
  version: number;
  savedAt: number;
  channels: ChannelConfig[];
  clipsByChannel: Record<string, SerializedClip[]>;
  channelEffects: Record<string, EffectInstance[]>;
  buses: BusConfig[];
  busEffects: Record<string, EffectInstance[]>;
  bpm: number;
  timeSignature: TimeSignature;
  masterVolume: number;
  masterPan: number;
  masterName: string;
  masterLimiterThreshold: number;
  masterEffects: EffectInstance[];
  scaleSetting: ScaleSetting;
  snapResolution: SnapResolution;
  countInBars: number;
  metronomeEnabled: boolean;
  /** The arrangement loop, in beats. */
  loop: ArrangementLoop;
  /** Audio tracks monitoring their input (ids). */
  monitoredTracks: string[];
}

// --- primitives ---

type Raw = Record<string, unknown>;

function obj(v: unknown): Raw {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

function int(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return Math.round(num(v, fallback, min, max));
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function oneOf<T>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

function nonEmptyId(v: unknown): string | null {
  // Ids become object keys, so "__proto__" would corrupt the maps.
  return typeof v === "string" && v.length > 0 && v !== "__proto__" ? v : null;
}

/** Keeps the first item with each id; later duplicates are dropped. Pass
 * `seen` to keep ids unique across several lists. */
function uniqueById<T extends { id: string }>(items: (T | null)[], seen = new Set<string>()): T[] {
  return items.filter((item): item is T => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

// --- effects ---

function normalizeEffect(raw: unknown): EffectInstance | null {
  const r = obj(raw);
  const id = nonEmptyId(r.id);
  if (!id || !EFFECT_TYPES.includes(r.type as EffectType)) return null;
  const type = r.type as EffectType;
  let saved = obj(r.params) as Record<string, unknown>;
  if (type === "filter") saved = migrateLegacyFilterParams(saved as Record<string, number>);
  const params = Object.fromEntries(
    paramSpecs(type).map((spec) => [spec.key, num(saved[spec.key], spec.default, spec.min, spec.max)])
  );
  const effect: EffectInstance = { id, type, params, bypass: bool(r.bypass, false) };
  // A file effect's file itself is restored from the audio store on load;
  // if it's gone, the effect still loads (empty) and names what's missing.
  const file = obj(r.file);
  const fileId = nonEmptyId(file.id);
  if (FILE_EFFECT_TYPES.includes(type) && fileId) effect.file = { id: fileId, name: str(file.name, "file") };
  // The preset it came from (it may since have been deleted - the name still
  // shows).
  const preset = obj(r.preset);
  const presetId = nonEmptyId(preset.id);
  if (presetId) effect.preset = { id: presetId, name: str(preset.name, "Preset").slice(0, 60) };
  // A key from a track that's since been deleted just stays unconnected.
  if (hasSidechain(type) && r.sidechain !== undefined) {
    const sc = obj(r.sidechain);
    effect.sidechain = {
      on: bool(sc.on, false),
      source: nonEmptyId(sc.source),
      tap: oneOf(sc.tap, SIDECHAIN_TAPS, "postFx"),
    };
  }
  return effect;
}

function normalizeEffects(raw: unknown, seenIds: Set<string>): EffectInstance[] {
  return uniqueById(arr(raw).map(normalizeEffect), seenIds);
}

// --- synth ---

export { normalizeSynthParams };

// --- channels ---

function normalizeLane(
  raw: unknown,
  effectsById: Map<string, EffectInstance>,
  legacyFilterIds: Set<string>
): AutomationLane | null {
  const r = obj(raw);
  const id = nonEmptyId(r.id);
  if (!id) return null;
  const t = obj(r.target);
  let target: AutomationLane["target"];
  let mapValue = (v: number) => v;
  // Point values are clamped to the range of the knob they drive.
  let range: [number, number];
  if (t.kind === "volume" || t.kind === "pan") {
    target = { kind: t.kind };
    range = t.kind === "volume" ? [-60, 6] : [-1, 1];
  } else if (t.kind === "effect") {
    const effectId = nonEmptyId(t.effectId);
    let paramKey = str(t.paramKey, "");
    // Automation recorded on the old Filter "type" knob now drives `mode`.
    if (effectId && legacyFilterIds.has(effectId) && paramKey === "type") {
      paramKey = "mode";
      mapValue = legacyFilterTypeToMode;
    }
    const effect = effectId ? effectsById.get(effectId) : undefined;
    const spec = effect ? paramSpecs(effect.type).find((s) => s.key === paramKey) : undefined;
    if (!effectId || !spec) return null;
    target = { kind: "effect", effectId, paramKey };
    range = [spec.min, spec.max];
  } else {
    return null;
  }
  const points: AutomationPoint[] = uniqueById(
    arr(r.points).map((p) => {
      const pr = obj(p);
      const pid = nonEmptyId(pr.id);
      if (!pid || typeof pr.time !== "number" || typeof pr.value !== "number") return null;
      if (!Number.isFinite(pr.time) || !Number.isFinite(pr.value)) return null;
      return { id: pid, time: Math.max(0, pr.time), value: num(mapValue(pr.value), 0, range[0], range[1]) };
    })
  ).sort((a, b) => a.time - b.time);
  return { id, target, points };
}

/** An audio track's input from another track, if well formed. */
function normalizeTrackInput(raw: unknown): TrackInput | null {
  const r = obj(raw);
  const track = nonEmptyId(r.track);
  if (!track) return null;
  return { track, tap: (SIDECHAIN_TAPS as readonly string[]).includes(r.tap as string) ? (r.tap as SidechainTap) : "postFx" };
}

function normalizeChannel(
  raw: unknown,
  index: number,
  busIds: Set<string>,
  effects: EffectInstance[],
  legacyFilterIds: Set<string>
): ChannelConfig | null {
  const r = obj(raw);
  const id = nonEmptyId(r.id);
  if (!id) return null;
  const type = oneOf(r.type, ["midi", "audio", "group"] as const, "midi");
  const instrument =
    type === "midi" ? oneOf<InstrumentType | null>(r.instrument, ["piano", "drums", "synth", null], null) : null;
  const sends = Object.fromEntries(
    Object.entries(obj(r.sends)).filter(
      ([busId, db]) => busIds.has(busId) && typeof db === "number" && Number.isFinite(db)
    )
  ) as Record<string, number>;
  const effectsById = new Map(effects.map((fx) => [fx.id, fx]));
  const automationLanes = uniqueById(arr(r.automationLanes).map((lane) => normalizeLane(lane, effectsById, legacyFilterIds)));
  return {
    id,
    name: str(r.name, `Track ${index + 1}`),
    volume: num(r.volume, 0, -60, 6),
    pan: num(r.pan, 0, -1, 1),
    colorIndex: int(r.colorIndex, index, 0),
    ...(typeof r.color === "string" && HEX_COLOR.test(r.color) ? { color: r.color.toLowerCase() } : {}),
    type,
    instrument,
    ...(instrument === "synth" ? { synthParams: normalizeSynthParams(r.synthParams) } : {}),
    ...(instrument === "drums" ? { drumParams: normalizeDrumKit(r.drumParams) } : {}),
    muted: bool(r.muted, false),
    solo: bool(r.solo, false),
    // A group has nothing to record.
    armed: type !== "group" && bool(r.armed, false),
    ...(typeof r.groupId === "string" && r.groupId ? { groupId: r.groupId } : {}),
    ...(typeof r.output === "string" && r.output ? { output: r.output } : {}),
    ...(type === "audio" && normalizeTrackInput(r.input) ? { input: normalizeTrackInput(r.input)! } : {}),
    ...(r.folded === true ? { folded: true } : {}),
    sends,
    automationLanes,
  };
}

// --- clips ---

const NOTE_NAME = /^[A-G]#?-?\d+$/;

function normalizeLoop(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function normalizeClip(raw: unknown, channelType: ChannelConfig["type"]): SerializedClip | null {
  const r = obj(raw);
  const id = nonEmptyId(r.id);
  // A clip's kind always matches its track's type.
  if (!id || r.kind !== channelType) return null;
  const offset = num(r.offset, 0, 0);
  const length = num(r.length, 1, 0.01);
  const loopLength = normalizeLoop(r.loopLength);
  if (r.kind === "midi") {
    const notes: NoteEvent[] = arr(r.notes).flatMap((n) => {
      const nr = obj(n);
      if (typeof nr.note !== "string" || !NOTE_NAME.test(nr.note)) return [];
      return [
        {
          note: nr.note,
          time: num(nr.time, 0, 0),
          duration: num(nr.duration, 0.25, 0.001),
          velocity: num(nr.velocity, 0.8, 0, 1),
        },
      ];
    });
    return { id, kind: "midi", offset, length, notes, loopLength };
  }
  return {
    id,
    kind: "audio",
    offset,
    length,
    fileName: str(r.fileName, "audio"),
    durationSeconds: num(r.durationSeconds, length, 0),
    peaks: arr(r.peaks).map((p) => num(p, 0, 0, 1)),
    sourceOffset: num(r.sourceOffset, 0, 0),
    fadeIn: num(r.fadeIn, 0, 0),
    fadeOut: num(r.fadeOut, 0, 0),
    gainDb: num(r.gainDb, 0, -60, 24),
    loopLength,
  };
}

// --- project ---

/** Reads a stored project of any version (or a damaged one) into a valid
 * current-version project. Never throws. Returns null only if `raw` isn't a
 * project at all. */
export function normalizeProject(raw: unknown): SerializedProject | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Raw;

  const busList = uniqueById(
    arr(r.buses).map((b, i) => {
      const br = obj(b);
      const id = nonEmptyId(br.id);
      return id
        ? {
            id,
            name: str(br.name, `Bus ${i + 1}`),
            colorIndex: int(br.colorIndex, i, 0),
            ...(typeof br.color === "string" && HEX_COLOR.test(br.color) ? { color: br.color.toLowerCase() } : {}),
          }
        : null;
    })
  );
  const busIds = new Set(busList.map((b) => b.id));

  // Effects first (lanes and sends refer to them), noting which filters
  // were saved in the pre-plugin format so their automation migrates too.
  const legacyFilterIds = new Set<string>();
  const collectLegacy = (list: unknown) =>
    arr(list).forEach((fx) => {
      const f = obj(fx);
      if (f.type === "filter" && obj(f.params).type !== undefined && obj(f.params).mode === undefined) {
        const id = nonEmptyId(f.id);
        if (id) legacyFilterIds.add(id);
      }
    });
  Object.values(obj(r.channelEffects)).forEach(collectLegacy);

  // Effect and clip ids are unique across the whole project (the engine
  // and the audio store key on them), so duplicates anywhere are dropped.
  const effectIds = new Set<string>();
  const clipIds = new Set<string>();
  const rawChannels = arr(r.channels);
  const rawChannelEffects = obj(r.channelEffects);
  const channelEffects: Record<string, EffectInstance[]> = {};
  // Groups: members right after their group, one level deep; outputs that
  // point at a missing track fall back to the default (routing.ts).
  const loaded = uniqueById(
    rawChannels.map((c, i) => {
      const id = nonEmptyId(obj(c).id);
      if (!id || Object.hasOwn(channelEffects, id)) return null;
      channelEffects[id] = normalizeEffects(rawChannelEffects[id], effectIds);
      return normalizeChannel(c, i, busIds, channelEffects[id], legacyFilterIds);
    })
  );
  const loadedIds = new Set(loaded.map((c) => c.id));
  const channels = normalizeGroups(
    loaded.map((c) => {
      // An input from a track that isn't there goes back to the interface.
      if (c.input && !loadedIds.has(c.input.track)) {
        const { input: _i, ...rest } = c;
        void _i;
        c = rest;
      }
      if (!c.output || c.output === MASTER_OUTPUT || loadedIds.has(c.output)) return c;
      const { output: _o, ...rest } = c;
      void _o;
      return rest;
    })
  );

  const clipsByChannel: Record<string, SerializedClip[]> = {};
  const rawClips = obj(r.clipsByChannel);
  channels.forEach((c) => {
    clipsByChannel[c.id] = uniqueById(
      c.type === "group" ? [] : arr(rawClips[c.id]).map((clip) => normalizeClip(clip, c.type as "midi" | "audio")),
      clipIds
    );
  });

  const rawBusEffects = obj(r.busEffects);
  const busEffects: Record<string, EffectInstance[]> = {};
  busList.forEach((b) => {
    busEffects[b.id] = normalizeEffects(rawBusEffects[b.id], effectIds);
  });
  const masterEffects = normalizeEffects(r.masterEffects, effectIds);

  const ts = obj(r.timeSignature);
  const scale = obj(r.scaleSetting);

  return {
    version: PROJECT_VERSION,
    savedAt: num(r.savedAt, 0, 0),
    channels,
    clipsByChannel,
    channelEffects,
    buses: busList,
    busEffects,
    bpm: num(r.bpm, 120, 20, 300),
    timeSignature: {
      numerator: int(ts.numerator, 4, 1, 32),
      denominator: oneOf(ts.denominator, [1, 2, 4, 8, 16], 4),
    },
    masterVolume: num(r.masterVolume, 0, -60, 6),
    masterPan: num(r.masterPan, 0, -1, 1),
    masterName: str(r.masterName, "Master") || "Master",
    masterLimiterThreshold: num(r.masterLimiterThreshold, -1, -24, 0),
    masterEffects,
    scaleSetting: {
      root: oneOf(scale.root, SCALE_ROOTS, "C"),
      scale: oneOf(scale.scale, SCALE_NAMES, "Major"),
      enabled: bool(scale.enabled, false),
    },
    snapResolution: oneOf(r.snapResolution, SNAP_RESOLUTIONS, "bar"),
    countInBars: oneOf(r.countInBars, [0, 1, 2, 4], 0),
    metronomeEnabled: bool(r.metronomeEnabled, false),
    loop: normalizeArrangementLoop(
      r.loop,
      quarterNotesPerBar(int(ts.numerator, 4, 1, 32), oneOf(ts.denominator, [1, 2, 4, 8, 16], 4))
    ),
    // Only audio tracks that exist, each once.
    monitoredTracks: [...new Set(arr(r.monitoredTracks).filter((id): id is string => typeof id === "string"))].filter((id) =>
      channels.some((c) => c.id === id && c.type === "audio")
    ),
  };
}
