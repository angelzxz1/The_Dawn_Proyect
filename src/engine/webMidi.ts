export interface WebMidiNoteEvent {
  type: "noteon" | "noteoff";
  midi: number;
  velocity: number;
}

/** A MIDI Control Change message - controller 64 is the sustain pedal,
 * controller 1 is the mod wheel, but any controller number passes through
 * so a caller can react to others too. `value` is normalized 0..1. */
export interface WebMidiCCEvent {
  type: "cc";
  controller: number;
  value: number;
}

/** A MIDI pitch-bend message, normalized to -1 (full down) .. 1 (full up),
 * 0 at rest. */
export interface WebMidiPitchBendEvent {
  type: "pitchbend";
  value: number;
}

export type WebMidiEvent = WebMidiNoteEvent | WebMidiCCEvent | WebMidiPitchBendEvent;

export type WebMidiHandler = (event: WebMidiEvent) => void;

/**
 * Listens for note on/off, control change (e.g. the sustain pedal or mod
 * wheel), and pitch-bend messages from any connected MIDI input (e.g. a
 * hardware keyboard). Returns a cleanup function. No-ops silently in
 * browsers/environments without Web MIDI support.
 */
export function listenToWebMidi(handler: WebMidiHandler): () => void {
  if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) {
    return () => {};
  }

  let cancelled = false;
  const attached: MIDIInput[] = [];

  const onMessage = (event: MIDIMessageEvent) => {
    const data = event.data;
    if (!data || data.length < 3) return;
    const status = data[0];
    const data1 = data[1];
    const data2 = data[2];
    const command = status & 0xf0;
    if (command === 0x90 && data2 > 0) {
      handler({ type: "noteon", midi: data1, velocity: data2 / 127 });
    } else if (command === 0x80 || (command === 0x90 && data2 === 0)) {
      handler({ type: "noteoff", midi: data1, velocity: 0 });
    } else if (command === 0xb0) {
      handler({ type: "cc", controller: data1, value: data2 / 127 });
    } else if (command === 0xe0) {
      // 14-bit value: data1 = LSB, data2 = MSB, 8192 = center/rest.
      const raw = (data2 << 7) | data1;
      handler({ type: "pitchbend", value: Math.max(-1, Math.min(1, (raw - 8192) / 8192)) });
    }
  };

  const attach = (access: MIDIAccess) => {
    if (cancelled) return;
    access.inputs.forEach((input) => {
      input.onmidimessage = onMessage;
      attached.push(input);
    });
  };

  navigator
    .requestMIDIAccess()
    .then((access) => {
      attach(access);
      access.onstatechange = () => attach(access);
    })
    .catch(() => {
      // No MIDI devices / permission denied - the on-screen keyboard still works.
    });

  return () => {
    cancelled = true;
    attached.forEach((input) => {
      input.onmidimessage = null;
    });
  };
}
