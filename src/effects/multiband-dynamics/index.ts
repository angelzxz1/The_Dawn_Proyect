// The Multiband Dynamics: its key, name, browser group and parameters. Its
// audio node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect, type ParamSpec } from "../types";
import { pct, dbSpaced, dbSigned, hzSpaced } from "../format";
import { SIDECHAIN_SPECS } from "../sidechain/specs";
import { MBD_BANDS, MBD_BAND_LABELS, MBD_FIELD_DEFAULTS, MBD_MIN_DB, formatMbdRatio, mbdKey } from "./mbDynamicsModel";

/** Multiband Dynamics: the Low/High band switches and crossovers, each
 * band's `<l|m|h><Field>` settings (see mbDynamicsModel.ts), and the
 * global controls. */
function mbDynamicsSpecs(): ParamSpec[] {
  const ms = (v: number) => (v < 0.01 ? `${(v * 1000).toFixed(1)} ms` : v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
  const onOff = (v: number) => (v >= 0.5 ? "On" : "Off");
  const specs: ParamSpec[] = [
    { key: "lowOn", label: "Low Band", min: 0, max: 1, default: 1, format: onOff, automatable: false },
    { key: "highOn", label: "High Band", min: 0, max: 1, default: 1, format: onOff, automatable: false },
    { key: "xLow", label: "Low Crossover", min: 40, max: 2000, default: 120, format: hzSpaced },
    { key: "xHigh", label: "High Crossover", min: 300, max: 16000, default: 2500, format: hzSpaced },
  ];
  MBD_BANDS.forEach((b) => {
    const name = MBD_BAND_LABELS[b];
    const d = MBD_FIELD_DEFAULTS;
    specs.push(
      { key: mbdKey(b, "On"), label: `${name} On`, min: 0, max: 1, default: d.On, format: onOff, automatable: false },
      { key: mbdKey(b, "Solo"), label: `${name} Solo`, min: 0, max: 1, default: d.Solo, format: onOff, automatable: false },
      { key: mbdKey(b, "In"), label: `${name} Input`, min: -24, max: 24, default: d.In, format: dbSigned },
      { key: mbdKey(b, "Out"), label: `${name} Output`, min: -24, max: 24, default: d.Out, format: dbSigned },
      { key: mbdKey(b, "AboveT"), label: `${name} Above Threshold`, min: MBD_MIN_DB, max: 0, default: d.AboveT, format: dbSpaced },
      { key: mbdKey(b, "AboveR"), label: `${name} Above Ratio`, min: 0.5, max: 50, default: d.AboveR, format: formatMbdRatio },
      { key: mbdKey(b, "BelowT"), label: `${name} Below Threshold`, min: MBD_MIN_DB, max: 0, default: d.BelowT, format: dbSpaced },
      { key: mbdKey(b, "BelowR"), label: `${name} Below Ratio`, min: 0.1, max: 50, default: d.BelowR, format: formatMbdRatio },
      { key: mbdKey(b, "Attack"), label: `${name} Attack`, min: 0.0001, max: 1, default: d.Attack, format: ms },
      { key: mbdKey(b, "Release"), label: `${name} Release`, min: 0.001, max: 3, default: d.Release, format: ms }
    );
  });
  specs.push(
    { key: "softKnee", label: "Soft Knee", min: 0, max: 1, default: 1, format: onOff, automatable: false },
    { key: "rms", label: "Detection", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "RMS" : "Peak"), automatable: false },
    { key: "output", label: "Output", min: -24, max: 24, default: 0, format: dbSigned },
    { key: "time", label: "Time", min: 0.1, max: 10, default: 1, format: (v) => `${Math.round(v * 100)}%` },
    { key: "amount", label: "Amount", min: 0, max: 1, default: 1, format: pct },
    { key: "view", label: "View", min: 0, max: 2, default: 2, format: (v) => ["Time", "Below", "Above"][Math.round(v)] ?? "Above", automatable: false },
    ...SIDECHAIN_SPECS,
    { key: "scMix", label: "Sidechain Mix", min: 0, max: 1, default: 1, format: pct }
  );
  return specs;
}

export const multibandDynamicsEffect = defineEffect({
  type: "mbDynamics",
  label: "Multiband Dynamics",
  group: "Dynamics",
  sidechain: true,
  params: mbDynamicsSpecs(),
});
