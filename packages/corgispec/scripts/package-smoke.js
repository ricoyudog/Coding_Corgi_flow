#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(resolve(tmpdir(), "corgispec-package-smoke-"));
const packDirectory = resolve(temporaryRoot, "pack");
const consumerDirectory = resolve(temporaryRoot, "consumer");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const REQUIRED_KNOWLEDGE_PATHS = [
  "memory/MEMORY.md",
  "memory/session-bridge.md",
  "memory/pitfalls.md",
  "wiki/hot.md",
  "wiki/index.md",
  "wiki/schema.md",
  "wiki/architecture/_index.md",
  "wiki/architecture/implicit-contracts.md",
  "wiki/research/_index.md",
  "wiki/patterns/_index.md",
  "wiki/decisions/_index.md",
  "wiki/guides/_index.md",
  "wiki/questions/_index.md",
  "wiki/deliveries/_index.md",
  "wiki/meta/_index.md",
  "rfcs/README.md",
  "rfcs/RFC-0001-project-foundation/rfc.md",
  "rfcs/RFC-0001-project-foundation/rfc.yaml",
  "rfcs/RFC-0001-project-foundation/delivery.yaml",
];

function fail(message) {
  throw new Error(`Package smoke failed: ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    encoding: "utf8",
    env: process.env,
    ...options,
  });

  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    fail(`${command} ${args.join(" ")} exited with ${result.status}`);
  }

  return result.stdout.trim();
}

function collectRelativeFiles(directory, prefix = "") {
  const files = [];
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name)
  );

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRelativeFiles(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

function verifyAssetManifest(assetsDirectory) {
  const manifestPath = resolve(assetsDirectory, "asset-manifest.json");
  if (!existsSync(manifestPath)) fail("assets/asset-manifest.json is missing");

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.algorithm !== "sha256") {
    fail("asset manifest has an unsupported contract");
  }
  if (!manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) {
    fail("asset manifest does not contain a files map");
  }

  const packagedFiles = collectRelativeFiles(assetsDirectory).filter(
    (path) => path !== "asset-manifest.json"
  );
  const declaredFiles = Object.keys(manifest.files);
  const undeclared = packagedFiles.filter((path) => !declaredFiles.includes(path));
  const missing = declaredFiles.filter((path) => !packagedFiles.includes(path));
  if (undeclared.length > 0 || missing.length > 0 || packagedFiles.length !== declaredFiles.length) {
    fail(`asset manifest and packaged asset file set differ (undeclared: ${undeclared.join(", ") || "none"}; missing: ${missing.join(", ") || "none"})`);
  }

  for (const relativePath of declaredFiles) {
    const actual = createHash("sha256")
      .update(readFileSync(resolve(assetsDirectory, relativePath)))
      .digest("hex");
    if (actual !== manifest.files[relativePath]) {
      fail(`asset checksum mismatch for ${relativePath}`);
    }
  }

  if (!declaredFiles.some((path) => /(^|\/)skills\/.*\/SKILL\.md$/.test(path))) {
    fail("no skill entrypoint was packaged");
  }
  if (!declaredFiles.some((path) => path.startsWith("commands/"))) {
    fail("no command asset was packaged");
  }
  for (const required of [
    "skills/atoms/corgispec-ready/SKILL.md",
    "skills/molecules/corgispec-propose/SKILL.md",
    "skills/molecules/corgispec-gh-propose/SKILL.md",
    "skills/molecules/corgispec-update/SKILL.md",
    "skills/molecules/corgispec-lint/SKILL.md",
    "skills/molecules/corgispec-rfc/SKILL.md",
    "skills/molecules/corgispec-verify/SKILL.md",
    "skills/molecules/corgispec-review/SKILL.md",
    "skills/molecules/corgispec-human-qa/SKILL.md",
    "skills/molecules/corgispec-archive-change/SKILL.md",
    "skills/compounds/corgispec-apply/SKILL.md",
    "memory-init/templates/memory/MEMORY.md",
    "memory-init/templates/memory/session-bridge.md",
    "memory-init/templates/wiki/hot.md",
    "memory-init/templates/wiki/schema.md",
    "memory-init/templates/wiki/deliveries/_index.md",
    "commands/opencode/corgi-rfc.md",
    "commands/opencode/corgi-propose.md",
    "commands/opencode/corgi-ready.md",
    "commands/opencode/corgi-update.md",
    "commands/opencode/corgi-lint.md",
    "commands/opencode/corgi-apply.md",
    "commands/opencode/corgi-verify.md",
    "commands/opencode/corgi-review.md",
    "commands/opencode/corgi-human-qa.md",
    "commands/opencode/corgi-archive.md",
    "commands/claude/corgi/rfc.md",
    "commands/claude/corgi/propose.md",
    "commands/claude/corgi/ready.md",
    "commands/claude/corgi/update.md",
    "commands/claude/corgi/lint.md",
    "commands/claude/corgi/apply.md",
    "commands/claude/corgi/verify.md",
    "commands/claude/corgi/review.md",
    "commands/claude/corgi/human-qa.md",
    "commands/claude/corgi/archive.md",
  ]) {
    if (!declaredFiles.includes(required)) fail(`required asset ${required} is missing`);
  }
  for (const retired of [
    "commands/opencode/corgi-loop.md",
    "commands/opencode/corgi-converge.md",
    "commands/claude/corgi/loop.md",
    "commands/claude/corgi/converge.md",
  ]) {
    if (declaredFiles.includes(retired)) fail(`retired asset ${retired} is still packaged`);
  }
  for (const retiredPrefix of [
    "skills/molecules/corgispec-apply-change/",
    "skills/molecules/corgispec-gh-apply/",
    "skills/compounds/corgispec-loop/",
    "skills/molecules/corgispec-converge/",
  ]) {
    if (declaredFiles.some((path) => path.startsWith(retiredPrefix))) {
      fail(`retired skill ${retiredPrefix} is still packaged`);
    }
  }

  return declaredFiles.length;
}

function copyPackagedAsset(installedRoot, projectDirectory, assetPath, targetPath) {
  const source = resolve(installedRoot, "assets", assetPath);
  const target = resolve(projectDirectory, targetPath);
  if (!existsSync(source)) fail(`fixture asset ${assetPath} is missing from the installed package`);
  mkdirSync(dirname(target), { recursive: true });
  const content = readFileSync(source);
  writeFileSync(target, content);
  return {
    targetPath,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function writeRc1ManagedFixture(projectDirectory, installedRoot, includeClaudeHooks) {
  const managed = [
    copyPackagedAsset(
      installedRoot,
      projectDirectory,
      "commands/opencode/corgi-ready.md",
      ".opencode/commands/corgi-ready.md",
    ),
    copyPackagedAsset(
      installedRoot,
      projectDirectory,
      "commands/claude/corgi/ready.md",
      ".claude/commands/corgi/ready.md",
    ),
  ];
  const manifest = {
    version: 1,
    installedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sourceRepo: "corgispec@legacy-v3",
    schema: "github-tracked",
    isolation: { mode: "none" },
    files: Object.fromEntries(
      managed.map(({ targetPath, sha256 }) => [targetPath, { sha256 }]),
    ),
  };
  writeFileSync(
    resolve(projectDirectory, "openspec/.corgi-install.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  if (includeClaudeHooks) {
    mkdirSync(resolve(projectDirectory, ".claude"), { recursive: true });
    writeFileSync(
      resolve(projectDirectory, ".claude/settings.json"),
      `${JSON.stringify({
        permissions: { allow: ["Read"], deny: ["Bash(rm:*)"] },
        env: { PACKAGE_SMOKE_CUSTOM: "preserve-me" },
        hooks: {
          PreToolUse: [
            {
              matcher: "Edit|Write",
              hooks: [{ type: "command", command: "corgispec hook pre-write", timeout: 5 }],
            },
            {
              matcher: "Read",
              hooks: [{ type: "command", command: "node ./custom-pre-tool.cjs" }],
            },
          ],
          Stop: [
            {
              hooks: [{ type: "command", command: "corgispec hook stop-check", timeout: 10 }],
            },
            {
              hooks: [{ type: "command", command: "node ./custom-stop.cjs" }],
            },
          ],
        },
      }, null, 2)}\n`,
    );
  }
}

function claudeHookCommands(settings) {
  if (!settings.hooks || typeof settings.hooks !== "object") return [];
  return Object.values(settings.hooks).flatMap((entries) =>
    Array.isArray(entries)
      ? entries.flatMap((entry) =>
          Array.isArray(entry?.hooks)
            ? entry.hooks
                .map((hook) => hook?.command)
                .filter((command) => typeof command === "string")
            : []
        )
      : []
  );
}

function packagedSkillNames(installedRoot) {
  const entrypoints = collectRelativeFiles(resolve(installedRoot, "assets/skills"))
    .filter((path) => path.endsWith("/SKILL.md"));
  return Array.from(new Set(entrypoints.map((path) => path.split("/").at(-2)))).sort();
}

function verifyInstalledSkills(installedRoot, skillRoots) {
  const names = packagedSkillNames(installedRoot);
  if (names.length === 0) fail("installed package contains no skill entrypoints");
  for (const skillRoot of skillRoots) {
    for (const name of names) {
      if (!existsSync(resolve(skillRoot, name, "SKILL.md"))) {
        fail(`${name} was not installed for ${skillRoot}`);
      }
    }
  }
}

function verifyMirroredFiles(sourceRoot, targetRoot, label) {
  for (const relativePath of collectRelativeFiles(sourceRoot)) {
    const source = resolve(sourceRoot, relativePath);
    const target = resolve(targetRoot, relativePath);
    if (!existsSync(target)) fail(`${label} ${relativePath} was not installed`);
    if (!readFileSync(source).equals(readFileSync(target))) {
      fail(`${label} ${relativePath} does not match the packaged asset`);
    }
  }
}

function verifyKnowledgeInitialization(projectDirectory, label) {
  for (const requiredKnowledgePath of REQUIRED_KNOWLEDGE_PATHS) {
    const path = resolve(projectDirectory, requiredKnowledgePath);
    if (!existsSync(path)) {
      fail(`${label} omitted mandatory knowledge path ${requiredKnowledgePath}`);
    }
    if (readFileSync(path, "utf8").trim().length === 0) {
      fail(`${label} created an empty knowledge path ${requiredKnowledgePath}`);
    }
  }
}

function verifyFoundationContract(projectDirectory, label, integrationBranch) {
  const config = readFileSync(resolve(projectDirectory, "openspec/config.yaml"), "utf8");
  for (const expected of [
    "schema: github-tracked",
    "contract: rfc-v1",
    "rfcRoot: rfcs",
    "foundation: RFC-0001-project-foundation",
    `integrationBranch: ${integrationBranch}`,
  ]) {
    if (!config.includes(expected)) fail(`${label} omitted config field ${expected}`);
  }

  const foundationDirectory = resolve(projectDirectory, "rfcs/RFC-0001-project-foundation");
  const metadata = readFileSync(resolve(foundationDirectory, "rfc.yaml"), "utf8");
  for (const expected of [
    "id: RFC-0001-project-foundation",
    "type: foundation",
    "status: draft",
  ]) {
    if (!metadata.includes(expected)) fail(`${label} wrote invalid Foundation metadata: ${expected}`);
  }
  const delivery = readFileSync(resolve(foundationDirectory, "delivery.yaml"), "utf8");
  for (const expected of [
    "rfcId: RFC-0001-project-foundation",
    "S-01-project-foundation",
    "status: unbound",
  ]) {
    if (!delivery.includes(expected)) fail(`${label} wrote invalid Foundation delivery: ${expected}`);
  }
}

function createFakeOpenSpec() {
  const fakeScript = resolve(temporaryRoot, "fake-openspec.cjs");
  writeFileSync(
    fakeScript,
    `#!/usr/bin/env node
const path = require("node:path");
const args = process.argv.slice(2);
const root = process.cwd();
const changeRoot = path.resolve(root, "openspec/changes/smoke-change");
const proposal = path.resolve(changeRoot, "proposal.md");
const tasks = path.resolve(changeRoot, "tasks.md");
const artifactPaths = {
  proposal: { outputPath: "proposal.md", resolvedOutputPath: proposal, existingOutputPaths: [proposal] },
  tasks: { outputPath: "tasks.md", resolvedOutputPath: tasks, existingOutputPaths: [tasks] },
};
function output(value, code = 0) { process.stdout.write(JSON.stringify(value) + "\\n"); process.exitCode = code; }
if (args[0] === "--version") process.stdout.write("1.6.0\\n");
else if (args[0] === "schema" && args[1] === "validate") output({ valid: true, issues: [] });
else if (args[0] === "list") output({ changes: [], root: { path: root, source: "repo" } });
else if (args[0] === "status") output({
  changeName: "smoke-change", schemaName: "github-tracked",
  planningHome: { kind: "repo", root, changesDir: path.resolve(root, "openspec/changes"), defaultSchema: "github-tracked" },
  changeRoot, artifactPaths, nextSteps: [],
  actionContext: { mode: "repo-local", sourceOfTruth: "repo", planningArtifacts: ["proposal", "tasks"], linkedContext: [], allowedEditRoots: [changeRoot], requiresAffectedAreaSelection: false, constraints: ["planning only"] },
  isComplete: true, applyRequires: ["tasks"],
  artifacts: [{ id: "proposal", outputPath: "proposal.md", status: "done" }, { id: "tasks", outputPath: "tasks.md", status: "done" }],
  root: { path: root, source: "repo" },
});
else if (args[0] === "validate") output({ items: [{ id: "smoke-change", type: "change", valid: true, issues: [], durationMs: 1 }], summary: { valid: 1, invalid: 0 }, version: "1.6" });
else output({ status: [{ level: "error", message: "unsupported smoke invocation: " + args.join(" ") }] }, 1);
`,
  );

  if (process.platform === "win32") {
    const executable = resolve(temporaryRoot, "fake-openspec.cmd");
    writeFileSync(executable, `@echo off\r\n"${process.execPath}" "%~dp0fake-openspec.cjs" %*\r\n`);
    return executable;
  }

  chmodSync(fakeScript, 0o755);
  return fakeScript;
}

function createFakeGitHubCliDirectory() {
  const binDirectory = resolve(temporaryRoot, "fake-gh-bin");
  mkdirSync(binDirectory, { recursive: true });
  const script = resolve(binDirectory, "fake-gh.cjs");
  writeFileSync(
    script,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "--version") process.stdout.write("gh version 2.0.0\\n");
else if (args[0] === "auth" && args[1] === "status") process.exitCode = 0;
else { process.stderr.write("unsupported fake gh invocation: " + args.join(" ") + "\\n"); process.exitCode = 1; }
`,
  );

  if (process.platform === "win32") {
    writeFileSync(resolve(binDirectory, "gh.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0fake-gh.cjs" %*\r\n`);
  } else {
    const executable = resolve(binDirectory, "gh");
    writeFileSync(executable, readFileSync(script));
    chmodSync(executable, 0o755);
  }

  return binDirectory;
}

function smokeEnvironment(homeDirectory, githubAvailable = false) {
  const env = {
    ...process.env,
    CORGISPEC_OPENSPEC_BIN: createFakeOpenSpec(),
    HOME: homeDirectory,
    USERPROFILE: homeDirectory,
    XDG_CONFIG_HOME: resolve(homeDirectory, ".config"),
  };
  if (githubAvailable) {
    env.PATH = [createFakeGitHubCliDirectory(), process.env.PATH]
      .filter(Boolean)
      .join(delimiter);
  }
  return env;
}

function createFreshSmokeProject(name = "fresh-project") {
  const projectDirectory = resolve(consumerDirectory, name);
  const homeDirectory = resolve(temporaryRoot, `${name}-home`);
  mkdirSync(projectDirectory, { recursive: true });
  mkdirSync(homeDirectory, { recursive: true });
  run("git", ["init", "-q", "-b", "main"], { cwd: projectDirectory });

  const initialEntries = readdirSync(projectDirectory).sort();
  if (initialEntries.length !== 1 || initialEntries[0] !== ".git") {
    fail("fresh bootstrap fixture is not an empty Git project");
  }

  return {
    projectDirectory,
    env: smokeEnvironment(homeDirectory, true),
  };
}

function createSmokeProject(name = "project") {
  const projectDirectory = resolve(consumerDirectory, name);
  const homeDirectory = resolve(temporaryRoot, "home");
  const openspecRoot = resolve(projectDirectory, "openspec");
  mkdirSync(openspecRoot, { recursive: true });
  mkdirSync(homeDirectory, { recursive: true });
  writeFileSync(
    resolve(openspecRoot, "config.yaml"),
    "schema: github-tracked\ncorgi:\n  tracking:\n    provider: none\n  taskArtifactId: tasks\n",
  );
  mkdirSync(resolve(projectDirectory, "memory"), { recursive: true });
  mkdirSync(resolve(projectDirectory, "wiki/sessions"), { recursive: true });
  mkdirSync(resolve(projectDirectory, "wiki/research"), { recursive: true });
  writeFileSync(
    resolve(projectDirectory, "memory/session-bridge.md"),
    "# Session Bridge\n\n## Active opsx Change\n- **Change**: none\n- **Branch**: main\n- **Phase**: idle\n\n## Done (last session completed)\n- Preserve this v3 checkpoint.\n\n## Waiting (next steps / blockers)\n- Human decision remains.\n\n## New Discoveries\n- Preserve this discovery.\n\n## New Pitfalls\n- Preserve this promotion candidate.\n",
  );
  writeFileSync(
    resolve(projectDirectory, "wiki/hot.md"),
    "# Hot Memory\n\n## Recent Decisions\n- Preserve this project decision.\n",
  );
  writeFileSync(
    resolve(projectDirectory, "wiki/index.md"),
    "# Wiki Index\n\n- [Legacy research](research/legacy.md)\n",
  );
  writeFileSync(
    resolve(projectDirectory, "wiki/research/legacy.md"),
    "# Legacy Research\n\nPreserve this research note.\n",
  );
  writeFileSync(
    resolve(projectDirectory, "wiki/sessions/legacy.md"),
    "# Legacy Session\n\nRead-only history must survive migration.\n",
  );
  writeFileSync(
    resolve(projectDirectory, "wiki/log.md"),
    "# Legacy Log\n\nRead-only log history must survive migration.\n",
  );
  writeFileSync(
    resolve(projectDirectory, "AGENTS.md"),
    "# Project Instructions\n\nKeep this custom instruction.\n\n## Session Memory Protocol\n\n### Startup (every session)\nRead `memory/session-bridge.md`, `wiki/hot.md`, then `wiki/index.md`.\n",
  );

  return {
    projectDirectory,
    env: smokeEnvironment(homeDirectory),
  };
}

try {
  mkdirSync(packDirectory, { recursive: true });
  mkdirSync(consumerDirectory, { recursive: true });

  run(npmCommand, ["pack", "--pack-destination", packDirectory]);
  const archives = readdirSync(packDirectory).filter((file) => file.endsWith(".tgz"));
  if (archives.length !== 1) fail(`expected one tarball, found ${archives.length}`);

  const archivePath = resolve(packDirectory, archives[0]);
  run(
    npmCommand,
    [
      "install",
      archivePath,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
    ],
    { cwd: consumerDirectory }
  );

  const installedRoot = resolve(consumerDirectory, "node_modules/corgispec");
  const installedPackage = JSON.parse(
    readFileSync(resolve(installedRoot, "package.json"), "utf8")
  );
  const binPath = resolve(installedRoot, installedPackage.bin?.corgispec ?? "");
  if (!existsSync(binPath)) fail("the installed corgispec bin target is missing");

  const version = run(process.execPath, [binPath, "--version"], { cwd: consumerDirectory });
  if (version !== installedPackage.version) {
    fail(`CLI version ${version} does not match package version ${installedPackage.version}`);
  }

  const help = run(process.execPath, [binPath, "--help"], { cwd: consumerDirectory });
  for (const command of [
    "bootstrap",
    "rfc",
    "list",
    "graph",
    "status",
    "instructions",
    "propose",
    "apply",
    "verify",
    "review",
    "human-qa",
    "archive",
    "change",
    "doctor",
    "lint",
    "update",
    "ready",
  ]) {
    if (!new RegExp(`(?:^|\\s)${command}(?:\\s|$)`, "m").test(help)) {
      fail(`top-level command ${command} is missing from --help`);
    }
    run(process.execPath, [binPath, command, "--help"], { cwd: consumerDirectory });
  }
  if (!/^\s+apply\b/m.test(help)) fail("public v4 apply command is missing from top-level help");
  if (/^\s+loop\b/m.test(help)) fail("internal loop command is visible in top-level help");
  if (/^\s+converge\b/m.test(help)) fail("internal converge command is visible in top-level help");

  const skills = JSON.parse(
    run(process.execPath, [binPath, "list", "--skills", "--json", "--path", installedRoot], {
      cwd: consumerDirectory,
    }),
  );
  if (!Array.isArray(skills) || ![
    "corgispec-ready",
    "corgispec-propose",
    "corgispec-gh-propose",
    "corgispec-update",
    "corgispec-lint",
    "corgispec-rfc",
    "corgispec-apply",
    "corgispec-verify",
    "corgispec-review",
    "corgispec-human-qa",
    "corgispec-archive-change",
  ]
    .every((slug) => skills.some((skill) => skill.slug === slug))) {
    fail("packaged skill inventory is missing an RFC-first v4 lifecycle skill");
  }
  run(process.execPath, [binPath, "validate", "--path", resolve(installedRoot, "assets/skills")], {
    cwd: consumerDirectory,
  });

  const fresh = createFreshSmokeProject();
  const freshBootstrap = JSON.parse(
    run(process.execPath, [
      binPath,
      "bootstrap",
      "--target",
      fresh.projectDirectory,
      "--mode",
      "auto",
      "--scope",
      "local",
      "--yes",
      "--json",
    ], { cwd: fresh.projectDirectory, env: fresh.env }),
  );
  if (freshBootstrap.status !== "success" || freshBootstrap.mode !== "fresh") {
    fail(`packaged fresh bootstrap returned ${String(freshBootstrap.status)}/${String(freshBootstrap.mode)}`);
  }
  verifyKnowledgeInitialization(fresh.projectDirectory, "packaged fresh bootstrap");
  verifyFoundationContract(fresh.projectDirectory, "packaged fresh bootstrap", "main");
  if (
    existsSync(resolve(fresh.projectDirectory, "wiki/sessions"))
    || existsSync(resolve(fresh.projectDirectory, "wiki/log.md"))
  ) {
    fail("packaged fresh bootstrap created retired sessions/log knowledge paths");
  }

  const smoke = createSmokeProject();
  run(process.execPath, [binPath, "install"], {
    cwd: smoke.projectDirectory,
    env: smoke.env,
  });
  const userSkillRoots = [
    resolve(smoke.env.HOME, ".claude/skills"),
    resolve(smoke.env.HOME, ".config/opencode/skill"),
    resolve(smoke.env.HOME, ".codex/skills"),
  ];
  verifyInstalledSkills(installedRoot, userSkillRoots);

  writeRc1ManagedFixture(smoke.projectDirectory, installedRoot, true);
  const bootstrap = JSON.parse(
    run(process.execPath, [
      binPath,
      "bootstrap",
      "--target",
      smoke.projectDirectory,
      "--mode",
      "update",
      "--scope",
      "both",
      "--platform",
      "claude,opencode,codex",
      "--yes",
      "--migrate-v4",
      "--json",
    ], { cwd: smoke.projectDirectory, env: smoke.env }),
  );
  if (bootstrap.status !== "success") {
    fail(`packaged bootstrap upgrade returned ${String(bootstrap.status)}`);
  }

  verifyKnowledgeInitialization(smoke.projectDirectory, "packaged migration");
  if (readFileSync(resolve(smoke.projectDirectory, "wiki/sessions/legacy.md"), "utf8")
      !== "# Legacy Session\n\nRead-only history must survive migration.\n"
      || readFileSync(resolve(smoke.projectDirectory, "wiki/log.md"), "utf8")
      !== "# Legacy Log\n\nRead-only log history must survive migration.\n") {
    fail("packaged migration changed legacy sessions/log history");
  }
  const migratedConfig = readFileSync(resolve(smoke.projectDirectory, "openspec/config.yaml"), "utf8");
  for (const expected of [
    "contract: rfc-v1",
    "rfcRoot: rfcs",
    "foundation: RFC-0001-project-foundation",
    "integrationBranch:",
  ]) {
    if (!migratedConfig.includes(expected)) fail(`packaged migration omitted config field ${expected}`);
  }
  const migratedBridge = readFileSync(resolve(smoke.projectDirectory, "memory/session-bridge.md"), "utf8");
  for (const expected of [
    "RFC Revision",
    "Slice",
    "Phase at Checkpoint",
    "Observed Run Revision",
    "Last Verified HEAD",
    "Preserve this v3 checkpoint.",
    "Human decision remains.",
  ]) {
    if (!migratedBridge.includes(expected)) fail(`packaged migration omitted bridge content ${expected}`);
  }
  const protocol = readFileSync(resolve(smoke.projectDirectory, "AGENTS.md"), "utf8");
  const bridgeIndex = protocol.indexOf("memory/session-bridge.md");
  const memoryIndex = protocol.indexOf("memory/MEMORY.md");
  const hotIndex = protocol.indexOf("wiki/hot.md");
  if (!(bridgeIndex >= 0 && bridgeIndex < memoryIndex && memoryIndex < hotIndex)) {
    fail("packaged bootstrap installed the wrong startup memory order");
  }
  if (!protocol.includes("Keep this custom instruction.")) {
    fail("packaged migration replaced custom AGENTS.md content");
  }
  const migratedHot = readFileSync(resolve(smoke.projectDirectory, "wiki/hot.md"), "utf8");
  if (!migratedHot.includes("Preserve this project decision.")) {
    fail("packaged migration replaced custom wiki/hot.md content");
  }

  const upgradedManifest = JSON.parse(
    readFileSync(resolve(smoke.projectDirectory, "openspec/.corgi-install.json"), "utf8"),
  );
  if (upgradedManifest.version !== 2) {
    fail(`packaged bootstrap left manifest at version ${String(upgradedManifest.version)}`);
  }
  if (upgradedManifest.packageVersion !== installedPackage.version) {
    fail("packaged bootstrap did not record the installed package version");
  }
  if (upgradedManifest.installedAt !== "2026-01-01T00:00:00.000Z") {
    fail("packaged bootstrap did not preserve the original install timestamp");
  }
  if (upgradedManifest.latestMigration?.fromManifestVersion !== 1) {
    fail("packaged bootstrap did not record the v1 migration source");
  }
  if (upgradedManifest.hooks?.claude?.owned !== true) {
    fail("packaged bootstrap did not record ownership of migrated Claude hooks");
  }

  const claudeSettings = JSON.parse(
    readFileSync(resolve(smoke.projectDirectory, ".claude/settings.json"), "utf8"),
  );
  const hookCommands = claudeHookCommands(claudeSettings);
  if (hookCommands.some((command) => command.includes("hook pre-write"))) {
    fail("packaged bootstrap retained the legacy generic pre-write hook");
  }
  if (hookCommands.some((command) => command.includes("hook stop-check"))) {
    fail("packaged bootstrap retained the legacy generic stop-check hook");
  }
  if (!hookCommands.some((command) => command.includes("hook loop-check"))) {
    fail("packaged bootstrap did not install the current Claude hook set");
  }
  for (const customCommand of ["node ./custom-pre-tool.cjs", "node ./custom-stop.cjs"]) {
    if (!hookCommands.includes(customCommand)) {
      fail(`packaged bootstrap removed custom Claude hook ${customCommand}`);
    }
  }
  if (
    claudeSettings.permissions?.allow?.[0] !== "Read"
    || claudeSettings.env?.PACKAGE_SMOKE_CUSTOM !== "preserve-me"
  ) {
    fail("packaged bootstrap did not preserve custom Claude settings");
  }

  verifyInstalledSkills(installedRoot, userSkillRoots);
  verifyMirroredFiles(
    resolve(installedRoot, "assets/commands/claude/corgi"),
    resolve(smoke.env.HOME, ".claude/commands/corgi"),
    "Claude user command",
  );
  verifyMirroredFiles(
    resolve(installedRoot, "assets/commands/opencode"),
    resolve(smoke.env.HOME, ".config/opencode/commands"),
    "OpenCode user command",
  );
  verifyMirroredFiles(
    resolve(installedRoot, "assets/commands/claude/corgi"),
    resolve(smoke.projectDirectory, ".claude/commands/corgi"),
    "Claude project command",
  );
  verifyMirroredFiles(
    resolve(installedRoot, "assets/commands/opencode"),
    resolve(smoke.projectDirectory, ".opencode/commands"),
    "OpenCode project command",
  );
  verifyMirroredFiles(
    resolve(installedRoot, "assets/schemas/github-tracked"),
    resolve(smoke.projectDirectory, "openspec/schemas/github-tracked"),
    "project schema asset",
  );

  const hookless = createSmokeProject("hookless-project");
  writeRc1ManagedFixture(hookless.projectDirectory, installedRoot, false);
  const hooklessBootstrap = JSON.parse(
    run(process.execPath, [
      binPath,
      "bootstrap",
      "--target",
      hookless.projectDirectory,
      "--mode",
      "update",
      "--scope",
      "local",
      "--platform",
      "claude",
      "--yes",
      "--migrate-v4",
      "--json",
    ], { cwd: hookless.projectDirectory, env: hookless.env }),
  );
  if (hooklessBootstrap.status !== "success") {
    fail(`hookless packaged bootstrap returned ${String(hooklessBootstrap.status)}`);
  }
  if (existsSync(resolve(hookless.projectDirectory, ".claude/settings.json"))) {
    fail("packaged bootstrap opted a hookless project into Claude hooks");
  }

  const doctor = JSON.parse(
    run(process.execPath, [binPath, "doctor", "--path", smoke.projectDirectory, "--json"], {
      cwd: smoke.projectDirectory,
      env: smoke.env,
    }),
  );
  if (!Array.isArray(doctor) || doctor.some((check) => check.passed !== true)) {
    fail("packaged doctor did not pass in an isolated project");
  }
  const assetCount = verifyAssetManifest(resolve(installedRoot, "assets"));
  console.log(
    `✓ Packed and installed corgispec@${version}; CLI and ${assetCount} asset checksum(s) verified`
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
