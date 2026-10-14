// The Chorus effect's modulation model, shared by the audio engine and the
// Chorus window's graph/readout so both describe the same sweep.

export type ChorusWaveform = "sine" | "triangle";
export const CHORUS_WAVEFORMS: ChorusWaveform[] = ["sine", "triangle"];

export function chorusWaveformFromParam(v: number): ChorusWaveform {
  return v >= 0.5 ? "triangle" : "sine";
}

/** The delay time's sweep, in ms: Depth swings it by ±(Delay × Depth) -
 * the same meaning Tone.Chorus gave it, so choruses saved before this
 * plugin keep their sound. */
export function chorusDelayRange(delayMs: number, depth: number): [number, number] {
  const deviation = delayMs * depth;
  return [Math.max(0, delayMs - deviation), delayMs + deviation];
}

/** One LFO cycle's shape at `phase` cycles (0 = centre, rising), -1..1 -
 * the same phase convention as the Web Audio oscillators driving it. */
export function chorusLfoShape(waveform: ChorusWaveform, phase: number): number {
  const s = Math.sin(2 * Math.PI * phase);
  return waveform === "sine" ? s : (2 / Math.PI) * Math.asin(s);
}
