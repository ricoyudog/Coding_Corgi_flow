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
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(resolve(tmpdir(), "corgispec-package-smoke-"));
const packDirectory = resolve(temporaryRoot, "pack");
const consumerDirectory = resolve(temporaryRoot, "consumer");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

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

function runExpectStatus(command, args, expectedStatus, options = {}) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    encoding: "utf8",
    env: process.env,
    ...options,
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== expectedStatus) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    fail(`${command} ${args.join(" ")} exited with ${result.status}; expected ${expectedStatus}`);
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
    "skills/molecules/corgispec-update/SKILL.md",
    "skills/molecules/corgispec-converge/SKILL.md",
    "skills/compounds/corgispec-loop/SKILL.md",
    "commands/opencode/corgi-ready.md",
    "commands/opencode/corgi-update.md",
    "commands/opencode/corgi-converge.md",
    "commands/opencode/corgi-loop.md",
    "commands/claude/corgi/ready.md",
    "commands/claude/corgi/update.md",
    "commands/claude/corgi/converge.md",
    "commands/claude/corgi/loop.md",
  ]) {
    if (!declaredFiles.includes(required)) fail(`required asset ${required} is missing`);
  }

  return declaredFiles.length;
}

function createSmokeProject() {
  const projectDirectory = resolve(consumerDirectory, "project");
  const homeDirectory = resolve(temporaryRoot, "home");
  const changeRoot = resolve(projectDirectory, "openspec/changes/smoke-change");
  mkdirSync(changeRoot, { recursive: true });
  mkdirSync(homeDirectory, { recursive: true });
  writeFileSync(
    resolve(projectDirectory, "openspec/config.yaml"),
    "schema: smoke-schema\ncorgi:\n  tracking:\n    provider: none\n  taskArtifactId: tasks\n",
  );
  writeFileSync(resolve(changeRoot, "proposal.md"), "# Smoke proposal\n");
  writeFileSync(resolve(changeRoot, "tasks.md"), "## 1. Smoke\n- [ ] 1.1 Verify packaged CLI\n");

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
else if (args[0] === "list") output({ changes: [{ name: "smoke-change", completedTasks: 0, totalTasks: 1, lastModified: "2026-01-01T00:00:00Z", status: "active" }], root: { path: root, source: "repo" } });
else if (args[0] === "status") output({
  changeName: "smoke-change", schemaName: "smoke-schema",
  planningHome: { kind: "repo", root, changesDir: path.resolve(root, "openspec/changes"), defaultSchema: "smoke-schema" },
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

  let executable = fakeScript;
  if (process.platform === "win32") {
    executable = resolve(temporaryRoot, "fake-openspec.cmd");
    writeFileSync(executable, `@echo off\r\n"${process.execPath}" "%~dp0fake-openspec.cjs" %*\r\n`);
  } else {
    chmodSync(fakeScript, 0o755);
  }

  return {
    projectDirectory,
    env: {
      ...process.env,
      CORGISPEC_OPENSPEC_BIN: executable,
      HOME: homeDirectory,
      USERPROFILE: homeDirectory,
      XDG_CONFIG_HOME: resolve(homeDirectory, ".config"),
    },
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
    "list",
    "graph",
    "status",
    "instructions",
    "propose",
    "apply",
    "review",
    "archive",
    "doctor",
    "update",
    "ready",
    "loop",
    "converge",
  ]) {
    if (!new RegExp(`(?:^|\\s)${command}(?:\\s|$)`, "m").test(help)) {
      fail(`top-level command ${command} is missing from --help`);
    }
    run(process.execPath, [binPath, command, "--help"], { cwd: consumerDirectory });
  }

  const skills = JSON.parse(
    run(process.execPath, [binPath, "list", "--skills", "--json", "--path", installedRoot], {
      cwd: consumerDirectory,
    }),
  );
  if (!Array.isArray(skills) || !["corgispec-ready", "corgispec-update", "corgispec-converge", "corgispec-loop"]
    .every((slug) => skills.some((skill) => skill.slug === slug))) {
    fail("packaged skill inventory is missing a 3.0 lifecycle skill");
  }
  run(process.execPath, [binPath, "validate", "--path", resolve(installedRoot, "assets/skills")], {
    cwd: consumerDirectory,
  });

  const smoke = createSmokeProject();
  run(process.execPath, [binPath, "install"], {
    cwd: smoke.projectDirectory,
    env: smoke.env,
  });
  for (const skillRoot of [
    resolve(smoke.env.HOME, ".claude/skills"),
    resolve(smoke.env.HOME, ".config/opencode/skill"),
    resolve(smoke.env.HOME, ".codex/skills"),
  ]) {
    for (const slug of ["corgispec-ready", "corgispec-update", "corgispec-converge", "corgispec-loop"]) {
      if (!existsSync(resolve(skillRoot, slug, "SKILL.md"))) {
        fail(`${slug} was not installed for ${skillRoot}`);
      }
    }
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
  const update = JSON.parse(
    run(process.execPath, [binPath, "update", "smoke-change", "--path", smoke.projectDirectory, "--json"], {
      cwd: smoke.projectDirectory,
      env: smoke.env,
    }),
  );
  if (update.status !== "ready") fail(`packaged update returned ${String(update.status)}`);
  const ready = JSON.parse(
    run(process.execPath, [binPath, "ready", "smoke-change", "--strict", "--path", smoke.projectDirectory, "--json"], {
      cwd: smoke.projectDirectory,
      env: smoke.env,
    }),
  );
  if (ready.status !== "ready") fail(`packaged ready returned ${String(ready.status)}`);

  writeFileSync(resolve(smoke.projectDirectory, ".gitignore"), ".corgi/loop/\n");
  run("git", ["init", "-b", "main"], { cwd: smoke.projectDirectory, env: smoke.env });
  run("git", ["config", "user.email", "package-smoke@corgispec.test"], {
    cwd: smoke.projectDirectory,
    env: smoke.env,
  });
  run("git", ["config", "user.name", "CorgiSpec Package Smoke"], {
    cwd: smoke.projectDirectory,
    env: smoke.env,
  });
  run("git", ["add", "-A"], { cwd: smoke.projectDirectory, env: smoke.env });
  run("git", ["commit", "-m", "package smoke baseline"], {
    cwd: smoke.projectDirectory,
    env: smoke.env,
  });
  const initialized = JSON.parse(
    run(process.execPath, [
      binPath,
      "loop",
      "init",
      "smoke-change",
      "--session",
      "package-smoke-session",
      "--owner",
      "package-smoke",
      "--mode",
      "hook-driven",
      "--path",
      smoke.projectDirectory,
      "--json",
    ], { cwd: smoke.projectDirectory, env: smoke.env }),
  );
  if (initialized.status !== "ok" || initialized.state?.schemaVersion !== 2) {
    fail("packaged loop init did not create a Run Contract v2 state");
  }
  const inspected = JSON.parse(
    run(process.execPath, [
      binPath,
      "loop",
      "inspect",
      "smoke-change",
      "--path",
      smoke.projectDirectory,
      "--json",
    ], { cwd: smoke.projectDirectory, env: smoke.env }),
  );
  if (inspected.state?.runId !== initialized.state.runId) {
    fail("packaged loop inspect did not return the initialized run");
  }
  const convergence = JSON.parse(
    runExpectStatus(process.execPath, [
      binPath,
      "converge",
      "smoke-change",
      "--path",
      smoke.projectDirectory,
      "--json",
    ], 1, { cwd: smoke.projectDirectory, env: smoke.env }),
  );
  if (convergence.status !== "blocked") {
    fail(`packaged converge expected an evidence blocker, got ${String(convergence.status)}`);
  }

  const assetCount = verifyAssetManifest(resolve(installedRoot, "assets"));
  console.log(
    `✓ Packed and installed corgispec@${version}; CLI and ${assetCount} asset checksum(s) verified`
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
