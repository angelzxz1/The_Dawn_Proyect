//! The metronome: where the clicks fall (the beat grid, the tempo map, the
//! loop, the count-in, the accents) and the click sounds themselves.
//!
//! Port of `MetronomeKernel` in `src/engine/metronomeKernel.ts`, step for
//! step; `tests/metronome_parity.rs` holds the port to what the JavaScript
//! renders. Times are on the engine's clock (seconds of audio rendered, the
//! web app's context time) and positions on the transport (seconds).
//!
//! `render` doesn't allocate: the clicks sounding live in a fixed set of
//! voices, and the clicks ahead are walked, not collected.

use std::f64::consts::PI;

use super::tempo::{
    EPS, TempoSegment, beat_at_seconds, constant, seconds_at_beat, segment_at_seconds,
};

/// JavaScript's `Math.round`: halves go up.
fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// A loop of the transport, in seconds: reaching `end` jumps to `start`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Loop {
    pub start: f64,
    pub end: f64,
}

/// Walks the beats (whole beat positions) that sound from transport
/// position `pos` over the next `span` seconds of playing, following the
/// tempo map and the loop like the transport does (reaching its end jumps
/// back to its start). `inclusive`: a beat exactly at `pos` counts. `click`
/// gets how many seconds of playing after `pos` each one sounds, and its
/// beat; returning false stops the walk.
pub fn clicks_ahead(
    segments: &[TempoSegment],
    pos: f64,
    span: f64,
    loop_: Option<Loop>,
    inclusive: bool,
    mut click: impl FnMut(f64, f64) -> bool,
) {
    let looping = loop_.filter(|l| l.end - l.start > EPS);
    let mut elapsed = 0.0;
    let mut p = pos;
    let mut include = inclusive;
    // Bounded so a loop with no whole beat inside can't spin forever.
    for _ in 0..10_000 {
        let b = beat_at_seconds(segments, p);
        let k = if include {
            (b - EPS).ceil()
        } else {
            (b + EPS).floor() + 1.0
        };
        let t = seconds_at_beat(segments, k);
        if let Some(l) = looping
            && t >= l.end - EPS
        {
            elapsed += (l.end - p).max(0.0);
            if elapsed > span + EPS {
                break;
            }
            p = l.start;
            include = true;
            continue;
        }
        elapsed += t - p;
        if elapsed > span + EPS {
            break;
        }
        if !click(elapsed, k) {
            break;
        }
        p = t;
        include = false;
    }
}

/// Whether a beat position starts a bar.
pub fn is_downbeat(beat: f64, beats_per_bar: f64) -> bool {
    let n = js_round(beats_per_bar).max(1.0) as i64;
    let b = js_round(beat) as i64;
    (b % n + n) % n == 0
}

/// A short square-ish blip, band-limited so it doesn't alias.
pub fn click_sound(sample_rate: f64, frequency: f64, gain_db: f64) -> Vec<f32> {
    let length = js_round(0.07 * sample_rate) as usize;
    let gain = 10f64.powf(gain_db / 20.0);
    (0..length)
        .map(|i| {
            let t = i as f64 / sample_rate;
            let mut wave = 0.0;
            let mut h = 1.0;
            while h <= 9.0 && h * frequency < sample_rate / 2.0 {
                wave += (2.0 * PI * h * frequency * t).sin() / h;
                h += 2.0;
            }
            // 1 ms attack, then ~40 ms decay.
            let env = (t / 0.001).min(1.0) * (-t / 0.012).exp();
            ((4.0 / PI) * wave * env * gain) as f32
        })
        .collect()
}

/// Which of the four sounds a click plays.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Sound {
    Accent,
    Beat,
    CountAccent,
    CountBeat,
}

/// A click sounding: its sound, how far in, how many frames until it
/// starts, and when (engine time) it started.
#[derive(Clone, Copy, Debug)]
struct Voice {
    sound: Sound,
    index: usize,
    offset: usize,
    time: f64,
}

/// Where clicking continues from: transport position `pos` at engine time
/// `time`; whether a beat right there counts.
#[derive(Clone, Copy, Debug)]
struct Next {
    time: f64,
    pos: f64,
    inclusive: bool,
}

/// More clicks than this sounding at once are dropped (a click lasts 70 ms,
/// so it never comes to that).
const MAX_VOICES: usize = 32;

pub struct Metronome {
    sample_rate: f64,
    /// The tempo map (transport seconds).
    segments: Vec<TempoSegment>,
    beats_per_bar: f64,
    loop_: Option<Loop>,
    /// Clicks after the count-in sound only while this is on.
    enabled: bool,
    /// None when stopped.
    next: Option<Next>,
    /// Engine time the transport starts at, and the position it starts
    /// from; clicks before it are the count-in, which always sounds
    /// (louder), at the tempo where playing starts.
    start_time: f64,
    start_pos: f64,
    count_in: [TempoSegment; 1],
    voices: [Option<Voice>; MAX_VOICES],
    accent: Vec<f32>,
    beat: Vec<f32>,
    count_accent: Vec<f32>,
    count_beat: Vec<f32>,
}

impl Metronome {
    pub fn new(sample_rate: f64) -> Self {
        Self {
            sample_rate,
            segments: constant(120.0).to_vec(),
            beats_per_bar: 4.0,
            loop_: None,
            enabled: false,
            next: None,
            start_time: 0.0,
            start_pos: 0.0,
            count_in: constant(120.0),
            voices: [None; MAX_VOICES],
            // Loud enough to cut through a mix with drums; the count-in a
            // little louder still.
            accent: click_sound(sample_rate, 1046.5, -6.0),
            beat: click_sound(sample_rate, 523.25, -6.0),
            count_accent: click_sound(sample_rate, 1046.5, -3.0),
            count_beat: click_sound(sample_rate, 523.25, -3.0),
        }
    }

    fn sound(&self, sound: Sound) -> &[f32] {
        match sound {
            Sound::Accent => &self.accent,
            Sound::Beat => &self.beat,
            Sound::CountAccent => &self.count_accent,
            Sound::CountBeat => &self.count_beat,
        }
    }

    /// Clicks from transport position `pos` at engine time `time`, after
    /// `count_in_beats` beats of count-in at the tempo there, on its grid.
    pub fn start(&mut self, time: f64, pos: f64, count_in_beats: f64) {
        self.voices = [None; MAX_VOICES];
        self.start_time = time;
        self.start_pos = pos;
        let bpm = segment_at_seconds(&self.segments, pos).bpm;
        self.count_in = [TempoSegment {
            beat: beat_at_seconds(&self.segments, pos),
            seconds: pos,
            bpm,
        }];
        let lead = (count_in_beats * 60.0) / bpm;
        self.next = Some(Next {
            time: time - lead,
            pos: pos - lead,
            inclusive: true,
        });
    }

    /// Stops, silencing any click still sounding.
    pub fn stop(&mut self) {
        self.next = None;
        self.voices = [None; MAX_VOICES];
    }

    pub fn running(&self) -> bool {
        self.next.is_some()
    }

    /// After a jump, a tempo or a loop change: carries on from position
    /// `pos` at `time`. Ignored during the count-in (nothing has moved yet).
    pub fn resync(&mut self, time: f64, pos: f64) {
        if self.next.is_none() || time < self.start_time {
            return;
        }
        for v in &mut self.voices {
            if v.is_some_and(|v| v.time > time) {
                *v = None;
            }
        }
        self.next = Some(Next {
            time,
            pos,
            inclusive: true,
        });
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    /// A new tempo map (not empty); the old one comes back, so it can be
    /// freed off the audio thread.
    pub fn set_tempo(&mut self, segments: Vec<TempoSegment>) -> Vec<TempoSegment> {
        if segments.is_empty() {
            return segments;
        }
        std::mem::replace(&mut self.segments, segments)
    }

    pub fn set_beats_per_bar(&mut self, beats_per_bar: f64) {
        self.beats_per_bar = beats_per_bar;
    }

    pub fn set_loop(&mut self, loop_: Option<Loop>) {
        self.loop_ = loop_;
    }

    fn add_voice(&mut self, voice: Voice) {
        if let Some(slot) = self.voices.iter_mut().find(|v| v.is_none()) {
            *slot = Some(voice);
        }
    }

    /// Queues the clicks from where clicking is up to engine time `until`
    /// (not including it), on the count-in's grid or the song's, and loop.
    fn schedule(&mut self, time: f64, until: f64, count_in: bool) {
        let Some(next) = self.next else {
            return;
        };
        let segments = std::mem::take(&mut self.segments);
        let grid: &[TempoSegment] = if count_in {
            &self.count_in.clone()
        } else {
            &segments
        };
        let loop_ = if count_in { None } else { self.loop_ };
        let mut queued: [Option<(f64, f64)>; MAX_VOICES] = [None; MAX_VOICES];
        let mut count = 0;
        let mut last: Option<(f64, f64)> = None;
        clicks_ahead(
            grid,
            next.pos,
            until - next.time,
            loop_,
            next.inclusive,
            |elapsed, beat| {
                let t = next.time + elapsed;
                if t >= until - EPS {
                    return false;
                }
                if count < MAX_VOICES {
                    queued[count] = Some((t, beat));
                    count += 1;
                }
                last = Some((t, beat));
                true
            },
        );
        for &(t, beat) in queued.iter().take(count).flatten() {
            let in_count_in = t < self.start_time - EPS;
            // A click more than 5 ms late (a start that arrived late) is
            // skipped.
            if t >= time - 0.005 && (in_count_in || self.enabled) {
                let accent = is_downbeat(beat, self.beats_per_bar);
                let sound = match (in_count_in, accent) {
                    (true, true) => Sound::CountAccent,
                    (true, false) => Sound::CountBeat,
                    (false, true) => Sound::Accent,
                    (false, false) => Sound::Beat,
                };
                let offset = js_round((t - time) * self.sample_rate).max(0.0) as usize;
                self.add_voice(Voice {
                    sound,
                    index: 0,
                    offset,
                    time: t,
                });
            }
        }
        if let Some((t, beat)) = last {
            self.next = Some(Next {
                time: t,
                pos: seconds_at_beat(grid, beat),
                inclusive: false,
            });
        }
        self.segments = segments;
    }

    /// Writes this block's clicks into `out` (`out.len()` frames from
    /// engine time `time`), replacing what was there.
    pub fn render(&mut self, out: &mut [f32], time: f64) {
        out.fill(0.0);
        let n = out.len();
        let end = time + n as f64 / self.sample_rate;
        // The count-in, up to the start: it doesn't loop, and keeps the
        // tempo where playing starts. Then the song's beats from there on.
        if let Some(next) = self.next
            && next.time < self.start_time - EPS
            && end > next.time
        {
            self.schedule(time, end.min(self.start_time), true);
            if end >= self.start_time {
                self.next = Some(Next {
                    time: self.start_time,
                    pos: self.start_pos,
                    inclusive: true,
                });
            }
        }
        if let Some(next) = self.next
            && next.time >= self.start_time - EPS
            && end > next.time
        {
            self.schedule(time, end, false);
        }
        for i in 0..MAX_VOICES {
            let Some(mut v) = self.voices[i] else {
                continue;
            };
            if v.offset >= n {
                v.offset -= n;
                self.voices[i] = Some(v);
                continue;
            }
            let len = self.sound(v.sound).len();
            let mut k = v.offset;
            while k < n && v.index < len {
                out[k] += self.sound(v.sound)[v.index];
                v.index += 1;
                k += 1;
            }
            v.offset = 0;
            self.voices[i] = (v.index < len).then_some(v);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 60 BPM: a beat a second, so beats and seconds read the same.
    fn one() -> [TempoSegment; 1] {
        constant(60.0)
    }

    fn walk(
        segments: &[TempoSegment],
        pos: f64,
        span: f64,
        loop_: Option<Loop>,
        inclusive: bool,
    ) -> Vec<(f64, f64)> {
        let mut out = vec![];
        clicks_ahead(segments, pos, span, loop_, inclusive, |e, b| {
            out.push((e, b));
            true
        });
        out
    }

    #[test]
    fn clicks_on_whole_beats_counting_one_right_at_the_start() {
        assert_eq!(
            walk(&one(), 4.0, 2.5, None, true),
            [(0.0, 4.0), (1.0, 5.0), (2.0, 6.0)]
        );
        assert_eq!(walk(&one(), 4.0, 1.0, None, false), [(1.0, 5.0)]);
        assert_eq!(walk(&one(), 2.5, 2.0, None, true), [(0.5, 3.0), (1.5, 4.0)]);
    }

    #[test]
    fn follows_the_loop_back_to_its_start() {
        let l = Some(Loop {
            start: 4.0,
            end: 8.0,
        });
        let beats: Vec<f64> = walk(&one(), 6.0, 4.0, l, true)
            .iter()
            .map(|c| c.1)
            .collect();
        assert_eq!(beats, [6.0, 7.0, 4.0, 5.0, 6.0]);
    }

    #[test]
    fn downbeats_start_bars() {
        assert!(is_downbeat(0.0, 4.0));
        assert!(is_downbeat(8.0, 4.0));
        assert!(!is_downbeat(6.0, 4.0));
        assert!(is_downbeat(-4.0, 4.0));
        assert!(is_downbeat(6.0, 3.0));
    }

    #[test]
    fn plays_the_count_in_then_clicks_only_when_on() {
        let sr = 48000.0;
        let mut m = Metronome::new(sr);
        // Two beats of count-in at 120 BPM before the transport starts at
        // engine time 1 s from position 0.
        m.start(1.0, 0.0, 2.0);
        let mut out = vec![0.0; 48000 * 2];
        m.render(&mut out, 0.0);
        let at = |s: f64| out[(s * sr) as usize + 100].abs() > 0.0;
        // Count-in clicks at 0 and 0.5 s; nothing at 1 s (metronome off).
        assert!(at(0.0) && at(0.5));
        assert!(!at(1.0) && !at(1.5));
    }
}
