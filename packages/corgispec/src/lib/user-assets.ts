import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  installSkillsTo,
  listBundledSkillEntries,
} from "../commands/install.js";
import {
  getCommandDir,
  getSkillDir,
  type CommandPlatform,
  type Platform,
} from "./platform.js";

export type UserAssetStatus = "current" | "missing" | "outdated" | "obsolete" | "ambiguous";

export interface UserAssetAction {
  platform: Platform;
  kind: "skill" | "command";
  name: string;
  source?: string;
  target: string;
  status: UserAssetStatus;
  reason?: string;
}

export interface UserAssetPlan {
  actions: UserAssetAction[];
  conflicts: Array<{ path: string; reason: string }>;
}

export interface PlanUserAssetsOptions {
  assetsRoot: string;
  platforms?: string[];
  userSkillDirs?: Partial<Record<Platform, string>>;
  userCommandDirs?: Partial<Record<CommandPlatform, string>>;
}

const ALL_PLATFORMS: Platform[] = ["claude", "opencode", "codex"];
const LEGACY_USER_COMMANDS: Partial<Record<CommandPlatform, string[]>> = {
  claude: ["human-qa.md"],
};

export function planUserAssets(options: PlanUserAssetsOptions): UserAssetPlan {
  const requested = options.platforms
    ? ALL_PLATFORMS.filter((platform) => options.platforms!.includes(platform))
    : ALL_PLATFORMS;
  const actions: UserAssetAction[] = [];
  const conflicts: Array<{ path: string; reason: string }> = [];
  const skillSources = listBundledSkillEntries(resolve(options.assetsRoot, "skills"));

  for (const platform of requested) {
    const skillDir = options.userSkillDirs?.[platform] ?? getSkillDir(platform);
    for (const skill of skillSources) {
      const target = resolve(skillDir, skill.name);
      const status = classifySkill(skill.source, target, skill.name);
      const action: UserAssetAction = {
        platform,
        kind: "skill",
        name: skill.name,
        source: skill.source,
        target,
        status: status.status,
        reason: status.reason,
      };
      actions.push(action);
      if (action.status === "ambiguous") {
        conflicts.push({ path: target, reason: action.reason ?? "Skill ownership is ambiguous" });
      }
    }

    if (platform === "codex") continue;
    const commandPlatform = platform as CommandPlatform;
    const commandDir = options.userCommandDirs?.[commandPlatform] ?? getCommandDir(commandPlatform);
    const sourceDir = resolve(
      options.assetsRoot,
      platform === "claude" ? "commands/claude/corgi" : "commands/opencode",
    );
    const currentNames = new Set<string>();
    for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      currentNames.add(entry.name);
      const source = resolve(sourceDir, entry.name);
      const target = resolve(commandDir, entry.name);
      const status = classifyCommand(source, target);
      const action: UserAssetAction = {
        platform,
        kind: "command",
        name: entry.name,
        source,
        target,
        status: status.status,
        reason: status.reason,
      };
      actions.push(action);
      if (action.status === "ambiguous") {
        conflicts.push({ path: target, reason: action.reason ?? "Command ownership is ambiguous" });
      }
    }

    for (const legacyName of LEGACY_USER_COMMANDS[commandPlatform] ?? []) {
      if (currentNames.has(legacyName)) continue;
      const target = resolve(commandDir, legacyName);
      if (!existsSync(target)) continue;
      const content = safeRead(target);
      const owned = content !== null && hasCorgiCommandSignature(content);
      const action: UserAssetAction = {
        platform,
        kind: "command",
        name: legacyName,
        target,
        status: owned ? "obsolete" : "ambiguous",
        reason: owned ? "Known obsolete Corgi command" : "Legacy command path has custom content",
      };
      actions.push(action);
      if (!owned) conflicts.push({ path: target, reason: action.reason! });
    }
  }

  return { actions, conflicts };
}

export function applyUserAssetPlan(
  plan: UserAssetPlan,
  options: PlanUserAssetsOptions & { quiet?: boolean },
): { installedSkills: number; installedCommands: number; removed: string[] } {
  if (plan.conflicts.length > 0) {
    throw new Error("Refusing to apply a user-asset plan with conflicts");
  }

  let installedSkills = 0;
  let installedCommands = 0;
  const removed: string[] = [];
  const requested = options.platforms
    ? ALL_PLATFORMS.filter((platform) => options.platforms!.includes(platform))
    : ALL_PLATFORMS;

  for (const platform of requested) {
    const skillDir = options.userSkillDirs?.[platform] ?? getSkillDir(platform);
    installedSkills += installSkillsTo(resolve(options.assetsRoot, "skills"), skillDir, false, {
      quiet: options.quiet,
    }).length;
  }

  for (const action of plan.actions) {
    if (action.kind !== "command") continue;
    if (action.status === "obsolete") {
      rmSync(action.target, { recursive: true, force: true });
      removed.push(action.target);
      continue;
    }
    if (!action.source) continue;
    mkdirSync(dirname(action.target), { recursive: true });
    cpSync(action.source, action.target);
    installedCommands += 1;
  }

  return { installedSkills, installedCommands, removed };
}

function classifySkill(
  source: string,
  target: string,
  expectedSlug: string,
): { status: UserAssetStatus; reason?: string } {
  if (!existsSync(target)) return { status: "missing" };
  if (pathsMatch(source, target)) return { status: "current" };

  const metadataPath = resolve(target, "skill.meta.json");
  if (existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as { slug?: unknown };
      if (metadata.slug === expectedSlug) return { status: "outdated" };
    } catch {
      return { status: "ambiguous", reason: "Managed skill metadata is malformed" };
    }
  }

  const skillPath = resolve(target, "SKILL.md");
  const content = safeRead(skillPath);
  if (content && new RegExp(`^name:\\s*["']?${escapeRegExp(expectedSlug)}["']?\\s*$`, "mu").test(content)) {
    return { status: "outdated" };
  }
  return { status: "ambiguous", reason: "Existing skill does not carry a matching Corgi identity" };
}

function classifyCommand(
  source: string,
  target: string,
): { status: UserAssetStatus; reason?: string } {
  if (!existsSync(target)) return { status: "missing" };
  if (pathsMatch(source, target)) return { status: "current" };
  const content = safeRead(target);
  if (content !== null && hasCorgiCommandSignature(content)) return { status: "outdated" };
  return { status: "ambiguous", reason: "Existing command lacks a Corgi dispatcher signature" };
}

function hasCorgiCommandSignature(content: string): boolean {
  return /(?:corgispec-|corgispec\s|\/corgi|corgi-)/u.test(content);
}

function pathsMatch(left: string, right: string): boolean {
  try {
    const leftHashes = hashTree(left);
    const rightHashes = hashTree(right);
    if (leftHashes.size !== rightHashes.size) return false;
    for (const [path, hash] of leftHashes) {
      if (rightHashes.get(path) !== hash) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function hashTree(root: string): Map<string, string> {
  const hashes = new Map<string, string>();
  const visit = (path: string, prefix: string): void => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error("Symbolic links are not managed user assets");
    if (stat.isFile()) {
      hashes.set(prefix || basename(path), createHash("sha256").update(readFileSync(path)).digest("hex"));
      return;
    }
    if (!stat.isDirectory()) throw new Error("Unsupported user asset type");
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      visit(resolve(path, entry.name), relative);
    }
  };
  visit(root, "");
  return hashes;
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
