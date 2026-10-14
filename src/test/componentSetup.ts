// Before each component test (vitest.config.ts): the app's styles, so a
// component lays out as it does in the studio, and nothing kept in storage
// from the test before. A test fails if anything is logged as an error
// (React's warnings among them), as the browser tests do (e2e/fixtures.ts).

import "@/app/globals.css";
import { afterEach, beforeEach, expect } from "vitest";

// Next fills in the build's settings (process.env.NEXT_PUBLIC_...) when it
// builds the app; none are set here, so no analytics, links or version.
(globalThis as { process?: unknown }).process ??= { env: { NODE_ENV: "test" } };

const consoleError = console.error;
let logged: unknown[][] = [];

beforeEach(() => {
  localStorage.clear();
  logged = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
    consoleError(...args);
  };
});

afterEach(() => {
  console.error = consoleError;
  expect(logged, "errors logged during the test").toEqual([]);
});
