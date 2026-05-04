# Single-Entry Bootstrap Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single `corgispec bootstrap` entrypoint plus a fetchable `.opencode/INSTALL.md` so agents can install or upgrade a project without reconstructing the workflow from scattered docs.

**Architecture:** Keep the existing low-level primitives (`corgispec install`, `/corgi-install`) but add a new orchestration layer in `packages/corgispec/` that owns prerequisite checks, target-state classification, user-level skill sync, project-local asset sync, and report generation. Bundle the project-local command files and memory-init templates into CLI assets so the bootstrap command can operate from the published package instead of depending on a cloned source repo.

**Tech Stack:** TypeScript, Commander, Vitest, Node.js fs/path/crypto/child_process, YAML config files, markdown command assets

**Design Spec:** `docs/superpowers/specs/2026-05-02-single-entry-bootstrap-install-design.md`

---

## File Structure

```
packages/corgispec/
├── scripts/bundle-assets.js                     # Extend bundling to include commands + memory templates
├── src/bin/corgispec.ts                         # Register bootstrap command
├── src/commands/bootstrap.ts                    # CLI surface for bootstrap
├── src/lib/bootstrap.ts                         # Orchestration flow + result types
├── src/lib/install-assets.ts                    # Shared asset discovery / copy / hashing helpers
├── src/lib/memory-init.ts                       # Template-based memory bootstrap for target projects
├── src/lib/bootstrap-report.ts                  # Install manifest + report writers
└── test/
    ├── bootstrap.test.ts                        # End-to-end CLI scenarios
    ├── install-assets.test.ts                   # State classification, config patching, hashing
    └── memory-init.test.ts                      # Template copy + protocol injection idempotency

.opencode/
└── INSTALL.md                                   # Agent-facing single entrypoint document

README.md                                        # Reduce quick start to single-entry model
README.zh-TW.md                                  # Same change for zh-TW
docs/superpowers/plans/2026-05-02-single-entry-bootstrap-install.md
```

### Responsibility Notes

- `src/lib/install-assets.ts` should become the shared home for asset-path discovery, managed-files enumeration, sha256 helpers, and config patching so the bootstrap path does not duplicate logic across `install.ts`, `init.ts`, and future commands.
- `src/lib/memory-init.ts` should use the existing `.opencode/skills/corgispec-memory-init/templates/**` content as the source of truth by bundling those files into package assets.
- `src/lib/bootstrap.ts` should own the high-level flow and return a structured result object that both human-readable and JSON output can use.
- `bootstrap.test.ts` should validate the CLI contract from the compiled binary, matching the existing `init.test.ts` and `doctor.test.ts` style.

---

### Task 1: Bundle project-local command assets and memory-init templates

**Files:**
- Modify: `packages/corgispec/scripts/bundle-assets.js`
- Test: `packages/corgispec/test/install-assets.test.ts`

- [ ] **Step 1: Write the failing asset-bundle test for command assets**

```ts
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

describe("bundled install assets", () => {
  it("includes OpenCode and Claude command assets", () => {
    const packageRoot = resolve(__dirname, "..");
    expect(
      existsSync(resolve(packageRoot, "assets/commands/opencode/corgi-install.md"))
    ).toBe(true);
    expect(
      existsSync(resolve(packageRoot, "assets/commands/claude/corgi/install.md"))
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run the new test to verify it fails before implementation**

Run: `cd packages/corgispec && npm test -- install-assets.test.ts`
Expected: FAIL because `assets/commands/...` does not exist yet.

- [ ] **Step 3: Extend `bundle-assets.js` to copy command assets and memory templates**

Add two new bundle sections after the existing skill/schema sections:

```js
// --- Bundle project-local command assets ---
const commandSources = [
  {
    src: resolve(repoRoot, ".opencode/commands"),
    dest: resolve(assetsDir, "commands/opencode"),
    filter: (name) => name.startsWith("corgi-") && name.endsWith(".md"),
  },
  {
    src: resolve(repoRoot, ".claude/commands/corgi"),
    dest: resolve(assetsDir, "commands/claude/corgi"),
    filter: (name) => name.endsWith(".md"),
  },
];

for (const source of commandSources) {
  mkdirSync(source.dest, { recursive: true });
  if (!existsSync(source.src)) {
    errors.push(`Command source not found at ${source.src}`);
    continue;
  }
  for (const file of readdirSync(source.src).filter(source.filter)) {
    cpSync(resolve(source.src, file), resolve(source.dest, file));
    totalFiles++;
  }
}

// --- Bundle memory-init templates ---
const memoryTemplateSource = resolve(
  repoRoot,
  ".opencode/skills/corgispec-memory-init/templates"
);
const memoryTemplateDest = resolve(assetsDir, "memory-init/templates");
if (existsSync(memoryTemplateSource)) {
  cpSync(memoryTemplateSource, memoryTemplateDest, { recursive: true });
  totalFiles++;
} else {
  errors.push(`Memory-init template source not found at ${memoryTemplateSource}`);
}
```

- [ ] **Step 4: Add checksum verification for the new bundled files**

Add verification loops for:

```js
verifyFile(
  resolve(repoRoot, ".opencode/commands/corgi-install.md"),
  resolve(assetsDir, "commands/opencode/corgi-install.md")
);

verifyFile(
  resolve(repoRoot, ".claude/commands/corgi/install.md"),
  resolve(assetsDir, "commands/claude/corgi/install.md")
);

verifyFile(
  resolve(
    repoRoot,
    ".opencode/skills/corgispec-memory-init/templates/session-memory-protocol.md"
  ),
  resolve(assetsDir, "memory-init/templates/session-memory-protocol.md")
);
```

- [ ] **Step 5: Rebuild assets and rerun the targeted test**

Run: `cd packages/corgispec && npm run build && node scripts/bundle-assets.js && npm test -- install-assets.test.ts`
Expected: PASS and output includes the bundled commands and memory templates.

- [ ] **Step 6: Commit**

```bash
git add packages/corgispec/scripts/bundle-assets.js packages/corgispec/test/install-assets.test.ts packages/corgispec/assets
git commit -m "feat(corgispec): bundle install command assets and memory templates"
```

---

### Task 2: Add shared install-asset helpers for state classification and config patching

**Files:**
- Create: `packages/corgispec/src/lib/install-assets.ts`
- Test: `packages/corgispec/test/install-assets.test.ts`

- [ ] **Step 1: Write failing unit tests for target-state classification and config patching**

Add tests like:

```ts
it("classifies a project with config + manifest as managed-update", () => {
  const state = classifyTargetState(tempDir);
  expect(state.kind).toBe("managed-update");
});

it("classifies config + managed files without manifest as legacy", () => {
  const state = classifyTargetState(tempDir);
  expect(state.kind).toBe("legacy");
});

it("patches only installer-owned config fields", () => {
  const next = patchInstallerConfig(existingConfig, {
    schema: "gitlab-tracked",
    isolation: { mode: "worktree", root: ".worktrees", branchPrefix: "feat/" },
  });

  expect(next).toContain("schema: gitlab-tracked");
  expect(next).toContain("context: |");
  expect(next).toContain("rules:");
});
```

- [ ] **Step 2: Run the targeted test to verify the helper surface does not exist yet**

Run: `cd packages/corgispec && npm test -- install-assets.test.ts`
Expected: FAIL because `install-assets.ts` exports are not implemented.

- [ ] **Step 3: Create `src/lib/install-assets.ts` with shared types and helpers**

Implement at minimum:

```ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { globSync } from "glob";
import type { SchemaType } from "./config.js";

export type BootstrapMode = "auto" | "fresh" | "update" | "legacy" | "verify";

export type TargetStateKind =
  | "init-needed"
  | "fresh"
  | "managed-update"
  | "legacy"
  | "inconsistent";

export interface TargetState {
  kind: TargetStateKind;
  configPath: string | null;
  manifestPath: string | null;
  managedFiles: string[];
}

export function getManagedProjectFiles(
  schema: SchemaType,
  assetsRoot = resolve(import.meta.dirname ?? ".", "../../assets")
): string[] {
  return [
    ...globSync("commands/opencode/corgi-*.md", { cwd: assetsRoot, nodir: true }).map(
      (file) => `.opencode/commands/${file.replace("commands/opencode/", "")}`
    ),
    ...globSync("commands/claude/corgi/*.md", { cwd: assetsRoot, nodir: true }).map(
      (file) => `.claude/commands/${file.replace("commands/claude/", "")}`
    ),
    ...globSync(`schemas/${schema}/**`, { cwd: assetsRoot, nodir: true }).map(
      (file) => `openspec/${file}`
    ),
  ].sort();
}

function detectInstalledManagedFiles(targetDir: string): string[] {
  return [
    ...globSync(".opencode/commands/corgi-*.md", { cwd: targetDir, nodir: true }),
    ...globSync(".claude/commands/corgi/*.md", { cwd: targetDir, nodir: true }),
    ...globSync("openspec/schemas/*/**", { cwd: targetDir, nodir: true }),
  ].sort();
}

export function classifyTargetState(targetDir: string): TargetState {
  const configPath = resolve(targetDir, "openspec/config.yaml");
  const manifestPath = resolve(targetDir, "openspec/.corgi-install.json");
  const hasConfig = existsSync(configPath);
  const hasManifest = existsSync(manifestPath);
  const managedFiles = detectInstalledManagedFiles(targetDir);

  if (!hasConfig && managedFiles.length > 0) {
    return { kind: "inconsistent", configPath: null, manifestPath: null, managedFiles };
  }

  if (!hasConfig) {
    return { kind: "init-needed", configPath: null, manifestPath: null, managedFiles: [] };
  }

  if (hasManifest) {
    return { kind: "managed-update", configPath, manifestPath, managedFiles };
  }

  if (managedFiles.length > 0) {
    return { kind: "legacy", configPath, manifestPath: null, managedFiles };
  }

  return { kind: "fresh", configPath, manifestPath: null, managedFiles: [] };
}

function extractUnmanagedTail(existingYaml: string): string {
  const lines = existingYaml.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    /^(# Project context \(optional\)|# Per-artifact rules \(optional\)|context:|rules:)/.test(line)
  );
  return start === -1 ? "" : lines.slice(start).join("\n").trim();
}

export function patchInstallerConfig(
  existingYaml: string,
  input: {
    schema: SchemaType;
    isolation: { mode: "none" | "worktree"; root?: string; branchPrefix?: string };
  }
): string {
  const header = [`schema: ${input.schema}`, "", "isolation:", `  mode: ${input.isolation.mode}`];

  if (input.isolation.mode === "worktree") {
    header.push(`  root: ${input.isolation.root ?? ".worktrees"}`);
    header.push(`  branch_prefix: ${input.isolation.branchPrefix ?? "feat/"}`);
  }

  const tail = extractUnmanagedTail(existingYaml);
  return tail ? `${header.join("\n")}\n\n${tail}\n` : `${header.join("\n")}\n`;
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function relativeManagedFiles(targetDir: string, files: string[]): string[] {
  return files.map((file) => relative(targetDir, file)).sort();
}
```

Implementation notes:

- `getManagedProjectFiles()` should enumerate `.opencode/commands/corgi-*.md`, `.claude/commands/corgi/*.md`, and `openspec/schemas/<schema>/**` based on the bundled assets, not a hardcoded hand-maintained list.
- `patchInstallerConfig()` should preserve existing `context` and `rules` text and update only `schema`, `isolation.mode`, `isolation.root`, and `isolation.branch_prefix`.
- Keep helper APIs pure where possible so they are easy to test without full CLI execution.

- [ ] **Step 4: Add hash and manifest-shape helpers**

Add small helpers in the same file for:

```ts
export interface InstallManifestFileEntry {
  sha256: string;
}

export interface InstallManifest {
  version: 1;
  installedAt: string;
  updatedAt: string;
  sourceRepo: string;
  schema: "gitlab-tracked" | "github-tracked";
  isolation: { mode: "none" | "worktree"; root?: string; branch_prefix?: string };
  files: Record<string, InstallManifestFileEntry>;
}
```

- [ ] **Step 5: Run the targeted unit tests again**

Run: `cd packages/corgispec && npm test -- install-assets.test.ts`
Expected: PASS for classification, config patching, and hashing helpers.

- [ ] **Step 6: Commit**

```bash
git add packages/corgispec/src/lib/install-assets.ts packages/corgispec/test/install-assets.test.ts
git commit -m "feat(corgispec): add shared install asset helpers"
```

---

### Task 3: Add reusable memory-init library driven by bundled templates

**Files:**
- Create: `packages/corgispec/src/lib/memory-init.ts`
- Test: `packages/corgispec/test/memory-init.test.ts`

- [ ] **Step 1: Write failing tests for template copy and protocol injection idempotency**

Add tests like:

```ts
it("creates memory and wiki files from bundled templates", () => {
  const result = initializeMemoryStructure(tempDir, { projectName: "Demo" });
  expect(result.created).toContain("memory/MEMORY.md");
  expect(result.created).toContain("wiki/hot.md");
});

it("does not duplicate the Session Memory Protocol", () => {
  initializeMemoryStructure(tempDir, { projectName: "Demo" });
  const second = initializeMemoryStructure(tempDir, { projectName: "Demo" });
  expect(second.protocolStatus).toBe("already-present");
});
```

- [ ] **Step 2: Run the targeted memory-init test to verify it fails first**

Run: `cd packages/corgispec && npm test -- memory-init.test.ts`
Expected: FAIL because the library does not exist.

- [ ] **Step 3: Implement `src/lib/memory-init.ts` using bundled template assets**

Implement at minimum:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const TEMPLATE_FILES = [
  "memory/MEMORY.md",
  "memory/session-bridge.md",
  "memory/pitfalls.md",
  "wiki/hot.md",
  "wiki/index.md",
  "wiki/architecture/_index.md",
  "wiki/architecture/implicit-contracts.md",
  "wiki/patterns/_index.md",
  "wiki/research/_index.md",
  "wiki/sessions/_index.md",
  "wiki/decisions/_index.md",
  "wiki/questions/_index.md",
  "wiki/meta/_index.md",
];

export interface MemoryInitInput {
  targetDir: string;
  projectName: string;
  projectPurpose: string;
  techStack: string;
  hardConstraints: string;
  preferences: string;
  stableComponents: string;
  evolvingComponents: string;
  legacyComponents: string;
  date: string;
}

export interface MemoryInitResult {
  created: string[];
  skipped: string[];
  protocolStatus: "injected" | "already-present" | "no-config-file";
}

function templateRoot(): string {
  return resolve(import.meta.dirname ?? ".", "../../assets/memory-init/templates");
}

function renderTemplate(template: string, input: MemoryInitInput): string {
  return template
    .replaceAll("{{DATE}}", input.date)
    .replaceAll("{{PROJECT_NAME}}", input.projectName)
    .replaceAll("{{PROJECT_PURPOSE}}", input.projectPurpose)
    .replaceAll("{{TECH_STACK}}", input.techStack)
    .replaceAll("{{HARD_CONSTRAINTS}}", input.hardConstraints)
    .replaceAll("{{PREFERENCES}}", input.preferences)
    .replaceAll("{{STABLE_COMPONENTS}}", input.stableComponents)
    .replaceAll("{{EVOLVING_COMPONENTS}}", input.evolvingComponents)
    .replaceAll("{{LEGACY_COMPONENTS}}", input.legacyComponents);
}

function injectSessionProtocol(targetDir: string): MemoryInitResult["protocolStatus"] {
  const protocol = readFileSync(
    resolve(templateRoot(), "session-memory-protocol.md"),
    "utf-8"
  );
  const configCandidates = [resolve(targetDir, "CLAUDE.md"), resolve(targetDir, "AGENTS.md")];
  const configPath = configCandidates.find((candidate) => existsSync(candidate));

  if (!configPath) {
    return "no-config-file";
  }

  const existing = readFileSync(configPath, "utf-8");
  if (existing.includes("## Session Memory Protocol")) {
    return "already-present";
  }

  writeFileSync(configPath, `${existing.trimEnd()}\n\n${protocol.trim()}\n`);
  return "injected";
}

export function initializeMemoryStructure(input: MemoryInitInput): MemoryInitResult {
  const created: string[] = [];
  const skipped: string[] = [];

  for (const relativePath of TEMPLATE_FILES) {
    const sourcePath = resolve(templateRoot(), relativePath);
    const targetPath = resolve(input.targetDir, relativePath);

    if (existsSync(targetPath)) {
      skipped.push(relativePath);
      continue;
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, renderTemplate(readFileSync(sourcePath, "utf-8"), input));
    created.push(relativePath);
  }

  return {
    created,
    skipped,
    protocolStatus: injectSessionProtocol(input.targetDir),
  };
}
```

Implementation requirements:

- load template files from `assets/memory-init/templates/**`
- replace placeholders such as `{{DATE}}`, `{{PROJECT_NAME}}`, `{{PROJECT_PURPOSE}}`, `{{TECH_STACK}}`
- skip any target file that already exists
- append the bundled `session-memory-protocol.md` block only when neither `CLAUDE.md` nor `AGENTS.md` already contains `## Session Memory Protocol`

- [ ] **Step 4: Add a lightweight project-context extractor for bootstrap to reuse**

Add a helper:

```ts
function readTextIfPresent(targetDir: string, relativePath: string): string {
  const fullPath = resolve(targetDir, relativePath);
  return existsSync(fullPath) ? readFileSync(fullPath, "utf-8") : "";
}

function firstHeading(markdown: string): string | null {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1]!.trim() : null;
}

function firstParagraph(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim());
  const paragraph = lines.find((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith(">"));
  return paragraph ?? null;
}

function parsePackageName(targetDir: string): string | null {
  const packageJsonPath = resolve(targetDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { name?: string };
  return parsed.name ?? null;
}

export function extractProjectMemoryContext(
  targetDir: string
): Omit<MemoryInitInput, "targetDir" | "date"> {
  const readme = readTextIfPresent(targetDir, "README.md");
  const agentNotes = [readTextIfPresent(targetDir, "AGENTS.md"), readTextIfPresent(targetDir, "CLAUDE.md")]
    .filter(Boolean)
    .join("\n\n");

  const projectName = firstHeading(readme) ?? parsePackageName(targetDir) ?? "Unknown";
  const projectPurpose = firstParagraph(readme) ?? "Not specified";
  const techStack = agentNotes.match(/Tech stack:.*$/im)?.[0]?.replace(/^Tech stack:\s*/i, "") ?? "Not specified";

  return {
    projectName,
    projectPurpose,
    techStack,
    hardConstraints: agentNotes.match(/must|never|always|required|forbidden/i)
      ? "Extracted from agent config"
      : "None specified yet",
    preferences: agentNotes.length > 0 ? "Extracted from agent config" : "None specified yet",
    stableComponents: techStack,
    evolvingComponents: "TBD",
    legacyComponents: "None identified",
  };
}
```

It should use the same lightweight sources described in the spec:

- `README.md`
- `AGENTS.md`
- `CLAUDE.md`
- `package.json`

Use placeholder strings when data cannot be found.

- [ ] **Step 5: Run the memory-init test file again**

Run: `cd packages/corgispec && npm test -- memory-init.test.ts`
Expected: PASS and protocol injection remains idempotent.

- [ ] **Step 6: Commit**

```bash
git add packages/corgispec/src/lib/memory-init.ts packages/corgispec/test/memory-init.test.ts
git commit -m "feat(corgispec): add template-based memory initialization library"
```

---

### Task 4: Implement bootstrap report writing and orchestration library

**Files:**
- Create: `packages/corgispec/src/lib/bootstrap-report.ts`
- Create: `packages/corgispec/src/lib/bootstrap.ts`
- Test: `packages/corgispec/test/bootstrap.test.ts`

- [ ] **Step 1: Write failing CLI-oriented tests for bootstrap scenarios**

Add integration tests covering:

```ts
it("bootstraps a fresh target by initializing OpenSpec and writing the install report", () => {
  const output = execSync(`node ${CLI} bootstrap --target ${targetDir} --schema github-tracked`, {
    encoding: "utf-8",
  });
  expect(output).toContain("status: success");
  expect(existsSync(resolve(targetDir, "openspec/.corgi-install-report.md"))).toBe(true);
});

it("stops managed update when a tracked file has local modifications", () => {
  expect(() =>
    execSync(`node ${CLI} bootstrap --target ${targetDir} --mode update`, {
      encoding: "utf-8",
    })
  ).toThrow();
});

it("returns JSON output with stable status fields", () => {
  const parsed = JSON.parse(
    execSync(`node ${CLI} bootstrap --target ${targetDir} --schema github-tracked --json`, {
      encoding: "utf-8",
    })
  );
  expect(parsed).toHaveProperty("status");
  expect(parsed).toHaveProperty("mode");
  expect(parsed).toHaveProperty("reportPath");
});
```

- [ ] **Step 2: Run the bootstrap integration test file to verify it fails first**

Run: `cd packages/corgispec && npm test -- bootstrap.test.ts`
Expected: FAIL because `bootstrap` is not registered yet.

- [ ] **Step 3: Implement manifest/report helpers in `bootstrap-report.ts`**

Implement helpers such as:

```ts
export interface BootstrapCheck {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail: string;
}

export function writeInstallManifest(/* ... */): string { /* ... */ }
export function writeInstallReport(/* ... */): string { /* ... */ }
```

`writeInstallReport()` should produce the markdown table shape already defined by `corgispec-install`.

- [ ] **Step 4: Implement orchestration flow in `src/lib/bootstrap.ts`**

Implement and export:

```ts
export interface BootstrapOptions {
  target: string;
  schema?: "gitlab-tracked" | "github-tracked";
  mode: "auto" | "fresh" | "update" | "legacy" | "verify";
  yes: boolean;
  noMemory: boolean;
  json: boolean;
}

export interface BootstrapResult {
  status: "success" | "failed" | "needs-approval" | "stopped";
  mode: "fresh" | "update" | "legacy" | "verify";
  target: string;
  actions: string[];
  reportPath: string;
  manifestPath?: string;
  message: string;
}

export async function runBootstrap(opts: BootstrapOptions): Promise<BootstrapResult> { /* ... */ }
```

Required behavior:

- run prerequisite checks up front
- run the programmatic equivalent of `corgispec install`
- classify target state using `classifyTargetState()`
- call `openspec init` only for `init-needed`
- stop on `inconsistent`
- create backups before legacy migration
- stop on locally modified managed files during managed update
- initialize memory unless `--no-memory` is set
- write `.corgi-install.json` and `.corgi-install-report.md`

- [ ] **Step 5: Reuse existing lower-level logic instead of shelling everything out**

During implementation, extract any reusable functions from `src/commands/install.ts` and `src/commands/init.ts` into shared helpers instead of duplicating file-copy logic in bootstrap.

For example, refactor `install.ts` to export a helper like:

```ts
export function installSkillsTo(sourceDir: string, targetDir: string, dryRun: boolean): string[] { /* ... */ }
```

Then import that helper into `bootstrap.ts`.

- [ ] **Step 6: Run the targeted bootstrap integration tests again**

Run: `cd packages/corgispec && npm test -- bootstrap.test.ts`
Expected: PASS for fresh install, JSON output, managed-update stop, and legacy backup/approval scenarios.

- [ ] **Step 7: Commit**

```bash
git add packages/corgispec/src/lib/bootstrap-report.ts packages/corgispec/src/lib/bootstrap.ts packages/corgispec/src/commands/install.ts packages/corgispec/src/commands/init.ts packages/corgispec/test/bootstrap.test.ts
git commit -m "feat(corgispec): implement bootstrap install orchestration"
```

---

### Task 5: Add the bootstrap CLI command and wire it into the binary

**Files:**
- Create: `packages/corgispec/src/commands/bootstrap.ts`
- Modify: `packages/corgispec/src/bin/corgispec.ts`
- Test: `packages/corgispec/test/bootstrap.test.ts`

- [ ] **Step 1: Write the failing CLI registration assertion**

Extend `bootstrap.test.ts` with:

```ts
it("shows bootstrap in --help output", () => {
  const help = execSync(`node ${CLI} --help`, { encoding: "utf-8" });
  expect(help).toContain("bootstrap");
});
```

- [ ] **Step 2: Run the bootstrap test file to verify help output does not include the command yet**

Run: `cd packages/corgispec && npm test -- bootstrap.test.ts`
Expected: FAIL because the command is not registered.

- [ ] **Step 3: Create `src/commands/bootstrap.ts`**

Implement the command surface:

```ts
import { Command } from "commander";
import { resolve } from "node:path";
import { runBootstrap } from "../lib/bootstrap.js";

export function createBootstrapCommand(): Command {
  const cmd = new Command("bootstrap");

  cmd
    .description("Install or upgrade OpenSpec GitFlow assets through a single safe entrypoint")
    .requiredOption("--target <path>", "Target project directory")
    .option("--schema <schema>", "Schema to use (gitlab-tracked or github-tracked)")
    .option("--mode <mode>", "Bootstrap mode (auto, fresh, update, legacy, verify)", "auto")
    .option("--yes", "Approve non-interactive safe prompts")
    .option("--no-memory", "Skip memory initialization")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts) => {
      const result = await runBootstrap({
        target: resolve(opts.target),
        schema: opts.schema,
        mode: opts.mode,
        yes: Boolean(opts.yes),
        noMemory: Boolean(opts.noMemory),
        json: Boolean(opts.json),
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`status: ${result.status}`);
        console.log(result.message);
        console.log(`report: ${result.reportPath}`);
      }

      if (result.status !== "success") {
        process.exitCode = 1;
      }
    });

  return cmd;
}
```

- [ ] **Step 4: Register the command in `src/bin/corgispec.ts`**

Add imports and registration:

```ts
import { createBootstrapCommand } from "../commands/bootstrap.js";

program.addCommand(createBootstrapCommand());
```

Place it near other install/setup commands, before the workflow artifact commands.

- [ ] **Step 5: Rebuild and rerun the targeted bootstrap test file**

Run: `cd packages/corgispec && npm run build && npm test -- bootstrap.test.ts`
Expected: PASS and `--help` shows `bootstrap`.

- [ ] **Step 6: Commit**

```bash
git add packages/corgispec/src/commands/bootstrap.ts packages/corgispec/src/bin/corgispec.ts packages/corgispec/test/bootstrap.test.ts
git commit -m "feat(corgispec): add bootstrap CLI command"
```

---

### Task 6: Add the fetchable agent install document

**Files:**
- Create: `.opencode/INSTALL.md`
- Test: `packages/corgispec/test/bootstrap.test.ts`

- [ ] **Step 1: Write a failing documentation consistency test**

Add a simple filesystem assertion in `bootstrap.test.ts`:

```ts
it("ships a fetchable OpenCode install document", () => {
  expect(existsSync(resolve(repoRoot, ".opencode/INSTALL.md"))).toBe(true);
});
```

- [ ] **Step 2: Run the targeted test to verify the install document is missing**

Run: `cd packages/corgispec && npm test -- bootstrap.test.ts`
Expected: FAIL because `.opencode/INSTALL.md` does not exist.

- [ ] **Step 3: Create `.opencode/INSTALL.md` as an agent dispatcher**

Use this content:

```md
# Install OpenSpec GitFlow

Collect the target project path if the user did not provide it.

Run:

```text
corgispec bootstrap --target /path/to/project --mode auto
```

If the user already told you the schema, add `--schema github-tracked` or `--schema gitlab-tracked`.

Do not reconstruct the install workflow from README files.
Do not run separate user-level and project-level install steps unless the bootstrap command fails and explicitly tells you what is missing.

After bootstrap completes:

1. Read `openspec/.corgi-install-report.md` in the target project.
2. Summarize whether the run succeeded, stopped for approval, or failed.
3. If bootstrap reported a legacy migration approval gate, ask the user that exact approval question and then rerun the command with the approved flags.
```
```

- [ ] **Step 4: Rerun the targeted bootstrap test file**

Run: `cd packages/corgispec && npm test -- bootstrap.test.ts`
Expected: PASS for the install-document existence check.

- [ ] **Step 5: Commit**

```bash
git add .opencode/INSTALL.md packages/corgispec/test/bootstrap.test.ts
git commit -m "docs(opencode): add single-entry agent install document"
```

---

### Task 7: Rewrite README quick starts around the single-entry model

**Files:**
- Modify: `README.md`
- Modify: `README.zh-TW.md`

- [ ] **Step 1: Replace the multi-step quick start in `README.md`**

Update the quick-start section so it becomes:

```md
## Quick Start

### Prerequisites

- **Node.js**
- **OpenCode** or **Claude Code**
- **gh CLI** for `github-tracked`
- **glab CLI** for `gitlab-tracked`

### 1. Install corgispec

```bash
cd packages/corgispec && npm install && npm run build
```

### 2. Let your agent run the installer

Tell your agent:

```text
Fetch and follow instructions from https://raw.githubusercontent.com/ricoyudog/Coding_Corgi_flow/feat/openspec-llm-memory/.opencode/INSTALL.md
```

The agent will run `corgispec bootstrap`, which handles user-level skill installation, target project detection, fresh install, managed update, legacy migration, and install reporting.
```

- [ ] **Step 2: Make the same structural change in `README.zh-TW.md`**

Use a matching Traditional Chinese version:

```md
## 快速開始

### 1. 安裝 corgispec

```bash
cd packages/corgispec && npm install && npm run build
```

### 2. 讓 agent 執行安裝

把這句話直接交給 agent：

```text
Fetch and follow instructions from https://raw.githubusercontent.com/ricoyudog/Coding_Corgi_flow/feat/openspec-llm-memory/.opencode/INSTALL.md
```

agent 會執行 `corgispec bootstrap`，自動處理 user-level skills、target project 偵測、fresh install、managed update、legacy migration，以及 install report。
```

- [ ] **Step 3: Preserve deeper reference material below quick start instead of deleting it blindly**

Move any still-useful detail into a later reference section titled either `Install Reference` or `安裝參考`, but remove it from the primary onboarding path.

- [ ] **Step 4: Review both README files for stale primary-path references**

Manually check and remove or demote phrases that still present `install-skills.sh` or `/corgi-install` as the recommended top-level onboarding path.

- [ ] **Step 5: Commit**

```bash
git add README.md README.zh-TW.md
git commit -m "docs: switch install quick start to bootstrap single-entry flow"
```

---

### Task 8: Run full verification and fix any gaps

**Files:**
- Modify: any files above if verification exposes issues

- [ ] **Step 1: Build the CLI and rebundle assets**

Run: `cd packages/corgispec && npm run build && node scripts/bundle-assets.js`
Expected: build succeeds and asset bundle completes without checksum errors.

- [ ] **Step 2: Run the full corgispec test suite**

Run: `cd packages/corgispec && npm test`
Expected: all Vitest suites pass, including the new bootstrap/install-assets/memory-init coverage.

- [ ] **Step 3: Run a focused manual smoke test for the bootstrap help surface**

Run: `cd packages/corgispec && node dist/corgispec.js bootstrap --help`
Expected: help output documents `--target`, `--schema`, `--mode`, `--yes`, `--no-memory`, and `--json`.

- [ ] **Step 4: Run a focused manual smoke test for dry-run style JSON output**

Create a temporary directory and run:

```bash
cd packages/corgispec && node dist/corgispec.js bootstrap --target "$(mktemp -d)" --schema github-tracked --json
```

Expected: JSON object with `status`, `mode`, `target`, and `reportPath` fields. If the temporary directory path causes bootstrap to stop because the target needs confirmation, the JSON status should still be structured and non-ambiguous.

- [ ] **Step 5: Review the implementation against the spec**

Verify each requirement in `docs/superpowers/specs/2026-05-02-single-entry-bootstrap-install-design.md` maps to shipped behavior:

- single fetchable `.opencode/INSTALL.md`
- single `corgispec bootstrap` command
- bundled project-local command assets
- bundled memory-init templates
- automatic target-state classification
- explicit legacy backup and approval handling
- machine-readable output
- README reduced to the single-entry model

- [ ] **Step 6: Commit final fixes if verification changed any files**

```bash
git add packages/corgispec .opencode/INSTALL.md README.md README.zh-TW.md
git commit -m "test(corgispec): verify bootstrap install workflow end to end"
```
