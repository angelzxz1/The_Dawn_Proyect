//! The Compressor's DSP.
//!
//! Port of `src/effects/compressor/compressorModel.ts` (`CompressorKernel`,
//! `compressorSettingsFromParams`, `autoMakeupDb`). The state is `f64` and
//! the buffers `f32`, as in the JavaScript (numbers and Float32Arrays), and
//! the arithmetic is written in the same order, so the two compute the same
//! samples; `tests/compressor_parity.rs` holds the port to that.
//!
//! Detection is stereo-linked on the key signal (the effect's own input, or
//! a sidechain), after the sidechain gain and filters: a peak follower that
//! falls at the Release time, smoothed by the Attack time. The gain
//! computer is a quadratic soft knee. Makeup, dry/wet and output are
//! smoothed so moving them never clicks. No lookahead, so no latency.

use std::f64::consts::LN_10;

use crate::effects::sidechain::{KeyFilter, KeySettings};
use crate::params::ParamSource;

/// Multiplying dB by this gives natural-log gain.
const COMP_DB: f64 = LN_10 / 20.0;

/// The parameters' defaults (`src/effects/compressor/index.ts`), used for
/// any the caller leaves out.
pub mod defaults {
    pub const THRESHOLD: f64 = -24.0;
    pub const RATIO: f64 = 4.0;
    /// Seconds.
    pub const ATTACK: f64 = 0.02;
    /// Seconds.
    pub const RELEASE: f64 = 0.2;
    pub const KNEE: f64 = 6.0;
    pub const MAKEUP: f64 = 0.0;
    pub const MAKEUP_AUTO: f64 = 1.0;
    pub const DRY_WET: f64 = 1.0;
    pub const OUTPUT: f64 = 0.0;
}

/// The kernel's settings: the fields of the object the web app's worklet
/// receives (`CompressorSettings` in compressorModel.ts).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CompressorSettings {
    pub key: KeySettings,
    /// dB.
    pub threshold: f64,
    pub ratio: f64,
    /// dB.
    pub knee: f64,
    /// Seconds.
    pub attack: f64,
    /// Seconds.
    pub release: f64,
    /// The makeup actually applied (auto already worked out), dB.
    pub makeup_db: f64,
    /// 0 (dry) to 1 (wet).
    pub dry_wet: f64,
    pub output_db: f64,
}

impl CompressorSettings {
    /// The settings for the effect's parameters (the keys in its
    /// `index.ts`); `external` is whether a sidechain source is connected.
    /// A parameter that isn't there takes its default.
    pub fn from_params<P: ParamSource + ?Sized>(params: &P, external: bool) -> Self {
        let threshold = params.param_or("threshold", defaults::THRESHOLD);
        let ratio = params.param_or("ratio", defaults::RATIO);
        let auto = params.param_or("makeupAuto", defaults::MAKEUP_AUTO) >= 0.5;
        Self {
            key: KeySettings::from_params(params, external),
            threshold,
            ratio,
            knee: params.param_or("knee", defaults::KNEE),
            attack: params.param_or("attack", defaults::ATTACK),
            release: params.param_or("release", defaults::RELEASE),
            makeup_db: if auto {
                auto_makeup_db(threshold, ratio)
            } else {
                params.param_or("makeup", defaults::MAKEUP)
            },
            dry_wet: params.param_or("dryWet", defaults::DRY_WET),
            output_db: params.param_or("output", defaults::OUTPUT),
        }
    }
}

impl Default for CompressorSettings {
    fn default() -> Self {
        Self::from_params(&[] as &[(&str, f64)], false)
    }
}

/// Automatic makeup gain (dB): half the gain reduction a signal well above
/// the threshold gets at this ratio, from 0 to 24 dB.
pub fn auto_makeup_db(threshold: f64, ratio: f64) -> f64 {
    let reduction = -threshold * (1.0 - 1.0 / ratio);
    (reduction / 2.0).clamp(0.0, 24.0)
}

/// Output level (dB) for a level of `x` dB: threshold `t`, ratio `r`,
/// knee width `w` (the curve the Compressor's window draws).
fn comp_transfer(x: f64, t: f64, r: f64, w: f64) -> f64 {
    let start = t - w / 2.0;
    if x <= start {
        return x;
    }
    if x >= t + w / 2.0 || w <= 0.0 {
        return t + (x - t) / r;
    }
    let d = x - start;
    x + ((1.0 / r - 1.0) * d * d) / (2.0 * w)
}

/// What the meters saw since they were last read: the input, output and
/// key peaks (linear) and the most gain reduction (dB, <= 0).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CompressorMeters {
    pub input: f64,
    pub output: f64,
    pub key: f64,
    pub gain_reduction: f64,
}

/// The Compressor, on one stereo stream.
#[derive(Clone, Debug)]
pub struct CompressorKernel {
    sr: f64,
    key: KeyFilter,
    peak: f64,
    det: f64,
    smooth: f64,
    makeup: f64,
    wet: f64,
    out: f64,
    started: bool,
    external: bool,
    listen: bool,
    // From the settings (see `set`).
    t: f64,
    r: f64,
    w: f64,
    atk: f64,
    rel: f64,
    makeup_target: f64,
    wet_target: f64,
    out_target: f64,
    meters: CompressorMeters,
}

impl CompressorKernel {
    pub fn new(sample_rate: f64, settings: &CompressorSettings) -> Self {
        let mut kernel = Self {
            sr: sample_rate,
            key: KeyFilter::new(sample_rate),
            peak: 0.0,
            det: 0.0,
            smooth: 1.0 - (-1.0 / (0.01 * sample_rate)).exp(),
            makeup: 1.0,
            wet: 1.0,
            out: 1.0,
            started: false,
            external: false,
            listen: false,
            t: 0.0,
            r: 1.0,
            w: 0.0,
            atk: 0.0,
            rel: 0.0,
            makeup_target: 1.0,
            wet_target: 1.0,
            out_target: 1.0,
            meters: CompressorMeters::default(),
        };
        kernel.set(settings);
        kernel
    }

    /// New settings. Makeup, dry/wet and output glide to theirs (except the
    /// first time, when they start there).
    pub fn set(&mut self, s: &CompressorSettings) {
        let sr = self.sr;
        self.t = s.threshold;
        self.r = s.ratio.max(1.0);
        self.w = s.knee.max(0.0);
        self.atk = (-1.0 / (s.attack.max(0.00005) * sr)).exp();
        self.rel = (-1.0 / (s.release.max(0.001) * sr)).exp();
        self.makeup_target = (s.makeup_db * COMP_DB).exp();
        self.wet_target = s.dry_wet.clamp(0.0, 1.0);
        self.out_target = (s.output_db * COMP_DB).exp();
        self.external = s.key.external;
        self.listen = s.key.listen;
        self.key.set(&s.key);
        if !self.started {
            self.makeup = self.makeup_target;
            self.wet = self.wet_target;
            self.out = self.out_target;
            self.started = true;
        }
    }

    /// Processes `out_l.len()` frames of `in_l`/`in_r` into `out_l`/`out_r`.
    /// A missing input channel is silence (left) or a copy of the left
    /// (right). `key_l`/`key_r` is the sidechain, used while the settings
    /// say `external`: missing is silence (left) or a copy of the left.
    /// Every buffer given must be at least as long as `out_l`.
    pub fn process(
        &mut self,
        in_l: Option<&[f32]>,
        in_r: Option<&[f32]>,
        key_l: Option<&[f32]>,
        key_r: Option<&[f32]>,
        out_l: &mut [f32],
        out_r: Option<&mut [f32]>,
    ) {
        let n = out_l.len();
        let in_l = in_l.map(|b| &b[..n]);
        let in_r = in_r.map(|b| &b[..n]);
        let key_l = key_l.map(|b| &b[..n]);
        let key_r = key_r.map(|b| &b[..n]);
        let mut out_r = out_r.map(|b| &mut b[..n]);
        for i in 0..n {
            let l = in_l.map_or(0.0, |b| f64::from(b[i]));
            let r = in_r.map_or(l, |b| f64::from(b[i]));
            let (kl, kr) = self.key_input(l, r, key_l, key_r, i);
            let (yl, yr) = self.tick(l, r, kl, kr);
            out_l[i] = yl as f32;
            if let Some(o) = out_r.as_mut() {
                o[i] = yr as f32;
            }
        }
    }

    /// As `process`, writing the result over its input. A missing `right`
    /// is a mono stream.
    pub fn process_in_place(
        &mut self,
        left: &mut [f32],
        right: Option<&mut [f32]>,
        key_l: Option<&[f32]>,
        key_r: Option<&[f32]>,
    ) {
        let n = left.len();
        let key_l = key_l.map(|b| &b[..n]);
        let key_r = key_r.map(|b| &b[..n]);
        let mut right = right.map(|b| &mut b[..n]);
        for i in 0..n {
            let l = f64::from(left[i]);
            let r = right.as_ref().map_or(l, |b| f64::from(b[i]));
            let (kl, kr) = self.key_input(l, r, key_l, key_r, i);
            let (yl, yr) = self.tick(l, r, kl, kr);
            left[i] = yl as f32;
            if let Some(o) = right.as_mut() {
                o[i] = yr as f32;
            }
        }
    }

    /// The meters since the last call, which resets them.
    pub fn take_meters(&mut self) -> CompressorMeters {
        std::mem::take(&mut self.meters)
    }

    /// The signal the detector hears, before the sidechain gain and filters.
    #[inline(always)]
    fn key_input(
        &self,
        l: f64,
        r: f64,
        key_l: Option<&[f32]>,
        key_r: Option<&[f32]>,
        i: usize,
    ) -> (f64, f64) {
        if self.external {
            let kl = key_l.map_or(0.0, |b| f64::from(b[i]));
            let kr = key_r.map_or(kl, |b| f64::from(b[i]));
            (kl, kr)
        } else {
            (l, r)
        }
    }

    /// One frame: input `l`/`r`, key `kl`/`kr`; returns the output.
    #[inline(always)]
    fn tick(&mut self, l: f64, r: f64, kl: f64, kr: f64) -> (f64, f64) {
        let smooth = self.smooth;
        let kl = self.key.run(kl, 0);
        let kr = self.key.run(kr, 1);
        let level = kl.abs().max(kr.abs());
        let peak = self.peak;
        self.peak = if level > peak {
            level
        } else {
            level + self.rel * (peak - level)
        };
        self.det = self.peak + self.atk * (self.det - self.peak);
        let x = if self.det > 1e-6 {
            self.det.ln() / COMP_DB
        } else {
            -120.0
        };
        let gr = comp_transfer(x, self.t, self.r, self.w) - x;
        self.makeup += (self.makeup_target - self.makeup) * smooth;
        self.wet += (self.wet_target - self.wet) * smooth;
        self.out += (self.out_target - self.out) * smooth;
        let (yl, yr) = if self.listen {
            (kl, kr)
        } else {
            let g = (gr * COMP_DB).exp() * self.makeup;
            let w = self.wet;
            (
                (l * (1.0 - w) + l * g * w) * self.out,
                (r * (1.0 - w) + r * g * w) * self.out,
            )
        };
        let m = &mut self.meters;
        let a_in = l.abs().max(r.abs());
        if a_in > m.input {
            m.input = a_in;
        }
        if level > m.key {
            m.key = level;
        }
        let a_out = yl.abs().max(yr.abs());
        if a_out > m.output {
            m.output = a_out;
        }
        if gr < m.gain_reduction {
            m.gain_reduction = gr;
        }
        (yl, yr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_params_take_the_defaults() {
        let s = CompressorSettings::default();
        assert_eq!(s.threshold, -24.0);
        assert_eq!(s.ratio, 4.0);
        assert_eq!(s.makeup_db, auto_makeup_db(-24.0, 4.0));
        assert!(!s.key.external);
    }

    #[test]
    fn auto_makeup_is_half_the_reduction_within_0_to_24_db() {
        assert_eq!(auto_makeup_db(-24.0, 4.0), 9.0);
        assert_eq!(auto_makeup_db(0.0, 4.0), 0.0);
        assert_eq!(auto_makeup_db(-60.0, 20.0), 24.0);
        assert_eq!(auto_makeup_db(-30.0, 1.0), 0.0);
    }

    #[test]
    fn manual_makeup_comes_from_the_makeup_param() {
        let s = CompressorSettings::from_params(&[("makeupAuto", 0.0), ("makeup", 5.5)], false);
        assert_eq!(s.makeup_db, 5.5);
    }

    #[test]
    fn transfer_curve() {
        // Below the knee: unchanged. Above: the ratio. In the knee's middle
        // (at the threshold): (1/R - 1) * W / 8 below it.
        assert_eq!(comp_transfer(-40.0, -20.0, 4.0, 10.0), -40.0);
        assert_eq!(comp_transfer(0.0, -20.0, 4.0, 10.0), -15.0);
        assert_eq!(
            comp_transfer(-20.0, -20.0, 4.0, 10.0),
            -20.0 + (0.25 - 1.0) * 10.0 / 8.0
        );
        assert_eq!(comp_transfer(0.0, -20.0, 4.0, 0.0), -15.0);
    }

    #[test]
    fn silence_stays_silent() {
        let mut k = CompressorKernel::new(48000.0, &CompressorSettings::default());
        let input = [0.0f32; 128];
        let (mut l, mut r) = ([1.0f32; 128], [1.0f32; 128]);
        k.process(Some(&input), Some(&input), None, None, &mut l, Some(&mut r));
        assert!(l.iter().chain(r.iter()).all(|&v| v == 0.0));
        assert_eq!(k.take_meters(), CompressorMeters::default());
    }

    #[test]
    fn a_loud_signal_settles_to_the_static_curve() {
        // A full-scale square wave (|x| = 1, 0 dBFS) for a second: the gain
        // settles at the curve's reduction plus makeup.
        let settings =
            CompressorSettings::from_params(&[("knee", 0.0), ("makeupAuto", 0.0)], false);
        let mut k = CompressorKernel::new(48000.0, &settings);
        let mut buf: Vec<f32> = (0..48000)
            .map(|i| if (i / 50) % 2 == 0 { 1.0 } else { -1.0 })
            .collect();
        k.process_in_place(&mut buf, None, None, None);
        let expected = 10f64.powf((comp_transfer(0.0, -24.0, 4.0, 0.0) - 0.0) / 20.0);
        let got = f64::from(buf[47999].abs());
        assert!(
            (got - expected).abs() < 1e-4,
            "settled at {got}, expected {expected}"
        );
        assert!((k.take_meters().gain_reduction - (-18.0)).abs() < 1e-6);
    }

    #[test]
    fn in_place_matches_separate_buffers() {
        let settings =
            CompressorSettings::from_params(&[("threshold", -30.0), ("dryWet", 0.5)], false);
        let input: Vec<f32> = (0..1024)
            .map(|i| ((i * 37 % 200) as f32 / 100.0) - 1.0)
            .collect();
        let mut a = CompressorKernel::new(48000.0, &settings);
        let mut b = a.clone();
        let mut out = vec![0.0f32; 1024];
        a.process(Some(&input), None, None, None, &mut out, None);
        let mut buf = input.clone();
        b.process_in_place(&mut buf, None, None, None);
        assert_eq!(out, buf);
    }
}
