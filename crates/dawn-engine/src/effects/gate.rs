//! The Noise Gate's DSP.
//!
//! Port of `src/effects/gate/gateModel.ts` (`NoiseGateKernel`) and
//! `gateSettingsFromParams` (noiseGate.ts), step for step;
//! `tests/gate_parity.rs` holds the port to what the JavaScript renders.
//!
//! Detection: a stereo-linked peak follower on the key signal (instant
//! rise, 20 ms fall). The gate opens when that level rises above the
//! threshold and only starts closing once it falls `HYSTERESIS_DB` below
//! it; Hold keeps it open a little longer, then the gain fades down over
//! Release to Range (-80 dB is silence). Opening fades up over Attack. No
//! lookahead, so no latency.

use crate::effects::sidechain::{KeyFilter, KeySettings};
use crate::instruments::js_round;
use crate::params::ParamSource;

pub const HYSTERESIS_DB: f64 = 4.0;

/// The kernel's settings (`GateKernelSettings`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GateSettings {
    pub key: KeySettings,
    pub threshold_db: f64,
    /// Seconds.
    pub attack: f64,
    pub hold: f64,
    pub release: f64,
    /// dB of reduction when closed, <= 0.
    pub range_db: f64,
}

impl GateSettings {
    /// The settings for the effect's parameters; `external` is whether a
    /// sidechain source is connected. A parameter that isn't there takes
    /// its default (`index.ts`).
    pub fn from_params<P: ParamSource + ?Sized>(p: &P, external: bool) -> Self {
        Self {
            key: KeySettings::from_params(p, external),
            threshold_db: p.param_or("threshold", -60.0),
            attack: p.param_or("attack", 0.001),
            hold: p.param_or("hold", 0.05),
            release: p.param_or("release", 0.15),
            range_db: p.param_or("range", -80.0),
        }
    }
}

impl Default for GateSettings {
    fn default() -> Self {
        Self::from_params(&[] as &[(&str, f64)], false)
    }
}

/// The loudest key sample in a block (what the threshold is compared
/// with) and the lowest gain applied.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GateBlock {
    pub peak_in: f64,
    pub min_gain: f64,
}

pub struct GateKernel {
    sr: f64,
    level: f64,
    gain: f64,
    open: bool,
    hold_left: f64,
    detector_fall: f64,
    key: KeyFilter,
    external: bool,
    listen: bool,
    open_at: f64,
    close_at: f64,
    attack_coef: f64,
    release_coef: f64,
    hold_samples: f64,
    floor: f64,
}

impl GateKernel {
    pub fn new(sample_rate: f64, settings: &GateSettings) -> Self {
        let mut k = Self {
            sr: sample_rate,
            level: 0.0,
            gain: 0.0,
            open: false,
            hold_left: 0.0,
            detector_fall: (-1.0 / (0.02 * sample_rate)).exp(),
            key: KeyFilter::new(sample_rate),
            external: false,
            listen: false,
            open_at: 0.0,
            close_at: 0.0,
            attack_coef: 0.0,
            release_coef: 0.0,
            hold_samples: 0.0,
            floor: 0.0,
        };
        // As the worklet: made with the defaults (starting closed at their
        // floor), then given its settings.
        k.set(&GateSettings::default());
        k.gain = k.floor;
        k.set(settings);
        k
    }

    pub fn set(&mut self, s: &GateSettings) {
        let sr = self.sr;
        self.open_at = 10f64.powf(s.threshold_db / 20.0);
        self.close_at = 10f64.powf((s.threshold_db - HYSTERESIS_DB) / 20.0);
        self.attack_coef = 1.0 - (-1.0 / (s.attack.max(0.00005) * sr)).exp();
        self.release_coef = 1.0 - (-1.0 / (s.release.max(0.001) * sr)).exp();
        self.hold_samples = js_round(s.hold.max(0.0) * sr);
        self.floor = if s.range_db <= -80.0 {
            0.0
        } else {
            10f64.powf(s.range_db.min(0.0) / 20.0)
        };
        self.external = s.key.external;
        self.listen = s.key.listen;
        self.key.set(&s.key);
    }

    pub fn is_open(&self) -> bool {
        self.open
    }

    /// Gates `out_l.len()` frames of `in_l`/`in_r` (a missing left is
    /// silence, a missing right the left) into the outputs; `key_l`/`key_r`
    /// is the sidechain, used while the settings say `external`.
    pub fn process(
        &mut self,
        in_l: Option<&[f32]>,
        in_r: Option<&[f32]>,
        out_l: &mut [f32],
        mut out_r: Option<&mut [f32]>,
        key_l: Option<&[f32]>,
        key_r: Option<&[f32]>,
    ) -> GateBlock {
        let mut block = GateBlock {
            peak_in: 0.0,
            min_gain: 1.0,
        };
        for i in 0..out_l.len() {
            let l = in_l.map_or(0.0, |b| b[i] as f64);
            let r = in_r.map_or(l, |b| b[i] as f64);
            let (kl, kr) = if self.external {
                let kl = key_l.map_or(0.0, |b| b[i] as f64);
                (kl, key_r.map_or(kl, |b| b[i] as f64))
            } else {
                (l, r)
            };
            let (yl, yr) = self.tick(l, r, kl, kr, &mut block);
            out_l[i] = yl as f32;
            if let Some(o) = out_r.as_mut() {
                o[i] = yr as f32;
            }
        }
        block
    }

    /// As `process`, over its stereo input, keyed by it.
    pub fn process_in_place(&mut self, left: &mut [f32], right: &mut [f32]) -> GateBlock {
        let mut block = GateBlock {
            peak_in: 0.0,
            min_gain: 1.0,
        };
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let (x, y) = (*l as f64, *r as f64);
            let (yl, yr) = self.tick(x, y, x, y, &mut block);
            *l = yl as f32;
            *r = yr as f32;
        }
        block
    }

    fn tick(&mut self, l: f64, r: f64, kl: f64, kr: f64, block: &mut GateBlock) -> (f64, f64) {
        let kl = self.key.run(kl, 0);
        let kr = self.key.run(kr, 1);
        let x = kl.abs().max(kr.abs());
        if x > block.peak_in {
            block.peak_in = x;
        }
        self.level = if x > self.level {
            x
        } else {
            self.level * self.detector_fall
        };

        if self.level >= self.open_at {
            self.open = true;
            self.hold_left = self.hold_samples;
        } else if self.open && self.level < self.close_at {
            if self.hold_left > 0.0 {
                self.hold_left -= 1.0;
            } else {
                self.open = false;
            }
        }

        let target = if self.open { 1.0 } else { self.floor };
        self.gain += (target - self.gain)
            * if target > self.gain {
                self.attack_coef
            } else {
                self.release_coef
            };
        if self.gain < block.min_gain {
            block.min_gain = self.gain;
        }
        if self.listen {
            (kl, kr)
        } else {
            (l * self.gain, r * self.gain)
        }
    }
}
