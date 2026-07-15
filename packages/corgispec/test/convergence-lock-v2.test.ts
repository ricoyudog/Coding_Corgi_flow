import { spawn, spawnSync } from "node:child_process";
import { hostname, tmpdir } from "node:os";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { open as nodeOpen, type FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConvergenceLockPathError,
  ConvergenceLockTimeoutError,
  withConvergenceLockV2,
} from "../src/lib/convergence-lock-v2.js";

const roots: string[] = [];
const FIXED_NOW = new Date("2026-07-15T10:00:00.000Z");

function fixtureRoot(prefix = "corgi-converge-lock-"): string {
  const path = mkdtempSync(resolve(tmpdir(), prefix));
  roots.push(path);
  return path;
}

function lockPath(projectRoot: string, changeName = "change-a"): string {
  return resolve(projectRoot, ".corgi", "loop", changeName, ".converge.lock");
}

function seedLock(
  projectRoot: string,
  record: Record<string, unknown>,
  changeName = "change-a",
): string {
  const path = lockPath(projectRoot, changeName);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  return path;
}

function validRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    token: "existing-token",
    pid: process.pid,
    hostname: hostname(),
    acquiredAt: FIXED_NOW.toISOString(),
    ...overrides,
  };
}

async function deadProcessId(): Promise<number> {
  return new Promise((settle, reject) => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
      stdio: "ignore",
    });
    const pid = child.pid;
    child.once("error", reject);
    child.once("close", () => {
      if (pid === undefined) reject(new Error("child process did not have a pid"));
      else settle(pid);
    });
  });
}

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("withConvergenceLockV2", () => {
  it("serializes same-process contenders for one change", async () => {
    const projectRoot = fixtureRoot();
    const order: string[] = [];
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((settle) => { entered = settle; });
    const releasePromise = new Promise<void>((settle) => { release = settle; });

    const first = withConvergenceLockV2(
      { projectRoot, changeName: "change-a", timeoutMs: 1_000, pollMs: 2 },
      async () => {
        order.push("first-enter");
        entered();
        await releasePromise;
        order.push("first-exit");
      },
    );
    await enteredPromise;
    let secondEntered = false;
    const second = withConvergenceLockV2(
      { projectRoot, changeName: "change-a", timeoutMs: 1_000, pollMs: 2 },
      () => {
        secondEntered = true;
        order.push("second-enter");
      },
    );
    await new Promise((settle) => setTimeout(settle, 20));
    expect(secondEntered).toBe(false);
    release();
    await Promise.all([first, second]);

    expect(order).toEqual(["first-enter", "first-exit", "second-enter"]);
    expect(existsSync(lockPath(projectRoot))).toBe(false);
  });

  it("persists its owner record before the callback and exposes an O_EXCL lock cross-process", async () => {
    const projectRoot = fixtureRoot();
    await withConvergenceLockV2(
      {
        projectRoot,
        changeName: "change-a",
        now: () => FIXED_NOW,
      },
      () => {
        const path = lockPath(projectRoot);
        const record = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
        expect(record).toMatchObject({
          schemaVersion: 2,
          pid: process.pid,
          hostname: hostname(),
          acquiredAt: FIXED_NOW.toISOString(),
          token: expect.any(String),
        });
        if (process.platform !== "win32") {
          expect(lstatSync(path).mode & 0o777).toBe(0o600);
        }

        const contender = spawnSync(
          process.execPath,
          [
            "-e",
            [
              "const fs = require('node:fs')",
              "try {",
              "  const fd = fs.openSync(process.argv[1], fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY)",
              "  fs.closeSync(fd)",
              "  process.exit(0)",
              "} catch (error) {",
              "  process.stderr.write(String(error.code))",
              "  process.exit(error.code === 'EEXIST' ? 17 : 18)",
              "}",
            ].join(";"),
            path,
          ],
          { encoding: "utf8" },
        );
        expect(contender.status).toBe(17);
        expect(contender.stderr).toBe("EEXIST");
      },
    );
  });

  it("times out without stealing a live local owner even when its lease is old", async () => {
    const projectRoot = fixtureRoot();
    const path = seedLock(projectRoot, validRecord({ acquiredAt: "2000-01-01T00:00:00.000Z" }));
    utimesSync(path, new Date(0), new Date(0));

    await expect(withConvergenceLockV2(
      {
        projectRoot,
        changeName: "change-a",
        timeoutMs: 0,
        staleMs: 1,
        now: () => FIXED_NOW,
      },
      () => undefined,
    )).rejects.toBeInstanceOf(ConvergenceLockTimeoutError);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ token: "existing-token" });
  });

  it("reclaims a dead local PID immediately without requiring lease expiry", async () => {
    const projectRoot = fixtureRoot();
    const pid = await deadProcessId();
    seedLock(projectRoot, validRecord({ pid, acquiredAt: "2099-01-01T00:00:00.000Z" }));
    let called = false;

    await withConvergenceLockV2(
      {
        projectRoot,
        changeName: "change-a",
        timeoutMs: 100,
        staleMs: 60_000,
        now: () => FIXED_NOW,
      },
      () => { called = true; },
    );

    expect(called).toBe(true);
    expect(existsSync(lockPath(projectRoot))).toBe(false);
  });

  it("reclaims only an expired foreign-host lease", async () => {
    const projectRoot = fixtureRoot();
    const path = seedLock(projectRoot, validRecord({
      hostname: "foreign-host.invalid",
      acquiredAt: "2000-01-01T00:00:00.000Z",
    }));
    utimesSync(path, new Date(0), new Date(0));
    await expect(withConvergenceLockV2(
      {
        projectRoot,
        changeName: "change-a",
        timeoutMs: 100,
        staleMs: 1_000,
        now: () => FIXED_NOW,
      },
      () => "reclaimed",
    )).resolves.toBe("reclaimed");

    seedLock(projectRoot, validRecord({ hostname: "foreign-host.invalid" }));
    await expect(withConvergenceLockV2(
      {
        projectRoot,
        changeName: "change-a",
        timeoutMs: 0,
        staleMs: 1_000,
        now: () => FIXED_NOW,
      },
      () => undefined,
    )).rejects.toBeInstanceOf(ConvergenceLockTimeoutError);
  });

  it("uses only a local random quarantine name for an untrusted malicious token", async () => {
    const projectRoot = fixtureRoot();
    const outside = fixtureRoot("corgi-converge-outside-");
    const victim = resolve(outside, "victim.txt");
    writeFileSync(victim, "do not delete", "utf8");
    const path = seedLock(projectRoot, validRecord({
      token: `../../../../${victim}`,
      hostname: "foreign-host.invalid",
      acquiredAt: "2000-01-01T00:00:00.000Z",
    }));
    utimesSync(path, new Date(0), new Date(0));

    await withConvergenceLockV2(
      {
        projectRoot,
        changeName: "change-a",
        timeoutMs: 100,
        staleMs: 1,
        now: () => FIXED_NOW,
      },
      () => undefined,
    );

    expect(readFileSync(victim, "utf8")).toBe("do not delete");
    expect(readdirSync(resolve(projectRoot, ".corgi", "loop", "change-a"))).toEqual([]);
  });

  it("restores and rejects a stale lock whose quarantine bytes change after claim", async () => {
    const projectRoot = fixtureRoot();
    const path = seedLock(projectRoot, validRecord({
      hostname: "foreign-host.invalid",
      acquiredAt: "2000-01-01T00:00:00.000Z",
    }));
    utimesSync(path, new Date(0), new Date(0));
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        rename: async (source: string, destination: string): Promise<void> => {
          await actual.rename(source, destination);
          if (destination.includes(".stale-")) {
            await actual.writeFile(destination, "changed-after-claim\n", "utf8");
          }
        },
      };
    });
    const faulted = await import("../src/lib/convergence-lock-v2.js");

    await expect(faulted.withConvergenceLockV2(
      {
        projectRoot,
        changeName: "change-a",
        timeoutMs: 100,
        staleMs: 1,
        now: () => FIXED_NOW,
      },
      () => undefined,
    )).rejects.toMatchObject({ code: "CONVERGENCE_LOCK_PATH_UNSAFE" });
    expect(readFileSync(path, "utf8")).toBe("changed-after-claim\n");
  });

  it("recovers when a stale lock disappears during quarantine rename", async () => {
    const projectRoot = fixtureRoot();
    const path = seedLock(projectRoot, validRecord({
      hostname: "foreign-host.invalid",
      acquiredAt: "2000-01-01T00:00:00.000Z",
    }));
    utimesSync(path, new Date(0), new Date(0));
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        rename: async (source: string, destination: string): Promise<void> => {
          if (destination.includes(".stale-")) {
            await actual.unlink(source);
            throw Object.assign(new Error("stale owner disappeared"), { code: "ENOENT" });
          }
          await actual.rename(source, destination);
        },
      };
    });
    const faulted = await import("../src/lib/convergence-lock-v2.js");

    await expect(faulted.withConvergenceLockV2(
      {
        projectRoot,
        changeName: "change-a",
        timeoutMs: 100,
        staleMs: 1,
        now: () => FIXED_NOW,
      },
      () => "acquired",
    )).resolves.toBe("acquired");
  });

  it("propagates a non-missing stale quarantine rename failure", async () => {
    const projectRoot = fixtureRoot();
    const path = seedLock(projectRoot, validRecord({
      hostname: "foreign-host.invalid",
      acquiredAt: "2000-01-01T00:00:00.000Z",
    }));
    utimesSync(path, new Date(0), new Date(0));
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        rename: async (source: string, destination: string): Promise<void> => {
          if (destination.includes(".stale-")) {
            throw Object.assign(new Error("rename denied"), { code: "EACCES" });
          }
          await actual.rename(source, destination);
        },
      };
    });
    const faulted = await import("../src/lib/convergence-lock-v2.js");

    await expect(faulted.withConvergenceLockV2(
      {
        projectRoot,
        changeName: "change-a",
        timeoutMs: 100,
        staleMs: 1,
        now: () => FIXED_NOW,
      },
      () => undefined,
    )).rejects.toMatchObject({ code: "EACCES" });
  });

  it.skipIf(process.platform === "win32")("does not release a replacement lock owned by another token", async () => {
    const projectRoot = fixtureRoot();
    const path = lockPath(projectRoot);
    await withConvergenceLockV2(
      { projectRoot, changeName: "change-a" },
      () => {
        unlinkSync(path);
        writeFileSync(path, `${JSON.stringify(validRecord({ token: "replacement-token" }))}\n`);
      },
    );

    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ token: "replacement-token" });
  });

  it.skipIf(process.platform === "win32")("does not unlink a replacement during failed acquisition cleanup", async () => {
    const projectRoot = fixtureRoot();
    const path = lockPath(projectRoot);
    const probePath = resolve(projectRoot, "probe");
    const probe = await nodeOpen(probePath, "w");
    const prototype = Object.getPrototypeOf(probe) as { sync: FileHandle["sync"] };
    const originalSync = prototype.sync;
    await probe.close();
    unlinkSync(probePath);
    prototype.sync = async function failAfterReplacement(): Promise<void> {
      unlinkSync(path);
      writeFileSync(path, `${JSON.stringify(validRecord({ token: "replacement-after-sync" }))}\n`);
      throw new Error("injected fsync failure");
    };
    try {
      await expect(withConvergenceLockV2(
        { projectRoot, changeName: "change-a" },
        () => undefined,
      )).rejects.toThrow("injected fsync failure");
    } finally {
      prototype.sync = originalSync;
    }

    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      token: "replacement-after-sync",
    });
  });

  it("removes its own lock after an acquisition fsync failure", async () => {
    const projectRoot = fixtureRoot();
    const probePath = resolve(projectRoot, "probe");
    const probe = await nodeOpen(probePath, "w");
    const prototype = Object.getPrototypeOf(probe) as { sync: FileHandle["sync"] };
    const originalSync = prototype.sync;
    await probe.close();
    unlinkSync(probePath);
    prototype.sync = async function failSync(): Promise<void> {
      throw new Error("injected acquisition fsync failure");
    };
    try {
      await expect(withConvergenceLockV2(
        { projectRoot, changeName: "change-a" },
        () => undefined,
      )).rejects.toThrow("injected acquisition fsync failure");
    } finally {
      prototype.sync = originalSync;
    }

    expect(existsSync(lockPath(projectRoot))).toBe(false);
    expect(readdirSync(resolve(projectRoot, ".corgi", "loop", "change-a"))).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "ignores a close failure after the callback and still releases its lock",
    async () => {
      const projectRoot = fixtureRoot();
      const probePath = resolve(projectRoot, "probe");
      const probe = await nodeOpen(probePath, "w");
      const prototype = Object.getPrototypeOf(probe) as { close: FileHandle["close"] };
      const originalClose = prototype.close;
      await probe.close();
      unlinkSync(probePath);
      let captured: FileHandle | undefined;

      await withConvergenceLockV2(
        { projectRoot, changeName: "change-a" },
        () => {
          prototype.close = async function failClose(): Promise<void> {
            captured = this as FileHandle;
            throw new Error("injected close failure");
          };
        },
      );
      prototype.close = originalClose;
      if (captured) await originalClose.call(captured);

      expect(existsSync(lockPath(projectRoot))).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "tolerates its lock disappearing before release",
    async () => {
      const projectRoot = fixtureRoot();
      await withConvergenceLockV2(
        { projectRoot, changeName: "change-a" },
        () => unlinkSync(lockPath(projectRoot)),
      );
      expect(existsSync(lockPath(projectRoot))).toBe(false);
    },
  );

  it("tolerates its lock disappearing during release quarantine rename", async () => {
    const projectRoot = fixtureRoot();
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        rename: async (source: string, destination: string): Promise<void> => {
          if (destination.includes(".release-")) {
            await actual.unlink(source);
            throw Object.assign(new Error("release target disappeared"), { code: "ENOENT" });
          }
          await actual.rename(source, destination);
        },
      };
    });
    const faulted = await import("../src/lib/convergence-lock-v2.js");

    await expect(faulted.withConvergenceLockV2(
      { projectRoot, changeName: "change-a" },
      () => "complete",
    )).resolves.toBe("complete");
    expect(existsSync(lockPath(projectRoot))).toBe(false);
  });

  it("propagates a non-missing release quarantine rename failure", async () => {
    const projectRoot = fixtureRoot();
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        rename: async (source: string, destination: string): Promise<void> => {
          if (destination.includes(".release-")) {
            throw Object.assign(new Error("release rename denied"), { code: "EACCES" });
          }
          await actual.rename(source, destination);
        },
      };
    });
    const faulted = await import("../src/lib/convergence-lock-v2.js");

    await expect(faulted.withConvergenceLockV2(
      { projectRoot, changeName: "change-a" },
      () => undefined,
    )).rejects.toMatchObject({ code: "EACCES" });
    expect(existsSync(lockPath(projectRoot))).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "does not release a replacement non-file entry",
    async () => {
      const projectRoot = fixtureRoot();
      const path = lockPath(projectRoot);
      await withConvergenceLockV2(
        { projectRoot, changeName: "change-a" },
        () => {
          unlinkSync(path);
          mkdirSync(path);
        },
      );
      expect(lstatSync(path).isDirectory()).toBe(true);
    },
  );

  it("releases its lock when the callback throws and permits the next caller", async () => {
    const projectRoot = fixtureRoot();
    const failure = new Error("callback failed");
    await expect(withConvergenceLockV2(
      { projectRoot, changeName: "change-a" },
      () => { throw failure; },
    )).rejects.toBe(failure);
    expect(existsSync(lockPath(projectRoot))).toBe(false);
    await expect(withConvergenceLockV2(
      { projectRoot, changeName: "change-a" },
      () => 42,
    )).resolves.toBe(42);
  });

  it.each([
    "",
    ".",
    "..",
    "../escape",
    "nested/change",
    "nested\\change",
    "CON",
    "con.txt",
    "LPT9.log",
    "trailing.",
    "trailing ",
    "C:drive",
  ])("rejects unsafe or non-portable change segment %j", async (changeName) => {
    const projectRoot = fixtureRoot();
    await expect(withConvergenceLockV2(
      { projectRoot, changeName },
      () => undefined,
    )).rejects.toBeInstanceOf(ConvergenceLockPathError);
    expect(existsSync(resolve(projectRoot, ".corgi"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")("rejects symlinked lock ancestors and lock leaves", async () => {
    const projectRoot = fixtureRoot();
    const outside = fixtureRoot("corgi-converge-symlink-");
    const victim = resolve(outside, "victim.txt");
    writeFileSync(victim, "sentinel", "utf8");
    symlinkSync(outside, resolve(projectRoot, ".corgi"), "dir");

    await expect(withConvergenceLockV2(
      { projectRoot, changeName: "change-a" },
      () => undefined,
    )).rejects.toBeInstanceOf(ConvergenceLockPathError);
    expect(readFileSync(victim, "utf8")).toBe("sentinel");

    rmSync(resolve(projectRoot, ".corgi"), { force: true });
    mkdirSync(resolve(projectRoot, ".corgi", "loop", "change-a"), { recursive: true });
    symlinkSync(victim, lockPath(projectRoot));
    await expect(withConvergenceLockV2(
      { projectRoot, changeName: "change-a", timeoutMs: 0 },
      () => undefined,
    )).rejects.toBeInstanceOf(ConvergenceLockPathError);
    expect(readFileSync(victim, "utf8")).toBe("sentinel");
  });

  it("rejects missing, empty, and non-directory project roots", async () => {
    const parent = fixtureRoot();
    const fileRoot = resolve(parent, "project-file");
    writeFileSync(fileRoot, "not a directory", "utf8");

    for (const projectRoot of [
      "",
      "bad\0root",
      resolve(parent, "missing"),
      fileRoot,
    ]) {
      await expect(withConvergenceLockV2(
        { projectRoot, changeName: "change-a" },
        () => undefined,
      )).rejects.toBeInstanceOf(ConvergenceLockPathError);
    }
  });

  it("rejects a regular file used as a lock ancestor", async () => {
    const projectRoot = fixtureRoot();
    writeFileSync(resolve(projectRoot, ".corgi"), "not a directory", "utf8");
    await expect(withConvergenceLockV2(
      { projectRoot, changeName: "change-a" },
      () => undefined,
    )).rejects.toBeInstanceOf(ConvergenceLockPathError);
  });

  it("rejects a lock ancestor whose realpath changes unexpectedly", async () => {
    const projectRoot = fixtureRoot();
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        realpath: async (path: Parameters<typeof actual.realpath>[0]): Promise<string> => {
          const resolvedPath = String(await actual.realpath(path));
          return resolvedPath.endsWith(".corgi") ? `${resolvedPath}-elsewhere` : resolvedPath;
        },
      };
    });
    const faulted = await import("../src/lib/convergence-lock-v2.js");

    await expect(faulted.withConvergenceLockV2(
      { projectRoot, changeName: "change-a" },
      () => undefined,
    )).rejects.toMatchObject({ code: "CONVERGENCE_LOCK_PATH_UNSAFE" });
  });

  it("parses malformed owner records as unknown and reclaims them only when expired", async () => {
    const projectRootForMalformed = fixtureRoot();
    const malformedRecords: unknown[] = [
      null,
      {},
      { ...validRecord(), schemaVersion: 1 },
      { ...validRecord(), token: "" },
      { ...validRecord(), pid: 1.5 },
      { ...validRecord(), pid: 0 },
      { ...validRecord(), hostname: 42 },
      { ...validRecord(), acquiredAt: 42 },
      { ...validRecord(), acquiredAt: "not-a-date" },
    ];

    for (const [index, record] of malformedRecords.entries()) {
      const changeName = `malformed-${index}`;
      const path = lockPath(projectRootForMalformed, changeName);
      mkdirSync(resolve(path, ".."), { recursive: true });
      writeFileSync(path, index === 0 ? "not-json\n" : `${JSON.stringify(record)}\n`);
      utimesSync(path, new Date(0), new Date(0));
      await expect(withConvergenceLockV2(
        {
          projectRoot: projectRootForMalformed,
          changeName,
          timeoutMs: 100,
          staleMs: 1,
          now: () => FIXED_NOW,
        },
        () => changeName,
      )).resolves.toBe(changeName);
    }
  });

  it("fails closed when probing a local owner returns a non-ESRCH error", async () => {
    const projectRoot = fixtureRoot();
    seedLock(projectRoot, validRecord({ pid: 2_147_483_647 }));
    const originalKill = process.kill;
    process.kill = (() => {
      throw Object.assign(new Error("permission denied"), { code: "EPERM" });
    }) as typeof process.kill;
    try {
      await expect(withConvergenceLockV2(
        {
          projectRoot,
          changeName: "change-a",
          timeoutMs: 0,
          staleMs: 0,
          now: () => FIXED_NOW,
        },
        () => undefined,
      )).rejects.toBeInstanceOf(ConvergenceLockTimeoutError);
    } finally {
      process.kill = originalKill;
    }
  });

  it("validates timing options and the injected clock", async () => {
    const projectRoot = fixtureRoot();
    for (const options of [
      { timeoutMs: -1 },
      { timeoutMs: Number.POSITIVE_INFINITY },
      { pollMs: -1 },
      { staleMs: Number.NaN },
    ]) {
      await expect(withConvergenceLockV2(
        { projectRoot, changeName: "change-a", ...options },
        () => undefined,
      )).rejects.toBeInstanceOf(RangeError);
    }
    await expect(withConvergenceLockV2(
      { projectRoot, changeName: "change-a", now: () => new Date(Number.NaN) },
      () => undefined,
    )).rejects.toBeInstanceOf(RangeError);
    await expect(withConvergenceLockV2(
      { projectRoot, changeName: "change-a", now: (() => "not-a-date") as unknown as () => Date },
      () => undefined,
    )).rejects.toBeInstanceOf(RangeError);
  });
});
