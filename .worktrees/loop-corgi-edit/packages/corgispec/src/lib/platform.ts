import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

/**
 * Supported AI coding platforms.
 */
export type Platform = "claude" | "opencode" | "codex";

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
