//! What the engine plays: the song as the studio describes it - tracks with
//! their clips, levels and routing, the send/return buses, the master and
//! the tempo map - ready for the audio thread: clips in frames, levels as
//! gains, and the order tracks are mixed in (a track feeding another first).
//!
//! The studio works out the routing (`src/engine/mixGraph.ts`: where each
//! track goes, which are heard with mute and solo) and sends the result; the
//! engine only renders it.
//!
//! A MIDI track has its notes and its instrument; the instrument that plays
//! them lives on from one version of the song to the next (`Player`), so a
//! change doesn't cut off what's ringing. So do the effects in the tracks',
//! buses' and master's chains (`fx`).

use std::sync::Arc;

use super::clip::Clip;
use super::fx::{self, Chain, Effect, EffectSpec};
use super::latency::{self, Delay, MAX_COMPENSATION, Path, Plan, Ring};
use super::player::{InstrumentSpec, Note, Player, track_key};
use super::tempo::{TempoSegment, constant};
use crate::effects::limiter::{LimiterSettings, lookahead_frames};

/// The longest block the engine renders in one go (frames); longer ones are
/// split. Every buffer is this long, so rendering never allocates.
pub const MAX_BLOCK: usize = 2048;

/// Where a track's strip goes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Destination {
    Master,
    /// Into another track (its index), ahead of that track's effects.
    Track(usize),
}

/// A send from a track (post-fader) to a bus.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Send {
    pub bus: usize,
    /// Linear.
    pub gain: f64,
}

/// dB to a linear gain (-Infinity: 0), as Tone's `dbToGain`.
pub fn db_to_gain(db: f64) -> f64 {
    if db == f64::NEG_INFINITY {
        0.0
    } else {
        10f64.powf(db / 20.0)
    }
}

#[derive(Clone, Debug)]
pub struct Track {
    /// The studio's id for it.
    pub id: String,
    /// The fader, linear.
    pub volume: f64,
    /// -1 (left) to 1 (right).
    pub pan: f64,
    /// Heard: not muted, and on a soloed path if anything is soloed.
    pub audible: bool,
    pub destination: Destination,
    pub sends: Vec<Send>,
    /// In the order they start.
    pub clips: Vec<Clip>,
    /// What plays its notes (a MIDI track's instrument), if anything.
    pub instrument: Option<InstrumentSpec>,
    /// Its MIDI clips' notes, in the order they start.
    pub notes: Vec<Note>,
    /// Its effects, in order (ahead of its fader).
    pub effects: Vec<EffectSpec>,
    /// Played live (the armed MIDI track): delay compensation doesn't hold
    /// it back, nor the tracks it plays through.
    pub live: bool,
}

impl Track {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            volume: 1.0,
            pan: 0.0,
            audible: true,
            destination: Destination::Master,
            sends: vec![],
            clips: vec![],
            instrument: None,
            notes: vec![],
            effects: vec![],
            live: false,
        }
    }
}

/// A send/return bus: fed by the tracks' sends, into the master.
#[derive(Clone, Debug)]
pub struct Bus {
    pub id: String,
    pub volume: f64,
    pub pan: f64,
    /// Its effects, in order (ahead of its fader).
    pub effects: Vec<EffectSpec>,
}

impl Bus {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            volume: 1.0,
            pan: 0.0,
            effects: vec![],
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Master {
    pub volume: f64,
    pub pan: f64,
    /// The limiter guarding the output.
    pub limiter: LimiterSettings,
}

impl Default for Master {
    fn default() -> Self {
        Self {
            volume: 1.0,
            pan: 0.0,
            limiter: LimiterSettings::from_db(-1.0, 0.0, 0.1, false),
        }
    }
}

/// The song as the studio describes it.
#[derive(Clone, Debug)]
pub struct Song {
    pub tracks: Vec<Track>,
    pub buses: Vec<Bus>,
    pub master: Master,
    /// The master's effects, in order (after its fader, ahead of the
    /// limiter).
    pub master_effects: Vec<EffectSpec>,
    /// The tempo map (not empty).
    pub tempo: Vec<TempoSegment>,
    pub beats_per_bar: f64,
    /// Delay compensation (`latency`): every path waits for the most
    /// latent, so they reach the master together.
    pub compensation: bool,
}

impl Default for Song {
    fn default() -> Self {
        Self {
            tracks: vec![],
            buses: vec![],
            master: Master::default(),
            master_effects: vec![],
            tempo: constant(120.0).to_vec(),
            beats_per_bar: 4.0,
            compensation: true,
        }
    }
}

/// A stereo buffer `MAX_BLOCK` long.
#[derive(Clone, Debug)]
pub(crate) struct Stereo {
    pub l: Vec<f32>,
    pub r: Vec<f32>,
}

impl Stereo {
    pub fn new() -> Self {
        Self {
            l: vec![0.0; MAX_BLOCK],
            r: vec![0.0; MAX_BLOCK],
        }
    }

    pub fn clear(&mut self, n: usize) {
        self.l[..n].fill(0.0);
        self.r[..n].fill(0.0);
    }
}

/// A strip's level and pan as the audio thread last applied them, so a
/// change glides over a block instead of clicking.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Applied {
    pub gain: f64,
    pub pan: f64,
}

/// A song ready to render: its buffers, the mixing order, and the meters.
/// Made off the audio thread (`Song::prepare`).
pub struct Prepared {
    pub song: Song,
    /// Track indices, every track before the one it feeds.
    pub(crate) order: Vec<usize>,
    pub(crate) track_bufs: Vec<Stereo>,
    pub(crate) bus_bufs: Vec<Stereo>,
    pub(crate) track_applied: Vec<Applied>,
    pub(crate) bus_applied: Vec<Applied>,
    pub(crate) master_applied: Applied,
    /// A copy of the tempo map for the metronome (`Engine::set_song`).
    pub(crate) click_tempo: Vec<TempoSegment>,
    /// Peak levels since the meters were last read: the tracks', the
    /// buses', the master's (left, right).
    pub track_peaks: Vec<[f32; 2]>,
    pub bus_peaks: Vec<[f32; 2]>,
    pub master_peak: [f32; 2],
    /// The tracks' instruments: new ones made for this version, until the
    /// engine takes it (`Engine::set_song`), which puts the ones already
    /// playing in their place and hands the new ones it didn't need back
    /// with the version it replaced.
    pub(crate) players: Vec<Option<Box<Player>>>,
    /// The tracks' ids as the live commands name them (`track_key`).
    pub(crate) track_keys: Vec<u64>,
    /// Every chain's effects (the tracks', the buses', then the master's:
    /// see `Song::host_effects`), new ones as with `players`.
    pub(crate) fx: Vec<Chain>,
    /// Delay compensation's plan, and its delays: per track on its own
    /// sources, after its effects and on its sends; per bus after its
    /// effects; on the tracks' direct path to the master; and the clicks,
    /// waiting as long as the mix. Empty ones the engine swaps for those
    /// already playing (`Engine::set_song`), so what's in them carries on.
    pub(crate) plan: Plan,
    pub(crate) own_delays: Vec<Delay>,
    pub(crate) channel_delays: Vec<Delay>,
    pub(crate) send_delays: Vec<Delay>,
    pub(crate) bus_delays: Vec<Delay>,
    pub(crate) direct_delay: Delay,
    pub(crate) click_delay: Ring,
}

impl Prepared {
    /// How late the mix comes out of the master (frames): what the delay
    /// compensation lines up, the master's effects and its limiter.
    pub fn latency(&self) -> usize {
        self.plan.total
    }
}

impl Song {
    /// How many effect chains it has: a track's, a bus's, the master's.
    pub(crate) fn host_count(&self) -> usize {
        self.tracks.len() + self.buses.len() + 1
    }

    /// The effects of chain `h`: the tracks' first, then the buses', then
    /// the master's.
    pub(crate) fn host_effects(&self, h: usize) -> &[EffectSpec] {
        let (t, b) = (self.tracks.len(), self.buses.len());
        if h < t {
            &self.tracks[h].effects
        } else if h < t + b {
            &self.buses[h - t].effects
        } else {
            &self.master_effects
        }
    }

    /// Whether an effect with this id and of this kind is in any chain.
    fn has_effect(&self, spec: &EffectSpec) -> bool {
        (0..self.host_count()).any(|h| {
            self.host_effects(h)
                .iter()
                .any(|e| e.id == spec.id && e.settings.kind() == spec.settings.kind())
        })
    }

    /// The song ready for the audio thread, at `sample_rate`. Its levels
    /// start at those of the tracks with the same ids in `previous` (the
    /// song playing now), so a change glides; a track whose instrument
    /// `previous` already had is played by the one playing it (none is
    /// made for it here), and so is an effect `previous` already had.
    pub fn prepare(mut self, previous: Option<&Song>, sample_rate: f64) -> Prepared {
        for t in &mut self.tracks {
            t.effects
                .iter_mut()
                .for_each(|e| e.settings.prepare(sample_rate));
        }
        for b in &mut self.buses {
            b.effects
                .iter_mut()
                .for_each(|e| e.settings.prepare(sample_rate));
        }
        for e in &mut self.master_effects {
            e.settings.prepare(sample_rate);
        }
        let n = self.tracks.len();
        // A destination that isn't a track, or would make a loop, is the
        // master. (The studio never sends one; this keeps a bad one safe.)
        for i in 0..n {
            if let Destination::Track(d) = self.tracks[i].destination
                && (d >= n || d == i)
            {
                self.tracks[i].destination = Destination::Master;
            }
        }
        for i in 0..n {
            let mut seen = vec![false; n];
            let mut at = i;
            seen[at] = true;
            while let Destination::Track(d) = self.tracks[at].destination {
                if seen[d] {
                    self.tracks[at].destination = Destination::Master;
                    break;
                }
                seen[d] = true;
                at = d;
            }
        }
        self.tracks.iter_mut().for_each(|t| {
            t.sends.retain(|s| s.bus < self.buses.len());
            t.clips.sort_by_key(|c| c.start);
            t.notes.sort_by_key(|n| n.start);
        });
        if self.tempo.is_empty() {
            self.tempo = constant(120.0).to_vec();
        }

        // Depth: how many tracks a track's audio passes through on its way
        // to the master. Deeper ones are mixed first.
        let depth = |i: usize| {
            let mut d = 0;
            let mut at = i;
            while let Destination::Track(next) = self.tracks[at].destination {
                d += 1;
                at = next;
            }
            d
        };
        let mut order: Vec<usize> = (0..n).collect();
        order.sort_by_key(|&i| std::cmp::Reverse(depth(i)));

        let strip_of = |t: &Track| Applied {
            gain: t.volume * if t.audible { 1.0 } else { 0.0 },
            pan: t.pan,
        };
        let track_applied = self
            .tracks
            .iter()
            .map(|t| {
                previous
                    .and_then(|p| p.tracks.iter().find(|x| x.id == t.id))
                    .map_or_else(|| strip_of(t), strip_of)
            })
            .collect();
        let bus_of = |b: &Bus| Applied {
            gain: b.volume,
            pan: b.pan,
        };
        let bus_applied = self
            .buses
            .iter()
            .map(|b| {
                previous
                    .and_then(|p| p.buses.iter().find(|x| x.id == b.id))
                    .map_or_else(|| bus_of(b), bus_of)
            })
            .collect();
        let master_applied = previous.map_or(
            Applied {
                gain: self.master.volume,
                pan: self.master.pan,
            },
            |p| Applied {
                gain: p.master.volume,
                pan: p.master.pan,
            },
        );

        let players = self
            .tracks
            .iter()
            .map(|t| {
                let spec = t.instrument.as_ref()?;
                let playing = previous
                    .and_then(|p| p.tracks.iter().find(|x| x.id == t.id))
                    .and_then(|x| x.instrument.as_ref())
                    .is_some_and(|x| x.kind() == spec.kind());
                (!playing).then(|| Box::new(Player::new(spec, sample_rate)))
            })
            .collect();
        let track_keys = self.tracks.iter().map(|t| track_key(&t.id)).collect();
        let fx = (0..self.host_count())
            .map(|h| {
                self.host_effects(h)
                    .iter()
                    .map(|spec| {
                        let playing = previous.is_some_and(|p| p.has_effect(spec));
                        (!playing).then(|| Box::new(Effect::new(&spec.settings, sample_rate)))
                    })
                    .collect()
            })
            .collect();

        // Delay compensation, from the chains' latencies.
        let paths: Vec<Path> = self
            .tracks
            .iter()
            .map(|t| Path {
                latency: fx::latency(&t.effects, sample_rate),
                live: t.live,
                dest: match t.destination {
                    Destination::Track(d) => Some(d),
                    Destination::Master => None,
                },
            })
            .collect();
        let buses: Vec<usize> = self
            .buses
            .iter()
            .map(|b| fx::latency(&b.effects, sample_rate))
            .collect();
        let master = fx::latency(&self.master_effects, sample_rate) + lookahead_frames(sample_rate);
        let plan = latency::plan(self.compensation, &paths, &buses, master);
        let most = (MAX_COMPENSATION * sample_rate) as usize;
        let delays = |frames: &[usize]| frames.iter().map(|&f| Delay::new(f.min(most))).collect();

        Prepared {
            own_delays: delays(&plan.own),
            channel_delays: delays(&plan.channel),
            send_delays: delays(&plan.send),
            bus_delays: delays(&plan.bus),
            direct_delay: Delay::new(plan.direct.min(most)),
            click_delay: Ring::new(plan.total.min(most)),
            plan,
            players,
            track_keys,
            fx,
            order,
            track_bufs: vec![Stereo::new(); n],
            bus_bufs: vec![Stereo::new(); self.buses.len()],
            track_applied,
            bus_applied,
            master_applied,
            track_peaks: vec![[0.0; 2]; n],
            bus_peaks: vec![[0.0; 2]; self.buses.len()],
            master_peak: [0.0; 2],
            click_tempo: self.tempo.clone(),
            song: self,
        }
    }
}

/// Shared audio files: the studio sends each once, and clips point to it.
pub type Audio = Arc<super::clip::AudioData>;
