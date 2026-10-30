//! The EQ Three.
//!
//! Port of the studio's node (Tone.js's `EQ3`, built in
//! `src/effects/eq-three/audio.ts`): the input split into three bands by
//! BiquadFilterNodes, as Chromium runs them (`biquad_node.rs`), each with
//! its own gain, and summed. Low is a low pass at the low crossover; mid a
//! high pass there into a low pass at the high crossover; high a high pass
//! at the high crossover. Each filter is 12 dB per octave with a Q of 1 dB
//! (Tone's `MultibandSplit`). `tests/eq_three_parity.rs` holds the port to
//! what Chromium renders. No latency.

use super::biquad_node::{BiquadState, BiquadType, Coefs};
use crate::params::ParamSource;

/// The split's Q (dB, as the node reads a low or high pass's).
const Q: f32 = 1.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EqThreeSettings {
    /// The bands' gains, in dB.
    pub low: f64,
    pub mid: f64,
    pub high: f64,
    /// The crossovers, in Hz.
    pub low_frequency: f64,
    pub high_frequency: f64,
}

impl EqThreeSettings {
    /// The settings for the effect's parameters (its `index.ts`).
    pub fn from_params<P: ParamSource + ?Sized>(p: &P) -> Self {
        Self {
            low: p.param_or("low", 0.0),
            mid: p.param_or("mid", 0.0),
            high: p.param_or("high", 0.0),
            low_frequency: p.param_or("lowFrequency", 400.0),
            high_frequency: p.param_or("highFrequency", 2500.0),
        }
    }
}

/// A gain in dB as a Gain node holds it (Tone's `dbToGain`).
fn gain(db: f64) -> f32 {
    10f64.powf(db / 20.0) as f32
}

/// The filters, in order: the low band's low pass, the mid band's high and
/// low pass, the high band's high pass.
const LOW: usize = 0;
const MID_HIGH_PASS: usize = 1;
const MID_LOW_PASS: usize = 2;
const HIGH: usize = 3;

pub struct EqThreeKernel {
    sr: f64,
    coefs: [Coefs; 4],
    /// Per channel, per filter.
    states: [[BiquadState; 4]; 2],
    gains: [f32; 3],
}

impl EqThreeKernel {
    pub fn new(sample_rate: f64, s: &EqThreeSettings) -> Self {
        let mut k = Self {
            sr: sample_rate,
            coefs: [Coefs::default(); 4],
            states: [[BiquadState::default(); 4]; 2],
            gains: [0.0; 3],
        };
        k.set(s);
        k
    }

    pub fn set(&mut self, s: &EqThreeSettings) {
        let (lo, hi) = (s.low_frequency as f32, s.high_frequency as f32);
        let filter = |kind, f| Coefs::new(kind, f, Q, 0.0, 0.0, self.sr);
        self.coefs = [
            filter(BiquadType::Lowpass, lo),
            filter(BiquadType::Highpass, lo),
            filter(BiquadType::Lowpass, hi),
            filter(BiquadType::Highpass, hi),
        ];
        self.gains = [gain(s.low), gain(s.mid), gain(s.high)];
    }

    pub fn process_in_place(&mut self, l: &mut [f32], r: &mut [f32]) {
        let n = l.len().min(r.len());
        let c = &self.coefs;
        let [g_low, g_mid, g_high] = self.gains;
        for (buf, st) in [&mut l[..n], &mut r[..n]].into_iter().zip(&mut self.states) {
            for x in buf.iter_mut() {
                let low = st[LOW].tick(&c[LOW], *x);
                let mid = st[MID_HIGH_PASS].tick(&c[MID_HIGH_PASS], *x);
                let mid = st[MID_LOW_PASS].tick(&c[MID_LOW_PASS], mid);
                let high = st[HIGH].tick(&c[HIGH], *x);
                *x = low * g_low + mid * g_mid + high * g_high;
            }
            for s in st.iter_mut() {
                s.end_block();
            }
        }
    }
}
