//! A MIDI track's instrument as the engine plays it: the kernel (the Drum
//! Rack, the piano, the synth), the notes its clips have sounding, and the
//! keys held live (with the sustain pedal, pitch bend and mod wheel), which
//! carry on from one version of the song to the next.
//!
//! As in the browser's engine (`audioEngine.ts`): a clip's notes start and
//! end where they sit; stopping, jumping and looping back release them
//! (`releaseAll`, which the Drum Rack ignores - its hits ring out); a key
//! played live sounds until it's let go, or until the pedal lifts if it
//! was down.

use std::sync::Arc;

use super::clip::AudioData;
use super::song::MAX_BLOCK;
use crate::instruments::drums::{DrumEvent, DrumEventKind, DrumKit, Drums, PAD_COUNT};
use crate::instruments::piano::{Piano, PianoEvent, PianoEventKind, PianoSample};
use crate::instruments::synth::{Synth, SynthEvent, SynthEventKind, SynthSettings, Wavetable};

/// What plays a track's notes, with its settings.
#[derive(Clone, Debug)]
pub enum InstrumentSpec {
    Drums {
        kit: Box<DrumKit>,
        /// The sample pads' files, at the engine's rate.
        samples: [Option<Arc<AudioData>>; PAD_COUNT],
    },
    Piano {
        /// Sorted by note; none until they've arrived.
        samples: Option<Arc<[PianoSample]>>,
    },
    Synth {
        settings: Box<SynthSettings>,
        /// Oscillator 1's wavetable, oscillator 2's and the sub's shapes.
        /// It plays nothing until it has all three (as in the browser,
        /// where it starts once they're built).
        tables: [Option<Wavetable>; 3],
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstrumentKind {
    Drums,
    Piano,
    Synth,
}

impl InstrumentSpec {
    pub fn kind(&self) -> InstrumentKind {
        match self {
            InstrumentSpec::Drums { .. } => InstrumentKind::Drums,
            InstrumentSpec::Piano { .. } => InstrumentKind::Piano,
            InstrumentSpec::Synth { .. } => InstrumentKind::Synth,
        }
    }
}

/// A note on a track's timeline, in frames.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Note {
    pub start: i64,
    pub end: i64,
    pub key: i32,
    /// 0-1.
    pub velocity: f64,
}

enum Kernel {
    Drums(Box<Drums>),
    Piano(Box<Piano>),
    Synth(Box<Synth>),
}

const KEYS: usize = 128;

pub struct Player {
    sample_rate: f64,
    kernel: Kernel,
    /// When each key's clip note ends (frames on the timeline), while one
    /// is sounding.
    clip_ends: [Option<i64>; KEYS],
    /// Keys held live.
    held: [bool; KEYS],
    sustain: bool,
    /// Keys let go while the pedal was down: released when it lifts.
    sustained: [bool; KEYS],
    out_l: Vec<f32>,
    out_r: Vec<f32>,
}

impl Player {
    /// A player for `spec`'s instrument (made off the audio thread).
    pub fn new(spec: &InstrumentSpec, sample_rate: f64) -> Self {
        let kernel = match spec {
            InstrumentSpec::Drums { .. } => Kernel::Drums(Box::new(Drums::new(sample_rate))),
            InstrumentSpec::Piano { .. } => Kernel::Piano(Box::new(Piano::new(sample_rate))),
            InstrumentSpec::Synth { .. } => Kernel::Synth(Box::new(Synth::new(sample_rate))),
        };
        let mut player = Self {
            sample_rate,
            kernel,
            clip_ends: [None; KEYS],
            held: [false; KEYS],
            sustain: false,
            sustained: [false; KEYS],
            out_l: vec![0.0; MAX_BLOCK],
            out_r: vec![0.0; MAX_BLOCK],
        };
        player.configure(spec);
        player
    }

    pub fn kind(&self) -> InstrumentKind {
        match self.kernel {
            Kernel::Drums(_) => InstrumentKind::Drums,
            Kernel::Piano(_) => InstrumentKind::Piano,
            Kernel::Synth(_) => InstrumentKind::Synth,
        }
    }

    /// Takes the settings of a new version of the song (on the audio
    /// thread: it only copies, and the files it lets go of are still the
    /// old song's).
    pub fn configure(&mut self, spec: &InstrumentSpec) {
        match (&mut self.kernel, spec) {
            (Kernel::Drums(k), InstrumentSpec::Drums { kit, samples }) => {
                k.set_kit(**kit);
                for (pad, sample) in samples.iter().enumerate() {
                    k.set_sample(pad, sample.clone());
                }
            }
            (Kernel::Piano(k), InstrumentSpec::Piano { samples }) => k.set_samples(samples.clone()),
            (Kernel::Synth(k), InstrumentSpec::Synth { settings, tables }) => {
                k.set_settings(settings);
                for (slot, table) in tables.iter().enumerate() {
                    k.set_table(slot, table.clone());
                }
            }
            _ => {}
        }
    }

    /// The song's tempo, which the synth's synced LFOs follow (its
    /// starting tempo, as in the browser).
    pub fn set_tempo(&mut self, bpm: f64) {
        if let Kernel::Synth(k) = &mut self.kernel {
            k.set_bpm(bpm);
        }
    }

    /// The pitch bend, -1..1 of the instrument's bend range (only the
    /// synth bends).
    pub fn set_bend(&mut self, bend: f64) {
        if let Kernel::Synth(k) = &mut self.kernel {
            k.set_bend(bend.clamp(-1.0, 1.0));
        }
    }

    /// The mod wheel, 0..1 (only the synth has a use for it).
    pub fn set_mod_wheel(&mut self, amount: f64) {
        if let Kernel::Synth(k) = &mut self.kernel {
            k.set_mod_wheel(amount.clamp(0.0, 1.0));
        }
    }

    fn seconds(&self, frame: u64) -> f64 {
        frame as f64 / self.sample_rate
    }

    fn key(key: i32) -> Option<usize> {
        usize::try_from(key).ok().filter(|k| *k < KEYS)
    }

    fn on(&mut self, key: i32, vel: f64, at: u64) {
        let time = self.seconds(at);
        match &mut self.kernel {
            Kernel::Drums(k) => k.add_event(DrumEvent {
                time,
                kind: DrumEventKind::On { note: key, vel },
            }),
            Kernel::Piano(k) => k.add_event(PianoEvent {
                time,
                kind: PianoEventKind::On { note: key, vel },
            }),
            // Not until its wavetables are in.
            Kernel::Synth(k) if !(0..3).all(|slot| k.table(slot).is_some()) => {}
            Kernel::Synth(k) => k.add_event(SynthEvent {
                time,
                kind: SynthEventKind::On { note: key, vel },
            }),
        }
    }

    fn off(&mut self, key: i32, at: u64) {
        let time = self.seconds(at);
        match &mut self.kernel {
            // Hits ring out on their own.
            Kernel::Drums(_) => {}
            Kernel::Piano(k) => k.add_event(PianoEvent {
                time,
                kind: PianoEventKind::Off { note: key },
            }),
            Kernel::Synth(k) => k.add_event(SynthEvent {
                time,
                kind: SynthEventKind::Off { note: key },
            }),
        }
    }

    /// Every note releases (`releaseAll`), at `at` on the engine's clock.
    pub fn release_all(&mut self, at: u64) {
        let time = self.seconds(at);
        match &mut self.kernel {
            // Tails keep ringing when playback stops, like a drum machine's.
            Kernel::Drums(_) => {}
            Kernel::Piano(k) => k.add_event(PianoEvent {
                time,
                kind: PianoEventKind::AllOff,
            }),
            Kernel::Synth(k) => k.add_event(SynthEvent {
                time,
                kind: SynthEventKind::AllOff,
            }),
        }
        self.clip_ends = [None; KEYS];
        self.sustained = [false; KEYS];
    }

    /// The clips' notes sounding stop, at `at` (a jump or the loop going
    /// back).
    pub fn release_clip_notes(&mut self, at: u64) {
        for key in 0..KEYS {
            if self.clip_ends[key].take().is_some() {
                self.off(key as i32, at);
            }
        }
    }

    /// The clips' notes over the timeline's frames [pos, pos + len), which
    /// the engine renders from `at` on its clock.
    pub fn schedule(&mut self, notes: &[Note], pos: i64, len: usize, at: u64) {
        let end = pos + len as i64;
        let frame = |t: i64| at + (t.max(pos) - pos) as u64;
        // Notes ending here (or already past their end).
        for key in 0..KEYS {
            if let Some(e) = self.clip_ends[key]
                && e < end
            {
                self.clip_ends[key] = None;
                self.off(key as i32, frame(e));
            }
        }
        // Notes starting here.
        let first = notes.partition_point(|n| n.start < pos);
        for n in notes[first..].iter().take_while(|n| n.start < end) {
            let Some(key) = Self::key(n.key) else {
                continue;
            };
            if self.clip_ends[key].take().is_some() {
                self.off(n.key, frame(n.start));
            }
            self.on(n.key, n.velocity, frame(n.start));
            if n.end < end {
                self.off(n.key, frame(n.end));
            } else {
                self.clip_ends[key] = Some(n.end);
            }
        }
    }

    /// A key pressed live, at `at` on the engine's clock.
    pub fn key_down(&mut self, key: i32, vel: f64, at: u64) {
        let Some(k) = Self::key(key) else {
            return;
        };
        if self.held[k] {
            return;
        }
        self.held[k] = true;
        self.sustained[k] = false;
        self.on(key, vel, at);
    }

    /// A key let go live: it releases, or waits for the pedal to lift.
    pub fn key_up(&mut self, key: i32, at: u64) {
        let Some(k) = Self::key(key) else {
            return;
        };
        if !self.held[k] {
            return;
        }
        self.held[k] = false;
        if self.sustain {
            self.sustained[k] = true;
        } else {
            self.off(key, at);
        }
    }

    /// The sustain pedal (CC64).
    pub fn set_sustain(&mut self, down: bool, at: u64) {
        self.sustain = down;
        if !down {
            for k in 0..KEYS {
                if std::mem::take(&mut self.sustained[k]) {
                    self.off(k as i32, at);
                }
            }
        }
    }

    /// Renders `n` frames from `at` on the engine's clock; returns them.
    pub fn render(&mut self, n: usize, at: u64) -> (&[f32], &[f32]) {
        let now = self.seconds(at);
        let (l, r) = (&mut self.out_l[..n], &mut self.out_r[..n]);
        match &mut self.kernel {
            Kernel::Drums(k) => k.render(l, r, now),
            Kernel::Piano(k) => {
                l.fill(0.0);
                r.fill(0.0);
                k.render(l, r, now);
            }
            Kernel::Synth(k) => k.render(l, r, now),
        }
        (&self.out_l[..n], &self.out_r[..n])
    }
}

/// A track's id as the commands that play it live name it: 64-bit FNV-1a
/// (so a command needn't carry the id's text to the audio thread).
pub fn track_key(id: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in id.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}
