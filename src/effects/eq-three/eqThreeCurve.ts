// Builds the EQ Three window's frequency-response preview: a stylized (not
// literally filter-accurate) curve showing the low/mid/high gain levels
// with smooth transitions around the low/high crossover frequencies, drawn
// on a 20Hz-20kHz log x-axis over a fixed 340x110 viewBox.

export const EQ_GRAPH_WIDTH = 340;
export const EQ_GRAPH_HEIGHT = 110;
const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const CENTER_Y = 55;
const DB_RANGE = 24; // full graph half-height (50px) represents ±24dB

export function eqFreqToX(freq: number): number {
  return (Math.log10(freq / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * EQ_GRAPH_WIDTH;
}

function dbToY(db: number): number {
  return CENTER_Y - (Math.max(-DB_RANGE, Math.min(DB_RANGE, db)) / DB_RANGE) * 50;
}

export interface EQCurve {
  stroke: string;
  fill: string;
  /** Pixel x-positions of the low/high crossover markers, for the dashed
   * guide lines. */
  lowXPixel: number;
  highXPixel: number;
}

export function buildEQCurve(low: number, mid: number, high: number, lowFreq: number, highFreq: number): EQCurve {
  const x1 = eqFreqToX(lowFreq);
  const x2 = eqFreqToX(highFreq);
  const half = Math.max(4, Math.min(22, (x2 - x1) / 2 - 2, x1 - 2, EQ_GRAPH_WIDTH - x2 - 2));
  const y0 = dbToY(low);
  const y1 = dbToY(mid);
  const y2 = dbToY(high);
  const p = (x: number, y: number) => `${x.toFixed(1)} ${y.toFixed(1)}`;

  const body =
    `L${p(x1 - half, y0)} ` +
    `C${p(x1 - half * 0.3, y0)} ${p(x1 + half * 0.3, y1)} ${p(x1 + half, y1)} ` +
    `L${p(x2 - half, y1)} ` +
    `C${p(x2 - half * 0.3, y1)} ${p(x2 + half * 0.3, y2)} ${p(x2 + half, y2)} ` +
    `L${p(EQ_GRAPH_WIDTH, y2)}`;

  return {
    stroke: `M${p(0, y0)} ${body}`,
    // A thin shaded band between the curve and the 0dB line (not the
    // graph's bottom edge) - shows deviation from flat, not "area under
    // the curve".
    fill: `M${p(0, y0)} ${body} L${p(EQ_GRAPH_WIDTH, CENTER_Y)} L${p(0, CENTER_Y)} Z`,
    lowXPixel: x1,
    highXPixel: x2,
  };
}
