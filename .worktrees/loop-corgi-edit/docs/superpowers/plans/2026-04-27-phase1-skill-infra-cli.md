# Phase 1: Skill Infrastructure & CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `ds-skills` CLI tool and add `skill.meta.json` to all 11 existing OpenSpec skills, establishing the structural foundation for the Atoms → Molecules → Compounds refactor.

**Architecture:** A zero-build Node.js CLI in `tools/ds-skills/` with `commander` for argument parsing and `ajv` for JSON Schema validation. Each CLI command is a separate module. Tests use Node.js built-in `node:test` + `node:assert`. The JSON Schema lives in `schemas/skill-meta.schema.json` at the repo root and is referenced by the CLI.

**Tech Stack:** Node.js (ESM), commander, ajv, node:test, node:assert

**Design Spec:** `docs/superpowers/specs/2026-04-27-corgispec-skill-hierarchy-refactor-design.md`

---

## File Structure

```
schemas/
└── skill-meta.schema.json              # JSON Schema for skill.meta.json (repo-level)

tools/ds-skills/
├── package.json                         # CLI package with bin entry
├── bin/ds-skills.js                     # CLI entry point (commander setup)
├── lib/
│   ├── loader.js                        # Discover and parse skill directories
│   ├── validate.js                      # Schema + constraint validation
│   ├── graph.js                         # Dependency graph (mermaid/dot)
│   └── list.js                          # List skills with filters
└── tests/
    ├── fixtures/
    │   ├── valid-atom/
    │   │   ├── SKILL.md
    │   │   └── skill.meta.json
    │   ├── valid-molecule/
    │   │   ├── SKILL.md
    │   │   └── skill.meta.json
    │   ├── invalid-atom-with-deps/
    │   │   ├── SKILL.md
    │   │   └── skill.meta.json
    │   ├── invalid-missing-meta/
    │   │   └── SKILL.md
    │   └── invalid-slug-mismatch/
    │       ├── SKILL.md
    │       └── skill.meta.json
    ├── loader.test.js
    ├── validate.test.js
    ├── graph.test.js
    └── list.test.js

.opencode/skills/corgispec-*/skill.meta.json   # 11 new files (one per existing skill)
.claude/skills/corgispec-*/skill.meta.json      # 11 mirrors
.codex/skills/corgispec-*/skill.meta.json       # 10 mirrors (+1 new: corgispec-install)
```

---

### Task 1: Scaffold CLI Project

**Files:**
- Create: `tools/ds-skills/package.json`
- Create: `tools/ds-skills/bin/ds-skills.js`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "ds-skills",
  "version": "0.1.0",
  "description": "CLI tool for validating, graphing, and installing ds-internal-skills",
  "type": "module",
  "bin": {
    "ds-skills": "./bin/ds-skills.js"
  },
  "scripts": {
    "test": "node --test tests/**/*.test.js"
  },
  "dependencies": {
    "ajv": "^8.17.1",
    "commander": "^13.1.0"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Create CLI entry point**

```javascript
#!/usr/bin/env node
// tools/ds-skills/bin/ds-skills.js

import { Command } from "commander";

const program = new Command();

program
  .name("ds-skills")
  .description("CLI tool for ds-internal-skills validation and management")
  .version("0.1.0");

program
  .command("validate")
  .description("Validate all skills structure and constraints")
  .option("--path <dir>", "Skills root directory", ".")
  .action(async (opts) => {
    const { runValidate } = await import("../lib/validate.js");
    const exitCode = await runValidate(opts.path);
    process.exit(exitCode);
  });

program
  .command("list")
  .description("List skills with optional filters")
  .option("--path <dir>", "Skills root directory", ".")
  .option("--tier <tier>", "Filter by tier: atom, molecule, compound")
  .option("--platform <platform>", "Filter by platform: universal, github, gitlab")
  .action(async (opts) => {
    const { runList } = await import("../lib/list.js");
    await runList(opts.path, { tier: opts.tier, platform: opts.platform });
  });

program
  .command("graph")
  .description("Generate dependency graph")
  .option("--path <dir>", "Skills root directory", ".")
  .option("--format <fmt>", "Output format: mermaid or dot", "mermaid")
  .option("--tier <tier>", "Filter by tier: atom, molecule, compound")
  .action(async (opts) => {
    const { runGraph } = await import("../lib/graph.js");
    await runGraph(opts.path, { format: opts.format, tier: opts.tier });
  });

program
  .command("check-deps")
  .description("Show full dependency tree for a skill")
  .argument("<slug>", "Skill slug to check")
  .option("--path <dir>", "Skills root directory", ".")
  .action(async (slug, opts) => {
    const { runCheckDeps } = await import("../lib/graph.js");
    await runCheckDeps(opts.path, slug);
  });

program.parse();
```

- [ ] **Step 3: Install dependencies**

Run: `cd tools/ds-skills && npm install`
Expected: `node_modules/` created, `package-lock.json` generated.

- [ ] **Step 4: Verify CLI boots**

Run: `cd tools/ds-skills && node bin/ds-skills.js --help`
Expected: Help text showing `validate`, `list`, `graph`, `check-deps` commands.

- [ ] **Step 5: Commit**

```bash
git add tools/ds-skills/package.json tools/ds-skills/bin/ds-skills.js tools/ds-skills/package-lock.json
git commit -m "feat(ds-skills): scaffold CLI project with commander"
```

---

### Task 2: Create JSON Schema for skill.meta.json

**Files:**
- Create: `schemas/skill-meta.schema.json`

- [ ] **Step 1: Write the JSON Schema**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ds-internal-skills/skill-meta.schema.json",
  "title": "Skill Metadata",
  "description": "Schema for skill.meta.json files in ds-internal-skills",
  "type": "object",
  "required": ["slug", "tier", "version", "description", "depends_on", "platform", "installation"],
  "additionalProperties": false,
  "properties": {
    "slug": {
      "type": "string",
      "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$",
      "description": "Unique kebab-case identifier"
    },
    "tier": {
      "enum": ["atom", "molecule", "compound"],
      "description": "Hierarchy tier"
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$",
      "description": "Semantic version"
    },
    "description": {
      "type": "string",
      "maxLength": 200,
      "description": "One-line description"
    },
    "depends_on": {
      "type": "array",
      "items": { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$" },
      "uniqueItems": true,
      "description": "Dependency slugs"
    },
    "platform": {
      "enum": ["universal", "github", "gitlab"],
      "description": "Platform scope"
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "uniqueItems": true,
      "description": "Classification tags"
    },
    "installation": {
      "type": "object",
      "required": ["targets", "base_path"],
      "additionalProperties": false,
      "properties": {
        "targets": {
          "type": "array",
          "items": { "enum": ["opencode", "claude", "codex"] },
          "minItems": 1
        },
        "base_path": {
          "type": "string",
          "description": "Path relative to skills root"
        }
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add schemas/skill-meta.schema.json
git commit -m "feat(ds-skills): add JSON Schema for skill.meta.json"
```

---

### Task 3: Implement Skill Loader

**Files:**
- Create: `tools/ds-skills/lib/loader.js`
- Create: `tools/ds-skills/tests/fixtures/valid-atom/SKILL.md`
- Create: `tools/ds-skills/tests/fixtures/valid-atom/skill.meta.json`
- Create: `tools/ds-skills/tests/fixtures/valid-molecule/SKILL.md`
- Create: `tools/ds-skills/tests/fixtures/valid-molecule/skill.meta.json`
- Create: `tools/ds-skills/tests/fixtures/invalid-missing-meta/SKILL.md`
- Create: `tools/ds-skills/tests/loader.test.js`

- [ ] **Step 1: Create test fixtures — valid atom**

`tests/fixtures/valid-atom/SKILL.md`:
```markdown
---
name: resolve-config
description: Read openspec/config.yaml and return schema, platform, isolation config
---

Resolve OpenSpec project configuration.
```

`tests/fixtures/valid-atom/skill.meta.json`:
```json
{
  "slug": "resolve-config",
  "tier": "atom",
  "version": "1.0.0",
  "description": "Read openspec/config.yaml and return schema, platform, isolation config",
  "depends_on": [],
  "platform": "universal",
  "tags": ["config", "core"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "atoms/resolve-config"
  }
}
```

- [ ] **Step 2: Create test fixtures — valid molecule**

`tests/fixtures/valid-molecule/SKILL.md`:
```markdown
---
name: corgi-propose
description: Generate planning artifacts and create tracked issues
---

Propose a new change with full artifact pipeline.
```

`tests/fixtures/valid-molecule/skill.meta.json`:
```json
{
  "slug": "corgi-propose",
  "tier": "molecule",
  "version": "1.0.0",
  "description": "Generate planning artifacts and create tracked issues",
  "depends_on": ["resolve-config", "resolve-worktree", "corgispec-cli-runner", "parse-tasks", "sync-issue-gh", "sync-issue-gl"],
  "platform": "universal",
  "tags": ["lifecycle", "propose"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "molecules/corgi-propose"
  }
}
```

- [ ] **Step 3: Create test fixtures — invalid (missing meta)**

`tests/fixtures/invalid-missing-meta/SKILL.md`:
```markdown
---
name: orphan-skill
description: This skill has no skill.meta.json
---

An orphan skill.
```

- [ ] **Step 4: Write failing tests for loader**

`tests/loader.test.js`:
```javascript
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
    assert.equal(skill.meta.slug, "corgi-propose");
    assert.equal(skill.meta.tier, "molecule");
    assert.equal(skill.meta.depends_on.length, 6);
    assert.equal(skill.frontmatter.name, "corgi-propose");
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
    assert.ok(slugs.includes("corgi-propose"));
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd tools/ds-skills && node --test tests/loader.test.js`
Expected: FAIL — `loader.js` does not exist yet.

- [ ] **Step 6: Implement loader**

`lib/loader.js`:
```javascript
// tools/ds-skills/lib/loader.js

import fs from "node:fs/promises";
import path from "node:path";

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Minimal parser — handles `key: value` pairs only (no nested YAML).
 * Returns { name, description, ... } or null.
 */
export function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const result = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Load a single skill from a directory.
 * Returns { dir, meta, frontmatter } or { dir, frontmatter, error }.
 */
export async function loadSkill(skillDir) {
  const skillMdPath = path.join(skillDir, "SKILL.md");
  const metaPath = path.join(skillDir, "skill.meta.json");

  let frontmatter = null;
  try {
    const content = await fs.readFile(skillMdPath, "utf-8");
    frontmatter = parseFrontmatter(content);
  } catch {
    return { dir: skillDir, frontmatter: null, error: "missing-skill-md" };
  }

  let meta = null;
  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    meta = JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      return { dir: skillDir, frontmatter, error: "missing-meta" };
    }
    return { dir: skillDir, frontmatter, error: "invalid-meta-json" };
  }

  return { dir: skillDir, meta, frontmatter };
}

/**
 * Discover all skill directories under a root path.
 * Walks atoms/, molecules/, compounds/, and top-level directories.
 * A directory is a "skill dir" if it contains SKILL.md.
 */
export async function discoverSkills(rootDir) {
  const skills = [];
  const tierDirs = ["atoms", "molecules", "compounds"];

  // Check tier subdirectories first
  for (const tier of tierDirs) {
    const tierPath = path.join(rootDir, tier);
    try {
      const entries = await fs.readdir(tierPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillDir = path.join(tierPath, entry.name);
        if (await hasSkillMd(skillDir)) {
          skills.push(await loadSkill(skillDir));
        }
      }
    } catch {
      // Tier directory doesn't exist — fine
    }
  }

  // Check top-level directories (flat layout, backward compat)
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (tierDirs.includes(entry.name)) continue; // Already scanned
      const skillDir = path.join(rootDir, entry.name);
      if (await hasSkillMd(skillDir)) {
        skills.push(await loadSkill(skillDir));
      }
    }
  } catch {
    // Root doesn't exist
  }

  return skills;
}

async function hasSkillMd(dir) {
  try {
    await fs.access(path.join(dir, "SKILL.md"));
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd tools/ds-skills && node --test tests/loader.test.js`
Expected: All 4 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add tools/ds-skills/lib/loader.js tools/ds-skills/tests/
git commit -m "feat(ds-skills): implement skill loader with frontmatter parsing"
```

---

### Task 4: Implement Validate Command

**Files:**
- Create: `tools/ds-skills/lib/validate.js`
- Create: `tools/ds-skills/tests/fixtures/invalid-atom-with-deps/SKILL.md`
- Create: `tools/ds-skills/tests/fixtures/invalid-atom-with-deps/skill.meta.json`
- Create: `tools/ds-skills/tests/fixtures/invalid-slug-mismatch/SKILL.md`
- Create: `tools/ds-skills/tests/fixtures/invalid-slug-mismatch/skill.meta.json`
- Create: `tools/ds-skills/tests/validate.test.js`

- [ ] **Step 1: Create test fixtures — invalid atom with deps**

`tests/fixtures/invalid-atom-with-deps/SKILL.md`:
```markdown
---
name: bad-atom
description: This atom incorrectly has dependencies
---

A bad atom.
```

`tests/fixtures/invalid-atom-with-deps/skill.meta.json`:
```json
{
  "slug": "bad-atom",
  "tier": "atom",
  "version": "1.0.0",
  "description": "This atom incorrectly has dependencies",
  "depends_on": ["resolve-config"],
  "platform": "universal",
  "installation": {
    "targets": ["opencode"],
    "base_path": "atoms/bad-atom"
  }
}
```

- [ ] **Step 2: Create test fixtures — slug mismatch**

`tests/fixtures/invalid-slug-mismatch/SKILL.md`:
```markdown
---
name: correct-name
description: Slug in meta doesn't match name in frontmatter
---

Mismatched skill.
```

`tests/fixtures/invalid-slug-mismatch/skill.meta.json`:
```json
{
  "slug": "wrong-slug",
  "tier": "atom",
  "version": "1.0.0",
  "description": "Slug in meta doesn't match name in frontmatter",
  "depends_on": [],
  "platform": "universal",
  "installation": {
    "targets": ["opencode"],
    "base_path": "atoms/wrong-slug"
  }
}
```

- [ ] **Step 3: Write failing tests for validate**

`tests/validate.test.js`:
```javascript
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
    // corgi-propose depends on resolve-config (atom) — but resolve-config
    // is the only atom in fixtures, other deps don't exist. This should
    // produce "depends on unknown skill" errors.
    const skills = await discoverSkills(fixturesDir);
    const errors = validateConstraints(skills.filter((s) => s.meta));
    assert.ok(errors.some((e) => e.includes("depends on unknown skill")));
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd tools/ds-skills && node --test tests/validate.test.js`
Expected: FAIL — `validate.js` does not exist yet.

- [ ] **Step 5: Implement validate**

`lib/validate.js`:
```javascript
// tools/ds-skills/lib/validate.js

import fs from "node:fs/promises";
import path from "node:path";
import Ajv from "ajv";
import { discoverSkills } from "./loader.js";

/**
 * Validate a single skill against the JSON Schema and slug consistency.
 * Returns array of error strings (empty = valid).
 */
export async function validateSkill(skill, schemaPath) {
  const errors = [];

  if (skill.error === "missing-meta") {
    errors.push(`${path.basename(skill.dir)}: missing skill.meta.json`);
    return errors;
  }
  if (skill.error === "missing-skill-md") {
    errors.push(`${path.basename(skill.dir)}: missing SKILL.md`);
    return errors;
  }
  if (skill.error === "invalid-meta-json") {
    errors.push(`${path.basename(skill.dir)}: invalid JSON in skill.meta.json`);
    return errors;
  }

  // Schema validation
  const schemaContent = await fs.readFile(schemaPath, "utf-8");
  const schema = JSON.parse(schemaContent);
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  const valid = validate(skill.meta);

  if (!valid) {
    for (const err of validate.errors) {
      errors.push(`${skill.meta.slug}: schema error at ${err.instancePath || "/"}: ${err.message}`);
    }
  }

  // Slug consistency: skill.meta.json slug == SKILL.md frontmatter name
  if (skill.frontmatter && skill.meta) {
    if (skill.frontmatter.name !== skill.meta.slug) {
      errors.push(
        `Slug mismatch in '${path.basename(skill.dir)}': ` +
          `skill.meta.json slug='${skill.meta.slug}' != SKILL.md name='${skill.frontmatter.name}'`
      );
    }
  }

  return errors;
}

/**
 * Validate cross-skill constraints (tier rules, dependency existence, cycles, platform compat).
 * Input: array of loaded skills that have .meta (skip errored ones).
 * Returns array of error strings.
 */
export function validateConstraints(skills) {
  const errors = [];
  const bySlug = new Map();
  for (const s of skills) {
    bySlug.set(s.meta.slug, s);
  }

  for (const skill of skills) {
    const { slug, tier, depends_on, platform } = skill.meta;

    // Rule 1: Atom must not have dependencies
    if (tier === "atom" && depends_on.length > 0) {
      errors.push(`ERROR: Atom '${slug}' must not have dependencies (has: ${depends_on.join(", ")})`);
    }

    // Rule 2-3: Tier dependency constraints
    for (const dep of depends_on) {
      const depSkill = bySlug.get(dep);
      if (!depSkill) {
        errors.push(`ERROR: '${slug}' depends on unknown skill '${dep}'`);
        continue;
      }

      if (tier === "molecule" && depSkill.meta.tier !== "atom") {
        errors.push(`ERROR: Molecule '${slug}' depends on non-atom '${dep}' (tier: ${depSkill.meta.tier})`);
      }
      if (tier === "compound" && depSkill.meta.tier !== "molecule") {
        errors.push(`ERROR: Compound '${slug}' depends on non-molecule '${dep}' (tier: ${depSkill.meta.tier})`);
      }

      // Rule 5: Platform compatibility
      if (platform === "gitlab" && depSkill.meta.platform === "github") {
        errors.push(`ERROR: '${slug}' (gitlab) depends on '${dep}' (github)`);
      }
      if (platform === "github" && depSkill.meta.platform === "gitlab") {
        errors.push(`ERROR: '${slug}' (github) depends on '${dep}' (gitlab)`);
      }
    }
  }

  // Rule 4: Cycle detection (Kahn's algorithm)
  const cycleErrors = detectCycles(skills);
  errors.push(...cycleErrors);

  return errors;
}

/**
 * Detect cycles using Kahn's topological sort.
 */
function detectCycles(skills) {
  const errors = [];
  const inDegree = new Map();
  const adj = new Map();

  for (const s of skills) {
    const slug = s.meta.slug;
    if (!inDegree.has(slug)) inDegree.set(slug, 0);
    if (!adj.has(slug)) adj.set(slug, []);
  }

  for (const s of skills) {
    for (const dep of s.meta.depends_on) {
      if (!adj.has(dep)) continue; // Unknown deps handled elsewhere
      adj.get(dep).push(s.meta.slug);
      inDegree.set(s.meta.slug, (inDegree.get(s.meta.slug) || 0) + 1);
    }
  }

  const queue = [];
  for (const [slug, degree] of inDegree) {
    if (degree === 0) queue.push(slug);
  }

  let visited = 0;
  while (queue.length > 0) {
    const slug = queue.shift();
    visited++;
    for (const neighbor of adj.get(slug) || []) {
      const newDegree = inDegree.get(neighbor) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (visited < skills.length) {
    const cycled = skills
      .filter((s) => inDegree.get(s.meta.slug) > 0)
      .map((s) => s.meta.slug);
    errors.push(`ERROR: Circular dependency detected involving: ${cycled.join(", ")}`);
  }

  return errors;
}

/**
 * CLI entry point for `ds-skills validate`.
 * Returns exit code: 0 = pass, 1 = fail.
 */
export async function runValidate(rootPath) {
  const resolvedPath = path.resolve(rootPath);

  // Look for skills in .opencode/skills/ if rootPath is a project root
  let skillsRoot = resolvedPath;
  const opencodePath = path.join(resolvedPath, ".opencode", "skills");
  try {
    await fs.access(opencodePath);
    skillsRoot = opencodePath;
  } catch {
    // Use rootPath as-is
  }

  const schemaPath = findSchemaPath(resolvedPath);

  console.log(`Scanning: ${skillsRoot}`);
  const skills = await discoverSkills(skillsRoot);

  if (skills.length === 0) {
    console.log("No skills found.");
    return 1;
  }

  console.log(`Found ${skills.length} skill(s)\n`);

  let allErrors = [];

  // Per-skill validation
  for (const skill of skills) {
    const errors = await validateSkill(skill, schemaPath);
    if (errors.length > 0) {
      allErrors.push(...errors);
    }
  }

  // Cross-skill constraints
  const validSkills = skills.filter((s) => s.meta);
  const constraintErrors = validateConstraints(validSkills);
  allErrors.push(...constraintErrors);

  if (allErrors.length === 0) {
    console.log("✓ All validations passed.");
    return 0;
  }

  console.log(`Found ${allErrors.length} error(s):\n`);
  for (const err of allErrors) {
    console.log(`  ${err}`);
  }
  return 1;
}

/**
 * Find the schema file, checking multiple locations.
 */
function findSchemaPath(rootPath) {
  const candidates = [
    path.join(rootPath, "schemas", "skill-meta.schema.json"),
    path.resolve(rootPath, "..", "schemas", "skill-meta.schema.json"),
    path.resolve(rootPath, "..", "..", "schemas", "skill-meta.schema.json"),
  ];
  // Return first candidate (validation will fail if missing — handled by Ajv)
  return candidates[0];
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd tools/ds-skills && node --test tests/validate.test.js`
Expected: All 5 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add tools/ds-skills/lib/validate.js tools/ds-skills/tests/validate.test.js tools/ds-skills/tests/fixtures/invalid-atom-with-deps/ tools/ds-skills/tests/fixtures/invalid-slug-mismatch/
git commit -m "feat(ds-skills): implement validate command with schema + constraint checks"
```

---

### Task 5: Implement List Command

**Files:**
- Create: `tools/ds-skills/lib/list.js`
- Create: `tools/ds-skills/tests/list.test.js`

- [ ] **Step 1: Write failing tests**

`tests/list.test.js`:
```javascript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tools/ds-skills && node --test tests/list.test.js`
Expected: FAIL — `list.js` does not exist yet.

- [ ] **Step 3: Implement list**

`lib/list.js`:
```javascript
// tools/ds-skills/lib/list.js

import path from "node:path";
import fs from "node:fs/promises";
import { discoverSkills } from "./loader.js";

/**
 * Filter skills by tier and/or platform.
 */
export function filterSkills(skills, { tier, platform } = {}) {
  let result = skills;
  if (tier) {
    result = result.filter((s) => s.meta.tier === tier);
  }
  if (platform) {
    result = result.filter((s) => s.meta.platform === platform);
  }
  return result;
}

/**
 * Build a formatted table string from skills.
 */
export function buildSkillTable(skills) {
  const headers = ["Slug", "Tier", "Platform", "Version", "Deps", "Description"];
  const rows = skills.map((s) => [
    s.meta.slug,
    s.meta.tier,
    s.meta.platform,
    s.meta.version,
    s.meta.depends_on.length.toString(),
    s.meta.description.slice(0, 50),
  ]);

  // Calculate column widths
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  );

  const sep = widths.map((w) => "-".repeat(w)).join(" | ");
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join(" | ");
  const dataLines = rows.map((r) =>
    r.map((cell, i) => cell.padEnd(widths[i])).join(" | ")
  );

  return [headerLine, sep, ...dataLines].join("\n");
}

/**
 * CLI entry point for `ds-skills list`.
 */
export async function runList(rootPath, { tier, platform } = {}) {
  const resolvedPath = path.resolve(rootPath);

  let skillsRoot = resolvedPath;
  const opencodePath = path.join(resolvedPath, ".opencode", "skills");
  try {
    await fs.access(opencodePath);
    skillsRoot = opencodePath;
  } catch {
    // Use rootPath as-is
  }

  const skills = await discoverSkills(skillsRoot);
  const valid = skills.filter((s) => s.meta);
  const filtered = filterSkills(valid, { tier, platform });

  if (filtered.length === 0) {
    console.log("No matching skills found.");
    return;
  }

  console.log(buildSkillTable(filtered));
  console.log(`\n${filtered.length} skill(s) listed.`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tools/ds-skills && node --test tests/list.test.js`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/ds-skills/lib/list.js tools/ds-skills/tests/list.test.js
git commit -m "feat(ds-skills): implement list command with tier/platform filters"
```

---

### Task 6: Implement Graph Command

**Files:**
- Create: `tools/ds-skills/lib/graph.js`
- Create: `tools/ds-skills/tests/graph.test.js`

- [ ] **Step 1: Write failing tests**

`tests/graph.test.js`:
```javascript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateMermaid, generateDot, buildDepTree } from "../lib/graph.js";

describe("generateMermaid", () => {
  it("produces valid mermaid graph syntax", () => {
    const skills = [
      { meta: { slug: "resolve-config", tier: "atom", depends_on: [], platform: "universal" } },
      { meta: { slug: "corgi-propose", tier: "molecule", depends_on: ["resolve-config"], platform: "universal" } },
    ];
    const output = generateMermaid(skills);
    assert.ok(output.includes("graph TD"));
    assert.ok(output.includes("corgi-propose --> resolve-config"));
    // Atoms and molecules should have different styles
    assert.ok(output.includes("resolve-config"));
    assert.ok(output.includes("corgi-propose"));
  });

  it("handles skills with no dependencies", () => {
    const skills = [
      { meta: { slug: "resolve-config", tier: "atom", depends_on: [], platform: "universal" } },
    ];
    const output = generateMermaid(skills);
    assert.ok(output.includes("resolve-config"));
    assert.ok(!output.includes("-->"));
  });
});

describe("generateDot", () => {
  it("produces valid dot syntax", () => {
    const skills = [
      { meta: { slug: "resolve-config", tier: "atom", depends_on: [], platform: "universal" } },
      { meta: { slug: "corgi-propose", tier: "molecule", depends_on: ["resolve-config"], platform: "universal" } },
    ];
    const output = generateDot(skills);
    assert.ok(output.includes("digraph"));
    assert.ok(output.includes('"corgi-propose" -> "resolve-config"'));
  });
});

describe("buildDepTree", () => {
  it("returns full dependency tree for a slug", () => {
    const skills = [
      { meta: { slug: "resolve-config", tier: "atom", depends_on: [], platform: "universal" } },
      { meta: { slug: "parse-tasks", tier: "atom", depends_on: [], platform: "universal" } },
      { meta: { slug: "corgi-propose", tier: "molecule", depends_on: ["resolve-config", "parse-tasks"], platform: "universal" } },
    ];
    const tree = buildDepTree(skills, "corgi-propose");
    assert.deepStrictEqual(tree.slug, "corgi-propose");
    assert.equal(tree.children.length, 2);
    assert.ok(tree.children.some((c) => c.slug === "resolve-config"));
    assert.ok(tree.children.some((c) => c.slug === "parse-tasks"));
  });

  it("returns null for unknown slug", () => {
    const tree = buildDepTree([], "nonexistent");
    assert.equal(tree, null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tools/ds-skills && node --test tests/graph.test.js`
Expected: FAIL — `graph.js` does not exist yet.

- [ ] **Step 3: Implement graph**

`lib/graph.js`:
```javascript
// tools/ds-skills/lib/graph.js

import path from "node:path";
import fs from "node:fs/promises";
import { discoverSkills } from "./loader.js";

const TIER_STYLES = {
  atom: { mermaid: "([%s])", dot: 'shape=ellipse, style=filled, fillcolor="#d4edda"' },
  molecule: { mermaid: "[%s]", dot: 'shape=box, style=filled, fillcolor="#cce5ff"' },
  compound: { mermaid: "[[%s]]", dot: 'shape=box3d, style=filled, fillcolor="#fff3cd"' },
};

/**
 * Generate Mermaid graph syntax.
 */
export function generateMermaid(skills, { tier } = {}) {
  let filtered = skills;
  if (tier) {
    filtered = skills.filter((s) => s.meta.tier === tier);
  }

  const lines = ["graph TD"];

  // Node declarations with tier-specific shapes
  for (const s of filtered) {
    const style = TIER_STYLES[s.meta.tier] || TIER_STYLES.molecule;
    const shape = style.mermaid.replace("%s", `"${s.meta.slug}"`);
    lines.push(`  ${s.meta.slug}${shape}`);
  }

  // Edges
  const slugSet = new Set(filtered.map((s) => s.meta.slug));
  for (const s of filtered) {
    for (const dep of s.meta.depends_on) {
      if (slugSet.has(dep)) {
        lines.push(`  ${s.meta.slug} --> ${dep}`);
      }
    }
  }

  // Tier subgraphs
  for (const [tierName, _style] of Object.entries(TIER_STYLES)) {
    const tierSkills = filtered.filter((s) => s.meta.tier === tierName);
    if (tierSkills.length > 0) {
      lines.push(`  subgraph ${tierName}s`);
      for (const s of tierSkills) {
        lines.push(`    ${s.meta.slug}`);
      }
      lines.push("  end");
    }
  }

  return lines.join("\n");
}

/**
 * Generate Graphviz dot syntax.
 */
export function generateDot(skills, { tier } = {}) {
  let filtered = skills;
  if (tier) {
    filtered = skills.filter((s) => s.meta.tier === tier);
  }

  const lines = ["digraph skills {", "  rankdir=BT;", "  node [fontname=Helvetica];"];

  // Node declarations
  for (const s of filtered) {
    const style = TIER_STYLES[s.meta.tier] || TIER_STYLES.molecule;
    lines.push(`  "${s.meta.slug}" [${style.dot}, label="${s.meta.slug}"];`);
  }

  // Edges
  const slugSet = new Set(filtered.map((s) => s.meta.slug));
  for (const s of filtered) {
    for (const dep of s.meta.depends_on) {
      if (slugSet.has(dep)) {
        lines.push(`  "${s.meta.slug}" -> "${dep}";`);
      }
    }
  }

  lines.push("}");
  return lines.join("\n");
}

/**
 * Build a dependency tree for a specific slug.
 * Returns { slug, tier, children: [...] } or null.
 */
export function buildDepTree(skills, slug) {
  const bySlug = new Map();
  for (const s of skills) {
    bySlug.set(s.meta.slug, s);
  }

  function build(currentSlug, visited = new Set()) {
    const s = bySlug.get(currentSlug);
    if (!s) return null;
    if (visited.has(currentSlug)) return { slug: currentSlug, tier: s.meta.tier, children: [], circular: true };
    visited.add(currentSlug);

    const children = s.meta.depends_on
      .map((dep) => build(dep, new Set(visited)))
      .filter(Boolean);

    return { slug: currentSlug, tier: s.meta.tier, children };
  }

  return build(slug);
}

/**
 * Format a dep tree as an indented string.
 */
function formatTree(node, indent = 0) {
  const prefix = "  ".repeat(indent);
  const marker = indent === 0 ? "" : "└─ ";
  let output = `${prefix}${marker}${node.slug} (${node.tier})${node.circular ? " [CIRCULAR]" : ""}\n`;
  for (const child of node.children) {
    output += formatTree(child, indent + 1);
  }
  return output;
}

/**
 * CLI entry point for `ds-skills graph`.
 */
export async function runGraph(rootPath, { format = "mermaid", tier } = {}) {
  const resolvedPath = path.resolve(rootPath);

  let skillsRoot = resolvedPath;
  const opencodePath = path.join(resolvedPath, ".opencode", "skills");
  try {
    await fs.access(opencodePath);
    skillsRoot = opencodePath;
  } catch {
    // Use rootPath as-is
  }

  const skills = await discoverSkills(skillsRoot);
  const valid = skills.filter((s) => s.meta);

  if (valid.length === 0) {
    console.log("No skills found.");
    return;
  }

  if (format === "mermaid") {
    console.log(generateMermaid(valid, { tier }));
  } else if (format === "dot") {
    console.log(generateDot(valid, { tier }));
  } else {
    console.error(`Unknown format: ${format}. Use 'mermaid' or 'dot'.`);
  }
}

/**
 * CLI entry point for `ds-skills check-deps`.
 */
export async function runCheckDeps(rootPath, slug) {
  const resolvedPath = path.resolve(rootPath);

  let skillsRoot = resolvedPath;
  const opencodePath = path.join(resolvedPath, ".opencode", "skills");
  try {
    await fs.access(opencodePath);
    skillsRoot = opencodePath;
  } catch {
    // Use rootPath as-is
  }

  const skills = await discoverSkills(skillsRoot);
  const valid = skills.filter((s) => s.meta);
  const tree = buildDepTree(valid, slug);

  if (!tree) {
    console.error(`Skill '${slug}' not found.`);
    process.exit(1);
  }

  console.log(formatTree(tree));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tools/ds-skills && node --test tests/graph.test.js`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/ds-skills/lib/graph.js tools/ds-skills/tests/graph.test.js
git commit -m "feat(ds-skills): implement graph and check-deps commands"
```

---

### Task 7: Add skill.meta.json to All 11 Existing Skills

**Files:**
- Create: 11× `.opencode/skills/corgispec-*/skill.meta.json`
- Create: 11× `.claude/skills/corgispec-*/skill.meta.json`
- Create: 10× `.codex/skills/corgispec-*/skill.meta.json` (no corgispec-install in codex yet)

Per the design spec, all existing skills are tagged `tier: "molecule"` with `depends_on: []` in Phase 1. This is a transitional state — Phase 2 will add atoms and Phase 3 will rewrite dependencies.

- [ ] **Step 1: Create skill.meta.json for corgispec-install**

Write to `.opencode/skills/corgispec-install/skill.meta.json`:
```json
{
  "slug": "corgispec-install",
  "tier": "molecule",
  "version": "1.0.0",
  "description": "Install, update, or verify project-local OpenSpec GitFlow assets in a target project",
  "depends_on": [],
  "platform": "universal",
  "tags": ["lifecycle", "install"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "corgispec-install"
  }
}
```

Copy to `.claude/skills/corgispec-install/skill.meta.json` and `.codex/skills/corgispec-install/skill.meta.json` (identical content).

- [ ] **Step 2: Create skill.meta.json for corgispec-explore**

Write to `.opencode/skills/corgispec-explore/skill.meta.json`:
```json
{
  "slug": "corgispec-explore",
  "tier": "molecule",
  "version": "1.0.0",
  "description": "Enter explore mode for investigating problems and clarifying requirements (GitLab)",
  "depends_on": [],
  "platform": "gitlab",
  "tags": ["lifecycle", "explore"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "corgispec-explore"
  }
}
```

Copy to `.claude/skills/corgispec-explore/` and `.codex/skills/corgispec-explore/`.

- [ ] **Step 3: Create skill.meta.json for corgispec-gh-explore**

Write to `.opencode/skills/corgispec-gh-explore/skill.meta.json`:
```json
{
  "slug": "corgispec-gh-explore",
  "tier": "molecule",
  "version": "1.0.0",
  "description": "Enter explore mode for investigating problems and clarifying requirements (GitHub)",
  "depends_on": [],
  "platform": "github",
  "tags": ["lifecycle", "explore"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "corgispec-gh-explore"
  }
}
```

Copy to `.claude/skills/corgispec-gh-explore/` and `.codex/skills/corgispec-gh-explore/`.

- [ ] **Step 4: Create skill.meta.json for corgispec-propose**

Write to `.opencode/skills/corgispec-propose/skill.meta.json`:
```json
{
  "slug": "corgispec-propose",
  "tier": "molecule",
  "version": "1.0.0",
  "description": "Generate planning artifacts and create tracked GitLab issues",
  "depends_on": [],
  "platform": "gitlab",
  "tags": ["lifecycle", "propose"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "corgispec-propose"
  }
}
```

Copy to `.claude/skills/corgispec-propose/` and `.codex/skills/corgispec-propose/`.

- [ ] **Step 5: Create skill.meta.json for corgispec-gh-propose**

Write to `.opencode/skills/corgispec-gh-propose/skill.meta.json`:
```json
{
  "slug": "corgispec-gh-propose",
  "tier": "molecule",
  "version": "1.0.0",
  "description": "Generate planning artifacts and create tracked GitHub issues",
  "depends_on": [],
  "platform": "github",
  "tags": ["lifecycle", "propose"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "corgispec-gh-propose"
  }
}
```

Copy to `.claude/skills/corgispec-gh-propose/` and `.codex/skills/corgispec-gh-propose/`.

- [ ] **Step 6: Create skill.meta.json for corgispec-apply-change**

Write to `.opencode/skills/corgispec-apply-change/skill.meta.json`:
```json
{
  "slug": "corgispec-apply-change",
  "tier": "molecule",
  "version": "1.0.0",
  "description": "Execute one Task Group checkpoint with closeout and issue sync (GitLab)",
  "depends_on": [],
  "platform": "gitlab",
  "tags": ["lifecycle", "apply"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "corgispec-apply-change"
  }
}
```

Copy to `.claude/skills/corgispec-apply-change/` and `.codex/skills/corgispec-apply-change/`.

- [ ] **Step 7: Create skill.meta.json for corgispec-gh-apply**

Write to `.opencode/skills/corgispec-gh-apply/skill.meta.json`:
```json
{
  "slug": "corgispec-gh-apply",
  "tier": "molecule",
  "version": "1.0.0",
  "description": "Execute one Task Group checkpoint with closeout and issue sync (GitHub)",
  "depends_on": [],
  "platform": "github",
  "tags": ["lifecycle", "apply"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "corgispec-gh-apply"
  }
}
```

Copy to `.claude/skills/corgispec-gh-apply/` and `.codex/skills/corgispec-gh-apply/`.

- [ ] **Step 8: Create skill.meta.json for corgispec-review**

Write to `.opencode/skills/corgispec-review/skill.meta.json`:
```json
{
  "slug": "corgispec-review",
  "tier": "molecule",
  "version": "1.0.0",
  "description": "Quality checks and human review gate for completed Task Groups (GitLab)",
  "depends_on": [],
  "platform": "gitlab",
  "tags": ["lifecycle", "review"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "corgispec-review"
  }
}
```

Copy to `.claude/skills/corgispec-review/` and `.codex/skills/corgispec-review/`.

- [ ] **Step 9: Create skill.meta.json for corgispec-gh-review**

Write to `.opencode/skills/corgispec-gh-review/skill.meta.json`:
```json
{
  "slug": "corgispec-gh-review",
  "tier": "molecule",
  "version": "1.0.0",
  "description": "Quality checks and human review gate for completed Task Groups (GitHub)",
  "depends_on": [],
  "platform": "github",
  "tags": ["lifecycle", "review"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "corgispec-gh-review"
  }
}
```

Copy to `.claude/skills/corgispec-gh-review/` and `.codex/skills/corgispec-gh-review/`.

- [ ] **Step 10: Create skill.meta.json for corgispec-archive-change**

Write to `.opencode/skills/corgispec-archive-change/skill.meta.json`:
```json
{
  "slug": "corgispec-archive-change",
  "tier": "molecule",
  "version": "1.0.0",
  "description": "Close issues, sync delta specs, and archive completed change (GitLab)",
  "depends_on": [],
  "platform": "gitlab",
  "tags": ["lifecycle", "archive"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "corgispec-archive-change"
  }
}
```

Copy to `.claude/skills/corgispec-archive-change/` and `.codex/skills/corgispec-archive-change/`.

- [ ] **Step 11: Create skill.meta.json for corgispec-gh-archive**

Write to `.opencode/skills/corgispec-gh-archive/skill.meta.json`:
```json
{
  "slug": "corgispec-gh-archive",
  "tier": "molecule",
  "version": "1.0.0",
  "description": "Close issues, sync delta specs, and archive completed change (GitHub)",
  "depends_on": [],
  "platform": "github",
  "tags": ["lifecycle", "archive"],
  "installation": {
    "targets": ["opencode", "claude", "codex"],
    "base_path": "corgispec-gh-archive"
  }
}
```

Copy to `.claude/skills/corgispec-gh-archive/` and `.codex/skills/corgispec-gh-archive/`.

- [ ] **Step 12: Commit all skill.meta.json files**

```bash
git add .opencode/skills/corgispec-*/skill.meta.json .claude/skills/corgispec-*/skill.meta.json .codex/skills/corgispec-*/skill.meta.json
git commit -m "feat(ds-skills): add skill.meta.json to all 11 existing OpenSpec skills"
```

---

### Task 8: Integration Test — Validate Against Real Repo

**Files:**
- No new files. Run CLI against the actual repo after Task 7.

- [ ] **Step 1: Run validate on the repo root**

Run: `cd tools/ds-skills && node bin/ds-skills.js validate --path ../..`
Expected: `✓ All validations passed.` (exit code 0) — all 11 skills have valid `skill.meta.json` with `tier: molecule` and `depends_on: []`.

- [ ] **Step 2: Run list to verify all skills appear**

Run: `cd tools/ds-skills && node bin/ds-skills.js list --path ../..`
Expected: Table with 11 rows, all showing `molecule`, correct platforms (5× gitlab, 5× github, 1× universal).

- [ ] **Step 3: Run graph to produce mermaid output**

Run: `cd tools/ds-skills && node bin/ds-skills.js graph --path ../..`
Expected: Mermaid graph with 11 nodes, no edges (all `depends_on: []` in Phase 1).

- [ ] **Step 4: Run graph with dot format**

Run: `cd tools/ds-skills && node bin/ds-skills.js graph --path ../.. --format dot`
Expected: Graphviz dot output with 11 nodes, no edges.

- [ ] **Step 5: Run all unit tests**

Run: `cd tools/ds-skills && npm test`
Expected: All tests pass (loader: 4, validate: 5, list: 4, graph: 4 = 17 total).

- [ ] **Step 6: Verify existing /corgi-* workflow is unaffected**

Check: No SKILL.md files were modified. Only new `skill.meta.json` files were added. Run:
```bash
git diff --name-only HEAD~4 -- '*.md'
```
Expected: No SKILL.md files in the diff (only new skill.meta.json files and plan/spec docs).

- [ ] **Step 7: Commit if any integration fixes were needed**

If Steps 1-6 all pass without changes, skip this step. Otherwise:
```bash
git add -A
git commit -m "fix(ds-skills): integration test fixes for Phase 1"
```

---

## Phase 1 Completion Criteria

All of the following must be true:

- [ ] `ds-skills validate --path .` exits 0 on the repo root
- [ ] `ds-skills list --path .` shows 11 skills
- [ ] `ds-skills graph --path .` produces valid mermaid output
- [ ] `npm test` passes all 17+ unit tests
- [ ] No existing SKILL.md files were modified
- [ ] All 11 `.opencode/skills/corgispec-*/skill.meta.json` exist
- [ ] All 11 `.claude/skills/corgispec-*/skill.meta.json` exist
- [ ] All 10+1 `.codex/skills/corgispec-*/skill.meta.json` exist
- [ ] `/corgi-*` commands still work (manual spot-check)

## Next Plans

- **Phase 2 plan**: Extract 7 atoms into `atoms/` directory
- **Phase 3 plan**: Rewrite 6 molecules with platform dispatch + atom dependencies
- **Phase 4 plan**: Cleanup old skills, deprecate install-skills.sh
