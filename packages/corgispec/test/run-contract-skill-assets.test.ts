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
  const openCodeApply = read(".opencode/skills/compounds/corgispec-apply/SKILL.md");
  const claudeApply = read(".claude/skills/compounds/corgispec-apply/SKILL.md");
  const bundledApply = read("packages/corgispec/assets/skills/compounds/corgispec-apply/SKILL.md");
  const reviewLoop = read(".opencode/skills/molecules/corgispec-review-loop/SKILL.md");

  it("keeps the platform-independent apply contract while requiring explicit invocation", () => {
    expect(claudeApply).toBe(openCodeApply);
    expect(bundledApply).toBe(openCodeApply);
    expect(openCodeApply).toContain("Run Contract v2 CLI as the lifecycle authority");
    expect(openCodeApply).toContain("only user-facing implementation entry");
    expect(openCodeApply).toContain('opencode/autoinvoke: "false"');
    expect(openCodeApply).toContain("disable-model-invocation: true");
    expect(openCodeApply).toContain("Never create, edit, rename, or delete `.corgi/loop/**` files");
    expect(openCodeApply).toContain("stateRevision");
    expect(openCodeApply).toContain("nonce");
    expect(openCodeApply).toContain("corgispec loop submit");
    expect(openCodeApply).toContain("corgispec loop ack-commit");
    expect(openCodeApply).toContain("corgispec loop sync-tracker");
    expect(openCodeApply).toContain("they never run `sync-tracker`, `gh`, `glab`");
    expect(openCodeApply).toContain("corgispec loop finalize");
    expect(openCodeApply).toContain("Prefer a safe evidence draft");
    expect(openCodeApply).toContain("Omit evidence bindings, entry bindings");
    expect(openCodeApply).toContain("never send a partial binding or hash claim");
    expect(openCodeApply).toContain("Give every approved Task Group its own new commit");
    expect(openCodeApply).toContain("Never combine multiple Task Groups in one commit");
    expect(openCodeApply).toContain("Passing evaluation does not complete a group");
    expect(openCodeApply).toContain("Do not run tracker sync or begin another group before acknowledgement succeeds");
  });

  it("documents only valid lifecycle argv and complete CAS tokens", () => {
    expect(openCodeApply).toContain(
      'corgispec loop init "<change>" --owner "<actor>" --session "<session>" --mode "<self-driven|hook-driven>" --json',
    );
    expect(openCodeApply).toContain('corgispec loop inspect "<change>" --json');

    for (const operation of ["submit", "ack-commit", "sync-tracker", "finalize", "invalidate", "resume"]) {
      const invocation = openCodeApply
        .split("\n")
        .find((line) => line.includes(`corgispec loop ${operation} "<change>"`));
      expect(invocation, `${operation} invocation should be documented`).toBeDefined();
      expect(invocation).toContain('--run-id "<runId>"');
      expect(invocation).toContain("--session");
      expect(invocation).toContain("--state-revision <n>");
      expect(invocation).toContain('--nonce "<nonce>"');
      expect(invocation).toContain("--json");
    }

    expect(openCodeApply).toContain('--reason "<reason>"');
    expect(openCodeApply).toContain('--new-session "<newSessionId>"');
    expect(openCodeApply).toContain('--push-status pushed --remote-revision "<revision>"');
    expect(openCodeApply).not.toContain("--commit");
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
      ".opencode/skills/compounds/corgispec-apply/agents/openai.yaml",
    );
    expect(read(".claude/skills/compounds/corgispec-apply/agents/openai.yaml"))
      .toBe(openAiMetadata);
    expect(read("packages/corgispec/assets/skills/compounds/corgispec-apply/agents/openai.yaml"))
      .toBe(openAiMetadata);
    expect(openAiMetadata).toContain("$corgispec-apply");
    expect(openAiMetadata).toContain("allow_implicit_invocation: false");

    const metadata = JSON.parse(
      read(".opencode/skills/compounds/corgispec-apply/skill.meta.json"),
    );
    expect(metadata.version).toBe("2.1.0");
    expect(metadata.installation.targets).toEqual(["opencode", "claude", "codex"]);
    expect(metadata.depends_on).not.toContain("corgispec-apply-change");
    expect(metadata.depends_on).not.toContain("corgispec-gh-apply");
  });

  it("prohibits direct review artifact and human-triage writes", () => {
    expect(reviewLoop).toContain("Never read or write `.corgi/loop/**`");
    expect(reviewLoop).toContain("do not persist them yourself");
    expect(reviewLoop).toContain("Do not assign fingerprints");
    expect(reviewLoop).toContain("no finding was triaged");
  });

  it("routes both apply wrappers to the v2 skill", () => {
    expect(read(".opencode/commands/corgi-apply.md")).toContain("**corgispec-apply**");
    expect(read(".claude/commands/corgi/apply.md")).toContain("**corgispec-apply**");
    expect(read(".opencode/commands/corgi-apply.md")).toContain("sole user-facing implementation entry");
    expect(read(".claude/commands/corgi/apply.md")).toContain("sole user-facing implementation entry");
    expect(read(".opencode/commands/corgi-apply.md")).toContain("own acknowledged commit");
    expect(read(".claude/commands/corgi/apply.md")).toContain("own acknowledged commit");
    expect(read("packages/corgispec/assets/commands/opencode/corgi-apply.md"))
      .toBe(read(".opencode/commands/corgi-apply.md"));
    expect(read("packages/corgispec/assets/commands/claude/corgi/apply.md"))
      .toBe(read(".claude/commands/corgi/apply.md"));
  });

  it("publishes apply as the only implementation command", () => {
    for (const path of ["README.md", "README.zh-TW.md", "INSTALL.md"]) {
      const content = read(path);
      expect(content, path).not.toMatch(/\/corgi(?:-|:)loop\b/u);
    }
    expect(read("README.md")).toContain("only public implementation entry");
    expect(read("README.zh-TW.md")).toContain("唯一公開的實作入口");
  });
});
