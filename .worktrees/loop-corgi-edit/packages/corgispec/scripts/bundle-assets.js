#!/usr/bin/env node

/**
 * bundle-assets.js
 *
 * Copies skill files, command assets, memory-init templates, JSON schemas,
 * and workflow schemas from the repo
 * source-of-truth locations into the package's assets/ directory for distribution.
 *
 * Run as part of prepublishOnly: npm run build && node scripts/bundle-assets.js
 *
 * Asset sources:
 *   .opencode/skills/<tier>/corgispec-*  → assets/skills/<tier>/
 *   .opencode/commands/*.md      → assets/commands/opencode/
 *   .claude/commands/corgi/*.md   → assets/commands/claude/corgi/
 *   .opencode/skills/corgispec-memory-init/templates/** → assets/memory-init/templates/
 *   schemas/                     → assets/schemas/ (JSON Schema files for validation)
 *   openspec/schemas/            → assets/schemas/ (workflow schemas for init/doctor)
 */

import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const repoRoot = resolve(packageRoot, "../..");

const assetsDir = process.env.CORGISPEC_ASSETS_DIR
  ? resolve(process.env.CORGISPEC_ASSETS_DIR)
  : resolve(packageRoot, "assets");

// --- Clean and recreate assets directory ---
if (existsSync(assetsDir)) {
  rmSync(assetsDir, { recursive: true });
}
mkdirSync(assetsDir, { recursive: true });

let totalFiles = 0;
const errors = [];

function copyMarkdownFiles(sourceDir, destDir) {
  mkdirSync(destDir, { recursive: true });

  if (!existsSync(sourceDir)) {
    return 0;
  }

  const files = readdirSync(sourceDir).filter((file) => file.endsWith(".md"));
  for (const file of files) {
    cpSync(resolve(sourceDir, file), resolve(destDir, file));
  }

  return files.length;
}

// --- 1. Bundle skills from .opencode/skills/ (tiered: atoms/, molecules/, compounds/, + flat root) ---
const skillsSource = resolve(repoRoot, ".opencode/skills");
const skillsDest = resolve(assetsDir, "skills");
mkdirSync(skillsDest, { recursive: true });

const tierDirs = ["atoms", "molecules", "compounds"];

function bundleSkillEntry(entry, parentDir, tier) {
  if (!entry.isDirectory() || !entry.name.startsWith("corgispec-")) return false;
  const src = resolve(parentDir, entry.name);
  const destParent = tier ? resolve(skillsDest, tier) : skillsDest;
  mkdirSync(destParent, { recursive: true });
  const dest = resolve(destParent, entry.name);
  cpSync(src, dest, { recursive: true });

  if (!existsSync(resolve(dest, "SKILL.md"))) {
    errors.push(`${entry.name}: missing SKILL.md`);
  }
  if (!existsSync(resolve(dest, "skill.meta.json"))) {
    errors.push(`${entry.name}: missing skill.meta.json`);
  }
  return true;
}

if (existsSync(skillsSource)) {
  let skillCount = 0;

  // Scan tiered subdirectories first
  for (const tier of tierDirs) {
    const tierPath = resolve(skillsSource, tier);
    if (!existsSync(tierPath)) continue;
    const entries = readdirSync(tierPath, { withFileTypes: true });
    for (const entry of entries) {
      if (bundleSkillEntry(entry, tierPath, tier)) skillCount++;
    }
  }

  // Scan root for any remaining flat skills (backward compat)
  const rootEntries = readdirSync(skillsSource, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (tierDirs.includes(entry.name)) continue;
    if (bundleSkillEntry(entry, skillsSource, null)) skillCount++;
  }

  totalFiles += skillCount;
  console.log(`✓ Bundled ${skillCount} skills from ${skillsSource}`);
} else {
  errors.push(`Skills source not found at ${skillsSource}`);
}

// --- 2. Bundle project-local command assets ---
const opencodeCommandsSource = resolve(repoRoot, ".opencode/commands");
const opencodeCommandsDest = resolve(assetsDir, "commands/opencode");
const claudeCommandsSource = resolve(repoRoot, ".claude/commands/corgi");
const claudeCommandsDest = resolve(assetsDir, "commands/claude/corgi");

if (existsSync(opencodeCommandsSource)) {
  const commandCount = copyMarkdownFiles(opencodeCommandsSource, opencodeCommandsDest);
  totalFiles += commandCount;
  console.log(`✓ Bundled ${commandCount} OpenCode command(s) from ${opencodeCommandsSource}`);
} else {
  errors.push(`OpenCode commands source not found at ${opencodeCommandsSource}`);
}

if (existsSync(claudeCommandsSource)) {
  const commandCount = copyMarkdownFiles(claudeCommandsSource, claudeCommandsDest);
  totalFiles += commandCount;
  console.log(`✓ Bundled ${commandCount} Claude command(s) from ${claudeCommandsSource}`);
} else {
  errors.push(`Claude commands source not found at ${claudeCommandsSource}`);
}

// --- 3. Bundle corgispec-memory-init templates ---
const memoryInitTemplatesSource = resolve(
  repoRoot,
  ".opencode/skills/atoms/corgispec-memory-init/templates"
);
const memoryInitTemplatesDest = resolve(assetsDir, "memory-init/templates");

if (existsSync(memoryInitTemplatesSource)) {
  mkdirSync(resolve(assetsDir, "memory-init"), { recursive: true });
  cpSync(memoryInitTemplatesSource, memoryInitTemplatesDest, { recursive: true });
  totalFiles++;
  console.log(`✓ Bundled corgispec-memory-init templates from ${memoryInitTemplatesSource}`);
} else {
  errors.push(`Memory init templates source not found at ${memoryInitTemplatesSource}`);
}

// --- 4. Bundle JSON schemas (for skill validation) ---
const jsonSchemasSource = resolve(repoRoot, "schemas");
const schemasDest = resolve(assetsDir, "schemas");
mkdirSync(schemasDest, { recursive: true });

if (existsSync(jsonSchemasSource)) {
  const schemaFiles = readdirSync(jsonSchemasSource).filter((f) => f.endsWith(".json"));

  for (const file of schemaFiles) {
    cpSync(resolve(jsonSchemasSource, file), resolve(schemasDest, file));
    totalFiles++;
  }

  console.log(`✓ Bundled ${schemaFiles.length} JSON schema(s) from ${jsonSchemasSource}`);
} else {
  errors.push(`JSON schemas source not found at ${jsonSchemasSource}`);
}

// --- 5. Bundle workflow schemas (for init/doctor) ---
const workflowSchemasSource = resolve(repoRoot, "openspec/schemas");

if (existsSync(workflowSchemasSource)) {
  const entries = readdirSync(workflowSchemasSource, { withFileTypes: true });
  let workflowCount = 0;

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const src = resolve(workflowSchemasSource, entry.name);
      const dest = resolve(schemasDest, entry.name);
      cpSync(src, dest, { recursive: true });
      workflowCount++;

      // Validate: schema.yaml must exist in each workflow schema
      if (!existsSync(resolve(dest, "schema.yaml"))) {
        errors.push(`Workflow schema ${entry.name}: missing schema.yaml`);
      }
    }
  }

  totalFiles += workflowCount;
  console.log(`✓ Bundled ${workflowCount} workflow schema(s) from ${workflowSchemasSource}`);
} else {
  errors.push(`Workflow schemas source not found at ${workflowSchemasSource}`);
}

// --- 6. Content verification (checksum comparison) ---
console.log("\nVerifying bundled content...");
let verifyCount = 0;
let verifyErrors = 0;

function verifyFile(srcPath, destPath) {
  if (!existsSync(srcPath) || !existsSync(destPath)) {
    return false;
  }
  const srcHash = createHash("sha256").update(readFileSync(srcPath)).digest("hex");
  const destHash = createHash("sha256").update(readFileSync(destPath)).digest("hex");
  return srcHash === destHash;
}

// Verify skills
if (existsSync(skillsSource)) {
  function verifySkillEntries(parentDir, tier) {
    if (!existsSync(parentDir)) return;
    const entries = readdirSync(parentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith("corgispec-")) {
        for (const file of ["SKILL.md", "skill.meta.json"]) {
          const src = resolve(parentDir, entry.name, file);
          const destParent = tier ? resolve(skillsDest, tier) : skillsDest;
          const dest = resolve(destParent, entry.name, file);
          if (existsSync(src)) {
            if (verifyFile(src, dest)) {
              verifyCount++;
            } else {
              verifyErrors++;
              errors.push(`Checksum mismatch: ${entry.name}/${file}`);
            }
          }
        }
      }
    }
  }

  for (const tier of tierDirs) {
    verifySkillEntries(resolve(skillsSource, tier), tier);
  }
  verifySkillEntries(skillsSource, null);
}

// Verify JSON schemas
if (existsSync(jsonSchemasSource)) {
  for (const file of readdirSync(jsonSchemasSource).filter((f) => f.endsWith(".json"))) {
    if (verifyFile(resolve(jsonSchemasSource, file), resolve(schemasDest, file))) {
      verifyCount++;
    } else {
      verifyErrors++;
      errors.push(`Checksum mismatch: schemas/${file}`);
    }
  }
}

// Verify representative command and memory-init assets
for (const [label, src, dest] of [
  [
    "commands/opencode/corgi-install.md",
    resolve(opencodeCommandsSource, "corgi-install.md"),
    resolve(opencodeCommandsDest, "corgi-install.md"),
  ],
  [
    "commands/claude/corgi/install.md",
    resolve(claudeCommandsSource, "install.md"),
    resolve(claudeCommandsDest, "install.md"),
  ],
  [
    "memory-init/templates/session-memory-protocol.md",
    resolve(memoryInitTemplatesSource, "session-memory-protocol.md"),
    resolve(memoryInitTemplatesDest, "session-memory-protocol.md"),
  ],
]) {
  if (verifyFile(src, dest)) {
    verifyCount++;
  } else {
    verifyErrors++;
    errors.push(`Checksum mismatch: ${label}`);
  }
}

console.log(`✓ Verified ${verifyCount} file(s), ${verifyErrors} mismatch(es)`);

// --- Summary ---
console.log(`\nAssets bundled to ${assetsDir}`);
console.log(`Total: ${totalFiles} items bundled`);

if (errors.length > 0) {
  console.error("\nErrors:");
  for (const e of errors) {
    console.error(`  ✗ ${e}`);
  }
  process.exit(1);
}
