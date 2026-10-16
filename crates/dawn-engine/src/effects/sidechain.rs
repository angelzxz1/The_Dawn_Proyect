//! What the dynamics effects' detectors listen to: the key signal's gain and
//! its low-cut / high-cut filter pair ("sidechain EQ"), shared by the
//! Compressor, Noise Gate and Multiband Compressor.
//!
//! Port of `src/effects/sidechain/sidechainModel.ts` (`KeyFilter`,
//! `keySettingsFromParams`).

use std::f64::consts::{FRAC_1_SQRT_2, PI};

use crate::params::ParamSource;

/// A low cut at or below this (Hz, plus half a hertz) is off.
pub const SC_HPF_OFF: f64 = 20.0;
/// A high cut at or above this (Hz, less one hertz) is off.
pub const SC_LPF_OFF: f64 = 20000.0;

/// The key signal's settings, as the kernels take them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct KeySettings {
    /// Detect from the key input (true) or the effect's own input.
    pub external: bool,
    pub sc_gain_db: f64,
    /// Hz.
    pub sc_hpf: f64,
    /// Hz.
    pub sc_lpf: f64,
    /// Output the filtered key signal instead of the processed audio.
    pub listen: bool,
}

impl KeySettings {
    /// The settings for an effect's parameters (`scGain`, `scHpf`, `scLpf`,
    /// `scListen`); `external` is whether a sidechain source is connected.
    pub fn from_params<P: ParamSource + ?Sized>(params: &P, external: bool) -> Self {
        Self {
            external,
            sc_gain_db: params.param_or("scGain", 0.0),
            sc_hpf: params.param_or("scHpf", SC_HPF_OFF),
            sc_lpf: params.param_or("scLpf", SC_LPF_OFF),
            listen: params.param_or("scListen", 0.0) >= 0.5,
        }
    }
}

/// A biquad's coefficients, normalized: b0, b1, b2, a1, a2.
type Coefs = [f64; 5];

#[derive(Clone, Copy)]
enum Cut {
    Low,
    High,
}

/// A 12 dB/oct (Q = 1/√2) low cut or high cut at `freq` Hz.
fn key_biquad(cut: Cut, freq: f64, sr: f64) -> Coefs {
    let w0 = (2.0 * PI * freq.min(sr * 0.45)) / sr;
    let cos = w0.cos();
    let alpha = w0.sin() / (2.0 * FRAC_1_SQRT_2);
    let a0 = 1.0 + alpha;
    let (b0, b1) = match cut {
        Cut::Low => ((1.0 + cos) / 2.0, -(1.0 + cos)),
        Cut::High => ((1.0 - cos) / 2.0, 1.0 - cos),
    };
    [
        b0 / a0,
        b1 / a0,
        b0 / a0,
        (-2.0 * cos) / a0,
        (1.0 - alpha) / a0,
    ]
}

/// A stereo low cut + high cut with a gain, bypassed entirely while both
/// filters are off.
#[derive(Clone, Debug)]
pub struct KeyFilter {
    sr: f64,
    hp: Option<Coefs>,
    lp: Option<Coefs>,
    gain: f64,
    active: bool,
    /// Per channel: low cut z1, z2, high cut z1, z2.
    state: [f64; 8],
}

impl KeyFilter {
    pub fn new(sample_rate: f64) -> Self {
        Self {
            sr: sample_rate,
            hp: None,
            lp: None,
            gain: 1.0,
            active: false,
            state: [0.0; 8],
        }
    }

    pub fn set(&mut self, s: &KeySettings) {
        self.hp = (s.sc_hpf > SC_HPF_OFF + 0.5).then(|| key_biquad(Cut::Low, s.sc_hpf, self.sr));
        self.lp = (s.sc_lpf < SC_LPF_OFF - 1.0).then(|| key_biquad(Cut::High, s.sc_lpf, self.sr));
        // As the JavaScript's `(s.scGainDb || 0)`: NaN counts as 0 dB.
        let gain_db = if s.sc_gain_db.is_nan() {
            0.0
        } else {
            s.sc_gain_db
        };
        self.gain = 10f64.powf(gain_db / 20.0);
        let was_active = self.active;
        self.active = self.hp.is_some() || self.lp.is_some();
        if !was_active && self.active {
            self.state = [0.0; 8];
        }
    }

    /// One sample of channel `ch` (0 or 1).
    #[inline]
    pub fn run(&mut self, x: f64, ch: usize) -> f64 {
        if !self.active {
            return x * self.gain;
        }
        debug_assert!(ch < 2);
        let s = &mut self.state;
        let o = ch * 4;
        let mut y = x;
        if let Some(c) = self.hp {
            let v = c[0] * y + s[o];
            s[o] = c[1] * y - c[3] * v + s[o + 1];
            s[o + 1] = c[2] * y - c[4] * v;
            y = v;
        }
        if let Some(c) = self.lp {
            let v = c[0] * y + s[o + 2];
            s[o + 2] = c[1] * y - c[3] * v + s[o + 3];
            s[o + 3] = c[2] * y - c[4] * v;
            y = v;
        }
        y * self.gain
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(sc_gain_db: f64, sc_hpf: f64, sc_lpf: f64) -> KeySettings {
        KeySettings {
            external: false,
            sc_gain_db,
            sc_hpf,
            sc_lpf,
            listen: false,
        }
    }

    #[test]
    fn missing_params_mean_off() {
        let s = KeySettings::from_params(&[] as &[(&str, f64)], true);
        assert_eq!(
            s,
            KeySettings {
                external: true,
                ..settings(0.0, SC_HPF_OFF, SC_LPF_OFF)
            }
        );
    }

    #[test]
    fn filters_off_is_just_the_gain() {
        let mut f = KeyFilter::new(48000.0);
        f.set(&settings(6.0, SC_HPF_OFF, SC_LPF_OFF));
        let g = 10f64.powf(6.0 / 20.0);
        assert_eq!(f.run(0.5, 0), 0.5 * g);
        assert_eq!(f.run(-0.25, 1), -0.25 * g);
    }

    #[test]
    fn low_cut_blocks_dc() {
        let mut f = KeyFilter::new(48000.0);
        f.set(&settings(0.0, 200.0, SC_LPF_OFF));
        let mut y = 1.0;
        for _ in 0..48000 {
            y = f.run(1.0, 0);
        }
        assert!(y.abs() < 1e-9, "DC left after a second: {y}");
    }
}
