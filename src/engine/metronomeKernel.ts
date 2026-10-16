// The metronome's kernel: where the clicks fall (the beat grid, the tempo
// map, the loop, the count-in, the accents) and the click sounds
// themselves. It runs on the audio thread, in an AudioWorklet
// (metronome.ts), and places every click at its exact sample - so nothing
// the page does can delay or drop one. Kept as source text like the
// effects' kernels; the tests run the same text.

export const METRONOME_KERNEL_SOURCE = `
const METRONOME_EPS = 1e-6;

// The tempo map's stretches of constant tempo (tempoMap.ts), each from
// beat at transport time seconds on; before the first, its tempo goes on
// back (a count-in).
function segmentAtSeconds(segments, s) {
  let seg = segments[0];
  for (const x of segments) if (x.seconds <= s + METRONOME_EPS) seg = x;
  return seg;
}
function segmentAtBeat(segments, b) {
  let seg = segments[0];
  for (const x of segments) if (x.beat <= b + METRONOME_EPS) seg = x;
  return seg;
}
function beatAtSeconds(segments, s) {
  const seg = segmentAtSeconds(segments, s);
  return seg.beat + ((s - seg.seconds) * seg.bpm) / 60;
}
function secondsAtBeat(segments, b) {
  const seg = segmentAtBeat(segments, b);
  return seg.seconds + ((b - seg.beat) * 60) / seg.bpm;
}

// The beats (whole beat positions) that sound from transport position pos
// (s) over the next span seconds of playing, following the tempo map and
// the loop (s) like the transport does (reaching its end jumps back to its
// start). inclusive: a beat exactly at pos counts. elapsed is how many
// seconds of playing after pos each one sounds.
function clicksAhead(segments, pos, span, loop, inclusive = true) {
  const out = [];
  const looping = loop && loop.end - loop.start > METRONOME_EPS ? loop : null;
  let elapsed = 0;
  let p = pos;
  let include = inclusive;
  // Bounded so a loop with no whole beat inside can't spin forever.
  for (let guard = 0; guard < 10000; guard++) {
    const b = beatAtSeconds(segments, p);
    const k = include ? Math.ceil(b - METRONOME_EPS) : Math.floor(b + METRONOME_EPS) + 1;
    const t = secondsAtBeat(segments, k);
    if (looping && t >= looping.end - METRONOME_EPS) {
      elapsed += Math.max(0, looping.end - p);
      if (elapsed > span + METRONOME_EPS) break;
      p = looping.start;
      include = true;
      continue;
    }
    elapsed += t - p;
    if (elapsed > span + METRONOME_EPS) break;
    out.push({ elapsed, beat: k });
    p = t;
    include = false;
  }
  return out;
}

// Whether a beat position starts a bar.
function isDownbeat(beat, beatsPerBar) {
  const n = Math.max(1, Math.round(beatsPerBar));
  return ((Math.round(beat) % n) + n) % n === 0;
}

// A short square-ish blip, band-limited so it doesn't alias.
function clickSound(sampleRate, frequency, gainDb) {
  const length = Math.round(0.07 * sampleRate);
  const data = new Float32Array(length);
  const gain = Math.pow(10, gainDb / 20);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let wave = 0;
    for (let h = 1; h <= 9 && h * frequency < sampleRate / 2; h += 2) wave += Math.sin(2 * Math.PI * h * frequency * t) / h;
    // 1 ms attack, then ~40 ms decay.
    const env = Math.min(1, t / 0.001) * Math.exp(-t / 0.012);
    data[i] = (4 / Math.PI) * wave * env * gain;
  }
  return data;
}

class MetronomeKernel {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    // The tempo map, in transport seconds (tempoMap.ts).
    this.segments = [{ beat: 0, seconds: 0, bpm: 120 }];
    this.beatsPerBar = 4;
    // The loop, in transport seconds.
    this.loop = null;
    // Clicks after the count-in sound only while this is on.
    this.enabled = false;
    // Where clicking continues from: transport position pos (s) at context
    // time time. Null when stopped.
    this.next = null;
    // Context time the transport starts at, and the transport position it
    // starts from; clicks before it are the count-in, which always sounds
    // (louder), at the tempo where playing starts.
    this.startTime = 0;
    this.startPos = 0;
    this.countIn = this.segments;
    // Clicks sounding: their samples, how far in, and when they started.
    this.voices = [];
    // Loud enough to cut through a mix with drums (the level setting moves
    // them both); the count-in a little louder still.
    this.sounds = {
      accent: clickSound(sampleRate, 1046.5, -6),
      beat: clickSound(sampleRate, 523.25, -6),
      countAccent: clickSound(sampleRate, 1046.5, -3),
      countBeat: clickSound(sampleRate, 523.25, -3),
    };
  }

  // A message from the page (metronome.ts).
  command(m) {
    switch (m.type) {
      case "start": {
        // Clicks from transport position pos at context time time, after
        // countInBeats beats of count-in at the tempo there, on its grid.
        this.voices = [];
        this.startTime = m.time;
        this.startPos = m.pos;
        const bpm = segmentAtSeconds(this.segments, m.pos).bpm;
        this.countIn = [{ beat: beatAtSeconds(this.segments, m.pos), seconds: m.pos, bpm }];
        const lead = (m.countInBeats * 60) / bpm;
        this.next = { time: m.time - lead, pos: m.pos - lead, inclusive: true };
        break;
      }
      case "stop":
        this.next = null;
        this.voices = [];
        break;
      case "resync":
        // After a jump, a tempo or a loop change: carry on from position
        // pos at time. Ignored during the count-in (nothing has moved yet).
        if (!this.next || m.time < this.startTime) break;
        this.voices = this.voices.filter((v) => v.time <= m.time);
        this.next = { time: m.time, pos: m.pos, inclusive: true };
        break;
      case "enabled":
        this.enabled = m.enabled;
        break;
      case "tempo":
        if (m.segments && m.segments.length) this.segments = m.segments;
        break;
      case "meter":
        this.beatsPerBar = m.beatsPerBar;
        break;
      case "loop":
        this.loop = m.loop;
        break;
    }
  }

  // Queues the clicks from where clicking is up to context time until (not
  // including it), on a grid and loop.
  schedule(time, until, segments, loop) {
    const next = this.next;
    for (const c of clicksAhead(segments, next.pos, until - next.time, loop, next.inclusive)) {
      const t = next.time + c.elapsed;
      if (t >= until - METRONOME_EPS) break;
      const countIn = t < this.startTime - METRONOME_EPS;
      // A click more than 5 ms late (a start that arrived late) is skipped.
      if (t >= time - 0.005 && (countIn || this.enabled)) {
        const accent = isDownbeat(c.beat, this.beatsPerBar);
        const s = this.sounds;
        const data = countIn ? (accent ? s.countAccent : s.countBeat) : accent ? s.accent : s.beat;
        this.voices.push({ data, index: 0, offset: Math.max(0, Math.round((t - time) * this.sampleRate)), time: t });
      }
      this.next = { time: t, pos: secondsAtBeat(segments, c.beat), inclusive: false };
    }
  }

  // Writes this block's clicks into out (out.length frames from context
  // time time), replacing what was there.
  render(out, time) {
    out.fill(0);
    const n = out.length;
    const end = time + n / this.sampleRate;
    // The count-in, up to the start: it doesn't loop, and keeps the tempo
    // where playing starts. Then the song's beats from there on.
    if (this.next && this.next.time < this.startTime - METRONOME_EPS && end > this.next.time) {
      this.schedule(time, Math.min(end, this.startTime), this.countIn, null);
      if (end >= this.startTime) this.next = { time: this.startTime, pos: this.startPos, inclusive: true };
    }
    if (this.next && this.next.time >= this.startTime - METRONOME_EPS && end > this.next.time) {
      this.schedule(time, end, this.segments, this.loop);
    }
    this.voices = this.voices.filter((v) => {
      if (v.offset >= n) {
        v.offset -= n;
        return true;
      }
      for (let i = v.offset; i < n && v.index < v.data.length; i++) out[i] += v.data[v.index++];
      v.offset = 0;
      return v.index < v.data.length;
    });
  }
}
`;
