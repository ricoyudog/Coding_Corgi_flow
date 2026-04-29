#!/usr/bin/env node
// tools/ds-skills/bin/ds-skills.js

import { Command } from "commander";

const program = new Command();

program
  .name("ds-skills")
  .description("CLI tool for ds-internal-skills validation and management")
  .version("0.1.0");

program
  .command("validate")
  .description("Validate all skills structure and constraints")
  .option("--path <dir>", "Skills root directory", ".")
  .action(async (opts) => {
    const { runValidate } = await import("../lib/validate.js");
    const exitCode = await runValidate(opts.path);
    process.exit(exitCode);
  });

program
  .command("list")
  .description("List skills with optional filters")
  .option("--path <dir>", "Skills root directory", ".")
  .option("--tier <tier>", "Filter by tier: atom, molecule, compound")
  .option("--platform <platform>", "Filter by platform: universal, github, gitlab")
  .action(async (opts) => {
    const { runList } = await import("../lib/list.js");
    await runList(opts.path, { tier: opts.tier, platform: opts.platform });
  });

program
  .command("graph")
  .description("Generate dependency graph")
  .option("--path <dir>", "Skills root directory", ".")
  .option("--format <fmt>", "Output format: mermaid or dot", "mermaid")
  .option("--tier <tier>", "Filter by tier: atom, molecule, compound")
  .action(async (opts) => {
    const { runGraph } = await import("../lib/graph.js");
    await runGraph(opts.path, { format: opts.format, tier: opts.tier });
  });

program
  .command("check-deps")
  .description("Show full dependency tree for a skill")
  .argument("<slug>", "Skill slug to check")
  .option("--path <dir>", "Skills root directory", ".")
  .action(async (slug, opts) => {
    const { runCheckDeps } = await import("../lib/graph.js");
    await runCheckDeps(opts.path, slug);
  });

program.parse();
