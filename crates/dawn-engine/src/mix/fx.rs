//! The effects in a chain (a track's, a bus's or the master's) as the
//! engine plays them. Each lives on from one version of the song to the
//! next, by its id, so an edit doesn't reset a compressor or cut a tail; a
//! bypassed one is skipped, keeping its state, as the browser unplugs it.
//!
//! As in the browser's engine: a track's chain runs on what it plays and
//! what's routed into it, ahead of its fader; a bus's on its sends, ahead
//! of its fader; the master's after its fader, ahead of the limiter.

use super::song::MAX_BLOCK;
use crate::effects::amp::{self, AmpEffect, AmpSettings};
use crate::effects::chorus::{ChorusKernel, ChorusSettings};
use crate::effects::compressor::{CompressorKernel, CompressorSettings};
use crate::effects::delay::{DelayKernel, DelaySettings};
use crate::effects::eq_three::{EqThreeKernel, EqThreeSettings};
use crate::effects::filter::{FilterKernel, FilterSettings};
use crate::effects::gate::{GateKernel, GateSettings};
use crate::effects::glue::OS_LATENCY;
use crate::effects::glue::{GlueKernel, GlueSettings};
use crate::effects::limiter::{Limiter, LimiterSettings, lookahead_frames};
use crate::effects::mb_dynamics::{MbDynamicsKernel, MbDynamicsSettings};
use crate::effects::multiband::{MultibandKernel, MultibandSettings};
use crate::effects::param_eq::{ParamEqKernel, ParamEqSettings};
use crate::effects::pitch_shift::{PitchShiftSettings, PitchShifter};
use crate::effects::saturator::{SaturatorKernel, SaturatorSettings};
use crate::effects::utility::{UtilityKernel, UtilitySettings};
use crate::params::ParamSource;

/// An effect's settings, made from its parameters.
#[derive(Clone, Debug, PartialEq)]
pub enum EffectSettings {
    Amp(Box<AmpSettings>),
    Chorus(Box<ChorusSettings>),
    Compressor(CompressorSettings),
    Delay(DelaySettings),
    EqThree(EqThreeSettings),
    Filter(FilterSettings),
    Gate(GateSettings),
    Glue(GlueSettings),
    Limiter(LimiterSettings),
    MbDynamics(Box<MbDynamicsSettings>),
    Multiband(Box<MultibandSettings>),
    ParamEq(Box<ParamEqSettings>),
    PitchShift(PitchShiftSettings),
    Saturator(Box<SaturatorSettings>),
    Utility(UtilitySettings),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EffectKind {
    Amp,
    Chorus,
    Compressor,
    Delay,
    EqThree,
    Filter,
    Gate,
    Glue,
    Limiter,
    MbDynamics,
    Multiband,
    ParamEq,
    PitchShift,
    Saturator,
    Utility,
}

impl EffectSettings {
    /// The settings for an effect of type `kind` (its saved key, as in the
    /// studio's `registry.ts`) with these parameters; None for a type the
    /// engine doesn't have. Sidechains aren't in the engine yet: an effect
    /// that can take one listens to its own input (the studio leaves out
    /// those keyed by another track).
    pub fn from_params<P: ParamSource + ?Sized>(kind: &str, params: &P) -> Option<Self> {
        Some(match kind {
            "chorus" => Self::Chorus(Box::new(ChorusSettings::from_params(params))),
            "compressor" => Self::Compressor(CompressorSettings::from_params(params, false)),
            "delay" => Self::Delay(DelaySettings::from_params(params)),
            "distortion" => Self::Saturator(Box::new(SaturatorSettings::from_params(params))),
            "eq3" => Self::EqThree(EqThreeSettings::from_params(params)),
            "filter" => Self::Filter(FilterSettings::from_params(params)),
            "tubeAmp" => Self::Amp(Box::new(AmpSettings::from_params(params))),
            "gate" => Self::Gate(GateSettings::from_params(params, false)),
            "glue" => Self::Glue(GlueSettings::from_params(params, false)),
            "limiter" => Self::Limiter(LimiterSettings::from_params(params)),
            "mbDynamics" => {
                Self::MbDynamics(Box::new(MbDynamicsSettings::from_params(params, false)))
            }
            "multiband" => Self::Multiband(Box::new(MultibandSettings::from_params(params, false))),
            "paramEq" => Self::ParamEq(Box::new(ParamEqSettings::from_params(params))),
            "pitchShift" => Self::PitchShift(PitchShiftSettings::from_params(params)),
            "utility" => Self::Utility(UtilitySettings::from_params(params)),
            _ => return None,
        })
    }

    /// The frames it delays its audio by at `sample_rate` (as the browser's
    /// node reports it, for delay compensation).
    pub fn latency(&self, sample_rate: f64) -> usize {
        match self {
            Self::Amp(_) => amp::LATENCY,
            Self::Glue(s) if s.oversample => OS_LATENCY,
            Self::Limiter(_) => lookahead_frames(sample_rate),
            Self::PitchShift(s) => s.latency(sample_rate),
            Self::Saturator(s) => s.latency(),
            _ => 0,
        }
    }

    /// Works out, off the audio thread, what its kernel needs at
    /// `sample_rate` that would take too long on it (the Chorus's LFO
    /// tables).
    pub fn prepare(&mut self, sample_rate: f64) {
        if let Self::Chorus(s) = self {
            s.prepare(sample_rate);
        }
    }

    pub fn kind(&self) -> EffectKind {
        match self {
            Self::Amp(_) => EffectKind::Amp,
            Self::Chorus(_) => EffectKind::Chorus,
            Self::Compressor(_) => EffectKind::Compressor,
            Self::Delay(_) => EffectKind::Delay,
            Self::EqThree(_) => EffectKind::EqThree,
            Self::Filter(_) => EffectKind::Filter,
            Self::Gate(_) => EffectKind::Gate,
            Self::Glue(_) => EffectKind::Glue,
            Self::Limiter(_) => EffectKind::Limiter,
            Self::MbDynamics(_) => EffectKind::MbDynamics,
            Self::Multiband(_) => EffectKind::Multiband,
            Self::ParamEq(_) => EffectKind::ParamEq,
            Self::PitchShift(_) => EffectKind::PitchShift,
            Self::Saturator(_) => EffectKind::Saturator,
            Self::Utility(_) => EffectKind::Utility,
        }
    }
}

/// An effect in a chain.
#[derive(Clone, Debug, PartialEq)]
pub struct EffectSpec {
    /// The studio's id for it.
    pub id: String,
    pub settings: EffectSettings,
    /// Skipped, as if unplugged.
    pub bypass: bool,
}

impl EffectSpec {
    pub fn new(id: impl Into<String>, settings: EffectSettings) -> Self {
        Self {
            id: id.into(),
            settings,
            bypass: false,
        }
    }
}

enum Kernel {
    Amp(Box<AmpEffect>),
    Chorus(Box<ChorusKernel>),
    Compressor(Box<CompressorKernel>),
    Delay(Box<DelayKernel>),
    EqThree(Box<EqThreeKernel>),
    Filter(Box<FilterKernel>),
    Gate(Box<GateKernel>),
    Glue(Box<GlueKernel>),
    /// With a copy of its input, as it doesn't work in place.
    Limiter(Box<Limiter>, Box<[f32]>, Box<[f32]>),
    MbDynamics(Box<MbDynamicsKernel>),
    Multiband(Box<MultibandKernel>),
    ParamEq(Box<ParamEqKernel>),
    PitchShift(Box<PitchShifter>),
    Saturator(Box<SaturatorKernel>),
    Utility(Box<UtilityKernel>),
}

/// An effect's kernel, made off the audio thread.
pub struct Effect {
    kernel: Kernel,
}

impl Effect {
    pub fn new(settings: &EffectSettings, sample_rate: f64) -> Self {
        let kernel = match settings {
            EffectSettings::Amp(s) => Kernel::Amp(Box::new(AmpEffect::new(sample_rate, s))),
            EffectSettings::Chorus(s) => {
                Kernel::Chorus(Box::new(ChorusKernel::new(sample_rate, s)))
            }
            EffectSettings::Compressor(s) => {
                Kernel::Compressor(Box::new(CompressorKernel::new(sample_rate, s)))
            }
            EffectSettings::Delay(s) => Kernel::Delay(Box::new(DelayKernel::new(sample_rate, s))),
            EffectSettings::EqThree(s) => {
                Kernel::EqThree(Box::new(EqThreeKernel::new(sample_rate, s)))
            }
            EffectSettings::Filter(s) => {
                Kernel::Filter(Box::new(FilterKernel::new(sample_rate, s)))
            }
            EffectSettings::Gate(s) => Kernel::Gate(Box::new(GateKernel::new(sample_rate, s))),
            EffectSettings::Glue(s) => Kernel::Glue(Box::new(GlueKernel::new(sample_rate, s))),
            EffectSettings::Limiter(s) => Kernel::Limiter(
                Box::new(Limiter::new(sample_rate, *s)),
                vec![0.0; MAX_BLOCK].into(),
                vec![0.0; MAX_BLOCK].into(),
            ),
            EffectSettings::MbDynamics(s) => {
                Kernel::MbDynamics(Box::new(MbDynamicsKernel::new(sample_rate, s)))
            }
            EffectSettings::Multiband(s) => {
                Kernel::Multiband(Box::new(MultibandKernel::new(sample_rate, s)))
            }
            EffectSettings::ParamEq(s) => {
                Kernel::ParamEq(Box::new(ParamEqKernel::new(sample_rate, s)))
            }
            EffectSettings::PitchShift(s) => {
                Kernel::PitchShift(Box::new(PitchShifter::new(sample_rate, s)))
            }
            EffectSettings::Saturator(s) => {
                Kernel::Saturator(Box::new(SaturatorKernel::new(sample_rate, s)))
            }
            EffectSettings::Utility(s) => {
                Kernel::Utility(Box::new(UtilityKernel::new(sample_rate, s)))
            }
        };
        Self { kernel }
    }

    pub fn kind(&self) -> EffectKind {
        match self.kernel {
            Kernel::Amp(_) => EffectKind::Amp,
            Kernel::Chorus(_) => EffectKind::Chorus,
            Kernel::Compressor(_) => EffectKind::Compressor,
            Kernel::Delay(_) => EffectKind::Delay,
            Kernel::EqThree(_) => EffectKind::EqThree,
            Kernel::Filter(_) => EffectKind::Filter,
            Kernel::Gate(_) => EffectKind::Gate,
            Kernel::Glue(_) => EffectKind::Glue,
            Kernel::Limiter(..) => EffectKind::Limiter,
            Kernel::MbDynamics(_) => EffectKind::MbDynamics,
            Kernel::Multiband(_) => EffectKind::Multiband,
            Kernel::ParamEq(_) => EffectKind::ParamEq,
            Kernel::PitchShift(_) => EffectKind::PitchShift,
            Kernel::Saturator(_) => EffectKind::Saturator,
            Kernel::Utility(_) => EffectKind::Utility,
        }
    }

    /// Takes the settings of a new version of the song (on the audio
    /// thread: it only copies).
    pub fn configure(&mut self, settings: &EffectSettings) {
        match (&mut self.kernel, settings) {
            (Kernel::Amp(k), EffectSettings::Amp(s)) => k.set(s),
            (Kernel::Chorus(k), EffectSettings::Chorus(s)) => k.set(s),
            (Kernel::Compressor(k), EffectSettings::Compressor(s)) => k.set(s),
            (Kernel::Delay(k), EffectSettings::Delay(s)) => k.set(s),
            (Kernel::EqThree(k), EffectSettings::EqThree(s)) => k.set(s),
            (Kernel::Filter(k), EffectSettings::Filter(s)) => k.set(s),
            (Kernel::Gate(k), EffectSettings::Gate(s)) => k.set(s),
            (Kernel::Glue(k), EffectSettings::Glue(s)) => k.set(s),
            (Kernel::Limiter(k, ..), EffectSettings::Limiter(s)) => k.set(*s),
            (Kernel::MbDynamics(k), EffectSettings::MbDynamics(s)) => k.set(s),
            (Kernel::Multiband(k), EffectSettings::Multiband(s)) => k.set(s),
            (Kernel::ParamEq(k), EffectSettings::ParamEq(s)) => k.set(s),
            (Kernel::PitchShift(k), EffectSettings::PitchShift(s)) => k.set(s),
            (Kernel::Saturator(k), EffectSettings::Saturator(s)) => k.set(s),
            (Kernel::Utility(k), EffectSettings::Utility(s)) => k.set(s),
            _ => {}
        }
    }

    /// Processes a stereo block (at most `MAX_BLOCK` frames) in place.
    pub fn process(&mut self, l: &mut [f32], r: &mut [f32]) {
        let n = l.len().min(r.len());
        match &mut self.kernel {
            Kernel::Amp(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::Chorus(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::Compressor(k) => k.process_in_place(&mut l[..n], Some(&mut r[..n]), None, None),
            Kernel::Delay(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::EqThree(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::Filter(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::Gate(k) => {
                k.process_in_place(&mut l[..n], &mut r[..n]);
            }
            Kernel::Glue(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::Limiter(k, in_l, in_r) => {
                in_l[..n].copy_from_slice(&l[..n]);
                in_r[..n].copy_from_slice(&r[..n]);
                k.process(Some(&in_l[..n]), Some(&in_r[..n]), l, Some(r), n);
            }
            Kernel::MbDynamics(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::Multiband(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::ParamEq(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::PitchShift(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::Saturator(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::Utility(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
        }
    }
}

/// The frames a chain delays its audio by: its effects', bar the bypassed.
pub(crate) fn latency(specs: &[EffectSpec], sample_rate: f64) -> usize {
    specs
        .iter()
        .filter(|s| !s.bypass)
        .map(|s| s.settings.latency(sample_rate))
        .sum()
}

/// A chain's effects as the audio thread has them: in the order of its
/// specs, each made for this version of the song or (until the engine
/// takes it) waiting to be swapped for the one already playing.
pub(crate) type Chain = Vec<Option<Box<Effect>>>;

/// Runs a chain on a stereo block, skipping what's bypassed.
pub(crate) fn run(chain: &mut Chain, specs: &[EffectSpec], l: &mut [f32], r: &mut [f32]) {
    for (effect, spec) in chain.iter_mut().zip(specs) {
        if let Some(effect) = effect
            && !spec.bypass
        {
            effect.process(l, r);
        }
    }
}
