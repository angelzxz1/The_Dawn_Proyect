// The app's audio context: 48 kHz, and how far ahead the transport
// schedules (see below), set up once when the engine module first loads.
//
// Tone.js types its context as the browser's own AudioContext, but wraps
// it in standardized-audio-context. The two places that cross between
// them are here, so nothing else needs a forced type conversion.

import * as Tone from "tone";
import { AudioContext as StdAudioContext } from "standardized-audio-context";

/** The rate the app asks the browser to run audio at (see below). */
export const PREFERRED_SAMPLE_RATE = 48000;

/** How far ahead (s) the transport schedules clips' notes and automation.
 * Its clock wakes every SCHEDULE_TICK on the page's main thread and queues
 * what falls within this window, so a note is handed to the audio thread
 * 45-60 ms before it's due: the page can be busy that long (a redraw, a
 * project loading) without a note coming late. Live playing doesn't wait
 * for it - keys, pads and MIDI input play at the audio clock's current
 * time (Tone.immediate()) - but knob, fader and mute changes land this far
 * ahead (Tone's params change at Tone.now()). */
export const SCHEDULE_AHEAD = 0.06;
/** How often the transport's clock queues the next notes (s). */
const SCHEDULE_TICK = 0.015;

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
  // Setting lookAhead also sets the clock's tick (to half of it): set the
  // tick after.
  const context = Tone.getContext();
  if (context instanceof Tone.Context) {
    context.lookAhead = SCHEDULE_AHEAD;
    context.updateInterval = SCHEDULE_TICK;
  }
}

/** The browser's own context, under Tone's and standardized-audio-
 * context's wrappers (which don't pass outputLatency through). */
export function nativeAudioContext(): AudioContext | null {
  const raw = Tone.getContext().rawContext as unknown as { _nativeAudioContext?: AudioContext } & Partial<AudioContext>;
  return raw._nativeAudioContext ?? (typeof raw.outputLatency === "number" ? (raw as AudioContext) : null);
}
