//! The Delay.
//!
//! Port of the studio's node (`src/effects/delay/delayChain.ts`): a
//! DelayNode for each side with its own time, as Chromium runs them
//! (`delay_node.rs`), each fed back into itself (or with Ping-Pong into
//! the other side's) through a low and high cut that can be turned off,
//! and a Freeze that shuts the input out and holds the repeats.
//! `tests/delay_parity.rs` holds the port to what Chromium renders.
//!
//! As the browser has it:
//! - Each side's delay takes the whole stereo input, and each side of
//!   the output is its delay's two channels mixed to one.
//! - The browser runs a loop a block at a time, so what feeds back is
//!   from the block before: each repeat comes 128 frames after its time.
//!   With Ping-Pong only the right side's input waits, since in the block
//!   the browser works out the left side's repeats from the right's.
//! - A cut that's turned off isn't run: it keeps its state, and its last
//!   block's output, for when it's turned back on.
//!
//! No latency.

use super::biquad_node::{BiquadState, BiquadType, Coefs};
use super::delay_node::{DelayLine, QUANTUM};
use crate::params::ParamSource;

/// The longest time (Tone.Delay's `maxDelay`).
const MAX_DELAY: f64 = 2.0;

/// The cuts' resonance (Q, in dB as the node reads it).
const CUT_Q: f32 = 0.7;

/// The feedback while frozen.
const FREEZE_FEEDBACK: f32 = 0.995;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DelaySettings {
    /// Left and right, in seconds.
    pub times: [f64; 2],
    pub feedback: f64,
    pub low_cut: f64,
    pub high_cut: f64,
    pub wet: f64,
    pub filter: bool,
    pub ping_pong: bool,
    pub freeze: bool,
}

impl DelaySettings {
    /// The settings for the effect's parameters (its `index.ts`; Sync and
    /// Link only change how the knobs move).
    pub fn from_params<P: ParamSource + ?Sized>(p: &P) -> Self {
        Self {
            times: [
                p.param_or("delayTimeL", 0.25),
                p.param_or("delayTimeR", 0.375),
            ],
            feedback: p.param_or("feedback", 0.45),
            low_cut: p.param_or("lowCut", 150.0),
            high_cut: p.param_or("highCut", 6000.0),
            wet: p.param_or("wet", 0.3),
            filter: p.param_or("filterOn", 1.0) >= 0.5,
            ping_pong: p.param_or("pingPong", 0.0) >= 0.5,
            freeze: p.param_or("freeze", 0.0) >= 0.5,
        }
    }
}

/// One side: its delay and cuts, for each channel of the input.
struct Side {
    lines: [DelayLine; 2],
    low: [BiquadState; 2],
    high: [BiquadState; 2],
    /// What the delay and the high cut put out over the last block they
    /// ran, by the frame's place in its block.
    last_delay: [[f32; QUANTUM]; 2],
    last_high: [[f32; QUANTUM]; 2],
    time: f32,
}

impl Side {
    fn new(sample_rate: f64) -> Self {
        Self {
            lines: [
                DelayLine::new(MAX_DELAY, sample_rate),
                DelayLine::new(MAX_DELAY, sample_rate),
            ],
            low: [BiquadState::default(); 2],
            high: [BiquadState::default(); 2],
            last_delay: [[0.0; QUANTUM]; 2],
            last_high: [[0.0; QUANTUM]; 2],
            time: 0.0,
        }
    }

    /// What it fed back at this place in the last block.
    fn last_tap(&self, filter: bool, ch: usize, at: usize) -> f32 {
        if filter {
            self.last_high[ch][at]
        } else {
            self.last_delay[ch][at]
        }
    }
}

pub struct DelayKernel {
    sample_rate: f64,
    sides: Box<[Side; 2]>,
    low_coefs: Coefs,
    high_coefs: Coefs,
    at: usize,
    filter: bool,
    ping_pong: bool,
    /// The input's gain into the delays (0 while frozen) and the
    /// feedback's.
    gate: f32,
    feedback: f32,
    dry: f32,
    wet: f32,
}

impl DelayKernel {
    pub fn new(sample_rate: f64, s: &DelaySettings) -> Self {
        let mut k = Self {
            sample_rate,
            sides: Box::new([Side::new(sample_rate), Side::new(sample_rate)]),
            low_coefs: Coefs::default(),
            high_coefs: Coefs::default(),
            at: 0,
            filter: false,
            ping_pong: false,
            gate: 1.0,
            feedback: 0.0,
            dry: 0.0,
            wet: 0.0,
        };
        k.set(s);
        k
    }

    pub fn set(&mut self, s: &DelaySettings) {
        for (side, time) in self.sides.iter_mut().zip(s.times) {
            side.time = side.lines[0].clamp(time as f32);
        }
        let cut = |kind, frequency: f64| {
            Coefs::new(kind, frequency as f32, CUT_Q, 0.0, 0.0, self.sample_rate)
        };
        self.low_coefs = cut(BiquadType::Highpass, s.low_cut);
        self.high_coefs = cut(BiquadType::Lowpass, s.high_cut);
        self.filter = s.filter;
        self.ping_pong = s.ping_pong;
        (self.gate, self.feedback) = if s.freeze {
            (0.0, FREEZE_FEEDBACK)
        } else {
            (1.0, s.feedback as f32)
        };
        self.dry = (1.0 - s.wet) as f32;
        self.wet = s.wet as f32;
    }

    /// One side's sample: its delay's input (the input and what feeds
    /// back), through the delay and cuts, mixed to one channel.
    #[inline]
    fn side(&mut self, s: usize, x: [f32; 2], back: [f32; 2]) -> ([f32; 2], f32) {
        let (at, filter) = (self.at, self.filter);
        let (low_c, high_c) = (&self.low_coefs, &self.high_coefs);
        let side = &mut self.sides[s];
        let mut tap = [0.0f32; 2];
        for ch in 0..2 {
            let input = x[ch] * self.gate + back[ch] * self.feedback;
            let d = side.lines[ch].tick(input, side.time);
            side.last_delay[ch][at] = d;
            tap[ch] = if filter {
                let h = side.high[ch].tick(high_c, side.low[ch].tick(low_c, d));
                side.last_high[ch][at] = h;
                h
            } else {
                d
            };
        }
        (tap, 0.5 * tap[0] + 0.5 * tap[1])
    }

    pub fn process_in_place(&mut self, l: &mut [f32], r: &mut [f32]) {
        for (x_l, x_r) in l.iter_mut().zip(r.iter_mut()) {
            let x = [*x_l, *x_r];
            let (at, filter) = (self.at, self.filter);
            let last = |k: &Self, s: usize| {
                [
                    k.sides[s].last_tap(filter, 0, at),
                    k.sides[s].last_tap(filter, 1, at),
                ]
            };
            let (left, right) = if self.ping_pong {
                // The right side's repeats come from the left's last block,
                // then the left's from the right's now.
                let back = last(self, 0);
                let (right_tap, right) = self.side(1, x, back);
                let (_, left) = self.side(0, x, right_tap);
                (left, right)
            } else {
                let back = last(self, 0);
                let (_, left) = self.side(0, x, back);
                let back = last(self, 1);
                let (_, right) = self.side(1, x, back);
                (left, right)
            };
            *x_l = x[0] * self.dry + left * self.wet;
            *x_r = x[1] * self.dry + right * self.wet;
            self.at += 1;
            if self.at == QUANTUM {
                self.at = 0;
                if self.filter {
                    for side in self.sides.iter_mut() {
                        for st in side.low.iter_mut().chain(side.high.iter_mut()) {
                            st.end_block();
                        }
                    }
                }
            }
        }
    }
}
