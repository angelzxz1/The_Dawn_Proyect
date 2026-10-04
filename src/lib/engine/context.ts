// The app's audio context: 48 kHz (see below) and a short lookAhead, set
// up once when the engine module first loads.

import * as Tone from "tone";
import { AudioContext as StdAudioContext } from "standardized-audio-context";

/** The rate the app asks the browser to run audio at (see below). */
export const PREFERRED_SAMPLE_RATE = 48000;

// Every live-triggered note (a keyboard/MIDI-controller key, a drum pad)
// goes out via Tone.now(), which Tone.js defines as `currentTime +
// context.lookAhead` - a deliberate scheduling safety margin meant for
// Transport-driven playback, not live input. Its 100ms default was the
// actual source of the noticeable keypress-to-sound delay (not a bug in
// how notes are triggered here - they already go out immediately, via
// Tone.now(), with no debounce/setTimeout in the way). Trimming it to
// 10ms keeps enough margin that sequenced clip/automation playback still
// schedules safely, while cutting live playing latency by ~90ms.
if (typeof window !== "undefined") {
  // Amp models (NAM) are trained at 48 kHz and the engine runs them at the
  // context's rate without resampling - at 44.1 kHz a model's tone shifts
  // audibly (several dB in some bands). So the app runs at 48 kHz and the
  // browser resamples to/from the audio device. Firefox is the exception:
  // it refuses to connect a microphone whose rate differs from the
  // context's, which would break input monitoring, so there the context
  // keeps the device's rate (the amp plugin says when that doesn't match).
  if (!/Firefox\//.test(navigator.userAgent)) {
    try {
      Tone.setContext(
        new Tone.Context({
          // Tone types this as the native class but itself wraps contexts
          // in standardized-audio-context, as here.
          context: new StdAudioContext({
            sampleRate: PREFERRED_SAMPLE_RATE,
            latencyHint: "interactive",
          }) as unknown as AudioContext,
          latencyHint: "interactive",
        })
      );
    } catch {
      // A browser that can't run at that rate keeps its default context.
    }
  }
  Tone.getContext().lookAhead = 0.01;
}
