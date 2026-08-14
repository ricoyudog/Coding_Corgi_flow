import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");
const CLI = resolve(PACKAGE_ROOT, "dist/corgispec.js");

function run(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function expectHelp(result: SpawnSyncReturns<string>, command?: string): string {
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status, result.stderr || result.stdout).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).not.toContain("\u001b[");
  if (command) expect(result.stdout).toContain(`Usage: corgispec ${command}`);
  return result.stdout;
}

describe("built RFC-first v4 CLI process boundary", () => {
  it("publishes the public lifecycle and lint commands with their canonical flags", () => {
    const top = expectHelp(run(["--help"]));
    const flags: Record<string, string[]> = {
      rfc: ["new", "validate", "status", "renumber", "accept"],
      propose: ["--from", "--maintenance"],
      apply: ["--complete-group", "--workspace-fingerprint", "--evidence"],
      verify: ["--report"],
      review: ["--approve", "--reject-implementation", "--require-rfc-amendment"],
      "human-qa": ["--report"],
      archive: ["--begin", "--local", "--confirm-tracker", "--finish"],
      change: ["repair", "adopt-amendment"],
      lint: ["--report", "--json", "--path"],
    };

    for (const [command, expectedFlags] of Object.entries(flags)) {
      expect(top).toMatch(new RegExp(`^\\s+${command}(?:\\s|$)`, "m"));
      const help = expectHelp(run([command, "--help"]), command);
      for (const flag of expectedFlags) expect(help, `${command} should expose ${flag}`).toContain(flag);
    }
    expect(top).not.toMatch(/^\s+loop(?:\s|$)/mu);
    expect(top).not.toMatch(/^\s+converge(?:\s|$)/mu);
  });

  it("does not expose the retired Loop or Converge compatibility commands", () => {
    for (const command of ["loop", "converge"]) {
      const result = run([command]);
      expect(result.error, command).toBeUndefined();
      expect(result.signal, command).toBeNull();
      expect(result.status, command).toBe(1);
      expect(result.stdout, command).toBe("");
      expect(result.stderr, command).toContain(`unknown command '${command}'`);
    }
  });
});
