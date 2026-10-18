//! The song as the studio sends it (`src/engine/native/describe.ts`): ids,
//! seconds and dB, the routing already worked out, a MIDI track's notes and
//! its instrument's settings. Turned into the engine's song with the audio
//! files the studio has sent (clips' files, sample pads', the piano's
//! samples).

use std::collections::HashMap;
use std::sync::Arc;

use dawn_engine::effects::limiter::LimiterSettings;
use dawn_engine::instruments::drums::{DrumKit, PAD_COUNT, Pad};
use dawn_engine::instruments::piano::PianoSample;
use dawn_engine::mix::tempo::TempoSegment;
use dawn_engine::mix::{
    AudioData, Bus, Clip, ClipTiming, Destination, InstrumentSpec, Master, Note, Send, Song, Track,
    db_to_gain,
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
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusSpec {
    pub id: String,
    #[serde(default)]
    pub volume_db: f64,
    #[serde(default)]
    pub pan: f64,
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
/// the piano nothing at all.
fn instrument(
    spec: &InstrumentSpecIn,
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
    }
}

/// The engine's song, at `sample_rate`. A clip whose file hasn't been sent
/// (or was decoded at another rate) is left out; their files come back.
pub fn build(
    spec: &SongSpec,
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
            instrument: t
                .instrument
                .as_ref()
                .map(|i| instrument(i, audio, sample_rate, &mut missing)),
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
        })
        .collect();
    let buses = spec
        .buses
        .iter()
        .map(|b| Bus {
            id: b.id.clone(),
            volume: db_to_gain(b.volume_db),
            pan: b.pan.clamp(-1.0, 1.0),
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
            tempo,
            beats_per_bar: spec.beats_per_bar.max(1.0),
        },
        missing,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
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
        let (song, missing) = build(&spec, &HashMap::new(), 48000.0);
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
        let (song, missing) = build(&spec, &audio, 48000.0);
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
}
