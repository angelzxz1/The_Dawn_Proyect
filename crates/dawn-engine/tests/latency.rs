//! Delay compensation: every path lines up at the master however latent
//! its effects, as the browser's engine lines them up (latency.ts). The
//! Limiter's lookahead (240 frames at 48 kHz) is the latency here, on a
//! track, a bus and the master; a clip of a single sample shows where each
//! path comes out.

use std::sync::Arc;

use dawn_engine::mix::{
    AudioData, Bus, Clip, ClipTiming, Destination, EffectSettings, EffectSpec, Engine, Send, Song,
    Track,
};

const SR: f64 = 48000.0;
/// A limiter's lookahead.
const LOOKAHEAD: usize = 240;
/// Where the clips start (frames).
const AT: usize = 4800;

/// A clip at `AT` of a single sample at `level`.
fn impulse(level: f32) -> Clip {
    let mut samples = vec![0.0; 4800];
    samples[0] = level;
    Clip::new(
        Arc::new(AudioData {
            channels: vec![samples],
        }),
        SR,
        ClipTiming {
            offset: AT as f64 / SR,
            length: 0.1,
            ..Default::default()
        },
    )
}

fn limiter(id: &str) -> EffectSpec {
    EffectSpec::new(id, EffectSettings::from_params("limiter", &[]).unwrap())
}

fn track(id: &str, clips: Vec<Clip>, effects: Vec<EffectSpec>) -> Track {
    Track {
        clips,
        effects,
        ..Track::new(id)
    }
}

fn song(tracks: Vec<Track>) -> Song {
    Song {
        tracks,
        ..Song::default()
    }
}

fn engine(song: &Song) -> Engine {
    let mut e = Engine::new(SR);
    e.set_song(Box::new(song.clone().prepare(None, SR)));
    e.play(0.0, 0.0);
    e
}

fn render(e: &mut Engine, frames: usize) -> Vec<f32> {
    let (mut l, mut r) = (vec![0.0; frames], vec![0.0; frames]);
    e.render(&mut l, &mut r);
    assert_eq!(l, r);
    l
}

/// The frames that aren't silent, and what's in them.
fn hits(out: &[f32]) -> Vec<(usize, f32)> {
    out.iter()
        .enumerate()
        .filter(|(_, x)| x.abs() > 1e-6)
        .map(|(i, x)| (i, (x * 1e4).round() / 1e4))
        .collect()
}

#[test]
fn a_latent_track_and_a_dry_one_line_up_at_the_master() {
    let s = song(vec![
        track("a", vec![impulse(0.25)], vec![limiter("l")]),
        track("b", vec![impulse(0.25)], vec![]),
    ]);
    let mut e = engine(&s);
    assert_eq!(e.song().latency(), 2 * LOOKAHEAD);
    assert_eq!(hits(&render(&mut e, 9600)), [(AT + 2 * LOOKAHEAD, 0.5)]);
}

#[test]
fn without_compensation_the_latent_track_comes_out_late() {
    let s = Song {
        compensation: false,
        ..song(vec![
            track("a", vec![impulse(0.25)], vec![limiter("l")]),
            track("b", vec![impulse(0.25)], vec![]),
        ])
    };
    let mut e = engine(&s);
    assert_eq!(e.song().latency(), LOOKAHEAD);
    assert_eq!(
        hits(&render(&mut e, 9600)),
        [(AT + LOOKAHEAD, 0.25), (AT + 2 * LOOKAHEAD, 0.25)]
    );
}

#[test]
fn a_send_through_a_latent_bus_lines_up_with_the_dry_path() {
    let a = Track {
        sends: vec![Send { bus: 0, gain: 1.0 }],
        ..track("a", vec![impulse(0.25)], vec![])
    };
    let s = Song {
        buses: vec![Bus {
            effects: vec![limiter("l")],
            ..Bus::new("verb")
        }],
        ..song(vec![a])
    };
    let mut e = engine(&s);
    assert_eq!(hits(&render(&mut e, 9600)), [(AT + 2 * LOOKAHEAD, 0.5)]);
}

#[test]
fn a_groups_own_sources_wait_for_the_tracks_feeding_it() {
    let member = Track {
        destination: Destination::Track(0),
        ..track("kick", vec![impulse(0.25)], vec![limiter("l")])
    };
    let s = song(vec![track("group", vec![impulse(0.25)], vec![]), member]);
    let mut e = engine(&s);
    assert_eq!(hits(&render(&mut e, 9600)), [(AT + 2 * LOOKAHEAD, 0.5)]);
}

#[test]
fn a_live_track_isnt_held_back() {
    let played = Track {
        live: true,
        ..track("keys", vec![impulse(0.25)], vec![])
    };
    let s = song(vec![
        played,
        track("b", vec![impulse(0.25)], vec![limiter("l")]),
    ]);
    let mut e = engine(&s);
    assert_eq!(
        hits(&render(&mut e, 9600)),
        [(AT + LOOKAHEAD, 0.25), (AT + 2 * LOOKAHEAD, 0.25)]
    );
}

#[test]
fn oversampling_counts_too() {
    let glue = EffectSpec::new(
        "g",
        EffectSettings::from_params("glue", &[("oversample", 1.0)]).unwrap(),
    );
    let s = song(vec![track("a", vec![], vec![glue])]);
    assert_eq!(s.prepare(None, SR).latency(), 15 + LOOKAHEAD);
}

#[test]
fn the_clicks_wait_as_long_as_the_mix() {
    let first_click = |s: &Song| {
        let mut e = engine(s);
        e.set_metronome(true);
        e.play(0.0, 0.0);
        render(&mut e, 4800).iter().position(|x| *x != 0.0)
    };
    let dry = first_click(&song(vec![track("a", vec![], vec![])])).unwrap();
    let latent = first_click(&song(vec![track("a", vec![], vec![limiter("l")])])).unwrap();
    assert_eq!(latent, dry + LOOKAHEAD);
}

#[test]
fn a_new_version_of_the_song_keeps_what_the_delays_hold() {
    let s = song(vec![
        track("a", vec![impulse(0.25)], vec![limiter("l")]),
        track("b", vec![impulse(0.5)], vec![]),
    ]);
    let straight = render(&mut engine(&s), 9600);
    // The new version arrives while the dry track's hit waits in its delay.
    let mut e = engine(&s);
    let mut out = render(&mut e, AT + 100);
    e.set_song(Box::new(s.clone().prepare(Some(&s), SR)));
    out.extend(render(&mut e, 9600 - AT - 100));
    assert_eq!(out, straight);
}
