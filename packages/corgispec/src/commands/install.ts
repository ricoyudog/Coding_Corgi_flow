import { Command } from "commander";
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { type Platform } from "../lib/platform.js";

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
 * Source may be tiered (atoms/, molecules/, compounds/) or flat.
 * Target is always flat (agent platforms expect flat user-level layout).
 */
export function installSkillsTo(
  sourceDir: string,
  targetDir: string,
  dryRun: boolean,
  options: { quiet?: boolean } = {},
): string[] {
  const installed: string[] = [];

  if (!existsSync(sourceDir)) {
    return installed;
  }

  function installEntry(src: string, name: string): void {
    const dest = resolve(targetDir, name);
    if (dryRun) {
      if (!options.quiet) {
        console.log(`  DRY-RUN: ${src} → ${dest}`);
      }
    } else {
      mkdirSync(targetDir, { recursive: true });
      if (existsSync(dest)) {
        rmSync(dest, { recursive: true });
      }
      cpSync(src, dest, { recursive: true });
      if (!options.quiet) {
        console.log(`  Installed: ${name} → ${dest}`);
      }
    }
    installed.push(name);
  }

  for (const entry of listBundledSkillEntries(sourceDir)) {
    installEntry(entry.source, entry.name);
  }

  return installed;
}

export interface BundledSkillEntry {
  name: string;
  source: string;
}

/** Enumerate the package-owned skill destinations without mutating them. */
export function listBundledSkillEntries(sourceDir: string): BundledSkillEntry[] {
  const result: BundledSkillEntry[] = [];
  const tierDirs = ["atoms", "molecules", "compounds"];
  if (!existsSync(sourceDir)) return result;

  for (const tier of tierDirs) {
    const tierPath = resolve(sourceDir, tier);
    if (!existsSync(tierPath)) continue;
    for (const entry of readdirSync(tierPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        result.push({ name: entry.name, source: resolve(tierPath, entry.name) });
      }
    }
  }

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !tierDirs.includes(entry.name)) {
      result.push({ name: entry.name, source: resolve(sourceDir, entry.name) });
    }
  }

  return result.sort((left, right) => left.name.localeCompare(right.name));
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
    .action(async (opts) => {
      const dryRun = opts.dryRun ?? false;
      const platformFilter: Platform | undefined = opts.platform;

      if (
        platformFilter &&
        !["claude", "opencode", "codex"].includes(platformFilter)
      ) {
        console.error(
          `Error: Invalid platform '${platformFilter}'. Choose: claude, opencode, codex`
        );
        process.exitCode = 1; return;
      }

      let sourceDir: string;
      try {
        sourceDir = getBundledSkillsDir();
      } catch (err) {
        console.error(
          err instanceof Error ? err.message : "Failed to locate bundled skills"
        );
        process.exitCode = 1; return;
      }

      const platforms: Platform[] = platformFilter
        ? [platformFilter]
        : ["claude", "opencode", "codex"];

      const { runBootstrap } = await import("../lib/bootstrap.js");
      const result = await runBootstrap({
        target: process.cwd(),
        mode: "auto",
        yes: true,
        json: false,
        assetsRoot: dirname(sourceDir),
        platforms,
        scope: "global",
        dryRun,
      });
      console.log(result.message);
      for (const action of result.actions) console.log(`- ${action}`);
      if (result.status !== "success") process.exitCode = 1;
    });

  return cmd;
}
