//! The Furnace amp's DSP: a high-gain tube amp modeled stage by stage - the
//! input coupling, up to four triode stages (cathode-bypass shelf, gain, an
//! asymmetric soft clip whose bias shifts as the grid conducts, coupling
//! high-pass, the plate's Miller low-pass), the cathode follower, the
//! passive bass/mid/treble network, then the power amp (presence and depth,
//! phase inverter and output stage clipping, the supply sagging under load,
//! the output transformer's band). Everything from the first stage on runs
//! at 4x the rate, so the distortion doesn't alias.
//!
//! Port of `src/effects/furnace/ampKernel.ts` (`AmpKernel`) and the knobs'
//! meaning (`ampModel.ts`, `ampSettingsFromParams`: the voicings) step for
//! step; `tests/amp_parity.rs` holds the port to what the JavaScript
//! renders. Like the worklet (`ampSim.ts`) it's mono: `AmpEffect` plays the
//! stereo input's mix, 0.5 * (L + R), and feeds both sides.
//!
//! The tone stack isn't a remembered formula: whenever a control moves, the
//! circuit is solved at a few frequencies and the exact third-order
//! response fitted, then turned into a digital filter.

use std::f64::consts::PI;

use crate::instruments::js_round;
use crate::params::ParamSource;

/// The oversampling factor.
pub const OS: usize = 4;
/// Taps of the oversampling filters (each way).
pub const TAPS: usize = 64;
/// Latency (frames at the base rate) of the oversampling.
pub const LATENCY: usize = 16;
const MAX_STAGES: usize = 4;

/// The tone stack's parts: treble, bass, mid caps (F); treble, bass, mid
/// pots and slope resistor (ohm).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Stack {
    pub c1: f64,
    pub c2: f64,
    pub c3: f64,
    pub r1: f64,
    pub r2: f64,
    pub r3: f64,
    pub r4: f64,
}

/// The kernel's settings (`AmpSettings`): the knobs (0-1) and the voicing.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AmpSettings {
    pub gain: f64,
    pub bass: f64,
    pub mid: f64,
    pub treble: f64,
    pub presence: f64,
    pub master: f64,
    /// Output level, dB.
    pub output: f64,
    /// How many triode stages clip (3 or 4), and per stage: its gain, its
    /// cathode-bypass shelf (Hz, gain kept below), coupling high-pass and
    /// Miller low-pass (Hz).
    pub stages: usize,
    pub stage_gains: [f64; MAX_STAGES],
    pub shelf_hz: [f64; MAX_STAGES],
    pub shelf_keep: [f64; MAX_STAGES],
    pub coupling_hz: [f64; MAX_STAGES],
    pub miller_hz: [f64; MAX_STAGES],
    pub input_hz: f64,
    pub asymmetry: f64,
    pub bias: f64,
    pub bright: f64,
    pub stack: Stack,
    pub stack_gain: f64,
    pub power_drive: f64,
    pub presence_hz: f64,
    pub presence_db: f64,
    pub depth_hz: f64,
    pub depth_db: f64,
    pub sag: f64,
    pub low_hz: f64,
    pub high_hz: f64,
}

/// The default knob positions (0-10), where the reference voicing was
/// fitted.
const DEFAULT_KNOBS: [(&str, f64); 6] = [
    ("gain", 7.0),
    ("bass", 6.1),
    ("mid", 4.9),
    ("treble", 4.0),
    ("presence", 6.6),
    ("master", 5.0),
];

/// The Modern voicing (`MODERN`), fitted against the reference capture.
const MODERN: AmpSettings = AmpSettings {
    gain: 0.0,
    bass: 0.0,
    mid: 0.0,
    treble: 0.0,
    presence: 0.0,
    master: 0.0,
    output: 0.0,
    stages: 4,
    stage_gains: [20.3, 8.31, 31.6, 7.29],
    shelf_hz: [473.0, 473.0, 473.0, 473.0],
    shelf_keep: [0.793, 0.793, 0.793, 0.793],
    coupling_hz: [20.0, 349.0, 40.0, 30.0],
    miller_hz: [17470.0, 13976.0, 12229.0, 10482.0],
    input_hz: 363.0,
    asymmetry: 2.58,
    bias: 0.347,
    bright: 3.44,
    stack: Stack {
        c1: 0.839e-9,
        c2: 20e-9,
        c3: 22.1e-9,
        r1: 250000.0,
        r2: 1000000.0,
        r3: 25000.0,
        r4: 53282.0,
    },
    stack_gain: 1.78,
    power_drive: 2.69,
    presence_hz: 4691.0,
    presence_db: 9.0,
    depth_hz: 88.0,
    depth_db: 9.0,
    sag: 0.0,
    low_hz: 40.0,
    high_hz: 17042.0,
};
/// The output trim that puts the Modern voicing at the reference's level.
const MODERN_TRIM: f64 = -5.07;
/// The tube rectifier: more power-amp drive, its level matched back, a
/// looser low end.
const TUBE_DRIVE: f64 = 1.6;
const TUBE_TRIM: f64 = -3.3;
const TUBE_INPUT: f64 = 0.85;
/// Supply sag: the tube rectifier's, the diodes'.
const SAG_TUBE: f64 = 1.5;
const SAG_DIODE: f64 = 0.89;

/// A channel mode's voicing and output trim (`voicing`): 0 Raw, 1 Vintage,
/// 2 Modern.
fn voicing(mode: usize) -> (AmpSettings, f64) {
    let m = MODERN;
    match mode {
        2 => (m, MODERN_TRIM),
        1 => {
            let g = m.stage_gains;
            let c = m.coupling_hz;
            (
                AmpSettings {
                    stage_gains: [g[0], g[1] * 0.6, g[2] * 0.7, g[3]],
                    coupling_hz: [c[0], c[1] * 0.5, c[2], c[3]],
                    input_hz: m.input_hz * 0.6,
                    miller_hz: m.miller_hz.map(|f| f * 0.85),
                    bias: m.bias * 0.7,
                    stack: Stack {
                        r4: m.stack.r4 * 0.55,
                        ..m.stack
                    },
                    depth_db: m.depth_db * 0.6,
                    presence_db: m.presence_db * 0.8,
                    ..m
                },
                MODERN_TRIM - 1.6,
            )
        }
        _ => {
            let g = m.stage_gains;
            let c = m.coupling_hz;
            let f = m.miller_hz;
            (
                AmpSettings {
                    stages: 3,
                    stage_gains: [g[0], g[1] * 0.5, g[2], 0.0],
                    coupling_hz: [c[0], c[1] * 0.4, c[2], 0.0],
                    miller_hz: [f[0] * 1.2, f[1] * 1.2, f[2] * 1.2, 0.0],
                    input_hz: m.input_hz * 0.5,
                    bias: m.bias * 0.5,
                    bright: m.bright * 1.5,
                    stack: Stack {
                        r4: m.stack.r4 * 0.7,
                        ..m.stack
                    },
                    depth_db: m.depth_db * 0.5,
                    ..m
                },
                MODERN_TRIM + 0.2,
            )
        }
    }
}

impl AmpSettings {
    /// The settings for the effect's parameters (`ampSettingsFromParams`):
    /// the knobs 0-10, `mode` 0-2 (Raw, Vintage, Modern), `rectifier` (0
    /// tube, 1 diode), `output` dB.
    pub fn from_params<P: ParamSource + ?Sized>(p: &P) -> Self {
        let mode = js_round(p.param_or("mode", 2.0)).clamp(0.0, 2.0) as usize;
        let (v, trim) = voicing(mode);
        let tube = p.param_or("rectifier", 1.0) < 0.5;
        let knob = |key: &str| {
            let fallback = DEFAULT_KNOBS
                .iter()
                .find(|(k, _)| *k == key)
                .map_or(0.0, |(_, v)| *v);
            (p.param_or(key, fallback) / 10.0).clamp(0.0, 1.0)
        };
        Self {
            gain: knob("gain"),
            bass: knob("bass"),
            mid: knob("mid"),
            treble: knob("treble"),
            presence: knob("presence"),
            master: knob("master"),
            output: p.param_or("output", 0.0) + trim + if tube { TUBE_TRIM } else { 0.0 },
            sag: if tube { SAG_TUBE } else { SAG_DIODE },
            power_drive: v.power_drive * if tube { TUBE_DRIVE } else { 1.0 },
            input_hz: v.input_hz * if tube { TUBE_INPUT } else { 1.0 },
            ..v
        }
    }
}

impl Default for AmpSettings {
    fn default() -> Self {
        Self::from_params(&[] as &[(&str, f64)])
    }
}

// --- Small filters (run at the oversampled rate) ---

#[derive(Clone, Copy, Default)]
struct OnePole {
    a: f64,
    z: f64,
}

impl OnePole {
    fn lowpass(&mut self, fc: f64, fs: f64) {
        self.a = ((-2.0 * PI * fc) / fs).exp();
    }

    fn lp(&mut self, x: f64) -> f64 {
        self.z = x + self.a * (self.z - x);
        self.z
    }

    fn hp(&mut self, x: f64) -> f64 {
        x - self.lp(x)
    }
}

#[derive(Clone, Copy)]
enum Shape {
    Lp,
    Hp,
    Peak,
    HighShelf,
}

/// RBJ biquad, transposed direct form II.
#[derive(Clone, Copy)]
struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}

impl Default for Biquad {
    fn default() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            z1: 0.0,
            z2: 0.0,
        }
    }
}

impl Biquad {
    fn set(&mut self, shape: Shape, fc: f64, q: f64, db: f64, fs: f64) {
        let w = (2.0 * PI * fc.min(fs * 0.45)) / fs;
        let c = w.cos();
        let s = w.sin();
        let alpha = s / (2.0 * q);
        let a = 10f64.powf(db / 40.0);
        let (b0, b1, b2, a0, a1, a2) = match shape {
            Shape::Lp => (
                (1.0 - c) / 2.0,
                1.0 - c,
                (1.0 - c) / 2.0,
                1.0 + alpha,
                -2.0 * c,
                1.0 - alpha,
            ),
            Shape::Hp => (
                (1.0 + c) / 2.0,
                -(1.0 + c),
                (1.0 + c) / 2.0,
                1.0 + alpha,
                -2.0 * c,
                1.0 - alpha,
            ),
            Shape::Peak => (
                1.0 + alpha * a,
                -2.0 * c,
                1.0 - alpha * a,
                1.0 + alpha / a,
                -2.0 * c,
                1.0 - alpha / a,
            ),
            Shape::HighShelf => {
                let sq = 2.0 * a.sqrt() * alpha;
                (
                    a * (a + 1.0 + (a - 1.0) * c + sq),
                    -2.0 * a * (a - 1.0 + (a + 1.0) * c),
                    a * (a + 1.0 + (a - 1.0) * c - sq),
                    a + 1.0 - (a - 1.0) * c + sq,
                    2.0 * (a - 1.0 - (a + 1.0) * c),
                    a + 1.0 - (a - 1.0) * c - sq,
                )
            }
        };
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    fn run(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}

// --- The tone stack: solve the circuit, fit H(s), make a digital filter ---

/// The stack's output for 1 V in at s = jw (`stackResponse`): node
/// voltages by complex Gaussian elimination. Nodes: 0 treble pot top, 1
/// wiper (output), 2 treble pot bottom / bass top, 3 slope node, 4 bass
/// bottom / mid top.
pub fn stack_response(st: &Stack, t: f64, l: f64, m: f64, w: f64) -> (f64, f64) {
    const N: usize = 5;
    const RMIN: f64 = 50.0;
    // Each row: the admittances (re, im per node), then the current in.
    let mut a = [[0.0f64; 2 * N + 2]; N];
    let add_y =
        |a: &mut [[f64; 2 * N + 2]; N], x: Option<usize>, y: Option<usize>, yr: f64, yi: f64| {
            if let Some(x) = x {
                a[x][2 * x] += yr;
                a[x][2 * x + 1] += yi;
            }
            if let Some(y) = y {
                a[y][2 * y] += yr;
                a[y][2 * y + 1] += yi;
            }
            if let (Some(x), Some(y)) = (x, y) {
                a[x][2 * y] -= yr;
                a[x][2 * y + 1] -= yi;
                a[y][2 * x] -= yr;
                a[y][2 * x + 1] -= yi;
            }
        };
    // From the input (1 V): current into node x.
    let from_in = |a: &mut [[f64; 2 * N + 2]; N], x: usize, yr: f64, yi: f64| {
        a[x][2 * x] += yr;
        a[x][2 * x + 1] += yi;
        a[x][2 * N] += yr;
        a[x][2 * N + 1] += yi;
    };
    let r = |a: &mut [[f64; 2 * N + 2]; N], x: Option<usize>, y: Option<usize>, ohm: f64| {
        add_y(a, x, y, 1.0 / ohm.max(RMIN), 0.0)
    };
    let c = |a: &mut [[f64; 2 * N + 2]; N], x: Option<usize>, y: Option<usize>, farad: f64| {
        add_y(a, x, y, 0.0, w * farad)
    };
    from_in(&mut a, 0, 0.0, w * st.c1); // treble cap
    r(&mut a, Some(0), Some(1), (1.0 - t) * st.r1); // treble pot, top to wiper
    r(&mut a, Some(1), Some(2), t * st.r1); // wiper to bottom
    from_in(&mut a, 3, 1.0 / st.r4, 0.0); // slope resistor
    c(&mut a, Some(3), Some(2), st.c2); // bass cap
    c(&mut a, Some(3), Some(4), st.c3); // mid cap
    r(&mut a, Some(2), Some(4), l * st.r2); // bass pot
    r(&mut a, Some(4), None, m * st.r3); // mid pot to ground
    r(&mut a, Some(1), None, 1e6); // the next stage's grid resistor
    for col in 0..N {
        let mut p = col;
        let mut best = 0.0;
        for (row, line) in a.iter().enumerate().skip(col) {
            let v = line[2 * col].hypot(line[2 * col + 1]);
            if v > best {
                best = v;
                p = row;
            }
        }
        a.swap(col, p);
        let pivot = a[col];
        let (pr, pi) = (pivot[2 * col], pivot[2 * col + 1]);
        let d = pr * pr + pi * pi;
        for (row, line) in a.iter_mut().enumerate() {
            if row == col {
                continue;
            }
            let fr = (line[2 * col] * pr + line[2 * col + 1] * pi) / d;
            let fi = (line[2 * col + 1] * pr - line[2 * col] * pi) / d;
            for k in 0..=N {
                let (xr, xi) = (pivot[2 * k], pivot[2 * k + 1]);
                line[2 * k] -= fr * xr - fi * xi;
                line[2 * k + 1] -= fr * xi + fi * xr;
            }
        }
    }
    let (pr, pi) = (a[1][2], a[1][3]);
    let d = pr * pr + pi * pi;
    let (br, bi) = (a[1][2 * N], a[1][2 * N + 1]);
    ((br * pr + bi * pi) / d, (bi * pr - br * pi) / d)
}

/// H(s) = (b1 s + b2 s^2 + b3 s^3) / (1 + a1 s + a2 s^2 + a3 s^3), fitted
/// to the circuit (`fitStack`: least squares, s scaled by w0 so the system
/// is well conditioned).
fn fit_stack(st: &Stack, t: f64, l: f64, m: f64) -> ([f64; 4], [f64; 4]) {
    const FREQS: [f64; 8] = [15.0, 40.0, 110.0, 300.0, 800.0, 2000.0, 5000.0, 12000.0];
    const NN: usize = 6;
    let w0 = 2.0 * PI * 1000.0;
    let mut rows = [[0.0f64; NN]; 2 * FREQS.len()];
    let mut rhs = [0.0f64; 2 * FREQS.len()];
    for (f_i, f) in FREQS.iter().enumerate() {
        let w = 2.0 * PI * f;
        let (hr, hi) = stack_response(st, t, l, m, w);
        // s' = j w/w0; s'^1 = j v, s'^2 = -v^2, s'^3 = -j v^3.
        let v = w / w0;
        let s = [[0.0, v], [-v * v, 0.0], [0.0, -v * v * v]];
        let (re, im) = (&mut [0.0; NN], &mut [0.0; NN]);
        for k in 0..3 {
            re[k] = s[k][0];
            im[k] = s[k][1];
        }
        for k in 0..3 {
            let hsr = hr * s[k][0] - hi * s[k][1];
            let hsi = hr * s[k][1] + hi * s[k][0];
            re[3 + k] = -hsr;
            im[3 + k] = -hsi;
        }
        rows[2 * f_i] = *re;
        rows[2 * f_i + 1] = *im;
        rhs[2 * f_i] = hr;
        rhs[2 * f_i + 1] = hi;
    }
    // Normal equations.
    let mut mm = [[0.0f64; NN + 1]; NN];
    for (row, r) in rows.iter().zip(rhs) {
        for i in 0..NN {
            for j in 0..NN {
                mm[i][j] += row[i] * row[j];
            }
            mm[i][NN] += row[i] * r;
        }
    }
    for c in 0..NN {
        let mut p = c;
        for r in c + 1..NN {
            if mm[r][c].abs() > mm[p][c].abs() {
                p = r;
            }
        }
        mm.swap(c, p);
        let pivot = mm[c];
        for (r, line) in mm.iter_mut().enumerate() {
            if r == c {
                continue;
            }
            let f = line[c] / pivot[c];
            for k in c..=NN {
                line[k] -= f * pivot[k];
            }
        }
    }
    let u: [f64; NN] = std::array::from_fn(|i| mm[i][NN] / mm[i][i]);
    // Unscale: the coefficient of s^k is that of s'^k / w0^k.
    (
        [0.0, u[0] / w0, u[1] / (w0 * w0), u[2] / (w0 * w0 * w0)],
        [1.0, u[3] / w0, u[4] / (w0 * w0), u[5] / (w0 * w0 * w0)],
    )
}

/// Bilinear transform of a third-order H(s) at sample rate fs
/// (`bilinear3`).
fn bilinear3(b: &[f64; 4], a: &[f64; 4], fs: f64) -> ([f64; 4], [f64; 4]) {
    let kk = 2.0 * fs;
    // s^k -> K^k (1 - z^-1)^k (1 + z^-1)^(3-k)
    // (No allocation: this runs on the audio thread when a knob moves.)
    let poly = |k: usize| {
        let (mut p, mut len) = ([1.0, 0.0, 0.0, 0.0], 1);
        let mut mul = |q: [f64; 2]| {
            let mut r = [0.0f64; 4];
            for i in 0..len {
                r[i] += p[i] * q[0];
                r[i + 1] += p[i] * q[1];
            }
            p = r;
            len += 1;
        };
        for _ in 0..k {
            mul([1.0, -1.0]);
        }
        for _ in k..3 {
            mul([1.0, 1.0]);
        }
        let scale = kk.powf(k as f64);
        p.map(|c| c * scale)
    };
    let (mut bb, mut aa) = ([0.0f64; 4], [0.0f64; 4]);
    for k in 0..=3 {
        let p = poly(k);
        for i in 0..4 {
            bb[i] += b[k] * p[i];
            aa[i] += a[k] * p[i];
        }
    }
    (bb.map(|v| v / aa[0]), aa.map(|v| v / aa[0]))
}

/// The oversampling filters' taps (`designFir`): a Blackman-windowed sinc.
fn design_fir() -> [f64; TAPS] {
    let mut h = [0.0f64; TAPS];
    let fc = 0.45 / OS as f64;
    let mid = (TAPS as f64 - 1.0) / 2.0;
    let mut sum = 0.0;
    for (i, tap) in h.iter_mut().enumerate() {
        let x = i as f64 - mid;
        let sinc = if x == 0.0 {
            2.0 * fc
        } else {
            (2.0 * PI * fc * x).sin() / (PI * x)
        };
        let n = TAPS as f64 - 1.0;
        let w = 0.42 - 0.5 * ((2.0 * PI * i as f64) / n).cos()
            + 0.08 * ((4.0 * PI * i as f64) / n).cos();
        *tap = sinc * w;
        sum += *tap;
    }
    for tap in &mut h {
        *tap /= sum;
    }
    h
}

/// The triode: soft saturation on the positive side (grid conduction), a
/// softer, later limit on the cutoff side.
fn triode(u: f64, asym: f64) -> f64 {
    if u >= 0.0 {
        u.tanh()
    } else {
        asym * (u / asym).tanh()
    }
}

#[derive(Clone, Copy, Default)]
struct Stage {
    shelf: OnePole,
    hp: OnePole,
    lp: OnePole,
    shift: f64,
    gain: f64,
    keep: f64,
}

/// The audio taper of the amp's pots.
fn taper(x: f64) -> f64 {
    (10f64.powf(2.0 * x) - 1.0) / 99.0
}

/// The kernel (`AmpKernel`), mono.
pub struct AmpKernel {
    fs: f64,
    s: AmpSettings,
    h: [f64; TAPS],
    up: [f64; 2 * TAPS / OS],
    up_pos: usize,
    down: [f64; 2 * TAPS],
    down_pos: usize,
    in_hp: OnePole,
    stages: [Stage; MAX_STAGES],
    bright: Biquad,
    stack_b: [f64; 4],
    stack_a: [f64; 4],
    stack_z: [f64; 3],
    /// What the stack was fitted for: the knobs and the parts.
    stack_key: Option<[f64; 10]>,
    presence: Biquad,
    depth: Biquad,
    ot_low: Biquad,
    ot_high: Biquad,
    dc: OnePole,
    env: f64,
    gain_pot: f64,
    master_gain: f64,
    out_gain: f64,
    sag_atk: f64,
    sag_rel: f64,
    shift_rate: f64,
}

impl AmpKernel {
    pub fn new(sample_rate: f64, settings: &AmpSettings) -> Self {
        let mut stages = [Stage::default(); MAX_STAGES];
        stages.iter_mut().for_each(|s| s.keep = 1.0);
        let mut k = Self {
            fs: sample_rate * OS as f64,
            s: *settings,
            h: design_fir(),
            up: [0.0; 2 * TAPS / OS],
            up_pos: 0,
            down: [0.0; 2 * TAPS],
            down_pos: 0,
            in_hp: OnePole::default(),
            stages,
            bright: Biquad::default(),
            stack_b: [0.0; 4],
            stack_a: [1.0, 0.0, 0.0, 0.0],
            stack_z: [0.0; 3],
            stack_key: None,
            presence: Biquad::default(),
            depth: Biquad::default(),
            ot_low: Biquad::default(),
            ot_high: Biquad::default(),
            dc: OnePole::default(),
            env: 0.0,
            gain_pot: 0.0,
            master_gain: 0.0,
            out_gain: 1.0,
            sag_atk: 0.0,
            sag_rel: 0.0,
            shift_rate: 0.0,
        };
        k.set(settings);
        k
    }

    /// Takes new settings (on the audio thread when the tone stack's knobs
    /// haven't moved; refitting the stack takes a few microseconds more).
    pub fn set(&mut self, s: &AmpSettings) {
        self.s = *s;
        let fs = self.fs;
        self.in_hp.lowpass(s.input_hz, fs);
        for i in 0..s.stages.min(MAX_STAGES) {
            let st = &mut self.stages[i];
            st.gain = s.stage_gains[i];
            st.keep = s.shelf_keep[i];
            st.shelf.lowpass(s.shelf_hz[i], fs);
            st.hp.lowpass(s.coupling_hz[i], fs);
            st.lp.lowpass(s.miller_hz[i], fs);
        }
        // Gain pot: audio taper.
        self.gain_pot = (10f64.powf(2.0 * s.gain) - 1.0) / 99.0;
        self.bright
            .set(Shape::HighShelf, 2500.0, 0.6, s.bright * (1.0 - s.gain), fs);
        let p = s.stack;
        let key = [
            s.treble, s.bass, s.mid, p.c1, p.c2, p.c3, p.r1, p.r2, p.r3, p.r4,
        ];
        if self.stack_key != Some(key) {
            self.stack_key = Some(key);
            let (b, a) = fit_stack(&p, s.treble, taper(s.bass), taper(s.mid));
            (self.stack_b, self.stack_a) = bilinear3(&b, &a, fs);
        }
        self.master_gain = ((10f64.powf(2.0 * s.master) - 1.0) / 99.0) * s.power_drive;
        self.presence.set(
            Shape::HighShelf,
            s.presence_hz,
            0.7,
            s.presence_db * s.presence,
            fs,
        );
        self.depth.set(Shape::Peak, s.depth_hz, 0.9, s.depth_db, fs);
        self.ot_low.set(Shape::Hp, s.low_hz, 0.6, 0.0, fs);
        self.ot_high.set(Shape::Lp, s.high_hz, 0.6, 0.0, fs);
        self.dc.lowpass(10.0, fs);
        self.out_gain = 10f64.powf(s.output / 20.0);
        // Sag: attack ~8 ms, release ~120 ms (at the oversampled rate).
        self.sag_atk = 1.0 - (-1.0 / (0.008 * fs)).exp();
        self.sag_rel = 1.0 - (-1.0 / (0.12 * fs)).exp();
        self.shift_rate = 1.0 - (-1.0 / (0.03 * fs)).exp();
    }

    /// One sample at the oversampled rate.
    fn tick(&mut self, mut x: f64) -> f64 {
        let s = self.s;
        x = self.in_hp.hp(x);
        let sag = 1.0 - 0.35 * s.sag * self.env;
        for i in 0..s.stages.min(MAX_STAGES) {
            let st = &mut self.stages[i];
            // Cathode bypass: less gain below the shelf frequency.
            let low = st.shelf.lp(x);
            x -= (1.0 - st.keep) * low;
            let mut u = x * st.gain * if i == 0 { 1.0 } else { sag };
            // The grid conducting on big swings shifts the bias (the stage
            // grabs).
            u -= st.shift;
            let y = triode(u, s.asymmetry) - triode(-st.shift, s.asymmetry);
            st.shift += self.shift_rate * (s.bias * (u - 0.6).max(0.0) - st.shift);
            let hp = st.hp.hp(-y);
            x = st.lp.lp(hp);
            if i == 0 {
                x = self.bright.run(x * self.gain_pot);
            }
        }
        // Cathode follower into the stack: a soft limit on large swings.
        x /= 1.0 + 0.15 * x.abs();
        // Tone stack (third order).
        let (tb, ta, z) = (self.stack_b, self.stack_a, &mut self.stack_z);
        let y = tb[0] * x + z[0];
        z[0] = tb[1] * x - ta[1] * y + z[1];
        z[1] = tb[2] * x - ta[2] * y + z[2];
        z[2] = tb[3] * x - ta[3] * y;
        x = y * s.stack_gain;
        // Power amp.
        let pre = self.presence.run(x * self.master_gain);
        x = self.depth.run(pre);
        let head = 1.0 - 0.3 * s.sag * self.env;
        x = (x * 0.8).tanh() / 0.8; // phase inverter
        x = head * (x / head).tanh(); // output stage
        let p = x * x;
        let rate = if p > self.env {
            self.sag_atk
        } else {
            self.sag_rel
        };
        self.env += rate * (p - self.env);
        let low = self.ot_low.run(x);
        x = self.ot_high.run(low);
        self.dc.hp(x) * self.out_gain
    }

    /// One block of mono `input` (none: silence) into `output`.
    pub fn process(&mut self, input: Option<&[f32]>, output: &mut [f32]) {
        let l = TAPS / OS;
        for (i, out) in output.iter_mut().enumerate() {
            let x = input.map_or(0.0, |b| b[i] as f64) * OS as f64;
            *out = self.sample(x, l);
        }
    }

    /// One base-rate sample (already scaled by the oversampling factor).
    fn sample(&mut self, x: f64, l: usize) -> f32 {
        // History buffers are written twice (at i and i + len), so each
        // filter reads one contiguous run without wrapping.
        self.up_pos = if self.up_pos == 0 {
            l - 1
        } else {
            self.up_pos - 1
        };
        self.up[self.up_pos] = x;
        self.up[self.up_pos + l] = x;
        for p in 0..OS {
            // Polyphase interpolation: phase p uses taps p, p + 4, p + 8...
            let mut v = 0.0;
            for k in 0..l {
                v += self.h[p + OS * k] * self.up[self.up_pos + k];
            }
            let y = self.tick(v);
            self.down_pos = if self.down_pos == 0 {
                TAPS - 1
            } else {
                self.down_pos - 1
            };
            self.down[self.down_pos] = y;
            self.down[self.down_pos + TAPS] = y;
        }
        let mut acc = 0.0;
        for k in 0..TAPS {
            acc += self.h[k] * self.down[self.down_pos + k];
        }
        acc as f32
    }
}

/// The effect as the browser plays it (`ampSim.ts`): the amp on the mix of
/// a stereo input (Web Audio's down-mix, 0.5 * (L + R)), feeding both
/// sides.
pub struct AmpEffect {
    kernel: AmpKernel,
}

impl AmpEffect {
    pub fn new(sample_rate: f64, settings: &AmpSettings) -> Self {
        Self {
            kernel: AmpKernel::new(sample_rate, settings),
        }
    }

    pub fn set(&mut self, settings: &AmpSettings) {
        self.kernel.set(settings);
    }

    /// Processes a stereo block in place.
    pub fn process_in_place(&mut self, left: &mut [f32], right: &mut [f32]) {
        let l = TAPS / OS;
        for (a, b) in left.iter_mut().zip(right.iter_mut()) {
            let mono = 0.5 * (*a + *b);
            let y = self.kernel.sample(mono as f64 * OS as f64, l);
            *a = y;
            *b = y;
        }
    }
}
