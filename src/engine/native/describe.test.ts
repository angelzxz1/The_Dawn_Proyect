import { describe, expect, it } from "vitest";
import { describeSong, unsupported } from "./describe";
import type { ProjectState } from "../../project/project";
import type { AudioClipInstance, ChannelConfig, ChannelType, MidiClipInstance } from "../../project/types";

const track = (id: string, type: ChannelType, extra: Partial<ChannelConfig> = {}): ChannelConfig => ({
  id,
  name: id,
  volume: 0,
  pan: 0,
  colorIndex: 0,
  type,
  instrument: type === "midi" ? "piano" : null,
  muted: false,
  solo: false,
  armed: false,
  ...extra,
});

const audioClip = (id: string, extra: Partial<AudioClipInstance> = {}): AudioClipInstance => ({
  id,
  kind: "audio",
  offset: 1,
  length: 2,
  url: `blob:${id}`,
  fileName: `${id}.wav`,
  durationSeconds: 4,
  peaks: [],
  sourceOffset: 0.5,
  fadeIn: 0.1,
  fadeOut: 0.2,
  gainDb: -3,
  loopLength: 1,
  ...extra,
});

const midiClip: MidiClipInstance = {
  id: "m1",
  kind: "midi",
  offset: 0,
  length: 2,
  notes: [{ note: "C4", time: 0, duration: 0.5, velocity: 0.8 }],
  loopLength: null,
};

function project(): ProjectState {
  return {
    channels: [
      track("drums", "audio", { volume: -6, pan: 0.5, sends: { verb: -12, gone: 0 } }),
      track("group", "group"),
      track("gtr", "audio", { groupId: "group" }),
      track("keys", "midi"),
    ],
    clipsByChannel: { drums: [audioClip("a")], gtr: [audioClip("b", { warp: { mode: "stretch", bpm: 100, markers: [] } })], keys: [midiClip] },
    takesByChannel: {},
    channelEffects: {},
    buses: [{ id: "verb", name: "Reverb", colorIndex: 0 }],
    busEffects: {},
    bpm: 120,
    tempoChanges: [{ beat: 8, bpm: 90 }],
    timeSignature: { numerator: 3, denominator: 4 },
    masterVolume: -2,
    masterPan: 0,
    masterName: "Master",
    masterEffects: [],
  };
}

const session = { limiterDb: -1, beatsPerBar: 3 };
const idOf = (clip: AudioClipInstance) => (clip.warp ? `warp:${clip.id}` : clip.url);

describe("the song for the native engine", () => {
  it("has every track's level, pan, sends to buses that exist, and audio clips", () => {
    const song = describeSong(project(), session, idOf);
    expect(song.tracks.map((t) => t.id)).toEqual(["drums", "group", "gtr", "keys"]);
    const drums = song.tracks[0];
    expect(drums).toMatchObject({ volumeDb: -6, pan: 0.5, audible: true, output: null, sends: [{ bus: "verb", db: -12 }] });
    expect(drums.clips).toEqual([
      { audio: "blob:a", offset: 1, length: 2, sourceOffset: 0.5, loopLength: 1, gainDb: -3, fadeIn: 0.1, fadeOut: 0.2 },
    ]);
    // MIDI clips aren't played (yet).
    expect(song.tracks[3].clips).toEqual([]);
    expect(song.buses).toEqual([{ id: "verb" }]);
  });

  it("sends a group's members into the group", () => {
    const song = describeSong(project(), session, idOf);
    expect(song.tracks[2].output).toBe("group");
    expect(song.tracks[1].output).toBeNull();
  });

  it("plays a warped clip from its rendering: from the start, not looped", () => {
    const clip = describeSong(project(), session, idOf).tracks[2].clips[0];
    expect(clip).toMatchObject({ audio: "warp:b", sourceOffset: 0, loopLength: null, length: 2 });
  });

  it("works out who's heard with mute and solo", () => {
    const p = project();
    p.channels = p.channels.map((c) => (c.id === "gtr" ? { ...c, solo: true } : c.id === "keys" ? { ...c, muted: true } : c));
    const heard = describeSong(p, session, idOf).tracks.map((t) => [t.id, t.audible]);
    // Soloing the guitar keeps its group (its path to the master) heard.
    expect(heard).toEqual([
      ["drums", false],
      ["group", true],
      ["gtr", true],
      ["keys", false],
    ]);
  });

  it("has the master, the tempo map and the bar", () => {
    const song = describeSong(project(), session, idOf);
    expect(song.master).toEqual({ volumeDb: -2, pan: 0, limiterDb: -1 });
    expect(song.tempo).toEqual([
      { beat: 0, seconds: 0, bpm: 120 },
      { beat: 8, seconds: 4, bpm: 90 },
    ]);
    expect(song.beatsPerBar).toBe(3);
  });
});

describe("what the native engine doesn't play yet", () => {
  it("names the tracks with instruments, effects or automation, and a master with effects", () => {
    const p = project();
    p.channelEffects = { drums: [{ id: "fx1", type: "compressor", params: {} }], gtr: [{ id: "fx2", type: "eq3", params: {}, bypass: true }] };
    p.masterEffects = [{ id: "fx3", type: "eq3", params: {} }];
    p.channels = p.channels.map((c) =>
      c.id === "gtr" ? { ...c, automationLanes: [{ id: "l", target: { kind: "volume" }, points: [{ id: "p", time: 0, value: 0 }] }] } : c
    );
    expect(unsupported(p)).toEqual({ instruments: ["keys"], effects: ["drums", "Master"], automation: ["gtr"] });
  });

  it("is nothing for audio tracks played dry", () => {
    const p = project();
    p.clipsByChannel = { drums: [audioClip("a")] };
    expect(unsupported(p)).toEqual({ instruments: [], effects: [], automation: [] });
  });
});
