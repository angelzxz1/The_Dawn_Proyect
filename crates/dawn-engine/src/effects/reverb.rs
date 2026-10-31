//! The Reverb.
//!
//! Port of the studio's node (`src/effects/reverb/reverbChain.ts`), as
//! Chromium runs it:
//!
//!   in -> low cut -> high cut -> pre-delay -> convolver -> wet
//!   in -> dry
//!
//! The cuts are BiquadFilterNodes (`biquad_node.rs`), the pre-delay a
//! DelayNode (`delay_node.rs`), the convolver a ConvolverNode
//! (`convolver.rs`), with the impulse response the studio renders from the
//! knobs (`renderImpulse` in `reverbModel.ts`, ported here step for step).
//! A knob that reshapes the impulse (Decay, Damping, Early, Width, Mode)
//! makes a new one, off the audio thread, which takes all new input while
//! the old one rings out. `tests/reverb_parity.rs` holds the port to what
//! Chromium renders. No latency.

use std::f64::consts::{FRAC_1_SQRT_2, PI};
use std::sync::Arc;

use super::biquad_node::{BiquadState, BiquadType, Coefs};
use super::convolver::{Convolution, Impulse, ImpulseSlot};
use super::delay_node::{DelayLine, QUANTUM};
use crate::instruments::js_round;
use crate::params::ParamSource;

/// The cuts' resonance (Q, in dB as the node reads it).
const CUT_Q: f32 = 0.7;

/// The longest pre-delay (its Tone.Delay's `maxDelay`).
const MAX_PRE_DELAY: f64 = 0.3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReverbMode {
    Hall,
    Room,
    Plate,
}

const MODES: [ReverbMode; 3] = [ReverbMode::Hall, ReverbMode::Room, ReverbMode::Plate];

/// Where a mode's reflections and tail fall (seconds).
struct ModeShape {
    er_start: f64,
    er_end: f64,
    er_count: usize,
    tail_onset: f64,
    tail_build: f64,
}

impl ReverbMode {
    fn index(self) -> usize {
        self as usize
    }

    fn shape(self) -> ModeShape {
        match self {
            Self::Hall => ModeShape {
                er_start: 0.008,
                er_end: 0.085,
                er_count: 14,
                tail_onset: 0.02,
                tail_build: 0.07,
            },
            Self::Room => ModeShape {
                er_start: 0.002,
                er_end: 0.035,
                er_count: 18,
                tail_onset: 0.006,
                tail_build: 0.018,
            },
            Self::Plate => ModeShape {
                er_start: 0.0005,
                er_end: 0.006,
                er_count: 6,
                tail_onset: 0.0,
                tail_build: 0.004,
            },
        }
    }
}

/// What the impulse is made from.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ImpulseShape {
    pub decay: f64,
    pub damping: f64,
    pub early: f64,
    pub width: f64,
    pub mode: ReverbMode,
}

/// The studio's small PRNG (`prng`), so a setting always makes the same
/// impulse.
fn prng(seed: u32) -> impl FnMut() -> f64 {
    let mut a = seed;
    move || {
        a = a.wrapping_add(0x6d2b_79f5);
        let mut t = a;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4_294_967_296.0
    }
}

/// How long the highs take to fall 60 dB (`highsRt60`).
fn highs_rt60(decay: f64, damping: f64) -> f64 {
    let amount = (damping / 500.0).ln() / 40f64.ln();
    decay * amount.clamp(0.1, 1.0)
}

/// A mode's early reflections for a side (`earlyReflections`): (time,
/// gain), in time order, the loudest at ±1.
fn early_reflections(mode: ReverbMode, channel: u32) -> Vec<(f64, f64)> {
    let shape = mode.shape();
    let mut rand = prng(1013 + channel * 7919 + mode.index() as u32 * 104_729);
    let mut taps: Vec<(f64, f64)> = (0..shape.er_count)
        .map(|_| {
            let pos = rand();
            let time = shape.er_start + pos * (shape.er_end - shape.er_start);
            let magnitude = (1.0 - 0.65 * pos) * (0.55 + 0.45 * rand());
            (time, if rand() < 0.5 { -magnitude } else { magnitude })
        })
        .collect();
    taps.sort_by(|a, b| a.0.total_cmp(&b.0));
    let peak = taps
        .iter()
        .map(|t| t.1.abs())
        .fold(f64::NEG_INFINITY, f64::max);
    taps.iter()
        .map(|&(time, gain)| (time, gain / peak))
        .collect()
}

/// The tail's fade in at `t` seconds (`tailBuildUp`).
fn tail_build_up(shape: &ModeShape, t: f64) -> f64 {
    if t < shape.tail_onset {
        return 0.0;
    }
    if shape.tail_build <= 0.0 {
        return 1.0;
    }
    ((t - shape.tail_onset) / shape.tail_build).min(1.0)
}

/// An RBJ Butterworth section (`biquad` in reverbModel.ts), in f64.
struct Section {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}

impl Section {
    fn new(low: bool, frequency: f64, sample_rate: f64) -> Self {
        let w0 = 2.0 * PI * frequency / sample_rate;
        let cos = w0.cos();
        let alpha = w0.sin() / (2.0 * FRAC_1_SQRT_2);
        let a0 = 1.0 + alpha;
        let b1 = (if low { 1.0 - cos } else { -(1.0 + cos) }) / a0;
        let b0 = (if low {
            (1.0 - cos) / 2.0
        } else {
            (1.0 + cos) / 2.0
        }) / a0;
        Self {
            b0,
            b1,
            b2: b0,
            a1: (-2.0 * cos) / a0,
            a2: (1.0 - alpha) / a0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    fn tick(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}

/// The stereo impulse response (`renderImpulse`): noise split at the
/// damping frequency into a low band decaying over Decay and a high band
/// decaying faster, the early reflections on top, each side at unit
/// energy, the right blended toward the left by Width.
pub fn render_impulse(sample_rate: f64, p: &ImpulseShape) -> [Vec<f32>; 2] {
    let shape = p.mode.shape();
    let highs = highs_rt60(p.decay, p.damping);
    let length = (((shape.tail_onset + shape.tail_build + p.decay * 1.2) * sample_rate).ceil()
        as usize)
        .max(1);
    let crossover = p.damping.min(sample_rate * 0.45);
    let ln_1000 = 1000f64.ln();
    let low_rate = ln_1000 / p.decay;
    let high_rate = ln_1000 / highs;

    let render_side = |channel: u32| -> Vec<f32> {
        let mut out = vec![0.0f32; length];
        let mut rand = prng(48271 + channel * 16807);
        let mut low_a = Section::new(true, crossover, sample_rate);
        let mut low_b = Section::new(true, crossover, sample_rate);
        let mut high_a = Section::new(false, crossover, sample_rate);
        let mut high_b = Section::new(false, crossover, sample_rate);
        let mut tail_energy = 0.0;
        let (mut low_env, mut high_env) = (1.0f64, 1.0f64);
        let low_step = (-low_rate / sample_rate).exp();
        let high_step = (-high_rate / sample_rate).exp();
        for (i, o) in out.iter_mut().enumerate() {
            let noise = rand() * 2.0 - 1.0;
            let low = low_b.tick(low_a.tick(noise));
            let high = high_b.tick(high_a.tick(noise));
            let v =
                tail_build_up(&shape, i as f64 / sample_rate) * (low * low_env + high * high_env);
            low_env *= low_step;
            high_env *= high_step;
            *o = v as f32;
            tail_energy += v * v;
        }
        let tail_scale = if tail_energy > 0.0 {
            1.0 / tail_energy.sqrt()
        } else {
            0.0
        };
        for o in out.iter_mut() {
            *o = (*o as f64 * tail_scale) as f32;
        }
        let taps = early_reflections(p.mode, channel);
        let tap_energy: f64 = taps.iter().map(|t| t.1 * t.1).sum();
        let tap_scale = (p.early * 0.9) / tap_energy.sqrt();
        for &(time, gain) in &taps {
            let i = (js_round(time * sample_rate) as usize).min(length - 1);
            out[i] = (out[i] as f64 + gain * tap_scale) as f32;
        }
        out
    };

    let mut left = render_side(0);
    let independent = render_side(1);
    let w = p.width.clamp(0.0, 1.0);
    let norm = 1.0 / ((1.0 - w) * (1.0 - w) + w * w).sqrt();
    let mut right: Vec<f32> = left
        .iter()
        .zip(&independent)
        .map(|(&l, &i)| (((1.0 - w) * l as f64 + w * i as f64) * norm) as f32)
        .collect();
    for ch in [&mut left, &mut right] {
        let e: f64 = ch.iter().map(|&v| v as f64 * v as f64).sum();
        let s = if e > 0.0 { 1.0 / e.sqrt() } else { 0.0 };
        for v in ch.iter_mut() {
            *v = (*v as f64 * s) as f32;
        }
    }
    [left, right]
}

/// The impulse made for the settings, at a rate.
#[derive(Clone, Debug)]
struct Prepared {
    shape: ImpulseShape,
    sample_rate: f64,
    slot: Arc<ImpulseSlot>,
}

#[derive(Clone, Debug)]
pub struct ReverbSettings {
    /// In seconds.
    pub pre_delay: f64,
    /// The cuts' corners, in Hz.
    pub low_cut: f64,
    pub high_cut: f64,
    pub wet: f64,
    pub shape: ImpulseShape,
    impulse: Option<Prepared>,
}

impl PartialEq for ReverbSettings {
    /// The settings, not what's been made from them.
    fn eq(&self, other: &Self) -> bool {
        self.pre_delay == other.pre_delay
            && self.low_cut == other.low_cut
            && self.high_cut == other.high_cut
            && self.wet == other.wet
            && self.shape == other.shape
    }
}

impl ReverbSettings {
    /// The settings for the effect's parameters (its `index.ts`).
    pub fn from_params<P: ParamSource + ?Sized>(p: &P) -> Self {
        let mode = js_round(p.param_or("mode", 0.0)).clamp(0.0, 2.0) as usize;
        Self {
            pre_delay: p.param_or("preDelay", 0.0),
            low_cut: p.param_or("lowCut", 650.0),
            high_cut: p.param_or("highCut", 5000.0),
            wet: p.param_or("wet", 0.25),
            shape: ImpulseShape {
                decay: p.param_or("decay", 1.2),
                damping: p.param_or("damping", 4700.0),
                early: p.param_or("early", 0.8),
                width: p.param_or("width", 1.0),
                mode: MODES[mode],
            },
            impulse: None,
        }
    }

    /// Makes the impulse at `sample_rate` (off the audio thread: it takes
    /// a while), unless it's made already, or `previous` (this effect's
    /// settings in the song playing) has it.
    pub fn prepare(&mut self, sample_rate: f64, previous: Option<&Self>) {
        let made = |p: &Prepared| p.shape == self.shape && p.sample_rate == sample_rate;
        if self.impulse.as_ref().is_some_and(made) {
            return;
        }
        if let Some(p) = previous
            .and_then(|p| p.impulse.as_ref())
            .filter(|p| made(p))
        {
            self.impulse = Some(p.clone());
            return;
        }
        let [l, r] = render_impulse(sample_rate, &self.shape);
        self.impulse = Some(Prepared {
            shape: self.shape,
            sample_rate,
            slot: ImpulseSlot::new(Some(Impulse::new(&[&l, &r]))),
        });
    }

    fn slot(&self, sample_rate: f64) -> Option<&ImpulseSlot> {
        self.impulse
            .as_ref()
            .filter(|p| p.sample_rate == sample_rate)
            .map(|p| &*p.slot)
    }
}

pub struct ReverbKernel {
    sample_rate: f64,
    low: Coefs,
    high: Coefs,
    /// Per side: the low cut's, then the high cut's.
    cuts: [[BiquadState; 2]; 2],
    pre_delay: [DelayLine; 2],
    delay_time: f32,
    convolution: Convolution,
    at: usize,
    dry: f32,
    wet: f32,
}

impl ReverbKernel {
    /// Off the audio thread (it makes the impulse if `prepare` hasn't).
    pub fn new(sample_rate: f64, s: &ReverbSettings) -> Self {
        let mut prepared = s.clone();
        prepared.prepare(sample_rate, None);
        let convolution = match prepared.slot(sample_rate) {
            Some(slot) => Convolution::new(slot),
            None => Convolution::new(&ImpulseSlot::new(None)),
        };
        let mut k = Self {
            sample_rate,
            low: Coefs::default(),
            high: Coefs::default(),
            cuts: [[BiquadState::default(); 2]; 2],
            pre_delay: [
                DelayLine::new(MAX_PRE_DELAY, sample_rate),
                DelayLine::new(MAX_PRE_DELAY, sample_rate),
            ],
            delay_time: 0.0,
            convolution,
            at: 0,
            dry: 0.0,
            wet: 0.0,
        };
        k.set(s);
        k
    }

    /// Takes new settings: on the audio thread this only copies (a new
    /// impulse comes made, with the settings).
    pub fn set(&mut self, s: &ReverbSettings) {
        let sr = self.sample_rate;
        let cut = |kind, frequency: f64| Coefs::new(kind, frequency as f32, CUT_Q, 0.0, 0.0, sr);
        self.low = cut(BiquadType::Highpass, s.low_cut);
        self.high = cut(BiquadType::Lowpass, s.high_cut);
        self.delay_time = self.pre_delay[0].clamp(s.pre_delay as f32);
        self.dry = (1.0 - s.wet) as f32;
        self.wet = s.wet as f32;
        if let Some(slot) = s.slot(sr) {
            self.convolution.take(slot);
        }
    }

    pub fn process_in_place(&mut self, l: &mut [f32], r: &mut [f32]) {
        let n = l.len().min(r.len());
        let mut start = 0;
        while start < n {
            let m = (n - start).min(QUANTUM);
            let mut wet = [[0.0f32; QUANTUM]; 2];
            for i in 0..m {
                for (s, x) in [l[start + i], r[start + i]].into_iter().enumerate() {
                    let [low, high] = &mut self.cuts[s];
                    let y = high.tick(&self.high, low.tick(&self.low, x));
                    wet[s][i] = self.pre_delay[s].tick(y, self.delay_time);
                }
                self.at += 1;
                if self.at == QUANTUM {
                    self.at = 0;
                    for st in self.cuts.iter_mut().flatten() {
                        st.end_block();
                    }
                }
            }
            let [wet_l, wet_r] = &mut wet;
            self.convolution.process(&mut wet_l[..m], &mut wet_r[..m]);
            for i in 0..m {
                l[start + i] = l[start + i] * self.dry + wet_l[i] * self.wet;
                r[start + i] = r[start + i] * self.dry + wet_r[i] * self.wet;
            }
            start += m;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slot(s: &ReverbSettings) -> &Arc<ImpulseSlot> {
        &s.impulse.as_ref().expect("prepared").slot
    }

    #[test]
    fn a_new_version_keeps_the_impulse_unless_its_shape_changes() {
        let mut first = ReverbSettings::from_params(&[("decay", 0.5)]);
        first.prepare(48000.0, None);
        // Another knob: the same impulse.
        let mut wetter = ReverbSettings::from_params(&[("decay", 0.5), ("wet", 0.8)]);
        wetter.prepare(48000.0, Some(&first));
        assert!(Arc::ptr_eq(slot(&first), slot(&wetter)));
        // Prepared again, it stays.
        let kept = slot(&wetter).clone();
        wetter.prepare(48000.0, None);
        assert!(Arc::ptr_eq(&kept, slot(&wetter)));
        // A shape knob, or another rate: a new one.
        let mut longer = ReverbSettings::from_params(&[("decay", 0.9)]);
        longer.prepare(48000.0, Some(&first));
        assert!(!Arc::ptr_eq(slot(&first), slot(&longer)));
        let mut faster = first.clone();
        faster.prepare(44100.0, Some(&first));
        assert!(!Arc::ptr_eq(slot(&first), slot(&faster)));
    }

    #[test]
    fn the_impulse_is_as_long_as_the_studio_makes_it() {
        let s = ReverbSettings::from_params(&[]);
        let [l, r] = render_impulse(48000.0, &s.shape);
        // (0.02 + 0.07 + 1.2 * 1.2) s.
        assert_eq!(l.len(), (1.53f64 * 48000.0).ceil() as usize);
        assert_eq!(r.len(), l.len());
        // Each side at unit energy.
        for side in [&l, &r] {
            let e: f64 = side.iter().map(|&v| v as f64 * v as f64).sum();
            assert!((e - 1.0).abs() < 1e-5, "{e}");
        }
    }
}
