//! The native engine in the desktop app: the audio devices, and the
//! commands the studio drives the engine with (`src/engine/native/`).
//!
//! The studio sends the song (`engine_set_song`) whenever it changes, each
//! audio file once (`engine_load_audio`, decoded at the engine's rate), and
//! the transport's commands; it reads back the position and meters
//! (`engine_status`) to draw them.

pub mod devices;
pub mod song;
pub mod stream;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use dawn_engine::mix::{AudioData, Song, track_key};
use serde::Serialize;
use tauri::State;
use tauri::ipc::{InvokeBody, Request, Response};

use song::{LoadedAudio, SongSpec};
use stream::{Command, Running};

#[derive(Default)]
struct Inner {
    running: Option<Running>,
    /// The audio files the studio has sent, by its ids.
    audio: HashMap<String, LoadedAudio>,
    /// The song sent last (what's playing), to glide from and to meter.
    song: Option<Song>,
}

impl Inner {
    fn send(&mut self, command: Command) -> Result<(), String> {
        let running = self.running.as_mut().ok_or("No audio device is open.")?;
        if running.send(command) {
            Ok(())
        } else {
            Err("The audio thread isn't keeping up.".into())
        }
    }
}

/// The engine's state in the app (Tauri's managed state).
#[derive(Default)]
pub struct AudioState(Mutex<Inner>);

impl AudioState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        // A panic while holding it leaves nothing half-done worth refusing.
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[tauri::command]
pub async fn audio_devices() -> Vec<devices::DriverInfo> {
    devices::list()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    sample_rate: f64,
    buffer_size: Option<u32>,
}

/// Opens a device (none: the system's default), closing the one open.
#[tauri::command]
pub async fn audio_open(
    state: State<'_, AudioState>,
    device: Option<String>,
    sample_rate: Option<u32>,
    buffer_size: Option<u32>,
) -> Result<Opened, String> {
    // Closed first, so a device can be reopened with other settings.
    let previous = state.lock().running.take();
    drop(previous);
    let running = stream::open(stream::Request {
        device,
        sample_rate,
        buffer_size,
    })?;
    let opened = Opened {
        sample_rate: running.sample_rate,
        buffer_size: running.buffer_size,
    };
    let mut inner = state.lock();
    inner.running = Some(running);
    // The song is sent again by the studio (its clips at the new rate).
    inner.song = None;
    Ok(opened)
}

#[tauri::command]
pub fn audio_close(state: State<'_, AudioState>) {
    let running = state.lock().running.take();
    drop(running);
}

/// An audio file, decoded: the body is its samples (f32, little-endian),
/// one channel after another; the headers say its id, channel count and
/// sample rate.
#[tauri::command]
pub fn engine_load_audio(state: State<'_, AudioState>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the samples as bytes.".into());
    };
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    let id = header("dawn-audio-id").ok_or("No audio id.")?;
    let channels: usize = header("dawn-channels")
        .and_then(|v| v.parse().ok())
        .filter(|c| *c > 0)
        .ok_or("No channel count.")?;
    let sample_rate: f64 = header("dawn-sample-rate")
        .and_then(|v| v.parse().ok())
        .ok_or("No sample rate.")?;
    let samples: Vec<f32> = bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
        .collect();
    let frames = samples.len() / channels;
    let data = AudioData {
        channels: samples
            .chunks(frames.max(1))
            .take(channels)
            .map(<[f32]>::to_vec)
            .collect(),
    };
    state.lock().audio.insert(
        id,
        LoadedAudio {
            sample_rate,
            data: Arc::new(data),
        },
    );
    Ok(())
}

/// Forgets audio files no longer used (what's playing keeps its own).
#[tauri::command]
pub fn engine_forget_audio(state: State<'_, AudioState>, ids: Vec<String>) {
    let mut inner = state.lock();
    ids.iter().for_each(|id| {
        inner.audio.remove(id);
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongSent {
    /// Files its clips need that haven't been sent at the engine's rate.
    missing: Vec<String>,
}

#[tauri::command]
pub fn engine_set_song(state: State<'_, AudioState>, song: SongSpec) -> Result<SongSent, String> {
    let mut inner = state.lock();
    let sample_rate = inner
        .running
        .as_ref()
        .ok_or("No audio device is open.")?
        .sample_rate;
    let (mut built, missing) = song::build(&song, inner.song.as_ref(), &inner.audio, sample_rate);
    // The effects' impulses are made on the song kept to follow, so the
    // next version keeps them when they're the same.
    built.prepare_effects(inner.song.as_ref(), sample_rate);
    let prepared = Box::new(built.clone().prepare(inner.song.as_ref(), sample_rate));
    inner.send(Command::Song(prepared))?;
    inner.song = Some(built);
    Ok(SongSent { missing })
}

/// A key pressed live (`velocity` 0-1) or let go (none) on a track.
#[tauri::command]
pub fn engine_key(
    state: State<'_, AudioState>,
    track: String,
    key: i32,
    velocity: Option<f64>,
) -> Result<(), String> {
    state.lock().send(Command::Key {
        track: track_key(&track),
        key,
        velocity,
    })
}

/// A track's sustain pedal (CC64), down or up.
#[tauri::command]
pub fn engine_sustain(
    state: State<'_, AudioState>,
    track: String,
    down: bool,
) -> Result<(), String> {
    state.lock().send(Command::Sustain {
        track: track_key(&track),
        down,
    })
}

/// A track's pitch bend: -1..1 of its instrument's bend range.
#[tauri::command]
pub fn engine_bend(state: State<'_, AudioState>, track: String, value: f64) -> Result<(), String> {
    state.lock().send(Command::Bend {
        track: track_key(&track),
        value,
    })
}

/// A track's mod wheel, 0..1.
#[tauri::command]
pub fn engine_mod_wheel(
    state: State<'_, AudioState>,
    track: String,
    value: f64,
) -> Result<(), String> {
    state.lock().send(Command::ModWheel {
        track: track_key(&track),
        value,
    })
}

#[tauri::command]
pub fn engine_play(
    state: State<'_, AudioState>,
    from: f64,
    count_in_beats: f64,
) -> Result<(), String> {
    state.lock().send(Command::Play {
        from,
        count_in_beats,
    })
}

#[tauri::command]
pub fn engine_stop(state: State<'_, AudioState>) -> Result<(), String> {
    state.lock().send(Command::Stop)
}

#[tauri::command]
pub fn engine_seek(state: State<'_, AudioState>, seconds: f64) -> Result<(), String> {
    state.lock().send(Command::Seek(seconds))
}

#[tauri::command]
pub fn engine_loop(
    state: State<'_, AudioState>,
    start: Option<f64>,
    end: Option<f64>,
) -> Result<(), String> {
    state.lock().send(Command::Loop(start.zip(end)))
}

#[tauri::command]
pub fn engine_metronome(
    state: State<'_, AudioState>,
    enabled: bool,
    level_db: f64,
) -> Result<(), String> {
    let mut inner = state.lock();
    inner.send(Command::Metronome(enabled))?;
    inner.send(Command::MetronomeLevel(level_db))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    open: bool,
    sample_rate: f64,
    position: f64,
    playing: bool,
    /// Peaks since the last status (0-1), in the song's track order.
    tracks: Vec<[f32; 2]>,
    buses: Vec<[f32; 2]>,
    master: [f32; 2],
    /// The master limiter's gain (1: not limiting).
    limiter_gain: f32,
    /// How much of each buffer's time the engine takes (0-1).
    load: f32,
    /// Dropouts and stream errors since the device opened.
    errors: u32,
}

/// What's gone into a Tuner (by its effect id) lately, for the studio to
/// find its pitch in: the last 4096 samples, oldest first, as little-endian
/// f32s. Nothing when the song has no such Tuner, or it's bypassed (the
/// engine skips it, so it hears nothing, as the browser's unplugged one).
#[tauri::command]
pub fn engine_tuner(state: State<'_, AudioState>, effect: String) -> Response {
    let inner = state.lock();
    let samples = inner
        .song
        .as_ref()
        .and_then(|s| s.effect(&effect))
        .filter(|e| !e.bypass)
        .and_then(|e| e.settings.tuner_tap())
        .map(|tap| tap.waveform())
        .unwrap_or_default();
    Response::new(
        samples
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect::<Vec<u8>>(),
    )
}

#[tauri::command]
pub fn engine_status(state: State<'_, AudioState>) -> EngineStatus {
    let mut inner = state.lock();
    // The engine found a track without the instrument it was counting on
    // (a version of the song it never got): it gets the song again, with
    // every instrument made anew.
    let resend = inner
        .running
        .as_ref()
        .is_some_and(|r| r.status.take_missing());
    if resend
        && let Some(song) = inner.song.clone()
        && let Some(rate) = inner.running.as_ref().map(|r| r.sample_rate)
    {
        let _ = inner.send(Command::Song(Box::new(song.prepare(None, rate))));
    }
    let inner = inner;
    let Some(r) = &inner.running else {
        return EngineStatus {
            open: false,
            sample_rate: 0.0,
            position: 0.0,
            playing: false,
            tracks: vec![],
            buses: vec![],
            master: [0.0; 2],
            limiter_gain: 1.0,
            load: 0.0,
            errors: 0,
        };
    };
    let (tracks, buses) = inner
        .song
        .as_ref()
        .map_or((0, 0), |s| (s.tracks.len(), s.buses.len()));
    let s = &r.status;
    let (tracks, buses, master) = s.take_peaks(tracks, buses);
    EngineStatus {
        open: true,
        sample_rate: r.sample_rate,
        position: s.position(),
        playing: s.playing(),
        tracks,
        buses,
        master,
        limiter_gain: s.limiter_gain(),
        load: s.load(),
        errors: s.errors(),
    }
}
