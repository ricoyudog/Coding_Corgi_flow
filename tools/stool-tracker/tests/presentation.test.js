import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { formatEntry, formatHistory } from "../lib/format.js";
import { generateReport } from "../lib/report.js";
import { captureObservation } from "../lib/capture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, ".tmp-test-presentation");

function tmpStore() {
  return path.join(
    tmpDir,
    `store-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
}

beforeEach(() => {
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe("formatEntry", () => {
  it("formats a modern entry showing color and duration", () => {
    const entry = {
      id: "abcdef12-3456-7890-abcd-ef1234567890",
      color: "brown",
      durationMinutes: 5,
      createdAt: "2026-04-28T10:30:00.000Z",
    };
    const result = formatEntry(entry);

    assert.ok(result.includes("abcdef12"));
    assert.ok(result.includes("color: brown"));
    assert.ok(result.includes("duration: 5 min"));
    assert.ok(result.includes("2026-04-28 10:30"));
  });

  it("formats a legacy entry with null fields as unknown", () => {
    const entry = {
      id: "legacy-1",
      color: null,
      durationMinutes: null,
      createdAt: "2025-01-01T00:00:00.000Z",
    };
    const result = formatEntry(entry);

    assert.ok(result.includes("color: unknown"));
    assert.ok(result.includes("duration: unknown"));
  });

  it("handles missing id and createdAt gracefully", () => {
    const entry = { color: "green", durationMinutes: 3 };
    const result = formatEntry(entry);

    assert.ok(result.includes("--------"));
    assert.ok(result.includes("unknown"));
    assert.ok(result.includes("color: green"));
    assert.ok(result.includes("duration: 3 min"));
  });
});

describe("formatHistory", () => {
  it("returns a message for an empty list", () => {
    assert.strictEqual(formatHistory([]), "No entries recorded.");
  });

  it("formats multiple entries as newline-separated lines", () => {
    const entries = [
      { id: "aaa", color: "brown", durationMinutes: 5, createdAt: "2026-04-28T10:00:00.000Z" },
      { id: "bbb", color: "green", durationMinutes: 3, createdAt: "2026-04-28T11:00:00.000Z" },
    ];
    const result = formatHistory(entries);
    const lines = result.split("\n");

    assert.strictEqual(lines.length, 2);
    assert.ok(lines[0].includes("color: brown"));
    assert.ok(lines[1].includes("color: green"));
  });
});

describe("generateReport", () => {
  it("returns a no-data report for empty entries", () => {
    const report = generateReport([]);

    assert.strictEqual(report.count, 0);
    assert.deepStrictEqual(report.colorBreakdown, {});
    assert.strictEqual(report.avgDurationMinutes, null);
    assert.strictEqual(report.text, "No entries to report.");
  });

  it("computes color breakdown and average duration", () => {
    const entries = [
      { color: "brown", durationMinutes: 4 },
      { color: "brown", durationMinutes: 6 },
      { color: "green", durationMinutes: 8 },
    ];
    const report = generateReport(entries);

    assert.strictEqual(report.count, 3);
    assert.strictEqual(report.colorBreakdown["brown"], 2);
    assert.strictEqual(report.colorBreakdown["green"], 1);
    assert.strictEqual(report.avgDurationMinutes, 6);
  });

  it("handles legacy entries with null duration", () => {
    const entries = [
      { color: "brown", durationMinutes: 10 },
      { color: null, durationMinutes: null },
    ];
    const report = generateReport(entries);

    assert.strictEqual(report.count, 2);
    assert.strictEqual(report.colorBreakdown["brown"], 1);
    assert.strictEqual(report.colorBreakdown["unknown"], 1);
    assert.strictEqual(report.avgDurationMinutes, 10);
  });

  it("includes color and duration in the text output", () => {
    const entries = [
      { color: "red", durationMinutes: 7 },
    ];
    const report = generateReport(entries);

    assert.ok(report.text.includes("red: 1"));
    assert.ok(report.text.includes("Average duration: 7 min"));
    assert.ok(report.text.includes("1 entries"));
  });
});

describe("captureObservation", () => {
  it("prompts for color and duration, then saves a valid entry", async () => {
    const storePath = tmpStore();
    const input = new PassThrough();
    let colorSent = false;
    let durationSent = false;
    const prompted = [];
    const output = new Writable({
      write(chunk, _enc, cb) {
        const text = chunk.toString();
        prompted.push(text);
        if (text.includes("Stool color:") && !colorSent) {
          colorSent = true;
          process.nextTick(() => input.write("brown\n"));
        }
        if (text.includes("Duration") && !durationSent) {
          durationSent = true;
          process.nextTick(() => input.write("5\n"));
        }
        cb();
      },
    });

    const result = await captureObservation(storePath, { input, output });
    const all = prompted.join("");

    assert.strictEqual(result.saved, true);
    assert.strictEqual(result.record.color, "brown");
    assert.strictEqual(result.record.durationMinutes, 5);
    assert.ok(all.includes("Available colors:"));
    assert.ok(all.includes("Stool color:"));
    assert.ok(all.includes("Duration"));
  });

  it("rejects invalid input without writing to disk", async () => {
    const storePath = tmpStore();
    const input = new PassThrough();
    let colorSent = false;
    let durationSent = false;
    const output = new Writable({
      write(chunk, _enc, cb) {
        const text = chunk.toString();
        if (text.includes("Stool color:") && !colorSent) {
          colorSent = true;
          process.nextTick(() => input.write("purple\n"));
        }
        if (text.includes("Duration") && !durationSent) {
          durationSent = true;
          process.nextTick(() => input.write("-1\n"));
        }
        cb();
      },
    });

    const result = await captureObservation(storePath, { input, output });

    assert.strictEqual(result.saved, false);
    assert.ok(result.errors.length > 0);
    assert.ok(!existsSync(storePath));
  });
});
