//! The Pitch Shift's DSP: a delay-line pitch shifter. Two read taps sweep
//! across a window of recent input, half a window apart, each faded with a
//! Hann window that's silent where its sweep jumps back; reads use 4-point
//! Hermite interpolation, and feedback returns the output into the delay
//! line.
//!
//! `PitchShiftKernel` is a port of the worklet's processor
//! (`src/effects/pitch-shift/pitchShiftKernel.ts`, `DawnPitchShifter`) step
//! for step, held to it by `tests/pitch_shift_parity.rs`; its parameters
//! come as the AudioParams hold them (float32, within their ranges).
//! `PitchShifter` is the node around it (`pitchShifter.ts`): the dry signal
//! waits as long as the shifted one takes (exactly: the browser's delay
//! holds its time as a float32, a hair off), and Dry/Wet blends them
//! equal-power, as Web Audio's gains and sum do (in float32).

use std::f64::consts::PI;

use crate::params::ParamSource;

/// The delay line's length (frames), far above the longest window.
pub const BUFFER: usize = 65536;
const MASK: usize = BUFFER - 1;
/// The dry path's longest wait (s), as the node's delay allows.
const MAX_DRY: f64 = 0.5;
/// The block the node processes at a time (its scratch buffers' length).
const CHUNK: usize = 128;

/// The effect's settings, as it keeps its parameters.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PitchShiftSettings {
    /// Semitones.
    pub pitch: f64,
    /// Cents, added to `pitch`.
    pub fine: f64,
    /// The window the taps sweep (s).
    pub window: f64,
    pub feedback: f64,
    /// 0..1 dry/wet, equal-power.
    pub wet: f64,
}

impl PitchShiftSettings {
    pub fn from_params<P: ParamSource + ?Sized>(p: &P) -> Self {
        Self {
            pitch: p.param_or("pitch", 0.0),
            fine: p.param_or("fine", 0.0),
            window: p.param_or("window", 0.1),
            feedback: p.param_or("feedback", 0.0),
            wet: p.param_or("wet", 1.0),
        }
    }

    /// The playback ratio, as the node sets it.
    pub fn ratio(&self) -> f64 {
        2f64.powf((self.pitch + self.fine / 100.0) / 12.0)
    }

    /// Seconds the shifted signal lags its input (the node's `latency`): the
    /// taps sit half a window, plus the interpolator's 2 samples, behind.
    pub fn latency_seconds(&self, sample_rate: f64) -> f64 {
        (self.window * sample_rate) / 2.0 / sample_rate + 2.0 / sample_rate
    }

    /// The same in frames, to the nearest (for delay compensation).
    pub fn latency(&self, sample_rate: f64) -> usize {
        (self.latency_seconds(sample_rate) * sample_rate).round() as usize
    }
}

impl Default for PitchShiftSettings {
    fn default() -> Self {
        Self::from_params(&[] as &[(&str, f64)])
    }
}

/// An AudioParam's value: within its range, as a float32.
fn param(value: f64, min: f32, max: f32) -> f32 {
    (value as f32).clamp(min, max)
}

/// The processor's k-rate parameters, as its AudioParams hold them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShifterParams {
    pub ratio: f32,
    /// The window (s).
    pub window: f32,
    pub feedback: f32,
}

impl ShifterParams {
    /// What the node sets them to for these settings.
    pub fn new(s: &PitchShiftSettings) -> Self {
        Self {
            ratio: param(s.ratio(), 0.1, 8.0),
            window: param(s.window, 0.005, 0.5),
            feedback: param(s.feedback, 0.0, 0.95),
        }
    }
}

/// The worklet's processor.
pub struct PitchShiftKernel {
    sample_rate: f64,
    buffers: [Box<[f32]>; 2],
    last: [f64; 2],
    write: usize,
    phase: f64,
}

impl PitchShiftKernel {
    pub fn new(sample_rate: f64) -> Self {
        Self {
            sample_rate,
            buffers: [
                vec![0.0; BUFFER].into_boxed_slice(),
                vec![0.0; BUFFER].into_boxed_slice(),
            ],
            last: [0.0; 2],
            write: 0,
            phase: 0.0,
        }
    }

    /// 4-point Hermite interpolation of `buf` at `pos` (wrapping).
    fn read(buf: &[f32], pos: f64) -> f64 {
        let i = pos.floor();
        let f = pos - i;
        let i = i as i64;
        let at = |k: i64| buf[(k & MASK as i64) as usize] as f64;
        let (y0, y1, y2, y3) = (at(i - 1), at(i), at(i + 1), at(i + 2));
        let c1 = 0.5 * (y2 - y0);
        let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
        let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
        ((c3 * f + c2) * f + c1) * f + y1
    }

    /// One block of `in_l`/`in_r` (a missing right is the left, a missing
    /// left silence) into the outputs.
    pub fn process(
        &mut self,
        in_l: Option<&[f32]>,
        in_r: Option<&[f32]>,
        out_l: &mut [f32],
        out_r: &mut [f32],
        p: ShifterParams,
    ) {
        let n = out_l.len().min(out_r.len());
        for i in 0..n {
            let l = in_l.map(|b| b[i]);
            let r = in_r.map(|b| b[i]).or(l);
            let (yl, yr) = self.tick(l, r, p);
            out_l[i] = yl;
            out_r[i] = yr;
        }
    }

    /// As `process`, over a stereo block in place.
    pub fn process_in_place(&mut self, left: &mut [f32], right: &mut [f32], p: ShifterParams) {
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            (*l, *r) = self.tick(Some(*l), Some(*r), p);
        }
    }

    fn tick(&mut self, l: Option<f32>, r: Option<f32>, p: ShifterParams) -> (f32, f32) {
        let ratio = p.ratio as f64;
        let window_samples = p.window as f64 * self.sample_rate;
        let feedback = p.feedback as f64;
        let up = ratio >= 1.0;
        let step = (1.0 - ratio).abs() / window_samples;
        let pa = self.phase;
        let pb = if pa < 0.5 { pa + 0.5 } else { pa - 0.5 };
        let da = (if up { 1.0 - pa } else { pa }) * window_samples;
        let db = (if up { 1.0 - pb } else { pb }) * window_samples;
        let sa = (PI * pa).sin();
        let sb = (PI * pb).sin();
        let ga = sa * sa;
        let gb = sb * sb;
        let mut out = [0.0f32; 2];
        for (ch, src) in [l, r].into_iter().enumerate() {
            let buf = &mut self.buffers[ch];
            buf[self.write] = (src.map_or(0.0, |x| x as f64) + feedback * self.last[ch]) as f32;
            // 2 samples of headroom so the Hermite read never reaches
            // unwritten samples.
            let w = self.write as f64;
            let y = ga * Self::read(buf, w - da - 2.0) + gb * Self::read(buf, w - db - 2.0);
            self.last[ch] = y;
            out[ch] = y as f32;
        }
        self.write = (self.write + 1) & MASK;
        self.phase += step;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        (out[0], out[1])
    }
}

/// The node: the shifter, the dry path waiting as long as it, and the
/// Dry/Wet blend.
pub struct PitchShifter {
    sample_rate: f64,
    settings: PitchShiftSettings,
    kernel: PitchShiftKernel,
    /// The dry path's delay line, left and right.
    dry: [Box<[f32]>; 2],
    dry_at: usize,
    wet_l: [f32; CHUNK],
    wet_r: [f32; CHUNK],
}

impl PitchShifter {
    pub fn new(sample_rate: f64, settings: &PitchShiftSettings) -> Self {
        let len = (MAX_DRY * sample_rate) as usize + 4;
        Self {
            sample_rate,
            settings: *settings,
            kernel: PitchShiftKernel::new(sample_rate),
            dry: [
                vec![0.0; len].into_boxed_slice(),
                vec![0.0; len].into_boxed_slice(),
            ],
            dry_at: 0,
            wet_l: [0.0; CHUNK],
            wet_r: [0.0; CHUNK],
        }
    }

    pub fn set(&mut self, settings: &PitchShiftSettings) {
        self.settings = *settings;
    }

    /// The frames it delays its audio by (for delay compensation).
    pub fn latency(&self) -> usize {
        self.settings.latency(self.sample_rate)
    }

    /// Processes a stereo block in place.
    pub fn process_in_place(&mut self, left: &mut [f32], right: &mut [f32]) {
        let s = self.settings;
        let p = ShifterParams::new(&s);
        let dry_gain = (s.wet * PI / 2.0).cos() as f32;
        let wet_gain = (s.wet * PI / 2.0).sin() as f32;
        // The dry path waits exactly as long as the shifted signal (read
        // between samples linearly when that isn't a whole frame).
        let len = self.dry[0].len();
        let wait = (s.window * self.sample_rate / 2.0 + 2.0).clamp(0.0, (len - 2) as f64);
        let whole = wait.floor();
        let frac = (wait - whole) as f32;
        let whole = whole as usize;
        let n = left.len().min(right.len());
        let mut at = 0;
        while at < n {
            let m = (n - at).min(CHUNK);
            let (l, r) = (&mut left[at..at + m], &mut right[at..at + m]);
            self.kernel.process(
                Some(&*l),
                Some(&*r),
                &mut self.wet_l[..m],
                &mut self.wet_r[..m],
                p,
            );
            for i in 0..m {
                let mut dry = [0.0f32; 2];
                for (ch, x) in [l[i], r[i]].into_iter().enumerate() {
                    let line = &mut self.dry[ch];
                    line[self.dry_at] = x;
                    let a = line[(self.dry_at + len - whole) % len];
                    let b = line[(self.dry_at + len - whole - 1) % len];
                    dry[ch] = a + (b - a) * frac;
                }
                self.dry_at = (self.dry_at + 1) % len;
                l[i] = dry[0] * dry_gain + self.wet_l[i] * wet_gain;
                r[i] = dry[1] * dry_gain + self.wet_r[i] * wet_gain;
            }
            at += m;
        }
    }
}
