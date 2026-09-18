export interface WebMidiNoteEvent {
  type: "noteon" | "noteoff";
  midi: number;
  velocity: number;
}

export type WebMidiHandler = (event: WebMidiNoteEvent) => void;

/**
 * Listens for note on/off messages from any connected MIDI input (e.g. a
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
    const note = data[1];
    const velocity = data[2];
    const command = status & 0xf0;
    if (command === 0x90 && velocity > 0) {
      handler({ type: "noteon", midi: note, velocity: velocity / 127 });
    } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
      handler({ type: "noteoff", midi: note, velocity: 0 });
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
