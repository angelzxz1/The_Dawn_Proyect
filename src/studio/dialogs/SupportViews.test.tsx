// Feedback goes on Dawn's Discord: the window that opens it, and the
// buttons, which only show once the site has a Discord invite.

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { FeedbackWindow, openFeedback, SupportSection } from "./SupportViews";

const discord = vi.hoisted(() => ({ url: "" }));
vi.mock("@/services/support", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/support")>();
  return {
    ...actual,
    communityLink: () => (discord.url ? { id: "discord", label: "Discord", url: discord.url, hint: "" } : null),
  };
});

beforeEach(() => {
  discord.url = "";
});

describe("with a Discord", () => {
  beforeEach(() => {
    discord.url = "https://discord.gg/dawn";
  });

  test("Feedback shows what to paste, copies it, and opens the Discord", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const screen = render(<FeedbackWindow />);
    openFeedback("test");
    const dialog = screen.getByRole("dialog", { name: "Feedback" });
    await expect.element(dialog).toBeVisible();
    // Dawn's version and the browser, to paste into the post.
    await expect.element(dialog.getByText(/^Dawn .* · Chrome \d+ on /)).toBeVisible();

    await dialog.getByRole("button", { name: "Copy details" }).click();
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^Dawn .* · Chrome/));
    await expect.element(dialog.getByRole("button", { name: "Copied" })).toBeVisible();
    await expect.element(dialog.getByRole("link", { name: "Open the Discord" })).toHaveAttribute("href", "https://discord.gg/dawn");
  });

  test("the About window's support section offers feedback and the Discord", async () => {
    const screen = render(<SupportSection />);
    await expect.element(screen.getByRole("button", { name: "Send feedback" })).toBeVisible();
    await expect.element(screen.getByRole("link", { name: "Join the Discord" })).toHaveAttribute("href", "https://discord.gg/dawn");
  });
});

describe("without a Discord yet", () => {
  test("there's no feedback button, and nothing opens", async () => {
    const screen = render(
      <>
        <SupportSection />
        <FeedbackWindow />
      </>
    );
    await expect.element(screen.getByRole("button", { name: "Send feedback" })).not.toBeInTheDocument();
    openFeedback("test");
    await expect.element(screen.getByRole("dialog", { name: "Feedback" })).not.toBeInTheDocument();
  });
});
