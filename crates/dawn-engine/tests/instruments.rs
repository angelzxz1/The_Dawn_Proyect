//! MIDI tracks in the engine: their clips' notes playing their instrument
//! on time, the loop and stopping releasing them, keys played live with the
//! sustain pedal, and an instrument ringing on through a new version of the
//! song. The piano here has one sample of constant 1.0, so what it plays is
//! its notes' gains, easy to read; the synth's wavetables are constant too,
//! so it plays its oscillator's level. The master limiter delays everything
//! by LAG frames, and its ceiling (-1 dB) holds the level under 0.89.

use std::sync::Arc;

use dawn_engine::instruments::drums::{DrumKit, Pad};
use dawn_engine::instruments::piano::PianoSample;
use dawn_engine::instruments::synth::{
    DESTS, EnvSettings, FRAME_SAMPLES, OscSettings, Route, SynthSettings, VoiceSettings, Wavetable,
};
use dawn_engine::mix::{AudioData, Engine, InstrumentSpec, Note, Song, Track, track_key};

const SR: f64 = 48000.0;
const LAG: usize = 240;

fn piano() -> InstrumentSpec {
    let sample = PianoSample {
        note: 60,
        audio: Arc::new(AudioData {
            channels: vec![vec![1.0; (SR * 10.0) as usize]],
        }),
    };
    InstrumentSpec::Piano {
        samples: Some(vec![sample].into()),
    }
}

fn note(start: f64, end: f64, velocity: f64) -> Note {
    Note {
        start: (start * SR) as i64,
        end: (end * SR) as i64,
        key: 60,
        velocity,
    }
}

fn keys(id: &str, instrument: InstrumentSpec, notes: Vec<Note>) -> Track {
    Track {
        instrument: Some(instrument),
        notes,
        ..Track::new(id)
    }
}

fn song(tracks: Vec<Track>) -> Song {
    Song {
        tracks,
        ..Song::default()
    }
}

fn engine(song: Song) -> Engine {
    let mut engine = Engine::new(SR);
    engine.set_song(Box::new(song.prepare(None, SR)));
    engine
}

fn render(engine: &mut Engine, seconds: f64) -> Vec<f32> {
    let n = (seconds * SR) as usize;
    let (mut l, mut r) = (vec![0.0; n], vec![0.0; n]);
    engine.render(&mut l, &mut r);
    assert_eq!(l, r);
    l
}

fn at(out: &[f32], seconds: f64) -> f32 {
    out[(seconds * SR) as usize + LAG]
}

#[test]
fn a_clips_notes_play_on_their_frame_and_release_at_their_end() {
    let mut e = engine(song(vec![keys("k", piano(), vec![note(0.1, 0.3, 0.5)])]));
    e.play(0.0, 0.0);
    let out = render(&mut e, 1.0);
    let start = (0.1 * SR) as usize + LAG;
    assert_eq!(out[start - 1], 0.0);
    assert!((out[start] - 0.5).abs() < 1e-6);
    assert!((at(&out, 0.29) - 0.5).abs() < 1e-6);
    // Released: fading, not cut.
    let fading = at(&out, 0.35);
    assert!(fading > 0.0 && fading < 0.5);
    assert!(at(&out, 0.6) < fading);
}

#[test]
fn a_note_starting_before_where_playing_starts_isnt_played() {
    let mut e = engine(song(vec![keys("k", piano(), vec![note(0.0, 2.0, 0.5)])]));
    e.play(0.5, 0.0);
    let out = render(&mut e, 0.5);
    assert!(out.iter().all(|x| *x == 0.0));
}

#[test]
fn stopping_releases_what_the_clips_play() {
    let mut e = engine(song(vec![keys("k", piano(), vec![note(0.0, 5.0, 0.5)])]));
    e.play(0.0, 0.0);
    let playing = render(&mut e, 0.5);
    assert!((*playing.last().unwrap() - 0.5).abs() < 1e-6);
    e.stop();
    let after = render(&mut e, 1.5);
    assert!(after[LAG + 100] < 0.5);
    assert!(after[after.len() - 1] == 0.0);
}

#[test]
fn looping_back_releases_the_notes_and_plays_them_again() {
    let mut e = engine(song(vec![keys("k", piano(), vec![note(0.1, 10.0, 0.5)])]));
    e.set_loop(Some((0.0, 0.5)));
    e.play(0.0, 0.0);
    let out = render(&mut e, 1.2);
    // Each time round: the note starts again at 0.1 s into the loop.
    assert!((at(&out, 0.4) - 0.5).abs() < 1e-6);
    // Just after the jump back, the note from the last time round fades.
    let fading = at(&out, 0.55);
    assert!(fading > 0.0 && fading < 0.5);
    // And a new one starts at 0.6 s (0.1 s into the second time round),
    // on top of what's left of the old one.
    assert!(at(&out, 0.65) > 0.5);
}

#[test]
fn keys_played_live_sound_until_let_go_or_the_pedal_lifts() {
    let mut e = engine(song(vec![keys("k", piano(), vec![])]));
    let k = track_key("k");
    e.key_down(k, 60, 0.4);
    let held = render(&mut e, 0.2);
    assert!((*held.last().unwrap() - 0.4).abs() < 1e-6);
    // The pedal down: letting go keeps it ringing.
    e.sustain(k, true);
    e.key_up(k, 60);
    let sustained = render(&mut e, 0.2);
    assert!((*sustained.last().unwrap() - 0.4).abs() < 1e-6);
    // The pedal up: it releases.
    e.sustain(k, false);
    let released = render(&mut e, 1.2);
    assert!(released[LAG + 4800] < 0.4);
    assert_eq!(*released.last().unwrap(), 0.0);
    // Another track's key, or a track that isn't there, plays nothing.
    e.key_down(track_key("nope"), 60, 1.0);
    assert!(render(&mut e, 0.1).iter().all(|x| *x == 0.0));
}

#[test]
fn an_instrument_rings_on_through_a_new_version_of_the_song() {
    let first = song(vec![keys("k", piano(), vec![])]);
    let mut e = engine(first.clone());
    let k = track_key("k");
    e.key_down(k, 60, 0.4);
    render(&mut e, 0.1);
    // A new version (the fader moved): made knowing the track already has
    // its piano, so it brings none, and the note carries on.
    let mut second = first.clone();
    second.tracks[0].volume = 0.5;
    let old = e.set_song(Box::new(second.prepare(Some(&first), SR)));
    drop(old);
    assert!(!e.take_missing());
    let out = render(&mut e, 0.2);
    assert!((*out.last().unwrap() - 0.2).abs() < 1e-6);
}

#[test]
fn a_version_counting_on_an_instrument_that_isnt_playing_says_so() {
    let first = song(vec![keys("k", piano(), vec![])]);
    let mut e = Engine::new(SR);
    // Made as if `first` were playing, which it never was.
    e.set_song(Box::new(first.clone().prepare(Some(&first), SR)));
    assert!(e.take_missing());
    assert!(!e.take_missing());
    // Made from scratch, it plays.
    e.set_song(Box::new(first.prepare(None, SR)));
    e.key_down(track_key("k"), 60, 0.4);
    assert!(render(&mut e, 0.1).iter().any(|x| *x > 0.0));
}

#[test]
fn a_drum_track_hits_its_pads() {
    let mut kit = DrumKit::default();
    kit.pads[0] = Pad {
        on: true,
        model: 0,
        decay: 0.5,
        tone: 0.5,
        character: 0.5,
        gain: 1.0,
        velocity: 0.7,
        ..Pad::default()
    };
    let drums = InstrumentSpec::Drums {
        kit: Box::new(kit),
        samples: Default::default(),
    };
    let kick = Note {
        start: (0.1 * SR) as i64,
        end: (0.2 * SR) as i64,
        key: 24,
        velocity: 1.0,
    };
    let mut e = engine(song(vec![keys("d", drums, vec![kick])]));
    e.play(0.0, 0.0);
    let out = render(&mut e, 0.5);
    let start = (0.1 * SR) as usize + LAG;
    assert!(out[..start].iter().all(|x| *x == 0.0));
    assert!(out[start..start + 2400].iter().any(|x| x.abs() > 0.1));
}

/// A table of `frames` frames of 1.0.
fn flat_table(frames: usize) -> Wavetable {
    Wavetable::new(Arc::new(AudioData {
        channels: vec![vec![1.0; frames * FRAME_SAMPLES]],
    }))
    .unwrap()
}

/// Oscillator 1 alone at `level` (centered, no filters, 0 dB, velocity
/// ignored), sounding at once while a key is held, with `routes`.
fn synth(level: f64, routes: &[Route], tables: bool) -> InstrumentSpec {
    let mut base = [0.0; DESTS.len()];
    // Centered pans, at 0 dB.
    for d in [1, 10, 19, 21] {
        base[d] = 0.5;
    }
    base[0] = level;
    base[36] = 48.0 / 54.0;
    let settings = SynthSettings {
        base,
        osc: [
            OscSettings {
                on: true,
                unison: 1,
                ..OscSettings::default()
            },
            OscSettings::default(),
        ],
        envs: [EnvSettings {
            decay: 0.1,
            sustain: 1.0,
            release: 0.05,
            ..EnvSettings::default()
        }; 3],
        voice: VoiceSettings {
            polyphony: 8,
            bend_range: 2.0,
            ..VoiceSettings::default()
        },
        ..SynthSettings::default()
    }
    .with_routes(routes);
    InstrumentSpec::Synth {
        settings: Box::new(settings),
        tables: if tables {
            [
                Some(flat_table(2)),
                Some(flat_table(1)),
                Some(flat_table(4)),
            ]
        } else {
            [None, None, None]
        },
    }
}

#[test]
fn a_synth_plays_once_its_wavetables_are_in() {
    let waiting = song(vec![keys("s", synth(0.5, &[], false), vec![])]);
    let mut e = engine(waiting.clone());
    let k = track_key("s");
    e.key_down(k, 60, 1.0);
    assert!(render(&mut e, 0.1).iter().all(|x| *x == 0.0));
    e.key_up(k, 60);
    // They've arrived: the same synth carries on, and plays.
    let ready = song(vec![keys("s", synth(0.5, &[], true), vec![])]);
    drop(e.set_song(Box::new(ready.prepare(Some(&waiting), SR))));
    e.key_down(k, 60, 1.0);
    let out = render(&mut e, 0.2);
    assert!((*out.last().unwrap() - 0.5).abs() < 1e-4);
    // Let go, it fades out over its release.
    e.key_up(k, 60);
    let released = render(&mut e, 0.2);
    assert!(released[LAG + 1200] < 0.5);
    assert_eq!(*released.last().unwrap(), 0.0);
}

#[test]
fn a_synths_clip_notes_play_on_time() {
    let notes = vec![note(0.1, 0.2, 1.0)];
    let mut e = engine(song(vec![keys("s", synth(0.5, &[], true), notes)]));
    e.play(0.0, 0.0);
    let out = render(&mut e, 0.4);
    let start = (0.1 * SR) as usize + LAG;
    assert!(out[..start].iter().all(|x| *x == 0.0));
    // Its envelope opens at the next control step, 32 frames on.
    assert!(out[start + 64] > 0.0);
    assert!((at(&out, 0.19) - 0.5).abs() < 1e-4);
    assert!(at(&out, 0.35) < 0.01);
}

#[test]
fn the_mod_wheel_and_pitch_bend_reach_the_synth() {
    // The wheel and the bend each turn the oscillator up by up to 0.4.
    let routes = [
        Route {
            source: 8,
            dest: 0,
            amount: 0.4,
            bipolar: false,
        },
        Route {
            source: 9,
            dest: 0,
            amount: 0.4,
            bipolar: true,
        },
    ];
    let mut e = engine(song(vec![keys("s", synth(0.0, &routes, true), vec![])]));
    let k = track_key("s");
    e.key_down(k, 60, 1.0);
    assert!(render(&mut e, 0.1).last().unwrap().abs() < 1e-4);
    e.mod_wheel(k, 0.5);
    let wheel = render(&mut e, 0.1);
    assert!((*wheel.last().unwrap() - 0.2).abs() < 1e-4);
    e.pitch_bend(k, 0.5);
    let bent = render(&mut e, 0.1);
    assert!((*bent.last().unwrap() - 0.4).abs() < 1e-4);
    // Out of range, they stop at the ends.
    e.mod_wheel(k, 3.0);
    e.pitch_bend(k, 7.0);
    let ends = render(&mut e, 0.1);
    assert!((*ends.last().unwrap() - 0.8).abs() < 1e-4);
    e.pitch_bend(k, -7.0);
    let down = render(&mut e, 0.1);
    assert!(down.last().unwrap().abs() < 1e-4);
}
