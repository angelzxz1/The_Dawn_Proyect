// How the effects' parameter values read (in the rack, windows and
// automation lanes), shared by their definitions.

export const db = (v: number) => `${v.toFixed(1)}dB`;
export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const ms = (v: number) => `${Math.round(v * 1000)}ms`;
export const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz`);
export const ratio = (v: number) => `${v.toFixed(1)}:1`;
export const sec = (v: number) => `${v.toFixed(2)}s`;
export const msSpaced = (v: number) => `${Math.round(v * 1000)} ms`;
export const secSpaced = (v: number) => `${v.toFixed(2)} s`;
export const dbSpaced = (v: number) => `${v.toFixed(1)} dB`;
export const dbSigned = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
export const hzSpaced = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${Math.round(v)} Hz`);
export const tenths = (v: number) => v.toFixed(1);
