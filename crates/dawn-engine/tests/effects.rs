//! Effects in the engine's chains: a track's ahead of its fader, a bus's on
//! its sends, the master's after its fader and ahead of the limiter; a
//! bypassed one skipped; each carrying on through a new version of the
//! song. The clips here are a constant level, so what an effect does to it
//! is easy to read. The master limiter delays everything by LAG frames.

use std::sync::Arc;

use dawn_engine::effects::PORTED;
use dawn_engine::mix::{
    AudioData, Bus, Clip, ClipTiming, EffectSettings, EffectSpec, Engine, Send, Song, Track,
};

const SR: f64 = 48000.0;
const LAG: usize = 240;

fn dc(level: f32, seconds: f64) -> Arc<AudioData> {
    Arc::new(AudioData {
        channels: vec![vec![level; (seconds * SR) as usize]],
    })
}

/// A track playing a constant `level` for 10 s.
fn track(id: &str, level: f32, effects: Vec<EffectSpec>) -> Track {
    let clip = Clip::new(
        dc(level, 10.0),
        SR,
        ClipTiming {
            offset: 0.0,
            length: 10.0,
            ..Default::default()
        },
    );
    Track {
        clips: vec![clip],
        effects,
        ..Track::new(id)
    }
}

fn effect(id: &str, kind: &str, params: &[(&str, f64)]) -> EffectSpec {
    EffectSpec::new(id, EffectSettings::from_params(kind, params).unwrap())
}

/// A Utility at `db`.
fn gain(id: &str, db: f64) -> EffectSpec {
    effect(id, "utility", &[("gain", db)])
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

fn render(e: &mut Engine, seconds: f64) -> Vec<f32> {
    let n = (seconds * SR) as usize;
    let (mut l, mut r) = (vec![0.0; n], vec![0.0; n]);
    e.render(&mut l, &mut r);
    assert_eq!(l, r);
    l
}

fn close(a: f32, b: f64) -> bool {
    (a as f64 - b).abs() < 1e-4
}

#[test]
fn a_tracks_effects_run_in_order_ahead_of_its_fader() {
    // -6 dB then +12 dB: +6 dB in all; the fader halves it again.
    let mut t = track("a", 0.25, vec![gain("u1", -6.0), gain("u2", 12.0)]);
    t.volume = 0.5;
    let out = render(&mut engine(&song(vec![t])), 0.1);
    let expected = 0.25 * 10f64.powf(6.0 / 20.0) * 0.5;
    assert!(close(out[LAG + 100], expected), "{}", out[LAG + 100]);
}

#[test]
fn a_bypassed_effect_is_skipped() {
    let mut fx = gain("u", -20.0);
    fx.bypass = true;
    let out = render(&mut engine(&song(vec![track("a", 0.25, vec![fx])])), 0.1);
    assert!(close(out[LAG + 100], 0.25));
}

#[test]
fn a_buss_effects_run_on_what_its_sent() {
    let mut t = track("a", 0.25, vec![]);
    t.sends = vec![Send { bus: 0, gain: 1.0 }];
    let mut s = song(vec![t]);
    s.buses = vec![Bus {
        effects: vec![gain("u", -6.0)],
        ..Bus::new("fx")
    }];
    let out = render(&mut engine(&s), 0.1);
    // The dry track, and the bus's copy at half.
    let expected = 0.25 + 0.25 * 10f64.powf(-6.0 / 20.0);
    assert!(close(out[LAG + 100], expected), "{}", out[LAG + 100]);
}

#[test]
fn the_masters_effects_run_after_its_fader_and_ahead_of_its_limiter() {
    // A limiter at -12 dB on the master, the master fader doubling: if it
    // came after the fader, the level is held at -12 dB.
    let mut s = song(vec![track("a", 0.5, vec![])]);
    s.master.volume = 2.0;
    s.master_effects = vec![effect("lim", "limiter", &[("threshold", -12.0)])];
    let out = render(&mut engine(&s), 0.2);
    let ceiling = 10f64.powf(-12.0 / 20.0);
    let settled = out[out.len() - 1];
    assert!(close(settled, ceiling), "{settled}");
}

#[test]
fn an_effect_carries_on_through_a_new_version_of_the_song() {
    let first = song(vec![track("a", 0.25, vec![gain("u", 0.0)])]);
    let mut e = engine(&first);
    render(&mut e, 0.1);
    // The same Utility, turned down: it glides there (over ~10 ms) rather
    // than starting afresh at its new gain.
    let mut second = first.clone();
    second.tracks[0].effects[0] = gain("u", -20.0);
    drop(e.set_song(Box::new(second.clone().prepare(Some(&first), SR))));
    assert!(!e.take_missing());
    let out = render(&mut e, 0.2);
    assert!(out[LAG + 10] > 0.2, "{}", out[LAG + 10]);
    assert!(close(*out.last().unwrap(), 0.025));
    // Another one in its place (a new id) starts at its own gain.
    let mut third = second.clone();
    third.tracks[0].effects[0] = gain("v", -20.0);
    drop(e.set_song(Box::new(third.clone().prepare(Some(&second), SR))));
    let mut fourth = third.clone();
    fourth.tracks[0].effects[0] = gain("w", 0.0);
    drop(e.set_song(Box::new(fourth.prepare(Some(&third), SR))));
    let out = render(&mut e, 0.1);
    assert!(close(out[LAG + 10], 0.25), "{}", out[LAG + 10]);
}

#[test]
fn a_version_counting_on_an_effect_that_isnt_playing_says_so() {
    let s = song(vec![track("a", 0.25, vec![gain("u", -6.0)])]);
    let mut e = Engine::new(SR);
    e.set_song(Box::new(s.clone().prepare(Some(&s), SR)));
    assert!(e.take_missing());
    // Unprepared, it plays dry until the song comes again from scratch.
    e.set_song(Box::new(s.prepare(None, SR)));
    assert!(!e.take_missing());
}

#[test]
fn a_compressor_turns_a_loud_track_down() {
    let comp = effect(
        "c",
        "compressor",
        &[
            ("threshold", -24.0),
            ("ratio", 8.0),
            ("attack", 0.001),
            ("makeupAuto", 0.0),
        ],
    );
    let out = render(&mut engine(&song(vec![track("a", 0.5, vec![comp])])), 0.5);
    let settled = *out.last().unwrap();
    // 0.5 is -6 dB: 18 dB over, at 8:1 about 15.75 dB down.
    assert!(settled < 0.2 && settled > 0.05, "{settled}");
}

#[test]
fn a_type_the_engine_hasnt_got_has_no_settings() {
    assert!(EffectSettings::from_params("reverb", &[("decay", 2.0)]).is_none());
}

#[test]
fn every_ported_type_plays_in_a_chain() {
    // A 220 Hz tone (the amp, like a real one, lets no DC through).
    let tone = Arc::new(AudioData {
        channels: vec![
            (0..(SR as usize))
                .map(|i| 0.25 * (2.0 * std::f64::consts::PI * 220.0 * i as f64 / SR).sin() as f32)
                .collect(),
        ],
    });
    for kind in PORTED {
        let clip = Clip::new(
            tone.clone(),
            SR,
            ClipTiming {
                offset: 0.0,
                length: 1.0,
                ..Default::default()
            },
        );
        let t = Track {
            clips: vec![clip],
            effects: vec![effect("e", kind, &[])],
            ..Track::new("a")
        };
        let out = render(&mut engine(&song(vec![t])), 0.4);
        assert!(out.iter().all(|x| x.is_finite()), "{kind}");
        let peak = out[out.len() - 4800..]
            .iter()
            .fold(0.0f32, |m, x| m.max(x.abs()));
        assert!(peak > 0.05, "{kind}: {peak}");
    }
}
