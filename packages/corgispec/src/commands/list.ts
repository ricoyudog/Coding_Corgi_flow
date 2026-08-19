import { Command } from "commander";
import { resolve } from "node:path";
import {
  discoverSkills,
  filterSkills,
  type SkillTier,
  type SkillPlatform,
  type DiscoveredSkill,
} from "../lib/skills.js";
import {
  createOpenSpecAdapter,
  type OpenSpecAdapter,
} from "../lib/openspec-adapter.js";
import {
  createArtifactResolver,
  type ArtifactResolver,
} from "../lib/artifact-resolver.js";
import { loadConfigFromDir } from "../lib/config.js";
import { lifecycleError, summarizeOptionalTaskGroups } from "../lib/lifecycle.js";
import { summarizeChangeContract } from "../lib/change-contract.js";

/**
 * List active changes from the native OpenSpec JSON contract and enrich each
 * entry with the same normalized lifecycle fields exposed by status.
 */
async function listChanges(
  cwd: string,
  json: boolean,
  store: string | undefined,
  adapter: OpenSpecAdapter,
  resolver: ArtifactResolver,
): Promise<void> {
  const response = await adapter.listChanges({ store });
  if (response.changes.length === 0) {
    if (json) {
      console.log(JSON.stringify([]));
    } else {
      console.log("No changes found.");
    }
    return;
  }

  const config = loadConfigFromDir(cwd);
  const changes = await Promise.all(response.changes.map(async (change) => {
    const resolved = await resolver.resolve(change.name, { store });
    const tasks = summarizeOptionalTaskGroups(config, resolved.artifactPaths);
    const implementationComplete = tasks.implementationComplete;
    return {
      ...change,
      path: response.root?.path ?? cwd,
      schemaName: resolved.schemaName,
      planningComplete: resolved.planningComplete,
      implementationComplete,
      /** @deprecated Use planningComplete and implementationComplete. */
      isComplete: resolved.planningComplete && implementationComplete,
      changeRoot: resolved.changeRoot,
      artifactPaths: resolved.artifactPaths,
      planningRevision: resolved.planningRevision,
      contract: resolved.contract ? summarizeChangeContract(resolved.contract, cwd) : null,
      taskArtifactId: tasks.taskArtifactId || null,
    };
  }));

  if (json) {
    console.log(JSON.stringify(changes, null, 2));
  } else {
    if (changes.length === 0) {
      console.log("No changes found.");
      return;
    }
    console.log("Changes:\n");
    for (const change of changes) {
      const pct =
        change.totalTasks > 0
          ? Math.round((change.completedTasks / change.totalTasks) * 100)
          : 0;
      console.log(
        `  ${change.name}  ${change.completedTasks}/${change.totalTasks} tasks (${pct}%)  path: ${change.path}  modified: ${change.lastModified.split("T")[0]}`
      );
    }
  }
}

/**
 * List skills from a directory.
 */
function listSkills(
  cwd: string,
  opts: { tier?: string; platform?: string; json: boolean }
): void {
  // Find skills
  const searchPaths = [
    resolve(cwd, ".opencode/skills"),
    resolve(cwd, ".claude/skills"),
    resolve(cwd, ".codex/skills"),
    resolve(cwd, "assets/skills"), // bundled
  ];

  let skills: DiscoveredSkill[] = [];
  for (const p of searchPaths) {
    const found = discoverSkills(p);
    if (found.length > 0) {
      skills = found;
      break;
    }
  }

  if (skills.length === 0) {
    if (opts.json) {
      console.log(JSON.stringify([]));
    } else {
      console.log("No skills found.");
    }
    return;
  }

  // Apply filters
  const filtered = filterSkills(skills, {
    tier: opts.tier as SkillTier | undefined,
    platform: opts.platform as SkillPlatform | undefined,
  });

  if (opts.json) {
    const output = filtered.map((s) => ({
      slug: s.slug,
      tier: s.meta.tier,
      platform: s.meta.platform,
      version: s.meta.version,
      description: s.meta.description,
      depends_on: s.meta.depends_on,
    }));
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`Skills (${filtered.length}):\n`);
    for (const s of filtered) {
      console.log(
        `  ${s.slug}  [${s.meta.tier}/${s.meta.platform}]  ${s.meta.description}`
      );
    }
  }
}

export interface ListCommandDependencies {
  createAdapter?: (cwd: string) => OpenSpecAdapter;
  createResolver?: (adapter: OpenSpecAdapter) => ArtifactResolver;
}

export function createListCommand(
  dependencies: ListCommandDependencies = {},
): Command {
  const cmd = new Command("list");
  const adapterFactory = dependencies.createAdapter ?? ((cwd) => createOpenSpecAdapter(cwd));
  const resolverFactory = dependencies.createResolver ?? ((adapter) => createArtifactResolver(adapter));

  cmd
    .description("List changes (default) or skills (--skills)")
    .option("--skills", "List skills instead of changes")
    .option("--tier <tier>", "Filter skills by tier (atom, molecule, compound)")
    .option(
      "--platform <platform>",
      "Filter skills by platform (universal, github, gitlab)"
    )
    .option("--json", "Output as JSON")
    .option("--store <id>", "OpenSpec Store id")
    .option("--path <dir>", "Working directory", ".")
    .action(async (opts) => {
      const cwd = resolve(opts.path);

      if (opts.skills) {
        listSkills(cwd, {
          tier: opts.tier,
          platform: opts.platform,
          json: opts.json ?? false,
        });
      } else {
        try {
          const adapter = adapterFactory(cwd);
          await listChanges(
            cwd,
            opts.json ?? false,
            opts.store,
            adapter,
            resolverFactory(adapter),
          );
        } catch (error) {
          const failure = lifecycleError(error);
          if (opts.json) console.log(JSON.stringify({ status: "contract_error", error: failure }, null, 2));
          else console.error(`Error: ${failure.message}`);
          process.exitCode = 1;
        }
      }
    });

  return cmd;
}
