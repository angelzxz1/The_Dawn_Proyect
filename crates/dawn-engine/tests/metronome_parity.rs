//! The metronome port against the JavaScript kernel: plays the session in
//! the fixture (made by src/engine/metronomeParity.test.ts) - its commands
//! at their blocks - and compares the clicks with what the JavaScript
//! rendered.

mod common;

use common::FixtureReader;
use dawn_engine::mix::metronome::{Loop, Metronome};
use dawn_engine::mix::tempo::TempoSegment;

/// -100 dB (the run prints the largest difference).
const TOLERANCE: f64 = 1e-5;

enum Command {
    Start {
        time: f64,
        pos: f64,
        count_in_beats: f64,
    },
    Stop,
    Resync {
        time: f64,
        pos: f64,
    },
    Enabled(bool),
    Tempo(&'static [TempoSegment]),
    Meter(f64),
    Loop(Option<Loop>),
}

include!("fixtures/metronome.rs");

const DATA: &[u8] = include_bytes!("fixtures/metronome.bin");

fn render() -> Vec<f32> {
    let mut m = Metronome::new(SAMPLE_RATE);
    let mut out = vec![0.0f32; FRAMES];
    let mut next = 0;
    for start in (0..FRAMES).step_by(BLOCK) {
        while next < SESSION.len() && SESSION[next].0 == start {
            match &SESSION[next].1 {
                Command::Start {
                    time,
                    pos,
                    count_in_beats,
                } => m.start(*time, *pos, *count_in_beats),
                Command::Stop => m.stop(),
                Command::Resync { time, pos } => m.resync(*time, *pos),
                Command::Enabled(on) => m.set_enabled(*on),
                Command::Tempo(segments) => {
                    m.set_tempo(segments.to_vec());
                }
                Command::Meter(beats) => m.set_beats_per_bar(*beats),
                Command::Loop(l) => m.set_loop(*l),
            }
            next += 1;
        }
        let end = (start + BLOCK).min(FRAMES);
        m.render(&mut out[start..end], start as f64 / SAMPLE_RATE);
    }
    out
}

#[test]
fn clicks_where_the_javascript_kernel_clicks() {
    let out = render();
    let mut data = FixtureReader::new(DATA);
    let mut worst = 0.0f64;
    for i in (0..FRAMES).step_by(STRIDE) {
        worst = worst.max(f64::from((out[i] - data.f32()).abs()));
    }
    eprintln!("largest difference: {worst:.1e}");
    assert!(worst <= TOLERANCE, "the port is off by up to {worst:.1e}");
    assert!(
        data.is_empty(),
        "the fixture has more data than the session: remake it"
    );
}

#[test]
fn the_session_clicks() {
    // Silence would prove little: count the clicks heard (a jump from
    // silence starts one).
    let out = render();
    let starts = out
        .windows(2)
        .filter(|w| w[0] == 0.0 && w[1] != 0.0)
        .count();
    assert!(starts > 8, "only {starts} clicks");
}
