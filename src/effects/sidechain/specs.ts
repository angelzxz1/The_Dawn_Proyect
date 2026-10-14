import { dbSigned, hzSpaced } from "../format";
import type { ParamSpec } from "../types";
import { SC_HPF_OFF, SC_LPF_OFF } from "./sidechainModel";

/** The sidechain's own settings, shared by every dynamics effect. They
 * shape what the detector hears, whether or not another track is keying
 * it. */
export const SIDECHAIN_SPECS: ParamSpec[] = [
  { key: "scGain", label: "Sidechain Gain", min: -24, max: 24, default: 0, format: dbSigned },
  { key: "scHpf", label: "Sidechain Low Cut", min: SC_HPF_OFF, max: 2000, default: SC_HPF_OFF, format: (v) => (v <= SC_HPF_OFF + 0.5 ? "Off" : hzSpaced(v)) },
  { key: "scLpf", label: "Sidechain High Cut", min: 200, max: SC_LPF_OFF, default: SC_LPF_OFF, format: (v) => (v >= SC_LPF_OFF - 1 ? "Off" : hzSpaced(v)) },
  { key: "scListen", label: "Sidechain Listen", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off"), automatable: false },
];
