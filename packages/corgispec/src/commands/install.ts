import { Command } from "commander";
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { type Platform, getSkillDir } from "../lib/platform.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Get the bundled skills directory from the package assets.
 */
export function getBundledSkillsDir(): string {
  // From dist/commands/ → ../assets/skills
  const fromDist = resolve(__dirname, "../assets/skills");
  if (existsSync(fromDist)) {
    return fromDist;
  }
  // Fallback for dev
  const fromSrc = resolve(__dirname, "../../assets/skills");
  if (existsSync(fromSrc)) {
    return fromSrc;
  }
  throw new Error(
    "Bundled skills not found. Run 'node scripts/bundle-assets.js' first."
  );
}

/**
 * Install skills to a target directory.
 */
export function installSkillsTo(
  sourceDir: string,
  targetDir: string,
  dryRun: boolean
): string[] {
  const installed: string[] = [];

  if (!existsSync(sourceDir)) {
    return installed;
  }

  const entries = readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const src = resolve(sourceDir, entry.name);
    const dest = resolve(targetDir, entry.name);

    if (dryRun) {
      console.log(`  DRY-RUN: ${src} → ${dest}`);
    } else {
      mkdirSync(targetDir, { recursive: true });
      if (existsSync(dest)) {
        rmSync(dest, { recursive: true });
      }
      cpSync(src, dest, { recursive: true });
      console.log(`  Installed: ${entry.name} → ${dest}`);
    }
    installed.push(entry.name);
  }

  return installed;
}

export function createInstallCommand(): Command {
  const cmd = new Command("install");

  cmd
    .description("Install bundled skills to user-level platform directories")
    .option(
      "--platform <platform>",
      "Install to specific platform only (claude, opencode, codex)"
    )
    .option("--dry-run", "Print planned operations without copying files")
    .action((opts) => {
      const dryRun = opts.dryRun ?? false;
      const platformFilter: Platform | undefined = opts.platform;

      if (
        platformFilter &&
        !["claude", "opencode", "codex"].includes(platformFilter)
      ) {
        console.error(
          `Error: Invalid platform '${platformFilter}'. Choose: claude, opencode, codex`
        );
        process.exit(1);
      }

      let sourceDir: string;
      try {
        sourceDir = getBundledSkillsDir();
      } catch (err) {
        console.error(
          err instanceof Error ? err.message : "Failed to locate bundled skills"
        );
        process.exit(1);
      }

      const platforms: Platform[] = platformFilter
        ? [platformFilter]
        : ["claude", "opencode", "codex"];

      if (dryRun) {
        console.log("DRY RUN — no files will be written\n");
      }

      let totalInstalled = 0;

      for (const platform of platforms) {
        const targetDir = getSkillDir(platform);
        console.log(`\n${platform}: ${targetDir}`);

        const installed = installSkillsTo(sourceDir, targetDir, dryRun);
        totalInstalled += installed.length;

        if (installed.length === 0) {
          console.log("  (no skills to install)");
        }
      }

      console.log(
        `\n${dryRun ? "Would install" : "Installed"} ${totalInstalled} skill(s) across ${platforms.length} platform(s).`
      );
    });

  return cmd;
}
