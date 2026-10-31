//! The IR Loader.
//!
//! Port of the studio's node (`src/effects/ir-loader/irLoaderChain.ts`,
//! with the helpers in `irModel.ts`), as Chromium runs it:
//!
//!   in -> convolver (or straight on, with no IR) -> low cut -> high cut
//!     -> Output -> wet
//!   in -> dry
//!
//! The convolver is a ConvolverNode (`convolver.rs`) with the impulse
//! response file the studio sends (decoded at the engine's rate), its
//! channels and level as the studio prepares them; the cuts are
//! BiquadFilterNodes (`biquad_node.rs`). A new file, or Normalize turned
//! on or off, makes a new impulse, off the audio thread, which takes all
//! new input while the old one rings out. `tests/ir_loader_parity.rs`
//! holds the port to what Chromium renders. No latency.

use std::f64::consts::FRAC_1_SQRT_2;
use std::sync::Arc;

use super::biquad_node::{BiquadState, BiquadType, Coefs};
use super::convolver::{Convolution, Impulse, ImpulseSlot};
use super::delay_node::QUANTUM;
use crate::mix::AudioData;
use crate::params::ParamSource;

/// Knob values at or past these are "Off".
const LOW_CUT_OFF_HZ: f64 = 20.5;
const HIGH_CUT_OFF_HZ: f64 = 19999.0;

/// The low cut's corner: "Off" moves it below hearing (`effectiveLowCut`).
fn effective_low_cut(value: f64) -> f64 {
    if value <= LOW_CUT_OFF_HZ { 5.0 } else { value }
}

/// The high cut's: "Off" moves it to Nyquist, where a low pass passes
/// everything (`effectiveHighCut`).
fn effective_high_cut(value: f64, sample_rate: f64) -> f64 {
    if value >= HIGH_CUT_OFF_HZ {
        sample_rate / 2.0
    } else {
        value
    }
}

/// The channels a ConvolverNode takes (`convolverChannels`): 1, 2 or 4;
/// any other number, its first two.
fn convolver_channels(channels: &[Vec<f32>]) -> &[Vec<f32>] {
    match channels.len() {
        1 | 2 | 4 => channels,
        _ => &channels[..channels.len().min(2)],
    }
}

/// The gain that brings an IR to unit energy, averaged over its channels
/// (`irNormalizationGain`).
fn normalization_gain(channels: &[Vec<f32>]) -> f64 {
    if channels.is_empty() {
        return 1.0;
    }
    let mut energy = 0.0f64;
    for data in channels {
        for &v in data {
            energy += v as f64 * v as f64;
        }
    }
    energy /= channels.len() as f64;
    if energy > 1e-12 {
        1.0 / energy.sqrt()
    } else {
        1.0
    }
}

/// The impulse made for the settings, at a rate.
#[derive(Clone, Debug)]
struct Prepared {
    file: Option<Arc<AudioData>>,
    normalize: bool,
    sample_rate: f64,
    slot: Arc<ImpulseSlot>,
}

fn same_file(a: &Option<Arc<AudioData>>, b: &Option<Arc<AudioData>>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => Arc::ptr_eq(a, b),
        (None, None) => true,
        _ => false,
    }
}

#[derive(Clone, Debug)]
pub struct IrLoaderSettings {
    /// The cuts' knobs, in Hz.
    pub low_cut: f64,
    pub high_cut: f64,
    /// In dB.
    pub output: f64,
    pub wet: f64,
    pub normalize: bool,
    /// The impulse response (at the engine's rate), if one is loaded.
    pub file: Option<Arc<AudioData>>,
    impulse: Option<Prepared>,
}

impl PartialEq for IrLoaderSettings {
    /// The settings, not what's been made from them.
    fn eq(&self, other: &Self) -> bool {
        self.low_cut == other.low_cut
            && self.high_cut == other.high_cut
            && self.output == other.output
            && self.wet == other.wet
            && self.normalize == other.normalize
            && same_file(&self.file, &other.file)
    }
}

impl IrLoaderSettings {
    /// The settings for the effect's parameters (its `index.ts`), with no
    /// file yet.
    pub fn from_params<P: ParamSource + ?Sized>(p: &P) -> Self {
        Self {
            low_cut: p.param_or("lowCut", 20.0),
            high_cut: p.param_or("highCut", 20000.0),
            output: p.param_or("output", 0.0),
            wet: p.param_or("wet", 1.0),
            normalize: p.param_or("normalize", 1.0) >= 0.5,
            file: None,
            impulse: None,
        }
    }

    /// Makes the impulse at `sample_rate` (off the audio thread), unless
    /// it's made already, or `previous` (this effect's settings in the song
    /// playing) has it.
    pub fn prepare(&mut self, sample_rate: f64, previous: Option<&Self>) {
        let made = |p: &Prepared| {
            same_file(&p.file, &self.file)
                && p.normalize == self.normalize
                && p.sample_rate == sample_rate
        };
        if self.impulse.as_ref().is_some_and(made) {
            return;
        }
        if let Some(p) = previous
            .and_then(|p| p.impulse.as_ref())
            .filter(|p| made(p))
        {
            self.impulse = Some(p.clone());
            return;
        }
        let impulse = self.file.as_ref().filter(|f| f.frames() > 0).map(|file| {
            let sources = convolver_channels(&file.channels);
            let gain = if self.normalize {
                normalization_gain(sources)
            } else {
                1.0
            };
            let scaled: Vec<Vec<f32>> = sources
                .iter()
                .map(|data| data.iter().map(|&v| (v as f64 * gain) as f32).collect())
                .collect();
            let channels: Vec<&[f32]> = scaled.iter().map(Vec::as_slice).collect();
            Impulse::new(&channels)
        });
        self.impulse = Some(Prepared {
            file: self.file.clone(),
            normalize: self.normalize,
            sample_rate,
            slot: ImpulseSlot::new(impulse),
        });
    }

    fn slot(&self, sample_rate: f64) -> Option<&ImpulseSlot> {
        self.impulse
            .as_ref()
            .filter(|p| p.sample_rate == sample_rate)
            .map(|p| &*p.slot)
    }
}

/// A gain in dB as a Gain node holds it (Tone's `dbToGain`).
fn gain(db: f64) -> f32 {
    10f64.powf(db / 20.0) as f32
}

pub struct IrLoaderKernel {
    sample_rate: f64,
    low: Coefs,
    high: Coefs,
    /// Per side: the low cut's, then the high cut's.
    cuts: [[BiquadState; 2]; 2],
    convolution: Convolution,
    at: usize,
    output: f32,
    dry: f32,
    wet: f32,
}

impl IrLoaderKernel {
    /// Off the audio thread (it makes the impulse if `prepare` hasn't).
    pub fn new(sample_rate: f64, s: &IrLoaderSettings) -> Self {
        let mut prepared = s.clone();
        prepared.prepare(sample_rate, None);
        let convolution = match prepared.slot(sample_rate) {
            Some(slot) => Convolution::new(slot),
            None => Convolution::new(&ImpulseSlot::new(None)),
        };
        let mut k = Self {
            sample_rate,
            low: Coefs::default(),
            high: Coefs::default(),
            cuts: [[BiquadState::default(); 2]; 2],
            convolution,
            at: 0,
            output: 1.0,
            dry: 0.0,
            wet: 0.0,
        };
        k.set(s);
        k
    }

    /// Takes new settings: on the audio thread this only copies (a new
    /// impulse comes made, with the settings).
    pub fn set(&mut self, s: &IrLoaderSettings) {
        let sr = self.sample_rate;
        let q = FRAC_1_SQRT_2 as f32;
        let low = effective_low_cut(s.low_cut) as f32;
        let high = effective_high_cut(s.high_cut, sr) as f32;
        self.low = Coefs::new(BiquadType::Highpass, low, q, 0.0, 0.0, sr);
        self.high = Coefs::new(BiquadType::Lowpass, high, q, 0.0, 0.0, sr);
        self.output = gain(s.output);
        self.dry = (1.0 - s.wet) as f32;
        self.wet = s.wet as f32;
        if let Some(slot) = s.slot(sr) {
            self.convolution.take(slot);
        }
    }

    pub fn process_in_place(&mut self, l: &mut [f32], r: &mut [f32]) {
        let n = l.len().min(r.len());
        let mut start = 0;
        while start < n {
            let m = (n - start).min(QUANTUM);
            let mut wet = [[0.0f32; QUANTUM]; 2];
            wet[0][..m].copy_from_slice(&l[start..start + m]);
            wet[1][..m].copy_from_slice(&r[start..start + m]);
            let [wet_l, wet_r] = &mut wet;
            self.convolution.process(&mut wet_l[..m], &mut wet_r[..m]);
            for i in 0..m {
                for (s, (x, w)) in [(&mut l[start + i], wet_l[i]), (&mut r[start + i], wet_r[i])]
                    .into_iter()
                    .enumerate()
                {
                    let [low, high] = &mut self.cuts[s];
                    let y = high.tick(&self.high, low.tick(&self.low, w)) * self.output;
                    *x = *x * self.dry + y * self.wet;
                }
                self.at += 1;
                if self.at == QUANTUM {
                    self.at = 0;
                    for st in self.cuts.iter_mut().flatten() {
                        st.end_block();
                    }
                }
            }
            start += m;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slot(s: &IrLoaderSettings) -> &Arc<ImpulseSlot> {
        &s.impulse.as_ref().expect("prepared").slot
    }

    fn file(level: f32) -> Arc<AudioData> {
        Arc::new(AudioData {
            channels: vec![vec![level; 300], vec![-level; 300], vec![level; 300]],
        })
    }

    #[test]
    fn a_new_version_keeps_the_impulse_unless_the_file_or_normalize_changes() {
        let ir = file(0.5);
        let mut first = IrLoaderSettings::from_params(&[]);
        first.file = Some(ir.clone());
        first.prepare(48000.0, None);
        let mut quieter = IrLoaderSettings::from_params(&[("output", -6.0)]);
        quieter.file = Some(ir.clone());
        quieter.prepare(48000.0, Some(&first));
        assert!(Arc::ptr_eq(slot(&first), slot(&quieter)));
        let mut raw = IrLoaderSettings::from_params(&[("normalize", 0.0)]);
        raw.file = Some(ir);
        raw.prepare(48000.0, Some(&first));
        assert!(!Arc::ptr_eq(slot(&first), slot(&raw)));
        let mut other = IrLoaderSettings::from_params(&[]);
        other.file = Some(file(0.5));
        other.prepare(48000.0, Some(&first));
        assert!(!Arc::ptr_eq(slot(&first), slot(&other)));
        let mut none = IrLoaderSettings::from_params(&[]);
        none.prepare(48000.0, Some(&first));
        assert!(slot(&none).impulse().is_none());
    }

    #[test]
    fn normalize_brings_the_kept_channels_to_unit_energy() {
        // Three channels keep their first two.
        let f = file(0.5);
        let kept = convolver_channels(&f.channels);
        assert_eq!(kept.len(), 2);
        let g = normalization_gain(kept);
        // Each channel's energy is 300 * 0.25.
        assert!((g - 1.0 / 75f64.sqrt()).abs() < 1e-12);
    }
}
