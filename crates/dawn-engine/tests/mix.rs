//! The engine's mix: clips on tracks through strips, routing, sends, buses
//! and the master, with the transport moving, looping and counting in.
//! The master limiter delays everything by its lookahead (240 frames at
//! 48 kHz), so what a track plays at frame `i` comes out at `i + LAG`.

use std::sync::Arc;

use dawn_engine::mix::{AudioData, Bus, Clip, ClipTiming, Destination, Engine, Send, Song, Track};

const SR: f64 = 48000.0;
const LAG: usize = 240;

/// A file of `seconds` of a constant `level` (mono).
fn dc(level: f32, seconds: f64) -> Arc<AudioData> {
    Arc::new(AudioData {
        channels: vec![vec![level; (seconds * SR) as usize]],
    })
}

fn clip(audio: Arc<AudioData>, offset: f64, length: f64) -> Clip {
    Clip::new(
        audio,
        SR,
        ClipTiming {
            offset,
            length,
            ..Default::default()
        },
    )
}

fn track_with(id: &str, clips: Vec<Clip>) -> Track {
    Track {
        clips,
        ..Track::new(id)
    }
}

/// Plays `song` from `from` for `seconds`, returning left and right.
fn play(song: Song, from: f64, seconds: f64) -> (Vec<f32>, Vec<f32>) {
    let mut engine = Engine::new(SR);
    engine.set_song(Box::new(song.prepare(None, SR)));
    engine.play(from, 0.0);
    let n = (seconds * SR) as usize;
    let (mut l, mut r) = (vec![0.0; n], vec![0.0; n]);
    engine.render(&mut l, &mut r);
    (l, r)
}

fn song(tracks: Vec<Track>) -> Song {
    Song {
        tracks,
        ..Song::default()
    }
}

fn close(a: f32, b: f32) -> bool {
    (a - b).abs() < 1e-5
}

#[test]
fn a_clip_plays_where_it_sits_at_unity() {
    let (l, r) = play(
        song(vec![track_with("a", vec![clip(dc(0.5, 1.0), 0.1, 0.2)])]),
        0.0,
        0.5,
    );
    let at = |s: f64| (s * SR) as usize + LAG;
    assert_eq!(l[at(0.05)], 0.0);
    assert!(close(l[at(0.2)], 0.5) && close(r[at(0.2)], 0.5));
    assert_eq!(l[at(0.35)], 0.0);
}

#[test]
fn playing_from_the_middle_of_a_clip() {
    let (l, _) = play(
        song(vec![track_with("a", vec![clip(dc(0.5, 1.0), 0.0, 1.0)])]),
        0.5,
        0.1,
    );
    assert!(close(l[LAG + 10], 0.5));
}

#[test]
fn the_fader_and_web_audios_stereo_panner() {
    let mut t = track_with("a", vec![clip(dc(0.25, 1.0), 0.0, 1.0)]);
    t.volume = 0.5;
    t.pan = -1.0;
    let (l, r) = play(song(vec![t]), 0.0, 0.1);
    // Hard left: the right side moves into the left (0.25 + 0.25), at half.
    assert!(close(l[LAG + 100], 0.25));
    assert!(close(r[LAG + 100], 0.0));
}

#[test]
fn an_unheard_track_is_silent() {
    let mut t = track_with("a", vec![clip(dc(0.5, 1.0), 0.0, 1.0)]);
    t.audible = false;
    let (l, _) = play(song(vec![t]), 0.0, 0.1);
    assert!(l.iter().all(|x| *x == 0.0));
}

#[test]
fn a_track_routed_into_another_goes_through_its_fader() {
    // "a" goes into the group "g" (at half), which goes to the master.
    let mut a = track_with("a", vec![clip(dc(0.5, 1.0), 0.0, 1.0)]);
    a.destination = Destination::Track(1);
    let mut g = Track::new("g");
    g.volume = 0.5;
    let (l, _) = play(song(vec![a, g]), 0.0, 0.1);
    assert!(close(l[LAG + 100], 0.25));
}

#[test]
fn sends_feed_buses_after_the_fader() {
    let mut a = track_with("a", vec![clip(dc(0.2, 1.0), 0.0, 1.0)]);
    a.volume = 0.5;
    a.sends = vec![Send { bus: 0, gain: 0.5 }];
    let mut s = song(vec![a]);
    s.buses = vec![Bus {
        id: "fx".into(),
        volume: 1.0,
        pan: 0.0,
    }];
    let (l, _) = play(s, 0.0, 0.1);
    // Dry 0.1, plus the send: 0.1 at half.
    assert!(close(l[LAG + 100], 0.15));
}

#[test]
fn the_master_limits_at_its_ceiling() {
    let (l, _) = play(
        song(vec![track_with("a", vec![clip(dc(2.0, 1.0), 0.0, 1.0)])]),
        0.0,
        0.2,
    );
    let ceiling = 10f32.powf(-1.0 / 20.0);
    assert!(l.iter().all(|x| x.abs() <= ceiling + 1e-5));
    assert!(close(l[5000], ceiling));
}

#[test]
fn the_loop_jumps_back() {
    // A ramp file, so the position shows in the level.
    let ramp = Arc::new(AudioData {
        channels: vec![(0..48000).map(|i| i as f32 / 48000.0).collect()],
    });
    let mut engine = Engine::new(SR);
    engine.set_song(Box::new(
        song(vec![track_with("a", vec![clip(ramp, 0.0, 1.0)])]).prepare(None, SR),
    ));
    engine.set_loop(Some((0.25, 0.5)));
    engine.play(0.25, 0.0);
    let n = 48000;
    let (mut l, mut r) = (vec![0.0; n], vec![0.0; n]);
    engine.render(&mut l, &mut r);
    // A quarter second after starting it's back at 0.25.
    let at = |s: f64| l[(s * SR) as usize + LAG];
    assert!(close(at(0.1), 0.35));
    assert!(close(at(0.3), 0.30));
    assert!(engine.position_seconds() < 0.5);
}

#[test]
fn a_count_in_waits_before_the_song() {
    let mut engine = Engine::new(SR);
    engine.set_song(Box::new(
        song(vec![track_with("a", vec![clip(dc(0.5, 4.0), 0.0, 4.0)])]).prepare(None, SR),
    ));
    // Two beats at 120 BPM: a second.
    engine.play(0.0, 2.0);
    let n = 2 * 48000;
    let (mut l, mut r) = (vec![0.0; n], vec![0.0; n]);
    engine.render(&mut l, &mut r);
    // The count-in clicks sound (they don't wait for the transport); the
    // clip starts after a second.
    let click_free = |s: f64| l[(s * SR) as usize + 2000];
    assert!(!close(click_free(0.0), 0.0));
    assert!(close(l[(0.9 * SR) as usize], 0.0));
    assert!(close(l[(1.2 * SR) as usize], 0.5));
}

#[test]
fn a_fader_move_glides_over_a_block() {
    let mut engine = Engine::new(SR);
    let s = song(vec![track_with("a", vec![clip(dc(0.5, 1.0), 0.0, 1.0)])]);
    let first = Box::new(s.clone().prepare(None, SR));
    engine.set_song(first);
    engine.play(0.0, 0.0);
    let (mut l, mut r) = (vec![0.0; 2048], vec![0.0; 2048]);
    engine.render(&mut l, &mut r);
    let mut quiet = s;
    quiet.tracks[0].volume = 0.0;
    let prepared = Box::new(quiet.prepare(Some(&engine.song().song), SR));
    engine.set_song(prepared);
    let (mut l, mut r) = (vec![0.0; 2048], vec![0.0; 2048]);
    engine.render(&mut l, &mut r);
    // It falls over the block rather than stopping dead (the limiter's
    // lookahead puts the fall LAG frames in).
    let mid = l[LAG + 1024];
    assert!(mid > 0.1 && mid < 0.4, "{mid}");
}

#[test]
fn stopped_it_stays_put_and_silent() {
    let mut engine = Engine::new(SR);
    engine.set_song(Box::new(
        song(vec![track_with("a", vec![clip(dc(0.5, 1.0), 0.0, 1.0)])]).prepare(None, SR),
    ));
    engine.seek(0.3);
    let (mut l, mut r) = (vec![0.0; 4800], vec![0.0; 4800]);
    engine.render(&mut l, &mut r);
    assert!(l.iter().all(|x| *x == 0.0));
    assert_eq!(engine.position_seconds(), 0.3);
}

#[test]
fn meters_hold_their_peaks_until_read() {
    let mut engine = Engine::new(SR);
    engine.set_song(Box::new(
        song(vec![track_with("a", vec![clip(dc(0.5, 1.0), 0.0, 1.0)])]).prepare(None, SR),
    ));
    engine.play(0.0, 0.0);
    let (mut l, mut r) = (vec![0.0; 4800], vec![0.0; 4800]);
    engine.render(&mut l, &mut r);
    let mut track = [0.0f32; 2];
    let master = engine.take_peaks(
        |i, p| {
            if i == 0 {
                track = p
            }
        },
        |_, _| {},
    );
    assert!(close(track[0], 0.5) && close(master[1], 0.5));
    let again = engine.take_peaks(|_, _| {}, |_, _| {});
    assert_eq!(again, [0.0, 0.0]);
}
