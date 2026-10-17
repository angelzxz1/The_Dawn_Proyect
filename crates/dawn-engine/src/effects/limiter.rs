//! The Limiter's DSP: a true brick-wall lookahead limiter, which also
//! guards the master output.
//!
//! Port of the `DawnLookaheadLimiter` processor in
//! `src/effects/limiter/lookaheadLimiter.ts`, step for step;
//! `tests/limiter_parity.rs` holds the port to what the JavaScript renders.
//!
//! Input gain first, then (optionally) a soft clipper. The audio is delayed
//! by the lookahead; for each sample the gain needed to keep it under the
//! ceiling is held (a sliding minimum) across the lookahead window,
//! released over the Release time, then box-averaged over that same window,
//! so the gain has already ramped down when the peak reaches the output and
//! the ceiling is never exceeded.

use std::f64::consts::SQRT_2;

/// Seconds the lookahead delays the audio.
pub const LOOKAHEAD: f64 = 0.005;
/// How often (frames) the meters are read.
pub const METER_INTERVAL: usize = 2048;

/// The processor's parameters (its AudioParams), as linear values.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LimiterSettings {
    /// Linear, 0.00001 to 1.
    pub ceiling: f64,
    /// Linear input gain.
    pub gain: f64,
    /// Seconds.
    pub release: f64,
    pub soft_clip: bool,
}

impl LimiterSettings {
    /// The settings the effect's parameters make (dB, as the studio keeps
    /// them; `src/effects/limiter/audio.ts`).
    pub fn from_db(ceiling_db: f64, gain_db: f64, release: f64, soft_clip: bool) -> Self {
        Self {
            ceiling: 10f64.powf(ceiling_db / 20.0),
            gain: 10f64.powf(gain_db / 20.0),
            release,
            soft_clip,
        }
    }
}

/// The meters over the last interval: the peak input (after the gain), the
/// peak output, and the deepest gain (soft clip's share included).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LimiterMeters {
    pub input: f64,
    pub output: f64,
    pub reduction: f64,
}

fn soft_clip(x: f64, ceiling: f64) -> f64 {
    let a = x.abs();
    let knee = 0.5 * ceiling;
    if a <= knee {
        return x;
    }
    let span = SQRT_2 * ceiling - knee;
    let y = knee + span * ((a - knee) / span).tanh();
    if x < 0.0 { -y } else { y }
}

pub struct Limiter {
    sample_rate: f64,
    settings: LimiterSettings,
    size: usize,
    delay_l: Vec<f32>,
    delay_r: Vec<f32>,
    box_: Vec<f64>,
    box_sum: f64,
    dq_val: Vec<f64>,
    dq_idx: Vec<f64>,
    dq_head: usize,
    dq_len: usize,
    pos: usize,
    n: f64,
    env: f64,
    release: f64,
    release_coef: f64,
    meter_in: f64,
    meter_out: f64,
    meter_gain: f64,
    meter_count: usize,
    meters: Option<LimiterMeters>,
}

impl Limiter {
    pub fn new(sample_rate: f64, settings: LimiterSettings) -> Self {
        let size = ((sample_rate * LOOKAHEAD + 0.5).floor() as usize + 1).max(2);
        Self {
            sample_rate,
            settings,
            size,
            delay_l: vec![0.0; size],
            delay_r: vec![0.0; size],
            box_: vec![1.0; size],
            box_sum: size as f64,
            dq_val: vec![0.0; size],
            dq_idx: vec![0.0; size],
            dq_head: 0,
            dq_len: 0,
            pos: 0,
            n: 0.0,
            env: 1.0,
            release: -1.0,
            release_coef: 0.0,
            meter_in: 0.0,
            meter_out: 0.0,
            meter_gain: 1.0,
            meter_count: 0,
            meters: None,
        }
    }

    /// The frames the lookahead delays the audio by.
    pub fn latency_frames(&self) -> usize {
        (self.sample_rate * LOOKAHEAD + 0.5).floor() as usize
    }

    pub fn set(&mut self, settings: LimiterSettings) {
        self.settings = settings;
    }

    pub fn settings(&self) -> LimiterSettings {
        self.settings
    }

    /// The meters from the last full interval, once (None until the next).
    pub fn take_meters(&mut self) -> Option<LimiterMeters> {
        self.meters.take()
    }

    /// Limits `in_l`/`in_r` (a missing right channel is the left's) into
    /// the outputs, `n` frames. The parameters are read once per call, as
    /// the worklet reads its k-rate parameters once per block.
    pub fn process(
        &mut self,
        in_l: Option<&[f32]>,
        in_r: Option<&[f32]>,
        out_l: &mut [f32],
        mut out_r: Option<&mut [f32]>,
        n: usize,
    ) {
        let in_r = in_r.or(in_l);
        let LimiterSettings {
            ceiling,
            gain: drive,
            release,
            soft_clip: clip,
        } = self.settings;
        if release != self.release {
            self.release = release;
            self.release_coef = 1.0 - (-1.0 / (release * self.sample_rate)).exp();
        }
        let size = self.size;

        for i in 0..n {
            let mut xl = in_l.map_or(0.0, |a| a[i] as f64) * drive;
            let mut xr = in_r.map_or(0.0, |a| a[i] as f64) * drive;
            let in_peak = xl.abs().max(xr.abs());
            if in_peak > self.meter_in {
                self.meter_in = in_peak;
            }
            if clip {
                xl = soft_clip(xl, ceiling);
                xr = soft_clip(xr, ceiling);
            }
            let peak = xl.abs().max(xr.abs());
            let required = if peak > ceiling { ceiling / peak } else { 1.0 };

            while self.dq_len > 0 {
                let tail = (self.dq_head + self.dq_len - 1) % size;
                if self.dq_val[tail] >= required {
                    self.dq_len -= 1;
                } else {
                    break;
                }
            }
            let slot = (self.dq_head + self.dq_len) % size;
            self.dq_val[slot] = required;
            self.dq_idx[slot] = self.n;
            self.dq_len += 1;
            while self.dq_idx[self.dq_head] <= self.n - size as f64 {
                self.dq_head = (self.dq_head + 1) % size;
                self.dq_len -= 1;
            }
            let held = self.dq_val[self.dq_head];

            self.env = if held < self.env {
                held
            } else {
                self.env + (held - self.env) * self.release_coef
            };

            let p = self.pos;
            self.box_sum += self.env - self.box_[p];
            self.box_[p] = self.env;
            let gain = self.box_sum / size as f64;
            if gain < self.meter_gain {
                self.meter_gain = gain;
            }

            // The delay line holds Float32Array samples.
            self.delay_l[p] = xl as f32;
            self.delay_r[p] = xr as f32;
            let read = (p + 1) % size;
            let yl = self.delay_l[read] as f64 * gain;
            let yr = self.delay_r[read] as f64 * gain;
            out_l[i] = yl as f32;
            if let Some(out_r) = out_r.as_deref_mut() {
                out_r[i] = yr as f32;
            }
            let out_peak = yl.abs().max(yr.abs());
            if out_peak > self.meter_out {
                self.meter_out = out_peak;
            }

            self.pos = read;
            self.n += 1.0;
            if read == 0 {
                self.box_sum = self.box_.iter().sum();
            }
        }

        self.meter_count += n;
        if self.meter_count >= METER_INTERVAL {
            let clipped = if clip && self.meter_in > 0.0 {
                soft_clip(self.meter_in, ceiling) / self.meter_in
            } else {
                1.0
            };
            self.meters = Some(LimiterMeters {
                input: self.meter_in,
                output: self.meter_out,
                reduction: self.meter_gain * clipped,
            });
            self.meter_in = 0.0;
            self.meter_out = 0.0;
            self.meter_gain = 1.0;
            self.meter_count = 0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_lets_a_peak_past_the_ceiling() {
        let sr = 48000.0;
        let mut lim = Limiter::new(sr, LimiterSettings::from_db(-1.0, 0.0, 0.1, false));
        let ceiling = 10f32.powf(-1.0 / 20.0);
        let n = 4800;
        let input: Vec<f32> = (0..n)
            .map(|i| {
                if i % 600 == 0 {
                    1.8
                } else {
                    0.5 * ((i as f32) * 0.05).sin()
                }
            })
            .collect();
        let mut out = vec![0.0; n];
        lim.process(Some(&input), None, &mut out, None, n);
        assert!(out.iter().all(|x| x.abs() <= ceiling + 1e-6));
        // Delayed by the lookahead: 240 frames at 48 kHz.
        assert_eq!(lim.latency_frames(), 240);
    }
}
