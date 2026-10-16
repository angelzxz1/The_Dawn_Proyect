import { describe, expect, it } from "vitest";
import { makeTempoMap } from "./tempoMap";
import {
  cleanMarkers,
  fileBeatAt,
  followingWarp,
  partFrom,
  playedSource,
  playsAtOwnSpeed,
  quantizedWarp,
  reverseWarp,
  rewarp,
  sourceAt,
  sourceAtFileBeat,
  warpAtTempo,
  warpPieces,
  warpView,
  type WarpedClip,
} from "./warp";
import type { AudioClipInstance, AudioWarp } from "./types";

const AT_120 = makeTempoMap(120);
// 120 for two bars (to 4 s), then 60.
const SLOWER = makeTempoMap(120, [{ beat: 8, bpm: 60 }]);
const warp = (bpm: number, markers: AudioWarp["markers"] = []): AudioWarp => ({ mode: "stretch", bpm, markers });
const clip = (over: Partial<WarpedClip>): WarpedClip => ({ offset: 0, length: 4, sourceOffset: 0, loopLength: null, ...over });
const close = (a: number[][], b: number[][]) => a.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(b[i][j], 6)));
const rows = (c: WarpedClip, tempo = AT_120) => warpPieces(c, tempo).map((p) => [p.t0, p.t1, p.s0, p.s1]);

describe("file beats", () => {
  it("run at the file's tempo with no markers", () => {
    expect(fileBeatAt(warp(100), 3)).toBeCloseTo(5);
    expect(sourceAtFileBeat(warp(100), 5)).toBeCloseTo(3);
  });

  it("go evenly between markers, and on past the ends at the end stretches' speed", () => {
    const w = warp(120, [
      { source: 1, beat: 2 },
      { source: 2, beat: 3 },
      { source: 4, beat: 8 },
    ]);
    expect(fileBeatAt(w, 1.5)).toBeCloseTo(2.5);
    expect(fileBeatAt(w, 3)).toBeCloseTo(5.5);
    // Before the first: the first stretch's speed (a beat a second).
    expect(fileBeatAt(w, 0)).toBeCloseTo(1);
    // After the last: the last one's (2.5 beats a second).
    expect(fileBeatAt(w, 5)).toBeCloseTo(10.5);
    [0, 1.2, 3.3, 6].forEach((s) => expect(sourceAtFileBeat(w, fileBeatAt(w, s))).toBeCloseTo(s));
  });

  it("drops markers out of order either way", () => {
    expect(
      cleanMarkers([
        { source: 2, beat: 4 },
        { source: 1, beat: 2 },
        { source: 3, beat: 3 },
        { source: -1, beat: 0 },
      ])
    ).toEqual([
      { source: 1, beat: 2 },
      { source: 2, beat: 4 },
    ]);
  });
});

describe("warpPieces", () => {
  it("plays an unwarped clip at its own speed, a loop repeat by repeat", () => {
    close(rows(clip({ sourceOffset: 1 })), [[0, 4, 1, 5]]);
    close(rows(clip({ loopLength: 1.5 })), [
      [0, 1.5, 0, 1.5],
      [1.5, 3, 0, 1.5],
      [3, 4, 0, 1],
    ]);
  });

  it("plays a warped file at the song's tempo: 100 BPM in a 120 BPM song is faster", () => {
    close(rows(clip({ offset: 2, warp: warp(100) })), [[0, 4, 0, 4.8]]);
  });

  it("follows the song's tempo changes over the clip", () => {
    // From 2 s (beat 4) to 6 s (beat 10); the file is at 120.
    close(rows(clip({ offset: 2, warp: warp(120) }), SLOWER), [
      [0, 2, 0, 2],
      [2, 4, 2, 3],
    ]);
  });

  it("repeats a warped loop on the song's beats", () => {
    // A bar loop from beat 4: the second time round is in the slower part.
    const pieces = rows(clip({ offset: 2, length: 6, loopLength: 2, warp: warp(120) }), SLOWER);
    close(pieces, [
      [0, 2, 0, 2],
      [2, 6, 0, 2],
    ]);
  });
});

describe("sourceAt / playedSource / partFrom", () => {
  it("agree with the pieces", () => {
    const c = clip({ offset: 2, warp: warp(120) });
    expect(sourceAt(c, 5, SLOWER)).toBeCloseTo(2.5);
    expect(sourceAt(c, 1, SLOWER)).toBeCloseTo(-1);
    expect(playedSource(c, SLOWER)).toEqual({ start: 0, end: expect.closeTo(3) });
    expect(sourceAt(clip({ loopLength: 1.5 }), 2, AT_120)).toBeCloseTo(0.5);
    // Unwarped: what it plays of its file, once round when it loops.
    expect(playedSource(clip({ sourceOffset: 1 }), AT_120)).toEqual({ start: 1, end: 5 });
    expect(playedSource(clip({ sourceOffset: 1, loopLength: 1.5 }), AT_120)).toEqual({ start: 1, end: 2.5 });
  });

  it("starts a part on a repeat looping on, and inside one, once", () => {
    const c = clip({ offset: 2, length: 6, loopLength: 2, warp: warp(120) });
    expect(partFrom(c, 4, SLOWER)).toEqual({ sourceOffset: 0, loopLength: expect.closeTo(4) });
    expect(partFrom(c, 5, SLOWER)).toEqual({ sourceOffset: expect.closeTo(0.5), loopLength: null });
    expect(partFrom(clip({ loopLength: 1 }), 2, AT_120)).toEqual({ sourceOffset: 0, loopLength: 1 });
  });
});

describe("followingWarp / rewarp / warpAtTempo / reverseWarp", () => {
  it("warps a clip without changing how it sounds now, over tempo changes too", () => {
    const c = clip({ offset: 2, length: 4, sourceOffset: 1 });
    const warped = { ...c, warp: followingWarp(c, SLOWER) };
    expect(playsAtOwnSpeed(warpPieces(warped, SLOWER))).toBe(true);
    close(rows(warped, SLOWER).map((r) => [r[0], r[2]]), [
      [0, 1],
      [2, 3],
    ]);
    expect(followingWarp(c, AT_120)).toEqual({ mode: "stretch", bpm: 120, markers: [] });
  });

  it("keeps the part of the file a clip plays when its warp changes", () => {
    // A 100 BPM loop of 4.8 s in a 120 BPM song: at its own tempo it plays
    // in 4 s.
    const c = clip({ length: 4.8 });
    const atTempo = rewarp(c, warpAtTempo(followingWarp(c, AT_120), 100), AT_120);
    expect(atTempo.length).toBeCloseTo(4);
    expect(playedSource(atTempo, AT_120).end).toBeCloseTo(4.8);
    const unwarped = rewarp(atTempo, undefined, AT_120);
    expect(unwarped.warp).toBeUndefined();
    expect(unwarped.length).toBeCloseTo(4.8);
    const looped = rewarp(clip({ length: 4.8, loopLength: 2.4 }), warp(100), AT_120);
    expect([looped.loopLength, looped.length]).toEqual([expect.closeTo(2), expect.closeTo(4)]);
  });

  it("turns markers around with the file", () => {
    const w = warp(120, [
      { source: 1, beat: 2 },
      { source: 3, beat: 3 },
    ]);
    const back = reverseWarp(w, 4);
    // What was at 1 s is at 3 s, as many beats from the end.
    expect(fileBeatAt(back, 3)).toBeCloseTo(fileBeatAt(w, 4) - 2);
    expect(fileBeatAt(back, 1)).toBeCloseTo(fileBeatAt(w, 4) - 3);
    expect(reverseWarp(warp(90), 4)).toEqual(warp(90));
  });
});

describe("quantizedWarp", () => {
  it("puts each onset on the nearest grid line, the clip's ends where they are", () => {
    // A 4 s clip at the song's 120 (a beat is 0.5 s), hits a bit off the beat.
    const c = { ...clip({ offset: 2, length: 4 }), warp: warp(120) };
    const onsets = [0.53, 0.97, 1.6, 2.44];
    const q = { ...c, warp: quantizedWarp(c, onsets, AT_120, 1) };
    // Each lands on its beat (the clip starts at 2 s, on a beat).
    [0.5, 1, 1.5, 2.5].forEach((t, i) => expect(sourceAt(q, 2 + t, AT_120)).toBeCloseTo(onsets[i], 6));
    expect(sourceAt(q, 2, AT_120)).toBeCloseTo(0);
    expect(sourceAt(q, 6, AT_120)).toBeCloseTo(4);
    // Half way.
    const half = { ...c, warp: quantizedWarp(c, [0.6], AT_120, 1, 0.5) };
    expect(sourceAt(half, 2.55, AT_120)).toBeCloseTo(0.6, 6);
  });

  it("goes by the song's beats on the tempo map, and keeps what's warped already", () => {
    // From beat 4 (2 s) on SLOWER; the file at 120: what's at 2.9 s in it
    // (song beat 9.8, at 5.8 s) goes to beat 10 (6 s).
    const c = { ...clip({ offset: 2, length: 4 }), warp: warp(120) };
    const q = { ...c, warp: quantizedWarp(c, [2.9], SLOWER, 1) };
    expect(sourceAt(q, 6, SLOWER)).toBeCloseTo(2.9, 6);
  });

  it("shows where its markers are", () => {
    const c = { ...clip({ offset: 2, length: 4 }), warp: warp(120) };
    const q = { ...c, warp: quantizedWarp(c, [0.53, 0.97], AT_120, 1) } as AudioClipInstance;
    expect(warpView(q, AT_120)!.markers).toEqual([expect.closeTo(0.5), expect.closeTo(1)]);
  });
});
