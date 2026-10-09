import { describe, expect, it } from "vitest";
import { LATEST_VERSION, RELEASES } from "../content/whatsNew";
import pkg from "../../package.json";
import { describeBrowser, feedbackUrl, membershipPlatforms, supportLinks } from "./support";

const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const EDGE_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0";

describe("support and feedback", () => {
  it("describes the browser", () => {
    expect(describeBrowser(CHROME_WIN)).toBe("Chrome 141 on Windows");
    expect(describeBrowser(EDGE_MAC)).toBe("Edge 141 on macOS");
    expect(describeBrowser(SAFARI)).toBe("Safari 18 on macOS");
    expect(describeBrowser(FIREFOX)).toBe("Firefox 131 on Linux");
  });

  it("falls back to a GitHub issue with the browser filled in", () => {
    const url = new URL(feedbackUrl(CHROME_WIN, true));
    expect(url.hostname).toBe("github.com");
    expect(url.searchParams.get("body")).toContain("Chrome 141 on Windows (Brave)");
  });

  it("shows no support buttons until a page is configured", () => {
    expect(supportLinks()).toEqual([]);
    expect(membershipPlatforms()).toEqual(["Patreon"]);
  });

  it("has release notes for the current version", () => {
    expect(LATEST_VERSION).toBe(pkg.version);
    expect(RELEASES.every((r) => r.items.length > 0)).toBe(true);
  });
});

describe("feedbackUrl with problems", () => {
  it("adds the recent problem codes to the report", () => {
    const url = new URL(feedbackUrl("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0", false, "clip.load ×2"));
    expect(url.searchParams.get("body") ?? url.searchParams.get("problems")).toContain("clip.load ×2");
  });
});
