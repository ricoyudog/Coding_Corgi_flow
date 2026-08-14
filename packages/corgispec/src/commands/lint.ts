import { Command } from "commander";
import { relative, resolve } from "node:path";

import {
  lintMemoryWikiV4,
  memoryLintExitCode,
  renderMemoryLintReport,
  writeMemoryLintReport,
  type LintMemoryWikiV4Input,
  type MemoryLintResult,
} from "../lib/memory-lint-v4.js";

export interface LintCommandDependencies {
  lint?: (input: LintMemoryWikiV4Input) => MemoryLintResult;
  now?: () => Date;
  writeOutput?: (output: string) => void;
  setExitCode?: (code: number) => void;
}

export function createLintCommand(dependencies: LintCommandDependencies = {}): Command {
  const command = new Command("lint");
  const lint = dependencies.lint ?? lintMemoryWikiV4;
  const now = dependencies.now ?? (() => new Date());
  const writeOutput = dependencies.writeOutput ?? ((output) => process.stdout.write(output));
  const setExitCode = dependencies.setExitCode ?? ((code) => { process.exitCode = code; });

  command
    .description("Check RFC-first v4 Memory/Wiki health without modifying project knowledge")
    .option("--report", "Write the rendered report to wiki/meta/lint-report-YYYY-MM-DD.md")
    .option("--json", "Output the deterministic result as JSON")
    .option("--path <dir>", "Project directory", ".")
    .action((options: { report?: boolean; json?: boolean; path: string }) => {
      const projectRoot = resolve(options.path);
      const result = lint({ projectRoot, now: now() });
      const reportPath = options.report ? writeMemoryLintReport(result) : null;
      if (options.json) {
        writeOutput(`${JSON.stringify({ ...result, reportPath: reportPath ? relative(projectRoot, reportPath).replace(/\\/gu, "/") : null }, null, 2)}\n`);
      } else {
        writeOutput(renderMemoryLintReport(result));
      }
      setExitCode(memoryLintExitCode(result.outcome));
    });

  return command;
}
