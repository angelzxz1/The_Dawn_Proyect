// Listening to what the studio plays: everything that reaches the speakers
// is tapped by an AudioWorklet, which finds each click (a burst after
// silence) to the sample and measures its pitch and loudness.

import type { Page } from "@playwright/test";

export interface Click {
  /** When it starts, in seconds of audio-context time. */
  time: number;
  /** Zero crossings in its first 10 ms - higher for a higher pitch. */
  crossings: number;
  /** Its loudest sample, 0 to 1. */
  peak: number;
}

interface TapWindow {
  __toSpeakers: AudioNode[];
  /** AudioNode.connect as it was. */
  __connect: (this: AudioNode, target: AudioNode) => AudioNode;
  __tap?: { context: AudioContext; clicks: Click[] };
}

/** Notes every node connected to the speakers. Call it before the page
 * loads. */
export async function wireSpeakers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as TapWindow;
    w.__toSpeakers = [];
    const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => AudioNode;
    w.__connect = connect;
    AudioNode.prototype.connect = function (this: AudioNode, target: AudioNode | AudioParam, ...rest: number[]) {
      if (target instanceof AudioDestinationNode && !w.__toSpeakers.includes(this)) w.__toSpeakers.push(this);
      return connect.call(this, target, ...rest);
    } as AudioNode["connect"];
  });
}

export interface Ear {
  /** The audio context's time now. */
  now(): Promise<number>;
  /** The clicks heard that start between two context times. */
  clicks(from: number, to?: number): Promise<Click[]>;
}

/** Starts listening, once the studio's audio is running. */
export async function listen(page: Page): Promise<Ear> {
  await page.evaluate(async () => {
    const w = window as unknown as TapWindow;
    // The studio's context is the running one with the most nodes playing.
    const byContext = new Map<BaseAudioContext, AudioNode[]>();
    for (const node of w.__toSpeakers) byContext.set(node.context, [...(byContext.get(node.context) ?? []), node]);
    const [context, nodes] = [...byContext].filter(([c]) => c.state === "running").sort((a, b) => b[1].length - a[1].length)[0];
    const code = `registerProcessor("test-click-tap", class extends AudioWorkletProcessor {
      constructor() { super(); this.quiet = 1e9; this.click = null; }
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (ch) for (let i = 0; i < ch.length; i++) {
          const x = ch[i], a = Math.abs(x);
          const c = this.click;
          if (c) {
            if (Math.sign(x) !== Math.sign(c.prev) && x !== 0) c.crossings++;
            c.prev = x;
            c.peak = Math.max(c.peak, a);
            if (++c.n >= sampleRate * 0.01) { this.port.postMessage({ frame: c.frame, crossings: c.crossings, peak: c.peak }); this.click = null; }
          }
          if (a > 0.04) {
            if (this.quiet > sampleRate * 0.05 && !this.click) this.click = { frame: currentFrame + i, crossings: 0, prev: x, peak: a, n: 0 };
            this.quiet = 0;
          } else this.quiet++;
        }
        return true;
      }
    });`;
    await context.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: "application/javascript" })));
    const tap = new AudioWorkletNode(context, "test-click-tap");
    // Kept running through a silent gain, so the tap adds nothing heard.
    const silent = context.createGain();
    silent.gain.value = 0;
    w.__connect.call(tap, silent);
    w.__connect.call(silent, context.destination);
    for (const node of nodes) w.__connect.call(node, tap);
    const clicks: Click[] = [];
    w.__tap = { context: context as AudioContext, clicks };
    tap.port.onmessage = (e) => clicks.push({ time: e.data.frame / context.sampleRate, crossings: e.data.crossings, peak: e.data.peak });
  });
  return {
    now: () => page.evaluate(() => (window as unknown as TapWindow).__tap!.context.currentTime),
    clicks: (from, to = Infinity) =>
      page.evaluate(([a, b]) => (window as unknown as TapWindow).__tap!.clicks.filter((c) => c.time >= a && c.time < b), [from, to] as const),
  };
}

/** The time between each click and the next. */
export function gaps(clicks: Click[]): number[] {
  return clicks.slice(1).map((c, i) => c.time - clicks[i].time);
}
