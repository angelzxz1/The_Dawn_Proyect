//! The piano: a sampler that plays as the studio's does (Tone.js's
//! Sampler, `src/instruments/piano/audio.ts`). A note plays the nearest
//! sample (the higher one when two are as near), sped up or slowed down to
//! its pitch, at its velocity as a gain, to the end of the sample. Releasing
//! it fades it out over a second along Tone's curve: an exponential
//! approach toward silence (time constant ln 2 / ln 200), then for the last
//! tenth a straight line to zero.
//!
//! Resampling is linear, as browsers do it for a buffer played at another
//! rate. The samples come decoded at the engine's rate.

use std::sync::Arc;

use crate::mix::AudioData;

/// Voices playing at once; a note past them takes the oldest one's place.
const MAX_VOICES: usize = 96;
const EVENT_CAPACITY: usize = 1024;
/// How long a released note takes to fade out (s): the piano's release.
pub const RELEASE: f64 = 1.0;
/// How far Tone looks for a sample (semitones each way).
const MAX_INTERVAL: i32 = 96;

/// One of the piano's samples: the note it was recorded at.
#[derive(Clone, Debug)]
pub struct PianoSample {
    pub note: i32,
    pub audio: Arc<AudioData>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PianoEventKind {
    On {
        note: i32,
        vel: f64,
    },
    Off {
        note: i32,
    },
    /// Every note releases.
    AllOff,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PianoEvent {
    /// Seconds, on the clock `render` is given.
    pub time: f64,
    pub kind: PianoEventKind,
}

#[derive(Clone, Copy, Default)]
struct Voice {
    active: bool,
    note: i32,
    age: u64,
    /// Which sample, and where in it (frames).
    sample: usize,
    pos: f64,
    rate: f64,
    gain: f64,
    /// Frames since its release, if it's been released.
    released: Option<u64>,
    /// The gain when it was released.
    from: f64,
}

pub struct Piano {
    sr: f64,
    samples: Option<Arc<[PianoSample]>>,
    voices: Box<[Voice; MAX_VOICES]>,
    events: Vec<PianoEvent>,
    counter: u64,
    /// The release's time constant, in frames.
    tau: f64,
}

impl Piano {
    pub fn new(sample_rate: f64) -> Self {
        Self {
            sr: sample_rate,
            samples: None,
            voices: Box::new([Voice::default(); MAX_VOICES]),
            events: Vec::with_capacity(EVENT_CAPACITY),
            counter: 0,
            tau: (RELEASE + 1.0).ln() / 200f64.ln() * sample_rate,
        }
    }

    /// The samples, sorted by note. The same files again (a new version of
    /// the song) change nothing; others stop the voices playing the old.
    pub fn set_samples(&mut self, samples: Option<Arc<[PianoSample]>>) {
        let same = match (&self.samples, &samples) {
            (Some(a), Some(b)) => {
                a.len() == b.len()
                    && a.iter()
                        .zip(b.iter())
                        .all(|(x, y)| x.note == y.note && Arc::ptr_eq(&x.audio, &y.audio))
            }
            (None, None) => true,
            _ => false,
        };
        if !same {
            self.voices.iter_mut().for_each(|v| v.active = false);
            self.samples = samples;
        }
    }

    pub fn samples(&self) -> Option<&Arc<[PianoSample]>> {
        self.samples.as_ref()
    }

    pub fn add_event(&mut self, e: PianoEvent) {
        if self.events.len() == self.events.capacity() {
            return;
        }
        let mut i = self.events.len();
        while i > 0 && self.events[i - 1].time > e.time {
            i -= 1;
        }
        self.events.insert(i, e);
    }

    /// The sample for `note` (Tone's `_findClosest`): the nearest, looking
    /// above first.
    fn closest(samples: &[PianoSample], note: i32) -> Option<usize> {
        for interval in 0..MAX_INTERVAL {
            if let Some(i) = samples.iter().position(|s| s.note == note + interval) {
                return Some(i);
            }
            if let Some(i) = samples.iter().position(|s| s.note == note - interval) {
                return Some(i);
            }
        }
        None
    }

    fn note_on(&mut self, note: i32, vel: f64) {
        let Some(samples) = &self.samples else {
            return;
        };
        let Some(sample) = Self::closest(samples, note) else {
            return;
        };
        let difference = note - samples[sample].note;
        self.counter += 1;
        let slot = self
            .voices
            .iter()
            .position(|v| !v.active)
            .unwrap_or_else(|| {
                let mut oldest = 0;
                for (i, v) in self.voices.iter().enumerate() {
                    if v.age < self.voices[oldest].age {
                        oldest = i;
                    }
                }
                oldest
            });
        self.voices[slot] = Voice {
            active: true,
            note,
            age: self.counter,
            sample,
            pos: 0.0,
            rate: 2f64.powf(difference as f64 / 12.0),
            gain: vel,
            released: None,
            from: 0.0,
        };
    }

    fn release(v: &mut Voice) {
        if v.active && v.released.is_none() {
            v.released = Some(0);
            v.from = v.gain;
        }
    }

    /// Renders (adding into) out_l/out_r; `now` is the clock time (s) of
    /// the first frame.
    pub fn render(&mut self, out_l: &mut [f32], out_r: &mut [f32], now: f64) {
        let n = out_l.len().min(out_r.len());
        let mut f = 0;
        while f < n {
            while let Some(e) = self.events.first().copied() {
                if super::js_round((e.time - now) * self.sr) > f as f64 {
                    break;
                }
                self.events.remove(0);
                match e.kind {
                    PianoEventKind::On { note, vel } => self.note_on(note, vel),
                    PianoEventKind::Off { note } => self
                        .voices
                        .iter_mut()
                        .filter(|v| v.note == note)
                        .for_each(Self::release),
                    PianoEventKind::AllOff => self.voices.iter_mut().for_each(Self::release),
                }
            }
            let mut len = n - f;
            if let Some(e) = self.events.first() {
                let at = super::js_round((e.time - now) * self.sr);
                if at > f as f64 && at - (f as f64) < len as f64 {
                    len = at as usize - f;
                }
            }
            self.render_voices(&mut out_l[f..f + len], &mut out_r[f..f + len]);
            f += len;
        }
    }

    fn render_voices(&mut self, out_l: &mut [f32], out_r: &mut [f32]) {
        let Some(samples) = &self.samples else {
            return;
        };
        let release = RELEASE * self.sr;
        let tail = 0.9 * release;
        let tau = self.tau;
        for v in self.voices.iter_mut().filter(|v| v.active) {
            let data = &samples[v.sample].audio;
            let left = &data.channels[0];
            let right = data.channels.get(1).unwrap_or(left);
            let last = left.len().saturating_sub(1) as f64;
            for i in 0..out_l.len() {
                if v.pos >= last {
                    v.active = false;
                    break;
                }
                let gain = match v.released {
                    None => v.gain,
                    Some(t) => {
                        let t = t as f64;
                        if t >= release {
                            v.active = false;
                            break;
                        }
                        let approach = |t: f64| v.from * (-t / tau).exp();
                        let g = if t < tail {
                            approach(t)
                        } else {
                            approach(tail) * (release - t) / (release - tail)
                        };
                        v.released = Some(t as u64 + 1);
                        g
                    }
                };
                let i0 = v.pos.floor();
                let fr = v.pos - i0;
                let i0 = i0 as usize;
                let i1 = i0 + 1;
                let l = left[i0] as f64 + (left[i1] as f64 - left[i0] as f64) * fr;
                let r = right[i0] as f64 + (right[i1] as f64 - right[i0] as f64) * fr;
                out_l[i] += (l * gain) as f32;
                out_r[i] += (r * gain) as f32;
                v.pos += v.rate;
            }
        }
    }

    pub fn active_count(&self) -> usize {
        self.voices.iter().filter(|v| v.active).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f64 = 48000.0;

    /// A sample of `frames` frames of 1.0 (so a voice's output is its gain).
    fn flat(note: i32, frames: usize) -> PianoSample {
        PianoSample {
            note,
            audio: Arc::new(AudioData {
                channels: vec![vec![1.0; frames]],
            }),
        }
    }

    fn piano(samples: Vec<PianoSample>) -> Piano {
        let mut p = Piano::new(SR);
        p.set_samples(Some(samples.into()));
        p
    }

    fn render(p: &mut Piano, frames: usize, now: f64) -> Vec<f32> {
        let mut l = vec![0.0; frames];
        let mut r = vec![0.0; frames];
        p.render(&mut l, &mut r, now);
        assert_eq!(l, r);
        l
    }

    #[test]
    fn plays_the_nearest_sample_looking_above_first() {
        let samples: Vec<PianoSample> = [57, 60, 63].map(|n| flat(n, 100)).into();
        assert_eq!(Piano::closest(&samples, 60), Some(1));
        assert_eq!(Piano::closest(&samples, 61), Some(1));
        // As near to 60 as to 63: the higher.
        assert_eq!(Piano::closest(&samples, 62), Some(2));
        assert_eq!(Piano::closest(&samples, 20), Some(0));
        assert_eq!(Piano::closest(&[], 60), None);
    }

    #[test]
    fn a_note_starts_on_its_sample_at_its_velocity() {
        let mut p = piano(vec![flat(60, 48000)]);
        p.add_event(PianoEvent {
            time: 1.0 + 10.0 / SR,
            kind: PianoEventKind::On { note: 60, vel: 0.5 },
        });
        let out = render(&mut p, 32, 1.0);
        assert!(out[..10].iter().all(|x| *x == 0.0));
        assert!(out[10..].iter().all(|x| *x == 0.5));
    }

    #[test]
    fn a_higher_note_plays_its_sample_faster_and_ends_sooner() {
        let mut p = piano(vec![flat(60, 1200)]);
        p.add_event(PianoEvent {
            time: 0.0,
            kind: PianoEventKind::On { note: 72, vel: 1.0 },
        });
        let out = render(&mut p, 1000, 0.0);
        // An octave up: twice as fast, so 1200 frames last 600.
        assert!(out[598] > 0.0);
        assert!(out[601..].iter().all(|x| *x == 0.0));
        assert_eq!(p.active_count(), 0);
    }

    #[test]
    fn a_release_fades_out_over_a_second_along_tones_curve() {
        let mut p = piano(vec![flat(60, 96000)]);
        p.add_event(PianoEvent {
            time: 0.0,
            kind: PianoEventKind::On { note: 60, vel: 1.0 },
        });
        p.add_event(PianoEvent {
            time: 0.1,
            kind: PianoEventKind::Off { note: 60 },
        });
        let out = render(&mut p, 60000, 0.0);
        let released = 4800;
        assert_eq!(out[released - 1], 1.0);
        let tau = 2f64.ln() / 200f64.ln();
        let at = |s: f64| out[released + (s * SR) as usize] as f64;
        assert!((at(0.1) - (-0.1 / tau).exp()).abs() < 1e-4);
        assert!((at(0.5) - (-0.5 / tau).exp()).abs() < 1e-4);
        // The last tenth: a line from there to 0.
        let start = (-0.9 / tau).exp();
        assert!((at(0.95) - start * 0.5).abs() < 1e-4);
        assert!(out[released + 48000..].iter().all(|x| *x == 0.0));
        assert_eq!(p.active_count(), 0);
    }

    #[test]
    fn all_off_releases_every_note() {
        let mut p = piano(vec![flat(60, 96000)]);
        for (i, note) in [60, 64, 67].into_iter().enumerate() {
            p.add_event(PianoEvent {
                time: i as f64 * 0.001,
                kind: PianoEventKind::On { note, vel: 0.3 },
            });
        }
        p.add_event(PianoEvent {
            time: 0.01,
            kind: PianoEventKind::AllOff,
        });
        render(&mut p, 48000 + 1000, 0.0);
        assert_eq!(p.active_count(), 0);
    }
}
