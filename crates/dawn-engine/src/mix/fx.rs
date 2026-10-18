//! The effects in a chain (a track's, a bus's or the master's) as the
//! engine plays them. Each lives on from one version of the song to the
//! next, by its id, so an edit doesn't reset a compressor or cut a tail; a
//! bypassed one is skipped, keeping its state, as the browser unplugs it.
//!
//! As in the browser's engine: a track's chain runs on what it plays and
//! what's routed into it, ahead of its fader; a bus's on its sends, ahead
//! of its fader; the master's after its fader, ahead of the limiter.

use super::song::MAX_BLOCK;
use crate::effects::compressor::{CompressorKernel, CompressorSettings};
use crate::effects::gate::{GateKernel, GateSettings};
use crate::effects::glue::{GlueKernel, GlueSettings};
use crate::effects::limiter::{Limiter, LimiterSettings};
use crate::effects::mb_dynamics::{MbDynamicsKernel, MbDynamicsSettings};
use crate::effects::multiband::{MultibandKernel, MultibandSettings};
use crate::effects::param_eq::{ParamEqKernel, ParamEqSettings};
use crate::effects::utility::{UtilityKernel, UtilitySettings};
use crate::params::ParamSource;

/// An effect's settings, made from its parameters.
#[derive(Clone, Debug, PartialEq)]
pub enum EffectSettings {
    Compressor(CompressorSettings),
    Gate(GateSettings),
    Glue(GlueSettings),
    Limiter(LimiterSettings),
    MbDynamics(Box<MbDynamicsSettings>),
    Multiband(Box<MultibandSettings>),
    ParamEq(Box<ParamEqSettings>),
    Utility(UtilitySettings),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EffectKind {
    Compressor,
    Gate,
    Glue,
    Limiter,
    MbDynamics,
    Multiband,
    ParamEq,
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
            "compressor" => Self::Compressor(CompressorSettings::from_params(params, false)),
            "gate" => Self::Gate(GateSettings::from_params(params, false)),
            "glue" => Self::Glue(GlueSettings::from_params(params, false)),
            "limiter" => Self::Limiter(LimiterSettings::from_params(params)),
            "mbDynamics" => {
                Self::MbDynamics(Box::new(MbDynamicsSettings::from_params(params, false)))
            }
            "multiband" => Self::Multiband(Box::new(MultibandSettings::from_params(params, false))),
            "paramEq" => Self::ParamEq(Box::new(ParamEqSettings::from_params(params))),
            "utility" => Self::Utility(UtilitySettings::from_params(params)),
            _ => return None,
        })
    }

    pub fn kind(&self) -> EffectKind {
        match self {
            Self::Compressor(_) => EffectKind::Compressor,
            Self::Gate(_) => EffectKind::Gate,
            Self::Glue(_) => EffectKind::Glue,
            Self::Limiter(_) => EffectKind::Limiter,
            Self::MbDynamics(_) => EffectKind::MbDynamics,
            Self::Multiband(_) => EffectKind::Multiband,
            Self::ParamEq(_) => EffectKind::ParamEq,
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
    Compressor(Box<CompressorKernel>),
    Gate(Box<GateKernel>),
    Glue(Box<GlueKernel>),
    /// With a copy of its input, as it doesn't work in place.
    Limiter(Box<Limiter>, Box<[f32]>, Box<[f32]>),
    MbDynamics(Box<MbDynamicsKernel>),
    Multiband(Box<MultibandKernel>),
    ParamEq(Box<ParamEqKernel>),
    Utility(Box<UtilityKernel>),
}

/// An effect's kernel, made off the audio thread.
pub struct Effect {
    kernel: Kernel,
}

impl Effect {
    pub fn new(settings: &EffectSettings, sample_rate: f64) -> Self {
        let kernel = match settings {
            EffectSettings::Compressor(s) => {
                Kernel::Compressor(Box::new(CompressorKernel::new(sample_rate, s)))
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
            EffectSettings::Utility(s) => {
                Kernel::Utility(Box::new(UtilityKernel::new(sample_rate, s)))
            }
        };
        Self { kernel }
    }

    pub fn kind(&self) -> EffectKind {
        match self.kernel {
            Kernel::Compressor(_) => EffectKind::Compressor,
            Kernel::Gate(_) => EffectKind::Gate,
            Kernel::Glue(_) => EffectKind::Glue,
            Kernel::Limiter(..) => EffectKind::Limiter,
            Kernel::MbDynamics(_) => EffectKind::MbDynamics,
            Kernel::Multiband(_) => EffectKind::Multiband,
            Kernel::ParamEq(_) => EffectKind::ParamEq,
            Kernel::Utility(_) => EffectKind::Utility,
        }
    }

    /// Takes the settings of a new version of the song (on the audio
    /// thread: it only copies).
    pub fn configure(&mut self, settings: &EffectSettings) {
        match (&mut self.kernel, settings) {
            (Kernel::Compressor(k), EffectSettings::Compressor(s)) => k.set(s),
            (Kernel::Gate(k), EffectSettings::Gate(s)) => k.set(s),
            (Kernel::Glue(k), EffectSettings::Glue(s)) => k.set(s),
            (Kernel::Limiter(k, ..), EffectSettings::Limiter(s)) => k.set(*s),
            (Kernel::MbDynamics(k), EffectSettings::MbDynamics(s)) => k.set(s),
            (Kernel::Multiband(k), EffectSettings::Multiband(s)) => k.set(s),
            (Kernel::ParamEq(k), EffectSettings::ParamEq(s)) => k.set(s),
            (Kernel::Utility(k), EffectSettings::Utility(s)) => k.set(s),
            _ => {}
        }
    }

    /// Processes a stereo block (at most `MAX_BLOCK` frames) in place.
    pub fn process(&mut self, l: &mut [f32], r: &mut [f32]) {
        let n = l.len().min(r.len());
        match &mut self.kernel {
            Kernel::Compressor(k) => k.process_in_place(&mut l[..n], Some(&mut r[..n]), None, None),
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
            Kernel::Utility(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
        }
    }
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
