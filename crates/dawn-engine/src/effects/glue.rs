//! The Glue Compressor's DSP: a bus compressor after the classic 80s console
//! bus compressor.
//!
//! Port of `src/effects/glue/glueModel.ts` (`GlueKernel`,
//! `glueSettingsFromParams`) step for step; `tests/glue_parity.rs` holds the
//! port to what the JavaScript renders.
//!
//! Ratio, Attack and Release come in steps; the knee narrows as the ratio
//! goes up. Release "A" (Auto) runs a fast and a slow release at once and
//! uses whichever compresses more. Range caps the compression; Soft Clip is
//! a waveshaper that never passes -0.5 dB; oversampling runs the gain and
//! the clipper at twice the rate (a 31-tap filter each way, 15 samples of
//! latency). The detector hears the key: the input, or a sidechain blended
//! with it by the sidechain Mix.

use std::f64::consts::{LN_10, PI};
use std::sync::OnceLock;

use crate::effects::sidechain::{KeyFilter, KeySettings};
use crate::instruments::js_round;
use crate::params::ParamSource;

pub const RATIOS: [f64; 3] = [2.0, 4.0, 10.0];
/// Attack steps, milliseconds.
pub const ATTACKS_MS: [f64; 7] = [0.01, 0.1, 0.3, 1.0, 3.0, 10.0, 30.0];
/// Release steps, seconds; the step after the last is Auto.
pub const RELEASES_S: [f64; 6] = [0.1, 0.2, 0.4, 0.6, 0.8, 1.2];
pub const AUTO_RELEASE: usize = RELEASES_S.len();
pub const CLIP_CEILING_DB: f64 = -0.5;
/// Oversampling's latency, in samples at the base rate.
pub const OS_LATENCY: usize = 15;

const GLUE_DB: f64 = LN_10 / 20.0;
const TAPS: usize = 31;
const CLIP_KNEE: f64 = 0.5;

fn step(list: &[f64], v: f64) -> f64 {
    let i = js_round(v).min((list.len() - 1) as f64).max(0.0);
    list[i as usize]
}

/// The kernel's settings (`GlueSettings`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GlueSettings {
    pub key: KeySettings,
    pub threshold: f64,
    pub ratio: f64,
    /// Seconds.
    pub attack: f64,
    /// Seconds, or 0 for Auto.
    pub release: f64,
    pub makeup_db: f64,
    /// <= 0 dB.
    pub range_db: f64,
    pub dry_wet: f64,
    pub soft_clip: bool,
    pub oversample: bool,
    /// How much of the detector's input is the sidechain, while external.
    pub sc_mix: f64,
}

impl GlueSettings {
    /// The settings for the effect's parameters (`glueSettingsFromParams`);
    /// `external` is whether a sidechain source is connected.
    pub fn from_params<P: ParamSource + ?Sized>(p: &P, external: bool) -> Self {
        let release = js_round(p.param_or("release", AUTO_RELEASE as f64))
            .min(AUTO_RELEASE as f64)
            .max(0.0) as usize;
        Self {
            key: KeySettings::from_params(p, external),
            threshold: p.param_or("threshold", -10.0),
            ratio: step(&RATIOS, p.param_or("ratio", 1.0)),
            attack: step(&ATTACKS_MS, p.param_or("attack", 5.0)) / 1000.0,
            release: if release == AUTO_RELEASE {
                0.0
            } else {
                RELEASES_S[release]
            },
            makeup_db: p.param_or("makeup", 0.0),
            range_db: p.param_or("range", -70.0).min(0.0),
            dry_wet: p.param_or("dryWet", 1.0),
            soft_clip: p.param_or("softClip", 0.0) >= 0.5,
            oversample: p.param_or("oversample", 0.0) >= 0.5,
            sc_mix: p.param_or("scMix", 1.0),
        }
    }
}

impl Default for GlueSettings {
    fn default() -> Self {
        Self::from_params(&[] as &[(&str, f64)], false)
    }
}

/// Low-pass for 2x oversampling: windowed sinc at the base rate's Nyquist.
fn fir() -> &'static [f64; TAPS] {
    static FIR: OnceLock<[f64; TAPS]> = OnceLock::new();
    FIR.get_or_init(|| {
        let mut h = [0.0; TAPS];
        let m = (TAPS - 1) as f64 / 2.0;
        let mut sum = 0.0;
        for (i, h) in h.iter_mut().enumerate() {
            let t = i as f64 - m;
            let sinc = if t == 0.0 {
                0.5
            } else {
                (PI * 0.5 * t).sin() / (PI * t)
            };
            let n = (TAPS - 1) as f64;
            let w = 0.42 - 0.5 * ((2.0 * PI * i as f64) / n).cos()
                + 0.08 * ((4.0 * PI * i as f64) / n).cos();
            *h = sinc * w;
            sum += *h;
        }
        for x in &mut h {
            *x /= sum;
        }
        h
    })
}

fn ceiling() -> f64 {
    10f64.powf(CLIP_CEILING_DB / 20.0)
}

fn soft_clip(x: f64, ceil: f64) -> f64 {
    let a = x.abs();
    if a <= CLIP_KNEE {
        return x;
    }
    let span = ceil - CLIP_KNEE;
    x.signum() * (CLIP_KNEE + span * ((a - CLIP_KNEE) / span).tanh())
}

/// How much of "d dB past the threshold" counts, with a soft knee W dB
/// wide.
fn knee(d: f64, w: f64) -> f64 {
    if 2.0 * d >= w {
        return d;
    }
    if w > 0.0 && 2.0 * d > -w {
        return ((d + w / 2.0) * (d + w / 2.0)) / (2.0 * w);
    }
    0.0
}

#[derive(Clone)]
struct Fir {
    buf: [f64; TAPS * 2],
    pos: usize,
}

impl Fir {
    fn new() -> Self {
        Self {
            buf: [0.0; TAPS * 2],
            pos: 0,
        }
    }

    fn push(&mut self, x: f64) {
        self.pos = (self.pos + 1) % TAPS;
        self.buf[self.pos] = x;
        self.buf[self.pos + TAPS] = x;
    }

    fn out(&self, h: &[f64; TAPS]) -> f64 {
        let p = self.pos + 1;
        let mut y = 0.0;
        for (i, c) in h.iter().enumerate() {
            y += c * self.buf[p + i];
        }
        y
    }
}

/// The meters since they were last read: gain reduction (dB, >= 0), the
/// output and input peaks, and whether the clipper worked.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct GlueMeters {
    pub gain_reduction: f64,
    pub output: f64,
    pub input: f64,
    pub clipping: bool,
}

pub struct GlueKernel {
    sr: f64,
    key: KeyFilter,
    pk_rel: f64,
    slow_atk: f64,
    slow_rel: f64,
    fast_rel_auto: f64,
    det: f64,
    fast: f64,
    slow: f64,
    gain: f64,
    smooth: f64,
    makeup: f64,
    wet: f64,
    started: bool,
    os: bool,
    up_l: Fir,
    up_r: Fir,
    down_l: Fir,
    down_r: Fir,
    ceil: f64,
    t: f64,
    r: f64,
    w: f64,
    range: f64,
    atk: f64,
    auto: bool,
    rel: f64,
    makeup_target: f64,
    wet_target: f64,
    soft_clip: bool,
    external: bool,
    sc_mix: f64,
    listen: bool,
    meters: GlueMeters,
}

impl GlueKernel {
    pub fn new(sample_rate: f64, settings: &GlueSettings) -> Self {
        let sr = sample_rate;
        let mut k = Self {
            sr,
            key: KeyFilter::new(sr),
            pk_rel: (-1.0 / (0.01 * sr)).exp(),
            slow_atk: (-1.0 / (0.4 * sr)).exp(),
            slow_rel: (-1.0 / (1.5 * sr)).exp(),
            fast_rel_auto: (-1.0 / (0.1 * sr)).exp(),
            det: 0.0,
            fast: 0.0,
            slow: 0.0,
            gain: 1.0,
            smooth: 1.0 - (-1.0 / (0.01 * sr)).exp(),
            makeup: 1.0,
            wet: 1.0,
            started: false,
            os: false,
            up_l: Fir::new(),
            up_r: Fir::new(),
            down_l: Fir::new(),
            down_r: Fir::new(),
            ceil: ceiling(),
            t: 0.0,
            r: 1.0,
            w: 0.0,
            range: 0.0,
            atk: 0.0,
            auto: true,
            rel: 0.0,
            makeup_target: 1.0,
            wet_target: 1.0,
            soft_clip: false,
            external: false,
            sc_mix: 1.0,
            listen: false,
            meters: GlueMeters::default(),
        };
        k.set(settings);
        k
    }

    pub fn set(&mut self, s: &GlueSettings) {
        let sr = self.sr;
        self.t = s.threshold;
        self.r = s.ratio.max(1.0);
        self.w = 15.0 / self.r;
        self.range = (-s.range_db).max(0.0);
        self.atk = (-1.0 / (s.attack.max(0.000005) * sr)).exp();
        self.auto = s.release.is_nan() || s.release <= 0.0;
        self.rel = if self.auto {
            self.fast_rel_auto
        } else {
            (-1.0 / (s.release * sr)).exp()
        };
        self.makeup_target = (s.makeup_db * GLUE_DB).exp();
        self.wet_target = s.dry_wet.clamp(0.0, 1.0);
        self.soft_clip = s.soft_clip;
        self.external = s.key.external;
        self.sc_mix = s.sc_mix.clamp(0.0, 1.0);
        self.listen = s.key.listen;
        self.key.set(&s.key);
        self.os = s.oversample;
        if !self.started {
            self.makeup = self.makeup_target;
            self.wet = self.wet_target;
            self.started = true;
        }
    }

    /// The frames oversampling delays the audio by.
    pub fn latency(&self) -> usize {
        if self.os { OS_LATENCY } else { 0 }
    }

    /// The gain (linear) for one sample of the key.
    fn detect(&mut self, kl: f64, kr: f64) -> f64 {
        let level = kl.abs().max(kr.abs());
        self.det = if level > self.det {
            level
        } else {
            self.det * self.pk_rel
        };
        let x = if self.det > 1e-6 {
            self.det.ln() / GLUE_DB
        } else {
            -120.0
        };
        let mut r = (1.0 - 1.0 / self.r) * knee(x - self.t, self.w);
        if r > self.range {
            r = self.range;
        }
        self.fast = if r > self.fast {
            r + self.atk * (self.fast - r)
        } else {
            r + self.rel * (self.fast - r)
        };
        let mut gr = self.fast;
        if self.auto {
            self.slow = if r > self.slow {
                r + self.slow_atk * (self.slow - r)
            } else {
                r + self.slow_rel * (self.slow - r)
            };
            if self.slow > gr {
                gr = self.slow;
            }
        }
        if gr > self.meters.gain_reduction {
            self.meters.gain_reduction = gr;
        }
        (-gr * GLUE_DB).exp()
    }

    /// Makeup, dry/wet and the clipper for one output sample.
    fn finish(&mut self, x: f64, dry: f64, g: f64) -> f64 {
        let w = self.wet;
        let mut y = dry * (1.0 - w) + x * g * self.makeup * w;
        if self.soft_clip {
            if y.abs() > CLIP_KNEE {
                self.meters.clipping = true;
            }
            y = soft_clip(y, self.ceil);
        }
        y
    }

    /// Processes `out_l.len()` frames of `in_l`/`in_r` (a missing left is
    /// silence, a missing right the left) into the outputs; `key_l`/`key_r`
    /// is the sidechain (missing is silence, while external).
    pub fn process(
        &mut self,
        in_l: Option<&[f32]>,
        in_r: Option<&[f32]>,
        key_l: Option<&[f32]>,
        key_r: Option<&[f32]>,
        out_l: &mut [f32],
        mut out_r: Option<&mut [f32]>,
    ) {
        for i in 0..out_l.len() {
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

    /// As `process`, over its stereo input, keyed by it.
    pub fn process_in_place(&mut self, left: &mut [f32], right: &mut [f32]) {
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let (yl, yr) = self.tick(*l as f64, *r as f64, 0.0, 0.0);
            *l = yl as f32;
            *r = yr as f32;
        }
    }

    fn tick(&mut self, l: f64, r: f64, el: f64, er: f64) -> (f64, f64) {
        let smooth = self.smooth;
        if l.abs() > self.meters.input {
            self.meters.input = l.abs();
        }
        if r.abs() > self.meters.input {
            self.meters.input = r.abs();
        }
        let (mut kl, mut kr) = (l, r);
        if self.external {
            kl = el * self.sc_mix + l * (1.0 - self.sc_mix);
            kr = er * self.sc_mix + r * (1.0 - self.sc_mix);
        }
        kl = self.key.run(kl, 0);
        kr = self.key.run(kr, 1);
        let g = self.detect(kl, kr);
        self.makeup += (self.makeup_target - self.makeup) * smooth;
        self.wet += (self.wet_target - self.wet) * smooth;
        let (yl, yr) = if self.listen {
            (kl, kr)
        } else if !self.os {
            (self.finish(l, l, g), self.finish(r, r, g))
        } else {
            // Up (zero-stuffed, x2 to keep the level), process - the dry
            // is the same upsampled input, so it stays in line - then down.
            let h = fir();
            let g_prev = self.gain;
            let (mut yl, mut yr) = (0.0, 0.0);
            for k in 0..2 {
                self.up_l.push(if k == 0 { 2.0 * l } else { 0.0 });
                self.up_r.push(if k == 0 { 2.0 * r } else { 0.0 });
                let gk = if k == 0 { (g_prev + g) / 2.0 } else { g };
                let xl = self.up_l.out(h);
                let xr = self.up_r.out(h);
                let dl = self.finish(xl, xl, gk);
                self.down_l.push(dl);
                let dr = self.finish(xr, xr, gk);
                self.down_r.push(dr);
                // Keep the even-phase output: an exact 15-sample delay.
                if k == 0 {
                    yl = self.down_l.out(h);
                    yr = self.down_r.out(h);
                }
            }
            (yl, yr)
        };
        self.gain = g;
        let a = yl.abs().max(yr.abs());
        if a > self.meters.output {
            self.meters.output = a;
        }
        (yl, yr)
    }

    pub fn take_meters(&mut self) -> GlueMeters {
        std::mem::take(&mut self.meters)
    }
}
