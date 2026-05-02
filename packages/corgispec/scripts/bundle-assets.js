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
 *   .opencode/skills/openspec-*  → assets/skills/
 *   .opencode/commands/*.md      → assets/commands/opencode/
 *   .claude/commands/opsx/*.md   → assets/commands/claude/opsx/
 *   .opencode/skills/openspec-memory-init/templates/** → assets/memory-init/templates/
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

// --- 1. Bundle skills from .opencode/skills/openspec-* ---
const skillsSource = resolve(repoRoot, ".opencode/skills");
const skillsDest = resolve(assetsDir, "skills");
mkdirSync(skillsDest, { recursive: true });

if (existsSync(skillsSource)) {
  const entries = readdirSync(skillsSource, { withFileTypes: true });
  let skillCount = 0;

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith("openspec-")) {
      const src = resolve(skillsSource, entry.name);
      const dest = resolve(skillsDest, entry.name);
      cpSync(src, dest, { recursive: true });
      skillCount++;

      // Validate: SKILL.md and skill.meta.json must exist
      if (!existsSync(resolve(dest, "SKILL.md"))) {
        errors.push(`${entry.name}: missing SKILL.md`);
      }
      if (!existsSync(resolve(dest, "skill.meta.json"))) {
        errors.push(`${entry.name}: missing skill.meta.json`);
      }
    }
  }

  totalFiles += skillCount;
  console.log(`✓ Bundled ${skillCount} skills from ${skillsSource}`);
} else {
  errors.push(`Skills source not found at ${skillsSource}`);
}

// --- 2. Bundle project-local command assets ---
const opencodeCommandsSource = resolve(repoRoot, ".opencode/commands");
const opencodeCommandsDest = resolve(assetsDir, "commands/opencode");
const claudeCommandsSource = resolve(repoRoot, ".claude/commands/opsx");
const claudeCommandsDest = resolve(assetsDir, "commands/claude/opsx");

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

// --- 3. Bundle openspec-memory-init templates ---
const memoryInitTemplatesSource = resolve(
  repoRoot,
  ".opencode/skills/openspec-memory-init/templates"
);
const memoryInitTemplatesDest = resolve(assetsDir, "memory-init/templates");

if (existsSync(memoryInitTemplatesSource)) {
  mkdirSync(resolve(assetsDir, "memory-init"), { recursive: true });
  cpSync(memoryInitTemplatesSource, memoryInitTemplatesDest, { recursive: true });
  totalFiles++;
  console.log(`✓ Bundled openspec-memory-init templates from ${memoryInitTemplatesSource}`);
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
  const entries = readdirSync(skillsSource, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith("openspec-")) {
      for (const file of ["SKILL.md", "skill.meta.json"]) {
        const src = resolve(skillsSource, entry.name, file);
        const dest = resolve(skillsDest, entry.name, file);
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
    "commands/opencode/opsx-install.md",
    resolve(opencodeCommandsSource, "opsx-install.md"),
    resolve(opencodeCommandsDest, "opsx-install.md"),
  ],
  [
    "commands/claude/opsx/install.md",
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
