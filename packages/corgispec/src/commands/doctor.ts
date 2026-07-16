import { Command } from "commander";
import { delimiter, resolve, relative } from "node:path";
import {
  existsSync,
  accessSync,
  constants,
  readdirSync,
  readFileSync,
  lstatSync,
} from "node:fs";
import { createHash } from "node:crypto";
import {
  findConfigPath,
  loadConfig,
  loadConfigFromDir,
  resolveTrackingProvider,
} from "../lib/config.js";
import { detectPlatforms, type PlatformInfo } from "../lib/platform.js";
import { inspectHookInstallations, type HookPlatform } from "../lib/hook-install.js";
import { discoverSkills, validateSkill, type DiscoveredSkill } from "../lib/skills.js";
import { getBundledSkillsDir } from "./install.js";
import {
  inspectOpenSpecRuntime,
  NodeCommandRunner,
} from "../lib/openspec-runtime.js";

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  suggestion?: string;
}

export function createDoctorCommand(): Command {
  const cmd = new Command("doctor");

  cmd
    .description(
      "Diagnose runtime environment and report issues with suggestions"
    )
    .option("--path <dir>", "Working directory", ".")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const cwd = resolve(opts.path);
      const results: CheckResult[] = [];

      // 1. Node version check
      results.push(checkNodeVersion());

      // 2. OpenSpec CLI contract check
      results.push(await checkOpenSpecRuntime(cwd));

      // 3. Skill directory checks
      results.push(...checkSkillDirs());

      // 4. Config validation
      results.push(checkConfig(cwd));

      // 5. Platform detection
      results.push(...checkPlatforms());

      // 6. Hook configuration
      results.push(...checkHooks(cwd));

      // 7. Active schema validation through OpenSpec itself
      results.push(await checkSchema(cwd));

      // Output
      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        printResults(results);
      }

      // Exit code
      const hasFailure = results.some((r) => !r.passed);
      if (hasFailure) {
        process.exitCode = 1;
      }
    });

  return cmd;
}

function checkNodeVersion(): CheckResult {
  const version = process.versions.node;
  const [major = 0, minor = 0] = version.split(".").map((part) => Number.parseInt(part, 10));

  if (major > 20 || (major === 20 && minor >= 19)) {
    return {
      name: "Node.js",
      passed: true,
      message: `v${version}`,
    };
  }

  return {
    name: "Node.js",
    passed: false,
    message: `v${version} (requires >= 20.19.0)`,
    suggestion: "Upgrade Node.js to version 20.19.0 or later.",
  };
}

async function checkOpenSpecRuntime(cwd: string): Promise<CheckResult> {
  try {
    const runtime = await inspectOpenSpecRuntime({
      cwd,
      executable: process.env["CORGISPEC_OPENSPEC_BIN"] || "openspec",
    });
    return {
      name: "OpenSpec CLI",
      passed: true,
      message: `${runtime.version.raw} (native planning contract)`,
    };
  } catch (error) {
    return {
      name: "OpenSpec CLI",
      passed: false,
      message: error instanceof Error ? error.message : String(error),
      suggestion: "Install @fission-ai/openspec >=1.6.0 <2.0.0 and ensure `openspec` is on PATH.",
    };
  }
}

function checkSkillDirs(): CheckResult[] {
  const detected = detectPlatforms().filter((platform) => platform.detected);
  if (detected.length === 0) {
    return [{
      name: "AI Skills",
      passed: true,
      message: "not checked (no AI platform detected)",
    }];
  }

  let bundled: DiscoveredSkill[];
  try {
    bundled = discoverSkills(getBundledSkillsDir());
  } catch (error) {
    return [{
      name: "AI Skills",
      passed: false,
      message: error instanceof Error ? error.message : String(error),
      suggestion: "Reinstall corgispec from a package with verified assets.",
    }];
  }

  return detected.map((platform) => checkSkillInstallation(platform, bundled));
}

function checkSkillInstallation(
  platform: PlatformInfo,
  bundled: DiscoveredSkill[],
): CheckResult {
  const name = `${platform.platform} skills`;
  if (!existsSync(platform.skillDir)) {
    return {
      name,
      passed: false,
      message: `${platform.skillDir} not found`,
      suggestion: `Run \`corgispec install --platform ${platform.platform}\`.`,
    };
  }

  try {
    accessSync(platform.skillDir, constants.W_OK);
  } catch {
    return {
      name,
      passed: false,
      message: `${platform.skillDir} is not writable`,
      suggestion: `Check permissions on ${platform.skillDir}.`,
    };
  }

  const expected = bundled.filter((skill) =>
    Array.isArray(skill.meta.installation?.targets) &&
    skill.meta.installation.targets.includes(platform.platform)
  );
  const installed = discoverSkills(platform.skillDir);
  const installedBySlug = new Map(installed.map((skill) => [skill.slug, skill]));
  const tiers = new Map(installed.map((skill) => [skill.slug, skill.meta.tier]));
  const problems: string[] = [];

  for (const skill of expected) {
    const actual = installedBySlug.get(skill.slug);
    if (!actual) {
      problems.push(`missing ${skill.slug}`);
      continue;
    }
    const validationIssues = validateSkill(actual, tiers);
    if (validationIssues.length > 0) {
      problems.push(`${skill.slug} metadata/content invalid`);
      continue;
    }
    if (!directoriesMatch(skill.dir, actual.dir)) {
      problems.push(`${skill.slug} differs from bundled checksum`);
    }
  }

  if (problems.length > 0) {
    return {
      name,
      passed: false,
      message: `${problems.slice(0, 3).join("; ")}${problems.length > 3 ? `; +${problems.length - 3} more` : ""}`,
      suggestion: `Run \`corgispec install --platform ${platform.platform}\` to repair the managed skills.`,
    };
  }

  return {
    name,
    passed: true,
    message: `${expected.length} managed skills verified at ${platform.skillDir}`,
  };
}

function directoriesMatch(expectedDir: string, actualDir: string): boolean {
  try {
    const expected = hashDirectory(expectedDir);
    const actual = hashDirectory(actualDir);
    if (expected.size !== actual.size) return false;
    for (const [path, hash] of expected) {
      if (actual.get(path) !== hash) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function hashDirectory(root: string): Map<string, string> {
  const hashes = new Map<string, string>();
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && !lstatSync(absolute).isSymbolicLink()) {
        const path = relative(root, absolute).split("\\").join("/");
        hashes.set(path, createHash("sha256").update(readFileSync(absolute)).digest("hex"));
      } else {
        throw new Error(`Unsupported skill entry: ${absolute}`);
      }
    }
  };
  visit(root);
  return hashes;
}

function checkConfig(cwd: string): CheckResult {
  const configPath = findConfigPath(cwd);

  if (!configPath) {
    return {
      name: "Config",
      passed: true, // Not a failure — just not in a project
      message: "not found (not in a Corgi project)",
    };
  }

  try {
    const config = loadConfig(configPath);
    const tracking = resolveTrackingProvider(config);
    return {
      name: "Config",
      passed: true,
      message: `valid (schema: ${config.schema}, tracking: ${tracking.provider}${
        tracking.source === "legacy-schema" ? ", inferred from legacy schema" : ""
      })`,
      ...(tracking.source === "legacy-schema"
        ? {
            suggestion:
              "Add `corgi.tracking.provider` explicitly; schema no longer selects the issue tracker.",
          }
        : {}),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: "Config",
      passed: false,
      message: msg,
      suggestion: "Fix the config.yaml file or run `corgispec init` to recreate it.",
    };
  }
}

function checkPlatforms(): CheckResult[] {
  const results: CheckResult[] = [];
  const platforms = detectPlatforms();
  const detected = platforms.filter((p) => p.detected);

  if (detected.length === 0) {
    results.push({
      name: "AI Platforms",
      passed: true, // Not a hard failure
      message:
        "No AI platforms detected. Run `corgispec install` after setting up your platform.",
    });
  } else {
    for (const p of detected) {
      results.push({
        name: `${p.platform} (platform)`,
        passed: true,
        message: "detected",
      });
    }
  }

  return results;
}

async function checkSchema(cwd: string): Promise<CheckResult> {
  let schema: string;
  try {
    schema = loadConfigFromDir(cwd).schema;
  } catch {
    return {
      name: "Schema",
      passed: true,
      message: "not checked (no valid project config)",
    };
  }

  try {
    const runner = new NodeCommandRunner();
    const result = await runner.run({
      command: process.env["CORGISPEC_OPENSPEC_BIN"] || "openspec",
      args: ["schema", "validate", schema, "--json"],
      cwd,
      timeoutMs: 15_000,
      env: { OPENSPEC_TELEMETRY: "0" },
    });
    let parsed: { valid?: unknown; issues?: unknown } | null = null;
    try {
      parsed = JSON.parse(result.stdout) as { valid?: unknown; issues?: unknown };
    } catch {
      // A non-JSON upstream response is a contract failure even when exit 0.
    }
    if (
      !result.timedOut &&
      result.exitCode === 0 &&
      parsed !== null &&
      parsed.valid === true
    ) {
      return { name: "Schema", passed: true, message: `${schema} valid (OpenSpec)` };
    }
    const issues = Array.isArray(parsed?.issues)
      ? parsed.issues
          .map((issue) =>
            typeof issue === "object" && issue !== null && "message" in issue
              ? String((issue as { message: unknown }).message)
              : String(issue),
          )
          .join("; ")
      : result.stderr.trim() || "OpenSpec schema validation returned an invalid response";
    return {
      name: "Schema",
      passed: false,
      message: issues,
      suggestion: `Run \`openspec schema validate ${schema}\` and repair the active schema.`,
    };
  } catch (error) {
    return {
      name: "Schema",
      passed: false,
      message: error instanceof Error ? error.message : String(error),
      suggestion: "Check the OpenSpec executable and schema permissions.",
    };
  }
}

function checkHooks(cwd: string): CheckResult[] {
  const inspection = inspectHookInstallations({
    root: cwd,
    binaryPath: resolveDoctorBinaryPath(),
    cliEntry: process.argv[1] ? resolve(process.argv[1]) : "corgispec",
  });
  return (["claude", "opencode", "codex"] as HookPlatform[]).map((platform) => {
    const status = inspection.platforms[platform];
    const name = `Hooks (${platform})`;
    if (status.state === "hookless") {
      return {
        name,
        passed: true,
        message: "not configured (opt-in preserved)",
        suggestion: `Run \`corgispec hooks generate --platform ${platform}\` to enable hooks.`,
      };
    }
    if (status.state === "current" || status.state === "configured") {
      return {
        name,
        passed: true,
        message: `current Corgi hook format (${status.ownedPaths.length} owned file(s))`,
      };
    }
    const details = status.conflicts.length > 0
      ? status.conflicts.map((conflict) => conflict.reason).join("; ")
      : `${status.actions.length} migration action(s) pending`;
    return {
      name,
      passed: false,
      message: `${status.state}: ${details}`,
      suggestion: `Run \`corgispec bootstrap --target ${JSON.stringify(cwd)} --mode update --scope local --platform ${platform}\`.`,
    };
  });
}

function resolveDoctorBinaryPath(): string {
  const names = process.platform === "win32"
    ? ["corgispec.cmd", "corgispec.exe", "corgispec.bat", "corgispec"]
    : ["corgispec"];
  for (const directory of (process.env["PATH"] ?? "").split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = resolve(directory, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return "npx corgispec";
}

function printResults(results: CheckResult[]): void {
  console.log("corgispec doctor\n");

  let passCount = 0;
  let failCount = 0;

  for (const r of results) {
    const icon = r.passed ? "✓" : "✗";
    const status = r.passed ? "pass" : "FAIL";
    console.log(`  ${icon} ${r.name}: ${r.message} (${status})`);
    if (!r.passed && r.suggestion) {
      console.log(`    → ${r.suggestion}`);
    }
    if (r.passed) passCount++;
    else failCount++;
  }

  console.log();
  if (failCount === 0) {
    console.log(`All ${passCount} checks passed.`);
  } else {
    console.log(
      `${passCount} passed, ${failCount} failed.`
    );
  }
}
