//! The browser's BiquadFilterNode, as Chromium runs it, for the effects the
//! studio builds from Web Audio nodes (the Filter, the EQ Three).
//!
//! A port of Blink's `Biquad` (`platform/audio/biquad.cc`) and the
//! coefficient update in `BiquadFilterHandler`: the coefficients in f64
//! from the float32 parameter values, with the frequency normalised to
//! Nyquist and offset by the detune; each output rounded to float32, which
//! is what the filter feeds back; the state flushed of float32 denormals
//! after each block.

use std::f64::consts::{LN_10, PI};

/// The node's `type`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BiquadType {
    Lowpass,
    Highpass,
    Bandpass,
    Lowshelf,
    Highshelf,
    Peaking,
    Notch,
}

/// Normalised coefficients (a0 = 1).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Coefs {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
}

/// 10^x, as Blink's `pow10` works it out (through a float32 `exp`).
fn pow10(x: f64) -> f64 {
    ((x * LN_10) as f32).exp() as f64
}

fn normalized(b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64) -> Coefs {
    let a0_inverse = 1.0 / a0;
    Coefs {
        b0: b0 * a0_inverse,
        b1: b1 * a0_inverse,
        b2: b2 * a0_inverse,
        a1: a1 * a0_inverse,
        a2: a2 * a0_inverse,
    }
}

const PASS: Coefs = Coefs {
    b0: 1.0,
    b1: 0.0,
    b2: 0.0,
    a1: 0.0,
    a2: 0.0,
};
const SILENT: Coefs = Coefs {
    b0: 0.0,
    b1: 0.0,
    b2: 0.0,
    a1: 0.0,
    a2: 0.0,
};

fn gain_only(g: f64) -> Coefs {
    Coefs { b0: g, ..SILENT }
}

impl Coefs {
    /// The coefficients for a node of `kind` with these parameter values
    /// (`frequency` in Hz, `q` in dB for the low and high pass, `gain` in
    /// dB, `detune` in cents), as AudioParams hold them: float32, the
    /// frequency within 0 to Nyquist.
    pub fn new(
        kind: BiquadType,
        frequency: f32,
        q: f32,
        gain: f32,
        detune: f32,
        sample_rate: f64,
    ) -> Self {
        let nyquist = 0.5 * sample_rate;
        let frequency = frequency.clamp(0.0, nyquist as f32);
        let mut f = frequency as f64 / nyquist;
        if detune != 0.0 {
            f *= (detune / 1200.0).exp2() as f64;
        }
        let q = q as f64;
        let gain = gain as f64;
        match kind {
            BiquadType::Lowpass | BiquadType::Highpass => {
                let low = kind == BiquadType::Lowpass;
                let cutoff = f.clamp(0.0, 1.0);
                if cutoff == 1.0 {
                    return if low { PASS } else { SILENT };
                }
                if cutoff <= 0.0 {
                    return if low { SILENT } else { PASS };
                }
                let resonance = pow10(q / 20.0);
                let theta = PI * cutoff;
                let alpha = theta.sin() / (2.0 * resonance);
                let cosw = theta.cos();
                let (beta, b1) = if low {
                    let beta = (1.0 - cosw) / 2.0;
                    (beta, 2.0 * beta)
                } else {
                    let beta = (1.0 + cosw) / 2.0;
                    (beta, -2.0 * beta)
                };
                normalized(beta, b1, beta, 1.0 + alpha, -2.0 * cosw, 1.0 - alpha)
            }
            BiquadType::Bandpass => {
                let f = f.max(0.0);
                let q = q.max(0.0);
                if !(f > 0.0 && f < 1.0) {
                    return SILENT;
                }
                if q <= 0.0 {
                    return PASS;
                }
                let w0 = PI * f;
                let alpha = w0.sin() / (2.0 * q);
                let k = w0.cos();
                normalized(alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * k, 1.0 - alpha)
            }
            BiquadType::Notch | BiquadType::Peaking => {
                let f = f.clamp(0.0, 1.0);
                let q = q.max(0.0);
                let a = pow10(gain / 40.0);
                if !(f > 0.0 && f < 1.0) {
                    return PASS;
                }
                if q <= 0.0 {
                    return if kind == BiquadType::Notch {
                        SILENT
                    } else {
                        gain_only(a * a)
                    };
                }
                let w0 = PI * f;
                let alpha = w0.sin() / (2.0 * q);
                let k = w0.cos();
                if kind == BiquadType::Notch {
                    normalized(1.0, -2.0 * k, 1.0, 1.0 + alpha, -2.0 * k, 1.0 - alpha)
                } else {
                    normalized(
                        1.0 + alpha * a,
                        -2.0 * k,
                        1.0 - alpha * a,
                        1.0 + alpha / a,
                        -2.0 * k,
                        1.0 - alpha / a,
                    )
                }
            }
            BiquadType::Lowshelf | BiquadType::Highshelf => {
                let low = kind == BiquadType::Lowshelf;
                let f = f.clamp(0.0, 1.0);
                let a = pow10(gain / 40.0);
                // At Nyquist a low shelf is all gain, a high shelf none;
                // at 0 the other way round.
                if f == 1.0 {
                    return if low { gain_only(a * a) } else { PASS };
                }
                if f <= 0.0 {
                    return if low { PASS } else { gain_only(a * a) };
                }
                let w0 = PI * f;
                let s = 1.0; // the shelf slope (1 is the most)
                let alpha = 0.5 * w0.sin() * ((a + 1.0 / a) * (1.0 / s - 1.0) + 2.0).sqrt();
                let k = w0.cos();
                let k2 = 2.0 * a.sqrt() * alpha;
                let a_plus_one = a + 1.0;
                let a_minus_one = a - 1.0;
                if low {
                    normalized(
                        a * (a_plus_one - a_minus_one * k + k2),
                        2.0 * a * (a_minus_one - a_plus_one * k),
                        a * (a_plus_one - a_minus_one * k - k2),
                        a_plus_one + a_minus_one * k + k2,
                        -2.0 * (a_minus_one + a_plus_one * k),
                        a_plus_one + a_minus_one * k - k2,
                    )
                } else {
                    normalized(
                        a * (a_plus_one + a_minus_one * k + k2),
                        -2.0 * a * (a_minus_one + a_plus_one * k),
                        a * (a_plus_one + a_minus_one * k - k2),
                        a_plus_one - a_minus_one * k + k2,
                        2.0 * (a_minus_one - a_plus_one * k),
                        a_plus_one - a_minus_one * k - k2,
                    )
                }
            }
        }
    }
}

/// One channel's filter memory.
#[derive(Clone, Copy, Debug, Default)]
pub struct BiquadState {
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

/// Zero for what would be a float32 denormal (`FlushDenormalFloatToZero`).
fn flush(x: f64) -> f64 {
    if x.abs() < f32::MIN_POSITIVE as f64 {
        0.0
    } else {
        x
    }
}

impl BiquadState {
    /// One sample through the filter.
    #[inline]
    pub fn tick(&mut self, c: &Coefs, x: f32) -> f32 {
        let x = x as f64;
        let y =
            (c.b0 * x + c.b1 * self.x1 + c.b2 * self.x2 - c.a1 * self.y1 - c.a2 * self.y2) as f32;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y as f64;
        y
    }

    /// A block through the filter, in place, with the same coefficients.
    pub fn process(&mut self, c: &Coefs, buf: &mut [f32]) {
        for x in buf {
            *x = self.tick(c, *x);
        }
        self.end_block();
    }

    /// What the node does at the end of each block.
    pub fn end_block(&mut self) {
        self.x1 = flush(self.x1);
        self.x2 = flush(self.x2);
        self.y1 = flush(self.y1);
        self.y2 = flush(self.y2);
    }
}
