//! Multiband Dynamics' DSP (after Live's device of that name): up to three
//! bands, each with an Above and a Below threshold, so every band does two
//! kinds of dynamics at once (Above ratio > 1 compresses, < 1 expands
//! upward; Below ratio > 1 expands downward, < 1 compresses upward).
//!
//! Port of `src/effects/multiband-dynamics/mbDynamicsModel.ts` (`MbdKernel`,
//! `mbdSettingsFromParams`) step for step; `tests/mb_dynamics_parity.rs`
//! holds the port to what the JavaScript renders.
//!
//! The crossovers are the Multiband Compressor's Linkwitz-Riley ones; the
//! Low and High buttons switch theirs in or out (both off: one band with
//! the Mid settings), with a fade around the switch. The crossover glide
//! is worked out once per call, as the worklet does per render quantum, so
//! `process_in_place` runs in 128-frame blocks.

use std::f64::consts::{FRAC_1_SQRT_2, PI};

use crate::effects::sidechain::{KeyFilter, KeySettings};
use crate::params::ParamSource;

pub const KNEE_DB: f64 = 6.0;
/// The most an upward move can lift (dB).
pub const MAX_BOOST: f64 = 24.0;
/// A ratio this big reads as infinite.
pub const RATIO_INF: f64 = 49.5;
const FADE: f64 = 128.0;
/// The worklet's render quantum, the block the glide is worked out for.
pub const QUANTUM: usize = 128;
/// The bands' names in the saved parameters, low to high.
const NAMES: [&str; 3] = ["l", "m", "h"];

/// One band's settings (`MbdBandSettings`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MbdBand {
    pub on: bool,
    pub solo: bool,
    pub in_db: f64,
    pub out_db: f64,
    pub above_t: f64,
    pub above_r: f64,
    pub below_t: f64,
    pub below_r: f64,
    pub attack: f64,
    pub release: f64,
}

/// The kernel's settings (`MbdSettings`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MbDynamicsSettings {
    pub key: KeySettings,
    pub low_on: bool,
    pub high_on: bool,
    pub x_low: f64,
    pub x_high: f64,
    /// Low, mid, high.
    pub bands: [MbdBand; 3],
    pub soft_knee: bool,
    pub rms: bool,
    pub output_db: f64,
    /// Scales every attack and release.
    pub time: f64,
    /// 0..1: how much of each ratio applies.
    pub amount: f64,
    pub sc_mix: f64,
}

impl MbDynamicsSettings {
    /// The settings for the effect's flat parameters
    /// (`mbdSettingsFromParams`); `external` is whether a sidechain source
    /// is connected.
    pub fn from_params<P: ParamSource + ?Sized>(p: &P, external: bool) -> Self {
        let on = |key: &str, d: f64| p.param_or(key, d) >= 0.5;
        let band = |n: &str| {
            let v = |f: &str, d: f64| p.param_or(&format!("{n}{f}"), d);
            MbdBand {
                on: v("On", 1.0) >= 0.5,
                solo: v("Solo", 0.0) >= 0.5,
                in_db: v("In", 0.0),
                out_db: v("Out", 0.0),
                above_t: v("AboveT", -20.0),
                above_r: v("AboveR", 1.0),
                below_t: v("BelowT", -50.0),
                below_r: v("BelowR", 1.0),
                attack: v("Attack", 0.01),
                release: v("Release", 0.06),
            }
        };
        Self {
            key: KeySettings::from_params(p, external),
            low_on: on("lowOn", 1.0),
            high_on: on("highOn", 1.0),
            x_low: p.param_or("xLow", 120.0),
            x_high: p.param_or("xHigh", 2500.0),
            bands: [band("l"), band("m"), band("h")],
            soft_knee: on("softKnee", 1.0),
            rms: on("rms", 0.0),
            output_db: p.param_or("output", 0.0),
            time: p.param_or("time", 1.0),
            amount: p.param_or("amount", 1.0),
            sc_mix: p.param_or("scMix", 1.0),
        }
    }

    /// The bands that exist, low to high (indices into `bands`), and how
    /// many.
    fn names(&self) -> ([usize; 3], usize) {
        let mut names = [0; 3];
        let mut n = 0;
        for (i, _) in NAMES.iter().enumerate() {
            let on = match i {
                0 => self.low_on,
                1 => true,
                _ => self.high_on,
            };
            if on {
                names[n] = i;
                n += 1;
            }
        }
        (names, n)
    }
}

impl Default for MbDynamicsSettings {
    fn default() -> Self {
        Self::from_params(&[] as &[(&str, f64)], false)
    }
}

/// A crossover's three filters (the Multiband Compressor's): Butterworth
/// low pass, high pass, and the matching all pass.
fn coefs(freq: f64, sr: f64) -> [[f64; 5]; 3] {
    let w0 = (2.0 * PI * freq.min(sr * 0.45)) / sr;
    let cos = w0.cos();
    let alpha = w0.sin() / (2.0 * FRAC_1_SQRT_2);
    let a0 = 1.0 + alpha;
    let a1 = (-2.0 * cos) / a0;
    let a2 = (1.0 - alpha) / a0;
    [
        [
            (1.0 - cos) / 2.0 / a0,
            (1.0 - cos) / a0,
            (1.0 - cos) / 2.0 / a0,
            a1,
            a2,
        ],
        [
            (1.0 + cos) / 2.0 / a0,
            -(1.0 + cos) / a0,
            (1.0 + cos) / 2.0 / a0,
            a1,
            a2,
        ],
        [(1.0 - alpha) / a0, (-2.0 * cos) / a0, 1.0, a1, a2],
    ]
}

fn knee(d: f64, w: f64) -> f64 {
    if 2.0 * d >= w {
        return d;
    }
    if w > 0.0 && 2.0 * d > -w {
        return ((d + w / 2.0) * (d + w / 2.0)) / (2.0 * w);
    }
    0.0
}

/// Gain (dB) for a level of x dB: the Above part and the Below part.
/// `amount` scales each slope toward 1 (no effect).
pub fn static_gain(x: f64, b: &MbdBand, soft: bool, amount: f64) -> (f64, f64) {
    let w = if soft { KNEE_DB } else { 0.0 };
    // Above: output slope 1/ratio past the threshold.
    let sa = if b.above_r >= RATIO_INF {
        0.0
    } else {
        1.0 / b.above_r.max(0.01)
    };
    let ga = knee(x - b.above_t, w) * (1.0 + amount * (sa - 1.0) - 1.0);
    // Below: output slope = ratio under the threshold.
    let sb = if b.below_r >= RATIO_INF {
        50.0
    } else {
        b.below_r
    };
    let gb = knee(b.below_t - x, w) * (1.0 - (1.0 + amount * (sb - 1.0)));
    (ga, gb)
}

#[derive(Clone, Copy, Default)]
struct Coef {
    atk: f64,
    rel: f64,
    in_t: f64,
    out_t: f64,
    on: f64,
}

/// A band's peak input (after Input) and output since they were last read.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MbdBandMeter {
    pub input: f64,
    pub output: f64,
}

/// The meters of the low, mid and high band; None for a band switched out.
pub type MbDynamicsMeters = [Option<MbdBandMeter>; 3];

pub struct MbDynamicsKernel {
    sr: f64,
    key: KeyFilter,
    pk_rel: f64,
    rms_coef: f64,
    smooth: f64,
    coefs: [f64; 30],
    cur_log: [f64; 2],
    target_log: [f64; 2],
    x_count: usize,
    state: [f64; 96],
    names: [usize; 3],
    count: usize,
    b_l: [f64; 3],
    b_r: [f64; 3],
    k_l: [f64; 3],
    k_r: [f64; 3],
    env: [f64; 3],
    ga: [f64; 3],
    gb: [f64; 3],
    act: [f64; 3],
    in_g: [f64; 3],
    out_g: [f64; 3],
    bands: [MbdBand; 3],
    soft_knee: bool,
    rms: bool,
    amount: f64,
    any_solo: bool,
    coef: [Coef; 3],
    out: f64,
    out_target: f64,
    fade: f64,
    pending: Option<MbDynamicsSettings>,
    started: bool,
    meter_in: [f64; 3],
    meter_out: [f64; 3],
    external: bool,
    sc_mix: f64,
    listen: bool,
}

impl MbDynamicsKernel {
    pub fn new(sample_rate: f64, settings: &MbDynamicsSettings) -> Self {
        let sr = sample_rate;
        let mut k = Self {
            sr,
            key: KeyFilter::new(sr),
            pk_rel: (-1.0 / (0.01 * sr)).exp(),
            rms_coef: 1.0 - (-1.0 / (0.015 * sr)).exp(),
            smooth: 1.0 - (-1.0 / (0.01 * sr)).exp(),
            coefs: [0.0; 30],
            cur_log: [0.0; 2],
            target_log: [0.0; 2],
            x_count: 0,
            state: [0.0; 96],
            names: [1, 0, 0],
            count: 1,
            b_l: [0.0; 3],
            b_r: [0.0; 3],
            k_l: [0.0; 3],
            k_r: [0.0; 3],
            env: [0.0; 3],
            ga: [0.0; 3],
            gb: [0.0; 3],
            act: [1.0; 3],
            in_g: [1.0; 3],
            out_g: [1.0; 3],
            bands: settings.bands,
            soft_knee: false,
            rms: false,
            amount: 1.0,
            any_solo: false,
            coef: [Coef::default(); 3],
            out: 1.0,
            out_target: 1.0,
            fade: 1.0,
            pending: None,
            started: false,
            meter_in: [0.0; 3],
            meter_out: [0.0; 3],
            external: false,
            sc_mix: 1.0,
            listen: false,
        };
        k.set(settings);
        k
    }

    fn same_names(&self, s: &MbDynamicsSettings) -> bool {
        let (names, n) = s.names();
        n == self.count && names[..n] == self.names[..n]
    }

    pub fn set(&mut self, s: &MbDynamicsSettings) {
        // Switching bands in or out rebuilds the split: fade out, switch,
        // fade in.
        if self.started && !self.same_names(s) {
            self.pending = Some(*s);
            return;
        }
        if self.pending.is_some() {
            self.pending = Some(*s);
        } else {
            self.apply(s, !self.started);
        }
        self.started = true;
    }

    fn apply(&mut self, s: &MbDynamicsSettings, snap: bool) {
        let rebuilt = !self.same_names(s);
        (self.names, self.count) = s.names();
        let mut xs = [0.0; 2];
        let mut n = 0;
        for (on, x) in [(s.low_on, s.x_low), (s.high_on, s.x_high)] {
            if on {
                xs[n] = x;
                n += 1;
            }
        }
        if n == 2 {
            if xs[1] < xs[0] {
                xs.swap(0, 1);
            }
            if xs[1] < xs[0] * 1.25 {
                xs[1] = xs[0] * 1.25;
            }
        }
        self.x_count = n;
        for (k, x) in xs.iter().enumerate().take(n) {
            self.target_log[k] = (self.sr * 0.45).min(x.max(10.0)).ln();
            if snap || rebuilt {
                self.cur_log[k] = self.target_log[k];
                self.design(k);
            }
        }
        self.bands = s.bands;
        self.soft_knee = s.soft_knee;
        self.rms = s.rms;
        self.amount = s.amount.clamp(0.0, 1.0);
        let time = s.time.max(0.01);
        let names = &self.names[..self.count];
        self.any_solo = names.iter().any(|&b| s.bands[b].solo);
        for (i, &name) in names.iter().enumerate() {
            let b = &s.bands[name];
            self.coef[i] = Coef {
                atk: (-1.0 / ((b.attack * time).max(0.00005) * self.sr)).exp(),
                rel: (-1.0 / ((b.release * time).max(0.0005) * self.sr)).exp(),
                in_t: if b.on {
                    10f64.powf(b.in_db / 20.0)
                } else {
                    1.0
                },
                out_t: if b.on {
                    10f64.powf(b.out_db / 20.0)
                } else {
                    1.0
                },
                on: if b.on { 1.0 } else { 0.0 },
            };
        }
        if snap || rebuilt {
            for i in 0..self.count {
                self.in_g[i] = self.coef[i].in_t;
                self.out_g[i] = self.coef[i].out_t;
                self.act[i] = self.coef[i].on;
                self.ga[i] = 0.0;
                self.gb[i] = 0.0;
                self.env[i] = 0.0;
            }
        }
        self.out_target = 10f64.powf(s.output_db / 20.0);
        if snap {
            self.out = self.out_target;
        }
        self.external = s.key.external;
        self.sc_mix = s.sc_mix.clamp(0.0, 1.0);
        self.listen = s.key.listen;
        self.key.set(&s.key);
        if rebuilt {
            self.state = [0.0; 96];
        }
    }

    fn design(&mut self, k: usize) {
        let c = coefs(self.cur_log[k].exp(), self.sr);
        for (f, filter) in c.iter().enumerate() {
            self.coefs[k * 15 + f * 5..k * 15 + f * 5 + 5].copy_from_slice(filter);
        }
    }

    /// Splits one sample of channel `ch` into `out`, low to high.
    fn split(
        c: &[f64; 30],
        s: &mut [f64; 96],
        x_count: usize,
        x: f64,
        ch: usize,
        out: &mut [f64; 3],
    ) {
        let bq = |s: &mut [f64; 96], ci: usize, si: usize, x: f64| {
            let y = c[ci] * x + s[si];
            s[si] = c[ci + 1] * x - c[ci + 3] * y + s[si + 1];
            s[si + 1] = c[ci + 2] * x - c[ci + 4] * y;
            y
        };
        let n = x_count;
        let mut rem = x;
        for (k, band) in out.iter_mut().enumerate().take(n) {
            let base = (ch * 2 + k) * 12;
            let mut lo = bq(s, k * 15, base, rem);
            lo = bq(s, k * 15, base + 2, lo);
            // Keep the low band in phase with what's above: the next
            // crossover's all-pass.
            if k + 1 < n {
                lo = bq(s, (k + 1) * 15 + 10, base + 8, lo);
            }
            *band = lo;
            rem = bq(s, k * 15 + 5, base + 4, rem);
            rem = bq(s, k * 15 + 5, base + 6, rem);
        }
        out[n] = rem;
    }

    /// Processes one block (a worklet's render quantum) of `in_l`/`in_r` (a
    /// missing left is silence, a missing right the left) into the
    /// outputs; `key_l`/`key_r` is the sidechain (missing is silence, while
    /// external).
    pub fn process(
        &mut self,
        in_l: Option<&[f32]>,
        in_r: Option<&[f32]>,
        key_l: Option<&[f32]>,
        key_r: Option<&[f32]>,
        out_l: &mut [f32],
        mut out_r: Option<&mut [f32]>,
    ) {
        let n = out_l.len();
        self.begin_block(n);
        for i in 0..n {
            let l = in_l.map_or(0.0, |b| b[i] as f64);
            let r = in_r.map_or(l, |b| b[i] as f64);
            let el = key_l.map_or(0.0, |b| b[i] as f64);
            let er = key_r.map_or(el, |b| b[i] as f64);
            let (yl, yr) = self.tick(l, r, el, er);
            out_l[i] = yl as f32;
            if let Some(o) = out_r.as_mut() {
                o[i] = yr as f32;
            }
        }
    }

    /// As `process`, over its stereo input, keyed by it, a quantum at a
    /// time.
    pub fn process_in_place(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len());
        let mut at = 0;
        while at < n {
            let len = (n - at).min(QUANTUM);
            self.begin_block(len);
            for i in at..at + len {
                let (yl, yr) = self.tick(left[i] as f64, right[i] as f64, 0.0, 0.0);
                left[i] = yl as f32;
                right[i] = yr as f32;
            }
            at += len;
        }
    }

    fn begin_block(&mut self, n: usize) {
        let glide = 1.0 - (-(n as f64) / (0.01 * self.sr)).exp();
        for k in 0..self.x_count {
            let d = self.target_log[k] - self.cur_log[k];
            if d.abs() > 1e-5 {
                self.cur_log[k] += if d.abs() < 1e-3 { d } else { d * glide };
                self.design(k);
            }
        }
    }

    fn tick(&mut self, l: f64, r: f64, el: f64, er: f64) -> (f64, f64) {
        let keyed = self.external || self.key.active();
        let count = self.count;
        let smooth = self.smooth;
        Self::split(
            &self.coefs,
            &mut self.state,
            self.x_count,
            l,
            0,
            &mut self.b_l,
        );
        Self::split(
            &self.coefs,
            &mut self.state,
            self.x_count,
            r,
            1,
            &mut self.b_r,
        );
        let (mut kl, mut kr) = (l, r);
        if self.external {
            kl = el * self.sc_mix + l * (1.0 - self.sc_mix);
            kr = er * self.sc_mix + r * (1.0 - self.sc_mix);
        }
        kl = self.key.run(kl, 0);
        kr = self.key.run(kr, 1);
        let mut key_gain = self.key.gain();
        if keyed {
            Self::split(
                &self.coefs,
                &mut self.state,
                self.x_count,
                kl,
                2,
                &mut self.k_l,
            );
            Self::split(
                &self.coefs,
                &mut self.state,
                self.x_count,
                kr,
                3,
                &mut self.k_r,
            );
            key_gain = 1.0;
        }
        let (d_l, d_r) = if keyed {
            (self.k_l, self.k_r)
        } else {
            (self.b_l, self.b_r)
        };
        let (mut yl, mut yr) = (0.0, 0.0);
        for b in 0..count {
            let c = self.coef[b];
            let band = self.bands[self.names[b]];
            self.in_g[b] += (c.in_t - self.in_g[b]) * smooth;
            self.out_g[b] += (c.out_t - self.out_g[b]) * smooth;
            self.act[b] += (c.on - self.act[b]) * smooth;
            let in_g = self.in_g[b];
            // Detector: the key's level in this band, after Input.
            let lv = key_gain * in_g;
            let a = (d_l[b] * lv).abs();
            let bb = (d_r[b] * lv).abs();
            let level = if self.rms {
                self.env[b] += ((a * a + bb * bb) / 2.0 - self.env[b]) * self.rms_coef;
                self.env[b].sqrt()
            } else {
                let p = if a > bb { a } else { bb };
                self.env[b] = if p > self.env[b] {
                    p
                } else {
                    self.env[b] * self.pk_rel
                };
                self.env[b]
            };
            let x = if level > 1e-6 {
                20.0 * level.log10()
            } else {
                -120.0
            };
            let (g0, g1) = static_gain(x, &band, self.soft_knee, self.amount);
            // Attack: moving toward more processing; Release: back to none.
            self.ga[b] = if g0.abs() > self.ga[b].abs() {
                g0 + c.atk * (self.ga[b] - g0)
            } else {
                g0 + c.rel * (self.ga[b] - g0)
            };
            self.gb[b] = if g1.abs() > self.gb[b].abs() {
                g1 + c.atk * (self.gb[b] - g1)
            } else {
                g1 + c.rel * (self.gb[b] - g1)
            };
            let gdb = (self.ga[b] + self.gb[b]).clamp(-80.0, MAX_BOOST);
            let act = self.act[b];
            let gain = 1.0 - act + act * in_g * 10f64.powf(gdb / 20.0) * self.out_g[b];
            let ol = self.b_l[b] * gain;
            let or = self.b_r[b] * gain;
            let in_pk = self.b_l[b].abs().max(self.b_r[b].abs()) * (1.0 - act + act * in_g);
            if in_pk > self.meter_in[b] {
                self.meter_in[b] = in_pk;
            }
            let out_pk = ol.abs().max(or.abs());
            if out_pk > self.meter_out[b] {
                self.meter_out[b] = out_pk;
            }
            if self.any_solo && !band.solo {
                continue;
            }
            yl += ol;
            yr += or;
        }
        self.out += (self.out_target - self.out) * smooth;
        if self.pending.is_some() {
            self.fade -= 1.0 / FADE;
            if self.fade <= 0.0 {
                self.fade = 0.0;
                if let Some(next) = self.pending.take() {
                    self.apply(&next, false);
                }
            }
        } else if self.fade < 1.0 {
            self.fade = (self.fade + 1.0 / FADE).min(1.0);
        }
        if self.listen {
            return (kl, kr);
        }
        let og = self.out * self.fade;
        (yl * og, yr * og)
    }

    pub fn take_meters(&mut self) -> MbDynamicsMeters {
        let mut m = [None; 3];
        for (b, &name) in self.names[..self.count].iter().enumerate() {
            m[name] = Some(MbdBandMeter {
                input: self.meter_in[b],
                output: self.meter_out[b],
            });
        }
        self.meter_in = [0.0; 3];
        self.meter_out = [0.0; 3];
        m
    }
}
