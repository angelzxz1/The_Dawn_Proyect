// The parity tests' check on their fixtures: the Rust port's stored fixture
// (crates/dawn-engine/tests/fixtures/<name>.rs and .bin) must be what the
// JavaScript renders now, so `cargo test` compares the port against the
// current JavaScript. After changing the JavaScript, remake the fixture
// with UPDATE_ENGINE_FIXTURES=1 (the message says the command) and port the
// change. See src/test/kernelParity.ts.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FixtureData } from "./kernelParity";

const FIXTURE_DIR = join(__dirname, "..", "..", "crates", "dawn-engine", "tests", "fixtures");

/** `what` names what renders it ("The Limiter's kernel"); `name` is the
 * fixture's file name; `testName` the parity test file's, for the command. */
export function describeEngineFixture(what: string, name: string, testName: string, render: () => { rust: string; data: FixtureData }): void {
  const rustFile = join(FIXTURE_DIR, `${name}.rs`);
  const dataFile = join(FIXTURE_DIR, `${name}.bin`);
  const outOfDate =
    `${what} no longer renders the Rust port's fixture: remake it ` +
    `(UPDATE_ENGINE_FIXTURES=1 npx vitest run --project unit ${testName}) and port the change.`;

  describe(`the Rust parity fixture "${name}"`, () => {
    const { rust, data } = render();

    if (process.env.UPDATE_ENGINE_FIXTURES === "1") {
      it("is rewritten", () => {
        mkdirSync(FIXTURE_DIR, { recursive: true });
        writeFileSync(rustFile, rust);
        writeFileSync(dataFile, data.bytes());
      });
      return;
    }

    it("has the cases and settings rendered now", () => {
      // (Git may check the file out with Windows line endings.)
      expect(readFileSync(rustFile, "utf8").replace(/\r\n/g, "\n"), outOfDate).toBe(rust);
    });

    it("has what's rendered now", () => {
      expect(data.maxDifference(new Uint8Array(readFileSync(dataFile))), outOfDate).toBeLessThanOrEqual(1e-7);
    });
  });
}
