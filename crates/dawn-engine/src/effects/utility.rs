//! The Utility's DSP.
//!
//! Port of `src/effects/utility/utilityModel.ts` (`UtilityKernel`,
//! `utilitySettingsFromParams`) step for step; `tests/utility_parity.rs`
//! holds the port to what the JavaScript renders.
//!
//! Per sample: DC filter, channel mode (stereo, left, right, swap), polarity
//! per side, width (mid/side: 0 mono, 1 as is, up to 4) with bass mono (the
//! side high-passed, so the lows are mono), gain, balance. Gain, width and
//! balance glide over ~10 ms so moving them never clicks. No latency.

use std::f64::consts::{FRAC_1_SQRT_2, PI};

use crate::instruments::js_round;
use crate::params::ParamSource;

/// Gain at or below this is silence.
pub const GAIN_FLOOR: f64 = -60.0;

/// The kernel's settings (`UtilitySettings` in utilityModel.ts).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct UtilitySettings {
    pub gain_db: f64,
    /// 0 to 4 (0% to 400%).
    pub width: f64,
    pub mono: bool,
    pub bass_mono: bool,
    pub bass_freq: f64,
    pub invert_l: bool,
    pub invert_r: bool,
    /// Stereo, left, right, swap.
    pub channel: f64,
    /// -1 (left) to 1 (right).
    pub balance: f64,
    pub dc_filter: bool,
    pub mute: bool,
}

impl UtilitySettings {
    /// The settings for the effect's parameters (`utilitySettingsFromParams`).
    pub fn from_params<P: ParamSource + ?Sized>(p: &P) -> Self {
        let on = |key: &str| p.param_or(key, 0.0) >= 0.5;
        Self {
            gain_db: p.param_or("gain", 0.0),
            width: p.param_or("width", 1.0),
            mono: on("mono"),
            bass_mono: on("bassMono"),
            bass_freq: p.param_or("bassFreq", 120.0),
            invert_l: on("invertL"),
            invert_r: on("invertR"),
            channel: js_round(p.param_or("channel", 0.0)),
            balance: p.param_or("balance", 0.0),
            dc_filter: on("dcFilter"),
            mute: on("mute"),
        }
    }
}

impl Default for UtilitySettings {
    fn default() -> Self {
        Self::from_params(&[] as &[(&str, f64)])
    }
}

/// Bass mono's filters at one frequency, each [b0, b1, b2, a1, a2]: a
/// Butterworth high pass (run twice on the side: Linkwitz-Riley) and the
/// matching all pass (run on the mid), so both halves get the same phase
/// shift and the image above the frequency is untouched.
struct BassMono {
    hp: [f64; 5],
    ap: [f64; 5],
}

fn bass_mono(freq: f64, sr: f64) -> BassMono {
    let w0 = (2.0 * PI * freq.min(sr * 0.45)) / sr;
    let cos = w0.cos();
    let alpha = w0.sin() / (2.0 * FRAC_1_SQRT_2);
    let a0 = 1.0 + alpha;
    let a1 = (-2.0 * cos) / a0;
    let a2 = (1.0 - alpha) / a0;
    BassMono {
        hp: [
            (1.0 + cos) / 2.0 / a0,
            -(1.0 + cos) / a0,
            (1.0 + cos) / 2.0 / a0,
            a1,
            a2,
        ],
        ap: [(1.0 - alpha) / a0, a1, 1.0, a1, a2],
    }
}

/// Output peaks and the L/R correlation (-1 out of phase to 1 mono) since
/// they were last read.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct UtilityMeters {
    pub peak_l: f64,
    pub peak_r: f64,
    pub correlation: f64,
}

pub struct UtilityKernel {
    sr: f64,
    smooth: f64,
    dc_coef: f64,
    dc: [f64; 4],
    hp: [f64; 4],
    ap: [f64; 2],
    bass: BassMono,
    s: UtilitySettings,
    gain: f64,
    width: f64,
    bal_l: f64,
    bal_r: f64,
    gain_target: f64,
    width_target: f64,
    bal_l_target: f64,
    bal_r_target: f64,
    started: bool,
    peak_l: f64,
    peak_r: f64,
    sum_lr: f64,
    sum_ll: f64,
    sum_rr: f64,
}

impl UtilityKernel {
    pub fn new(sample_rate: f64, settings: &UtilitySettings) -> Self {
        let mut k = Self {
            sr: sample_rate,
            smooth: 1.0 - (-1.0 / (0.01 * sample_rate)).exp(),
            dc_coef: ((-2.0 * PI * 5.0) / sample_rate).exp(),
            dc: [0.0; 4],
            hp: [0.0; 4],
            ap: [0.0; 2],
            bass: bass_mono(120.0, sample_rate),
            s: *settings,
            gain: 1.0,
            width: 1.0,
            bal_l: 1.0,
            bal_r: 1.0,
            gain_target: 1.0,
            width_target: 1.0,
            bal_l_target: 1.0,
            bal_r_target: 1.0,
            started: false,
            peak_l: 0.0,
            peak_r: 0.0,
            sum_lr: 0.0,
            sum_ll: 0.0,
            sum_rr: 0.0,
        };
        k.set(settings);
        k
    }

    pub fn set(&mut self, s: &UtilitySettings) {
        self.s = *s;
        self.gain_target = if s.mute || s.gain_db <= GAIN_FLOOR {
            0.0
        } else {
            10f64.powf(s.gain_db / 20.0)
        };
        self.width_target = if s.mono { 0.0 } else { s.width.clamp(0.0, 4.0) };
        let b = s.balance.clamp(-1.0, 1.0);
        self.bal_l_target = if b > 0.0 { 1.0 - b } else { 1.0 };
        self.bal_r_target = if b < 0.0 { 1.0 + b } else { 1.0 };
        self.bass = bass_mono(s.bass_freq, self.sr);
        if !self.started {
            self.started = true;
            self.gain = self.gain_target;
            self.width = self.width_target;
            self.bal_l = self.bal_l_target;
            self.bal_r = self.bal_r_target;
        }
    }

    /// Processes `out_l.len()` frames of `in_l`/`in_r` (a missing left is
    /// silence, a missing right the left) into the outputs.
    pub fn process(
        &mut self,
        in_l: Option<&[f32]>,
        in_r: Option<&[f32]>,
        out_l: &mut [f32],
        mut out_r: Option<&mut [f32]>,
    ) {
        for i in 0..out_l.len() {
            let l = in_l.map_or(0.0, |b| b[i] as f64);
            let r = in_r.map_or(l, |b| b[i] as f64);
            let (ol, or) = self.tick(l, r);
            out_l[i] = ol as f32;
            if let Some(o) = out_r.as_mut() {
                o[i] = or as f32;
            }
        }
    }

    /// As `process`, writing the result over its stereo input.
    pub fn process_in_place(&mut self, left: &mut [f32], right: &mut [f32]) {
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let (ol, or) = self.tick(*l as f64, *r as f64);
            *l = ol as f32;
            *r = or as f32;
        }
    }

    fn tick(&mut self, mut l: f64, mut r: f64) -> (f64, f64) {
        let s = self.s;
        let k = self.smooth;
        if s.dc_filter {
            // One-pole DC blocker (~5 Hz).
            let yl = l - self.dc[0] + self.dc_coef * self.dc[1];
            self.dc[0] = l;
            self.dc[1] = yl;
            let yr = r - self.dc[2] + self.dc_coef * self.dc[3];
            self.dc[2] = r;
            self.dc[3] = yr;
            l = yl;
            r = yr;
        }
        if s.channel == 1.0 {
            r = l;
        } else if s.channel == 2.0 {
            l = r;
        } else if s.channel == 3.0 {
            std::mem::swap(&mut l, &mut r);
        }
        if s.invert_l {
            l = -l;
        }
        if s.invert_r {
            r = -r;
        }
        self.width += (self.width_target - self.width) * k;
        self.gain += (self.gain_target - self.gain) * k;
        self.bal_l += (self.bal_l_target - self.bal_l) * k;
        self.bal_r += (self.bal_r_target - self.bal_r) * k;
        let mut mid = (l + r) * 0.5;
        let mut side = (l - r) * 0.5;
        if s.bass_mono {
            let (a, c) = (&self.bass.ap, &self.bass.hp);
            let (ap, hp) = (&mut self.ap, &mut self.hp);
            let m = a[0] * mid + ap[0];
            ap[0] = a[1] * mid - a[3] * m + ap[1];
            ap[1] = a[2] * mid - a[4] * m;
            mid = m;
            // Two Butterworth high passes (24 dB/oct) on the side: the
            // lows lose their stereo, the rest keeps it.
            let mut y = c[0] * side + hp[0];
            hp[0] = c[1] * side - c[3] * y + hp[1];
            hp[1] = c[2] * side - c[4] * y;
            let x2 = y;
            y = c[0] * x2 + hp[2];
            hp[2] = c[1] * x2 - c[3] * y + hp[3];
            hp[3] = c[2] * x2 - c[4] * y;
            side = y;
        }
        side *= self.width;
        let ol = (mid + side) * self.gain * self.bal_l;
        let or = (mid - side) * self.gain * self.bal_r;
        let (al, ar) = (ol.abs(), or.abs());
        if al > self.peak_l {
            self.peak_l = al;
        }
        if ar > self.peak_r {
            self.peak_r = ar;
        }
        self.sum_lr += ol * or;
        self.sum_ll += ol * ol;
        self.sum_rr += or * or;
        (ol, or)
    }

    pub fn take_meters(&mut self) -> UtilityMeters {
        let denom = (self.sum_ll * self.sum_rr).sqrt();
        let m = UtilityMeters {
            peak_l: self.peak_l,
            peak_r: self.peak_r,
            correlation: if denom > 1e-12 {
                self.sum_lr / denom
            } else {
                1.0
            },
        };
        self.peak_l = 0.0;
        self.peak_r = 0.0;
        self.sum_lr = 0.0;
        self.sum_ll = 0.0;
        self.sum_rr = 0.0;
        m
    }
}
