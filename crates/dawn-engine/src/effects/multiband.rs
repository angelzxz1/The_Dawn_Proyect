//! The Multiband Compressor's DSP.
//!
//! Port of `src/effects/multiband/multibandModel.ts` (`MultibandKernel`,
//! `mbSettingsFromParams`) step for step; `tests/multiband_parity.rs` holds
//! the port to what the JavaScript renders.
//!
//! Crossovers are Linkwitz-Riley 24 dB/oct; a low band also runs through
//! the all-pass of every crossover above it, so untouched bands add back up
//! flat. Each band has its own stereo-linked dynamics (a peak detector, a
//! soft-knee gain computer that compresses, expands or lifts, Range capping
//! it), makeup and bypass; mix and output are global. With a sidechain (or
//! the key filters in use), the detectors hear the key split through the
//! same crossovers. Changing the band count fades out, rebuilds and fades
//! back in. No lookahead, so no latency.
//!
//! The crossover glide is worked out once per call, as the worklet does
//! per render quantum, so `process_in_place` runs in 128-frame blocks.
//! There's no band solo (the window's listening aid, heard in the browser).

use std::cmp::Ordering;
use std::f64::consts::{FRAC_1_SQRT_2, LN_10, PI};

use crate::effects::sidechain::{KeyFilter, KeySettings};
use crate::instruments::js_round;
use crate::params::ParamSource;

pub const MAX_BANDS: usize = 6;
pub const DEFAULT_BANDS: f64 = 4.0;
pub const DEFAULT_CROSSOVERS: [f64; 5] = [120.0, 1000.0, 6000.0, 10000.0, 15000.0];
const FADE: f64 = 128.0;
const SLOTS: usize = 4 + MAX_BANDS;
const MB_DB: f64 = LN_10 / 20.0;
/// The worklet's render quantum, the block the glide is worked out for.
pub const QUANTUM: usize = 128;

/// One band's settings as the kernel takes them (`MbBand`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MbBand {
    pub thresh: f64,
    pub ratio: f64,
    pub attack: f64,
    pub release: f64,
    pub knee: f64,
    pub range: f64,
    pub gain: f64,
    pub mode: f64,
    pub bypass: f64,
}

impl Default for MbBand {
    fn default() -> Self {
        Self {
            thresh: -20.0,
            ratio: 2.0,
            attack: 0.01,
            release: 0.15,
            knee: 6.0,
            range: 24.0,
            gain: 0.0,
            mode: 0.0,
            bypass: 0.0,
        }
    }
}

/// The kernel's settings (`MbSettings`, without the band solo).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MultibandSettings {
    pub key: KeySettings,
    pub count: f64,
    /// `count - 1` crossover frequencies (Hz), lowest first.
    pub crossovers: [f64; MAX_BANDS - 1],
    pub bands: [MbBand; MAX_BANDS],
    pub output_db: f64,
    pub mix: f64,
}

fn sort(xs: &mut [f64]) {
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
}

/// The number of bands the parameters ask for (`mbBandCount`).
pub fn band_count<P: ParamSource + ?Sized>(p: &P) -> usize {
    js_round(p.param_or("bands", DEFAULT_BANDS)).clamp(1.0, MAX_BANDS as f64) as usize
}

impl MultibandSettings {
    /// The settings for the effect's flat parameters
    /// (`mbSettingsFromParams`); `external` is whether a sidechain source is
    /// connected.
    pub fn from_params<P: ParamSource + ?Sized>(p: &P, external: bool) -> Self {
        let count = band_count(p);
        let mut crossovers = [0.0; MAX_BANDS - 1];
        for (k, x) in crossovers.iter_mut().enumerate().take(count - 1) {
            *x = p.param_or(&format!("x{}", k + 1), DEFAULT_CROSSOVERS[k]);
        }
        sort(&mut crossovers[..count - 1]);
        let mut bands = [MbBand::default(); MAX_BANDS];
        for (b, band) in bands.iter_mut().enumerate() {
            let d = MbBand::default();
            let v = |f: &str, def: f64| p.param_or(&format!("b{}{f}", b + 1), def);
            *band = MbBand {
                thresh: v("Thresh", d.thresh),
                ratio: v("Ratio", d.ratio),
                attack: v("Attack", d.attack),
                release: v("Release", d.release),
                knee: v("Knee", d.knee),
                range: v("Range", d.range),
                gain: v("Gain", d.gain),
                mode: v("Mode", d.mode),
                bypass: v("Bypass", d.bypass),
            };
        }
        Self {
            key: KeySettings::from_params(p, external),
            count: count as f64,
            crossovers,
            bands,
            output_db: p.param_or("output", 0.0),
            mix: p.param_or("mix", 1.0),
        }
    }
}

impl Default for MultibandSettings {
    fn default() -> Self {
        Self::from_params(&[] as &[(&str, f64)], false)
    }
}

/// A crossover's three filters, each [b0, b1, b2, a1, a2]: Butterworth low
/// pass, high pass, and the matching all pass.
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

/// Gain (dB) for a level of x dB: mode 0 compresses above the threshold, 1
/// expands below it, 2 lifts quiet parts up toward it.
pub fn static_gain(x: f64, t: f64, r: f64, w: f64, mode: f64, range: f64) -> f64 {
    let g = if mode == 1.0 {
        -(r - 1.0) * knee(t - x, w)
    } else if mode == 2.0 {
        (1.0 - 1.0 / r) * knee(t - x, w)
    } else {
        (1.0 / r - 1.0) * knee(x - t, w)
    };
    if g < -range {
        -range
    } else if g > range {
        range
    } else {
        g
    }
}

#[derive(Clone, Copy)]
struct Params {
    t: f64,
    r: f64,
    w: f64,
    mode: f64,
    range: f64,
    atk: f64,
    rel: f64,
    gain: f64,
    bypass: bool,
}

/// The crossovers' filter state, for left, right, key left, key right.
type State = [f64; 4 * MAX_BANDS * SLOTS * 2];

/// Splits one channel's sample into `out`, a value per band.
fn split(
    c: &[f64; MAX_BANDS * 15],
    s: &mut State,
    count: usize,
    x: f64,
    ch: usize,
    out: &mut [f64; MAX_BANDS],
) {
    let last = count - 1;
    let mut rem = x;
    for (k, band) in out.iter_mut().enumerate().take(last) {
        let base = (ch * MAX_BANDS + k) * SLOTS * 2;
        let o = k * 15;
        // Low side: LP twice, then the all-pass of every crossover above.
        let mut lo = rem;
        for pass in 0..2 {
            let si = base + pass * 2;
            let y = c[o] * lo + s[si];
            s[si] = c[o + 1] * lo - c[o + 3] * y + s[si + 1];
            s[si + 1] = c[o + 2] * lo - c[o + 4] * y;
            lo = y;
        }
        for j in k + 1..last {
            let si = base + (4 + j) * 2;
            let a = j * 15 + 10;
            let y = c[a] * lo + s[si];
            s[si] = c[a + 1] * lo - c[a + 3] * y + s[si + 1];
            s[si + 1] = c[a + 2] * lo - c[a + 4] * y;
            lo = y;
        }
        *band = lo;
        // High side: HP twice; it carries on to the next crossover.
        for pass in 2..4 {
            let si = base + pass * 2;
            let y = c[o + 5] * rem + s[si];
            s[si] = c[o + 6] * rem - c[o + 8] * y + s[si + 1];
            s[si + 1] = c[o + 7] * rem - c[o + 9] * y;
            rem = y;
        }
    }
    out[last] = rem;
}

/// Per band, the most extreme dynamic gain (dB) and the peak level
/// (linear) since they were last read.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MultibandMeters {
    pub gain: [f64; MAX_BANDS],
    pub level: [f64; MAX_BANDS],
}

pub struct MultibandKernel {
    sr: f64,
    count: usize,
    coefs: [f64; MAX_BANDS * 15],
    state: Box<State>,
    cur_log: [f64; MAX_BANDS],
    target_log: [f64; MAX_BANDS],
    band_l: [f64; MAX_BANDS],
    band_r: [f64; MAX_BANDS],
    key_l: [f64; MAX_BANDS],
    key_r: [f64; MAX_BANDS],
    key: KeyFilter,
    external: bool,
    listen: bool,
    peak: [f64; MAX_BANDS],
    det: [f64; MAX_BANDS],
    env: [f64; MAX_BANDS],
    makeup: [f64; MAX_BANDS],
    active: [f64; MAX_BANDS],
    params: [Params; MAX_BANDS],
    meters: MultibandMeters,
    mix: f64,
    mix_target: f64,
    out: f64,
    out_target: f64,
    smooth: f64,
    fade: f64,
    pending: Option<MultibandSettings>,
    started: bool,
}

impl MultibandKernel {
    pub fn new(sample_rate: f64, settings: &MultibandSettings) -> Self {
        let mut k = Self {
            sr: sample_rate,
            count: 1,
            coefs: [0.0; MAX_BANDS * 15],
            state: Box::new([0.0; 4 * MAX_BANDS * SLOTS * 2]),
            cur_log: [0.0; MAX_BANDS],
            target_log: [0.0; MAX_BANDS],
            band_l: [0.0; MAX_BANDS],
            band_r: [0.0; MAX_BANDS],
            key_l: [0.0; MAX_BANDS],
            key_r: [0.0; MAX_BANDS],
            key: KeyFilter::new(sample_rate),
            external: false,
            listen: false,
            peak: [0.0; MAX_BANDS],
            det: [0.0; MAX_BANDS],
            env: [0.0; MAX_BANDS],
            makeup: [0.0; MAX_BANDS],
            active: [1.0; MAX_BANDS],
            params: [Params {
                t: -20.0,
                r: 2.0,
                w: 6.0,
                mode: 0.0,
                range: 24.0,
                atk: 0.0,
                rel: 0.0,
                gain: 0.0,
                bypass: false,
            }; MAX_BANDS],
            meters: MultibandMeters::default(),
            mix: 1.0,
            mix_target: 1.0,
            out: 1.0,
            out_target: 1.0,
            smooth: 1.0 - (-1.0 / (0.01 * sample_rate)).exp(),
            fade: 1.0,
            pending: None,
            started: false,
        };
        k.set(settings);
        k
    }

    fn count_of(s: &MultibandSettings) -> usize {
        js_round(s.count).clamp(1.0, MAX_BANDS as f64) as usize
    }

    pub fn set(&mut self, s: &MultibandSettings) {
        self.external = s.key.external;
        self.listen = s.key.listen;
        self.key.set(&s.key);
        let count = Self::count_of(s);
        // Changing the number of bands rebuilds the crossover tree: fade
        // out, switch, fade back in (a few ms) instead of clicking.
        if self.started && count != self.count {
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

    fn apply(&mut self, s: &MultibandSettings, snap: bool) {
        let sr = self.sr;
        let count = Self::count_of(s);
        let rebuilt = count != self.count;
        self.count = count;
        let mut xs = [0.0; MAX_BANDS - 1];
        for (x, f) in xs.iter_mut().zip(&s.crossovers).take(count - 1) {
            let f = if *f == 0.0 || f.is_nan() { 1000.0 } else { *f };
            *x = (sr * 0.45).min(f.max(10.0));
        }
        sort(&mut xs[..count - 1]);
        for (k, x) in xs.iter().enumerate().take(count - 1) {
            self.target_log[k] = x.ln();
            if snap || rebuilt {
                self.cur_log[k] = self.target_log[k];
                self.design(k);
            }
        }
        for (b, src) in s.bands.iter().enumerate() {
            let p = &mut self.params[b];
            p.t = src.thresh;
            p.r = src.ratio.max(1.0);
            p.w = src.knee.max(0.0);
            p.mode = js_round(src.mode);
            p.range = src.range.max(0.0);
            p.atk = (-1.0 / (src.attack.max(0.00005) * sr)).exp();
            p.rel = (-1.0 / (src.release.max(0.001) * sr)).exp();
            p.gain = src.gain;
            p.bypass = src.bypass >= 0.5;
            if snap {
                self.makeup[b] = if p.bypass { 0.0 } else { p.gain };
                self.active[b] = if p.bypass { 0.0 } else { 1.0 };
            }
        }
        self.mix_target = s.mix.clamp(0.0, 1.0);
        self.out_target = (s.output_db * MB_DB).exp();
        if snap {
            self.mix = self.mix_target;
            self.out = self.out_target;
        }
        if rebuilt {
            self.state.fill(0.0);
        }
    }

    fn design(&mut self, k: usize) {
        let c = coefs(self.cur_log[k].exp(), self.sr);
        let o = k * 15;
        for (f, filter) in c.iter().enumerate() {
            self.coefs[o + f * 5..o + f * 5 + 5].copy_from_slice(filter);
        }
    }

    /// Processes one block (a worklet's render quantum) of `in_l`/`in_r` (a
    /// missing left is silence, a missing right the left) into the
    /// outputs; `key_l`/`key_r` is the sidechain (missing is silence, while
    /// external).
    pub fn process(
        &mut self,
        in_l: Option<&[f32]>,
        in_r: Option<&[f32]>,
        out_l: &mut [f32],
        mut out_r: Option<&mut [f32]>,
        key_l: Option<&[f32]>,
        key_r: Option<&[f32]>,
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

    /// Crossover moves glide (~10 ms) so dragging one never zippers.
    fn begin_block(&mut self, n: usize) {
        let glide = 1.0 - (-(n as f64) / (0.01 * self.sr)).exp();
        for k in 0..self.count - 1 {
            let d = self.target_log[k] - self.cur_log[k];
            if d.abs() > 1e-5 {
                self.cur_log[k] += if d.abs() < 1e-3 { d } else { d * glide };
                self.design(k);
            }
        }
    }

    fn tick(&mut self, l: f64, r: f64, el: f64, er: f64) -> (f64, f64) {
        let smooth = self.smooth;
        // A separate split for the detectors only when they hear something
        // other than the input itself.
        let keyed = self.external || self.key.active();
        let key_gain = if keyed { 1.0 } else { self.key.gain() };
        let count = self.count;
        split(&self.coefs, &mut self.state, count, l, 0, &mut self.band_l);
        split(&self.coefs, &mut self.state, count, r, 1, &mut self.band_r);
        let mut kl = l * self.key.gain();
        let mut kr = r * self.key.gain();
        if keyed {
            if self.external {
                kl = el;
                kr = er;
            } else {
                kl = l;
                kr = r;
            }
            kl = self.key.run(kl, 0);
            kr = self.key.run(kr, 1);
            split(&self.coefs, &mut self.state, count, kl, 2, &mut self.key_l);
            split(&self.coefs, &mut self.state, count, kr, 3, &mut self.key_r);
        }
        let (k_l, k_r) = if keyed {
            (&self.key_l, &self.key_r)
        } else {
            (&self.band_l, &self.band_r)
        };
        let (mut wet_l, mut wet_r, mut dry_l, mut dry_r) = (0.0, 0.0, 0.0, 0.0);
        for b in 0..count {
            let p = self.params[b];
            let (bl, br) = (self.band_l[b], self.band_r[b]);
            let level = k_l[b].abs().max(k_r[b].abs()) * key_gain;
            if level > self.meters.level[b] {
                self.meters.level[b] = level;
            }
            // Level detection: a peak follower falling at the Release time,
            // smoothed by the Attack time.
            let peak = self.peak[b];
            self.peak[b] = if level > peak {
                level
            } else {
                level + p.rel * (peak - level)
            };
            self.det[b] = self.peak[b] + p.atk * (self.det[b] - self.peak[b]);
            let x = if self.det[b] > 1e-6 {
                self.det[b].ln() / MB_DB
            } else {
                -120.0
            };
            self.env[b] = static_gain(x, p.t, p.r, p.w, p.mode, p.range);
            self.active[b] += (if p.bypass { 0.0 } else { 1.0 } - self.active[b]) * smooth;
            self.makeup[b] += (if p.bypass { 0.0 } else { p.gain } - self.makeup[b]) * smooth;
            let dynamic = self.active[b] * self.env[b];
            if dynamic.abs() > self.meters.gain[b].abs() {
                self.meters.gain[b] = dynamic;
            }
            let g = ((self.makeup[b] + dynamic) * MB_DB).exp();
            wet_l += bl * g;
            wet_r += br * g;
            dry_l += bl;
            dry_r += br;
        }
        self.mix += (self.mix_target - self.mix) * smooth;
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
        let gain = self.out * self.fade;
        (
            (dry_l + (wet_l - dry_l) * self.mix) * gain,
            (dry_r + (wet_r - dry_r) * self.mix) * gain,
        )
    }

    pub fn take_meters(&mut self) -> MultibandMeters {
        std::mem::take(&mut self.meters)
    }
}
