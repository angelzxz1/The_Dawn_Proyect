//! The engine: the transport playing the song, the mix (strips, routing,
//! sends, buses, master) and the master limiter, and the metronome.
//!
//! It renders whatever device or file asks for samples (`render`), so it
//! runs the same against an audio interface and offline. Everything the
//! audio thread touches is made beforehand (`Song::prepare`); a new song or
//! tempo map hands the old one back, to be freed off the audio thread.
//!
//! How it matches the browser's engine (`src/engine/audioEngine.ts`): a
//! strip is mute, then fader and pan (Web Audio's equal-power stereo
//! panner), post-fader sends; buses at their level into the master; the
//! master's fader and pan, then its limiter; the metronome after the
//! limiter, delayed by its lookahead so the clicks stay on the beat heard.
//! A MIDI track's instrument (`player`) plays its clips' notes and the keys
//! played live into the track, ahead of its strip; a track's, a bus's and
//! the master's effects (`fx`) run where the browser's chains are.

use std::f64::consts::FRAC_PI_2;

use super::fx;
use super::metronome::{Loop, Metronome};
use super::player::Player;
use super::song::{Applied, Destination, MAX_BLOCK, Prepared, Song, Stereo};
use super::tempo::segment_at_seconds;
use crate::effects::limiter::{Limiter, LimiterMeters};

/// Web Audio's StereoPannerNode on a stereo input (the strips are all
/// stereo): the gains moving one side into the other.
fn pan_gains(pan: f64) -> (f64, f64) {
    let x = if pan <= 0.0 { pan + 1.0 } else { pan };
    ((x * FRAC_PI_2).cos(), (x * FRAC_PI_2).sin())
}

/// Pans and levels `buf` into `out` (added), gliding from `from` to `to`
/// over the `n` frames; returns the peaks of what it added.
fn strip(
    buf: &Stereo,
    from: Applied,
    to: Applied,
    n: usize,
    out_l: &mut [f32],
    out_r: &mut [f32],
) -> [f32; 2] {
    let mut peak = [0.0f32; 2];
    let steady = from == to;
    let (gl0, gr0) = pan_gains(to.pan);
    for i in 0..n {
        let (gain, pan, gl, gr) = if steady {
            (to.gain, to.pan, gl0, gr0)
        } else {
            let t = (i + 1) as f64 / n as f64;
            let pan = from.pan + (to.pan - from.pan) * t;
            let (gl, gr) = pan_gains(pan);
            (from.gain + (to.gain - from.gain) * t, pan, gl, gr)
        };
        let l = buf.l[i] as f64;
        let r = buf.r[i] as f64;
        let (pl, pr) = if pan <= 0.0 {
            (l + r * gl, r * gr)
        } else {
            (l * gl, r + l * gr)
        };
        let (yl, yr) = ((pl * gain) as f32, (pr * gain) as f32);
        out_l[i] += yl;
        out_r[i] += yr;
        peak[0] = peak[0].max(yl.abs());
        peak[1] = peak[1].max(yr.abs());
    }
    peak
}

fn keep_peak(meter: &mut [f32; 2], peak: [f32; 2]) {
    meter[0] = meter[0].max(peak[0]);
    meter[1] = meter[1].max(peak[1]);
}

/// The transport: whether it's playing, where (frames on the timeline), and
/// the engine frame it starts moving at (after a count-in).
#[derive(Clone, Copy, Debug)]
struct Transport {
    playing: bool,
    position: i64,
    starts_at: u64,
    loop_: Option<(i64, i64)>,
}

pub struct Engine {
    sample_rate: f64,
    /// Frames rendered since the engine started: its clock.
    clock: u64,
    transport: Transport,
    prepared: Box<Prepared>,
    metronome: Metronome,
    /// The click's level (linear).
    click_level: f32,
    limiter: Limiter,
    limiter_meters: Option<LimiterMeters>,
    master: Stereo,
    /// A strip's output on its way to its destination and sends.
    scratch: Stereo,
    click: Vec<f32>,
    /// The clicks wait the limiter's lookahead (a ring of that many frames).
    click_delay: Vec<f32>,
    click_at: usize,
    /// A track needed an instrument that wasn't there (`take_missing`).
    missing: bool,
}

impl Engine {
    pub fn new(sample_rate: f64) -> Self {
        let prepared = Box::new(Song::default().prepare(None, sample_rate));
        let limiter = Limiter::new(sample_rate, prepared.song.master.limiter);
        let delay = limiter.latency_frames().max(1);
        Self {
            sample_rate,
            clock: 0,
            transport: Transport {
                playing: false,
                position: 0,
                starts_at: 0,
                loop_: None,
            },
            prepared,
            metronome: Metronome::new(sample_rate),
            click_level: 1.0,
            limiter,
            limiter_meters: None,
            master: Stereo::new(),
            scratch: Stereo::new(),
            click: vec![0.0; MAX_BLOCK],
            click_delay: vec![0.0; delay],
            click_at: 0,
            missing: false,
        }
    }

    pub fn sample_rate(&self) -> f64 {
        self.sample_rate
    }

    fn time(&self) -> f64 {
        self.clock as f64 / self.sample_rate
    }

    fn frames(&self, seconds: f64) -> i64 {
        (seconds * self.sample_rate).round() as i64
    }

    /// The song playing now.
    pub fn song(&self) -> &Prepared {
        &self.prepared
    }

    /// Plays `song` from the next block (prepared off the audio thread);
    /// the one it replaces comes back, to be freed off the audio thread.
    pub fn set_song(&mut self, mut song: Box<Prepared>) -> Box<Prepared> {
        // Each track's instrument: the one already playing it carries on
        // (its notes ringing), and the new one made for it goes back with
        // the old version, to be freed off the audio thread.
        let old = &mut self.prepared;
        let bpm = song.song.tempo.first().map_or(120.0, |t| t.bpm);
        for i in 0..song.song.tracks.len() {
            let Some(spec) = &song.song.tracks[i].instrument else {
                continue;
            };
            let id = &song.song.tracks[i].id;
            if let Some(j) = old.song.tracks.iter().position(|t| &t.id == id)
                && old.players[j]
                    .as_ref()
                    .is_some_and(|p| p.kind() == spec.kind())
            {
                std::mem::swap(&mut song.players[i], &mut old.players[j]);
            }
            match &mut song.players[i] {
                Some(player) => {
                    player.configure(spec);
                    player.set_tempo(bpm);
                }
                None => self.missing = true,
            }
        }
        // Each effect: the one already playing carries on, the same way.
        let new = &mut *song;
        for h in 0..new.song.host_count() {
            for e in 0..new.song.host_effects(h).len() {
                let spec = &new.song.host_effects(h)[e];
                if new.fx[h][e].is_none() {
                    'find: for oh in 0..old.song.host_count() {
                        for (oe, o) in old.song.host_effects(oh).iter().enumerate() {
                            if o.id == spec.id
                                && old.fx[oh][oe]
                                    .as_ref()
                                    .is_some_and(|x| x.kind() == spec.settings.kind())
                            {
                                std::mem::swap(&mut new.fx[h][e], &mut old.fx[oh][oe]);
                                break 'find;
                            }
                        }
                    }
                }
                match &mut new.fx[h][e] {
                    Some(effect) => effect.configure(&spec.settings),
                    None => self.missing = true,
                }
            }
        }
        self.limiter.set(song.song.master.limiter);
        self.metronome.set_beats_per_bar(song.song.beats_per_bar);
        let tempo_changed = song.song.tempo != self.prepared.song.tempo;
        if tempo_changed {
            // The metronome's copy of the map, made with the song; the one
            // it had goes back with the song, so it's freed with it.
            let tempo = std::mem::take(&mut song.click_tempo);
            song.click_tempo = self.metronome.set_tempo(tempo);
        }
        let old = std::mem::replace(&mut self.prepared, song);
        if tempo_changed {
            self.resync();
        }
        old
    }

    /// After a jump or a change of tempo or loop while playing, the
    /// metronome carries on from where the transport now is.
    fn resync(&mut self) {
        if self.transport.playing && self.clock >= self.transport.starts_at {
            let pos = self.position_seconds();
            self.metronome.resync(self.time(), pos);
        }
    }

    /// Plays from `from` (s) after `count_in_beats` beats of count-in at
    /// the tempo there.
    pub fn play(&mut self, from: f64, count_in_beats: f64) {
        let from = from.max(0.0);
        let bpm = segment_at_seconds(&self.prepared.song.tempo, from).bpm;
        let lead = self.frames(count_in_beats * 60.0 / bpm).max(0) as u64;
        self.release_clip_notes();
        self.transport.playing = true;
        self.transport.position = self.frames(from);
        self.transport.starts_at = self.clock + lead;
        let start = self.transport.starts_at as f64 / self.sample_rate;
        self.metronome.start(start, from, count_in_beats);
    }

    /// Stops where it is.
    pub fn stop(&mut self) {
        self.transport.playing = false;
        self.metronome.stop();
        let at = self.clock;
        self.players().for_each(|p| p.release_all(at));
    }

    pub fn playing(&self) -> bool {
        self.transport.playing
    }

    /// Moves the playhead, playing or not.
    pub fn seek(&mut self, seconds: f64) {
        self.transport.position = self.frames(seconds.max(0.0));
        self.release_clip_notes();
        self.resync();
    }

    /// Where the transport is (s).
    pub fn position_seconds(&self) -> f64 {
        self.transport.position as f64 / self.sample_rate
    }

    /// Sets (or clears) the loop (s): playing reaching its end jumps to its
    /// start.
    pub fn set_loop(&mut self, loop_: Option<(f64, f64)>) {
        let loop_ = loop_.map(|(start, end)| (start.max(0.0), end.max(start.max(0.0) + 0.05)));
        self.transport.loop_ = loop_.map(|(s, e)| (self.frames(s), self.frames(e)));
        self.metronome
            .set_loop(loop_.map(|(start, end)| Loop { start, end }));
        self.resync();
    }

    pub fn set_metronome(&mut self, enabled: bool) {
        self.metronome.set_enabled(enabled);
    }

    /// The click's level, in dB from its standard level.
    pub fn set_metronome_level(&mut self, db: f64) {
        self.click_level = 10f64.powf(db / 20.0) as f32;
    }

    fn players(&mut self) -> impl Iterator<Item = &mut Player> {
        self.prepared.players.iter_mut().flatten().map(|p| &mut **p)
    }

    /// The clips' notes sounding stop (a jump: the transport goes on from
    /// elsewhere).
    fn release_clip_notes(&mut self) {
        let at = self.clock;
        self.players().for_each(|p| p.release_clip_notes(at));
    }

    /// The instrument of the track `track_key` names (`player::track_key`).
    fn player(&mut self, track: u64) -> Option<&mut Player> {
        let p = &mut *self.prepared;
        let i = p.track_keys.iter().position(|k| *k == track)?;
        p.players[i].as_deref_mut()
    }

    /// A key pressed live on a track (from the next block).
    pub fn key_down(&mut self, track: u64, key: i32, velocity: f64) {
        let at = self.clock;
        if let Some(p) = self.player(track) {
            p.key_down(key, velocity, at);
        }
    }

    /// A key let go live.
    pub fn key_up(&mut self, track: u64, key: i32) {
        let at = self.clock;
        if let Some(p) = self.player(track) {
            p.key_up(key, at);
        }
    }

    /// A track's sustain pedal (CC64).
    pub fn sustain(&mut self, track: u64, down: bool) {
        let at = self.clock;
        if let Some(p) = self.player(track) {
            p.set_sustain(down, at);
        }
    }

    /// A track's pitch bend, -1..1 of its instrument's bend range.
    pub fn pitch_bend(&mut self, track: u64, bend: f64) {
        if let Some(p) = self.player(track) {
            p.set_bend(bend);
        }
    }

    /// A track's mod wheel, 0..1.
    pub fn mod_wheel(&mut self, track: u64, amount: f64) {
        if let Some(p) = self.player(track) {
            p.set_mod_wheel(amount);
        }
    }

    /// Whether a track needed an instrument the song didn't bring (it was
    /// made assuming one already playing that wasn't): the song should be
    /// prepared again from scratch (`prepare(None, ..)`). Once.
    pub fn take_missing(&mut self) -> bool {
        std::mem::take(&mut self.missing)
    }

    /// The master limiter's meters from its last full interval, once.
    pub fn take_limiter_meters(&mut self) -> Option<LimiterMeters> {
        self.limiter_meters.take()
    }

    /// Reads and resets the peak meters: each track's, each bus's, and the
    /// master's (after the limiter).
    pub fn take_peaks(
        &mut self,
        mut track: impl FnMut(usize, [f32; 2]),
        mut bus: impl FnMut(usize, [f32; 2]),
    ) -> [f32; 2] {
        let p = &mut self.prepared;
        p.track_peaks
            .iter_mut()
            .enumerate()
            .for_each(|(i, v)| track(i, std::mem::take(v)));
        p.bus_peaks
            .iter_mut()
            .enumerate()
            .for_each(|(i, v)| bus(i, std::mem::take(v)));
        std::mem::take(&mut p.master_peak)
    }

    /// Renders the next `out_l.len()` frames (both outputs the same length).
    pub fn render(&mut self, out_l: &mut [f32], out_r: &mut [f32]) {
        let total = out_l.len().min(out_r.len());
        let mut done = 0;
        while done < total {
            let n = (total - done).min(MAX_BLOCK);
            self.render_block(&mut out_l[done..done + n], &mut out_r[done..done + n]);
            done += n;
        }
    }

    fn render_block(&mut self, out_l: &mut [f32], out_r: &mut [f32]) {
        let n = out_l.len();
        let p = &mut *self.prepared;
        p.track_bufs.iter_mut().for_each(|b| b.clear(n));
        p.bus_bufs.iter_mut().for_each(|b| b.clear(n));
        self.master.clear(n);

        // The clips, over the stretches of the timeline this block plays
        // (the loop splits it where it jumps back).
        let t = &mut self.transport;
        if t.playing {
            let mut j = 0;
            while j < n {
                let now = self.clock + j as u64;
                if now < t.starts_at {
                    // The count-in: the transport hasn't started.
                    j += ((t.starts_at - now) as usize).min(n - j);
                    continue;
                }
                if let Some((ls, le)) = t.loop_
                    && t.position >= le
                {
                    t.position = ls;
                    p.players
                        .iter_mut()
                        .flatten()
                        .for_each(|pl| pl.release_clip_notes(now));
                }
                let mut len = n - j;
                if let Some((_, le)) = t.loop_ {
                    len = len.min((le - t.position).max(1) as usize);
                }
                for (i, (track, buf)) in p
                    .song
                    .tracks
                    .iter()
                    .zip(p.track_bufs.iter_mut())
                    .enumerate()
                {
                    for clip in &track.clips {
                        if clip.start >= t.position + len as i64 {
                            break;
                        }
                        if clip.end() > t.position {
                            clip.render(t.position, len, [&mut buf.l, &mut buf.r], j);
                        }
                    }
                    if let Some(player) = p.players[i].as_deref_mut() {
                        player.schedule(&track.notes, t.position, len, now);
                    }
                }
                t.position += len as i64;
                j += len;
                // Reaching the loop's end is being at its start.
                if let Some((ls, le)) = t.loop_
                    && t.position >= le
                {
                    t.position = ls;
                    let at = self.clock + j as u64;
                    p.players
                        .iter_mut()
                        .flatten()
                        .for_each(|pl| pl.release_clip_notes(at));
                }
            }
        }

        // The instruments, into their tracks (playing or not: keys played
        // live, and tails).
        for (player, buf) in p.players.iter_mut().zip(p.track_bufs.iter_mut()) {
            if let Some(player) = player {
                let (l, r) = player.render(n, self.clock);
                add(&mut buf.l[..n], l, 1.0);
                add(&mut buf.r[..n], r, 1.0);
            }
        }

        // The strips (after their effects), each before the track it
        // feeds; then the buses.
        for &i in &p.order {
            let track = &p.song.tracks[i];
            let buf = &mut p.track_bufs[i];
            fx::run(
                &mut p.fx[i],
                &track.effects,
                &mut buf.l[..n],
                &mut buf.r[..n],
            );
            let target = Applied {
                gain: track.volume * if track.audible { 1.0 } else { 0.0 },
                pan: track.pan,
            };
            let from = std::mem::replace(&mut p.track_applied[i], target);
            // The strip's output goes to its destination and its sends.
            let out = &mut self.scratch;
            out.clear(n);
            let peak = strip(
                &p.track_bufs[i],
                from,
                target,
                n,
                &mut out.l[..n],
                &mut out.r[..n],
            );
            keep_peak(&mut p.track_peaks[i], peak);
            let dest = match track.destination {
                Destination::Master => &mut self.master,
                Destination::Track(d) => &mut p.track_bufs[d],
            };
            add(&mut dest.l[..n], &out.l[..n], 1.0);
            add(&mut dest.r[..n], &out.r[..n], 1.0);
            for send in &track.sends {
                let bus = &mut p.bus_bufs[send.bus];
                add(&mut bus.l[..n], &out.l[..n], send.gain);
                add(&mut bus.r[..n], &out.r[..n], send.gain);
            }
        }
        let tracks = p.song.tracks.len();
        for (i, bus) in p.song.buses.iter().enumerate() {
            let buf = &mut p.bus_bufs[i];
            fx::run(
                &mut p.fx[tracks + i],
                &bus.effects,
                &mut buf.l[..n],
                &mut buf.r[..n],
            );
            let target = Applied {
                gain: bus.volume,
                pan: bus.pan,
            };
            let from = std::mem::replace(&mut p.bus_applied[i], target);
            let peak = strip(
                &p.bus_bufs[i],
                from,
                target,
                n,
                &mut self.master.l[..n],
                &mut self.master.r[..n],
            );
            keep_peak(&mut p.bus_peaks[i], peak);
        }

        // The master: fader and pan, its effects, then the limiter, into
        // the output.
        let m = p.song.master;
        let target = Applied {
            gain: m.volume,
            pan: m.pan,
        };
        let from = std::mem::replace(&mut p.master_applied, target);
        out_l.fill(0.0);
        out_r.fill(0.0);
        strip(&self.master, from, target, n, out_l, out_r);
        let last = p.fx.len() - 1;
        fx::run(&mut p.fx[last], &p.song.master_effects, out_l, out_r);
        self.master.l[..n].copy_from_slice(out_l);
        self.master.r[..n].copy_from_slice(out_r);
        self.limiter.process(
            Some(&self.master.l[..n]),
            Some(&self.master.r[..n]),
            out_l,
            Some(&mut *out_r),
            n,
        );
        if let Some(m) = self.limiter.take_meters() {
            self.limiter_meters = Some(m);
        }
        let mut master_peak = [0.0f32; 2];
        for i in 0..n {
            master_peak[0] = master_peak[0].max(out_l[i].abs());
            master_peak[1] = master_peak[1].max(out_r[i].abs());
        }
        keep_peak(&mut p.master_peak, master_peak);

        // The clicks, after the limiter, waiting its lookahead.
        let time = self.time();
        self.metronome.render(&mut self.click[..n], time);
        let delay = self.click_delay.len();
        for i in 0..n {
            let delayed = self.click_delay[self.click_at];
            self.click_delay[self.click_at] = self.click[i] * self.click_level;
            self.click_at = (self.click_at + 1) % delay;
            out_l[i] += delayed;
            out_r[i] += delayed;
        }

        self.clock += n as u64;
    }
}

fn add(into: &mut [f32], from: &[f32], gain: f64) {
    if gain == 1.0 {
        into.iter_mut().zip(from).for_each(|(a, b)| *a += *b);
    } else {
        into.iter_mut()
            .zip(from)
            .for_each(|(a, b)| *a = (*a as f64 + *b as f64 * gain) as f32);
    }
}
