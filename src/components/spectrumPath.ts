// The analyzer drawing shared by the Parametric EQ and Multiband
// Compressor graphs: an FFT frame turned into a filled SVG path.

const SPECTRUM_POINTS = 220;
/** Tilt (dB/oct, pivoting at 1 kHz) so typical music reads roughly flat,
 * and the dB range mapped onto the graph's height. */
const SPECTRUM_TILT = 4.5;
const SPECTRUM_TOP_DB = -6;
const SPECTRUM_BOTTOM_DB = -96;

/** `data` is dB per FFT bin (0 Hz to Nyquist); the graph spans fMin..fMax
 * on a log axis, `width` x `height`. Empty if there's no data. */
export function spectrumPath(data: Float32Array | null, sampleRate: number, width: number, height: number, fMin: number, fMax: number): string {
  if (!data || !data.length) return "";
  const span = Math.log(fMax / fMin);
  const binHz = sampleRate / 2 / data.length;
  let d = `M0,${height}`;
  for (let p = 0; p < SPECTRUM_POINTS; p++) {
    const f0 = fMin * Math.exp((p / SPECTRUM_POINTS) * span);
    const f1 = fMin * Math.exp(((p + 1) / SPECTRUM_POINTS) * span);
    const from = Math.max(1, Math.floor(f0 / binHz));
    const to = Math.min(data.length - 1, Math.max(from, Math.ceil(f1 / binHz)));
    let peak = -Infinity;
    for (let k = from; k <= to; k++) if (data[k] > peak) peak = data[k];
    const fc = Math.sqrt(f0 * f1);
    const level = peak + SPECTRUM_TILT * Math.log2(fc / 1000);
    const t = Math.max(0, Math.min(1, (level - SPECTRUM_BOTTOM_DB) / (SPECTRUM_TOP_DB - SPECTRUM_BOTTOM_DB)));
    d += ` L${((Math.log(fc / fMin) / span) * width).toFixed(1)},${(height - t * height).toFixed(1)}`;
  }
  return `${d} L${width},${height} Z`;
}
