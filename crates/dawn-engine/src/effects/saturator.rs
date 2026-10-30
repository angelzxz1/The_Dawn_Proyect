//! The Saturator (the `distortion` type).
//!
//! Port of the studio's node (`src/effects/saturator/saturator.ts`, with
//! the curves and color EQ in `saturatorModel.ts`), as Chromium runs it:
//!
//!   in -> color pre (shelf, bell) -> 1/4 -> shaper (Drive, Bias, curve;
//!   2x/4x oversampling) -> DC blocker -> color post -> Tone low pass ->
//!   Output -> Soft Clip -> wet
//!   in -> delayed to match the oversampling -> dry
//!
//! The filters are BiquadFilterNodes (`biquad_node.rs`), the shaper and
//! the Soft Clip WaveShaperNodes (`wave_shaper.rs`), the dry delay a
//! DelayNode (`delay_node.rs`). `tests/saturator_parity.rs` holds the port
//! to what Chromium renders.
//!
//! Its latency is the oversampling's, as the studio measures it in
//! Chromium (`nativeLatency.ts`): 128 frames at 2x, 192 at 4x.

use std::f64::consts::{FRAC_1_SQRT_2, FRAC_PI_2, PI};
use std::sync::{Arc, OnceLock};

use super::biquad_node::{BiquadState, BiquadType, Coefs};
use super::delay_node::{DelayLine, QUANTUM};
use super::wave_shaper::{Oversample, WaveShaper, shape};
use crate::instruments::js_round;
use crate::params::ParamSource;

/// The curves' points.
const CURVE_POINTS: usize = 16385;

/// Inputs up to this (+12 dB) map through the curve: the shaper's input is
/// turned down by it, and its curve spans it.
const CURVE_HEADROOM: f64 = 4.0;

/// The color EQ's shelf corner.
const SHELF_HZ: f32 = 250.0;

/// The DC blocker's corner.
const DC_HZ: f32 = 10.0;

/// The longest dry delay (its Tone.Delay's `maxDelay`).
const MAX_DRY_DELAY: f64 = 0.1;

/// The curves, in the `shape` parameter's order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Curve {
    AnalogClip,
    DigitalClip,
    SinoidFold,
    SoftSine,
    Medium,
    Hard,
}

const CURVES: [Curve; 6] = [
    Curve::AnalogClip,
    Curve::DigitalClip,
    Curve::SinoidFold,
    Curve::SoftSine,
    Curve::Medium,
    Curve::Hard,
];

/// JavaScript's `Math.sign`.
fn sign(v: f64) -> f64 {
    if v > 0.0 {
        1.0
    } else if v < 0.0 {
        -1.0
    } else {
        v
    }
}

impl Curve {
    fn at(self, v: f64) -> f64 {
        match self {
            Self::AnalogClip => v.tanh(),
            Self::DigitalClip => v.clamp(-1.0, 1.0),
            Self::SoftSine => {
                if v.abs() < FRAC_PI_2 {
                    v.sin()
                } else {
                    sign(v)
                }
            }
            Self::Medium => v / (1.0 + v * v).sqrt(),
            Self::Hard => v / (1.0 + v.abs().powf(6.0)).powf(1.0 / 6.0),
            Self::SinoidFold => (FRAC_PI_2 * v).sin(),
        }
    }
}

/// A WaveShaper curve: -1 to 1 spans an input of -4 to 4.
fn make_curve(f: impl Fn(f64) -> f64) -> Arc<[f32]> {
    (0..CURVE_POINTS)
        .map(|i| {
            let u = (i as f64 / (CURVE_POINTS - 1) as f64) * 2.0 - 1.0;
            f(u * CURVE_HEADROOM) as f32
        })
        .collect()
}

/// The shaper's curve (`distortionCurve`): Drive, then Bias, then the
/// curve, less what it makes of the Bias alone.
fn distortion_curve(curve: Curve, drive: f64, bias: f64) -> Arc<[f32]> {
    let gain = 1.0 + 30.0 * drive;
    make_curve(|x| curve.at(gain * x + bias) - curve.at(bias))
}

/// The Soft Clip's: straight to -6 dB, then bending toward 0 dB.
fn soft_clip_curve() -> &'static [f32] {
    static CURVE: OnceLock<Arc<[f32]>> = OnceLock::new();
    CURVE.get_or_init(|| {
        make_curve(|x| {
            let a = x.abs();
            if a <= 0.5 {
                x
            } else {
                sign(x) * (0.5 + 0.5 * ((a - 0.5) / 0.5).tanh())
            }
        })
    })
}

/// The shaper's curve, made with the settings (off the audio thread).
#[derive(Clone)]
struct ShaperCurve(Arc<[f32]>);

impl std::fmt::Debug for ShaperCurve {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ShaperCurve({} points)", self.0.len())
    }
}

impl PartialEq for ShaperCurve {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0) || self.0 == other.0
    }
}

/// Where the color EQ goes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ColorMode {
    Pre,
    Post,
    /// Boosts before and cuts the same after.
    Emphasis,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SaturatorSettings {
    /// 0 to 1: an input gain of 1 to 31.
    pub drive: f64,
    pub bias: f64,
    pub curve: Curve,
    /// The low pass's corner, in Hz.
    pub tone: f64,
    /// In dB.
    pub output: f64,
    pub wet: f64,
    pub oversample: Oversample,
    pub soft_clip: bool,
    pub color: bool,
    pub color_mode: ColorMode,
    /// The shelf's gain and the bell's, in dB.
    pub color_base: f64,
    pub color_depth: f64,
    pub color_frequency: f64,
    pub color_q: f64,
    shaper_curve: ShaperCurve,
}

/// An index parameter, rounded and kept to `0..len`.
fn index<P: ParamSource + ?Sized>(p: &P, key: &str, default: f64, len: usize) -> usize {
    js_round(p.param_or(key, default)).clamp(0.0, (len - 1) as f64) as usize
}

impl SaturatorSettings {
    /// The settings for the effect's parameters (its `index.ts`).
    pub fn from_params<P: ParamSource + ?Sized>(p: &P) -> Self {
        let drive = p.param_or("distortion", 0.3);
        let bias = p.param_or("bias", 0.0);
        let curve = CURVES[index(p, "shape", 0.0, CURVES.len())];
        Self {
            drive,
            bias,
            curve,
            tone: p.param_or("tone", 8000.0),
            output: p.param_or("output", 0.0),
            wet: p.param_or("wet", 1.0),
            oversample: [Oversample::None, Oversample::X2, Oversample::X4]
                [index(p, "oversample", 1.0, 3)],
            soft_clip: p.param_or("softClip", 0.0) >= 0.5,
            color: p.param_or("colorOn", 0.0) >= 0.5,
            color_mode: [ColorMode::Pre, ColorMode::Post, ColorMode::Emphasis]
                [index(p, "colorMode", 0.0, 3)],
            color_base: p.param_or("colorBase", 0.0),
            color_depth: p.param_or("colorDepth", 0.0),
            color_frequency: p.param_or("colorFreq", 1000.0),
            color_q: p.param_or("colorQ", 0.7),
            shaper_curve: ShaperCurve(distortion_curve(curve, drive, bias)),
        }
    }

    /// The frames the oversampling delays the shaped signal by.
    pub fn latency(&self) -> usize {
        match self.oversample {
            Oversample::None => 0,
            Oversample::X2 => 128,
            Oversample::X4 => 192,
        }
    }

    /// The color EQ's gains (dB) before and after the shaper, each the
    /// shelf's and the bell's (`colorGains`).
    fn color_gains(&self) -> ([f64; 2], [f64; 2]) {
        let on = if self.color {
            [self.color_base, self.color_depth]
        } else {
            [0.0, 0.0]
        };
        match self.color_mode {
            ColorMode::Pre => (on, [0.0, 0.0]),
            ColorMode::Post => ([0.0, 0.0], on),
            ColorMode::Emphasis => (on, on.map(|g| -g)),
        }
    }
}

/// A gain in dB as a Gain node holds it (Tone's `dbToGain`).
fn gain(db: f64) -> f32 {
    10f64.powf(db / 20.0) as f32
}

/// The filters, in order.
const PRE_BASE: usize = 0;
const PRE_BELL: usize = 1;
const DC_BLOCK: usize = 2;
const POST_BASE: usize = 3;
const POST_BELL: usize = 4;
const TONE: usize = 5;

/// One channel's nodes.
struct Channel {
    filters: [BiquadState; 6],
    shaper: WaveShaper,
    dry: DelayLine,
}

pub struct SaturatorKernel {
    sample_rate: f64,
    /// A copy of the settings' curve.
    curve: Box<[f32]>,
    /// What it was made from.
    curve_key: Option<(Curve, u64, u64)>,
    coefs: [Coefs; 6],
    channels: [Channel; 2],
    at: usize,
    output: f32,
    soft_clip: bool,
    dry_time: f32,
    dry: f32,
    wet: f32,
}

impl SaturatorKernel {
    pub fn new(sample_rate: f64, s: &SaturatorSettings) -> Self {
        let channel = || Channel {
            filters: [BiquadState::default(); 6],
            shaper: WaveShaper::new(s.oversample),
            dry: DelayLine::new(MAX_DRY_DELAY, sample_rate),
        };
        let mut k = Self {
            sample_rate,
            curve: vec![0.0; CURVE_POINTS].into_boxed_slice(),
            curve_key: None,
            coefs: [Coefs::default(); 6],
            channels: [channel(), channel()],
            at: 0,
            output: 1.0,
            soft_clip: false,
            dry_time: 0.0,
            dry: 0.0,
            wet: 0.0,
        };
        k.set(s);
        k
    }

    /// Takes new settings: on the audio thread this only copies.
    pub fn set(&mut self, s: &SaturatorSettings) {
        let key = Some((s.curve, s.drive.to_bits(), s.bias.to_bits()));
        if key != self.curve_key {
            self.curve.copy_from_slice(&s.shaper_curve.0);
            self.curve_key = key;
        }
        let ([pre_base, pre_bell], [post_base, post_bell]) = s.color_gains();
        let sr = self.sample_rate;
        let filter = |kind, frequency: f32, q: f64, gain: f64| {
            Coefs::new(kind, frequency, q as f32, gain as f32, 0.0, sr)
        };
        let bell = |gain| {
            filter(
                BiquadType::Peaking,
                s.color_frequency as f32,
                s.color_q,
                gain,
            )
        };
        // A Tone.Filter's Q is 1 unless it's set.
        self.coefs[PRE_BASE] = filter(BiquadType::Lowshelf, SHELF_HZ, 1.0, pre_base);
        self.coefs[PRE_BELL] = bell(pre_bell);
        self.coefs[DC_BLOCK] = filter(BiquadType::Highpass, DC_HZ, FRAC_1_SQRT_2, 0.0);
        self.coefs[POST_BASE] = filter(BiquadType::Lowshelf, SHELF_HZ, 1.0, post_base);
        self.coefs[POST_BELL] = bell(post_bell);
        self.coefs[TONE] = filter(BiquadType::Lowpass, s.tone as f32, FRAC_1_SQRT_2, 0.0);
        for ch in &mut self.channels {
            ch.shaper.set_oversample(s.oversample);
        }
        self.dry_time = self.channels[0].dry.clamp((s.latency() as f64 / sr) as f32);
        self.output = gain(s.output);
        self.soft_clip = s.soft_clip;
        let angle = s.wet * PI / 2.0;
        self.dry = angle.cos() as f32;
        self.wet = angle.sin() as f32;
    }

    pub fn process_in_place(&mut self, l: &mut [f32], r: &mut [f32]) {
        let headroom = (1.0 / CURVE_HEADROOM) as f32;
        let c = &self.coefs;
        let clip_curve = soft_clip_curve();
        for (x_l, x_r) in l.iter_mut().zip(r.iter_mut()) {
            for (x, ch) in [x_l, x_r].into_iter().zip(&mut self.channels) {
                let f = &mut ch.filters;
                let mut y = f[PRE_BASE].tick(&c[PRE_BASE], *x);
                y = f[PRE_BELL].tick(&c[PRE_BELL], y);
                y = ch.shaper.process(&self.curve, y * headroom);
                for i in [DC_BLOCK, POST_BASE, POST_BELL, TONE] {
                    y = f[i].tick(&c[i], y);
                }
                y *= self.output;
                if self.soft_clip {
                    y = shape(clip_curve, y * headroom);
                }
                let dry = ch.dry.tick(*x, self.dry_time);
                *x = dry * self.dry + y * self.wet;
            }
            self.at += 1;
            if self.at == QUANTUM {
                self.at = 0;
                for ch in &mut self.channels {
                    for st in ch.filters.iter_mut() {
                        st.end_block();
                    }
                }
            }
        }
    }
}
