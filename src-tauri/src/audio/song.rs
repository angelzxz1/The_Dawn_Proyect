//! The song as the studio sends it (`src/engine/native/describe.ts`): ids,
//! seconds and dB, the routing already worked out, a MIDI track's notes and
//! its instrument's settings. Turned into the engine's song with the audio
//! files the studio has sent (clips' files, sample pads', the piano's
//! samples, the synth's wavetables).

use std::collections::HashMap;
use std::sync::Arc;

use dawn_engine::effects::limiter::LimiterSettings;
use dawn_engine::instruments::drums::{DrumKit, PAD_COUNT, Pad};
use dawn_engine::instruments::piano::PianoSample;
use dawn_engine::instruments::synth::{
    DEST_COUNT, EnvSettings, FilterSettings, LfoSettings, NoiseSettings, OscSettings, Route,
    SubSettings, SynthSettings, VoiceSettings, Wavetable,
};
use dawn_engine::mix::tempo::TempoSegment;
use dawn_engine::mix::{
    AudioData, Bus, Clip, ClipTiming, Destination, EffectSettings, EffectSpec, InstrumentSpec,
    Master, Note, Send, Song, Track, db_to_gain,
};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipSpec {
    /// The audio file (sent with `engine_load_audio`).
    pub audio: String,
    pub offset: f64,
    pub length: f64,
    pub source_offset: f64,
    pub loop_length: Option<f64>,
    pub gain_db: f64,
    pub fade_in: f64,
    pub fade_out: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendSpec {
    pub bus: String,
    pub db: f64,
}

/// A Drum Rack pad, as `compileDrumKit` makes it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PadSpec {
    pub on: bool,
    pub sample: bool,
    pub model: usize,
    pub tune: f64,
    pub decay: f64,
    pub tone: f64,
    pub character: f64,
    pub drive: f64,
    pub start: f64,
    pub reverse: bool,
    pub gain: f64,
    pub pan: f64,
    pub filter: f64,
    pub resonance: f64,
    pub velocity: f64,
    pub choke: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KitSpec {
    pub pads: Vec<PadSpec>,
    pub volume: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PianoSampleSpec {
    /// The note it was recorded at (MIDI).
    pub note: i32,
    pub audio: String,
}

/// An index the studio found with `indexOf` (never -1 for what it sends,
/// but if it were, the first).
fn index(i: i64) -> usize {
    i.max(0) as usize
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthOscSpec {
    pub on: bool,
    pub warp: i64,
    pub unison: i64,
    pub dest: i64,
    pub phase: f64,
    pub random_phase: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthSubSpec {
    pub on: bool,
    pub shape: i64,
    pub octave: f64,
    pub dest: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthNoiseSpec {
    pub on: bool,
    pub pink: bool,
    pub dest: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthFilterSpec {
    pub on: bool,
    #[serde(rename = "type")]
    pub kind: i64,
    pub keytrack: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthEnvSpec {
    pub delay: f64,
    pub attack: f64,
    pub hold: f64,
    pub decay: f64,
    pub sustain: f64,
    pub release: f64,
    pub attack_curve: f64,
    pub decay_curve: f64,
    pub release_curve: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthLfoSpec {
    pub shape: i64,
    pub rate: f64,
    pub sync: bool,
    pub beats: f64,
    pub mode: i64,
    pub phase: f64,
    pub fade: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthVoiceSpec {
    pub mode: i64,
    pub polyphony: i64,
    pub glide: f64,
    pub bend_range: f64,
    pub velocity: f64,
}

/// The synth's settings, as `compileSynth` makes them.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthSpec {
    pub base: Vec<f64>,
    /// Four numbers a route: source, destination, amount, bipolar.
    pub routes: Vec<f64>,
    pub osc: Vec<SynthOscSpec>,
    pub sub: SynthSubSpec,
    pub noise: SynthNoiseSpec,
    pub filters: Vec<SynthFilterSpec>,
    pub serial: bool,
    pub envs: Vec<SynthEnvSpec>,
    pub lfos: Vec<SynthLfoSpec>,
    pub macros: Vec<f64>,
    pub voice: SynthVoiceSpec,
}

impl SynthSpec {
    fn settings(&self) -> SynthSettings {
        let mut s = SynthSettings::default();
        for (to, from) in s.base.iter_mut().zip(&self.base).take(DEST_COUNT) {
            *to = *from;
        }
        let routes: Vec<Route> = self
            .routes
            .as_chunks::<4>()
            .0
            .iter()
            .filter(|r| r[0] >= 0.0 && r[1] >= 0.0)
            .map(|r| Route {
                source: r[0] as usize,
                dest: r[1] as usize,
                amount: r[2],
                bipolar: r[3] != 0.0,
            })
            .collect();
        s = s.with_routes(&routes);
        for (to, o) in s.osc.iter_mut().zip(&self.osc) {
            *to = OscSettings {
                on: o.on,
                warp: index(o.warp),
                unison: index(o.unison),
                dest: index(o.dest),
                phase: o.phase,
                random_phase: o.random_phase,
            };
        }
        s.sub = SubSettings {
            on: self.sub.on,
            shape: index(self.sub.shape),
            octave: self.sub.octave,
            dest: index(self.sub.dest),
        };
        s.noise = NoiseSettings {
            on: self.noise.on,
            pink: self.noise.pink,
            dest: index(self.noise.dest),
        };
        for (to, f) in s.filters.iter_mut().zip(&self.filters) {
            *to = FilterSettings {
                on: f.on,
                kind: index(f.kind),
                keytrack: f.keytrack,
            };
        }
        s.serial = self.serial;
        for (to, e) in s.envs.iter_mut().zip(&self.envs) {
            *to = EnvSettings {
                delay: e.delay,
                attack: e.attack,
                hold: e.hold,
                decay: e.decay,
                sustain: e.sustain,
                release: e.release,
                attack_curve: e.attack_curve,
                decay_curve: e.decay_curve,
                release_curve: e.release_curve,
            };
        }
        for (to, l) in s.lfos.iter_mut().zip(&self.lfos) {
            *to = LfoSettings {
                shape: index(l.shape),
                rate: l.rate,
                sync: l.sync,
                beats: l.beats,
                mode: index(l.mode),
                phase: l.phase,
                fade: l.fade,
            };
        }
        for (to, m) in s.macros.iter_mut().zip(&self.macros) {
            *to = *m;
        }
        s.voice = VoiceSettings {
            mode: index(self.voice.mode),
            polyphony: index(self.voice.polyphony),
            glide: self.voice.glide,
            bend_range: self.voice.bend_range,
            velocity: self.voice.velocity,
        };
        s
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum InstrumentSpecIn {
    #[serde(rename_all = "camelCase")]
    Drums {
        kit: KitSpec,
        /// Each pad's sample file (sent like a clip's), if it plays one.
        samples: Vec<Option<String>>,
    },
    #[serde(rename_all = "camelCase")]
    Piano { samples: Vec<PianoSampleSpec> },
    #[serde(rename_all = "camelCase")]
    Synth {
        settings: Box<SynthSpec>,
        /// Oscillator 1's wavetable, oscillator 2's and the sub's (sent
        /// like audio: one channel, the mip levels one after another).
        tables: Vec<String>,
    },
}

/// An effect in a chain, as the studio keeps it (`EffectInstance`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectSpecIn {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    /// By the keys in the effect's `index.ts` (a value JSON can't hold,
    /// such as an infinity, arrives as null and is left out).
    pub params: HashMap<String, Option<f64>>,
    #[serde(default)]
    pub bypass: bool,
}

/// A chain's effects for the engine: those it has.
fn effects(specs: &[EffectSpecIn]) -> Vec<EffectSpec> {
    specs
        .iter()
        .filter_map(|e| {
            let params: HashMap<String, f64> = e
                .params
                .iter()
                .filter_map(|(k, v)| v.map(|v| (k.clone(), v)))
                .collect();
            EffectSettings::from_params(&e.kind, &params).map(|settings| EffectSpec {
                id: e.id.clone(),
                settings,
                bypass: e.bypass,
            })
        })
        .collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSpec {
    pub key: i32,
    /// Seconds on the timeline.
    pub start: f64,
    pub end: f64,
    pub velocity: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackSpec {
    pub id: String,
    pub volume_db: f64,
    pub pan: f64,
    /// Heard, with mute and solo (the studio's mixGraph.ts).
    pub audible: bool,
    /// The track it feeds, or none for the master.
    pub output: Option<String>,
    pub sends: Vec<SendSpec>,
    pub clips: Vec<ClipSpec>,
    #[serde(default)]
    pub instrument: Option<InstrumentSpecIn>,
    #[serde(default)]
    pub notes: Vec<NoteSpec>,
    #[serde(default)]
    pub effects: Vec<EffectSpecIn>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusSpec {
    pub id: String,
    #[serde(default)]
    pub volume_db: f64,
    #[serde(default)]
    pub pan: f64,
    #[serde(default)]
    pub effects: Vec<EffectSpecIn>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterSpec {
    pub volume_db: f64,
    pub pan: f64,
    /// The limiter's ceiling.
    pub limiter_db: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TempoSpec {
    pub beat: f64,
    pub seconds: f64,
    pub bpm: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SongSpec {
    pub tracks: Vec<TrackSpec>,
    pub buses: Vec<BusSpec>,
    pub master: MasterSpec,
    #[serde(default)]
    pub master_effects: Vec<EffectSpecIn>,
    pub tempo: Vec<TempoSpec>,
    pub beats_per_bar: f64,
}

/// An audio file the studio sent, decoded at `sample_rate`.
pub struct LoadedAudio {
    pub sample_rate: f64,
    pub data: Arc<AudioData>,
}

/// An instrument's settings for the engine. Files that haven't arrived
/// (at this rate) go in `missing`; until they do, a pad plays nothing, and
/// the piano nothing at all. A synth waiting for a new wavetable keeps the
/// one it had (`previous`, the track's instrument in the song playing), as
/// the browser's does; with none yet, it waits to play.
fn instrument(
    spec: &InstrumentSpecIn,
    previous: Option<&InstrumentSpec>,
    audio: &HashMap<String, LoadedAudio>,
    sample_rate: f64,
    missing: &mut Vec<String>,
) -> InstrumentSpec {
    let mut file = |id: &str| match audio.get(id) {
        Some(a) if a.sample_rate == sample_rate => Some(a.data.clone()),
        _ => {
            missing.push(id.to_owned());
            None
        }
    };
    match spec {
        InstrumentSpecIn::Drums { kit, samples } => {
            let mut pads = [Pad::default(); PAD_COUNT];
            for (pad, p) in pads.iter_mut().zip(&kit.pads) {
                *pad = Pad {
                    on: p.on,
                    sample: p.sample,
                    model: p.model,
                    tune: p.tune,
                    decay: p.decay,
                    tone: p.tone,
                    character: p.character,
                    drive: p.drive,
                    start: p.start,
                    reverse: p.reverse,
                    gain: p.gain,
                    pan: p.pan,
                    filter: p.filter,
                    resonance: p.resonance,
                    velocity: p.velocity,
                    choke: p.choke,
                };
            }
            let mut files: [Option<Arc<AudioData>>; PAD_COUNT] = Default::default();
            for (slot, id) in files.iter_mut().zip(samples) {
                *slot = id.as_deref().and_then(&mut file);
            }
            InstrumentSpec::Drums {
                kit: Box::new(DrumKit {
                    pads,
                    volume: kit.volume,
                }),
                samples: files,
            }
        }
        InstrumentSpecIn::Piano { samples } => {
            let mut loaded: Vec<PianoSample> = samples
                .iter()
                .filter_map(|s| {
                    file(&s.audio).map(|audio| PianoSample {
                        note: s.note,
                        audio,
                    })
                })
                .collect();
            loaded.sort_by_key(|s| s.note);
            InstrumentSpec::Piano {
                samples: (loaded.len() == samples.len() && !loaded.is_empty())
                    .then(|| loaded.into()),
            }
        }
        InstrumentSpecIn::Synth { settings, tables } => {
            let had = match previous {
                Some(InstrumentSpec::Synth { tables, .. }) => Some(tables),
                _ => None,
            };
            InstrumentSpec::Synth {
                settings: Box::new(settings.settings()),
                tables: std::array::from_fn(|slot| {
                    tables
                        .get(slot)
                        .and_then(|id| file(id))
                        .and_then(Wavetable::new)
                        .or_else(|| had.and_then(|t| t[slot].clone()))
                }),
            }
        }
    }
}

/// The engine's song, at `sample_rate`, following `previous` (the one
/// playing). A clip whose file hasn't been sent (or was decoded at another
/// rate) is left out; their files come back.
pub fn build(
    spec: &SongSpec,
    previous: Option<&Song>,
    audio: &HashMap<String, LoadedAudio>,
    sample_rate: f64,
) -> (Song, Vec<String>) {
    let mut missing = vec![];
    let track_index: HashMap<&str, usize> = spec
        .tracks
        .iter()
        .enumerate()
        .map(|(i, t)| (t.id.as_str(), i))
        .collect();
    let bus_index: HashMap<&str, usize> = spec
        .buses
        .iter()
        .enumerate()
        .map(|(i, b)| (b.id.as_str(), i))
        .collect();
    let tracks = spec
        .tracks
        .iter()
        .map(|t| Track {
            id: t.id.clone(),
            volume: db_to_gain(t.volume_db),
            pan: t.pan.clamp(-1.0, 1.0),
            audible: t.audible,
            destination: t
                .output
                .as_deref()
                .and_then(|o| track_index.get(o))
                .map_or(Destination::Master, |&i| Destination::Track(i)),
            sends: t
                .sends
                .iter()
                .filter_map(|s| {
                    bus_index.get(s.bus.as_str()).map(|&bus| Send {
                        bus,
                        gain: db_to_gain(s.db),
                    })
                })
                .collect(),
            clips: t
                .clips
                .iter()
                .filter_map(|c| match audio.get(&c.audio) {
                    Some(a) if a.sample_rate == sample_rate => Some(Clip::new(
                        a.data.clone(),
                        sample_rate,
                        ClipTiming {
                            offset: c.offset,
                            length: c.length,
                            source_offset: c.source_offset,
                            loop_length: c.loop_length,
                            gain_db: c.gain_db,
                            fade_in: c.fade_in,
                            fade_out: c.fade_out,
                        },
                    )),
                    _ => {
                        missing.push(c.audio.clone());
                        None
                    }
                })
                .collect(),
            instrument: t.instrument.as_ref().map(|i| {
                let playing = previous
                    .and_then(|p| p.tracks.iter().find(|x| x.id == t.id))
                    .and_then(|x| x.instrument.as_ref());
                instrument(i, playing, audio, sample_rate, &mut missing)
            }),
            notes: t
                .notes
                .iter()
                .map(|n| Note {
                    start: (n.start * sample_rate).round() as i64,
                    end: (n.end * sample_rate).round() as i64,
                    key: n.key,
                    velocity: n.velocity.clamp(0.0, 1.0),
                })
                .collect(),
            effects: effects(&t.effects),
        })
        .collect();
    let buses = spec
        .buses
        .iter()
        .map(|b| Bus {
            id: b.id.clone(),
            volume: db_to_gain(b.volume_db),
            pan: b.pan.clamp(-1.0, 1.0),
            effects: effects(&b.effects),
        })
        .collect();
    let master = Master {
        volume: db_to_gain(spec.master.volume_db),
        pan: spec.master.pan.clamp(-1.0, 1.0),
        limiter: LimiterSettings::from_db(spec.master.limiter_db, 0.0, 0.1, false),
    };
    let tempo = spec
        .tempo
        .iter()
        .filter(|s| s.bpm > 0.0)
        .map(|s| TempoSegment {
            beat: s.beat,
            seconds: s.seconds,
            bpm: s.bpm,
        })
        .collect();
    missing.sort();
    missing.dedup();
    (
        Song {
            tracks,
            buses,
            master,
            master_effects: effects(&spec.master_effects),
            tempo,
            beats_per_bar: spec.beats_per_bar.max(1.0),
        },
        missing,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use dawn_engine::instruments::synth::FRAME_SAMPLES;
    use dawn_engine::mix::InstrumentKind;

    /// A song as `describe.ts` writes it: a drum track with one sample pad
    /// and a piano track, with notes.
    const SONG: &str = r#"{
        "tracks": [
            { "id": "d", "volumeDb": 0, "pan": 0, "audible": true, "output": null, "sends": [], "clips": [],
              "instrument": { "type": "drums",
                              "kit": { "volume": 0.5, "pads": [
                                  { "on": true, "sample": true, "model": 0, "tune": 0, "decay": 0.5, "tone": 0.5, "character": 0.5,
                                    "drive": 0, "start": 0, "reverse": false, "gain": 1, "pan": 0, "filter": 0, "resonance": 0.1,
                                    "velocity": 0.7, "choke": 0 } ] },
                              "samples": ["48000:drum:kick", null] },
              "notes": [{ "key": 24, "start": 0.5, "end": 0.75, "velocity": 1.5 }] },
            { "id": "p", "volumeDb": 0, "pan": 0, "audible": true, "output": null, "sends": [], "clips": [],
              "instrument": { "type": "piano", "samples": [{ "note": 69, "audio": "48000:piano:A4" }, { "note": 60, "audio": "48000:piano:C4" }] },
              "notes": [] },
            { "id": "a", "volumeDb": 0, "pan": 0, "audible": true, "output": null, "sends": [], "clips": [], "instrument": null, "notes": [] }
        ],
        "buses": [],
        "master": { "volumeDb": 0, "pan": 0, "limiterDb": -1 },
        "tempo": [{ "beat": 0, "seconds": 0, "bpm": 120 }],
        "beatsPerBar": 4
    }"#;

    fn file() -> LoadedAudio {
        LoadedAudio {
            sample_rate: 48000.0,
            data: Arc::new(AudioData {
                channels: vec![vec![0.5; 10]],
            }),
        }
    }

    #[test]
    fn reads_the_instruments_and_notes_the_studio_sends() {
        let spec: SongSpec = serde_json::from_str(SONG).unwrap();
        let (song, missing) = build(&spec, None, &HashMap::new(), 48000.0);
        // Nothing sent yet: every file is missing, the piano has no samples.
        assert_eq!(
            missing,
            ["48000:drum:kick", "48000:piano:A4", "48000:piano:C4"]
        );
        let drums = &song.tracks[0];
        assert_eq!(drums.notes.len(), 1);
        assert_eq!(drums.notes[0].start, 24000);
        assert_eq!(drums.notes[0].end, 36000);
        assert_eq!(drums.notes[0].velocity, 1.0);
        match drums.instrument.as_ref().unwrap() {
            InstrumentSpec::Drums { kit, samples } => {
                assert_eq!(kit.volume, 0.5);
                assert!(kit.pads[0].on && kit.pads[0].sample);
                assert!(!kit.pads[1].on);
                assert!(samples.iter().all(Option::is_none));
            }
            _ => panic!("not drums"),
        }
        assert!(matches!(
            song.tracks[1].instrument,
            Some(InstrumentSpec::Piano { samples: None })
        ));
        assert!(song.tracks[2].instrument.is_none());

        // Once they've arrived: the pad has its sample, the piano its
        // samples, in order.
        let audio: HashMap<String, LoadedAudio> =
            missing.iter().map(|id| (id.clone(), file())).collect();
        let (song, missing) = build(&spec, None, &audio, 48000.0);
        assert!(missing.is_empty());
        let Some(InstrumentSpec::Drums { samples, .. }) = &song.tracks[0].instrument else {
            panic!("not drums");
        };
        assert!(samples[0].is_some());
        let Some(InstrumentSpec::Piano {
            samples: Some(piano),
        }) = &song.tracks[1].instrument
        else {
            panic!("no piano samples");
        };
        assert_eq!(piano.iter().map(|s| s.note).collect::<Vec<_>>(), [60, 69]);
        assert_eq!(
            song.tracks[1].instrument.as_ref().map(InstrumentSpec::kind),
            Some(InstrumentKind::Piano)
        );
    }

    /// A synth track as `describe.ts` writes it, with the Init patch
    /// (`compileSynth`) and an LFO on the cutoff, playing `tables`.
    fn synth_song(tables: [&str; 3]) -> SongSpec {
        let json = format!(
            r#"{{
            "tracks": [
                {{ "id": "s", "volumeDb": 0, "pan": 0, "audible": true, "output": null, "sends": [], "clips": [],
                   "instrument": {{ "type": "synth", "settings": SETTINGS, "tables": ["{}", "{}", "{}"] }},
                   "notes": [] }}
            ],
            "buses": [],
            "master": {{ "volumeDb": 0, "pan": 0, "limiterDb": -1 }},
            "tempo": [{{ "beat": 0, "seconds": 0, "bpm": 120 }}],
            "beatsPerBar": 4
        }}"#,
            tables[0], tables[1], tables[2]
        )
        .replace("SETTINGS", r#"{"base":[0.7,0.5,0.5,0,0.5,0.5,0.25,0.75,0.8,0.5,0.5,0,0,0.5,0.5,0.25,0.75,0.8,0.5,0.5,0.25,0.5,1,0.1,0,0,1,0,0.1,0,0,1,0.638809459365963,0.638809459365963,0.4716662155617413,0.5,0.7777777777777778],"routes":[3,22,0.25,1],"osc":[{"on":true,"warp":0,"unison":1,"dest":0,"phase":0,"randomPhase":1},{"on":false,"warp":0,"unison":1,"dest":0,"phase":0,"randomPhase":1}],"sub":{"on":false,"shape":0,"octave":-1,"dest":3},"noise":{"on":false,"pink":false,"dest":0},"filters":[{"on":true,"type":1,"keytrack":0},{"on":false,"type":3,"keytrack":0}],"serial":true,"envs":[{"delay":0,"attack":0.002,"hold":0,"decay":0.6,"sustain":1,"release":0.15,"attackCurve":0,"decayCurve":0.6,"releaseCurve":0.6},{"delay":0,"attack":0.002,"hold":0,"decay":0.4,"sustain":0,"release":0.15,"attackCurve":0,"decayCurve":0.6,"releaseCurve":0.6},{"delay":0,"attack":0.002,"hold":0,"decay":1.2,"sustain":0,"release":0.15,"attackCurve":0,"decayCurve":0.6,"releaseCurve":0.6}],"lfos":[{"shape":0,"rate":2,"sync":true,"beats":1,"mode":0,"phase":0,"fade":0},{"shape":1,"rate":2,"sync":true,"beats":0.5,"mode":0,"phase":0,"fade":0},{"shape":6,"rate":0.5,"sync":false,"beats":1,"mode":1,"phase":0,"fade":0}],"macros":[0,0,0,0],"voice":{"mode":0,"polyphony":8,"glide":0,"bendRange":2,"velocity":0.6}}"#);
        serde_json::from_str(&json).unwrap()
    }

    /// A wavetable of `frames` frames, sent at 48 kHz.
    fn table(frames: usize) -> LoadedAudio {
        LoadedAudio {
            sample_rate: 48000.0,
            data: Arc::new(AudioData {
                channels: vec![vec![0.0; frames * FRAME_SAMPLES]],
            }),
        }
    }

    fn synth_tables(song: &Song) -> (&SynthSettings, Vec<Option<usize>>) {
        let Some(InstrumentSpec::Synth { settings, tables }) = &song.tracks[0].instrument else {
            panic!("not the synth");
        };
        (
            settings,
            tables
                .iter()
                .map(|t| t.as_ref().map(Wavetable::frames))
                .collect(),
        )
    }

    #[test]
    fn reads_the_synths_settings_and_waits_for_its_wavetables() {
        let names = [
            "48000:wavetable:basic",
            "48000:wavetable:fm",
            "48000:wavetable:sub",
        ];
        let spec = synth_song(names);
        let (song, missing) = build(&spec, None, &HashMap::new(), 48000.0);
        assert_eq!(missing, names);
        let (settings, tables) = synth_tables(&song);
        assert_eq!(tables, [None, None, None]);
        assert_eq!(settings.base[0], 0.7);
        assert_eq!(settings.base[36], 0.7777777777777778);
        assert!(settings.osc[0].on && !settings.osc[1].on);
        assert_eq!(settings.osc[0].random_phase, 1.0);
        assert_eq!(settings.sub.dest, 3);
        assert_eq!(settings.sub.octave, -1.0);
        assert_eq!(settings.filters[0].kind, 1);
        assert!(settings.serial);
        assert_eq!(settings.envs[0].decay_curve, 0.6);
        assert_eq!(settings.lfos[1].beats, 0.5);
        assert_eq!(settings.lfos[2].mode, 1);
        assert_eq!(settings.voice.bend_range, 2.0);
        assert_eq!(settings.voice.polyphony, 8);
        assert_eq!(
            settings.routes(),
            [Route {
                source: 3,
                dest: 22,
                amount: 0.25,
                bipolar: true
            }]
        );

        // They've arrived (a file that isn't whole frames isn't one).
        let mut audio = HashMap::from([
            (names[0].to_owned(), table(3)),
            (names[1].to_owned(), table(2)),
            (names[2].to_owned(), table(4)),
        ]);
        let (playing, missing) = build(&spec, None, &audio, 48000.0);
        assert!(missing.is_empty());
        assert_eq!(synth_tables(&playing).1, [Some(3), Some(2), Some(4)]);

        // Oscillator 1 changes table: until the new one's in, the synth
        // keeps the one it has.
        let next = synth_song(["48000:wavetable:vowels", names[1], names[2]]);
        let (song, missing) = build(&next, Some(&playing), &audio, 48000.0);
        assert_eq!(missing, ["48000:wavetable:vowels"]);
        assert_eq!(synth_tables(&song).1, [Some(3), Some(2), Some(4)]);
        audio.insert("48000:wavetable:vowels".into(), table(5));
        let (song, _) = build(&next, Some(&playing), &audio, 48000.0);
        assert_eq!(synth_tables(&song).1, [Some(5), Some(2), Some(4)]);
        assert_eq!(
            song.tracks[0].instrument.as_ref().map(InstrumentSpec::kind),
            Some(InstrumentKind::Synth)
        );
    }

    #[test]
    fn reads_the_effect_chains_the_engine_has() {
        let json = r#"{
            "tracks": [
                { "id": "v", "volumeDb": 0, "pan": 0, "audible": true, "output": null, "sends": [], "clips": [],
                  "effects": [
                      { "id": "c", "type": "compressor", "params": { "threshold": -30, "ratio": 6 } },
                      { "id": "r", "type": "reverb", "params": { "decay": 2 } },
                      { "id": "u", "type": "utility", "params": { "gain": null, "width": 0 }, "bypass": true }
                  ] }
            ],
            "buses": [{ "id": "b", "effects": [{ "id": "l", "type": "limiter", "params": { "threshold": -6 } }] }],
            "master": { "volumeDb": 0, "pan": 0, "limiterDb": -1 },
            "masterEffects": [{ "id": "m", "type": "utility", "params": { "gain": -3 } }],
            "tempo": [{ "beat": 0, "seconds": 0, "bpm": 120 }],
            "beatsPerBar": 4
        }"#;
        let spec: SongSpec = serde_json::from_str(json).unwrap();
        let (song, missing) = build(&spec, None, &HashMap::new(), 48000.0);
        assert!(missing.is_empty());
        // The reverb isn't in the engine yet: the chain plays without it.
        let fx = &song.tracks[0].effects;
        assert_eq!(
            fx.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            ["c", "u"]
        );
        let EffectSettings::Compressor(c) = fx[0].settings else {
            panic!("not the compressor");
        };
        assert_eq!((c.threshold, c.ratio), (-30.0, 6.0));
        // A value JSON couldn't hold takes its default.
        let EffectSettings::Utility(u) = fx[1].settings else {
            panic!("not the utility");
        };
        assert_eq!((u.gain_db, u.width), (0.0, 0.0));
        assert!(fx[1].bypass && !fx[0].bypass);
        assert!(matches!(
            song.buses[0].effects[0].settings,
            EffectSettings::Limiter(_)
        ));
        assert_eq!(song.master_effects.len(), 1);
    }
}
