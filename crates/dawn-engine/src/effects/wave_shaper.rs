//! The browser's WaveShaperNode, as Chromium runs it, for the effects the
//! studio builds from Web Audio nodes (the Saturator, and the AudioToGain
//! in Tone's LFO).
//!
//! A port of Blink's `WaveShaperHandler` (`WaveShaperCurveValues`), with
//! the 2x and 4x oversampling of `UpSampler` and `DownSampler`
//! (`platform/audio/up_sampler.cc`, `down_sampler.cc`): a sample is looked
//! up in the curve in float32, between its two nearest points. To
//! oversample, the input is upsampled by half-band filters (each doubling
//! the rate), shaped, and brought back down the same way.
//!
//! The browser runs a filter's taps in a block at a time, but each output
//! only uses inputs up to its own, so here they run a sample at a time,
//! summed in the same order. The filters on 128 frames or fewer (all at
//! 2x) are direct convolutions in float32, which this matches exactly; the
//! longer ones (the second stage at 4x) are FFT convolutions there, which
//! come out of the FFT rounded differently, so here they're summed in f64.

use std::f64::consts::{PI, TAU};

/// One sample through `curve` (`WaveShaperCurveValues`): -1 to 1 maps to
/// the curve's ends, and beyond them to its end points.
#[inline]
pub fn shape(curve: &[f32], x: f32) -> f32 {
    let last = curve.len() - 1;
    let v = ((x + 1.0) * (0.5 * last as f64) as f32).clamp(0.0, last as f32);
    let i = v as usize;
    let v1 = curve[i.min(last)];
    let v2 = curve[(i + 1).min(last)];
    v1 + (v - i as f32) * (v2 - v1)
}

/// The node's `oversample`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Oversample {
    None,
    X2,
    X4,
}

/// The upsampler's filter: a Blackman-windowed sinc half a sample along,
/// giving the samples between the input's (`UpSampler`'s `MakeKernel`).
const UP_TAPS: usize = 128;

/// The downsampler's half-band filter: 256 taps, of which only the odd
/// ones (kept here) and the middle one (0.5) aren't 0.
const DOWN_TAPS: usize = 128;

fn blackman(x: f64) -> f64 {
    let alpha = 0.16;
    let (a0, a1, a2) = (0.5 * (1.0 - alpha), 0.5, 0.5 * alpha);
    a0 - a1 * (TAU * x).cos() + a2 * (TAU * 2.0 * x).cos()
}

fn up_kernel() -> [f32; UP_TAPS] {
    let n = UP_TAPS as f64;
    let half = (UP_TAPS / 2) as i32;
    std::array::from_fn(|i| {
        let offset = -0.5;
        let s = PI * ((i as i32 - half) as f64 - offset);
        let sinc = if s == 0.0 { 1.0 } else { s.sin() / s };
        (sinc * blackman((i as f64 - offset) / n)) as f32
    })
}

fn down_kernel() -> [f32; DOWN_TAPS] {
    let n = 2 * DOWN_TAPS;
    let half = (n / 2) as i32;
    std::array::from_fn(|k| {
        let i = 2 * k + 1;
        let s = 0.5 * PI * (i as i32 - half) as f64;
        let sinc = 0.5 * (s.sin() / s);
        (sinc * blackman(i as f64 / n as f64)) as f32
    })
}

/// A signal's last `len` samples.
struct History {
    /// Each sample twice, `len` apart, so the last `len` are in one run.
    buf: Box<[f32]>,
    len: usize,
    at: usize,
}

impl History {
    fn new(len: usize) -> Self {
        Self {
            buf: vec![0.0; 2 * len].into_boxed_slice(),
            len,
            at: 0,
        }
    }

    fn push(&mut self, x: f32) {
        self.buf[self.at] = x;
        self.buf[self.at + self.len] = x;
        self.at = if self.at + 1 == self.len {
            0
        } else {
            self.at + 1
        };
    }

    /// Oldest first.
    fn window(&self) -> &[f32] {
        &self.buf[self.at..self.at + self.len]
    }

    fn reset(&mut self) {
        self.buf.fill(0.0);
    }
}

/// The convolution of the samples in `window` (oldest first) with
/// `kernel`, as `vector_math::Conv` sums it (or, for an FFT convolver, in
/// f64).
#[inline]
fn convolve(window: &[f32], kernel: &[f32], direct: bool) -> f32 {
    let taps = kernel.iter().rev();
    if direct {
        window
            .iter()
            .zip(taps)
            .fold(0.0f32, |sum, (x, k)| sum + k * x)
    } else {
        window
            .iter()
            .zip(taps)
            .fold(0.0f64, |sum, (x, k)| sum + *k as f64 * *x as f64) as f32
    }
}

/// Doubles the rate: each sample in, two out.
struct UpSampler {
    input: History,
    direct: bool,
}

impl UpSampler {
    fn new(direct: bool) -> Self {
        Self {
            input: History::new(UP_TAPS),
            direct,
        }
    }

    /// The input, delayed by half the filter, then the sample after it.
    fn process(&mut self, kernel: &[f32; UP_TAPS], x: f32) -> [f32; 2] {
        self.input.push(x);
        let w = self.input.window();
        [w[UP_TAPS / 2 - 1], convolve(w, kernel, self.direct)]
    }
}

/// Halves the rate: two samples in, one out.
struct DownSampler {
    /// The odd samples in, each a pair late.
    odd: History,
    /// The even samples in, for the filter's middle tap.
    even: History,
    last_odd: f32,
    direct: bool,
}

impl DownSampler {
    fn new(direct: bool) -> Self {
        Self {
            odd: History::new(DOWN_TAPS),
            even: History::new(DOWN_TAPS / 2 + 1),
            last_odd: 0.0,
            direct,
        }
    }

    fn process(&mut self, kernel: &[f32; DOWN_TAPS], [even, odd]: [f32; 2]) -> f32 {
        self.odd.push(self.last_odd);
        self.last_odd = odd;
        self.even.push(even);
        convolve(self.odd.window(), kernel, self.direct) + 0.5 * self.even.window()[0]
    }

    fn reset(&mut self) {
        self.odd.reset();
        self.even.reset();
        self.last_odd = 0.0;
    }
}

/// One channel of a WaveShaperNode.
pub struct WaveShaper {
    up_kernel: [f32; UP_TAPS],
    down_kernel: [f32; DOWN_TAPS],
    up: UpSampler,
    down: DownSampler,
    /// The second stage, at 4x.
    up2: UpSampler,
    down2: DownSampler,
    oversample: Oversample,
}

impl WaveShaper {
    pub fn new(oversample: Oversample) -> Self {
        Self {
            up_kernel: up_kernel(),
            down_kernel: down_kernel(),
            up: UpSampler::new(true),
            down: DownSampler::new(true),
            up2: UpSampler::new(false),
            down2: DownSampler::new(false),
            oversample,
        }
    }

    /// The node's `oversample` set (`SetOversample`): it clears the
    /// filters it then doesn't use, so they start afresh when next used.
    pub fn set_oversample(&mut self, oversample: Oversample) {
        self.oversample = oversample;
        if oversample == Oversample::None {
            self.up.input.reset();
            self.down.reset();
        }
        if oversample != Oversample::X4 {
            self.up2.input.reset();
            self.down2.reset();
        }
    }

    /// One sample through `curve`.
    #[inline]
    pub fn process(&mut self, curve: &[f32], x: f32) -> f32 {
        let (up_k, down_k) = (&self.up_kernel, &self.down_kernel);
        match self.oversample {
            Oversample::None => shape(curve, x),
            Oversample::X2 => {
                let up = self.up.process(up_k, x).map(|x| shape(curve, x));
                self.down.process(down_k, up)
            }
            Oversample::X4 => {
                let mut mid = [0.0; 2];
                for (m, y) in mid.iter_mut().zip(self.up.process(up_k, x)) {
                    let up = self.up2.process(up_k, y).map(|x| shape(curve, x));
                    *m = self.down2.process(down_k, up);
                }
                self.down.process(down_k, mid)
            }
        }
    }
}
