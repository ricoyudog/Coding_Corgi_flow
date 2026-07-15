#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const canonicalRoot = resolve(repoRoot, ".opencode/skills");
const claudeRoot = resolve(repoRoot, ".claude/skills");

// These assets intentionally use platform-specific state formats or exist only
// in the canonical distribution source. Every other shared skill asset must be
// byte-identical so lifecycle contract changes cannot drift between platforms.
const allowedDifferences = [
  "atoms/corgispec-memory-init/templates/",
  "compounds/corgispec-loop/SKILL.md",
  "compounds/corgispec-loop/skill.meta.json",
  "molecules/corgispec-human-qa/skill.meta.json",
  "molecules/corgispec-review-loop/SKILL.md",
  "molecules/corgispec-review-loop/skill.meta.json",
  "references/",
];

function collectFiles(root) {
  const files = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        files.set(relative(root, absolute).split("\\").join("/"), absolute);
      }
    }
  };
  visit(root);
  return files;
}

function isAllowed(path) {
  return allowedDifferences.some((allowed) =>
    allowed.endsWith("/") ? path.startsWith(allowed) : path === allowed
  );
}

if (!existsSync(canonicalRoot) || !existsSync(claudeRoot)) {
  throw new Error("Both .opencode/skills and .claude/skills are required for mirror validation.");
}

const canonical = collectFiles(canonicalRoot);
const claude = collectFiles(claudeRoot);
const paths = [...new Set([...canonical.keys(), ...claude.keys()])].sort();
const failures = [];

for (const path of paths) {
  if (isAllowed(path)) continue;
  const canonicalPath = canonical.get(path);
  const claudePath = claude.get(path);
  if (!canonicalPath || !claudePath) {
    failures.push(`${path}: missing from ${canonicalPath ? "Claude" : "OpenCode"} mirror`);
    continue;
  }
  if (!readFileSync(canonicalPath).equals(readFileSync(claudePath))) {
    failures.push(`${path}: content differs`);
  }
}

if (failures.length > 0) {
  console.error("Skill mirror validation failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Skill mirrors valid (${paths.filter((path) => !isAllowed(path)).length} shared files checked).`);
}
