// The Credits thank the members by name (supporters.json): Producers first
// and larger, then Supporters, with an invitation while a list is empty.

import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CreditsTabBody } from "./AboutWindow";

const members = vi.hoisted(() => ({ producers: [] as string[], supporters: [] as string[] }));
vi.mock("@/content/supporters", () => ({ MEMBERS: members }));

test("the members' names, Producers first", async () => {
  members.producers = ["Ana Torres", "Beat Lab"];
  members.supporters = ["Kim"];
  const screen = render(<CreditsTabBody />);
  const producers = screen.getByRole("region", { name: "Producers" });
  expect(producers.getByRole("listitem").elements()).toHaveLength(2);
  await expect.element(producers.getByText("Ana Torres")).toBeVisible();
  await expect.element(screen.getByRole("region", { name: "Supporters" }).getByText("Kim")).toBeVisible();
  const regions = screen.container.querySelectorAll("section[aria-label]");
  expect([...regions].slice(0, 2).map((r) => r.getAttribute("aria-label"))).toEqual(["Producers", "Supporters"]);
});

test("an empty list invites people to join", async () => {
  members.producers = [];
  members.supporters = [];
  const screen = render(<CreditsTabBody />);
  const producers = screen.getByRole("region", { name: "Producers" });
  await expect.element(producers.getByText(/Producer members are thanked here/)).toBeVisible();
  await expect.element(producers.getByRole("link", { name: "See the memberships" })).toHaveAttribute("href", "/support#tiers");
});
