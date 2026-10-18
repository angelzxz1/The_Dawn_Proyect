//! Delay compensation, planned as the browser's engine plans it
//! (`src/engine/latency.ts`, `planCompensation`), in frames: some effects
//! delay their audio (a limiter's lookahead, oversampling), which would put
//! that track behind the others, so every other path waits to match and
//! they all reach the master together:
//!
//!   track sources -> effects (L) -> [delay: maxL - L] -> strip -> direct [D] -> master
//!                                                             \-> sends -> bus effects (B) -> [delay: D - B] -> master
//!
//! with maxL the most latent track chain and D the most latent bus chain.
//! A track feeding another lines up at that track's input instead: the
//! tracks feeding a track arrive with the latest of them, the track's own
//! sources wait as long (`own`), and its sends wait for the rest of the way
//! the mix still has to go (`send`). Tracks played live (the armed MIDI
//! track) skip all of it, and so does every track they play through, so
//! what's played isn't held back. The whole mix then comes out `total`
//! late, master chain and limiter included, which the clicks wait too.

/// The longest one path waits (s), as the browser's delays allow.
pub const MAX_COMPENSATION: f64 = 2.0;

/// A track's path as the planner sees it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Path {
    /// Its chain's latency (frames).
    pub latency: usize,
    pub live: bool,
    /// The track it feeds; None for the master.
    pub dest: Option<usize>,
}

/// The delays (frames), per track and bus.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Plan {
    /// Between each track's effects and its strip.
    pub channel: Vec<usize>,
    /// On each track's own sources (its clips and instrument), so they wait
    /// for the tracks feeding it.
    pub own: Vec<usize>,
    /// On each track's sends, so they reach the buses in time with its dry
    /// path through the tracks it feeds.
    pub send: Vec<usize>,
    /// Between each bus's effects and its strip.
    pub bus: Vec<usize>,
    /// On the tracks' direct path to the master.
    pub direct: usize,
    /// How late the mix leaves the master: compensated track latency, bus
    /// alignment, the master chain and limiter.
    pub total: usize,
    /// The live tracks and every track they play through: straight to the
    /// master.
    pub live: Vec<bool>,
}

/// The live tracks plus every track their audio passes through.
fn live_path(tracks: &[Path]) -> Vec<bool> {
    let mut live = vec![false; tracks.len()];
    for (i, t) in tracks.iter().enumerate() {
        if !t.live {
            continue;
        }
        let mut at = Some(i);
        while let Some(a) = at.filter(|&a| a < tracks.len() && !live[a]) {
            live[a] = true;
            at = tracks[a].dest;
        }
    }
    live
}

/// When the audio feeding track `id`'s effects is all in: its latest
/// non-live feeder. Routes form a tree (the song breaks loops); `seen`
/// guards against a bad one anyway.
fn time_in(
    id: usize,
    tracks: &[Path],
    live: &[bool],
    memo: &mut [Option<usize>],
    seen: &mut [bool],
) -> usize {
    if let Some(t) = memo[id] {
        return t;
    }
    if seen[id] {
        return 0;
    }
    seen[id] = true;
    let mut latest = 0;
    for k in 0..tracks.len() {
        if !live[k] && tracks[k].dest == Some(id) {
            latest = latest.max(time_in(k, tracks, live, memo, seen) + tracks[k].latency);
        }
    }
    memo[id] = Some(latest);
    latest
}

/// The plan for these tracks, buses (their chains' latencies) and master
/// (its chain's and the limiter's); with compensation off, no delays.
pub(crate) fn plan(enabled: bool, tracks: &[Path], buses: &[usize], master: usize) -> Plan {
    let n = tracks.len();
    let live = live_path(tracks);
    if !enabled {
        return Plan {
            channel: vec![0; n],
            own: vec![0; n],
            send: vec![0; n],
            bus: vec![0; buses.len()],
            direct: 0,
            total: master,
            live,
        };
    }
    let dest = |i: usize| tracks[i].dest.filter(|&d| d < n);
    let mut memo = vec![None; n];
    let mut seen = vec![false; n];
    let time_in: Vec<usize> = (0..n)
        .map(|i| time_in(i, tracks, &live, &mut memo, &mut seen))
        .collect();
    let time_out = |i: usize| time_in[i] + tracks[i].latency;
    let max_track = (0..n)
        .filter(|&i| !live[i] && dest(i).is_none())
        .map(time_out)
        .max()
        .unwrap_or(0);
    let direct = buses.iter().copied().max().unwrap_or(0);
    let mut plan = Plan {
        channel: vec![0; n],
        own: vec![0; n],
        send: vec![0; n],
        bus: buses.iter().map(|b| direct - b).collect(),
        direct,
        total: max_track + direct + master,
        live,
    };
    for i in (0..n).filter(|&i| !plan.live[i]) {
        let leaves = dest(i).map_or(max_track, |d| time_in[d]);
        plan.channel[i] = leaves.saturating_sub(time_out(i));
        plan.own[i] = time_in[i];
        plan.send[i] = max_track.saturating_sub(leaves);
    }
    plan
}

/// A fixed delay on one channel, in place.
#[derive(Clone, Debug, Default)]
pub(crate) struct Ring {
    buf: Vec<f32>,
    at: usize,
}

impl Ring {
    pub fn new(frames: usize) -> Self {
        Self {
            buf: vec![0.0; frames],
            at: 0,
        }
    }

    pub fn frames(&self) -> usize {
        self.buf.len()
    }

    /// Delays `x` in place: each sample out is the one that went in
    /// `frames` samples before.
    pub fn run(&mut self, x: &mut [f32]) {
        let n = self.buf.len();
        if n == 0 {
            return;
        }
        for v in x {
            std::mem::swap(v, &mut self.buf[self.at]);
            self.at += 1;
            if self.at == n {
                self.at = 0;
            }
        }
    }
}

/// The same fixed delay on both channels.
#[derive(Clone, Debug, Default)]
pub(crate) struct Delay {
    l: Ring,
    r: Ring,
}

impl Delay {
    pub fn new(frames: usize) -> Self {
        Self {
            l: Ring::new(frames),
            r: Ring::new(frames),
        }
    }

    pub fn frames(&self) -> usize {
        self.l.frames()
    }

    pub fn run(&mut self, l: &mut [f32], r: &mut [f32]) {
        self.l.run(l);
        self.r.run(r);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn path(latency: usize, live: bool, dest: Option<usize>) -> Path {
        Path {
            latency,
            live,
            dest,
        }
    }

    // As latency.test.ts, in frames: tracks a, b, c; buses verb, crush.
    const TRACKS: [Path; 3] = [
        path(0, false, None),
        path(240, false, None),
        path(96, false, None),
    ];
    const BUSES: [usize; 2] = [0, 144];

    #[test]
    fn lines_every_track_and_bus_path_up_at_the_master() {
        let p = plan(true, &TRACKS, &BUSES, 240);
        for (t, d) in TRACKS.iter().zip(&p.channel) {
            assert_eq!(t.latency + d, 240);
        }
        for (b, d) in BUSES.iter().zip(&p.bus) {
            assert_eq!(b + d, p.direct);
        }
        assert_eq!(p.direct, 144);
        assert_eq!(p.total, 240 + 144 + 240);
    }

    #[test]
    fn live_tracks_skip_compensation_and_dont_set_the_others_delay() {
        let mut tracks = TRACKS.to_vec();
        tracks.push(path(2400, true, None));
        let p = plan(true, &tracks, &BUSES, 240);
        assert_eq!(p.channel[3], 0);
        assert_eq!(p.channel[0], 240);
    }

    #[test]
    fn off_no_delays_the_mix_is_only_as_late_as_the_master_chain() {
        let p = plan(false, &TRACKS, &BUSES, 240);
        assert!(p.channel.iter().chain(&p.bus).all(|&d| d == 0));
        assert_eq!((p.direct, p.total), (0, 240));
    }

    #[test]
    fn lines_up_a_groups_members_at_its_input_and_the_group_with_the_rest() {
        // group, kick -> group, snare -> group, bass.
        let tracks = [
            path(96, false, None),
            path(192, false, Some(0)),
            path(0, false, Some(0)),
            path(48, false, None),
        ];
        let p = plan(true, &tracks, &[], 0);
        // The members arrive at the group together, 192 frames in.
        assert_eq!((192 + p.channel[1], p.channel[2]), (192, 192));
        // The group leaves its chain at 288, the latest at the master.
        assert_eq!(p.channel[0], 0);
        assert_eq!(48 + p.channel[3], 288);
        // The group's own sources wait for its members; their sends wait
        // for the group's chain.
        assert_eq!((p.own[0], p.send[1], p.send[3]), (192, 96, 0));
        assert_eq!(p.total, 288);
    }

    #[test]
    fn a_live_tracks_group_skips_compensation_too() {
        // group, guitar (live) -> group, keys -> group, drums.
        let tracks = [
            path(0, false, None),
            path(0, true, Some(0)),
            path(144, false, Some(0)),
            path(480, false, None),
        ];
        let p = plan(true, &tracks, &[], 0);
        assert_eq!(p.live, [true, true, false, false]);
        assert_eq!((p.channel[1], p.channel[0], p.own[0]), (0, 0, 0));
        assert_eq!((p.channel[3], p.total), (0, 480));
    }

    #[test]
    fn a_delay_line_plays_what_went_in_that_many_frames_before() {
        let mut d = Ring::new(3);
        let mut x = [1.0, 2.0, 3.0, 4.0, 5.0];
        d.run(&mut x[..2]);
        d.run(&mut x[2..]);
        assert_eq!(x, [0.0, 0.0, 0.0, 1.0, 2.0]);
        let mut none = Ring::new(0);
        let mut y = [1.0, 2.0];
        none.run(&mut y);
        assert_eq!(y, [1.0, 2.0]);
    }
}
