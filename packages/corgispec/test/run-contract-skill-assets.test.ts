import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createLoopV2Command } from "../src/commands/loop-v2.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");

function read(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

describe("Run Contract v2 skill guardrails", () => {
  const openCodeLoop = read(".opencode/skills/compounds/corgispec-loop/SKILL.md");
  const claudeLoop = read(".claude/skills/compounds/corgispec-loop/SKILL.md");
  const bundledLoop = read("packages/corgispec/assets/skills/compounds/corgispec-loop/SKILL.md");
  const reviewLoop = read(".opencode/skills/molecules/corgispec-review-loop/SKILL.md");

  it("keeps the platform-independent loop contract while requiring explicit invocation", () => {
    expect(claudeLoop).toBe(openCodeLoop);
    expect(bundledLoop).toBe(openCodeLoop);
    expect(openCodeLoop).toContain("Run Contract v2 CLI as the only lifecycle authority");
    expect(openCodeLoop).toContain('opencode/autoinvoke: "false"');
    expect(openCodeLoop).toContain("disable-model-invocation: true");
    expect(openCodeLoop).toContain("Never create, edit, rename, or delete `.corgi/loop/**` files");
    expect(openCodeLoop).toContain("stateRevision");
    expect(openCodeLoop).toContain("nonce");
    expect(openCodeLoop).toContain("corgispec loop submit");
    expect(openCodeLoop).toContain("corgispec loop ack-commit");
    expect(openCodeLoop).toContain("corgispec loop sync-tracker");
    expect(openCodeLoop).toContain("they never run `sync-tracker`, `gh`, `glab`");
    expect(openCodeLoop).toContain("corgispec loop finalize");
    expect(openCodeLoop).toContain("Prefer a safe evidence draft");
    expect(openCodeLoop).toContain("Omit evidence bindings, entry bindings");
    expect(openCodeLoop).toContain("never send a partial binding or hash claim");
  });

  it("documents only valid lifecycle argv and complete CAS tokens", () => {
    expect(openCodeLoop).toContain(
      'corgispec loop init "<change>" --owner "<actor>" --session "<session>" --mode "<self-driven|hook-driven>" --json',
    );
    expect(openCodeLoop).toContain('corgispec loop inspect "<change>" --json');

    for (const operation of ["submit", "ack-commit", "sync-tracker", "finalize", "invalidate", "resume"]) {
      const invocation = openCodeLoop
        .split("\n")
        .find((line) => line.includes(`corgispec loop ${operation} "<change>"`));
      expect(invocation, `${operation} invocation should be documented`).toBeDefined();
      expect(invocation).toContain('--run-id "<runId>"');
      expect(invocation).toContain("--session");
      expect(invocation).toContain("--state-revision <n>");
      expect(invocation).toContain('--nonce "<nonce>"');
      expect(invocation).toContain("--json");
    }

    expect(openCodeLoop).toContain('--reason "<reason>"');
    expect(openCodeLoop).toContain('--new-session "<newSessionId>"');
    expect(openCodeLoop).toContain('--push-status pushed --remote-revision "<revision>"');
    expect(openCodeLoop).not.toContain("--commit");
  });

  it("keeps documented lifecycle options aligned with the Commander surface", () => {
    const loop = createLoopV2Command();
    const optionsFor = (name: string): Set<string> => {
      const command = loop.commands.find((candidate) => candidate.name() === name);
      expect(command, `${name} should exist on the loop CLI`).toBeDefined();
      return new Set(command!.options.map((option) => option.long));
    };
    const expectOptions = (name: string, expected: string[]): void => {
      const options = optionsFor(name);
      for (const option of expected) expect(options).toContain(option);
    };

    expectOptions("init", [
      "--session", "--owner", "--mode", "--run-id", "--path", "--json",
    ]);
    expectOptions("inspect", [
      "--run-id", "--path", "--json",
    ]);

    const casOptions = ["--run-id", "--session", "--state-revision", "--nonce"];
    for (const operation of ["submit", "ack-commit", "sync-tracker", "finalize", "invalidate", "resume"]) {
      expectOptions(operation, casOptions);
    }

    expect(optionsFor("submit")).toContain("--bundle");
    expect(optionsFor("ack-commit")).toContain("--push-status");
    expect(optionsFor("ack-commit")).toContain("--remote-revision");
    expect(optionsFor("ack-commit")).not.toContain("--commit");
    expect(optionsFor("invalidate")).toContain("--reason");
    expect(optionsFor("resume")).toContain("--new-session");
    expect(optionsFor("resume")).toContain("--target-phase");
    expect(optionsFor("resume")).toContain("--max-attempts");
  });

  it("ships Codex discovery metadata and universal installation targets", () => {
    const openAiMetadata = read(
      ".opencode/skills/compounds/corgispec-loop/agents/openai.yaml",
    );
    expect(read(".claude/skills/compounds/corgispec-loop/agents/openai.yaml"))
      .toBe(openAiMetadata);
    expect(read("packages/corgispec/assets/skills/compounds/corgispec-loop/agents/openai.yaml"))
      .toBe(openAiMetadata);
    expect(openAiMetadata).toContain("$corgispec-loop");
    expect(openAiMetadata).toContain("allow_implicit_invocation: false");

    const metadata = JSON.parse(
      read(".opencode/skills/compounds/corgispec-loop/skill.meta.json"),
    );
    expect(metadata.installation.targets).toEqual(["opencode", "claude", "codex"]);
  });

  it("prohibits direct review artifact and human-triage writes", () => {
    expect(reviewLoop).toContain("Never read or write `.corgi/loop/**`");
    expect(reviewLoop).toContain("do not persist them yourself");
    expect(reviewLoop).toContain("Do not assign fingerprints");
    expect(reviewLoop).toContain("no finding was triaged");
  });

  it("routes both loop wrappers to the v2 skill", () => {
    expect(read(".opencode/commands/corgi-loop.md")).toContain("**corgispec-loop**");
    expect(read(".claude/commands/corgi/loop.md")).toContain("**corgispec-loop**");
    expect(read(".opencode/commands/corgi-loop.md")).toContain("explicit user entry point");
    expect(read(".claude/commands/corgi/loop.md")).toContain("explicit user entry point");
    expect(read("packages/corgispec/assets/commands/opencode/corgi-loop.md"))
      .toBe(read(".opencode/commands/corgi-loop.md"));
    expect(read("packages/corgispec/assets/commands/claude/corgi/loop.md"))
      .toBe(read(".claude/commands/corgi/loop.md"));
  });
});
