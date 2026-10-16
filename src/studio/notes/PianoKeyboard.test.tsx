// The on-screen piano on its own: the chord readout names what the held
// keys make, in the scale's key (E Major while no scale is picked).

import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "@vitest/browser/context";
import { useState } from "react";
import { PianoKeyboard } from "./PianoKeyboard";
import type { ScaleSetting } from "@/project/scales";

const NO_SCALE: ScaleSetting = { root: "C", scale: "Major", enabled: false };

/** The piano, holding the notes it plays. */
function Keys({ scaleSetting = NO_SCALE }: { scaleSetting?: ScaleSetting }) {
  const [held, setHeld] = useState<Set<string>>(new Set());
  return (
    <PianoKeyboard
      activeNotes={held}
      onNoteOn={(note) => setHeld((prev) => new Set(prev).add(note))}
      onNoteOff={(note) =>
        setHeld((prev) => {
          const next = new Set(prev);
          next.delete(note);
          return next;
        })
      }
      scaleSetting={scaleSetting}
    />
  );
}

test("names the chord being held in E Major while no scale is picked", async () => {
  const screen = render(<Keys />);
  const readout = screen.getByTestId("chord-readout");
  await expect.element(readout).toHaveTextContent("Chords in E Major");

  expect(readout.element().querySelector("[data-chord-name]")).toBeNull();
  const shows = async (chord: string, degree: string, where: string) => {
    await expect.element(readout).toHaveTextContent(where);
    expect(readout.element().querySelector("[data-chord-name]")?.textContent).toBe(chord);
    expect(readout.element().querySelector("[data-chord-degree]")?.textContent).toBe(degree);
  };

  // E, G# and B from the Q row.
  await userEvent.keyboard("{e>}{6>}{u>}");
  await shows("E", "I", "in E Major");

  // G instead of G#: E minor, which isn't in the key.
  await userEvent.keyboard("{/6}{t>}");
  await shows("Em", "i", "outside E Major");

  await userEvent.keyboard("{/e}{/t}{/u}");
  await expect.element(readout).toHaveTextContent("Chords in E Major");
});

test("names chords in the scale picked", async () => {
  const screen = render(<Keys scaleSetting={{ root: "C", scale: "Major", enabled: true }} />);
  const readout = screen.getByTestId("chord-readout");
  // E, G, B: the third chord of C Major.
  await userEvent.keyboard("{e>}{t>}{u>}");
  await expect.element(readout).toHaveTextContent("in C Major");
  await expect.element(screen.getByText("Em", { exact: true })).toHaveAttribute("title", "E G B");
  await expect.element(screen.getByText("iii", { exact: true })).toBeVisible();
  await userEvent.keyboard("{/e}{/t}{/u}");
});
