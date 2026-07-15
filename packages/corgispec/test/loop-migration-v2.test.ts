import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rename as nodeRename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LegacyMigrationArchiveV2Error,
  LegacyMigrationV2Error,
  migrateLegacyLoopV2,
  verifyLegacyMigrationArchiveV2,
  type MigrateLegacyLoopV2Options,
} from "../src/lib/loop-migration-v2.js";
import { LoopStoreV2 } from "../src/lib/loop-store-v2.js";

const roots: string[] = [];
const H = `sha256:${"1".repeat(64)}` as const;
const H2 = `sha256:${"2".repeat(64)}` as const;
const T0 = "2026-03-01T00:00:00.000Z";
const T1 = "2026-03-01T00:01:00.000Z";

function root(): string {
  const value = mkdtempSync(resolve(tmpdir(), "corgi-migrate-v2-"));
  roots.push(value);
  return value;
}

function legacyState(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    active: true,
    changeName: "change-a",
    sessionId: "legacy-session",
    currentGroup: 2,
    totalGroups: 2,
    completedGroups: [1],
    groupStatuses: { "1": "completed", "2": "in_progress" },
    pushStatus: { "1": "pushed" },
    retryCount: 1,
    maxRetries: 3,
    selfDriven: true,
    startedAt: T0,
    updatedAt: T1,
    ...overrides,
  };
}

function writeLegacy(
  projectRoot: string,
  platform: "claude" | "opencode" = "claude",
  value: unknown = legacyState(),
  artifacts = true,
): string {
  const directory = resolve(projectRoot, `.${platform}/corgi-loop/change-a`);
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, "state.json");
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  if (artifacts) {
    const group = resolve(directory, "groups/2");
    mkdirSync(group, { recursive: true });
    writeFileSync(resolve(group, "verify.json"), JSON.stringify({ verdict: "PASS" }));
    writeFileSync(resolve(group, "review.json"), JSON.stringify({ findings: [] }));
  }
  return path;
}

function options(projectRoot: string): MigrateLegacyLoopV2Options {
  return {
    projectRoot,
    changeName: "change-a",
    planningRevision: H,
    baselineGitRevision: "git-base",
    baselineGitTree: "tree-base",
    workspaceFingerprint: H2,
    taskGroups: [
      { id: "TG-1", ordinal: 1, taskGroupFingerprint: H },
      { id: "TG-2", ordinal: 2, taskGroupFingerprint: H2 },
    ],
    now: () => new Date("2026-03-01T00:02:00.000Z"),
  };
}

async function migratedFixture(projectRoot: string, artifacts = true) {
  const sourcePath = writeLegacy(projectRoot, "claude", legacyState(), artifacts);
  const migration = await migrateLegacyLoopV2(options(projectRoot));
  const paths = new LoopStoreV2({ projectRoot }).paths(
    "change-a",
    migration.state!.runId,
  );
  return { sourcePath, migration, paths };
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe("migrateLegacyLoopV2", () => {
  it("migrates one v1 run, preserves completed groups, and archives stale current evidence", async () => {
    const projectRoot = root();
    const source = writeLegacy(projectRoot);
    const result = await migrateLegacyLoopV2(options(projectRoot));

    expect(result).toMatchObject({
      status: "migrated",
      sourcePath: source,
      state: {
        schemaVersion: 2,
        sessionId: "legacy-session",
        mode: "self-driven",
        phase: "awaiting_group_result",
        currentGroupId: "TG-2",
        currentAttempt: 2,
        stateRevision: 0,
        lastEventSeq: 0,
      },
    });
    expect(result.state!.groups["TG-1"]).toMatchObject({
      status: "completed",
      bundle: { status: "approved" },
      commit: { status: "acknowledged", revision: "git-base", tree: "tree-base" },
      push: { status: "not_required" },
    });
    expect(result.state!.groups["TG-2"]).toMatchObject({
      status: "in_progress",
      attempt: 2,
      bundle: { status: "none" },
    });

    const paths = new LoopStoreV2({ projectRoot }).paths("change-a", result.state!.runId);
    expect(existsSync(resolve(paths.runRoot!, "legacy/claude/state.json"))).toBe(true);
    expect(JSON.parse(
      readFileSync(resolve(paths.runRoot!, "legacy/claude/stale-artifacts.json"), "utf8"),
    ).artifacts).toEqual([
      "legacy/claude/current-group/verify.json",
      "legacy/claude/current-group/review.json",
    ]);
    expect(existsSync(paths.migrationMarker!)).toBe(true);
    const marker = JSON.parse(readFileSync(paths.migrationMarker!, "utf8"));
    expect(marker.sources.map((entry: { path: string }) => entry.path)).toEqual([
      ".claude/corgi-loop/change-a/state.json",
      ".claude/corgi-loop/change-a/groups/2/verify.json",
      ".claude/corgi-loop/change-a/groups/2/review.json",
    ]);
    expect(marker.staleArtifacts).toEqual([
      "legacy/claude/current-group/verify.json",
      "legacy/claude/current-group/review.json",
    ]);
    expect(readFileSync(source, "utf8")).toBe(JSON.stringify(legacyState()));
  });

  it("migrates a unique inactive v1 run as invalidated without losing completed groups", async () => {
    const projectRoot = root();
    writeLegacy(projectRoot, "opencode", legacyState({ active: false }));
    const result = await migrateLegacyLoopV2(options(projectRoot));
    expect(result).toMatchObject({
      status: "migrated",
      state: {
        phase: "invalidated",
        completedAt: T1,
        blockedReason: { code: "manual" },
        groups: {
          "TG-1": { status: "completed" },
          "TG-2": { status: "invalidated" },
        },
      },
    });
  });

  it("maps a fully completed active v1 run to awaiting_finalize", async () => {
    const projectRoot = root();
    writeLegacy(projectRoot, "claude", legacyState({
      currentGroup: 2,
      completedGroups: [1, 2],
      groupStatuses: { "1": "completed", "2": "completed" },
    }));
    const result = await migrateLegacyLoopV2(options(projectRoot));
    expect(result.state).toMatchObject({
      phase: "awaiting_finalize",
      currentGroupId: null,
      currentAttempt: 0,
    });
  });

  it("returns none without legacy state and already-canonical after migration", async () => {
    const projectRoot = root();
    await expect(migrateLegacyLoopV2(options(projectRoot))).resolves.toEqual({
      status: "none",
      state: null,
      sourcePath: null,
      staleArtifacts: [],
    });
    writeLegacy(projectRoot);
    const migrated = await migrateLegacyLoopV2(options(projectRoot));
    await expect(migrateLegacyLoopV2(options(projectRoot))).resolves.toMatchObject({
      status: "already-canonical",
      state: { runId: migrated.state!.runId },
    });
  });

  it.each([
    ["LEGACY_CORRUPT", "{"],
    ["LEGACY_CORRUPT", { active: true, changeName: "wrong" }],
    ["LEGACY_FUTURE_SCHEMA", legacyState({ schemaVersion: 9 })],
  ] as const)("fails closed with %s", async (code, value) => {
    const projectRoot = root();
    writeLegacy(projectRoot, "claude", value, false);
    await expect(migrateLegacyLoopV2(options(projectRoot))).rejects.toMatchObject({ code });
  });

  it("distinguishes multiple active runs from general legacy ambiguity", async () => {
    const bothActive = root();
    writeLegacy(bothActive, "claude");
    writeLegacy(bothActive, "opencode");
    await expect(migrateLegacyLoopV2(options(bothActive))).rejects.toMatchObject({
      code: "LEGACY_MULTIPLE_ACTIVE",
    });

    const mixed = root();
    writeLegacy(mixed, "claude");
    writeLegacy(mixed, "opencode", legacyState({ active: false }));
    await expect(migrateLegacyLoopV2(options(mixed))).rejects.toMatchObject({
      code: "LEGACY_AMBIGUOUS",
    });
  });

  it("rejects incompatible task groups and push requirements without evidence", async () => {
    const mismatch = root();
    writeLegacy(mismatch);
    await expect(migrateLegacyLoopV2({
      ...options(mismatch),
      taskGroups: [{ id: "TG-1", ordinal: 1 }],
    })).rejects.toMatchObject({ code: "LEGACY_INCOMPATIBLE" });

    const notPushed = root();
    writeLegacy(notPushed, "claude", legacyState({ pushStatus: {} }));
    await expect(migrateLegacyLoopV2({
      ...options(notPushed),
      policy: { requirePush: true },
    })).rejects.toMatchObject({ code: "LEGACY_INCOMPATIBLE" });
  });

  it("recovers an initialize→archive→marker crash on the next migration call", async () => {
    const projectRoot = root();
    writeLegacy(projectRoot);
    let failed = false;
    await expect(migrateLegacyLoopV2({
      ...options(projectRoot),
      fs: {
        rename: async (from, to) => {
          if (!failed && to.endsWith("migration-v1.json")) {
            failed = true;
            throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
          }
          await nodeRename(from, to);
        },
      },
    })).rejects.toMatchObject({ code: "ENOSPC" });
    expect(failed).toBe(true);

    const store = new LoopStoreV2({ projectRoot });
    await expect(store.inspect("change-a")).rejects.toMatchObject({
      code: "LOOP_CORRUPTION",
    });
    const half = await store.peek("change-a", {
      allowIncompleteLegacyMigration: true,
    });
    expect(half.state?.runId).toMatch(/^migrated-/);
    expect(existsSync(store.paths("change-a", half.state!.runId).migrationMarker!)).toBe(false);

    const recovered = await migrateLegacyLoopV2(options(projectRoot));
    expect(recovered.status).toBe("migrated");
    expect(existsSync(store.paths("change-a", half.state!.runId).migrationMarker!)).toBe(true);
  });

  it.skipIf(process.platform === "win32")("rejects a legacy path through a symlink", async () => {
    const projectRoot = root();
    const outside = root();
    writeLegacy(outside);
    symlinkSync(resolve(outside, ".claude"), resolve(projectRoot, ".claude"), "dir");
    await expect(migrateLegacyLoopV2(options(projectRoot))).rejects.toBeInstanceOf(
      LegacyMigrationV2Error,
    );
  });

  it("tracks absent current artifacts so a later legacy writer is blocked", async () => {
    const projectRoot = root();
    writeLegacy(projectRoot, "claude", legacyState(), false);
    const result = await migrateLegacyLoopV2(options(projectRoot));
    const paths = new LoopStoreV2({ projectRoot }).paths("change-a", result.state!.runId);
    const marker = JSON.parse(readFileSync(paths.migrationMarker!, "utf8"));
    expect(marker.absentSources).toEqual([
      ".claude/corgi-loop/change-a/groups/2/verify.json",
      ".claude/corgi-loop/change-a/groups/2/review.json",
    ]);
    const verify = resolve(projectRoot, marker.absentSources[0]);
    mkdirSync(dirname(verify), { recursive: true });
    writeFileSync(verify, "{}");
    const store = new LoopStoreV2({ projectRoot });
    const state = result.state!;
    await expect(store.writeAttemptBundle({
      changeName: "change-a",
      runId: state.runId,
      sessionId: state.sessionId,
      expectedStateRevision: 0,
      expectedNonce: state.nonce,
      groupId: "TG-2",
      attempt: state.currentAttempt,
      files: { "evidence.json": {} },
      bundle: {
        schemaVersion: 2,
        runId: state.runId,
        groupId: "TG-2",
        attempt: state.currentAttempt,
      },
    })).rejects.toMatchObject({ code: "LOOP_LEGACY_WRITER_DETECTED" });
  });
});

describe("verifyLegacyMigrationArchiveV2", () => {
  it("returns trusted completed ids without mutating the archive or taking a lock", async () => {
    const projectRoot = root();
    const { sourcePath, migration, paths } = await migratedFixture(projectRoot);
    const watched = [
      sourcePath,
      paths.migrationMarker!,
      resolve(paths.runRoot!, "legacy/claude/state.json"),
      resolve(paths.runRoot!, "legacy/claude/current-group/verify.json"),
      resolve(paths.runRoot!, "legacy/claude/current-group/review.json"),
      resolve(paths.runRoot!, "legacy/claude/stale-artifacts.json"),
    ];
    const before = watched.map((path) => ({
      bytes: readFileSync(path),
      mtimeMs: statSync(path).mtimeMs,
    }));

    const verified = await verifyLegacyMigrationArchiveV2({
      projectRoot,
      changeName: "change-a",
      runId: migration.state!.runId,
    });
    expect(verified).toMatchObject({
      marker: {
        schemaVersion: 2,
        changeName: "change-a",
        runId: migration.state!.runId,
        sourcePlatform: "claude",
      },
      trustedLegacyGroupIds: ["1"],
    });
    expect(watched.map((path) => ({
      bytes: readFileSync(path),
      mtimeMs: statSync(path).mtimeMs,
    }))).toEqual(before);
    expect(existsSync(new LoopStoreV2({ projectRoot }).paths("change-a").lock)).toBe(false);
  });

  it.each([
    ["malformed", (marker: Record<string, unknown>) => "{"],
    ["future schema", (marker: Record<string, unknown>) => ({ ...marker, schemaVersion: 9 })],
    ["wrong change", (marker: Record<string, unknown>) => ({ ...marker, changeName: "other" })],
    ["wrong run", (marker: Record<string, unknown>) => ({ ...marker, runId: "other" })],
    ["wrong platform", (marker: Record<string, unknown>) => ({ ...marker, sourcePlatform: "other" })],
    ["missing sources", (marker: Record<string, unknown>) => ({ ...marker, sources: [] })],
    ["invalid sources", (marker: Record<string, unknown>) => ({ ...marker, sources: "bad" })],
    ["invalid absent", (marker: Record<string, unknown>) => ({ ...marker, absentSources: "bad" })],
    ["invalid stale", (marker: Record<string, unknown>) => ({ ...marker, staleArtifacts: "bad" })],
  ] as const)("fails closed for a %s marker", async (_label, mutate) => {
    const projectRoot = root();
    const { migration, paths } = await migratedFixture(projectRoot);
    const marker = JSON.parse(readFileSync(paths.migrationMarker!, "utf8"));
    const changed = mutate(marker);
    writeFileSync(
      paths.migrationMarker!,
      typeof changed === "string" ? changed : JSON.stringify(changed),
    );
    await expect(verifyLegacyMigrationArchiveV2({
      projectRoot,
      changeName: "change-a",
      runId: migration.state!.runId,
    })).rejects.toBeInstanceOf(LegacyMigrationArchiveV2Error);
  });

  it("fails closed when the marker is missing", async () => {
    const projectRoot = root();
    const { migration, paths } = await migratedFixture(projectRoot);
    rmSync(paths.migrationMarker!);
    await expect(verifyLegacyMigrationArchiveV2({
      projectRoot,
      changeName: "change-a",
      runId: migration.state!.runId,
    })).rejects.toBeInstanceOf(LegacyMigrationArchiveV2Error);
  });

  it.each([
    ["source state", (projectRoot: string, paths: { runRoot?: string }, sourcePath: string) => {
      writeFileSync(sourcePath, `${readFileSync(sourcePath, "utf8")} `);
    }],
    ["archived state", (_projectRoot: string, paths: { runRoot?: string }) => {
      writeFileSync(resolve(paths.runRoot!, "legacy/claude/state.json"), "{}");
    }],
    ["archived verify", (_projectRoot: string, paths: { runRoot?: string }) => {
      writeFileSync(resolve(paths.runRoot!, "legacy/claude/current-group/verify.json"), "{}");
    }],
    ["missing review", (_projectRoot: string, paths: { runRoot?: string }) => {
      rmSync(resolve(paths.runRoot!, "legacy/claude/current-group/review.json"));
    }],
    ["stale manifest", (_projectRoot: string, paths: { runRoot?: string }) => {
      writeFileSync(resolve(paths.runRoot!, "legacy/claude/stale-artifacts.json"), "{}");
    }],
    ["unexpected archive file", (_projectRoot: string, paths: { runRoot?: string }) => {
      writeFileSync(resolve(paths.runRoot!, "legacy/claude/extra.json"), "{}");
    }],
  ] as const)("detects tampered %s", async (_label, tamper) => {
    const projectRoot = root();
    const { sourcePath, migration, paths } = await migratedFixture(projectRoot);
    tamper(projectRoot, paths, sourcePath);
    await expect(verifyLegacyMigrationArchiveV2({
      projectRoot,
      changeName: "change-a",
      runId: migration.state!.runId,
    })).rejects.toBeInstanceOf(LegacyMigrationArchiveV2Error);
  });

  it("verifies an empty stale set and detects a formerly absent source", async () => {
    const projectRoot = root();
    const { migration, paths } = await migratedFixture(projectRoot, false);
    await expect(verifyLegacyMigrationArchiveV2({
      projectRoot,
      changeName: "change-a",
      runId: migration.state!.runId,
    })).resolves.toMatchObject({
      marker: { staleArtifacts: [] },
      trustedLegacyGroupIds: ["1"],
    });

    const verify = resolve(projectRoot, ".claude/corgi-loop/change-a/groups/2/verify.json");
    mkdirSync(dirname(verify), { recursive: true });
    writeFileSync(verify, "{}");
    await expect(verifyLegacyMigrationArchiveV2({
      projectRoot,
      changeName: "change-a",
      runId: migration.state!.runId,
    })).rejects.toBeInstanceOf(LegacyMigrationArchiveV2Error);
    expect(existsSync(paths.migrationMarker!)).toBe(true);
  });

  it.each([
    ["source", (marker: Record<string, unknown>) => {
      const sources = structuredClone(marker["sources"] as Array<Record<string, unknown>>);
      sources[0]!.path = "../outside/state.json";
      return { ...marker, sources };
    }],
    ["absent", (marker: Record<string, unknown>) => ({
      ...marker,
      absentSources: ["../outside/verify.json"],
    })],
    ["stale", (marker: Record<string, unknown>) => ({
      ...marker,
      staleArtifacts: ["../outside/verify.json"],
    })],
    ["backslash", (marker: Record<string, unknown>) => {
      const sources = structuredClone(marker["sources"] as Array<Record<string, unknown>>);
      sources[0]!.path = ".claude\\corgi-loop\\change-a\\state.json";
      return { ...marker, sources };
    }],
    ["duplicate", (marker: Record<string, unknown>) => ({
      ...marker,
      staleArtifacts: [
        ...(marker["staleArtifacts"] as string[]),
        (marker["staleArtifacts"] as string[])[0],
      ],
    })],
  ] as const)("rejects marker %s path manipulation", async (_label, mutate) => {
    const projectRoot = root();
    const { migration, paths } = await migratedFixture(projectRoot);
    const marker = JSON.parse(readFileSync(paths.migrationMarker!, "utf8"));
    writeFileSync(paths.migrationMarker!, JSON.stringify(mutate(marker)));
    await expect(verifyLegacyMigrationArchiveV2({
      projectRoot,
      changeName: "change-a",
      runId: migration.state!.runId,
    })).rejects.toBeInstanceOf(LegacyMigrationArchiveV2Error);
  });

  it.skipIf(process.platform === "win32")(
    "rejects marker, archive, and original-source symlinks",
    async () => {
      for (const target of ["marker", "archive", "archive-extra", "source"] as const) {
        const projectRoot = root();
        const outside = root();
        const { sourcePath, migration, paths } = await migratedFixture(projectRoot);
        const selected = target === "marker"
          ? paths.migrationMarker!
          : target === "archive"
            ? resolve(paths.runRoot!, "legacy/claude/state.json")
            : target === "archive-extra"
              ? resolve(paths.runRoot!, "legacy/claude/extra-link.json")
            : sourcePath;
        const external = resolve(outside, `${target}.json`);
        writeFileSync(
          external,
          target === "archive-extra" ? "{}" : readFileSync(selected),
        );
        if (target !== "archive-extra") rmSync(selected);
        symlinkSync(external, selected);
        await expect(verifyLegacyMigrationArchiveV2({
          projectRoot,
          changeName: "change-a",
          runId: migration.state!.runId,
        })).rejects.toBeInstanceOf(LegacyMigrationArchiveV2Error);
      }
    },
  );

  it("rejects malformed completed group identity in an otherwise migratable v1 state", async () => {
    const projectRoot = root();
    writeLegacy(projectRoot, "claude", legacyState({
      completedGroups: "invalid",
      groupStatuses: { "1": "completed" },
    }));
    const migration = await migrateLegacyLoopV2(options(projectRoot));
    await expect(verifyLegacyMigrationArchiveV2({
      projectRoot,
      changeName: "change-a",
      runId: migration.state!.runId,
    })).rejects.toBeInstanceOf(LegacyMigrationArchiveV2Error);
  });
});
