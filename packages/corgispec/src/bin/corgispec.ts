import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkNodeVersion } from "../lib/node-guard.js";
import { createInstallCommand } from "../commands/install.js";
import { createBootstrapCommand } from "../commands/bootstrap.js";
import { createValidateCommand } from "../commands/validate.js";
import { createListCommand } from "../commands/list.js";
import { createGraphCommand } from "../commands/graph.js";
import { createStatusCommand } from "../commands/status.js";
import { createInstructionsCommand } from "../commands/instructions.js";
import { createProposeCommand } from "../commands/propose.js";
import { createApplyCommand } from "../commands/apply.js";
import { createReviewCommand } from "../commands/review.js";
import { createArchiveCommand } from "../commands/archive.js";
import { createReadyCommand } from "../commands/ready.js";
import { createUpdateCommand } from "../commands/update.js";
import { createLoopV2Command } from "../commands/loop-v2.js";
import { createConvergeCommand } from "../commands/converge.js";
import { createInitCommand } from "../commands/init.js";
import { createDoctorCommand } from "../commands/doctor.js";
import { createHookSessionStartCommand } from "../commands/hooks/session-start.js";
import { createHookPostCompactCommand } from "../commands/hooks/post-compact.js";
import { createHookPreWriteCommand } from "../commands/hooks/pre-write.js";
import { createHookPreBashCommand } from "../commands/hooks/pre-bash.js";
import { createHookPostWriteCommand } from "../commands/hooks/post-write.js";
import { createHookStopCheckCommand } from "../commands/hooks/stop-check.js";
import { createHookCommand } from "../commands/hooks/index.js";
import { createHooksGenerateCommand } from "../commands/hooks/generate.js";

// Guard: exit early if Node version is too low
checkNodeVersion();

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "../package.json"), "utf-8")
);

const program = new Command();

program
  .name("corgispec")
  .description(
    "Unified CLI for Corgi workflow — skill management, validation, and AI instruction generation"
  )
  .version(pkg.version)
  .option("--no-color", "Disable color output");

// Respect NO_COLOR environment variable (https://no-color.org/)
if (process.env["NO_COLOR"] !== undefined) {
  process.env["FORCE_COLOR"] = "0";
}

// Setup & skill management commands
program.addCommand(createBootstrapCommand());
program.addCommand(createInstallCommand());
program.addCommand(createInitCommand());
program.addCommand(createDoctorCommand());
program.addCommand(createValidateCommand());
program.addCommand(createListCommand());
program.addCommand(createGraphCommand());

// Workflow commands
program.addCommand(createStatusCommand());
program.addCommand(createInstructionsCommand());
program.addCommand(createProposeCommand());
program.addCommand(createApplyCommand());
program.addCommand(createReviewCommand());
program.addCommand(createArchiveCommand());
program.addCommand(createUpdateCommand());
program.addCommand(createReadyCommand());
program.addCommand(createLoopV2Command());
program.addCommand(createConvergeCommand());

// Hook subcommands (corgispec hook <name>)
program.addCommand(createHookCommand());

// Hook config generation (corgispec hooks generate)
const hooksCmd = new Command("hooks");
hooksCmd.description("Generate hook configuration for AI platforms (use 'hooks generate')");
hooksCmd.addCommand(createHooksGenerateCommand());
program.addCommand(hooksCmd);

await program.parseAsync();
