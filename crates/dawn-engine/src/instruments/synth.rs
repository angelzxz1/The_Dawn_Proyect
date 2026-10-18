//! The synth ("Daybreak"), ported from `src/instruments/synth/
//! synthKernel.ts` step for step (tests/synth_parity.rs checks it against
//! the JavaScript).
//!
//! Per voice: two wavetable oscillators (a warp each, up to 16 unison
//! voices spread in pitch and stereo), a sub and a noise source feed two
//! filters (serial or parallel, or straight to the output), then the amp
//! envelope. Everything that moves - envelopes, LFOs, the modulation
//! matrix, glide - is worked out every 32 samples ("control rate") and
//! ramped in between, so modulation stays smooth while costing little.
//! Notes start on their exact sample.
//!
//! As in the JavaScript, the buses, each oscillator's own buffer, the
//! modulated knob positions and the unison gains are float32, so the
//! rounding happens where it happens there. Unlike it, the comb filters'
//! delay lines are made with the voices rather than when first used (no
//! allocating on the audio thread), each synth has its own random numbers
//! (a browser's worklets share theirs), and there's no scope (nothing here
//! draws it).

use std::f64::consts::{PI, SQRT_2};
use std::sync::Arc;

use super::{js_round, sat};
use crate::mix::AudioData;

/// Samples between control-rate updates.
pub const STEP: usize = 32;
pub const MAX_UNISON: usize = 16;
pub const MAX_POLYPHONY: usize = 16;
/// Voices beyond the polyphony, so a stolen voice can fade out (a few ms)
/// while its replacement starts.
const SPARE_VOICES: usize = 4;
const MAXV: usize = MAX_POLYPHONY + SPARE_VOICES;
/// Modulation routes (`synthParams.ts` MAX_MODS).
pub const MAX_ROUTES: usize = 32;
/// Modulation sources (`MOD_SOURCES`): three envelopes, three LFOs,
/// velocity, note, mod wheel, pitch bend, random, four macros.
pub const SOURCES: usize = 15;
/// The most frames one `process` call renders (a worklet's render
/// quantum); `render` splits longer blocks.
pub const QUANTUM: usize = 128;
/// Room for this many waiting events; more are dropped.
const EVENT_CAPACITY: usize = 1024;
const COMB_SIZE: usize = 4096;
/// Notes held at once in mono (the note stack).
const STACK: usize = 128;

/// Harmonics kept at each mip level (`wavetableModel.ts`; level 0 is the
/// richest) and its samples per cycle.
pub const MIP_HARMONICS: [f64; 9] = [512.0, 256.0, 128.0, 64.0, 32.0, 16.0, 8.0, 4.0, 2.0];
pub const MIP_SIZES: [usize; 9] = [2048, 1024, 512, 256, 128, 128, 128, 128, 128];
/// Where each level starts in a frame's samples, and how many it has in
/// all.
const LEVEL_START: [usize; 9] = [0, 2048, 3072, 3584, 3840, 3968, 4096, 4224, 4352];
pub const FRAME_SAMPLES: usize = 4480;

/// log2(LFO_RATE_MAX / LFO_RATE_MIN): the octaves an LFO's rate knob spans.
const LFO_OCTAVES: f64 = 11.965784284662087;

/// Every knob a modulation can drive (`synthParams.ts` DEST_SPECS, in
/// order): its range, and whether it's logarithmic.
pub const DESTS: [(f64, f64, bool); 37] = [
    // Osc 1: level, pan, position, warp, pitch, fine, detune, blend, width.
    (0.0, 1.0, false),
    (-1.0, 1.0, false),
    (0.0, 1.0, false),
    (0.0, 1.0, false),
    (-48.0, 48.0, false),
    (-100.0, 100.0, false),
    (0.0, 1.0, false),
    (0.0, 1.0, false),
    (0.0, 1.0, false),
    // Osc 2.
    (0.0, 1.0, false),
    (-1.0, 1.0, false),
    (0.0, 1.0, false),
    (0.0, 1.0, false),
    (-48.0, 48.0, false),
    (-100.0, 100.0, false),
    (0.0, 1.0, false),
    (0.0, 1.0, false),
    (0.0, 1.0, false),
    // Sub level and pan, noise level and pan.
    (0.0, 1.0, false),
    (-1.0, 1.0, false),
    (0.0, 1.0, false),
    (-1.0, 1.0, false),
    // Filter 1: cutoff, resonance, drive, morph, mix.
    (20.0, 20000.0, true),
    (0.0, 1.0, false),
    (0.0, 1.0, false),
    (0.0, 1.0, false),
    (0.0, 1.0, false),
    // Filter 2.
    (20.0, 20000.0, true),
    (0.0, 1.0, false),
    (0.0, 1.0, false),
    (0.0, 1.0, false),
    (0.0, 1.0, false),
    // The LFOs' rates.
    (0.01, 40.0, true),
    (0.01, 40.0, true),
    (0.01, 40.0, true),
    // The voice's pitch and volume.
    (-48.0, 48.0, false),
    (-48.0, 6.0, false),
];
pub const DEST_COUNT: usize = DESTS.len();

const OSC_D: [[usize; 9]; 2] = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
    [9, 10, 11, 12, 13, 14, 15, 16, 17],
];
const SUB_LEVEL: usize = 18;
const SUB_PAN: usize = 19;
const NOISE_LEVEL: usize = 20;
const NOISE_PAN: usize = 21;
const FIL_D: [[usize; 5]; 2] = [[22, 23, 24, 25, 26], [27, 28, 29, 30, 31]];
const LFO_D: [usize; 3] = [32, 33, 34];
const V_TRANSPOSE: usize = 35;
const V_VOLUME: usize = 36;

// Warp modes (synthParams.ts WARP_MODES order).
pub const W_NONE: usize = 0;
pub const W_SYNC: usize = 1;
pub const W_BEND: usize = 2;
pub const W_SQUEEZE: usize = 3;
pub const W_PULSE: usize = 4;
pub const W_MIRROR: usize = 5;
pub const W_FOLD: usize = 6;
pub const W_QUANT: usize = 7;
pub const W_FM: usize = 8;
pub const W_RM: usize = 9;
// Filter types (FILTER_TYPES order).
pub const F_LP12: usize = 0;
pub const F_LP24: usize = 1;
pub const F_LADDER: usize = 2;
pub const F_HP12: usize = 3;
pub const F_HP24: usize = 4;
pub const F_BP: usize = 5;
pub const F_NOTCH: usize = 6;
pub const F_MORPH: usize = 7;
pub const F_COMB: usize = 8;
pub const F_COMBN: usize = 9;
pub const F_FORMANT: usize = 10;
const VOWELS: [[f64; 3]; 5] = [
    [730.0, 1090.0, 2440.0],
    [530.0, 1840.0, 2480.0],
    [270.0, 2290.0, 3010.0],
    [570.0, 840.0, 2410.0],
    [300.0, 870.0, 2240.0],
];

// --- settings (`compileSynth`) ---

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct OscSettings {
    pub on: bool,
    pub warp: usize,
    pub unison: usize,
    /// Filter 1, filter 2, both, or straight out (`OSC_DESTS` order).
    pub dest: usize,
    pub phase: f64,
    pub random_phase: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SubSettings {
    pub on: bool,
    /// Sine, triangle, saw, square.
    pub shape: usize,
    /// Octaves below the note: 0, -1 or -2.
    pub octave: f64,
    pub dest: usize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct NoiseSettings {
    pub on: bool,
    pub pink: bool,
    pub dest: usize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FilterSettings {
    pub on: bool,
    pub kind: usize,
    pub keytrack: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct EnvSettings {
    pub delay: f64,
    pub attack: f64,
    pub hold: f64,
    pub decay: f64,
    pub sustain: f64,
    pub release: f64,
    pub attack_curve: f64,
    pub decay_curve: f64,
    pub release_curve: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LfoSettings {
    /// Sine, triangle, saw down, saw up, square, random steps, random
    /// smooth.
    pub shape: usize,
    /// Hz, when not synced.
    pub rate: f64,
    pub sync: bool,
    /// Its length when synced.
    pub beats: f64,
    /// Retrigger, free, one shot.
    pub mode: usize,
    pub phase: f64,
    pub fade: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct VoiceSettings {
    /// Poly, mono, legato.
    pub mode: usize,
    pub polyphony: usize,
    pub glide: f64,
    pub bend_range: f64,
    pub velocity: f64,
}

/// A modulation route: `amount` of a source (0..1, or -1..1 when bipolar)
/// added to a knob's position.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Route {
    pub source: usize,
    pub dest: usize,
    pub amount: f64,
    pub bipolar: bool,
}

impl Route {
    pub const NONE: Route = Route {
        source: 0,
        dest: 0,
        amount: 0.0,
        bipolar: false,
    };
}

/// The synth's settings, as `compileSynth` makes them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SynthSettings {
    /// Every knob's position (0..1), in `DESTS` order.
    pub base: [f64; DEST_COUNT],
    pub routes: [Route; MAX_ROUTES],
    pub route_count: usize,
    pub osc: [OscSettings; 2],
    pub sub: SubSettings,
    pub noise: NoiseSettings,
    pub filters: [FilterSettings; 2],
    pub serial: bool,
    pub envs: [EnvSettings; 3],
    pub lfos: [LfoSettings; 3],
    pub macros: [f64; 4],
    pub voice: VoiceSettings,
}

impl Default for SynthSettings {
    fn default() -> Self {
        Self {
            base: [0.0; DEST_COUNT],
            routes: [Route::NONE; MAX_ROUTES],
            route_count: 0,
            osc: Default::default(),
            sub: Default::default(),
            noise: Default::default(),
            filters: Default::default(),
            serial: false,
            envs: Default::default(),
            lfos: Default::default(),
            macros: [0.0; 4],
            voice: Default::default(),
        }
    }
}

impl SynthSettings {
    /// These settings with `routes` (as many as fit).
    pub const fn with_routes(mut self, routes: &[Route]) -> Self {
        let mut i = 0;
        while i < routes.len() && i < MAX_ROUTES {
            self.routes[i] = routes[i];
            i += 1;
        }
        self.route_count = i;
        self
    }

    pub fn routes(&self) -> &[Route] {
        &self.routes[..self.route_count.min(MAX_ROUTES)]
    }

    /// Indices kept in range, so nothing in them can index past an array
    /// (the studio never sends them out of range).
    fn sanitized(mut self) -> Self {
        for o in &mut self.osc {
            if o.warp > W_RM {
                o.warp = W_NONE;
            }
            o.unison = o.unison.min(MAX_UNISON);
            o.dest = o.dest.min(3);
        }
        self.sub.dest = self.sub.dest.min(3);
        self.noise.dest = self.noise.dest.min(3);
        for f in &mut self.filters {
            if f.kind > F_FORMANT {
                f.kind = F_MORPH;
            }
        }
        let mut kept = 0;
        for i in 0..self.route_count.min(MAX_ROUTES) {
            let r = self.routes[i];
            if r.source < SOURCES && r.dest < DEST_COUNT {
                self.routes[kept] = r;
                kept += 1;
            }
        }
        self.route_count = kept;
        self
    }
}

/// A wavetable as the studio builds it (`wavetableModel.ts`): `frames`
/// single cycles at each mip level, as one channel of audio holding the
/// levels one after another (level 0's frames, then level 1's...).
#[derive(Clone, Debug)]
pub struct Wavetable {
    frames: usize,
    data: Arc<AudioData>,
}

impl Wavetable {
    /// None unless it holds whole frames.
    pub fn new(data: Arc<AudioData>) -> Option<Self> {
        let len = data.channels.first()?.len();
        let frames = len / FRAME_SAMPLES;
        (frames > 0 && frames * FRAME_SAMPLES == len).then_some(Self { frames, data })
    }

    pub fn frames(&self) -> usize {
        self.frames
    }

    pub fn data(&self) -> &Arc<AudioData> {
        &self.data
    }

    fn level(&self, l: usize) -> &[f32] {
        let start = self.frames * LEVEL_START[l];
        &self.data.channels[0][start..start + self.frames * MIP_SIZES[l]]
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SynthEventKind {
    On {
        note: i32,
        vel: f64,
    },
    Off {
        note: i32,
    },
    /// Every held note releases.
    AllOff,
    /// Every voice fades out quickly.
    Panic,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SynthEvent {
    /// Seconds, on the clock `process` is given.
    pub time: f64,
    pub kind: SynthEventKind,
}

/// The newest voice's modulated knob positions and envelopes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VoiceState {
    pub modulated: [f32; DEST_COUNT],
    /// Per envelope: stage and level.
    pub env: [(u8, f64); 3],
}

/// What the synth's window shows (`takeState`, without the scope).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SynthState {
    pub voices: usize,
    pub newest: Option<VoiceState>,
    /// Per LFO: phase and value (the newest voice's, or the free-running
    /// phases with no voice).
    pub lfo: [(f64, f64); 3],
    pub peak_l: f64,
    pub peak_r: f64,
}

// --- helpers ---

/// The knob `d`'s value at position `n`.
fn from_norm(d: usize, n: f64) -> f64 {
    let f = n.clamp(0.0, 1.0);
    let (lo, hi, log) = DESTS[d];
    if log {
        lo * (hi / lo).powf(f)
    } else {
        lo + f * (hi - lo)
    }
}

/// -1..1: 0 is linear, positive bows the segment out (fast start).
fn curve(x: f64, c: f64) -> f64 {
    if c > 0.001 {
        1.0 - (1.0 - x).powf(1.0 + 4.0 * c)
    } else if c < -0.001 {
        x.powf(1.0 - 4.0 * c)
    } else {
        x
    }
}

fn mip_level(freq: f64, sr: f64) -> usize {
    let ceiling = (1.0 - 20000.0 / sr).max(0.5) * sr;
    let max_h = ceiling / freq.max(1e-6);
    MIP_HARMONICS
        .iter()
        .position(|h| *h <= max_h)
        .unwrap_or(MIP_HARMONICS.len() - 1)
}

fn mtof(m: f64) -> f64 {
    440.0 * 2f64.powf((m - 69.0) / 12.0)
}

/// JavaScript's `x | 0`.
fn to_i32(x: f64) -> i32 {
    if x.abs() < 2147483648.0 {
        x as i32
    } else if x.is_finite() {
        x.trunc().rem_euclid(4294967296.0) as u32 as i32
    } else {
        0
    }
}

/// The kernel's random numbers (a 32-bit LCG, as the JavaScript's).
struct Rng(u32);

impl Rng {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223);
        self.0 as f64 / 4294967296.0
    }
}

// --- voices ---

#[derive(Clone, Copy, Default)]
struct Env {
    /// Off, delay, attack, hold, decay, sustain, release.
    stage: u8,
    t: f64,
    level: f64,
    from: f64,
}

#[derive(Clone, Copy, Default)]
struct Lfo {
    phase: f64,
    prev: f64,
    next: f64,
    fade_t: f64,
    done: bool,
    value: f64,
}

struct Osc {
    n: usize,
    ph: [f64; MAX_UNISON],
    inc: [f64; MAX_UNISON],
    lvl: [usize; MAX_UNISON],
    ul: [f32; MAX_UNISON],
    ur: [f32; MAX_UNISON],
    um: [f32; MAX_UNISON],
    pos: f64,
    pos_d: f64,
    amt: f64,
    amt_d: f64,
    lv: f64,
    lv_d: f64,
    buf: [f32; QUANTUM],
}

impl Osc {
    fn new() -> Self {
        Self {
            n: 0,
            ph: [0.0; MAX_UNISON],
            inc: [0.0; MAX_UNISON],
            lvl: [0; MAX_UNISON],
            ul: [0.0; MAX_UNISON],
            ur: [0.0; MAX_UNISON],
            um: [0.0; MAX_UNISON],
            pos: 0.0,
            pos_d: 0.0,
            amt: 0.0,
            amt_d: 0.0,
            lv: 0.0,
            lv_d: 0.0,
            buf: [0.0; QUANTUM],
        }
    }
}

struct Filter {
    /// The type its state is for (none before its first control step).
    kind: Option<usize>,
    // SVF coefficients (ramped) and states: [stage 1 L ic1, ic2, stage 2
    // L jc1, jc2, then R]; the ladder's four stages a channel; the
    // formant's three band passes a channel.
    a1: f64,
    a2: f64,
    a3: f64,
    k: f64,
    a1_d: f64,
    a2_d: f64,
    a3_d: f64,
    k_d: f64,
    b1: f64,
    b2: f64,
    b3: f64,
    kb: f64,
    s: [f64; 16],
    g: f64,
    g_d: f64,
    lk: f64,
    dg: f64,
    drive: f64,
    morph: f64,
    mix: f64,
    comb_l: Box<[f32]>,
    comb_r: Box<[f32]>,
    /// The delay lines hold something (cleared on a reset).
    comb_used: bool,
    comb_w: usize,
    comb_d: f64,
    comb_fb: f64,
    comb_damp: f64,
    comb_lp_l: f64,
    comb_lp_r: f64,
    fa: [f64; 12],
}

impl Filter {
    fn new() -> Self {
        Self {
            kind: None,
            a1: 0.0,
            a2: 0.0,
            a3: 0.0,
            k: 1.0,
            a1_d: 0.0,
            a2_d: 0.0,
            a3_d: 0.0,
            k_d: 0.0,
            b1: 0.0,
            b2: 0.0,
            b3: 0.0,
            kb: 1.41,
            s: [0.0; 16],
            g: 0.0,
            g_d: 0.0,
            lk: 0.0,
            dg: 1.0,
            drive: 0.0,
            morph: 0.0,
            mix: 1.0,
            comb_l: vec![0.0; COMB_SIZE].into(),
            comb_r: vec![0.0; COMB_SIZE].into(),
            comb_used: false,
            comb_w: 0,
            comb_d: 100.0,
            comb_fb: 0.0,
            comb_damp: 0.0,
            comb_lp_l: 0.0,
            comb_lp_r: 0.0,
            fa: [0.0; 12],
        }
    }

    fn reset(&mut self) {
        self.s = [0.0; 16];
        self.comb_lp_l = 0.0;
        self.comb_lp_r = 0.0;
        if self.comb_used {
            self.comb_l.fill(0.0);
            self.comb_r.fill(0.0);
            self.comb_used = false;
        }
        self.fa = [0.0; 12];
    }
}

struct Voice {
    active: bool,
    gate: bool,
    stealing: bool,
    fade: f64,
    note: i32,
    vel: f64,
    age: u64,
    rnd: f64,
    pitch: f64,
    target: f64,
    glide_rate: f64,
    env: [Env; 3],
    lfo: [Lfo; 3],
    modv: [f32; DEST_COUNT],
    src_u: [f32; SOURCES],
    src_b: [f32; SOURCES],
    osc: [Osc; 2],
    sub_ph: f64,
    sub_inc: f64,
    sub_lvl: usize,
    sub_l: f64,
    sub_r: f64,
    sub_lv: f64,
    sub_lv_d: f64,
    pink: [f64; 7],
    noise_l: f64,
    noise_r: f64,
    noise_lv: f64,
    noise_lv_d: f64,
    filt: [Filter; 2],
    amp: f64,
    amp_d: f64,
}

impl Voice {
    fn new() -> Self {
        Self {
            active: false,
            gate: false,
            stealing: false,
            fade: 1.0,
            note: 60,
            vel: 0.0,
            age: 0,
            rnd: 0.0,
            pitch: 60.0,
            target: 60.0,
            glide_rate: 0.0,
            env: Default::default(),
            lfo: Default::default(),
            modv: [0.0; DEST_COUNT],
            src_u: [0.0; SOURCES],
            src_b: [0.0; SOURCES],
            osc: [Osc::new(), Osc::new()],
            sub_ph: 0.0,
            sub_inc: 0.0,
            sub_lvl: 0,
            sub_l: 0.0,
            sub_r: 0.0,
            sub_lv: 0.0,
            sub_lv_d: 0.0,
            pink: [0.0; 7],
            noise_l: 0.0,
            noise_r: 0.0,
            noise_lv: 0.0,
            noise_lv_d: 0.0,
            filt: [Filter::new(), Filter::new()],
            amp: 0.0,
            amp_d: 0.0,
        }
    }
}

/// Release a voice: through its envelopes, or (stolen) a quick fade.
fn release(v: &mut Voice, fast: bool) {
    if fast {
        v.stealing = true;
        v.gate = false;
        return;
    }
    v.gate = false;
    for e in &mut v.env {
        if e.stage == 0 {
            continue;
        }
        e.from = e.level;
        e.stage = 6;
        e.t = 0.0;
    }
}

/// Which buses anything reaches, so the rest are skipped.
#[derive(Clone, Copy, Default)]
struct Use {
    f1: bool,
    f2: bool,
    d: bool,
}

/// Filter 1's, filter 2's and the direct bus's left and right.
type Bus = [[f32; QUANTUM]; 6];
type Lane<'a> = &'a mut [f32; QUANTUM];

/// Where a source sends its sound (`dest`): filter 2, the direct bus or
/// filter 1, and filter 2 as well when it goes to both in parallel.
fn targets(
    bus: &mut Bus,
    dest: usize,
    both: bool,
) -> (Lane<'_>, Lane<'_>, Option<(Lane<'_>, Lane<'_>)>) {
    let [f1l, f1r, f2l, f2r, dl, dr] = bus;
    match dest {
        1 => (f2l, f2r, None),
        3 => (dl, dr, None),
        _ => (f1l, f1r, both.then_some((f2l, f2r))),
    }
}

/// What the control rate reads besides the voice.
struct Ctl<'a> {
    s: &'a SynthSettings,
    sr: f64,
    bpm: f64,
    bend: f64,
    modwheel: f64,
}

// --- control rate ---

fn env_step(e: &mut Env, p: &EnvSettings, dt: f64) {
    match e.stage {
        1 => {
            e.t += dt;
            if e.t >= p.delay {
                e.stage = 2;
                e.t = 0.0;
            }
        }
        2 => {
            e.t += dt;
            let x = if p.attack > 0.0 { e.t / p.attack } else { 1.0 };
            if x >= 1.0 {
                e.level = 1.0;
                e.stage = 3;
                e.t = 0.0;
            } else {
                e.level = e.from + (1.0 - e.from) * curve(x, p.attack_curve);
            }
        }
        3 => {
            e.level = 1.0;
            e.t += dt;
            if e.t >= p.hold {
                e.stage = 4;
                e.t = 0.0;
            }
        }
        4 => {
            e.t += dt;
            let x = e.t / p.decay.max(1e-4);
            if x >= 1.0 {
                e.level = p.sustain;
                e.stage = 5;
            } else {
                e.level = p.sustain + (1.0 - p.sustain) * (1.0 - curve(x, p.decay_curve));
            }
        }
        5 => e.level = p.sustain,
        6 => {
            e.t += dt;
            let x = e.t / p.release.max(1e-4);
            if x >= 1.0 {
                e.level = 0.0;
                e.stage = 0;
            } else {
                e.level = e.from * (1.0 - curve(x, p.release_curve));
            }
        }
        _ => e.level = 0.0,
    }
}

fn lfo_rate(c: &Ctl, i: usize, v: Option<&Voice>) -> f64 {
    let l = &c.s.lfos[i];
    let mut rate = if l.sync {
        c.bpm / 60.0 / l.beats
    } else {
        l.rate
    };
    if let Some(v) = v {
        rate *= 2f64.powf((v.modv[LFO_D[i]] as f64 - c.s.base[LFO_D[i]]) * LFO_OCTAVES);
    }
    rate
}

fn lfo_step(c: &Ctl, rng: &mut Rng, v: &mut Voice, i: usize, dt: f64) {
    let l = &c.s.lfos[i];
    if !v.lfo[i].done {
        let rate = lfo_rate(c, i, Some(&*v));
        let st = &mut v.lfo[i];
        st.phase += rate * dt;
        if st.phase >= 1.0 {
            if l.mode == 2 {
                st.phase = 1.0;
                st.done = true;
            } else {
                st.phase -= st.phase.floor();
                st.prev = st.next;
                st.next = rng.next();
            }
        }
    }
    let st = &mut v.lfo[i];
    let raw = if st.done { 0.99999 } else { st.phase };
    let mut p = raw + l.phase;
    p -= p.floor();
    let u = match l.shape {
        0 => 0.5 + 0.5 * (2.0 * PI * p).sin(),
        1 => {
            let q = (p + 0.25) % 1.0;
            if q < 0.5 { 2.0 * q } else { 2.0 - 2.0 * q }
        }
        2 => 1.0 - p,
        3 => p,
        4 => {
            if p < 0.5 {
                1.0
            } else {
                0.0
            }
        }
        5 => st.next,
        _ => {
            let m = 0.5 - 0.5 * (PI * raw).cos();
            st.prev + (st.next - st.prev) * m
        }
    };
    st.fade_t += dt;
    let f = if l.fade > 0.0 {
        (st.fade_t / l.fade).min(1.0)
    } else {
        1.0
    };
    st.value = u;
    v.src_u[3 + i] = (u * f) as f32;
    v.src_b[3 + i] = ((2.0 * u - 1.0) * f) as f32;
}

/// Sources, the modulation matrix, then every per-voice target.
fn control(c: &Ctl, rng: &mut Rng, v: &mut Voice, snap: bool) {
    let s = c.s;
    let dt = if snap { 0.0 } else { STEP as f64 / c.sr };
    for i in 0..3 {
        env_step(&mut v.env[i], &s.envs[i], dt);
    }
    for i in 0..3 {
        v.src_u[i] = v.env[i].level as f32;
        v.src_b[i] = (2.0 * v.env[i].level - 1.0) as f32;
    }
    for i in 0..3 {
        lfo_step(c, rng, v, i, dt);
    }
    let note = v.note as f64;
    v.src_u[6] = v.vel as f32;
    v.src_b[6] = (2.0 * v.vel - 1.0) as f32;
    v.src_u[7] = (note / 127.0) as f32;
    v.src_b[7] = ((note - 64.0) / 64.0) as f32;
    v.src_u[8] = c.modwheel as f32;
    v.src_b[8] = (2.0 * c.modwheel - 1.0) as f32;
    v.src_u[9] = ((c.bend + 1.0) / 2.0) as f32;
    v.src_b[9] = c.bend as f32;
    v.src_u[10] = v.rnd as f32;
    v.src_b[10] = (2.0 * v.rnd - 1.0) as f32;
    for i in 0..4 {
        v.src_u[11 + i] = s.macros[i] as f32;
        v.src_b[11 + i] = (2.0 * s.macros[i] - 1.0) as f32;
    }
    for d in 0..DEST_COUNT {
        v.modv[d] = s.base[d] as f32;
    }
    for r in s.routes() {
        let src = if r.bipolar {
            v.src_b[r.source]
        } else {
            v.src_u[r.source]
        };
        v.modv[r.dest] = (v.modv[r.dest] as f64 + r.amount * src as f64) as f32;
    }

    // Glide.
    if v.pitch != v.target {
        let step = v.glide_rate * if snap { 0.0 } else { STEP as f64 };
        if (v.target - v.pitch).abs() <= step || v.glide_rate <= 0.0 {
            v.pitch = v.target;
        } else {
            v.pitch += if v.target > v.pitch { step } else { -step };
        }
    }
    let pitch =
        v.pitch + from_norm(V_TRANSPOSE, v.modv[V_TRANSPOSE] as f64) + c.bend * s.voice.bend_range;

    for o in 0..2 {
        control_osc(c, rng, v, o, pitch, snap);
    }

    // Sub.
    let sr = c.sr;
    let sub_f = mtof(pitch + s.sub.octave * 12.0);
    v.sub_inc = sub_f / sr;
    v.sub_lvl = mip_level(sub_f, sr);
    let sp = from_norm(SUB_PAN, v.modv[SUB_PAN] as f64);
    v.sub_l = ((sp + 1.0) * PI / 4.0).cos() * SQRT_2;
    v.sub_r = ((sp + 1.0) * PI / 4.0).sin() * SQRT_2;
    let sub_t = if s.sub.on {
        from_norm(SUB_LEVEL, v.modv[SUB_LEVEL] as f64)
    } else {
        0.0
    };
    if snap {
        v.sub_lv = sub_t;
        v.sub_lv_d = 0.0;
    } else {
        v.sub_lv_d = (sub_t - v.sub_lv) / STEP as f64;
    }
    let np = from_norm(NOISE_PAN, v.modv[NOISE_PAN] as f64);
    v.noise_l = ((np + 1.0) * PI / 4.0).cos() * SQRT_2;
    v.noise_r = ((np + 1.0) * PI / 4.0).sin() * SQRT_2;
    let n_t = if s.noise.on {
        from_norm(NOISE_LEVEL, v.modv[NOISE_LEVEL] as f64)
    } else {
        0.0
    };
    if snap {
        v.noise_lv = n_t;
        v.noise_lv_d = 0.0;
    } else {
        v.noise_lv_d = (n_t - v.noise_lv) / STEP as f64;
    }

    for f in 0..2 {
        control_filter(c, v, f, snap);
    }

    // Amp: envelope, velocity, volume, and a quick fade when stolen.
    if v.stealing {
        v.fade -= STEP as f64 / (0.004 * sr);
        if v.fade <= 0.0 {
            v.fade = 0.0;
        }
    }
    let vel_gain = 1.0 - s.voice.velocity + s.voice.velocity * v.vel;
    let vol = 10f64.powf(from_norm(V_VOLUME, v.modv[V_VOLUME] as f64) / 20.0);
    let amp_t = v.env[0].level * vel_gain * vol * v.fade;
    v.amp_d = (amp_t - v.amp) / STEP as f64;
}

fn control_osc(c: &Ctl, rng: &mut Rng, v: &mut Voice, o: usize, pitch: f64, snap: bool) {
    let sp = &c.s.osc[o];
    let d = &OSC_D[o];
    let modv = &v.modv;
    let m = |k: usize| from_norm(d[k], modv[d[k]] as f64);
    let os = &mut v.osc[o];
    let n = sp.unison;
    if os.n != n {
        for u in os.n..n {
            os.ph[u] = (sp.phase + sp.random_phase * rng.next()) % 1.0;
        }
        os.n = n;
    }
    let amt = m(3);
    let w = sp.warp;
    let speed = if w == W_SYNC {
        1.0 + amt * 15.0
    } else if w == W_PULSE {
        1.0 / (1.0 - 0.95 * amt)
    } else if w == W_BEND || w == W_SQUEEZE {
        1.0 + amt * 3.0
    } else if w == W_FM {
        1.0 + amt * 4.0
    } else {
        1.0
    };
    let p = pitch + m(4) + m(5) / 100.0;
    let detune = m(6) * 50.0;
    let blend = m(7);
    let width = m(8);
    let pan = m(1);
    let mut norm = 0.0;
    for u in 0..n {
        let x = if n == 1 {
            0.0
        } else {
            (2.0 * u as f64) / (n as f64 - 1.0) - 1.0
        };
        let f = mtof(p + (detune * x) / 100.0);
        os.inc[u] = f / c.sr;
        os.lvl[u] = mip_level(f * speed, c.sr);
        let center = n == 1 || x.abs() < 1.0 / (n as f64 - 1.0) + 1e-6;
        let g = if center { 1.0 } else { blend };
        norm += g * g;
        let mut pp = pan + width * x * if u % 2 == 0 { 1.0 } else { -1.0 };
        pp = pp.clamp(-1.0, 1.0);
        os.ul[u] = (g * ((pp + 1.0) * PI / 4.0).cos() * SQRT_2) as f32;
        os.ur[u] = (g * ((pp + 1.0) * PI / 4.0).sin() * SQRT_2) as f32;
        os.um[u] = g as f32;
    }
    norm = if norm > 0.0 { 1.0 / norm.sqrt() } else { 0.0 };
    for u in 0..n {
        os.ul[u] = (os.ul[u] as f64 * norm) as f32;
        os.ur[u] = (os.ur[u] as f64 * norm) as f32;
        os.um[u] = (os.um[u] as f64 * norm) as f32;
    }
    let pos_t = m(2);
    let lv_t = if sp.on { m(0) } else { 0.0 };
    if snap {
        os.pos = pos_t;
        os.amt = amt;
        os.lv = lv_t;
        os.pos_d = 0.0;
        os.amt_d = 0.0;
        os.lv_d = 0.0;
    } else {
        os.pos_d = (pos_t - os.pos) / STEP as f64;
        os.amt_d = (amt - os.amt) / STEP as f64;
        os.lv_d = (lv_t - os.lv) / STEP as f64;
    }
}

fn control_filter(c: &Ctl, v: &mut Voice, i: usize, snap: bool) {
    let sf = &c.s.filters[i];
    let d = &FIL_D[i];
    let m = |k: usize| from_norm(d[k], v.modv[d[k]] as f64);
    let (cutoff, res, drive, morph, mix) = (m(0), m(1), m(2), m(3), m(4));
    let note = v.note as f64;
    let f = &mut v.filt[i];
    if f.kind != Some(sf.kind) {
        f.reset();
        f.kind = Some(sf.kind);
    }
    let sr = c.sr;
    let mut fc = cutoff * 2f64.powf((sf.keytrack * (note - 60.0)) / 12.0);
    f.drive = drive;
    f.dg = 10f64.powf((f.drive * 24.0) / 20.0);
    f.morph = morph;
    f.mix = mix;
    let t = sf.kind;
    if t == F_COMB || t == F_COMBN {
        f.comb_d = (sr / fc.max(20.0)).max(2.0).min((COMB_SIZE - 2) as f64);
        f.comb_fb = if t == F_COMB { 1.0 } else { -1.0 } * res * 0.97;
        f.comb_damp = f.morph * 0.95;
        return;
    }
    if t == F_FORMANT {
        let x = f.morph * 4.0;
        let j = x.floor().min(3.0) as usize;
        let fr = x - j as f64;
        let shift = (fc / 1000.0).clamp(0.25, 4.0);
        let q = 4.0 + res * 16.0;
        for (k, (lo, hi)) in VOWELS[j].iter().zip(&VOWELS[j + 1]).enumerate() {
            let hz = (lo + (hi - lo) * fr) * shift;
            let g = (PI * hz.min(sr * 0.45) / sr).tan();
            let kk = 1.0 / q;
            let a1 = 1.0 / (1.0 + g * (g + kk));
            f.fa[k * 4] = a1;
            f.fa[k * 4 + 1] = g * a1;
            f.fa[k * 4 + 2] = g * g * a1;
            f.fa[k * 4 + 3] = kk;
        }
        return;
    }
    fc = fc.min(sr * 0.45);
    let g = (PI * fc / sr).tan();
    if t == F_LADDER {
        let gg = g / (1.0 + g);
        let k = res * 3.9;
        if snap {
            f.g = gg;
            f.g_d = 0.0;
        } else {
            f.g_d = (gg - f.g) / STEP as f64;
        }
        f.lk = k;
        return;
    }
    let q = 0.5 * 50f64.powf(res);
    let two_stage = t == F_LP24 || t == F_HP24;
    let k = if two_stage {
        1.0 / q.max(0.707)
    } else {
        1.0 / q
    };
    let a1 = 1.0 / (1.0 + g * (g + k));
    let a2 = g * a1;
    let a3 = g * a2;
    if snap {
        f.a1 = a1;
        f.a2 = a2;
        f.a3 = a3;
        f.k = k;
        f.a1_d = 0.0;
        f.a2_d = 0.0;
        f.a3_d = 0.0;
        f.k_d = 0.0;
    } else {
        f.a1_d = (a1 - f.a1) / STEP as f64;
        f.a2_d = (a2 - f.a2) / STEP as f64;
        f.a3_d = (a3 - f.a3) / STEP as f64;
        f.k_d = (k - f.k) / STEP as f64;
    }
    if two_stage {
        // The first stage stays Butterworth; the second carries the resonance.
        let kb = 1.414;
        let b1 = 1.0 / (1.0 + g * (g + kb));
        f.b1 = b1;
        f.b2 = g * b1;
        f.b3 = g * f.b2;
        f.kb = kb;
    }
}

// --- audio ---

fn render_osc(
    s: &SynthSettings,
    table: Option<&Wavetable>,
    v: &mut Voice,
    o: usize,
    bus: &mut Bus,
    off: usize,
    len: usize,
) {
    let (first, second) = v.osc.split_at_mut(1);
    let (os, partner) = if o == 0 {
        (&mut first[0], &second[0].buf)
    } else {
        (&mut second[0], &first[0].buf)
    };
    os.buf[..len].fill(0.0);
    let sp = &s.osc[o];
    let Some(t) = table.filter(|_| sp.on) else {
        os.pos += os.pos_d * len as f64;
        os.amt += os.amt_d * len as f64;
        os.lv += os.lv_d * len as f64;
        return;
    };
    let frames = t.frames();
    let last = frames as f64 - 1.0;
    let warp = sp.warp;
    let (to_l, to_r, mut also) = targets(bus, sp.dest, sp.dest == 2 && !s.serial);
    let frame_at = |p: f64| {
        let mut fi = p * last;
        if fi < 0.0 {
            fi = 0.0;
        } else if fi > last {
            fi = last;
        }
        let f0 = fi as usize;
        let ff = fi - f0 as f64;
        let f1 = if f0 + 1 < frames { f0 + 1 } else { f0 };
        (f0, f1, ff)
    };
    for u in 0..os.n {
        let mut ph = os.ph[u];
        let inc = os.inc[u];
        let lvl = os.lvl[u];
        let size = MIP_SIZES[lvl];
        let mask = size as i32 - 1;
        let tab = t.level(lvl);
        let (ul, ur, um) = (os.ul[u] as f64, os.ur[u] as f64, os.um[u] as f64);
        let (mut pos, mut amt, mut lv) = (os.pos, os.amt, os.lv);
        let (pos_d, amt_d, lv_d) = (os.pos_d, os.amt_d, os.lv_d);
        let moving = pos_d != 0.0;
        let (mut f0, mut f1, mut ff) = frame_at(pos);
        for (i, partner) in partner[..len].iter().map(|x| *x as f64).enumerate() {
            ph += inc;
            if ph >= 1.0 {
                ph -= 1.0;
            }
            let mut w = ph;
            match warp {
                W_SYNC => {
                    w = ph * (1.0 + amt * 15.0);
                    w -= w.floor();
                }
                W_BEND => {
                    let b = amt * 12.0;
                    w = (ph * (1.0 + b)) / (1.0 + b * ph);
                }
                W_SQUEEZE => {
                    let b = amt * 12.0;
                    if ph < 0.5 {
                        let x = 2.0 * ph;
                        w = (0.5 * x) / (1.0 + b * (1.0 - x));
                    } else {
                        let x = 2.0 - 2.0 * ph;
                        w = 1.0 - (0.5 * x) / (1.0 + b * (1.0 - x));
                    }
                }
                W_PULSE => {
                    let width = 1.0 - 0.95 * amt;
                    w = if ph < width { ph / width } else { 0.0 };
                }
                W_MIRROR => {
                    let tri = if ph < 0.5 { ph } else { 1.0 - ph };
                    w = ph + (tri - ph) * amt;
                    if w < 0.0 {
                        w += 1.0;
                    }
                }
                W_QUANT => {
                    if amt > 0.0 {
                        let steps = js_round(2f64.powf(8.0 - amt * 7.0));
                        w = (ph * steps).floor() / steps;
                    }
                }
                W_FM => {
                    w = ph + amt * 2.0 * partner;
                    w -= w.floor();
                }
                _ => {}
            }
            if moving {
                (f0, f1, ff) = frame_at(pos);
            }
            let x = w * size as f64;
            let i0 = to_i32(x);
            let fr = x - i0 as f64;
            let i0 = i0 & mask;
            let i1 = ((i0 + 1) & mask) as usize;
            let i0 = i0 as usize;
            let (b0, b1) = (f0 * size, f1 * size);
            let a = tab[b0 + i0] as f64 + (tab[b0 + i1] as f64 - tab[b0 + i0] as f64) * fr;
            let b = tab[b1 + i0] as f64 + (tab[b1 + i1] as f64 - tab[b1 + i0] as f64) * fr;
            let mut y = a + (b - a) * ff;
            if warp == W_FOLD && amt > 0.0 {
                let folded = (y * (1.0 + amt * 7.0) * PI * 0.5).sin();
                y += (folded - y) * (amt * 4.0).min(1.0);
            } else if warp == W_RM {
                y *= 1.0 - amt + amt * partner;
            }
            os.buf[i] = (os.buf[i] as f64 + y * um) as f32;
            let yl = y * lv;
            let j = off + i;
            to_l[j] = (to_l[j] as f64 + yl * ul) as f32;
            to_r[j] = (to_r[j] as f64 + yl * ur) as f32;
            if let Some((l2, r2)) = also.as_mut() {
                l2[j] = (l2[j] as f64 + yl * ul) as f32;
                r2[j] = (r2[j] as f64 + yl * ur) as f32;
            }
            pos += pos_d;
            amt += amt_d;
            lv += lv_d;
        }
        os.ph[u] = ph;
    }
    os.pos += os.pos_d * len as f64;
    os.amt += os.amt_d * len as f64;
    os.lv += os.lv_d * len as f64;
}

fn render_sources(
    s: &SynthSettings,
    sub: Option<&Wavetable>,
    rng: &mut Rng,
    v: &mut Voice,
    bus: &mut Bus,
    off: usize,
    len: usize,
) {
    let serial = s.serial;
    match sub.filter(|_| s.sub.on) {
        Some(t) => {
            let (l, r, mut also) = targets(bus, s.sub.dest, s.sub.dest == 2 && !serial);
            let lvl = v.sub_lvl;
            let size = MIP_SIZES[lvl];
            let mask = size as i32 - 1;
            let tab = t.level(lvl);
            let base = s.sub.shape.min(3).min(t.frames() - 1) * size;
            let (mut ph, mut lv) = (v.sub_ph, v.sub_lv);
            let (inc, lv_d, gl, gr) = (v.sub_inc, v.sub_lv_d, v.sub_l, v.sub_r);
            for i in 0..len {
                ph += inc;
                if ph >= 1.0 {
                    ph -= 1.0;
                }
                let x = ph * size as f64;
                let i0 = to_i32(x);
                let fr = x - i0 as f64;
                let i0 = i0 & mask;
                let i1 = ((i0 + 1) & mask) as usize;
                let i0 = i0 as usize;
                let y = (tab[base + i0] as f64
                    + (tab[base + i1] as f64 - tab[base + i0] as f64) * fr)
                    * lv;
                let j = off + i;
                l[j] = (l[j] as f64 + y * gl) as f32;
                r[j] = (r[j] as f64 + y * gr) as f32;
                if let Some((l2, r2)) = also.as_mut() {
                    l2[j] = (l2[j] as f64 + y * gl) as f32;
                    r2[j] = (r2[j] as f64 + y * gr) as f32;
                }
                lv += lv_d;
            }
            v.sub_ph = ph;
            v.sub_lv = lv;
        }
        None => v.sub_lv += v.sub_lv_d * len as f64,
    }
    if s.noise.on {
        let (l, r, mut also) = targets(bus, s.noise.dest, s.noise.dest == 2 && !serial);
        let pk = &mut v.pink;
        let mut lv = v.noise_lv;
        let (lv_d, gl, gr, pink) = (v.noise_lv_d, v.noise_l, v.noise_r, s.noise.pink);
        for i in 0..len {
            let mut y = rng.next() * 2.0 - 1.0;
            if pink {
                // Paul Kellet's pink noise filter.
                pk[0] = 0.99886 * pk[0] + y * 0.0555179;
                pk[1] = 0.99332 * pk[1] + y * 0.0750759;
                pk[2] = 0.969 * pk[2] + y * 0.153852;
                pk[3] = 0.8665 * pk[3] + y * 0.3104856;
                pk[4] = 0.55 * pk[4] + y * 0.5329522;
                pk[5] = -0.7616 * pk[5] - y * 0.016898;
                y = (pk[0] + pk[1] + pk[2] + pk[3] + pk[4] + pk[5] + pk[6] + y * 0.5362) * 0.11;
                pk[6] = y * 0.115926;
            }
            y *= lv;
            let j = off + i;
            l[j] = (l[j] as f64 + y * gl) as f32;
            r[j] = (r[j] as f64 + y * gr) as f32;
            if let Some((l2, r2)) = also.as_mut() {
                l2[j] = (l2[j] as f64 + y * gl) as f32;
                r2[j] = (r2[j] as f64 + y * gr) as f32;
            }
            lv += lv_d;
        }
        v.noise_lv = lv;
    } else {
        v.noise_lv += v.noise_lv_d * len as f64;
    }
}

fn filter(f: &mut Filter, kind: usize, l: Lane, r: Lane, off: usize, len: usize) {
    let range = off..off + len;
    let mix = f.mix;
    let drive = f.drive > 0.0005;
    let dg = f.dg;
    if kind == F_COMB || kind == F_COMBN {
        f.comb_used = true;
        let mut w = f.comb_w;
        let (d, fb, damp) = (f.comb_d, f.comb_fb, f.comb_damp);
        let (mut lp_l, mut lp_r) = (f.comb_lp_l, f.comb_lp_r);
        let norm = 1.0 - fb.abs() * 0.75;
        for i in range {
            let mut rd = w as f64 - d;
            if rd < 0.0 {
                rd += COMB_SIZE as f64;
            }
            let r0 = rd as usize;
            let fr = rd - r0 as f64;
            let r1 = (r0 + 1) % COMB_SIZE;
            let dl = f.comb_l[r0] as f64 + (f.comb_l[r1] as f64 - f.comb_l[r0] as f64) * fr;
            let dr = f.comb_r[r0] as f64 + (f.comb_r[r1] as f64 - f.comb_r[r0] as f64) * fr;
            lp_l += (1.0 - damp) * (dl - lp_l);
            lp_r += (1.0 - damp) * (dr - lp_r);
            let (mut xl, mut xr) = (l[i] as f64, r[i] as f64);
            if drive {
                xl = sat(xl * dg);
                xr = sat(xr * dg);
            }
            let yl = xl + fb * lp_l;
            let yr = xr + fb * lp_r;
            f.comb_l[w] = yl as f32;
            f.comb_r[w] = yr as f32;
            w = (w + 1) % COMB_SIZE;
            l[i] = (l[i] as f64 + (yl * norm - l[i] as f64) * mix) as f32;
            r[i] = (r[i] as f64 + (yr * norm - r[i] as f64) * mix) as f32;
        }
        f.comb_w = w;
        f.comb_lp_l = lp_l;
        f.comb_lp_r = lp_r;
        return;
    }
    if kind == F_FORMANT {
        for (c, xs) in [l, r].into_iter().enumerate() {
            for i in range.clone() {
                let mut x = xs[i] as f64;
                if drive {
                    x = sat(x * dg);
                }
                let mut y = 0.0;
                for k in 0..3 {
                    let (a1, a2, a3, kk) = (
                        f.fa[k * 4],
                        f.fa[k * 4 + 1],
                        f.fa[k * 4 + 2],
                        f.fa[k * 4 + 3],
                    );
                    let si = c * 6 + k * 2;
                    let (ic1, ic2) = (f.s[si], f.s[si + 1]);
                    let v3 = x - ic2;
                    let v1 = a1 * ic1 + a2 * v3;
                    let v2 = ic2 + a2 * ic1 + a3 * v3;
                    f.s[si] = 2.0 * v1 - ic1;
                    f.s[si + 1] = 2.0 * v2 - ic2;
                    y += kk * v1 * [1.0, 0.7, 0.4][k];
                }
                xs[i] = (x + (y * 1.6 - x) * mix) as f32;
            }
        }
        return;
    }
    if kind == F_LADDER {
        let (g0, gd, k) = (f.g, f.g_d, f.lk);
        let comp = 1.0 + k * 0.5;
        for (c, xs) in [l, r].into_iter().enumerate() {
            let b = c * 4;
            let st = &mut f.s;
            let mut g = g0;
            for i in range.clone() {
                let x = xs[i] as f64;
                let beta = 1.0 - g;
                let sum =
                    beta * (g * g * g * st[b] + g * g * st[b + 1] + g * st[b + 2] + st[b + 3]);
                let mut u = (x * comp - k * sum) / (1.0 + k * g * g * g * g);
                u = sat(u * if drive { dg } else { 1.0 });
                let mut inp = u;
                for j in 0..4 {
                    let vv = (inp - st[b + j]) * g;
                    let y = vv + st[b + j];
                    st[b + j] = y + vv;
                    inp = y;
                }
                xs[i] = (x + (inp - x) * mix) as f32;
                g += gd;
            }
        }
        f.g = g0 + gd * len as f64;
        return;
    }
    let two_stage = kind == F_LP24 || kind == F_HP24;
    for (c, xs) in [l, r].into_iter().enumerate() {
        let (mut a1, mut a2, mut a3, mut k) = (f.a1, f.a2, f.a3, f.k);
        let (b1, b2, b3, kb) = (f.b1, f.b2, f.b3, f.kb);
        let si = c * 4;
        let (mut ic1, mut ic2, mut jc1, mut jc2) = (f.s[si], f.s[si + 1], f.s[si + 2], f.s[si + 3]);
        for i in range.clone() {
            let dry = xs[i] as f64;
            let mut x = dry;
            if drive {
                x = sat(x * dg);
            }
            if two_stage {
                let v3 = x - jc2;
                let v1 = b1 * jc1 + b2 * v3;
                let v2 = jc2 + b2 * jc1 + b3 * v3;
                jc1 = 2.0 * v1 - jc1;
                jc2 = 2.0 * v2 - jc2;
                x = if kind == F_LP24 { v2 } else { x - kb * v1 - v2 };
            }
            let v3 = x - ic2;
            let v1 = a1 * ic1 + a2 * v3;
            let v2 = ic2 + a2 * ic1 + a3 * v3;
            ic1 = 2.0 * v1 - ic1;
            ic2 = 2.0 * v2 - ic2;
            let y = match kind {
                F_LP12 | F_LP24 => v2,
                F_HP12 | F_HP24 => x - k * v1 - v2,
                F_BP => k * v1,
                F_NOTCH => x - k * v1,
                _ => {
                    let (lp, bp, hp, notch) = (v2, k * v1, x - k * v1 - v2, x - k * v1);
                    let m = f.morph * 3.0;
                    if m < 1.0 {
                        lp + (bp - lp) * m
                    } else if m < 2.0 {
                        bp + (hp - bp) * (m - 1.0)
                    } else {
                        hp + (notch - hp) * (m - 2.0)
                    }
                }
            };
            xs[i] = (dry + (y - dry) * mix) as f32;
            a1 += f.a1_d;
            a2 += f.a2_d;
            a3 += f.a3_d;
            k += f.k_d;
        }
        f.s[si] = ic1;
        f.s[si + 1] = ic2;
        f.s[si + 2] = jc1;
        f.s[si + 3] = jc2;
    }
    f.a1 += f.a1_d * len as f64;
    f.a2 += f.a2_d * len as f64;
    f.a3 += f.a3_d * len as f64;
    f.k += f.k_d * len as f64;
}

/// What a voice renders with besides itself.
struct Render<'a> {
    s: &'a SynthSettings,
    used: Use,
    tables: &'a [Option<Wavetable>; 2],
    sub: Option<&'a Wavetable>,
}

#[allow(clippy::too_many_arguments)]
fn render_voice(
    x: &Render,
    rng: &mut Rng,
    bus: &mut Bus,
    v: &mut Voice,
    out_l: &mut [f32],
    out_r: &mut [f32],
    off: usize,
    len: usize,
) {
    let s = x.s;
    let used = x.used;
    let range = off..off + len;
    if used.f1 {
        bus[0][range.clone()].fill(0.0);
        bus[1][range.clone()].fill(0.0);
    }
    if used.f2 {
        bus[2][range.clone()].fill(0.0);
        bus[3][range.clone()].fill(0.0);
    }
    if used.d {
        bus[4][range.clone()].fill(0.0);
        bus[5][range.clone()].fill(0.0);
    }
    // A modulator renders first so the other oscillator can read it.
    let first = if s.osc[0].warp == W_FM || s.osc[0].warp == W_RM {
        1
    } else {
        0
    };
    render_osc(s, x.tables[first].as_ref(), v, first, bus, off, len);
    render_osc(s, x.tables[1 - first].as_ref(), v, 1 - first, bus, off, len);
    render_sources(s, x.sub, rng, v, bus, off, len);
    let f = &s.filters;
    let [f1l, f1r, f2l, f2r, dl, dr] = bus;
    let mut use_f1 = used.f1;
    if use_f1 && f[0].on {
        filter(&mut v.filt[0], f[0].kind, f1l, f1r, off, len);
    }
    if s.serial {
        if used.f2 && f[1].on {
            if use_f1 {
                for i in range.clone() {
                    f2l[i] += f1l[i];
                    f2r[i] += f1r[i];
                }
            }
            filter(&mut v.filt[1], f[1].kind, f2l, f2r, off, len);
            use_f1 = false;
        }
    } else if used.f2 && f[1].on {
        filter(&mut v.filt[1], f[1].kind, f2l, f2r, off, len);
    }
    // The mix of whichever buses are live goes to f1 (reused as the sum).
    if !use_f1 {
        f1l[range.clone()].fill(0.0);
        f1r[range.clone()].fill(0.0);
    }
    if used.f2 {
        for i in range.clone() {
            f1l[i] += f2l[i];
            f1r[i] += f2r[i];
        }
    }
    if used.d {
        for i in range.clone() {
            f1l[i] += dl[i];
            f1r[i] += dr[i];
        }
    }
    let mut amp = v.amp;
    let amp_d = v.amp_d;
    let mut peak = 0.0;
    for i in range.clone() {
        let l = f1l[i] as f64 * amp;
        let r = f1r[i] as f64 * amp;
        out_l[i] = (out_l[i] as f64 + l) as f32;
        out_r[i] = (out_r[i] as f64 + r) as f32;
        let a = l.abs() + r.abs();
        if a > peak {
            peak = a;
        }
        amp += amp_d;
    }
    v.amp = amp;
    if peak.is_nan() || peak >= 1e4 {
        // A filter blew up (or NaN): silence this voice's state.
        v.filt.iter_mut().for_each(Filter::reset);
        out_l[range.clone()].fill(0.0);
        out_r[range].fill(0.0);
    }
}

pub struct Synth {
    sr: f64,
    bpm: f64,
    bend: f64,
    modwheel: f64,
    s: Box<SynthSettings>,
    has_settings: bool,
    used: Use,
    tables: [Option<Wavetable>; 2],
    sub: Option<Wavetable>,
    voices: Vec<Voice>,
    events: Vec<SynthEvent>,
    last_note: f64,
    stack: Vec<i32>,
    counter: u64,
    global_lfo: [f64; 3],
    ctrl_left: usize,
    bus: Box<Bus>,
    peak_l: f64,
    peak_r: f64,
    rng: Rng,
}

impl Synth {
    pub fn new(sample_rate: f64) -> Self {
        Self {
            sr: sample_rate,
            bpm: 120.0,
            bend: 0.0,
            modwheel: 0.0,
            s: Box::default(),
            has_settings: false,
            used: Use::default(),
            tables: [None, None],
            sub: None,
            voices: (0..MAXV).map(|_| Voice::new()).collect(),
            events: Vec::with_capacity(EVENT_CAPACITY),
            last_note: -1.0,
            stack: Vec::with_capacity(STACK),
            counter: 0,
            global_lfo: [0.0; 3],
            ctrl_left: 0,
            bus: Box::new([[0.0; QUANTUM]; 6]),
            peak_l: 0.0,
            peak_r: 0.0,
            rng: Rng(22222),
        }
    }

    pub fn set_settings(&mut self, settings: &SynthSettings) {
        *self.s = settings.sanitized();
        self.has_settings = true;
        let s = &*self.s;
        let mut used = Use::default();
        let mut add = |on: bool, dest: usize| {
            if !on {
                return;
            }
            match dest {
                0 => used.f1 = true,
                1 => used.f2 = true,
                2 => {
                    used.f1 = true;
                    if !s.serial {
                        used.f2 = true;
                    }
                }
                _ => used.d = true,
            }
        };
        add(s.osc[0].on, s.osc[0].dest);
        add(s.osc[1].on, s.osc[1].dest);
        add(s.sub.on, s.sub.dest);
        add(s.noise.on, s.noise.dest);
        if s.serial && used.f1 && s.filters[1].on {
            used.f2 = true;
        }
        self.used = used;
    }

    /// Oscillator 1's wavetable (slot 0), oscillator 2's (1) or the sub's
    /// shapes (2).
    pub fn set_table(&mut self, slot: usize, table: Option<Wavetable>) {
        match slot {
            0 | 1 => self.tables[slot] = table,
            2 => self.sub = table,
            _ => {}
        }
    }

    pub fn table(&self, slot: usize) -> Option<&Wavetable> {
        match slot {
            0 | 1 => self.tables[slot].as_ref(),
            2 => self.sub.as_ref(),
            _ => None,
        }
    }

    /// The tempo synced LFOs follow.
    pub fn set_bpm(&mut self, bpm: f64) {
        self.bpm = bpm;
    }

    /// -1..1 of the pitch-bend range.
    pub fn set_bend(&mut self, bend: f64) {
        self.bend = bend;
    }

    /// 0..1.
    pub fn set_mod_wheel(&mut self, amount: f64) {
        self.modwheel = amount;
    }

    pub fn add_event(&mut self, e: SynthEvent) {
        if self.events.len() == self.events.capacity() {
            return;
        }
        let mut i = self.events.len();
        while i > 0 && self.events[i - 1].time > e.time {
            i -= 1;
        }
        self.events.insert(i, e);
    }

    fn ctl(&self) -> Ctl<'_> {
        Ctl {
            s: &self.s,
            sr: self.sr,
            bpm: self.bpm,
            bend: self.bend,
            modwheel: self.modwheel,
        }
    }

    fn control(&mut self, i: usize, snap: bool) {
        let c = Ctl {
            s: &self.s,
            sr: self.sr,
            bpm: self.bpm,
            bend: self.bend,
            modwheel: self.modwheel,
        };
        control(&c, &mut self.rng, &mut self.voices[i], snap);
    }

    // --- notes ---

    fn note_on(&mut self, note: i32, vel: f64) {
        if !self.has_settings {
            return;
        }
        let mode = self.s.voice.mode;
        if mode == 0 {
            let mut v = None;
            for (i, x) in self.voices.iter().enumerate() {
                if x.active && x.gate && !x.stealing && x.note == note {
                    v = Some(i);
                }
            }
            let v = match v {
                Some(i) => i,
                None => {
                    let mut count = self
                        .voices
                        .iter()
                        .filter(|x| x.active && !x.stealing)
                        .count() as i64;
                    while count >= self.s.voice.polyphony as i64 {
                        self.steal();
                        count -= 1;
                    }
                    self.free_voice()
                }
            };
            self.start_voice(v, note, vel, self.last_note);
        } else {
            self.stack.retain(|n| *n != note);
            if self.stack.len() == STACK {
                self.stack.remove(0);
            }
            self.stack.push(note);
            let mut v: Option<usize> = None;
            for i in 0..MAXV {
                if !self.voices[i].active || self.voices[i].stealing {
                    continue;
                }
                if let Some(j) = v {
                    if self.voices[i].age < self.voices[j].age {
                        release(&mut self.voices[i], true);
                        continue;
                    }
                    release(&mut self.voices[j], true);
                }
                v = Some(i);
            }
            match v {
                Some(j) if self.voices[j].gate => {
                    self.glide_to(j, note);
                    self.voices[j].note = note;
                    self.voices[j].vel = vel;
                    if mode == 1 {
                        self.retrigger(j);
                    }
                }
                _ => {
                    let from = v.map_or(self.last_note, |j| self.voices[j].pitch);
                    if let Some(j) = v {
                        release(&mut self.voices[j], true);
                    }
                    let free = self.free_voice();
                    self.start_voice(free, note, vel, from);
                }
            }
        }
        self.last_note = note as f64;
    }

    fn note_off(&mut self, note: i32) {
        if !self.has_settings {
            return;
        }
        if self.s.voice.mode == 0 {
            for v in &mut self.voices {
                if v.active && v.gate && v.note == note {
                    release(v, false);
                }
            }
            return;
        }
        let was_top = self.stack.last() == Some(&note);
        self.stack.retain(|n| *n != note);
        if !was_top {
            return;
        }
        for i in 0..MAXV {
            let v = &self.voices[i];
            if !v.active || !v.gate || v.stealing {
                continue;
            }
            match self.stack.last().copied() {
                Some(back) => {
                    self.glide_to(i, back);
                    self.voices[i].note = back;
                }
                None => release(&mut self.voices[i], false),
            }
        }
    }

    fn all_off(&mut self, hard: bool) {
        self.stack.clear();
        for v in self.voices.iter_mut().filter(|v| v.active) {
            if hard {
                release(v, true);
            } else if v.gate {
                release(v, false);
            }
        }
    }

    fn free_voice(&mut self) -> usize {
        if let Some(i) = self.voices.iter().position(|v| !v.active) {
            return i;
        }
        // Every voice is busy (or fading out): take the one fading longest.
        let mut best = 0;
        for i in 1..MAXV {
            if self.voices[i].age < self.voices[best].age {
                best = i;
            }
        }
        self.voices[best].active = false;
        best
    }

    fn steal(&mut self) {
        let oldest = |ok: &dyn Fn(&Voice) -> bool| {
            let mut pick: Option<usize> = None;
            for (i, v) in self.voices.iter().enumerate() {
                if !ok(v) {
                    continue;
                }
                if pick.is_none_or(|p| v.age < self.voices[p].age) {
                    pick = Some(i);
                }
            }
            pick
        };
        let pick = oldest(&|v| v.active && !v.stealing && !v.gate)
            .or_else(|| oldest(&|v| v.active && !v.stealing));
        if let Some(p) = pick {
            release(&mut self.voices[p], true);
        }
    }

    fn glide_to(&mut self, i: usize, note: i32) {
        let glide = self.s.voice.glide;
        let sr = self.sr;
        let v = &mut self.voices[i];
        v.target = note as f64;
        if glide > 0.0 {
            v.glide_rate = (note as f64 - v.pitch).abs() / (glide * sr);
        } else {
            v.pitch = note as f64;
        }
    }

    fn retrigger(&mut self, i: usize) {
        let s = &self.s;
        let v = &mut self.voices[i];
        for e in &mut v.env {
            e.from = e.level;
            e.stage = 1;
            e.t = 0.0;
        }
        for (st, l) in v.lfo.iter_mut().zip(&s.lfos) {
            if l.mode != 1 {
                st.phase = 0.0;
                st.done = false;
            }
            st.fade_t = 0.0;
        }
    }

    fn start_voice(&mut self, i: usize, note: i32, vel: f64, from: f64) {
        self.counter += 1;
        let s = &self.s;
        let rng = &mut self.rng;
        let v = &mut self.voices[i];
        let fresh = !v.active;
        v.active = true;
        v.gate = true;
        v.stealing = false;
        v.fade = 1.0;
        v.note = note;
        v.vel = vel;
        v.age = self.counter;
        v.rnd = rng.next();
        v.target = note as f64;
        if s.voice.glide > 0.0 && from >= 0.0 && from != note as f64 {
            v.pitch = from;
            v.glide_rate = (note as f64 - from).abs() / (s.voice.glide * self.sr);
        } else {
            v.pitch = note as f64;
        }
        if fresh {
            v.amp = 0.0;
            for e in &mut v.env {
                e.level = 0.0;
                e.from = 0.0;
            }
            for (os, sp) in v.osc.iter_mut().zip(&s.osc) {
                os.n = 0;
                for ph in &mut os.ph {
                    *ph = (sp.phase + sp.random_phase * rng.next()) % 1.0;
                }
            }
            v.sub_ph = 0.0;
            v.pink = [0.0; 7];
            v.filt.iter_mut().for_each(Filter::reset);
        }
        for (k, st) in v.lfo.iter_mut().enumerate() {
            st.phase = if s.lfos[k].mode == 1 {
                self.global_lfo[k]
            } else {
                0.0
            };
            st.done = false;
            st.fade_t = 0.0;
            st.prev = rng.next();
            st.next = rng.next();
        }
        self.retrigger(i);
        // The first samples already play with this note's settings.
        self.control(i, true);
    }

    // --- audio ---

    /// Renders `n` frames (at most `QUANTUM`) into out_l/out_r (cleared
    /// here); `now` is the clock time (s) of the first.
    pub fn process(&mut self, out_l: &mut [f32], out_r: &mut [f32], n: usize, now: f64) {
        out_l[..n].fill(0.0);
        out_r[..n].fill(0.0);
        if !self.has_settings {
            return;
        }
        let sr = self.sr;
        let mut f = 0;
        while f < n {
            // Events due by this sample.
            while let Some(e) = self.events.first().copied() {
                if js_round((e.time - now) * sr) > f as f64 {
                    break;
                }
                self.events.remove(0);
                match e.kind {
                    SynthEventKind::On { note, vel } => self.note_on(note, vel),
                    SynthEventKind::Off { note } => self.note_off(note),
                    SynthEventKind::AllOff => self.all_off(false),
                    SynthEventKind::Panic => self.all_off(true),
                }
            }
            if self.ctrl_left == 0 {
                let dt = STEP as f64 / sr;
                for i in 0..3 {
                    let rate = lfo_rate(&self.ctl(), i, None);
                    self.global_lfo[i] += rate * dt;
                    self.global_lfo[i] -= self.global_lfo[i].floor();
                }
                for i in 0..MAXV {
                    if self.voices[i].active {
                        self.control(i, false);
                    }
                }
                self.ctrl_left = STEP;
            }
            let mut len = (n - f).min(self.ctrl_left);
            if let Some(e) = self.events.first() {
                let at = js_round((e.time - now) * sr);
                if at > f as f64 && at - (f as f64) < len as f64 {
                    len = at as usize - f;
                }
            }
            let x = Render {
                s: &self.s,
                used: self.used,
                tables: &self.tables,
                sub: self.sub.as_ref(),
            };
            for v in self.voices.iter_mut().filter(|v| v.active) {
                render_voice(&x, &mut self.rng, &mut self.bus, v, out_l, out_r, f, len);
            }
            f += len;
            self.ctrl_left -= len;
        }
        // Voices whose amp envelope (or steal fade) has finished.
        for v in self.voices.iter_mut().filter(|v| v.active) {
            let done = (v.env[0].stage == 0 && !v.gate) || (v.stealing && v.fade <= 0.0);
            if done && v.amp.abs() < 1e-4 {
                v.active = false;
            }
        }
        let (mut pl, mut pr) = (self.peak_l, self.peak_r);
        for i in 0..n {
            let (l, r) = (out_l[i].abs() as f64, out_r[i].abs() as f64);
            if l > pl {
                pl = l;
            }
            if r > pr {
                pr = r;
            }
        }
        self.peak_l = pl;
        self.peak_r = pr;
    }

    /// Renders any number of frames, a quantum at a time.
    pub fn render(&mut self, out_l: &mut [f32], out_r: &mut [f32], now: f64) {
        let n = out_l.len().min(out_r.len());
        let mut done = 0;
        while done < n {
            let len = (n - done).min(QUANTUM);
            let at = now + done as f64 / self.sr;
            self.process(&mut out_l[done..], &mut out_r[done..], len, at);
            done += len;
        }
    }

    /// Voices sounding (not counting the stolen ones fading out).
    pub fn active_count(&self) -> usize {
        self.voices
            .iter()
            .filter(|v| v.active && !v.stealing)
            .count()
    }

    /// The newest voice's modulated knobs, envelopes and LFOs, and the
    /// output's peaks since the last call.
    pub fn take_state(&mut self) -> SynthState {
        let mut newest: Option<&Voice> = None;
        for x in &self.voices {
            if x.active && !x.stealing && newest.is_none_or(|v| x.age > v.age) {
                newest = Some(x);
            }
        }
        let state = SynthState {
            voices: self.active_count(),
            newest: newest.map(|v| VoiceState {
                modulated: v.modv,
                env: v.env.map(|e| (e.stage, e.level)),
            }),
            lfo: match newest {
                Some(v) => v.lfo.map(|l| (if l.done { 1.0 } else { l.phase }, l.value)),
                None => self.global_lfo.map(|p| (p, 0.0)),
            },
            peak_l: self.peak_l,
            peak_r: self.peak_r,
        };
        self.peak_l = 0.0;
        self.peak_r = 0.0;
        state
    }
}
