//! The Parametric EQ's DSP.
//!
//! Port of `src/effects/parametric-eq/paramEqModel.ts` (the filter design,
//! `ParamEqKernel`, `eqBandsFromParams`) step for step;
//! `tests/param_eq_parity.rs` holds the port to what the JavaScript renders.
//!
//! Every band is one or more biquad sections: bell, notch and band pass one
//! RBJ section; the shelves one RBJ shelf; the cuts a Butterworth cascade of
//! slope/6 poles (Q above 0.71 sharpening its most resonant section); the
//! tilt shelf a low and a high shelf around the frequency. A band runs on
//! both channels, one of them, or the mid or side. Coefficient changes glide
//! over 256 samples; changing a band's shape or section count restarts it.
//!
//! Unlike the JavaScript, the bands' sections are fixed arrays (no
//! allocating when settings change on the audio thread), and there's no
//! band solo (the window's listening aid, heard in the browser).

use std::f64::consts::{FRAC_1_SQRT_2, PI};

use crate::instruments::js_round;
use crate::params::ParamSource;

pub const MAX_BANDS: usize = 24;
/// The most sections a band has (a 96 dB/oct cut: 8 pole pairs).
const MAX_SECTIONS: usize = 8;
const SLOPE_STEPS: [f64; 8] = [6.0, 12.0, 18.0, 24.0, 36.0, 48.0, 72.0, 96.0];
const RAMP: u32 = 256;

/// One band, as the kernel takes it (`EqBand`): `on` is 0 (no band), 1
/// (active) or 2 (bypassed); `shape` and `place` index the shapes and
/// placements.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct EqBand {
    pub on: f64,
    pub shape: f64,
    pub freq: f64,
    pub gain: f64,
    pub q: f64,
    pub slope: f64,
    pub place: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ParamEqSettings {
    pub bands: [EqBand; MAX_BANDS],
    pub output_db: f64,
}

/// A new band slot's frequency, spread across the spectrum
/// (`defaultBandFreq`).
pub fn default_band_freq(index: usize) -> f64 {
    js_round(40.0 * 2f64.powf((index as f64 * 9.0) / MAX_BANDS as f64) * 10.0) / 10.0
}

impl ParamEqSettings {
    /// The settings for the effect's flat parameters (`b<n>On`, `b<n>Freq`
    /// ... and `output`).
    pub fn from_params<P: ParamSource + ?Sized>(p: &P) -> Self {
        let mut bands = [EqBand::default(); MAX_BANDS];
        for (i, band) in bands.iter_mut().enumerate() {
            let v = |k: &str, d: f64| p.param_or(&format!("b{}{k}", i + 1), d);
            *band = EqBand {
                on: js_round(v("On", 0.0)),
                shape: js_round(v("Shape", 0.0)),
                freq: v("Freq", default_band_freq(i)),
                gain: v("Gain", 0.0),
                q: v("Q", 1.0),
                slope: v("Slope", 12.0),
                place: js_round(v("Place", 0.0)),
            };
        }
        Self {
            bands,
            output_db: p.param_or("output", 0.0),
        }
    }
}

impl Default for ParamEqSettings {
    fn default() -> Self {
        Self::from_params(&[] as &[(&str, f64)])
    }
}

/// A biquad section, normalized (a0 = 1).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Section {
    pub b0: f64,
    pub b1: f64,
    pub b2: f64,
    pub a1: f64,
    pub a2: f64,
}

fn norm(b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64) -> Section {
    Section {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0,
    }
}

/// A band's sections.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Sections {
    pub list: [Section; MAX_SECTIONS],
    pub len: usize,
}

impl Sections {
    fn of(list: &[Section]) -> Self {
        let mut s = Self::default();
        for x in list {
            s.push(*x);
        }
        s
    }

    fn push(&mut self, x: Section) {
        if self.len < MAX_SECTIONS {
            self.list[self.len] = x;
            self.len += 1;
        }
    }

    pub fn as_slice(&self) -> &[Section] {
        &self.list[..self.len]
    }
}

fn nearest_slope(s: f64) -> f64 {
    let mut best = 12.0;
    for v in SLOPE_STEPS {
        if (v - s).abs() < (best - s).abs() {
            best = v;
        }
    }
    best
}

fn shelf(high: bool, freq: f64, gain_db: f64, q: f64, sr: f64) -> Section {
    let w0 = (2.0 * PI * freq) / sr;
    let cos = w0.cos();
    let a = 10f64.powf(gain_db / 40.0);
    let alpha = w0.sin() / (2.0 * q);
    let k = 2.0 * a.sqrt() * alpha;
    if !high {
        return norm(
            a * (a + 1.0 - (a - 1.0) * cos + k),
            2.0 * a * (a - 1.0 - (a + 1.0) * cos),
            a * (a + 1.0 - (a - 1.0) * cos - k),
            a + 1.0 + (a - 1.0) * cos + k,
            -2.0 * (a - 1.0 + (a + 1.0) * cos),
            a + 1.0 + (a - 1.0) * cos - k,
        );
    }
    norm(
        a * (a + 1.0 + (a - 1.0) * cos + k),
        -2.0 * a * (a - 1.0 + (a + 1.0) * cos),
        a * (a + 1.0 + (a - 1.0) * cos - k),
        a + 1.0 - (a - 1.0) * cos + k,
        2.0 * (a - 1.0 - (a + 1.0) * cos),
        a + 1.0 - (a - 1.0) * cos - k,
    )
}

fn cut_sections(high: bool, freq: f64, q: f64, slope: f64, sr: f64) -> Sections {
    let order = js_round(nearest_slope(slope) / 6.0) as i64;
    let w0 = (2.0 * PI * freq) / sr;
    let cos = w0.cos();
    let mut sections = Sections::default();
    if order % 2 == 1 {
        let k = (w0 / 2.0).tan();
        if high {
            sections.push(norm(k, k, 0.0, 1.0 + k, k - 1.0, 0.0));
        } else {
            sections.push(norm(1.0, -1.0, 0.0, 1.0 + k, k - 1.0, 0.0));
        }
    }
    let pairs = order / 2;
    for k in 1..=pairs {
        // Butterworth pole pairs sit at these angles from the negative real
        // axis: (2k-1)pi/2n for even orders, k*pi/n for odd ones.
        let angle = if order % 2 == 0 {
            ((2 * k - 1) as f64 * PI) / (2 * order) as f64
        } else {
            (k as f64 * PI) / order as f64
        };
        let mut sq = 1.0 / (2.0 * angle.cos());
        if k == pairs {
            sq *= q / FRAC_1_SQRT_2;
        }
        let alpha = w0.sin() / (2.0 * sq);
        if high {
            sections.push(norm(
                (1.0 - cos) / 2.0,
                1.0 - cos,
                (1.0 - cos) / 2.0,
                1.0 + alpha,
                -2.0 * cos,
                1.0 - alpha,
            ));
        } else {
            sections.push(norm(
                (1.0 + cos) / 2.0,
                -(1.0 + cos),
                (1.0 + cos) / 2.0,
                1.0 + alpha,
                -2.0 * cos,
                1.0 - alpha,
            ));
        }
    }
    sections
}

/// The biquad sections for one band (`eqDesignBand`). shape: 0 bell, 1 low
/// shelf, 2 low cut, 3 high shelf, 4 high cut, 5 notch, 6 band pass, 7 tilt
/// shelf.
pub fn design_band(shape: f64, freq: f64, gain_db: f64, q: f64, slope: f64, sr: f64) -> Sections {
    let f = freq.max(5.0).min(sr * 0.49);
    let qq = q.clamp(0.025, 40.0);
    let w0 = (2.0 * PI * f) / sr;
    let cos = w0.cos();
    let alpha = w0.sin() / (2.0 * qq);
    match shape as i64 {
        _ if shape.fract() != 0.0 => Sections::default(),
        0 => {
            let a = 10f64.powf(gain_db / 40.0);
            Sections::of(&[norm(
                1.0 + alpha * a,
                -2.0 * cos,
                1.0 - alpha * a,
                1.0 + alpha / a,
                -2.0 * cos,
                1.0 - alpha / a,
            )])
        }
        1 => Sections::of(&[shelf(false, f, gain_db, qq, sr)]),
        2 => cut_sections(false, f, qq, slope, sr),
        3 => Sections::of(&[shelf(true, f, gain_db, qq, sr)]),
        4 => cut_sections(true, f, qq, slope, sr),
        5 => Sections::of(&[norm(
            1.0,
            -2.0 * cos,
            1.0,
            1.0 + alpha,
            -2.0 * cos,
            1.0 - alpha,
        )]),
        6 => Sections::of(&[norm(
            alpha,
            0.0,
            -alpha,
            1.0 + alpha,
            -2.0 * cos,
            1.0 - alpha,
        )]),
        7 => Sections::of(&[
            shelf(false, f, -gain_db / 2.0, qq, sr),
            shelf(true, f, gain_db / 2.0, qq, sr),
        ]),
        _ => Sections::default(),
    }
}

#[derive(Clone, Copy, Default)]
struct Stage {
    cur: Section,
    step: Section,
    left: u32,
    /// Transposed direct form II state, per channel.
    z: [f64; 4],
}

impl Stage {
    fn new(target: Section) -> Self {
        Self {
            cur: target,
            ..Self::default()
        }
    }

    fn glide_to(&mut self, t: &Section) {
        let r = RAMP as f64;
        self.step = Section {
            b0: (t.b0 - self.cur.b0) / r,
            b1: (t.b1 - self.cur.b1) / r,
            b2: (t.b2 - self.cur.b2) / r,
            a1: (t.a1 - self.cur.a1) / r,
            a2: (t.a2 - self.cur.a2) / r,
        };
        self.left = RAMP;
    }

    #[inline]
    fn tick(&mut self) {
        if self.left > 0 {
            let (c, s) = (&mut self.cur, &self.step);
            c.b0 += s.b0;
            c.b1 += s.b1;
            c.b2 += s.b2;
            c.a1 += s.a1;
            c.a2 += s.a2;
            self.left -= 1;
        }
    }

    #[inline]
    fn run(&mut self, x: f64, ch: usize) -> f64 {
        let (c, z, i) = (&self.cur, &mut self.z, ch * 2);
        let y = c.b0 * x + z[i];
        z[i] = c.b1 * x - c.a1 * y + z[i + 1];
        z[i + 1] = c.b2 * x - c.a2 * y;
        y
    }
}

#[derive(Clone, Copy, Default)]
struct Band {
    active: bool,
    shape: f64,
    place: f64,
    stages: [Stage; MAX_SECTIONS],
    len: usize,
}

pub struct ParamEqKernel {
    sr: f64,
    bands: Box<[Band; MAX_BANDS]>,
    out_gain: f64,
    out_target: f64,
}

impl ParamEqKernel {
    pub fn new(sample_rate: f64, settings: &ParamEqSettings) -> Self {
        let mut k = Self {
            sr: sample_rate,
            bands: Box::new([Band::default(); MAX_BANDS]),
            out_gain: 1.0,
            out_target: 1.0,
        };
        k.set(settings);
        k
    }

    pub fn set(&mut self, state: &ParamEqSettings) {
        let sr = self.sr;
        for (prev, b) in self.bands.iter_mut().zip(&state.bands) {
            if b.on != 1.0 {
                prev.active = false;
                continue;
            }
            let sections = design_band(b.shape, b.freq, b.gain, b.q, b.slope, sr);
            if prev.active && prev.shape == b.shape && prev.len == sections.len {
                for (st, s) in prev.stages.iter_mut().zip(sections.as_slice()) {
                    st.glide_to(s);
                }
                prev.place = b.place;
            } else {
                *prev = Band {
                    active: true,
                    shape: b.shape,
                    place: b.place,
                    stages: [Stage::default(); MAX_SECTIONS],
                    len: sections.len,
                };
                for (st, s) in prev.stages.iter_mut().zip(sections.as_slice()) {
                    *st = Stage::new(*s);
                }
            }
        }
        let out_db = if state.output_db.is_nan() {
            0.0
        } else {
            state.output_db
        };
        self.out_target = 10f64.powf(out_db / 20.0);
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
            let (yl, yr) = self.tick(l, r);
            out_l[i] = yl as f32;
            if let Some(o) = out_r.as_mut() {
                o[i] = yr as f32;
            }
        }
    }

    /// As `process`, writing the result over its stereo input.
    pub fn process_in_place(&mut self, left: &mut [f32], right: &mut [f32]) {
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let (yl, yr) = self.tick(*l as f64, *r as f64);
            *l = yl as f32;
            *r = yr as f32;
        }
    }

    fn tick(&mut self, mut l: f64, mut r: f64) -> (f64, f64) {
        for band in self.bands.iter_mut().filter(|b| b.active) {
            let place = band.place;
            let stages = &mut band.stages[..band.len];
            if place == 3.0 || place == 4.0 {
                let mut m = (l + r) * 0.5;
                let mut s = (l - r) * 0.5;
                for st in stages {
                    st.tick();
                    if place == 3.0 {
                        m = st.run(m, 0);
                    } else {
                        s = st.run(s, 0);
                    }
                }
                l = m + s;
                r = m - s;
            } else {
                for st in stages {
                    st.tick();
                    if place != 2.0 {
                        l = st.run(l, 0);
                    }
                    if place != 1.0 {
                        r = st.run(r, 1);
                    }
                }
            }
        }
        self.out_gain += (self.out_target - self.out_gain) * 0.002;
        (l * self.out_gain, r * self.out_gain)
    }
}
