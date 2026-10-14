// The Multiband Compressor: its key, name, browser group and parameters. Its
// audio node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect, type ParamSpec } from "../types";
import { pct, msSpaced, dbSpaced, dbSigned } from "../format";
import { SIDECHAIN_SPECS } from "../sidechain/specs";
import { MB_BAND_DEFAULTS, MB_DEFAULT_BANDS, MB_DEFAULT_CROSSOVERS, MB_MAX_BANDS, MB_MODES, MB_MODE_LABELS } from "./multibandModel";

/** The Multiband Compressor's params: the band count, up to
 * MB_MAX_BANDS - 1 crossovers (`x<n>`), each band's dynamics as flat
 * `b<n>Thresh/Ratio/...` keys, mix/output, and two view settings. */
function multibandSpecs(): ParamSpec[] {
  const hzFine = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`);
  const time = (v: number) => (v < 0.01 ? `${(v * 1000).toFixed(1)} ms` : msSpaced(v));
  const specs: ParamSpec[] = [
    { key: "bands", label: "Bands", min: 1, max: MB_MAX_BANDS, default: MB_DEFAULT_BANDS, format: (v) => `${Math.round(v)}`, automatable: false },
  ];
  for (let k = 0; k < MB_MAX_BANDS - 1; k++) {
    specs.push({ key: `x${k + 1}`, label: `Crossover ${k + 1}`, min: 20, max: 20000, default: MB_DEFAULT_CROSSOVERS[k], format: hzFine });
  }
  for (let i = 0; i < MB_MAX_BANDS; i++) {
    const n = i + 1;
    const d = MB_BAND_DEFAULTS;
    specs.push(
      { key: `b${n}Thresh`, label: `Band ${n} Threshold`, min: -60, max: 0, default: d.Thresh, format: dbSpaced },
      { key: `b${n}Ratio`, label: `Band ${n} Ratio`, min: 1, max: 20, default: d.Ratio, format: (v) => `${v.toFixed(v < 10 ? 1 : 0)}:1` },
      { key: `b${n}Attack`, label: `Band ${n} Attack`, min: 0.0001, max: 0.5, default: d.Attack, format: time },
      { key: `b${n}Release`, label: `Band ${n} Release`, min: 0.005, max: 2, default: d.Release, format: time },
      { key: `b${n}Knee`, label: `Band ${n} Knee`, min: 0, max: 24, default: d.Knee, format: dbSpaced },
      { key: `b${n}Range`, label: `Band ${n} Range`, min: 0, max: 60, default: d.Range, format: dbSpaced },
      { key: `b${n}Gain`, label: `Band ${n} Gain`, min: -24, max: 24, default: d.Gain, format: dbSigned },
      { key: `b${n}Mode`, label: `Band ${n} Mode`, min: 0, max: MB_MODES.length - 1, default: d.Mode, format: (v) => MB_MODE_LABELS[MB_MODES[Math.round(v)]] ?? "Compress", automatable: false },
      { key: `b${n}Bypass`, label: `Band ${n} Bypass`, min: 0, max: 1, default: d.Bypass, format: (v) => (v >= 0.5 ? "Bypassed" : "On"), automatable: false }
    );
  }
  specs.push(
    { key: "mix", label: "Mix", min: 0, max: 1, default: 1, format: pct },
    { key: "output", label: "Output", min: -24, max: 24, default: 0, format: dbSigned },
    { key: "scale", label: "Display Range", min: 6, max: 48, default: 24, format: (v) => `±${Math.round(v)} dB`, automatable: false },
    { key: "analyzer", label: "Analyzer", min: 0, max: 2, default: 2, format: (v) => ["Off", "Post", "Pre + Post"][Math.round(v)] ?? "Off", automatable: false },
    ...SIDECHAIN_SPECS
  );
  return specs;
}

export const multibandEffect = defineEffect({
  type: "multiband",
  label: "Multiband Compressor",
  group: "Dynamics",
  sidechain: true,
  params: multibandSpecs(),
});
