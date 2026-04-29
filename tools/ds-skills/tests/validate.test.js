import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateSkill, validateConstraints } from "../lib/validate.js";
import { loadSkill, discoverSkills } from "../lib/loader.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");
const schemaPath = path.resolve(__dirname, "../../../schemas/skill-meta.schema.json");

describe("validateSkill (schema validation)", () => {
  it("passes for valid atom", async () => {
    const skill = await loadSkill(path.join(fixturesDir, "valid-atom"));
    const errors = await validateSkill(skill, schemaPath);
    assert.deepStrictEqual(errors, []);
  });

  it("passes for valid molecule", async () => {
    const skill = await loadSkill(path.join(fixturesDir, "valid-molecule"));
    const errors = await validateSkill(skill, schemaPath);
    assert.deepStrictEqual(errors, []);
  });

  it("reports error for missing skill.meta.json", async () => {
    const skill = await loadSkill(path.join(fixturesDir, "invalid-missing-meta"));
    const errors = await validateSkill(skill, schemaPath);
    assert.ok(errors.length > 0);
    assert.ok(errors[0].includes("missing skill.meta.json"));
  });

  it("reports error for slug mismatch with frontmatter", async () => {
    const skill = await loadSkill(path.join(fixturesDir, "invalid-slug-mismatch"));
    const errors = await validateSkill(skill, schemaPath);
    assert.ok(errors.some((e) => e.includes("Slug mismatch")));
  });
});

describe("validateConstraints (cross-skill rules)", () => {
  it("reports error when atom has dependencies", async () => {
    const skills = await discoverSkills(fixturesDir);
    const errors = validateConstraints(skills.filter((s) => s.meta));
    assert.ok(errors.some((e) => e.includes("Atom") && e.includes("must not have dependencies")));
  });

  it("reports error when molecule depends on non-atom", async () => {
    const skills = await discoverSkills(fixturesDir);
    const errors = validateConstraints(skills.filter((s) => s.meta));
    assert.ok(errors.some((e) => e.includes("depends on unknown skill")));
  });
});
