import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverSkills,
  validateSkill,
  validateAllSkills,
  filterSkills,
  type DiscoveredSkill,
} from "../src/lib/skills.js";

const TEST_DIR = resolve(tmpdir(), "corgispec-skills-test-" + Date.now());

function createValidSkill(dir: string, slug: string, overrides?: Partial<any>) {
  const skillDir = resolve(dir, slug);
  mkdirSync(skillDir, { recursive: true });

  const meta = {
    slug,
    tier: "atom",
    version: "1.0.0",
    description: `Test skill: ${slug}`,
    depends_on: [],
    platform: "universal",
    installation: { targets: ["opencode", "claude"], base_path: slug },
    ...overrides,
  };

  writeFileSync(resolve(skillDir, "skill.meta.json"), JSON.stringify(meta, null, 2));
  writeFileSync(resolve(skillDir, "SKILL.md"), `# ${slug}\n\nTest skill content.`);

  return { skillDir, meta };
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("discoverSkills", () => {
  it("discovers skills with skill.meta.json", () => {
    createValidSkill(TEST_DIR, "test-skill-a");
    createValidSkill(TEST_DIR, "test-skill-b");

    const skills = discoverSkills(TEST_DIR);
    expect(skills.length).toBe(2);
    expect(skills.map((s) => s.slug).sort()).toEqual(["test-skill-a", "test-skill-b"]);
  });

  it("ignores directories without skill.meta.json", () => {
    createValidSkill(TEST_DIR, "valid-skill");
    mkdirSync(resolve(TEST_DIR, "not-a-skill"), { recursive: true });
    writeFileSync(resolve(TEST_DIR, "not-a-skill/README.md"), "just a readme");

    const skills = discoverSkills(TEST_DIR);
    expect(skills.length).toBe(1);
    expect(skills[0]!.slug).toBe("valid-skill");
  });

  it("returns empty array for nonexistent directory", () => {
    const skills = discoverSkills("/nonexistent/path");
    expect(skills).toEqual([]);
  });

  it("detects missing SKILL.md", () => {
    const skillDir = resolve(TEST_DIR, "no-readme");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      resolve(skillDir, "skill.meta.json"),
      JSON.stringify({
        slug: "no-readme",
        tier: "atom",
        version: "1.0.0",
        description: "Missing SKILL.md",
        depends_on: [],
        platform: "universal",
        installation: { targets: ["opencode"], base_path: "no-readme" },
      })
    );

    const skills = discoverSkills(TEST_DIR);
    expect(skills.length).toBe(1);
    expect(skills[0]!.hasSkillMd).toBe(false);
  });
});

describe("validateSkill", () => {
  it("returns no issues for a valid skill", () => {
    createValidSkill(TEST_DIR, "valid-skill");
    const skills = discoverSkills(TEST_DIR);
    const allSkills = new Map(skills.map((s) => [s.slug, s.meta.tier] as [string, string]));

    const issues = validateSkill(skills[0]!, allSkills);
    expect(issues).toEqual([]);
  });

  it("accepts a semantic prerelease version", () => {
    createValidSkill(TEST_DIR, "release-candidate", { version: "4.0.0-rc1" });
    const skills = discoverSkills(TEST_DIR);
    const allSkills = new Map(skills.map((skill) => [skill.slug, skill.meta.tier] as [string, string]));

    expect(validateSkill(skills[0]!, allSkills)).toEqual([]);
  });

  it("reports missing SKILL.md", () => {
    const skillDir = resolve(TEST_DIR, "no-md");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      resolve(skillDir, "skill.meta.json"),
      JSON.stringify({
        slug: "no-md",
        tier: "atom",
        version: "1.0.0",
        description: "No SKILL.md",
        depends_on: [],
        platform: "universal",
        installation: { targets: ["opencode"], base_path: "no-md" },
      })
    );

    const skills = discoverSkills(TEST_DIR);
    const allSkills = new Map(skills.map((s) => [s.slug, s.meta.tier] as [string, string]));
    const issues = validateSkill(skills[0]!, allSkills);

    expect(issues).toContain("Missing SKILL.md");
  });

  it("reports slug mismatch", () => {
    createValidSkill(TEST_DIR, "dir-name", { slug: "different-slug" });
    const skills = discoverSkills(TEST_DIR);
    const allSkills = new Map(skills.map((s) => [s.slug, s.meta.tier] as [string, string]));

    const issues = validateSkill(skills[0]!, allSkills);
    expect(issues.some((i) => i.includes("Slug mismatch"))).toBe(true);
  });

  it("reports atom with dependencies", () => {
    createValidSkill(TEST_DIR, "atom-with-deps", {
      tier: "atom",
      depends_on: ["some-other"],
    });
    const skills = discoverSkills(TEST_DIR);
    const allSkills = new Map(skills.map((s) => [s.slug, s.meta.tier] as [string, string]));

    const issues = validateSkill(skills[0]!, allSkills);
    expect(issues).toContain("Atom skills must not have dependencies");
  });

  it("reports missing dependency", () => {
    createValidSkill(TEST_DIR, "mol-skill", {
      tier: "molecule",
      depends_on: ["nonexistent-dep"],
    });
    const skills = discoverSkills(TEST_DIR);
    const allSkills = new Map(skills.map((s) => [s.slug, s.meta.tier] as [string, string]));

    const issues = validateSkill(skills[0]!, allSkills);
    expect(issues).toContain("Dependency 'nonexistent-dep' not found");
  });

  it("reports malformed legacy dependency metadata without crashing", () => {
    createValidSkill(TEST_DIR, "legacy-skill", {
      depends_on: undefined,
      dependencies: { molecules: ["other-skill"] },
    });
    const skills = discoverSkills(TEST_DIR);
    const allSkills = new Map(skills.map((s) => [s.slug, s.meta.tier] as [string, string]));

    expect(() => validateSkill(skills[0]!, allSkills)).not.toThrow();
    const issues = validateSkill(skills[0]!, allSkills);
    expect(issues.some((issue) => issue.startsWith("Schema:"))).toBe(true);
  });
});

describe("validateAllSkills", () => {
  it("returns empty array when all valid", () => {
    createValidSkill(TEST_DIR, "skill-a");
    createValidSkill(TEST_DIR, "skill-b");

    const issues = validateAllSkills(TEST_DIR);
    expect(issues).toEqual([]);
  });

  it("returns issues for invalid skills", () => {
    createValidSkill(TEST_DIR, "good-skill");
    // Create a bad skill with no SKILL.md
    const badDir = resolve(TEST_DIR, "bad-skill");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(
      resolve(badDir, "skill.meta.json"),
      JSON.stringify({
        slug: "bad-skill",
        tier: "atom",
        version: "1.0.0",
        description: "Bad skill",
        depends_on: [],
        platform: "universal",
        installation: { targets: ["opencode"], base_path: "bad-skill" },
      })
    );

    const issues = validateAllSkills(TEST_DIR);
    expect(issues.length).toBe(1);
    expect(issues[0]!.slug).toBe("bad-skill");
    expect(issues[0]!.issues).toContain("Missing SKILL.md");
  });
});

describe("filterSkills", () => {
  it("filters by tier", () => {
    createValidSkill(TEST_DIR, "atom-skill", { tier: "atom" });
    createValidSkill(TEST_DIR, "mol-skill", { tier: "molecule", depends_on: [] });

    const skills = discoverSkills(TEST_DIR);
    const atoms = filterSkills(skills, { tier: "atom" });
    expect(atoms.length).toBe(1);
    expect(atoms[0]!.slug).toBe("atom-skill");
  });

  it("filters by platform", () => {
    createValidSkill(TEST_DIR, "github-skill", { platform: "github" });
    createValidSkill(TEST_DIR, "universal-skill", { platform: "universal" });

    const skills = discoverSkills(TEST_DIR);
    const github = filterSkills(skills, { platform: "github" });
    expect(github.length).toBe(1);
    expect(github[0]!.slug).toBe("github-skill");
  });

  it("combines tier and platform filters", () => {
    createValidSkill(TEST_DIR, "s1", { tier: "atom", platform: "github" });
    createValidSkill(TEST_DIR, "s2", { tier: "molecule", platform: "github", depends_on: [] });
    createValidSkill(TEST_DIR, "s3", { tier: "atom", platform: "gitlab" });

    const skills = discoverSkills(TEST_DIR);
    const filtered = filterSkills(skills, { tier: "atom", platform: "github" });
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.slug).toBe("s1");
  });
});
