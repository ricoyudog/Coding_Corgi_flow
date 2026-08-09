import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GATE_PATTERN = /\*\*Context Gate\*\*.*isolation\.mode.*active changes.*current branch/;

const GATED_SKILLS = [
  "corgispec-archive-change",
  "corgispec-verify",
  "corgispec-review",
  "corgispec-propose",
  "corgispec-explore",
  "corgispec-ask",
  "corgispec-lint",
  "corgispec-install",
  "corgispec-memory-migrate",
];

const PROJECT_ROOT = resolve(__dirname, "../../../..");
const SKILL_ROOT = resolve(PROJECT_ROOT, ".opencode/skills/molecules");

describe("validate gate check", () => {
  for (const skill of GATED_SKILLS) {
    it(`${skill}/SKILL.md contains the canonical Context Gate`, () => {
      const skillPath = resolve(SKILL_ROOT, skill, "SKILL.md");
      const content = readFileSync(skillPath, "utf-8");
      expect(content).toMatch(GATE_PATTERN);
    });
  }

  it("all gated skills are byte-identical across .opencode and .claude directories", () => {
    for (const skill of GATED_SKILLS) {
      const opencodePath = resolve(PROJECT_ROOT, `.opencode/skills/molecules/${skill}/SKILL.md`);
      const claudePath = resolve(PROJECT_ROOT, `.claude/skills/molecules/${skill}/SKILL.md`);

      const opencodeContent = readFileSync(opencodePath, "utf-8");
      const claudeContent = readFileSync(claudePath, "utf-8");

      expect(opencodeContent).toBe(claudeContent);
    }
  });
});
