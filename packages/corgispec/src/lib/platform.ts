import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

/**
 * Supported AI coding platforms.
 */
export type Platform = "claude" | "opencode" | "codex";
export type CommandPlatform = Exclude<Platform, "codex">;

/**
 * Platform detection result.
 */
export interface PlatformInfo {
  platform: Platform;
  detected: boolean;
  skillDir: string;
  exists: boolean;
  writable?: boolean;
}

/**
 * Platform configuration — where each platform stores skills.
 */
const PLATFORM_DIRS: Record<Platform, string> = {
  claude: resolve(homedir(), ".claude/skills"),
  opencode: resolve(homedir(), ".config/opencode/skill"),
  codex: resolve(homedir(), ".codex/skills"),
};

const COMMAND_DIRS: Record<CommandPlatform, string> = {
  claude: resolve(homedir(), ".claude/commands/corgi"),
  opencode: resolve(homedir(), ".config/opencode/commands"),
};

/**
 * Platform detection indicators — directories that suggest a platform is in use.
 */
const PLATFORM_INDICATORS: Record<Platform, string[]> = {
  claude: [resolve(homedir(), ".claude")],
  opencode: [resolve(homedir(), ".config/opencode")],
  codex: [resolve(homedir(), ".codex")],
};

/**
 * Detect which AI platforms are available on this system.
 */
export function detectPlatforms(): PlatformInfo[] {
  const results: PlatformInfo[] = [];

  for (const platform of Object.keys(PLATFORM_DIRS) as Platform[]) {
    const skillDir = PLATFORM_DIRS[platform];
    const indicators = PLATFORM_INDICATORS[platform];
    const detected = indicators.some((dir) => existsSync(dir));
    const dirExists = existsSync(skillDir);

    results.push({
      platform,
      detected,
      skillDir,
      exists: dirExists,
    });
  }

  return results;
}

/**
 * Get the skill directory path for a specific platform.
 */
export function getSkillDir(platform: Platform): string {
  return PLATFORM_DIRS[platform];
}

/**
 * Get all platform skill directory paths.
 */
export function getAllSkillDirs(): Record<Platform, string> {
  return { ...PLATFORM_DIRS };
}

/** User-level slash-command locations for platforms that support them. */
export function getCommandDir(platform: CommandPlatform): string {
  return COMMAND_DIRS[platform];
}

export function getAllCommandDirs(): Record<CommandPlatform, string> {
  return { ...COMMAND_DIRS };
}
