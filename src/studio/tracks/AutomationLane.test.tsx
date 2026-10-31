// An automation lane on its own: what each gesture hands onChange. At 100
// px a second, 100 px tall for values 0 to 1, with a grid of half seconds.

import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { ComponentProps } from "react";
import { AutomationLane } from "./AutomationLane";
import { TRACK_COLOR_PALETTE } from "@/project/colors";
import { fixedGrid, makeTempoMap } from "@/project/tempoMap";
import { interpolateAutomation } from "@/engine/automation";
import type { AutomationPoint } from "@/project/types";
import { drag, pointIn } from "@/test/pointer";

const PX = 100;
const H = 100;

function renderLane(props: Partial<ComponentProps<typeof AutomationLane>> = {}) {
  const onChange = vi.fn<(points: AutomationPoint[]) => void>();
  const onDragStart = vi.fn();
  const screen = render(
    <AutomationLane
      points={[]}
      valueMin={0}
      valueMax={1}
      currentValue={0.5}
      totalSeconds={8}
      pxPerSecond={PX}
      tempo={makeTempoMap(120)}
      beatsPerBar={4}
      height={H}
      color={TRACK_COLOR_PALETTE[0]}
      grid={fixedGrid(0.5)}
      onChange={onChange}
      onDragStart={onDragStart}
      {...props}
    />
  );
  const lane = screen.container.querySelector<HTMLElement>("[data-automation-lane]")!;
  /** Where a time and value are on the lane. */
  const at = (time: number, value: number) => pointIn(lane, time * PX, H - value * H);
  const points = () => (onChange.mock.lastCall?.[0] ?? []).map((p) => [p.time, Number(p.value.toFixed(3)), p.curve ?? 0]);
  return { lane, at, onChange, onDragStart, points, last: () => onChange.mock.lastCall?.[0] ?? [] };
}

const pts = (...pairs: [number, number][]): AutomationPoint[] => pairs.map(([time, value], i) => ({ id: `p${i}`, time, value }));

test("a click adds a point, kept in time order", () => {
  const l = renderLane({ points: pts([2, 0.5]) });
  const p = l.at(1, 0.25);
  l.lane.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: p.x, clientY: p.y, button: 0, pointerId: 1 }));
  expect(l.points()).toEqual([
    [1, 0.25, 0],
    [2, 0.5, 0],
  ]);
});

test("Shift-drag draws a straight line on the grid over what was there", () => {
  const l = renderLane({ points: pts([0, 0], [2, 1], [5, 0]) });
  const from = l.at(1.1, 0.2);
  const to = l.at(3.9, 0.8);
  drag(l.lane, from, to, { shiftKey: true });
  expect(l.points()).toEqual([
    [0, 0, 0],
    [1, 0.2, 0],
    [4, 0.8, 0],
    [5, 0, 0],
  ]);
  expect(l.onDragStart).toHaveBeenCalledTimes(1);
});

test("Alt-drag bends the segment under the pointer", () => {
  const l = renderLane({ points: pts([0, 0], [4, 1]) });
  drag(l.lane, l.at(2, 0.5), l.at(2, 0.2), { altKey: true });
  const [first] = l.last();
  expect(first.curve).toBeGreaterThan(0);
  expect(interpolateAutomation(l.last(), 2)).toBeCloseTo(0.2, 2);
});

test("the draw tool draws freehand, a point per grid line", () => {
  const l = renderLane({ tool: "draw", points: pts([0, 1], [8, 1]) });
  drag(l.lane, l.at(1, 0.5), l.at(3, 0.5), { steps: 20 });
  expect(l.points()).toEqual([
    [0, 1, 0],
    [1, 0.5, 0],
    [1.5, 0.5, 0],
    [2, 0.5, 0],
    [2.5, 0.5, 0],
    [3, 0.5, 0],
    [8, 1, 0],
  ]);
});

test("the erase tool deletes the points it passes over", () => {
  const l = renderLane({ tool: "erase", points: pts([0, 0], [1, 0.5], [2, 0.5], [3, 1]) });
  drag(l.lane, l.at(0.8, 0.9), l.at(2.2, 0.1));
  expect(l.points()).toEqual([
    [0, 0, 0],
    [3, 1, 0],
  ]);
});
