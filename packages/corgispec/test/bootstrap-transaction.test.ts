import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BootstrapFileTransaction,
  createPersistentBackup,
} from "../src/lib/bootstrap-transaction.js";

describe("bootstrap filesystem transaction", () => {
  let root: string;

  beforeEach(() => {
    root = resolve(tmpdir(), `corgispec-bootstrap-txn-${Date.now()}-${Math.random()}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("restores overwritten paths and removes paths created after preflight", () => {
    const existing = resolve(root, "existing.txt");
    const created = resolve(root, "new/file.txt");
    writeFileSync(existing, "before\n");
    const transaction = new BootstrapFileTransaction("test");
    transaction.capture([existing, created]);

    writeFileSync(existing, "after\n");
    mkdirSync(resolve(created, ".."), { recursive: true });
    writeFileSync(created, "created\n");
    transaction.rollback();
    transaction.dispose();

    expect(readFileSync(existing, "utf8")).toBe("before\n");
    expect(existsSync(created)).toBe(false);
  });

  it("creates persistent backups at caller-owned relative paths", () => {
    const source = resolve(root, "project/settings.json");
    const backupRoot = resolve(root, "backups");
    mkdirSync(resolve(source, ".."), { recursive: true });
    writeFileSync(source, "custom\n");

    const written = createPersistentBackup(backupRoot, [{
      source,
      relativePath: "project/settings.json",
    }]);

    expect(written).toEqual([resolve(backupRoot, "project/settings.json")]);
    expect(readFileSync(written[0]!, "utf8")).toBe("custom\n");
  });
});
