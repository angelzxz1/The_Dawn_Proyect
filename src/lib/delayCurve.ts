// Builds the Delay window's tap visualization: a stylized (not literally
// accurate) plot of decaying echoes for the left and right channels over a
// fixed time window, driven by the actual delayTimeL/R, feedback, and wet
// params - shows the same shape of information a hardware delay's tap
// display would, without claiming DSP-accurate levels.

export const DELAY_GRAPH_WIDTH = 700;
export const DELAY_GRAPH_HEIGHT = 150;
const WINDOW_SECONDS = 2.2;
const MAX_TAPS_PER_CHANNEL = 24;
const MIN_VISIBLE_AMP = 0.015;

export interface DelayTick {
  x: number;
  /** Tick half-height in px, drawn out from the channel's own center line. */
  height: number;
  channel: "L" | "R";
}

function timeToX(seconds: number): number {
  return Math.min(DELAY_GRAPH_WIDTH, (seconds / WINDOW_SECONDS) * DELAY_GRAPH_WIDTH);
}

/** Builds one channel's repeat train: taps at every multiple of `delayTime`,
 * each `feedback` quieter than the last, until it decays below visibility
 * or runs past the visible window. */
function buildChannelTicks(
  delayTime: number,
  feedback: number,
  wet: number,
  channel: "L" | "R",
  laneHeight: number
): DelayTick[] {
  const ticks: DelayTick[] = [];
  let amp = wet;
  let t = delayTime;
  for (let i = 0; i < MAX_TAPS_PER_CHANNEL && t <= WINDOW_SECONDS && amp > MIN_VISIBLE_AMP; i++) {
    ticks.push({ x: timeToX(t), height: amp * laneHeight, channel });
    amp *= feedback;
    t += delayTime;
  }
  return ticks;
}

/** Ping-pong's single bouncing repeat train: each tap alternates channel,
 * and the *next* tap's spacing is the time of the channel it just bounced
 * into (matching how the DelayChain's cross-feedback is actually wired). */
function buildPingPongTicks(delayTimeL: number, delayTimeR: number, feedback: number, wet: number, laneHeight: number): DelayTick[] {
  const ticks: DelayTick[] = [];
  let amp = wet;
  let t = delayTimeL;
  let channel: "L" | "R" = "L";
  for (let i = 0; i < MAX_TAPS_PER_CHANNEL * 2 && t <= WINDOW_SECONDS && amp > MIN_VISIBLE_AMP; i++) {
    ticks.push({ x: timeToX(t), height: amp * laneHeight, channel });
    amp *= feedback;
    t += channel === "L" ? delayTimeR : delayTimeL;
    channel = channel === "L" ? "R" : "L";
  }
  return ticks;
}

export function buildDelayTicks(
  delayTimeL: number,
  delayTimeR: number,
  feedback: number,
  wet: number,
  pingPong: boolean
): DelayTick[] {
  const laneHeight = DELAY_GRAPH_HEIGHT * 0.42;
  if (pingPong) return buildPingPongTicks(delayTimeL, delayTimeR, feedback, wet, laneHeight);
  return [
    ...buildChannelTicks(delayTimeL, feedback, wet, "L", laneHeight),
    ...buildChannelTicks(delayTimeR, feedback, wet, "R", laneHeight),
  ];
}
