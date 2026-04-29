import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { validateEntry } from "./validate.js";

function ensureStoreFile(storePath) {
  const dir = path.dirname(storePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(storePath)) writeFileSync(storePath, "[]", "utf-8");
}

function readStore(storePath) {
  ensureStoreFile(storePath);
  return JSON.parse(readFileSync(storePath, "utf-8"));
}

function writeStore(storePath, entries) {
  ensureStoreFile(storePath);
  writeFileSync(storePath, JSON.stringify(entries, null, 2) + "\n", "utf-8");
}

export function migrateEntry(raw) {
  return {
    ...raw,
    color: raw.color ?? null,
    durationMinutes: raw.durationMinutes ?? null,
  };
}

export function saveEntry(entry, storePath) {
  const result = validateEntry(entry);
  if (!result.valid) {
    return { saved: false, errors: result.errors };
  }

  const record = {
    id: randomUUID(),
    ...entry,
    createdAt: new Date().toISOString(),
  };

  const entries = readStore(storePath);
  entries.push(record);
  writeStore(storePath, entries);

  return { saved: true, record };
}

export function loadEntries(storePath) {
  if (!existsSync(storePath)) return [];
  const raw = JSON.parse(readFileSync(storePath, "utf-8"));
  return raw.map(migrateEntry);
}

export function loadEntry(id, storePath) {
  const entries = loadEntries(storePath);
  const found = entries.find((e) => e.id === id);
  return found ?? null;
}
