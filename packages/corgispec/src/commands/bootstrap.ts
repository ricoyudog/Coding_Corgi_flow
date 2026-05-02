import { Command } from "commander";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBootstrap } from "../lib/bootstrap.js";
import type { SchemaType } from "../lib/config.js";
import type { BootstrapMode } from "../lib/install-assets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VALID_SCHEMAS = ["github-tracked", "gitlab-tracked"] as const;
const VALID_MODES = ["auto", "fresh", "update", "legacy", "verify"] as const;
type ValidationResult<T> = { ok: true; value: T } | { ok: false };

interface BootstrapCommandOptions {
  target?: string;
  schema?: SchemaType;
  mode?: BootstrapMode;
  yes?: boolean;
  memory?: boolean;
  json?: boolean;
}

export function createBootstrapCommand(): Command {
  const cmd = new Command("bootstrap");

  cmd
    .description("Bootstrap OpenSpec assets and user-level skills into a project")
    .option("--target <path>", "Target project directory", ".")
    .option("--schema <schema>", "Schema to use (github-tracked or gitlab-tracked)")
    .option("--mode <mode>", "Bootstrap mode (auto, fresh, update, legacy, verify)", "auto")
    .option("--yes", "Approve destructive legacy migration steps")
    .option("--no-memory", "Skip initializing project memory files")
    .option("--json", "Output bootstrap result as JSON")
    .action(async (opts: BootstrapCommandOptions) => {
      const schema = validateSchema(opts.schema);
      const mode = validateMode(opts.mode);

      if (!schema.ok || !mode.ok) {
        process.exitCode = 1;
        return;
      }

      const result = await runBootstrap({
        target: opts.target ?? ".",
        schema: schema.value,
        mode: mode.value,
        yes: opts.yes ?? false,
        noMemory: opts.memory === false,
        json: opts.json ?? false,
        assetsRoot: resolveBootstrapAssetsRoot(),
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printBootstrapSummary(result);
      }

      if (result.status !== "success") {
        process.exitCode = 1;
      }
    });

  return cmd;
}

function resolveBootstrapAssetsRoot(): string {
  const candidates = [
    resolve(__dirname, "../assets"),
    resolve(__dirname, "../../assets"),
  ];

  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, "commands"))) {
      return candidate;
    }
  }

  return candidates[0]!;
}

function validateSchema(schema: string | undefined): ValidationResult<SchemaType | undefined> {
  if (schema === undefined) {
    return { ok: true, value: undefined };
  }

  if ((VALID_SCHEMAS as readonly string[]).includes(schema)) {
    return { ok: true, value: schema as SchemaType };
  }

  console.log(
    `Invalid schema '${schema}'. Supported: ${VALID_SCHEMAS.join(", ")}`
  );
  return { ok: false };
}

function validateMode(mode: string | undefined): ValidationResult<BootstrapMode> {
  const candidate = mode ?? "auto";

  if ((VALID_MODES as readonly string[]).includes(candidate)) {
    return { ok: true, value: candidate as BootstrapMode };
  }

  console.log(`Invalid mode '${candidate}'. Supported: ${VALID_MODES.join(", ")}`);
  return { ok: false };
}

function printBootstrapSummary(result: Awaited<ReturnType<typeof runBootstrap>>): void {
  console.log(`Status: ${result.status}`);
  console.log(`Mode: ${result.mode}`);
  console.log(`Message: ${result.message}`);
  console.log(`Report: ${result.reportPath}`);

  if (result.actions.length > 0) {
    console.log("Actions:");
    for (const action of result.actions) {
      console.log(`- ${action}`);
    }
  }
}
