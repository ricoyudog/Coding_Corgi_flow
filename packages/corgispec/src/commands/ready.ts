import { Command } from "commander";
import { resolve } from "node:path";
import {
  createArtifactResolver,
  type ArtifactResolver,
} from "../lib/artifact-resolver.js";
import { loadConfigFromDir } from "../lib/config.js";
import {
  buildLifecycleReadyReport,
  lifecycleError,
} from "../lib/lifecycle.js";
import {
  createOpenSpecAdapter,
  type OpenSpecAdapter,
} from "../lib/openspec-adapter.js";

export interface ReadyCommandDependencies {
  createAdapter?: (cwd: string) => OpenSpecAdapter;
  createResolver?: (adapter: OpenSpecAdapter) => ArtifactResolver;
}
export function createReadyCommand(
  dependencies: ReadyCommandDependencies = {},
): Command {
  const cmd = new Command("ready");
  const adapterFactory = dependencies.createAdapter ?? ((cwd) => createOpenSpecAdapter(cwd));
  const resolverFactory = dependencies.createResolver ?? ((adapter) => createArtifactResolver(adapter));

  cmd
    .description("Run deterministic planning-integrity preflight for a change")
    .argument("<change>", "Change name")
    .option("--strict", "Treat readiness warnings as blockers")
    .option("--store <id>", "OpenSpec Store id")
    .option("--json", "Output the machine-readable readiness contract")
    .option("--path <dir>", "Working directory", ".")
    .action(async (change: string, opts: {
      strict?: boolean;
      store?: string;
      json?: boolean;
      path: string;
    }) => {
      const cwd = resolve(opts.path);
      try {
        const config = loadConfigFromDir(cwd);
        const adapter = adapterFactory(cwd);
        const resolved = await resolverFactory(adapter).resolve(change, { store: opts.store });
        const { report } = await buildLifecycleReadyReport(
          adapter,
          resolved,
          config,
          opts.strict ?? false,
          { store: opts.store },
          cwd,
        );

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(`Readiness: ${report.status}`);
          console.log(`Change: ${report.changeName}`);
          console.log(`Planning revision: ${report.planningRevision}`);
          for (const check of report.checks) {
            const icon = check.status === "pass" ? "✓" : check.status === "warning" ? "!" : "✗";
            console.log(`  ${icon} ${check.code}: ${check.message}`);
          }
        }

        if (report.status !== "ready") process.exitCode = 1;
      } catch (error) {
        const failure = {
          schemaVersion: 1,
          changeName: change,
          status: "contract_error" as const,
          contract: null,
          error: lifecycleError(error),
        };
        if (opts.json) console.log(JSON.stringify(failure, null, 2));
        else console.error(`Error: ${failure.error.message}`);
        process.exitCode = 2;
      }
    });

  return cmd;
}
