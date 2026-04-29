import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateEntry } from "../lib/validate.js";
import { createEntry, STOOL_COLORS } from "../lib/entry.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => require(path.join(__dirname, "fixtures", name));

describe("STOOL_COLORS constant", () => {
  it("contains exactly the seven design-specified values", () => {
    assert.deepStrictEqual(
      [...STOOL_COLORS],
      ["brown", "yellow", "green", "black", "red", "pale", "other"]
    );
  });

  it("is frozen", () => {
    assert.ok(Object.isFrozen(STOOL_COLORS));
  });
});

describe("createEntry", () => {
  it("returns an object with color and durationMinutes", () => {
    const entry = createEntry({ color: "brown", durationMinutes: 5 });
    assert.deepStrictEqual(entry, { color: "brown", durationMinutes: 5 });
  });
});

describe("validateEntry — valid submissions", () => {
  it("accepts a valid entry with supported color and positive integer duration", () => {
    const result = validateEntry(fixture("valid-entry.json"));
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  it("accepts every supported color value", () => {
    for (const color of STOOL_COLORS) {
      const result = validateEntry({ color, durationMinutes: 1 });
      assert.strictEqual(result.valid, true, `expected color '${color}' to be valid`);
    }
  });

  it("accepts duration of 1 minute (minimum valid)", () => {
    const result = validateEntry({ color: "brown", durationMinutes: 1 });
    assert.strictEqual(result.valid, true);
  });

  it("accepts large duration values", () => {
    const result = validateEntry({ color: "brown", durationMinutes: 120 });
    assert.strictEqual(result.valid, true);
  });
});

describe("validateEntry — invalid color submissions", () => {
  it("rejects an unsupported color value", () => {
    const result = validateEntry(fixture("invalid-color.json"));
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.some((e) => e.includes("color")));
  });

  it("rejects missing color field", () => {
    const result = validateEntry(fixture("missing-color.json"));
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("color")));
  });
});

describe("validateEntry — invalid duration submissions", () => {
  it("rejects duration of zero", () => {
    const result = validateEntry(fixture("invalid-duration-zero.json"));
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("durationMinutes")));
  });

  it("rejects negative duration", () => {
    const result = validateEntry(fixture("invalid-duration-negative.json"));
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("durationMinutes")));
  });

  it("rejects fractional duration (must be whole minutes)", () => {
    const result = validateEntry(fixture("invalid-duration-float.json"));
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("durationMinutes")));
  });

  it("rejects missing duration field", () => {
    const result = validateEntry(fixture("missing-duration.json"));
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("durationMinutes")));
  });
});

describe("validateEntry — additional properties rejected", () => {
  it("rejects entries with extra unknown fields", () => {
    const result = validateEntry({ color: "brown", durationMinutes: 5, notes: "extra" });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
  });
});
