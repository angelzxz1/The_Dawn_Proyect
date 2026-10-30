//! The Filter.
//!
//! Port of the studio's node (`src/effects/filter/filterChain.ts`, with the
//! stage design in `filterModel.ts`): one to four BiquadFilterNodes in
//! series, as Chromium runs them (`biquad_node.rs`), blended with the dry
//! signal; an LFO sweeps every stage's cutoff through its detune.
//! `tests/filter_parity.rs` holds the port to what Chromium renders.
//!
//! Low and high pass steepen as Butterworth cascades, the resonance on the
//! section that sets the corner; band pass and notch as copies of one
//! section; peak and the shelves are always one. A new type or slope makes
//! new stages, starting from silence, as the studio's node does; moving a
//! knob keeps them. No latency.

use std::f64::consts::{FRAC_1_SQRT_2, PI};

use super::biquad_node::{BiquadState, BiquadType, Coefs};
use crate::instruments::js_round;
use crate::params::ParamSource;

/// The types, by the `mode` parameter's index.
const MODES: [BiquadType; 7] = [
    BiquadType::Lowpass,
    BiquadType::Highpass,
    BiquadType::Bandpass,
    BiquadType::Notch,
    BiquadType::Peaking,
    BiquadType::Lowshelf,
    BiquadType::Highshelf,
];

/// The most stages (a 48 dB/oct slope).
const MAX_STAGES: usize = 4;

/// How far (in octaves each way) the LFO sweeps at 100% depth.
const LFO_MAX_OCTAVES: f64 = 3.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FilterSettings {
    pub kind: BiquadType,
    pub frequency: f64,
    /// Linear (the Reso knob).
    pub q: f64,
    pub gain_db: f64,
    /// 0, 1, 2: 12, 24, 48 dB per octave.
    pub slope: usize,
    pub lfo_rate: f64,
    /// 0 to 1.
    pub lfo_depth: f64,
    pub wet: f64,
}

/// An index parameter, rounded and kept to `0..len`.
fn index<P: ParamSource + ?Sized>(p: &P, key: &str, len: usize) -> usize {
    js_round(p.param_or(key, 0.0)).clamp(0.0, (len - 1) as f64) as usize
}

impl FilterSettings {
    /// The settings for the effect's parameters (its `index.ts`).
    pub fn from_params<P: ParamSource + ?Sized>(p: &P) -> Self {
        Self {
            kind: MODES[index(p, "mode", MODES.len())],
            frequency: p.param_or("frequency", 1200.0),
            q: p.param_or("Q", 1.0),
            gain_db: p.param_or("gain", 0.0),
            slope: index(p, "slope", 3),
            lfo_rate: p.param_or("lfoRate", 1.0),
            lfo_depth: p.param_or("lfoDepth", 0.0),
            wet: p.param_or("wet", 1.0),
        }
    }
}

/// One stage's parameters, as its node holds them.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Stage {
    kind: BiquadType,
    frequency: f32,
    q: f32,
    gain: f32,
}

/// The stages for a setting (`designFilter`): `count` of `stages`.
fn design(s: &FilterSettings) -> ([Stage; MAX_STAGES], usize) {
    let mut stages = [Stage {
        kind: s.kind,
        frequency: s.frequency as f32,
        q: s.q as f32,
        gain: 0.0,
    }; MAX_STAGES];
    match s.kind {
        BiquadType::Peaking | BiquadType::Lowshelf | BiquadType::Highshelf => {
            stages[0].gain = s.gain_db as f32;
            (stages, 1)
        }
        BiquadType::Lowpass | BiquadType::Highpass => {
            // A Butterworth cascade of 2·sections poles, each section's Q.
            let sections = 1 << s.slope;
            let order = (sections * 2) as f64;
            for (i, stage) in stages[..sections].iter_mut().enumerate() {
                let k = (i + 1) as f64;
                let bq = 1.0 / (2.0 * (((2.0 * k - 1.0) * PI) / (2.0 * order)).cos());
                let linear_q = if i == sections - 1 {
                    bq * (s.q / FRAC_1_SQRT_2)
                } else {
                    bq
                };
                // The node reads a low or high pass's Q in dB.
                stage.q = (20.0 * linear_q.log10()) as f32;
            }
            (stages, sections)
        }
        _ => (stages, 1 << s.slope),
    }
}

pub struct FilterKernel {
    sr: f64,
    stages: [Stage; MAX_STAGES],
    count: usize,
    /// Per channel, per stage.
    states: [[BiquadState; MAX_STAGES]; 2],
    /// Unmodulated.
    coefs: [Coefs; MAX_STAGES],
    dry: f32,
    wet: f32,
    lfo_rate: f32,
    /// The LFO's scaling to cents: (0..1)·mult + add.
    lfo_mult: f32,
    lfo_add: f32,
    /// In cycles.
    lfo_phase: f64,
}

impl FilterKernel {
    pub fn new(sample_rate: f64, s: &FilterSettings) -> Self {
        let mut k = Self {
            sr: sample_rate,
            stages: design(s).0,
            count: 0,
            states: [[BiquadState::default(); MAX_STAGES]; 2],
            coefs: [Coefs::default(); MAX_STAGES],
            dry: 0.0,
            wet: 0.0,
            lfo_rate: 0.0,
            lfo_mult: 0.0,
            lfo_add: 0.0,
            lfo_phase: 0.0,
        };
        k.set(s);
        k
    }

    pub fn set(&mut self, s: &FilterSettings) {
        let (stages, count) = design(s);
        let reusable = count == self.count && stages[0].kind == self.stages[0].kind;
        if !reusable {
            self.states = [[BiquadState::default(); MAX_STAGES]; 2];
        }
        self.stages = stages;
        self.count = count;
        for (c, st) in self.coefs.iter_mut().zip(&stages[..count]) {
            *c = Coefs::new(st.kind, st.frequency, st.q, st.gain, 0.0, self.sr);
        }
        self.dry = (1.0 - s.wet) as f32;
        self.wet = s.wet as f32;
        self.lfo_rate = s.lfo_rate as f32;
        let cents = s.lfo_depth * LFO_MAX_OCTAVES * 1200.0;
        let (min, max) = (-cents, cents);
        self.lfo_mult = (max - min) as f32;
        self.lfo_add = min as f32;
    }

    /// The LFO's next value, in cents (the stages' detune).
    #[inline]
    fn lfo(&mut self) -> f32 {
        let s = (2.0 * PI * self.lfo_phase).sin();
        self.lfo_phase += self.lfo_rate as f64 / self.sr;
        self.lfo_phase -= self.lfo_phase.floor();
        let unipolar = (0.5 * (s + 1.0)) as f32;
        unipolar * self.lfo_mult + self.lfo_add
    }

    pub fn process_in_place(&mut self, l: &mut [f32], r: &mut [f32]) {
        let n = l.len().min(r.len());
        let (l, r) = (&mut l[..n], &mut r[..n]);
        let count = self.count;
        if self.lfo_mult == 0.0 && self.lfo_add == 0.0 {
            // The LFO runs on at no depth, so it's where it would be when
            // the depth goes up.
            for _ in 0..n {
                self.lfo();
            }
            for (ch, buf) in [l, r].into_iter().enumerate() {
                for x in buf.iter_mut() {
                    let mut y = *x;
                    for (st, c) in self.states[ch][..count].iter_mut().zip(&self.coefs) {
                        y = st.tick(c, y);
                    }
                    *x = *x * self.dry + y * self.wet;
                }
            }
        } else {
            for i in 0..n {
                let detune = self.lfo();
                let mut y = [l[i], r[i]];
                for (j, st) in self.stages[..count].iter().enumerate() {
                    let c = if detune == 0.0 {
                        self.coefs[j]
                    } else {
                        Coefs::new(st.kind, st.frequency, st.q, st.gain, detune, self.sr)
                    };
                    for (ch, y) in y.iter_mut().enumerate() {
                        *y = self.states[ch][j].tick(&c, *y);
                    }
                }
                l[i] = l[i] * self.dry + y[0] * self.wet;
                r[i] = r[i] * self.dry + y[1] * self.wet;
            }
        }
        for st in self.states.iter_mut().flatten() {
            st.end_block();
        }
    }
}
