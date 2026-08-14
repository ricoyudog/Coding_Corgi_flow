import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBootstrap } from "../src/lib/bootstrap.js";
import { loadConfigFromDir } from "../src/lib/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_ROOT = resolve(__dirname, "../assets");
let root: string;
let target: string;
let originalOpenSpec: string | undefined;

beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), "corgispec-bootstrap-v4-"));
  target = resolve(root, "project");
  mkdirSync(target, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: target });
  originalOpenSpec = process.env["CORGISPEC_OPENSPEC_BIN"];
  process.env["CORGISPEC_OPENSPEC_BIN"] = createFakeOpenSpec(root);
});

afterEach(() => {
  if (originalOpenSpec === undefined) delete process.env["CORGISPEC_OPENSPEC_BIN"];
  else process.env["CORGISPEC_OPENSPEC_BIN"] = originalOpenSpec;
  delete process.env["CORGISPEC_TEST_ACTIVE_CHANGE"];
  rmSync(root, { recursive: true, force: true });
});

describe("RFC-first v4 bootstrap", () => {
  it("creates the RFC contract, Foundation draft, and mandatory memory atomically", async () => {
    const result = await bootstrap({ integrationBranch: "release" });

    expect(result.status).toBe("success");
    expect(loadConfigFromDir(target).corgi).toMatchObject({
      contract: "rfc-v1",
      rfcRoot: "rfcs",
      foundation: "RFC-0001-project-foundation",
      governance: { integrationBranch: "release" },
    });
    expect(existsSync(resolve(target, "rfcs/RFC-0001-project-foundation/rfc.md"))).toBe(true);
    expect(existsSync(resolve(target, "memory/MEMORY.md"))).toBe(true);
    expect(existsSync(resolve(target, "wiki/schema.md"))).toBe(true);
    expect(readFileSync(resolve(target, "AGENTS.md"), "utf8")).toContain(
      "memory/session-bridge.md",
    );
    expect(readFileSync(resolve(target, ".gitignore"), "utf8")).toContain(".corgi/transactions/");

    const foundationBefore = readFileSync(
      resolve(target, "rfcs/RFC-0001-project-foundation/rfc.md"),
    );
    const repeated = await bootstrap({ integrationBranch: "release" });
    expect(repeated.status, repeated.message).toBe("success");
    expect(readFileSync(resolve(target, "rfcs/RFC-0001-project-foundation/rfc.md")))
      .toEqual(foundationBefore);
  });

  it("keeps a dry-run byte-for-byte read-only", async () => {
    const before = listProjectFiles();
    const result = await bootstrap({ dryRun: true });

    expect(result).toMatchObject({ status: "success", message: expect.stringContaining("dry-run") });
    expect(listProjectFiles()).toEqual(before);
  });

  it("requires an explicit v4 migration and rejects active OpenSpec changes", async () => {
    writeV3Config();
    const before = readFileSync(resolve(target, "openspec/config.yaml"));
    const refused = await bootstrap({ migrateV4: false });
    expect(refused.status).toBe("stopped");
    expect(readFileSync(resolve(target, "openspec/config.yaml"))).toEqual(before);
    expect(existsSync(resolve(target, "rfcs"))).toBe(false);

    process.env["CORGISPEC_TEST_ACTIVE_CHANGE"] = "legacy-change";
    const active = await bootstrap({ migrateV4: true });
    expect(active.status).toBe("stopped");
    expect(active.message).toContain("legacy-change");
    expect(readFileSync(resolve(target, "openspec/config.yaml"))).toEqual(before);

    delete process.env["CORGISPEC_TEST_ACTIVE_CHANGE"];
    const migrated = await bootstrap({ migrateV4: true });
    expect(migrated.status).toBe("success");
    expect(loadConfigFromDir(target).corgi?.contract).toBe("rfc-v1");
    const configBackup = migrated.migration.backups.find((path) =>
      path.replace(/\\/gu, "/").endsWith("/project/openspec/config.yaml")
    );
    expect(configBackup).toBeDefined();
    expect(readFileSync(configBackup!)).toEqual(before);
  });

  it("refuses migration when a sibling worktree has a nonterminal Run Contract", async () => {
    writeV3Config();
    execFileSync("git", ["config", "user.email", "human@example.test"], { cwd: target });
    execFileSync("git", ["config", "user.name", "Human Reviewer"], { cwd: target });
    execFileSync("git", ["add", "."], { cwd: target });
    execFileSync("git", ["commit", "-qm", "v3 baseline"], { cwd: target });
    const sibling = resolve(target, ".worktrees/legacy-change");
    mkdirSync(resolve(target, ".worktrees"), { recursive: true });
    execFileSync("git", ["worktree", "add", "-qb", "legacy/change", sibling], { cwd: target });
    const runRoot = resolve(sibling, ".corgi/loop/legacy-change/runs/run-1");
    mkdirSync(runRoot, { recursive: true });
    writeFileSync(resolve(runRoot, "state.json"), `${JSON.stringify({
      schemaVersion: 2,
      phase: "awaiting_group_result",
      changeName: "legacy-change",
      runId: "run-1",
    })}\n`);

    const before = readFileSync(resolve(target, "openspec/config.yaml"));
    const result = await bootstrap({ migrateV4: true });

    expect(result.status).toBe("stopped");
    expect(result.message).toContain("legacy-change/run-1/v2");
    expect(readFileSync(resolve(target, "openspec/config.yaml"))).toEqual(before);
    expect(result.migration.backups).toEqual([]);
  });

  it("rolls back AGENTS, Memory, OpenSpec, and RFC paths when a late write fails", async () => {
    writeFileSync(resolve(target, "AGENTS.md"), "original protocol\n");
    writeFileSync(resolve(target, "rfcs"), "user-owned blocker\n");

    const result = await bootstrap({});

    expect(result.status).toBe("failed");
    expect(readFileSync(resolve(target, "AGENTS.md"), "utf8")).toBe("original protocol\n");
    expect(readFileSync(resolve(target, "rfcs"), "utf8")).toBe("user-owned blocker\n");
    expect(existsSync(resolve(target, "memory"))).toBe(false);
    expect(existsSync(resolve(target, "wiki"))).toBe(false);
    expect(existsSync(resolve(target, "openspec"))).toBe(false);
  });
});

function bootstrap(overrides: Partial<Parameters<typeof runBootstrap>[0]>) {
  return runBootstrap({
    target,
    schema: "github-tracked",
    trackingProvider: "none",
    mode: "auto",
    yes: true,
    json: true,
    assetsRoot: ASSETS_ROOT,
    platforms: [],
    scope: "local",
    ...overrides,
  });
}

function writeV3Config(): void {
  mkdirSync(resolve(target, "openspec"), { recursive: true });
  writeFileSync(
    resolve(target, "openspec/config.yaml"),
    "schema: github-tracked\ncorgi:\n  tracking:\n    provider: none\n",
  );
}

function listProjectFiles(): string[] {
  const result = execFileSync("git", ["status", "--short", "--untracked-files=all"], {
    cwd: target,
    encoding: "utf8",
  });
  return result.split(/\r?\n/).filter(Boolean);
}

function createFakeOpenSpec(directory: string): string {
  const path = resolve(directory, "openspec");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then printf '1.6.0\\n'; exit 0; fi",
      "if [ \"$1\" = \"list\" ]; then",
      "  if [ -n \"$CORGISPEC_TEST_ACTIVE_CHANGE\" ]; then",
      "    printf '{\"changes\":[{\"name\":\"%s\",\"completedTasks\":0,\"totalTasks\":1,\"lastModified\":\"now\",\"status\":\"active\"}]}' \"$CORGISPEC_TEST_ACTIVE_CHANGE\"",
      "  else printf '{\"changes\":[]}'; fi",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"schema\" ] && [ \"$2\" = \"validate\" ]; then printf '{\"valid\":true,\"issues\":[]}'; exit 0; fi",
      "printf '{\"error\":{\"message\":\"unsupported\"}}'; exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
  return path;
}
