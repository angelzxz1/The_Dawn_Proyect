import { beforeEach, describe, expect, it, vi } from "vitest";

const reported: { where: string; level: string }[] = [];
vi.mock("./telemetry", () => ({
  reportError: (_error: unknown, where: string, level: string) => reported.push({ where, level }),
}));

const { attempt, noteIssue, recentIssues } = await import("./issues");

describe("issues", () => {
  beforeEach(() => {
    reported.length = 0;
  });

  it("counts each kind and reports it once, as a warning", () => {
    noteIssue("engine.playback", new Error("sample not loaded"));
    noteIssue("engine.playback", new Error("sample not loaded"));
    noteIssue("engine.playback", new Error("sample not loaded"));
    const issue = recentIssues().find((i) => i.where === "engine.playback");
    expect(issue?.count).toBe(3);
    expect(issue?.message).toBe("sample not loaded");
    expect(reported).toEqual([{ where: "engine.playback", level: "warning" }]);
  });

  it("keeps what isn't a bug out of the reports", () => {
    noteIssue("input.open", new Error("Permission denied"), { report: false });
    expect(recentIssues()[0].where).toBe("input.open");
    expect(reported).toEqual([]);
  });

  it("attempt carries on after a throw and notes it", () => {
    let after = false;
    attempt("export.note", () => {
      throw new Error("out of range");
    });
    after = true;
    expect(after).toBe(true);
    expect(recentIssues()[0]).toMatchObject({ where: "export.note", message: "out of range" });
  });
});

describe("issueSummary", () => {
  it("lists the kinds with counts, without messages", async () => {
    const { issueSummary } = await import("./issues");
    noteIssue("clip.load", new Error("blob:secret-file.wav"));
    noteIssue("clip.load", new Error("another"));
    const summary = issueSummary();
    expect(summary).toContain("clip.load ×2");
    expect(summary).not.toContain("secret");
  });
});
