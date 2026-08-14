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
import { createApplyV3Command } from "../commands/apply-v3.js";
import { createVerifyCommand } from "../commands/verify-v3.js";
import { createReviewV3Command } from "../commands/review-v3.js";
import { createHumanQaCommand } from "../commands/human-qa-v3.js";
import { createArchiveV3Command } from "../commands/archive-v3.js";
import { createChangeV3Command } from "../commands/change-v3.js";
import { createReadyCommand } from "../commands/ready.js";
import { createUpdateCommand } from "../commands/update.js";
import { createInitCommand } from "../commands/init.js";
import { createDoctorCommand } from "../commands/doctor.js";
import { createLintCommand } from "../commands/lint.js";
import { createHookSessionStartCommand } from "../commands/hooks/session-start.js";
import { createHookPostCompactCommand } from "../commands/hooks/post-compact.js";
import { createHookPreWriteCommand } from "../commands/hooks/pre-write.js";
import { createHookPreBashCommand } from "../commands/hooks/pre-bash.js";
import { createHookPostWriteCommand } from "../commands/hooks/post-write.js";
import { createHookStopCheckCommand } from "../commands/hooks/stop-check.js";
import { createHookCommand } from "../commands/hooks/index.js";
import { createHooksGenerateCommand } from "../commands/hooks/generate.js";
import { createRfcCommand } from "../commands/rfc.js";

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
    "RFC-first engineering workflow with traceable delivery, evidence, and AI session continuity"
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
program.addCommand(createLintCommand());
program.addCommand(createRfcCommand());
program.addCommand(createValidateCommand());
program.addCommand(createListCommand());
program.addCommand(createGraphCommand());

// Workflow commands
program.addCommand(createStatusCommand());
program.addCommand(createInstructionsCommand());
program.addCommand(createProposeCommand());
program.addCommand(createApplyV3Command());
program.addCommand(createVerifyCommand());
program.addCommand(createReviewV3Command());
program.addCommand(createHumanQaCommand());
program.addCommand(createArchiveV3Command());
program.addCommand(createChangeV3Command());
program.addCommand(createUpdateCommand());
program.addCommand(createReadyCommand());

// Hook subcommands (corgispec hook <name>)
program.addCommand(createHookCommand());

// Hook config generation (corgispec hooks generate)
const hooksCmd = new Command("hooks");
hooksCmd.description("Generate hook configuration for AI platforms (use 'hooks generate')");
hooksCmd.addCommand(createHooksGenerateCommand());
program.addCommand(hooksCmd);

await program.parseAsync();
