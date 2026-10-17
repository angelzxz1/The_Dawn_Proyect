//! The tempo map in transport seconds: stretches of constant tempo, each
//! starting at a beat at a transport time (`src/project/tempoMap.ts`'s
//! segments). Port of the helpers at the top of the metronome's kernel
//! (`src/engine/metronomeKernel.ts`), with the same tolerance.

/// Positions closer than this (seconds or beats) count as the same.
pub const EPS: f64 = 1e-6;

/// A stretch of constant tempo: from `beat`, at transport time `seconds`,
/// at `bpm`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TempoSegment {
    pub beat: f64,
    pub seconds: f64,
    pub bpm: f64,
}

/// One tempo throughout.
pub fn constant(bpm: f64) -> [TempoSegment; 1] {
    [TempoSegment {
        beat: 0.0,
        seconds: 0.0,
        bpm,
    }]
}

/// The segment playing at transport time `s` (before the first: the first,
/// going on back - a count-in). `segments` isn't empty.
pub fn segment_at_seconds(segments: &[TempoSegment], s: f64) -> TempoSegment {
    let mut seg = segments[0];
    for x in segments {
        if x.seconds <= s + EPS {
            seg = *x;
        }
    }
    seg
}

/// The segment playing at beat `b`.
pub fn segment_at_beat(segments: &[TempoSegment], b: f64) -> TempoSegment {
    let mut seg = segments[0];
    for x in segments {
        if x.beat <= b + EPS {
            seg = *x;
        }
    }
    seg
}

pub fn beat_at_seconds(segments: &[TempoSegment], s: f64) -> f64 {
    let seg = segment_at_seconds(segments, s);
    seg.beat + ((s - seg.seconds) * seg.bpm) / 60.0
}

pub fn seconds_at_beat(segments: &[TempoSegment], b: f64) -> f64 {
    let seg = segment_at_beat(segments, b);
    seg.seconds + ((b - seg.beat) * 60.0) / seg.bpm
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn beats_and_seconds_follow_the_tempo_changes() {
        // 60 BPM, then 120 from beat 2 (at 2 s).
        let map = [
            TempoSegment {
                beat: 0.0,
                seconds: 0.0,
                bpm: 60.0,
            },
            TempoSegment {
                beat: 2.0,
                seconds: 2.0,
                bpm: 120.0,
            },
        ];
        assert_eq!(beat_at_seconds(&map, 1.0), 1.0);
        assert_eq!(beat_at_seconds(&map, 3.0), 4.0);
        assert_eq!(seconds_at_beat(&map, 4.0), 3.0);
        // Before the start, the first tempo goes on back.
        assert_eq!(beat_at_seconds(&map, -1.0), -1.0);
        assert_eq!(seconds_at_beat(&constant(120.0), 8.0), 4.0);
    }
}
