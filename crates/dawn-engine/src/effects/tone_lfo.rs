//! Tone.js's LFO (`Tone.LFO`), as Chromium runs its nodes, for the effects
//! the studio sweeps with one (the Chorus, the Filter).
//!
//! The LFO is an OscillatorNode through Tone's AudioToGain (a WaveShaper
//! taking -1..1 to 0..1) and its Scale (a gain and an offset, to min..max).
//! The oscillator reads a wave table, as Blink's `OscillatorHandler` and
//! `PeriodicWaveHandler` do: the tables are made from the wave's partials,
//! one per range of pitches with the partials that would alias left out,
//! and an LFO's slow rate reads them through a 5- or 3-point Lagrange
//! interpolation, or a linear one (the x86 path) when it runs faster. The
//! browser's tables come out of its FFT; ours are summed in f64, so the two
//! can differ in the last bit of a float.
//!
//! A table takes some time to make, so they're made off the audio thread
//! (`WaveTables::new`, kept for reuse) and the LFO only copies them in.

use std::f64::consts::PI;
use std::sync::{Arc, Mutex, OnceLock};

use super::wave_shaper::shape;

/// The LFO's waveform.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LfoShape {
    Sine,
    Triangle,
}

/// A wave: its shape, turned by Tone's `phase` (in degrees).
#[derive(Clone, Copy, Debug)]
pub struct LfoWave {
    pub shape: LfoShape,
    pub phase: f64,
}

impl PartialEq for LfoWave {
    fn eq(&self, other: &Self) -> bool {
        self.shape == other.shape && self.phase.to_bits() == other.phase.to_bits()
    }
}

/// Where the oscillator changes how it interpolates (`kInterpolate2Point`,
/// `kInterpolate3Point`): by its step through the table per sample.
const INTERPOLATE_2_POINT: f32 = 0.3;
const INTERPOLATE_3_POINT: f32 = 0.16;

/// Three ranges of pitches to the octave.
const CENTS_PER_RANGE: f32 = 400.0;

/// The partials Tone works out for a turned wave (its arrays' length).
const TONE_PARTIALS: usize = 2048;

/// The WaveShaper's curve (Tone's default length).
const CURVE_LENGTH: usize = 1024;

/// The table length at a sample rate (`GetPeriodicWaveSize`).
fn table_size(sample_rate: f64) -> usize {
    let sr = sample_rate as f32;
    if sr <= 24000.0 {
        2048
    } else if sr <= 88200.0 {
        4096
    } else {
        16384
    }
}

/// How the oscillator scales a frequency to a step through the table, and
/// back; the lowest frequency the first range is for; how many ranges.
fn rates(size: usize, sample_rate: f64) -> (f32, f32, f32, usize) {
    let sr = sample_rate as f32;
    let rate_scale = size as f32 / sr;
    let ranges = (3.0 * (size as f32).log2()).round() as usize;
    (rate_scale, 1.0 / rate_scale, sr / size as f32, ranges)
}

/// The two ranges a frequency reads, and how far it is from the first to
/// the second (`WaveDataForFundamentalFrequency`, the x86 version).
fn wave_data(frequency: f32, lowest: f32, ranges: usize) -> (usize, usize, f32) {
    let f = frequency.abs();
    let ratio = if f > 0.0 { f / lowest } else { 0.5 };
    let cents = ratio.log2() * 1200.0;
    let top = (ranges - 1) as f32;
    let pitch_range = (1.0 + cents / CENTS_PER_RANGE).max(0.0).min(top);
    let i1 = pitch_range as usize;
    let i2 = ((i1 + 1) as f32).min(top) as usize;
    (i1, i2, pitch_range - i1 as f32)
}

/// The wave's partials, as the oscillator gets them: the browser's own
/// waveform when it isn't turned (`GenerateBasicWaveform`, in float32),
/// Tone's otherwise (`_getRealImaginary`).
fn partials(wave: LfoWave, half: usize) -> (Vec<f32>, Vec<f32>) {
    let mut real = vec![0.0f32; half];
    let mut imag = vec![0.0f32; half];
    let odd_sign = |n: usize| if ((n - 1) >> 1) & 1 == 1 { -1.0 } else { 1.0 };
    let odd_sign_f32 = |n: usize| odd_sign(n) as f32;
    if wave.phase == 0.0 {
        for (n, im) in imag.iter_mut().enumerate().skip(1) {
            let pi_factor = 2.0f32 / (n as f32 * std::f32::consts::PI);
            *im = match wave.shape {
                LfoShape::Sine if n == 1 => 1.0,
                LfoShape::Triangle if n & 1 == 1 => 2.0 * (pi_factor * pi_factor) * odd_sign_f32(n),
                _ => 0.0,
            };
        }
    } else {
        let phase = (wave.phase * PI) / 180.0;
        for n in 1..TONE_PARTIALS.min(half) {
            let pi_factor = 2.0 / (n as f64 * PI);
            let b = match wave.shape {
                LfoShape::Sine if n <= 1 => 1.0,
                LfoShape::Triangle if n & 1 == 1 => 2.0 * (pi_factor * pi_factor) * odd_sign(n),
                _ => 0.0,
            };
            if b != 0.0 {
                real[n] = (-b * (phase * n as f64).sin()) as f32;
                imag[n] = (b * (phase * n as f64).cos()) as f32;
            }
        }
    }
    (real, imag)
}

/// One range's table, before it's normalised (`CreateBandLimitedTables`):
/// the partials below the range's cut-off, summed.
fn raw_table(real: &[f32], imag: &[f32], size: usize, range: usize) -> Vec<f32> {
    let half = size / 2;
    let cents = range as f32 * CENTS_PER_RANGE;
    let culling = 2f64.powf((-cents / 1200.0) as f64) as f32;
    let kept = (culling * half as f32) as usize;
    let end = real.len().min(kept + 1);
    let sin: Vec<f64> = (0..size)
        .map(|j| (2.0 * PI * j as f64 / size as f64).sin())
        .collect();
    let (mask, quarter) = (size - 1, size / 4);
    let mut sum = vec![0.0f64; size];
    for n in 1..end {
        let (a, b) = (real[n] as f64, imag[n] as f64);
        if a == 0.0 && b == 0.0 {
            continue;
        }
        for (k, s) in sum.iter_mut().enumerate() {
            let j = (n * k) & mask;
            *s += a * sin[(j + quarter) & mask] + b * sin[j];
        }
    }
    sum.into_iter().map(|x| x as f32).collect()
}

/// A wave's tables made so far, at one table length: the scale that
/// normalises them (from the first range's peak) and the ranges.
struct Made {
    wave: LfoWave,
    size: usize,
    scale: f32,
    ranges: Vec<(usize, Arc<[f32]>)>,
}

/// The tables made so far, the latest last.
fn made() -> &'static Mutex<Vec<Made>> {
    static MADE: OnceLock<Mutex<Vec<Made>>> = OnceLock::new();
    MADE.get_or_init(|| Mutex::new(Vec::new()))
}

/// How many waves' tables to keep.
const KEEP: usize = 32;

/// A range's table for a wave, made or kept.
fn table(wave: LfoWave, size: usize, range: usize) -> Arc<[f32]> {
    let mut made = made().lock().unwrap_or_else(|e| e.into_inner());
    let at = match made.iter().position(|m| m.wave == wave && m.size == size) {
        Some(i) => i,
        None => {
            let (real, imag) = partials(wave, size / 2);
            let first = raw_table(&real, &imag, size, 0);
            let peak = first.iter().fold(0.0f32, |m, x| m.max(x.abs()));
            let scale = if peak != 0.0 { 1.0 / peak } else { 0.5 };
            let first: Arc<[f32]> = first.iter().map(|x| x * scale).collect();
            if made.len() == KEEP {
                made.remove(0);
            }
            made.push(Made {
                wave,
                size,
                scale,
                ranges: vec![(0, first)],
            });
            made.len() - 1
        }
    };
    if let Some((_, t)) = made[at].ranges.iter().find(|(r, _)| *r == range) {
        return t.clone();
    }
    let (real, imag) = partials(wave, size / 2);
    let scale = made[at].scale;
    let t: Arc<[f32]> = raw_table(&real, &imag, size, range)
        .iter()
        .map(|x| x * scale)
        .collect();
    made[at].ranges.push((range, t.clone()));
    t
}

/// What Tone sets an LFO's stopped signal to when its type or phase
/// changes (`_setStoppedValue`, from `getInitialValue`): the wave's value
/// at its phase, negated, over its peak. Tone means it for a stopped LFO,
/// but sets it while one runs too, where it adds to the wave.
pub fn initial_value(wave: LfoWave) -> f32 {
    // Tone's partials, unturned (`_getRealImaginary(type, 0)`): only sines.
    let imag: Vec<f32> = (0..TONE_PARTIALS)
        .map(|n| match wave.shape {
            LfoShape::Sine if n == 1 => 1.0,
            LfoShape::Triangle if n & 1 == 1 => {
                let pi_factor = 2.0 / (n as f64 * PI);
                let sign = if ((n - 1) >> 1) & 1 == 1 { -1.0 } else { 1.0 };
                (2.0 * (pi_factor * pi_factor) * sign) as f32
            }
            _ => 0.0,
        })
        .collect();
    // `_inverseFFT` (the cosines' partials are all 0).
    let at = |phase: f64| {
        imag.iter().enumerate().fold(0.0, |sum, (i, b)| {
            sum + (0.0 * (i as f64 * phase).cos() + *b as f64 * (i as f64 * phase).sin())
        })
    };
    let peak = (0..32).fold(0.0f64, |m, i| m.max(at((i as f64 / 32.0) * (PI * 2.0))));
    (-at((wave.phase * PI) / 180.0) / peak).clamp(-1.0, 1.0) as f32
}

/// The two tables an LFO with this wave reads at this rate.
#[derive(Clone)]
pub struct WaveTables {
    wave: LfoWave,
    ranges: (usize, usize),
    /// The first range's (with more partials).
    higher: Arc<[f32]>,
    lower: Arc<[f32]>,
}

impl WaveTables {
    /// Makes them, or finds them made (not on the audio thread).
    pub fn new(wave: LfoWave, rate: f64, sample_rate: f64) -> Self {
        let size = table_size(sample_rate);
        let (rate_scale, inv_rate_scale, lowest, ranges) = rates(size, sample_rate);
        let frequency = inv_rate_scale * (rate as f32 * rate_scale);
        let (i1, i2, _) = wave_data(frequency, lowest, ranges);
        Self {
            wave,
            ranges: (i1, i2),
            higher: table(wave, size, i1),
            lower: table(wave, size, i2),
        }
    }
}

impl std::fmt::Debug for WaveTables {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WaveTables")
            .field("wave", &self.wave)
            .field("ranges", &self.ranges)
            .finish()
    }
}

impl PartialEq for WaveTables {
    fn eq(&self, other: &Self) -> bool {
        self.wave == other.wave && self.ranges == other.ranges
    }
}

/// A running LFO.
pub struct ToneLfo {
    size: usize,
    rate_scale: f32,
    inv_rate_scale: f32,
    lowest: f32,
    ranges: usize,
    nyquist: f32,
    /// The wave and ranges `higher` and `lower` hold.
    loaded: Option<(LfoWave, (usize, usize))>,
    higher: Box<[f32]>,
    lower: Box<[f32]>,
    curve: Box<[f32]>,
    /// The oscillator's step through the table per sample.
    incr: f32,
    /// Tone's stopped signal, added to the wave (see `initial_value`).
    offset: f32,
    /// The Scale's gain and offset.
    mult: f32,
    add: f32,
    /// Where the oscillator is in its table.
    index: f64,
    /// It renders four samples at a time, as the browser's does.
    group: [f32; 4],
    next: usize,
}

impl ToneLfo {
    /// An LFO started at phase 0, sweeping 0 to 1 at 1 Hz until set.
    pub fn new(sample_rate: f64) -> Self {
        let size = table_size(sample_rate);
        let (rate_scale, inv_rate_scale, lowest, ranges) = rates(size, sample_rate);
        // Tone's AudioToGain mapping, -1..1 to 0..1.
        let curve = (0..CURVE_LENGTH)
            .map(|i| {
                let normalized = (i as f64 / (CURVE_LENGTH - 1) as f64) * 2.0 - 1.0;
                ((normalized + 1.0) / 2.0) as f32
            })
            .collect();
        Self {
            size,
            rate_scale,
            inv_rate_scale,
            lowest,
            ranges,
            nyquist: sample_rate as f32 / 2.0,
            loaded: None,
            higher: vec![0.0; size].into_boxed_slice(),
            lower: vec![0.0; size].into_boxed_slice(),
            curve,
            incr: rate_scale,
            offset: 0.0,
            mult: 1.0,
            add: 0.0,
            index: 0.0,
            group: [0.0; 4],
            next: 4,
        }
    }

    /// Its tables (copied in, on the audio thread, only when they change).
    pub fn set_wave(&mut self, tables: &WaveTables) {
        let key = (tables.wave, tables.ranges);
        if self.loaded == Some(key) || tables.higher.len() != self.size {
            return;
        }
        self.higher.copy_from_slice(&tables.higher);
        self.lower.copy_from_slice(&tables.lower);
        self.loaded = Some(key);
    }

    /// Its rate, in Hz (the frequency signal, float32).
    pub fn set_rate(&mut self, hz: f64) {
        self.incr = (hz as f32).clamp(-self.nyquist, self.nyquist) * self.rate_scale;
    }

    /// Tone's stopped signal (see `initial_value`).
    pub fn set_offset(&mut self, x: f32) {
        self.offset = x;
    }

    /// What it sweeps between (Tone's `min` and `max`).
    pub fn set_range(&mut self, min: f64, max: f64) {
        self.mult = (max - min) as f32;
        self.add = min as f32;
    }

    /// Its next value.
    #[inline]
    pub fn next_value(&mut self) -> f32 {
        if self.next == 4 {
            self.render_group();
            self.next = 0;
        }
        let x = self.group[self.next] + self.offset;
        self.next += 1;
        shape(&self.curve, x) * self.mult + self.add
    }

    /// The oscillator's next four samples (`ProcessARateVector`).
    fn render_group(&mut self) {
        let n = self.size as f64;
        let inv = 1.0 / n;
        let mask = self.size - 1;
        let incr = self.incr;
        let frequency = self.inv_rate_scale * incr;
        let (_, _, factor) = wave_data(frequency, self.lowest, self.ranges);
        if incr.abs() >= INTERPOLATE_2_POINT {
            // `ProcessARateVectorKernel`, the x86 version.
            let step = incr as f64;
            let mut sum = [step; 4];
            for m in 1..4 {
                sum[m] = sum[m - 1] + step;
            }
            for m in 0..4 {
                let mut x = if m == 0 {
                    self.index
                } else {
                    self.index + sum[m - 1]
                };
                x -= (x * inv).floor() * n;
                let i = x as i32;
                let f = x as f32 - i as f32;
                let (i0, i1) = (i as usize & mask, (i as usize + 1) & mask);
                let (h, l) = (&self.higher, &self.lower);
                let high = h[i0] + f * (h[i1] - h[i0]);
                let low = l[i0] + f * (l[i1] - l[i0]);
                self.group[m] = high + factor * (low - high);
            }
            self.index += sum[3];
        } else {
            for m in 0..4 {
                self.group[m] = self.interpolate(incr.abs(), factor);
                self.index += incr as f64;
                self.index -= (self.index * inv).floor() * n;
            }
            return;
        }
        self.index -= (self.index * inv).floor() * n;
    }

    /// One sample through a 3- or 5-point Lagrange interpolation
    /// (`DoInterpolation`).
    fn interpolate(&self, incr: f32, factor: f32) -> f32 {
        let mask = self.size - 1;
        let i0 = self.index as u32 as usize;
        let t = self.index - i0 as f64;
        let (mut low, mut high) = (0.0f64, 0.0f64);
        let mut add = |a: &[f64], back: usize| {
            for (k, a) in a.iter().enumerate() {
                let j = (i0 + k).wrapping_sub(back) & mask;
                low += a * self.lower[j] as f64;
                high += a * self.higher[j] as f64;
            }
        };
        if incr >= INTERPOLATE_3_POINT {
            add(&[0.5 * t * (t - 1.0), 1.0 - t * t, 0.5 * t * (t + 1.0)], 1);
        } else {
            let t2 = t * t;
            add(
                &[
                    t * (t2 - 1.0) * (t - 2.0) / 24.0,
                    -t * (t - 1.0) * (t2 - 4.0) / 6.0,
                    (t2 - 1.0) * (t2 - 4.0) / 4.0,
                    -t * (t + 1.0) * (t2 - 4.0) / 6.0,
                    t * (t2 - 1.0) * (t + 2.0) / 24.0,
                ],
                2,
            );
        }
        ((1.0 - factor) as f64 * high + factor as f64 * low) as f32
    }
}
