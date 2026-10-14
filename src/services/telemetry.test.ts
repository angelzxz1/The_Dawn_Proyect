import { describe, expect, it } from "vitest";
import { cleanProps, parseDsn, parseStack, scrubMessage } from "./telemetry";

describe("telemetry never carries content", () => {
  it("keeps only known properties holding short codes", () => {
    expect(cleanProps({ format: "mp3", returning: true, kind: "audio" })).toEqual({ format: "mp3", returning: true, kind: "audio" });
    expect(cleanProps({ format: "My Song - Guitar.wav", name: "Verse", target: "folder" })).toEqual({ target: "folder" });
    expect(cleanProps({ where: "a".repeat(40), area: NaN })).toEqual({});
    expect(cleanProps(undefined)).toEqual({});
  });

  it("strips file names and quoted text from error messages", () => {
    expect(scrubMessage('Couldn\'t decode "My Demo.wav"')).toBe('Couldn\'t decode "…"');
    expect(scrubMessage("Failed to load C:/Users/ana/amps/Plexi_crunch.nam: bad version")).toBe("Failed to load C:/Users/ana/amps/<file>: bad version");
    expect(scrubMessage("x".repeat(500))).toHaveLength(300);
  });
});

describe("error reports", () => {
  it("parses a Sentry DSN into its envelope URL", () => {
    expect(parseDsn("https://abc123@o42.ingest.sentry.io/4507")).toEqual({
      url: "https://o42.ingest.sentry.io/api/4507/envelope/?sentry_key=abc123&sentry_version=7",
      key: "abc123",
    });
    expect(parseDsn("not a dsn")).toBeNull();
  });

  it("reads V8 and Firefox stacks, outermost first", () => {
    const v8 = "TypeError: x is undefined\n    at load (https://dawn.app/_next/a.js:10:5)\n    at https://dawn.app/_next/b.js:3:1";
    expect(parseStack(v8)).toEqual([
      { function: "?", filename: "https://dawn.app/_next/b.js", lineno: 3, colno: 1 },
      { function: "load", filename: "https://dawn.app/_next/a.js", lineno: 10, colno: 5 },
    ]);
    expect(parseStack("load@https://dawn.app/a.js:10:5")).toEqual([{ function: "load", filename: "https://dawn.app/a.js", lineno: 10, colno: 5 }]);
  });
});
