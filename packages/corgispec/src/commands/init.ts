import { Command } from "commander";
import { resolve } from "node:path";
import { existsSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONFIG_TEMPLATE = `schema: {{schema}}

corgi:
  tracking:
    provider: {{trackingProvider}}
{{taskArtifactConfig}}

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

const VALID_TRACKING_PROVIDERS = ["github", "gitlab", "none"] as const;
const VALID_PLATFORMS = ["claude", "opencode", "codex", "all"] as const;

type PlatformOption = (typeof VALID_PLATFORMS)[number];
type TrackingProviderOption = (typeof VALID_TRACKING_PROVIDERS)[number];

interface InitOptions {
  schema?: string;
  trackingProvider?: string;
  taskArtifact?: string;
  platform?: string;
  path: string;
}

export interface InitializeOpenSpecOptions {
  target: string;
  schema: string;
  trackingProvider?: TrackingProviderOption;
  taskArtifactId?: string;
  bundledSchemasDir?: string | null;
}

export function createInitCommand(): Command {
  const cmd = new Command("init");

  cmd
    .description("Initialize Corgi directory structure in a project")
    .argument("[path]", "Target directory (default: current directory)")
    .option(
      "--schema <schema>",
      "OpenSpec schema to use (built-in or custom)"
    )
    .option("--tracking-provider <provider>", "Issue tracker (github, gitlab, none)")
    .option("--task-artifact <id>", "Artifact id containing executable Task Groups")
    .option(
      "--platform <platform>",
      "Create platform skill directories (claude, opencode, codex, all)"
    )
    .action(async (targetPath: string | undefined, opts: InitOptions) => {
      const cwd = resolve(opts.path ?? ".");
      const target = targetPath ? resolve(cwd, targetPath) : cwd;

      try {
        // Validate schema option
        const schema = opts.schema ?? "github-tracked";
        if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(schema)) {
          console.error(
            `Error: Invalid schema '${opts.schema}'. Use a kebab-case OpenSpec schema name.`
          );
          process.exitCode = 1; return;
        }
        const inferredProvider =
          schema === "github-tracked"
            ? "github"
            : schema === "gitlab-tracked"
              ? "gitlab"
              : "none";
        const trackingProvider = (opts.trackingProvider ?? inferredProvider) as TrackingProviderOption;
        if (!VALID_TRACKING_PROVIDERS.includes(trackingProvider)) {
          console.error(
            `Error: Invalid tracking provider '${opts.trackingProvider}'. Supported: ${VALID_TRACKING_PROVIDERS.join(", ")}`
          );
          process.exitCode = 1;
          return;
        }
        const explicitTaskArtifact = opts.taskArtifact?.trim();
        if (opts.taskArtifact !== undefined && !explicitTaskArtifact) {
          console.error("Error: --task-artifact must be a non-empty artifact id");
          process.exitCode = 1;
          return;
        }
        const taskArtifactId =
          explicitTaskArtifact ??
          (schema === "github-tracked" || schema === "gitlab-tracked" ? "tasks" : undefined);

        const platform = opts.platform as PlatformOption | undefined;
        if (platform && !VALID_PLATFORMS.includes(platform)) {
          console.error(
            `Error: Invalid platform '${opts.platform}'. Supported: ${VALID_PLATFORMS.join(", ")}`
          );
          process.exitCode = 1;
          return;
        }
        const schemas = findBundledSchemas();
        if (!schemas) throw new Error("Bundled schemas were not found; run the v4 bootstrap package build first");
        const { runBootstrap } = await import("../lib/bootstrap.js");
        const result = await runBootstrap({
          target,
          schema,
          trackingProvider,
          taskArtifactId,
          mode: "auto",
          yes: true,
          json: false,
          assetsRoot: dirname(schemas),
          platforms: platform && platform !== "all" ? [platform] : undefined,
          scope: "local",
          migrateV4: false,
        });
        if (result.status !== "success") {
          console.error(`Error: ${result.message}`);
          process.exitCode = 1;
          return;
        }
        console.log(`Initialized Corgi RFC-first project in ${target}`);
        console.log(`  Schema: ${schema}`);
        console.log(`  Tracking: ${trackingProvider}`);
        console.log(`  Foundation: rfcs/RFC-0001-project-foundation/rfc.md`);
        console.log("\nComplete and accept the Foundation RFC before proposing changes.");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exitCode = 1; return;
      }
    });

  return cmd;
}

export function initializeOpenSpec(options: InitializeOpenSpecOptions): void {
  const openspecDir = resolve(options.target, "openspec");
  const configPath = resolve(openspecDir, "config.yaml");

  mkdirSync(resolve(openspecDir, "changes"), { recursive: true });
  mkdirSync(resolve(openspecDir, "schemas"), { recursive: true });
  mkdirSync(resolve(openspecDir, "specs"), { recursive: true });

  const trackingProvider =
    options.trackingProvider ??
    (options.schema === "github-tracked"
      ? "github"
      : options.schema === "gitlab-tracked"
        ? "gitlab"
        : "none");
  const taskArtifactId =
    options.taskArtifactId ??
    (options.schema === "github-tracked" || options.schema === "gitlab-tracked"
      ? "tasks"
      : undefined);
  const configContent = CONFIG_TEMPLATE
    .replace("{{schema}}", options.schema)
    .replace("{{trackingProvider}}", trackingProvider)
    .replace(
      "{{taskArtifactConfig}}",
      taskArtifactId ? `  taskArtifactId: ${taskArtifactId}` : "",
    );
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
