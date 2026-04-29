import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { saveEntry, loadEntries, loadEntry, migrateEntry } from "../lib/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, ".tmp-test-store");

function tmpStore() {
  return path.join(tmpDir, `store-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

beforeEach(() => {
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe("saveEntry", () => {
  it("persists a valid entry and returns the saved record", () => {
    const storePath = tmpStore();
    const result = saveEntry({ color: "brown", durationMinutes: 5 }, storePath);

    assert.strictEqual(result.saved, true);
    assert.ok(result.record.id, "record should have an id");
    assert.strictEqual(result.record.color, "brown");
    assert.strictEqual(result.record.durationMinutes, 5);
    assert.ok(result.record.createdAt, "record should have createdAt");

    const raw = JSON.parse(readFileSync(storePath, "utf-8"));
    assert.strictEqual(raw.length, 1);
    assert.strictEqual(raw[0].color, "brown");
  });

  it("appends multiple entries to the same store file", () => {
    const storePath = tmpStore();
    saveEntry({ color: "brown", durationMinutes: 5 }, storePath);
    saveEntry({ color: "green", durationMinutes: 3 }, storePath);

    const raw = JSON.parse(readFileSync(storePath, "utf-8"));
    assert.strictEqual(raw.length, 2);
    assert.strictEqual(raw[0].color, "brown");
    assert.strictEqual(raw[1].color, "green");
  });

  it("rejects an invalid entry without writing to disk", () => {
    const storePath = tmpStore();
    const result = saveEntry({ color: "purple", durationMinutes: 5 }, storePath);

    assert.strictEqual(result.saved, false);
    assert.ok(result.errors.length > 0);
    assert.ok(!existsSync(storePath), "store file should not be created for invalid entry");
  });

  it("assigns unique IDs to each saved entry", () => {
    const storePath = tmpStore();
    const r1 = saveEntry({ color: "brown", durationMinutes: 1 }, storePath);
    const r2 = saveEntry({ color: "yellow", durationMinutes: 2 }, storePath);

    assert.notStrictEqual(r1.record.id, r2.record.id);
  });
});

describe("loadEntries", () => {
  it("returns an empty array for a non-existent store", () => {
    const entries = loadEntries("/tmp/does-not-exist-" + Date.now() + ".json");
    assert.deepStrictEqual(entries, []);
  });

  it("returns all saved entries with their attributes", () => {
    const storePath = tmpStore();
    saveEntry({ color: "brown", durationMinutes: 5 }, storePath);
    saveEntry({ color: "red", durationMinutes: 10 }, storePath);

    const entries = loadEntries(storePath);
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].color, "brown");
    assert.strictEqual(entries[0].durationMinutes, 5);
    assert.strictEqual(entries[1].color, "red");
    assert.strictEqual(entries[1].durationMinutes, 10);
  });
});

describe("loadEntry", () => {
  it("returns a single entry by ID", () => {
    const storePath = tmpStore();
    const { record } = saveEntry({ color: "green", durationMinutes: 7 }, storePath);

    const found = loadEntry(record.id, storePath);
    assert.strictEqual(found.id, record.id);
    assert.strictEqual(found.color, "green");
    assert.strictEqual(found.durationMinutes, 7);
  });

  it("returns null for a non-existent ID", () => {
    const storePath = tmpStore();
    saveEntry({ color: "brown", durationMinutes: 1 }, storePath);

    const found = loadEntry("non-existent-id", storePath);
    assert.strictEqual(found, null);
  });
});

describe("migrateEntry — backward compatibility", () => {
  it("adds null color and durationMinutes to legacy entries", () => {
    const legacy = { id: "legacy-001", form: 4, createdAt: "2025-01-15T10:00:00.000Z" };
    const migrated = migrateEntry(legacy);

    assert.strictEqual(migrated.color, null);
    assert.strictEqual(migrated.durationMinutes, null);
    assert.strictEqual(migrated.id, "legacy-001");
    assert.strictEqual(migrated.form, 4);
  });

  it("preserves color and durationMinutes on modern entries", () => {
    const modern = { id: "new-001", color: "brown", durationMinutes: 5 };
    const migrated = migrateEntry(modern);

    assert.strictEqual(migrated.color, "brown");
    assert.strictEqual(migrated.durationMinutes, 5);
  });

  it("is applied automatically when loading entries from a mixed store", () => {
    const storePath = tmpStore();
    const mixed = [
      { id: "old-1", form: 3, createdAt: "2025-01-01T00:00:00.000Z" },
      { id: "new-1", color: "green", durationMinutes: 4, createdAt: "2026-04-28T00:00:00.000Z" },
    ];
    writeFileSync(storePath, JSON.stringify(mixed), "utf-8");

    const entries = loadEntries(storePath);
    assert.strictEqual(entries.length, 2);

    assert.strictEqual(entries[0].color, null);
    assert.strictEqual(entries[0].durationMinutes, null);
    assert.strictEqual(entries[0].form, 3);

    assert.strictEqual(entries[1].color, "green");
    assert.strictEqual(entries[1].durationMinutes, 4);
  });
});
