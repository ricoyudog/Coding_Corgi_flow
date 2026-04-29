import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSkillTable, filterSkills } from "../lib/list.js";
import { discoverSkills } from "../lib/loader.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");

describe("filterSkills", () => {
  it("filters by tier", async () => {
    const skills = await discoverSkills(fixturesDir);
    const valid = skills.filter((s) => s.meta);
    const atoms = filterSkills(valid, { tier: "atom" });
    assert.ok(atoms.every((s) => s.meta.tier === "atom"));
    assert.ok(atoms.some((s) => s.meta.slug === "resolve-config"));
  });

  it("filters by platform", async () => {
    const skills = await discoverSkills(fixturesDir);
    const valid = skills.filter((s) => s.meta);
    const universal = filterSkills(valid, { platform: "universal" });
    assert.ok(universal.every((s) => s.meta.platform === "universal"));
  });

  it("returns all when no filters", async () => {
    const skills = await discoverSkills(fixturesDir);
    const valid = skills.filter((s) => s.meta);
    const all = filterSkills(valid, {});
    assert.equal(all.length, valid.length);
  });
});

describe("buildSkillTable", () => {
  it("formats a table with slug, tier, platform, version columns", async () => {
    const skills = await discoverSkills(fixturesDir);
    const valid = skills.filter((s) => s.meta);
    const table = buildSkillTable(valid);
    assert.ok(table.includes("resolve-config"));
    assert.ok(table.includes("atom"));
    assert.ok(table.includes("universal"));
  });
});
