// A delay-line pitch shifter running as an AudioWorklet. Tone.PitchShift
// drives its delay lines with a scaled oscillator LFO whose speed formula
// doesn't produce the requested ratio - measured, it landed 20-86 cents off
// (a -12 shift came out nearly a semitone sharp). Here the delay ramps are
// computed exactly:
//
// Two read taps sweep across a window of recent input, half a window apart.
// Reading a delay that shrinks at rate (r - 1) plays the audio back r times
// faster (up); one that grows at (1 - r) plays it slower (down). Each tap
// jumps back when its sweep ends, so each is faded with a Hann window that
// is silent at the jump, and the two windows (half a cycle apart) always sum
// to 1. Reads use 4-point Hermite interpolation. Feedback returns the output
// into the delay line, so each pass is shifted again.
//
// The processor is kept as source text because it runs inside an
// AudioWorklet (pitchShifter.ts); the native engine's port
// (crates/dawn-engine/src/effects/pitch_shift.rs) is held to it by
// pitchShiftParity.ts.

export const PITCH_SHIFTER_NAME = "dawn-pitch-shifter-v1";
export const PITCH_SHIFTER_BUFFER = 65536; // ~1.4s at 44.1kHz, far above the longest window

export const PITCH_SHIFTER_SOURCE = `
class DawnPitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "ratio", defaultValue: 1, minValue: 0.1, maxValue: 8, automationRate: "k-rate" },
      { name: "window", defaultValue: 0.1, minValue: 0.005, maxValue: 0.5, automationRate: "k-rate" },
      { name: "feedback", defaultValue: 0, minValue: 0, maxValue: 0.95, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.mask = ${PITCH_SHIFTER_BUFFER} - 1;
    this.buffers = [new Float32Array(${PITCH_SHIFTER_BUFFER}), new Float32Array(${PITCH_SHIFTER_BUFFER})];
    this.last = [0, 0];
    this.write = 0;
    this.phase = 0;
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data === "dispose") this.alive = false;
    };
  }

  read(buf, pos) {
    const m = this.mask;
    const i = Math.floor(pos);
    const f = pos - i;
    const y0 = buf[(i - 1) & m];
    const y1 = buf[i & m];
    const y2 = buf[(i + 1) & m];
    const y3 = buf[(i + 2) & m];
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * f + c2) * f + c1) * f + y1;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] || [];
    const output = outputs[0];
    const ratio = parameters.ratio[0];
    const windowSamples = parameters.window[0] * sampleRate;
    const feedback = parameters.feedback[0];
    const up = ratio >= 1;
    const step = Math.abs(1 - ratio) / windowSamples;
    const frames = output[0].length;

    for (let i = 0; i < frames; i++) {
      const pA = this.phase;
      const pB = pA < 0.5 ? pA + 0.5 : pA - 0.5;
      const dA = (up ? 1 - pA : pA) * windowSamples;
      const dB = (up ? 1 - pB : pB) * windowSamples;
      const sA = Math.sin(Math.PI * pA);
      const sB = Math.sin(Math.PI * pB);
      const gA = sA * sA;
      const gB = sB * sB;
      for (let ch = 0; ch < 2; ch++) {
        const src = input[ch] || input[0];
        const buf = this.buffers[ch];
        buf[this.write] = (src ? src[i] : 0) + feedback * this.last[ch];
        // 2 samples of headroom so the Hermite read never reaches unwritten
        // samples.
        const y = gA * this.read(buf, this.write - dA - 2) + gB * this.read(buf, this.write - dB - 2);
        this.last[ch] = y;
        if (output[ch]) output[ch][i] = y;
      }
      this.write = (this.write + 1) & this.mask;
      this.phase += step;
      if (this.phase >= 1) this.phase -= 1;
    }
    return this.alive;
  }
}
registerProcessor("${PITCH_SHIFTER_NAME}", DawnPitchShifter);
`;
