// Hidden delays inside the browser's own audio nodes. The native
// DynamicsCompressorNode looks ahead ~6 ms, and a WaveShaperNode's 2x/4x
// oversampling filters delay the signal too. Browsers differ (Chrome/Safari
// share one implementation, Firefox another), so each is measured once by
// rendering an impulse offline at the app's sample rate; until that
// finishes, Chrome's figures stand in.

export interface NativeLatencies {
  /** Samples. */
  compressor: number;
  shaper2x: number;
  shaper4x: number;
}

let measured: NativeLatencies | null = null;
let measuring: Promise<NativeLatencies> | null = null;

function fallback(sampleRate: number): NativeLatencies {
  return { compressor: Math.round(0.006 * sampleRate), shaper2x: 129, shaper4x: 193 };
}

/** The latencies (samples) at `sampleRate` - measured if that's done. */
export function nativeLatencies(sampleRate: number): NativeLatencies {
  return measured ?? fallback(sampleRate);
}

/** Where an impulse at `at` comes out: the loudest sample after it. */
function peakDelay(data: Float32Array, at: number): number {
  let best = at;
  for (let i = at; i < data.length; i++) if (Math.abs(data[i]) > Math.abs(data[best])) best = i;
  return best - at;
}

/** Measures once per page; resolves with the figures. */
export function measureNativeLatencies(sampleRate: number): Promise<NativeLatencies> {
  if (measured) return Promise.resolve(measured);
  if (measuring) return measuring;
  const at = 256;
  const render = async (build: (ctx: OfflineAudioContext, src: AudioBufferSourceNode) => AudioNode) => {
    const ctx = new OfflineAudioContext(1, 4096, sampleRate);
    const buffer = ctx.createBuffer(1, 4096, sampleRate);
    // Quiet enough that the compressor (default -24 dB threshold) leaves it
    // alone - only its delay shows.
    buffer.getChannelData(0)[at] = 0.01;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    build(ctx, src).connect(ctx.destination);
    src.start();
    return peakDelay((await ctx.startRendering()).getChannelData(0), at);
  };
  const shaper = (oversample: OverSampleType) => (ctx: OfflineAudioContext, src: AudioBufferSourceNode) => {
    const node = ctx.createWaveShaper();
    node.curve = new Float32Array([-1, 1]);
    node.oversample = oversample;
    src.connect(node);
    return node;
  };
  measuring = Promise.all([
    render((ctx, src) => {
      const node = ctx.createDynamicsCompressor();
      src.connect(node);
      return node;
    }),
    render(shaper("2x")),
    render(shaper("4x")),
  ])
    .then(([compressor, shaper2x, shaper4x]) => (measured = { compressor, shaper2x, shaper4x }))
    .catch(() => (measured = fallback(sampleRate)));
  return measuring;
}
