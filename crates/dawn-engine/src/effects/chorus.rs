//! The Chorus.
//!
//! Port of the studio's node (`src/effects/chorus/chorusChain.ts`, with the
//! sweep in `chorusModel.ts`): each side a short DelayNode whose time a
//! Tone LFO sweeps (the right one's turned by Spread), as Chromium runs
//! them (`delay_node.rs`, `tone_lfo.rs`), with an equal-power dry/wet
//! blend. `tests/chorus_parity.rs` holds the port to what Chromium renders.
//!
//! With Feedback the studio loops each delay back into itself. The browser
//! runs a loop a block at a time, so what comes back around is the delay's
//! output from the block before: 128 frames later than the delay alone.
//! No latency.

use super::delay_node::{DelayLine, QUANTUM};
use super::tone_lfo::{LfoShape, LfoWave, ToneLfo, WaveTables, initial_value};
use crate::params::ParamSource;

/// The longest delay (Tone.Delay's `maxDelay`).
const MAX_DELAY: f64 = 0.05;

/// Above this the feedback loop is wired (`CHORUS_FEEDBACK_ON`).
const FEEDBACK_ON: f64 = 0.001;

#[derive(Clone, Debug, PartialEq)]
pub struct ChorusSettings {
    /// The LFOs' rate, in Hz.
    pub rate: f64,
    /// The delay the sweep centres on, in ms.
    pub delay_ms: f64,
    /// 0 to 1: the sweep, ± that share of the delay.
    pub depth: f64,
    pub feedback: f64,
    /// The right LFO's phase from the left's, in degrees.
    pub spread: f64,
    pub wet: f64,
    pub shape: LfoShape,
    /// The LFOs' tables, made at the song's sample rate by `prepare` (and
    /// by the kernel otherwise).
    tables: Option<Box<Tables>>,
}

/// What the LFOs need that takes time to work out.
#[derive(Clone, Debug, PartialEq)]
struct Tables {
    sample_rate: f64,
    waves: [WaveTables; 2],
    /// Tone's stopped values for them (`initial_value`).
    initial: [f32; 2],
}

impl ChorusSettings {
    /// The settings for the effect's parameters (its `index.ts`).
    pub fn from_params<P: ParamSource + ?Sized>(p: &P) -> Self {
        Self {
            rate: p.param_or("frequency", 1.5),
            delay_ms: p.param_or("delayTime", 3.5),
            depth: p.param_or("depth", 0.7),
            feedback: p.param_or("feedback", 0.0),
            spread: p.param_or("spread", 180.0),
            wet: p.param_or("wet", 0.5),
            shape: if p.param_or("waveform", 0.0) >= 0.5 {
                LfoShape::Triangle
            } else {
                LfoShape::Sine
            },
            tables: None,
        }
    }

    /// Makes the LFOs' tables for `sample_rate` (off the audio thread).
    pub fn prepare(&mut self, sample_rate: f64) {
        if self
            .tables
            .as_ref()
            .is_none_or(|t| t.sample_rate != sample_rate)
        {
            self.tables = Some(Box::new(self.make_tables(sample_rate)));
        }
    }

    fn make_tables(&self, sample_rate: f64) -> Tables {
        let waves = [0.0, self.spread].map(|phase| LfoWave {
            shape: self.shape,
            phase,
        });
        Tables {
            sample_rate,
            waves: waves.map(|w| WaveTables::new(w, self.rate, sample_rate)),
            initial: waves.map(initial_value),
        }
    }

    /// The delay's sweep, in seconds (`chorusDelayRange`).
    fn sweep(&self) -> (f64, f64) {
        let deviation = self.delay_ms * self.depth;
        (
            (self.delay_ms - deviation).max(0.0) / 1000.0,
            (self.delay_ms + deviation) / 1000.0,
        )
    }
}

/// Where the right delay's input comes from in a block. The browser's
/// splitter writes it straight into the right delay's buffer when that's
/// the delay's only input (no loop), but only once the delay has asked it
/// to: in the first block, and the first after the loop is unwired, the
/// delay reads its own last output instead; and in the first block after
/// the loop is wired, the splitter's own buffer, last written when it
/// wasn't writing into the delay's (and as the splitter writes the input
/// into the delay's output that block, that's what feeds back).
#[derive(Clone, Copy, PartialEq)]
enum RightInput {
    Live,
    OwnLast,
    Splitter,
}

pub struct ChorusKernel {
    sample_rate: f64,
    lfos: [ToneLfo; 2],
    lines: [DelayLine; 2],
    /// Each delay's output over the last block, by the frame's place in
    /// its block: what the loop feeds back.
    last: [[f32; QUANTUM]; 2],
    at: usize,
    /// The splitter's buffer for the right channel (see `RightInput`).
    splitter: [f32; QUANTUM],
    /// Whether the splitter writes into the right delay's buffer.
    in_place: bool,
    right_input: RightInput,
    /// The splitter writes its own buffer this block.
    splitter_written: bool,
    looped: bool,
    feedback: f32,
    dry: f32,
    wet: f32,
    /// The wave the LFOs have, once set.
    wave: Option<(LfoShape, f64)>,
}

impl ChorusKernel {
    pub fn new(sample_rate: f64, s: &ChorusSettings) -> Self {
        let mut k = Self {
            sample_rate,
            lfos: [ToneLfo::new(sample_rate), ToneLfo::new(sample_rate)],
            lines: [
                DelayLine::new(MAX_DELAY, sample_rate),
                DelayLine::new(MAX_DELAY, sample_rate),
            ],
            last: [[0.0; QUANTUM]; 2],
            at: 0,
            splitter: [0.0; QUANTUM],
            in_place: false,
            right_input: RightInput::Live,
            splitter_written: false,
            looped: false,
            feedback: 0.0,
            dry: 0.0,
            wet: 0.0,
            wave: None,
        };
        k.set(s);
        k
    }

    /// Takes new settings. Their tables should be made (`prepare`): on the
    /// audio thread this only copies.
    pub fn set(&mut self, s: &ChorusSettings) {
        let made;
        let tables = match &s.tables {
            Some(t) if t.sample_rate == self.sample_rate => t,
            _ => {
                made = s.make_tables(self.sample_rate);
                &made
            }
        };
        let (min, max) = s.sweep();
        for (lfo, t) in self.lfos.iter_mut().zip(&tables.waves) {
            lfo.set_wave(t);
            lfo.set_rate(s.rate);
            lfo.set_range(min, max);
        }
        // A new waveform sets both LFOs' stopped values, a new spread the
        // right one's.
        if let Some((shape, spread)) = self.wave {
            if shape != s.shape {
                self.lfos[0].set_offset(tables.initial[0]);
            }
            if shape != s.shape || spread.to_bits() != s.spread.to_bits() {
                self.lfos[1].set_offset(tables.initial[1]);
            }
        }
        self.wave = Some((s.shape, s.spread));
        self.looped = s.feedback > FEEDBACK_ON;
        self.feedback = s.feedback as f32;
        let angle = s.wet * std::f64::consts::PI / 2.0;
        self.dry = angle.cos() as f32;
        self.wet = angle.sin() as f32;
    }

    /// At a block's start: where the right delay's input comes from.
    fn start_block(&mut self) {
        self.splitter_written = !self.in_place;
        self.right_input = match (self.looped, self.in_place) {
            (false, true) | (true, false) => RightInput::Live,
            (false, false) => RightInput::OwnLast,
            (true, true) => RightInput::Splitter,
        };
        self.in_place = !self.looped;
    }

    pub fn process_in_place(&mut self, l: &mut [f32], r: &mut [f32]) {
        for (x_l, x_r) in l.iter_mut().zip(r.iter_mut()) {
            if self.at == 0 {
                self.start_block();
            }
            let at = self.at;
            if self.splitter_written {
                self.splitter[at] = *x_r;
            }
            for (ch, x) in [x_l, x_r].into_iter().enumerate() {
                let time = self.lines[ch].clamp(self.lfos[ch].next_value());
                let mut input = match (ch, self.right_input) {
                    (1, RightInput::OwnLast) => self.last[1][at],
                    (1, RightInput::Splitter) => self.splitter[at],
                    _ => *x,
                };
                if self.looped {
                    let back = match (ch, self.right_input) {
                        (1, RightInput::Splitter) => *x,
                        _ => self.last[ch][at],
                    };
                    input += back * self.feedback;
                }
                let y = self.lines[ch].tick(input, time);
                self.last[ch][at] = y;
                *x = *x * self.dry + y * self.wet;
            }
            self.at = (at + 1) % QUANTUM;
        }
    }
}
