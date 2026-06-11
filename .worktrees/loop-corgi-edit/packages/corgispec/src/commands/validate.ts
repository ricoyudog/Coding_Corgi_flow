import { Command } from "commander";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { discoverSkills, validateAllSkills } from "../lib/skills.js";
import { getAssetsDir } from "../lib/schemas.js";

export function createValidateCommand(): Command {
  const cmd = new Command("validate");

  cmd
    .description(
      "Validate all skills structure and constraints (meta schema, SKILL.md, slug match, tier rules)"
    )
    .option("--path <dir>", "Skills root directory to validate", ".")
    .action((opts) => {
      const rootDir = resolve(opts.path);

      // Find skills in known locations
      const searchPaths = [
        resolve(rootDir, ".opencode/skills"),
        resolve(rootDir, ".claude/skills"),
        resolve(rootDir, ".codex/skills"),
      ];

      let skillsDir: string | null = null;
      for (const p of searchPaths) {
        const skills = discoverSkills(p);
        if (skills.length > 0) {
          skillsDir = p;
          break;
        }
      }

      if (!skillsDir) {
        // Try the path itself as a skills directory
        const directSkills = discoverSkills(rootDir);
        if (directSkills.length > 0) {
          skillsDir = rootDir;
        }
      }

      if (!skillsDir) {
        console.error(
          `No skills found in ${rootDir} or its .opencode/skills/, .claude/skills/, .codex/skills/ subdirectories.`
        );
        process.exitCode = 1; return;
      }

      const skills = discoverSkills(skillsDir);
      console.log(`Validating ${skills.length} skill(s) in ${skillsDir}\n`);

      // Find schemas directory for validation
      let schemasDir = resolve(rootDir, "schemas");
      if (!existsSync(schemasDir)) {
        const bundledSchemas = resolve(getAssetsDir(), "schemas");
        schemasDir = existsSync(bundledSchemas) ? bundledSchemas : schemasDir;
      }
      const issues = validateAllSkills(
        skillsDir,
        schemasDir
      );

      if (issues.length === 0) {
        console.log(`All ${skills.length} skills valid.`);
        process.exit(0);
      } else {
        for (const issue of issues) {
          console.error(`\n${issue.slug}:`);
          for (const msg of issue.issues) {
            console.error(`  - ${msg}`);
          }
        }
        console.error(
          `\n${issues.length} skill(s) with issues, ${skills.length - issues.length} valid.`
        );
        process.exitCode = 1; return;
      }
    });

  return cmd;
}
