//! The song as the studio sends it (`src/engine/native/describe.ts`): ids,
//! seconds and dB, the routing already worked out. Turned into the engine's
//! song with the audio files the studio has sent.

use std::collections::HashMap;
use std::sync::Arc;

use dawn_engine::effects::limiter::LimiterSettings;
use dawn_engine::mix::tempo::TempoSegment;
use dawn_engine::mix::{
    AudioData, Bus, Clip, ClipTiming, Destination, Master, Send, Song, Track, db_to_gain,
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
