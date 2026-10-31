// The count-in in the transport bar, as the engine reports it.

import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CountIn } from "./CountIn";

const engine = vi.hoisted(() => ({ left: null as number | null }));
vi.mock("@/engine/audioEngine", () => ({ audioEngine: { getCountInLeft: () => engine.left } }));

test("shows the beats left while counting in, and nothing otherwise", async () => {
  const screen = render(<CountIn beatsPerBar={4} />);
  expect(screen.container.textContent).toBe("");
  engine.left = 4;
  await expect.element(screen.getByRole("timer", { name: "Count-in: 4 beats to go" })).toBeVisible();
  engine.left = 1;
  await expect.element(screen.getByRole("timer", { name: "Count-in: 1 beat to go" })).toBeVisible();
  engine.left = null;
  await expect.element(screen.getByRole("timer")).not.toBeInTheDocument();
});
