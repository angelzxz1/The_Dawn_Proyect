// The Web Audio DynamicsCompressorNode (and so Tone.Compressor, a thin
// wrapper around it) always applies its own automatic makeup gain on top of
// the compression, with no way to turn it off: per the spec's processing
// algorithm, the output is multiplied by (1 / curve(1.0)) ^ 0.6, where
// curve(1.0) is the static compression curve evaluated at a full-scale
// (0dBFS) input. The lower the threshold / higher the ratio, the bigger that
// hidden boost - e.g. threshold -12dB, ratio 20 adds ~+6.8dB to everything,
// including signal that never reaches the threshold at all. That is why a
// "limiter" built on it made quiet-to-moderate material louder instead of
// only catching peaks.
//
// This mirrors the reference implementation's static curve (Blink/WebKit's
// DynamicsCompressorKernel, which Chrome, Safari and Firefox all share) so
// the boost can be cancelled with an equal-and-opposite gain stage.

const dbToLinear = (db: number) => Math.pow(10, db / 20);
const linearToDb = (x: number) => (x <= 0 ? -1000 : 20 * Math.log10(x));

/** The makeup gain, in dB, a native DynamicsCompressorNode with these
 * settings adds on its own. Subtract it (a gain stage of the negative of
 * this) to get the compression the curve alone describes. */
export function nativeCompressorMakeupDb(thresholdDb: number, kneeDb: number, ratio: number): number {
  const linearThreshold = dbToLinear(thresholdDb);
  const kneeCurve = (x: number, k: number) =>
    x < linearThreshold ? x : linearThreshold + (1 - Math.exp(-k * (x - linearThreshold))) / k;

  const slopeAt = (x: number, k: number) => {
    if (x < linearThreshold) return 1;
    const x2 = x * 1.001;
    return (
      (linearToDb(kneeCurve(x2, k)) - linearToDb(kneeCurve(x, k))) / (linearToDb(x2) - linearToDb(x))
    );
  };

  const kneeThresholdDb = thresholdDb + kneeDb;
  const kneeThreshold = dbToLinear(kneeThresholdDb);

  let minK = 0.1;
  let maxK = 10000;
  let k = 5;
  for (let i = 0; i < 15; i++) {
    if (slopeAt(kneeThreshold, k) < 1 / ratio) maxK = k;
    else minK = k;
    k = Math.sqrt(minK * maxK);
  }

  const yKneeThresholdDb = linearToDb(kneeCurve(kneeThreshold, k));
  const fullRangeGain =
    1 < kneeThreshold
      ? kneeCurve(1, k)
      : dbToLinear(yKneeThresholdDb + (1 / ratio) * (0 - kneeThresholdDb));

  return 0.6 * -linearToDb(fullRangeGain);
}
