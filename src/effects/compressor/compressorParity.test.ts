import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderCompressorParity } from "./compressorParity";

// The Rust port's fixture (crates/dawn-engine/tests/fixtures) must be what
// this kernel renders now, so `cargo test` compares the port against the
// current kernel. After changing the kernel, remake the fixture with
//   UPDATE_ENGINE_FIXTURES=1 npx vitest run --project unit compressorParity
// and port the change (cargo test -p dawn-engine shows where it differs).

const FIXTURE_DIR = join(__dirname, "..", "..", "..", "crates", "dawn-engine", "tests", "fixtures");
const RUST_FILE = join(FIXTURE_DIR, "compressor.rs");
const DATA_FILE = join(FIXTURE_DIR, "compressor.bin");
const OUT_OF_DATE =
  "The Compressor's kernel no longer renders the Rust port's fixture: remake it " +
  "(UPDATE_ENGINE_FIXTURES=1 npx vitest run --project unit compressorParity) and port the change.";

describe("the Compressor's Rust parity fixture", () => {
  const { rust, data } = renderCompressorParity();

  if (process.env.UPDATE_ENGINE_FIXTURES === "1") {
    it("is rewritten", () => {
      mkdirSync(FIXTURE_DIR, { recursive: true });
      writeFileSync(RUST_FILE, rust);
      writeFileSync(DATA_FILE, data.bytes());
    });
    return;
  }

  it("has this kernel's cases and settings", () => {
    // (Git may check the file out with Windows line endings.)
    expect(readFileSync(RUST_FILE, "utf8").replace(/\r\n/g, "\n"), OUT_OF_DATE).toBe(rust);
  });

  it("has what this kernel renders", () => {
    expect(data.maxDifference(new Uint8Array(readFileSync(DATA_FILE))), OUT_OF_DATE).toBeLessThanOrEqual(1e-7);
  });
});
