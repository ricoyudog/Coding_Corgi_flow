import { Command } from "commander";
import { resolve } from "node:path";
import { existsSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONFIG_TEMPLATE = `schema: {{schema}}

# Worktree isolation (optional)
# When enabled, each change gets its own git worktree + feature branch
# for parallel development. All propose/apply/review work happens
# inside the dedicated worktree. Archive cleans up the worktree
# but preserves the branch for merging via MR.
# Example:
#   isolation:
#     mode: worktree       # worktree | none (default: none)
#     root: .worktrees     # worktree root directory (default: .worktrees)
#     branch_prefix: feat/ # feature branch prefix (default: feat/)

# Project context (optional)
# This is shown to AI when creating artifacts.
# Add your tech stack, conventions, style guides, domain knowledge, etc.
# Example:
#   context: |
#     Tech stack: TypeScript, React, Node.js
#     We use conventional commits
#     Domain: e-commerce platform

# Per-artifact rules (optional)
# Add custom rules for specific artifacts.
# Example:
#   rules:
#     proposal:
#       - Keep proposals under 500 words
#       - Always include a "Non-goals" section
#     tasks:
#       - Break tasks into chunks of max 2 hours
`;

const VALID_SCHEMAS = ["gitlab-tracked", "github-tracked"] as const;
const VALID_PLATFORMS = ["claude", "opencode", "codex", "all"] as const;

type SchemaOption = (typeof VALID_SCHEMAS)[number];
type PlatformOption = (typeof VALID_PLATFORMS)[number];

interface InitOptions {
  schema?: string;
  platform?: string;
  path: string;
}

export interface InitializeOpenSpecOptions {
  target: string;
  schema: SchemaOption;
  bundledSchemasDir?: string | null;
}

export function createInitCommand(): Command {
  const cmd = new Command("init");

  cmd
    .description("Initialize OpenSpec directory structure in a project")
    .argument("[path]", "Target directory (default: current directory)")
    .option(
      "--schema <schema>",
      "Schema to use (github-tracked or gitlab-tracked)"
    )
    .option(
      "--platform <platform>",
      "Create platform skill directories (claude, opencode, codex, all)"
    )
    .action((targetPath: string | undefined, opts: InitOptions) => {
      const cwd = resolve(opts.path ?? ".");
      const target = targetPath ? resolve(cwd, targetPath) : cwd;

      try {
        // Check if already initialized
        const configPath = resolve(target, "openspec/config.yaml");
        if (existsSync(configPath)) {
          console.log("OpenSpec already initialized");
          return;
        }

        // Validate schema option
        const schema = (opts.schema ?? "github-tracked") as SchemaOption;
        if (!VALID_SCHEMAS.includes(schema)) {
          console.error(
            `Error: Invalid schema '${opts.schema}'. Supported: ${VALID_SCHEMAS.join(", ")}`
          );
          process.exit(1);
        }

        initializeOpenSpec({
          target,
          schema,
          bundledSchemasDir: findBundledSchemas(),
        });

        console.log(`Initialized OpenSpec in ${target}`);
        console.log(`  Schema: ${schema}`);
        console.log(`  Config: openspec/config.yaml`);
        console.log(`  Changes: openspec/changes/`);
        console.log(`  Schemas: openspec/schemas/`);

        // Handle platform option
        if (opts.platform) {
          const platform = opts.platform as PlatformOption;
          if (!VALID_PLATFORMS.includes(platform)) {
            console.error(
              `\nWarning: Invalid platform '${opts.platform}'. Supported: ${VALID_PLATFORMS.join(", ")}`
            );
          } else {
            initPlatformDirs(target, platform);
          }
        }

        console.log(
          `\nRun \`corgispec propose <name>\` to start your first change.`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });

  return cmd;
}

function initPlatformDirs(target: string, platform: PlatformOption): void {
  const platforms: string[] =
    platform === "all"
      ? ["claude", "opencode", "codex"]
      : [platform];

  for (const p of platforms) {
    let dir: string;
    switch (p) {
      case "claude":
        dir = resolve(target, ".claude/skills");
        break;
      case "opencode":
        dir = resolve(target, ".opencode/skills");
        break;
      case "codex":
        dir = resolve(target, ".codex/skills");
        break;
      default:
        continue;
    }

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`  Created: ${dir}`);
    } else {
      console.log(`  Exists: ${dir}`);
    }
  }
}

export function initializeOpenSpec(options: InitializeOpenSpecOptions): void {
  const openspecDir = resolve(options.target, "openspec");
  const configPath = resolve(openspecDir, "config.yaml");

  mkdirSync(resolve(openspecDir, "changes"), { recursive: true });
  mkdirSync(resolve(openspecDir, "schemas"), { recursive: true });
  mkdirSync(resolve(openspecDir, "specs"), { recursive: true });

  const configContent = CONFIG_TEMPLATE.replace("{{schema}}", options.schema);
  writeFileSync(configPath, configContent);

  if (!options.bundledSchemasDir) {
    return;
  }

  const sourceSchema = resolve(options.bundledSchemasDir, options.schema);
  const targetSchema = resolve(openspecDir, "schemas", options.schema);
  if (existsSync(sourceSchema) && !existsSync(targetSchema)) {
    cpSync(sourceSchema, targetSchema, { recursive: true });
  }
}

/**
 * Find bundled schemas relative to the CLI's install location.
 */
export function findBundledSchemas(): string | null {
  // When installed globally: dist/../assets/schemas
  // When running from source: look up from dist to assets
  const candidates = [
    resolve(__dirname, "../assets/schemas"),
    resolve(__dirname, "../../assets/schemas"),
    resolve(__dirname, "../../../openspec/schemas"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
