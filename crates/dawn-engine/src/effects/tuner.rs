//! The Tuner.
//!
//! Port of the studio's node (`src/effects/tuner/tuner.ts`): the input
//! passes straight through, or fades out over 10 ms when Mute is on (and
//! back in when it's off), as its Gain's `rampTo` does; and what came in
//! is kept for the studio to find its pitch in (`tunerModel.ts`), as its
//! Analyser keeps it: the last 4096 samples of the left side (a
//! one-channel Analyser takes a stereo input's first channel only).
//! `tests/tuner_parity.rs` holds the port to what Chromium renders. No
//! latency.
//!
//! The samples go into a `TunerTap`, which the settings carry: the app
//! keeps the song, so it reads them from there off the audio thread.

use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use crate::params::ParamSource;

/// The samples kept (the Analyser's size).
pub const TUNER_WINDOW: usize = 4096;

/// How long Mute takes to fade (s).
const FADE: f64 = 0.01;

/// The last `TUNER_WINDOW` samples into a Tuner, written on the audio
/// thread and read off it. A read while a block is being written can mix
/// in a few of its samples; for finding a pitch that doesn't matter.
pub struct TunerTap {
    samples: Box<[AtomicU32]>,
    /// The samples written so far.
    written: AtomicUsize,
    /// The tap a kernel wrote to before this one, to be freed with this
    /// one (off the audio thread).
    replaced: Mutex<Option<Arc<TunerTap>>>,
}

impl TunerTap {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            samples: (0..TUNER_WINDOW).map(|_| AtomicU32::new(0)).collect(),
            written: AtomicUsize::new(0),
            replaced: Mutex::new(None),
        })
    }

    /// The last `TUNER_WINDOW` samples, oldest first (silence before the
    /// first).
    pub fn waveform(&self) -> Vec<f32> {
        let end = self.written.load(Ordering::Acquire);
        (end..end + TUNER_WINDOW)
            .map(|i| f32::from_bits(self.samples[i % TUNER_WINDOW].load(Ordering::Relaxed)))
            .collect()
    }
}

impl std::fmt::Debug for TunerTap {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "TunerTap({} written)",
            self.written.load(Ordering::Relaxed)
        )
    }
}

#[derive(Clone, Debug)]
pub struct TunerSettings {
    pub mute: bool,
    /// Where its kernel puts what comes in.
    pub tap: Arc<TunerTap>,
}

impl PartialEq for TunerSettings {
    fn eq(&self, other: &Self) -> bool {
        self.mute == other.mute
    }
}

impl TunerSettings {
    /// The settings for the effect's parameters (its `index.ts`; the
    /// reference pitch and the note names are the studio's to read by).
    pub fn from_params<P: ParamSource + ?Sized>(p: &P) -> Self {
        Self {
            mute: p.param_or("mute", 0.0) >= 0.5,
            tap: TunerTap::new(),
        }
    }

    /// Keeps the tap of `previous` (this effect's settings in the song
    /// playing), so its kernel carries on writing where the app reads.
    pub fn prepare(&mut self, previous: Option<&Self>) {
        if let Some(p) = previous {
            self.tap = p.tap.clone();
        }
    }
}

pub struct TunerKernel {
    sample_rate: f64,
    tap: Arc<TunerTap>,
    written: usize,
    /// The gain now, and the fade it's on: from, to, frames into it.
    gain: f32,
    fade: Option<(f32, f32, usize)>,
    mute: bool,
}

impl TunerKernel {
    pub fn new(sample_rate: f64, s: &TunerSettings) -> Self {
        let mut k = Self {
            sample_rate,
            tap: s.tap.clone(),
            written: s.tap.written.load(Ordering::Relaxed),
            gain: 1.0,
            fade: None,
            // The node starts unmuted, and fades out from there when it's
            // made muted.
            mute: false,
        };
        k.set(s);
        k
    }

    /// Takes new settings (on the audio thread: it only copies; a tap it
    /// replaces goes with the new one, to be freed off the audio thread).
    pub fn set(&mut self, s: &TunerSettings) {
        if !Arc::ptr_eq(&self.tap, &s.tap) {
            let old = std::mem::replace(&mut self.tap, s.tap.clone());
            if let Ok(mut replaced) = s.tap.replaced.try_lock()
                && replaced.is_none()
            {
                *replaced = Some(old);
            }
            self.written = s.tap.written.load(Ordering::Relaxed);
        }
        if s.mute != self.mute {
            self.mute = s.mute;
            self.fade = Some((self.gain, if s.mute { 0.0 } else { 1.0 }, 0));
        }
    }

    pub fn process_in_place(&mut self, l: &mut [f32], r: &mut [f32]) {
        let fade_frames = FADE * self.sample_rate;
        for (x_l, x_r) in l.iter_mut().zip(r.iter_mut()) {
            self.tap.samples[self.written % TUNER_WINDOW].store(x_l.to_bits(), Ordering::Relaxed);
            self.written = self.written.wrapping_add(1);
            if let Some((from, to, at)) = self.fade {
                if at as f64 >= fade_frames {
                    self.gain = to;
                    self.fade = None;
                } else {
                    self.gain = (from as f64
                        + (to as f64 - from as f64) * (at as f64 / fade_frames))
                        as f32;
                    self.fade = Some((from, to, at + 1));
                }
            }
            *x_l *= self.gain;
            *x_r *= self.gain;
        }
        self.tap.written.store(self.written, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_last_window_of_the_left_side() {
        let s = TunerSettings::from_params(&[]);
        let mut k = TunerKernel::new(48000.0, &s);
        let n = TUNER_WINDOW + 1000;
        let mut l: Vec<f32> = (0..n).map(|i| i as f32).collect();
        let mut r = vec![-1.0f32; n];
        for (a, b) in l.chunks_mut(300).zip(r.chunks_mut(300)) {
            k.process_in_place(a, b);
        }
        // It passes through.
        assert_eq!(l[n - 1], (n - 1) as f32);
        let w = s.tap.waveform();
        assert_eq!(w.len(), TUNER_WINDOW);
        assert_eq!(w[0], 1000.0);
        assert_eq!(w[TUNER_WINDOW - 1], (n - 1) as f32);
    }

    #[test]
    fn mute_fades_out_and_a_new_version_keeps_the_tap() {
        let first = TunerSettings::from_params(&[]);
        let mut k = TunerKernel::new(48000.0, &first);
        let mut muted = TunerSettings::from_params(&[("mute", 1.0)]);
        muted.prepare(Some(&first));
        assert!(Arc::ptr_eq(&first.tap, &muted.tap));
        k.set(&muted);
        let (mut l, mut r) = (vec![1.0f32; 1000], vec![1.0f32; 1000]);
        k.process_in_place(&mut l, &mut r);
        assert_eq!(l[0], 1.0);
        assert!((l[240] - 0.5).abs() < 1e-6);
        assert!(l[480..].iter().all(|v| *v == 0.0));
        // What it hears is from before the mute.
        assert_eq!(muted.tap.waveform()[TUNER_WINDOW - 1], 1.0);
    }
}
