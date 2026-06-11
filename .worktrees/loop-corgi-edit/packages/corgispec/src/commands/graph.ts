import { Command } from "commander";
import { resolve } from "node:path";
import {
  discoverSkills,
  filterSkills,
  type SkillTier,
  type DiscoveredSkill,
} from "../lib/skills.js";

/**
 * Generate a Mermaid flowchart from skill dependencies.
 */
function toMermaid(skills: DiscoveredSkill[]): string {
  const lines: string[] = ["graph TD"];

  // Add nodes with tier styling
  for (const skill of skills) {
    const label = `${skill.slug}`;
    lines.push(`  ${skill.slug}["${label}"]`);
  }

  // Add edges for dependencies
  for (const skill of skills) {
    for (const dep of skill.meta.depends_on) {
      // Only add edge if dep is in the filtered set
      if (skills.some((s) => s.slug === dep)) {
        lines.push(`  ${dep} --> ${skill.slug}`);
      }
    }
  }

  // Add tier class definitions
  lines.push("");
  lines.push("  classDef atom fill:#e8f5e9,stroke:#4caf50");
  lines.push("  classDef molecule fill:#e3f2fd,stroke:#2196f3");
  lines.push("  classDef compound fill:#fce4ec,stroke:#e91e63");

  // Apply classes
  const atoms = skills.filter((s) => s.meta.tier === "atom").map((s) => s.slug);
  const molecules = skills
    .filter((s) => s.meta.tier === "molecule")
    .map((s) => s.slug);
  const compounds = skills
    .filter((s) => s.meta.tier === "compound")
    .map((s) => s.slug);

  if (atoms.length > 0) lines.push(`  class ${atoms.join(",")} atom`);
  if (molecules.length > 0)
    lines.push(`  class ${molecules.join(",")} molecule`);
  if (compounds.length > 0)
    lines.push(`  class ${compounds.join(",")} compound`);

  return lines.join("\n");
}

/**
 * Generate a Graphviz DOT graph from skill dependencies.
 */
function toDot(skills: DiscoveredSkill[]): string {
  const lines: string[] = ["digraph skills {"];
  lines.push("  rankdir=BT;");
  lines.push("  node [shape=box, style=filled];");
  lines.push("");

  // Tier-based colors
  const tierColors: Record<string, string> = {
    atom: "#e8f5e9",
    molecule: "#e3f2fd",
    compound: "#fce4ec",
  };

  // Add nodes
  for (const skill of skills) {
    const color = tierColors[skill.meta.tier] || "#ffffff";
    lines.push(
      `  "${skill.slug}" [label="${skill.slug}\\n(${skill.meta.tier})", fillcolor="${color}"];`
    );
  }

  lines.push("");

  // Add edges
  for (const skill of skills) {
    for (const dep of skill.meta.depends_on) {
      if (skills.some((s) => s.slug === dep)) {
        lines.push(`  "${dep}" -> "${skill.slug}";`);
      }
    }
  }

  lines.push("}");
  return lines.join("\n");
}

export function createGraphCommand(): Command {
  const cmd = new Command("graph");

  cmd
    .description("Generate a dependency graph of skills (mermaid or dot format)")
    .option("--format <fmt>", "Output format: mermaid or dot", "mermaid")
    .option("--tier <tier>", "Filter by tier (atom, molecule, compound)")
    .option("--path <dir>", "Skills root directory", ".")
    .action((opts) => {
      const rootDir = resolve(opts.path);

      // Find skills
      const searchPaths = [
        resolve(rootDir, ".opencode/skills"),
        resolve(rootDir, ".claude/skills"),
        resolve(rootDir, ".codex/skills"),
        resolve(rootDir, "assets/skills"),
      ];

      let allSkills: DiscoveredSkill[] = [];
      for (const p of searchPaths) {
        const found = discoverSkills(p);
        if (found.length > 0) {
          allSkills = found;
          break;
        }
      }

      // Also try the path directly as a skills dir
      if (allSkills.length === 0) {
        allSkills = discoverSkills(rootDir);
      }

      if (allSkills.length === 0) {
        console.error("No skills found.");
        process.exitCode = 1; return;
      }

      // Filter
      const skills = filterSkills(allSkills, {
        tier: opts.tier as SkillTier | undefined,
      });

      // Generate output
      const format = opts.format?.toLowerCase();
      if (format === "dot") {
        console.log(toDot(skills));
      } else {
        console.log(toMermaid(skills));
      }
    });

  return cmd;
}
