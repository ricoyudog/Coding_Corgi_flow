import { Command } from "commander";
import { resolve } from "node:path";
import { existsSync, accessSync, constants, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { findConfigPath, loadConfig } from "../lib/config.js";
import { detectPlatforms } from "../lib/platform.js";
import { detectHookConfig } from "../lib/hooks.js";
import yaml from "js-yaml";

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
    .action((opts) => {
      const cwd = resolve(opts.path);
      const results: CheckResult[] = [];

      // 1. Node version check
      results.push(checkNodeVersion());

      // 2. Skill directory checks
      results.push(...checkSkillDirs());

      // 3. Config validation
      results.push(checkConfig(cwd));

      // 4. Platform detection
      results.push(...checkPlatforms());

      // 5. Hook configuration
      results.push(checkHooks(cwd));

      // 6. Schema validation
      results.push(checkSchemas(cwd));

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
  const major = parseInt(version.split(".")[0]!, 10);

  if (major >= 18) {
    return {
      name: "Node.js",
      passed: true,
      message: `v${version}`,
    };
  }

  return {
    name: "Node.js",
    passed: false,
    message: `v${version} (requires >= 18)`,
    suggestion: "Upgrade Node.js to version 18 or later.",
  };
}

function checkSkillDirs(): CheckResult[] {
  const results: CheckResult[] = [];
  const home = homedir();

  const dirs = [
    { name: "~/.claude/skills/", path: resolve(home, ".claude/skills") },
    {
      name: "~/.config/opencode/skill/",
      path: resolve(home, ".config/opencode/skill"),
    },
  ];

  for (const dir of dirs) {
    if (!existsSync(dir.path)) {
      results.push({
        name: dir.name,
        passed: false,
        message: "not found",
        suggestion: `Run \`corgispec install\` to create.`,
      });
    } else {
      // Check writable
      try {
        accessSync(dir.path, constants.W_OK);
        results.push({
          name: dir.name,
          passed: true,
          message: "exists and writable",
        });
      } catch {
        results.push({
          name: dir.name,
          passed: false,
          message: "exists but not writable",
          suggestion: `Check permissions on ${dir.path}`,
        });
      }
    }
  }

  return results;
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
    return {
      name: "Config",
      passed: true,
      message: `valid (schema: ${config.schema})`,
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

function checkSchemas(cwd: string): CheckResult {
  // Check project schemas first, then bundled schemas
  const schemaDirs = [
    resolve(cwd, "openspec/schemas"),
    resolve(import.meta.dirname ?? ".", "../assets/schemas"),
    resolve(import.meta.dirname ?? ".", "../../assets/schemas"),
  ];

  let schemasDir: string | null = null;
  for (const dir of schemaDirs) {
    if (existsSync(dir)) {
      schemasDir = dir;
      break;
    }
  }

  if (!schemasDir) {
    return {
      name: "Schemas",
      passed: true, // Not a hard failure if no schemas available
      message: "no schemas directory found",
    };
  }

  try {
    const entries = readdirSync(schemasDir, { withFileTypes: true });
    const schemaDirNames = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    let validCount = 0;
    const errors: string[] = [];

    for (const name of schemaDirNames) {
      const schemaFile = resolve(schemasDir, name, "schema.yaml");
      if (!existsSync(schemaFile)) {
        errors.push(`${name}/schema.yaml missing`);
        continue;
      }

      try {
        const content = readFileSync(schemaFile, "utf-8");
        const parsed = yaml.load(content) as Record<string, unknown> | null;

        // Validate required schema structure
        if (!parsed || typeof parsed !== "object") {
          errors.push(`${name}/schema.yaml is not a valid YAML document`);
          continue;
        }

        if (!parsed.name || typeof parsed.name !== "string") {
          errors.push(`${name}/schema.yaml missing required 'name' field`);
          continue;
        }

        if (!parsed.artifacts || !Array.isArray(parsed.artifacts)) {
          errors.push(`${name}/schema.yaml missing required 'artifacts' array`);
          continue;
        }

        validCount++;
      } catch (parseErr: unknown) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        errors.push(`${name}/schema.yaml is not valid YAML: ${msg}`);
      }
    }

    if (errors.length > 0) {
      return {
        name: "Schemas",
        passed: false,
        message: errors.join("; "),
        suggestion: "Reinstall or repair schema files.",
      };
    }

    return {
      name: "Schemas",
      passed: true,
      message: `${validCount} schema(s) valid`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: "Schemas",
      passed: false,
      message: msg,
      suggestion: "Check schema directory permissions.",
    };
  }
}

function checkHooks(cwd: string): CheckResult {
  const hookStatus = detectHookConfig(cwd);

  if (hookStatus.configured) {
    return {
      name: "Hooks",
      passed: true,
      message: `configured for ${hookStatus.platform} (${hookStatus.events.join(", ")})`,
    };
  }

  return {
    name: "Hooks",
    passed: true,
    message: "not configured",
    suggestion: "Run `corgispec hooks generate --platform <name>` to enable hooks.",
  };
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
