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
import { applyUserAssetPlan, planUserAssets } from "../src/lib/user-assets.js";

describe("user asset migration", () => {
  let root: string;
  let assetsRoot: string;
  let claudeSkills: string;
  let opencodeSkills: string;
  let codexSkills: string;
  let claudeCommands: string;
  let opencodeCommands: string;

  beforeEach(() => {
    root = resolve(tmpdir(), `corgispec-user-assets-${Date.now()}-${Math.random()}`);
    assetsRoot = resolve(root, "assets");
    claudeSkills = resolve(root, "home/claude-skills");
    opencodeSkills = resolve(root, "home/opencode-skills");
    codexSkills = resolve(root, "home/codex-skills");
    claudeCommands = resolve(root, "home/claude-commands");
    opencodeCommands = resolve(root, "home/opencode-commands");

    write(resolve(assetsRoot, "skills/molecules/corgispec-demo/SKILL.md"), [
      "---",
      "name: corgispec-demo",
      "---",
      "current",
      "",
    ].join("\n"));
    write(
      resolve(assetsRoot, "skills/molecules/corgispec-demo/skill.meta.json"),
      `${JSON.stringify({ slug: "corgispec-demo" })}\n`,
    );
    write(resolve(assetsRoot, "commands/claude/corgi/apply.md"), "Use $corgispec-apply-change\n");
    write(resolve(assetsRoot, "commands/opencode/corgi-apply.md"), "Use /corgi-apply\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("classifies package-owned stale assets and applies all requested platforms", () => {
    write(resolve(claudeSkills, "corgispec-demo/SKILL.md"), [
      "---",
      "name: corgispec-demo",
      "---",
      "old",
      "",
    ].join("\n"));
    write(
      resolve(claudeSkills, "corgispec-demo/skill.meta.json"),
      `${JSON.stringify({ slug: "corgispec-demo" })}\n`,
    );
    write(resolve(claudeCommands, "apply.md"), "Old $corgispec-apply-change dispatcher\n");
    write(resolve(claudeCommands, "human-qa.md"), "Use $corgispec-human-qa\n");

    const options = {
      assetsRoot,
      userSkillDirs: {
        claude: claudeSkills,
        opencode: opencodeSkills,
        codex: codexSkills,
      },
      userCommandDirs: {
        claude: claudeCommands,
        opencode: opencodeCommands,
      },
    };
    const plan = planUserAssets(options);

    expect(plan.conflicts).toEqual([]);
    expect(plan.actions).toContainEqual(expect.objectContaining({
      platform: "claude",
      kind: "skill",
      status: "outdated",
    }));
    expect(plan.actions).toContainEqual(expect.objectContaining({
      platform: "claude",
      name: "human-qa.md",
      status: "obsolete",
    }));

    const applied = applyUserAssetPlan(plan, { ...options, quiet: true });
    expect(applied.installedSkills).toBe(3);
    expect(applied.installedCommands).toBe(2);
    expect(readFileSync(resolve(claudeSkills, "corgispec-demo/SKILL.md"), "utf8")).toContain(
      "current",
    );
    expect(readFileSync(resolve(claudeCommands, "apply.md"), "utf8")).toContain(
      "$corgispec-apply-change",
    );
    expect(existsSync(resolve(claudeCommands, "human-qa.md"))).toBe(false);
  });

  it("marks user content without a Corgi identity as ambiguous", () => {
    write(resolve(claudeSkills, "corgispec-demo/SKILL.md"), "# personal replacement\n");
    write(resolve(claudeCommands, "apply.md"), "# personal command\n");

    const plan = planUserAssets({
      assetsRoot,
      platforms: ["claude"],
      userSkillDirs: { claude: claudeSkills },
      userCommandDirs: { claude: claudeCommands },
    });

    expect(plan.conflicts.map((conflict) => conflict.path).sort()).toEqual([
      resolve(claudeCommands, "apply.md"),
      resolve(claudeSkills, "corgispec-demo"),
    ].sort());
    expect(() => applyUserAssetPlan(plan, {
      assetsRoot,
      platforms: ["claude"],
      userSkillDirs: { claude: claudeSkills },
      userCommandDirs: { claude: claudeCommands },
      quiet: true,
    })).toThrow(/conflicts/u);
  });
});

function write(path: string, content: string): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content);
}
