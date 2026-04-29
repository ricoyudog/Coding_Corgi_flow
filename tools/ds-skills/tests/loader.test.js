import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadSkill, discoverSkills } from "../lib/loader.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");

describe("loadSkill", () => {
  it("loads a valid atom with SKILL.md frontmatter and skill.meta.json", async () => {
    const skill = await loadSkill(path.join(fixturesDir, "valid-atom"));
    assert.equal(skill.meta.slug, "resolve-config");
    assert.equal(skill.meta.tier, "atom");
    assert.deepStrictEqual(skill.meta.depends_on, []);
    assert.equal(skill.frontmatter.name, "resolve-config");
    assert.equal(skill.dir, path.join(fixturesDir, "valid-atom"));
  });

  it("loads a valid molecule with dependencies", async () => {
    const skill = await loadSkill(path.join(fixturesDir, "valid-molecule"));
    assert.equal(skill.meta.slug, "opsx-propose");
    assert.equal(skill.meta.tier, "molecule");
    assert.equal(skill.meta.depends_on.length, 6);
    assert.equal(skill.frontmatter.name, "opsx-propose");
  });

  it("returns error for directory missing skill.meta.json", async () => {
    const skill = await loadSkill(path.join(fixturesDir, "invalid-missing-meta"));
    assert.equal(skill.error, "missing-meta");
    assert.equal(skill.frontmatter.name, "orphan-skill");
  });
});

describe("discoverSkills", () => {
  it("discovers all skills in fixtures directory", async () => {
    const skills = await discoverSkills(fixturesDir);
    assert.ok(skills.length >= 3, `Expected >= 3 skills, got ${skills.length}`);
    const slugs = skills
      .filter((s) => s.meta)
      .map((s) => s.meta.slug);
    assert.ok(slugs.includes("resolve-config"));
    assert.ok(slugs.includes("opsx-propose"));
  });
});
