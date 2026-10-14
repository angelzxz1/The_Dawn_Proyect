// Hidden delays inside the browser's own audio nodes: a WaveShaperNode's
// 2x/4x oversampling filters delay the signal. Browsers differ (Chrome/Safari
// share one implementation, Firefox another), so each is measured once by
// rendering an impulse offline at the app's sample rate; until that
// finishes, Chrome's figures stand in.

export interface NativeLatencies {
  /** Samples. */
  shaper2x: number;
  shaper4x: number;
}

let measured: NativeLatencies | null = null;
let measuring: Promise<NativeLatencies> | null = null;

function fallback(): NativeLatencies {
  return { shaper2x: 129, shaper4x: 193 };
}

/** The latencies (samples) - measured if that's done. */
export function nativeLatencies(): NativeLatencies {
  return measured ?? fallback();
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
    render(shaper("2x")),
    render(shaper("4x")),
  ])
    .then(([shaper2x, shaper4x]) => (measured = { shaper2x, shaper4x }))
    .catch(() => (measured = fallback()));
  return measuring;
}
