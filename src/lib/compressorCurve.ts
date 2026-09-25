// Builds the Compressor window's transfer-function preview: input dB (x)
// vs. output dB (y), both over a fixed -60..0dB range, on a square
// GRAPH_SIZE x GRAPH_SIZE viewBox - the classic "knee" graph every
// compressor plugin shows.

export const GRAPH_SIZE = 300;
const MIN_DB = -60;
const MAX_DB = 0;

export function dbToX(db: number): number {
  return ((db - MIN_DB) / (MAX_DB - MIN_DB)) * GRAPH_SIZE;
}

/** Same linear dB->pixel mapping as `dbToX`, just flipped vertically (0dB
 * at the top, -60dB at the bottom) since SVG y grows downward. */
export function dbToY(db: number): number {
  return GRAPH_SIZE - dbToX(db);
}

/** The standard quadratic soft-knee transfer function: flat (unity) well
 * below the threshold, `1/ratio` slope well above it, and a smooth
 * parabolic blend across the knee width centered on the threshold - the
 * same shape the Web Audio DynamicsCompressorNode (and so Tone.Compressor)
 * itself implements. */
export function compressorTransfer(inputDb: number, threshold: number, ratio: number, knee: number): number {
  const kneeStart = threshold - knee / 2;
  const kneeEnd = threshold + knee / 2;
  if (inputDb <= kneeStart) return inputDb;
  if (inputDb >= kneeEnd || knee <= 0) return threshold + (inputDb - threshold) / ratio;
  const x = inputDb - kneeStart;
  return inputDb + (1 / ratio - 1) * (x * x) / (2 * knee);
}

export interface CompressorCurve {
  /** The transfer curve itself, as an SVG path (input dB -60..0 -> output
   * dB, mapped to pixels). */
  curve: string;
  /** The dashed unity (no compression) reference diagonal. */
  unity: string;
  /** Pixel x-position of the threshold, for the vertical dashed marker. */
  thresholdX: number;
  /** Pixel position of the knee-center point on the curve, for the small
   * marker dot. */
  knee: { x: number; y: number };
}

const SAMPLES = 48;

export function buildCompressorCurve(threshold: number, ratio: number, knee: number): CompressorCurve {
  const points: string[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const inputDb = MIN_DB + (i / SAMPLES) * (MAX_DB - MIN_DB);
    const outputDb = compressorTransfer(inputDb, threshold, ratio, knee);
    const x = dbToX(inputDb).toFixed(1);
    const y = dbToY(outputDb).toFixed(1);
    points.push(`${i === 0 ? "M" : "L"}${x} ${y}`);
  }
  return {
    curve: points.join(" "),
    unity: `M${dbToX(MIN_DB).toFixed(1)} ${dbToY(MIN_DB).toFixed(1)} L${dbToX(MAX_DB).toFixed(1)} ${dbToY(MAX_DB).toFixed(1)}`,
    thresholdX: dbToX(threshold),
    knee: { x: dbToX(threshold), y: dbToY(compressorTransfer(threshold, threshold, ratio, knee)) },
  };
}
