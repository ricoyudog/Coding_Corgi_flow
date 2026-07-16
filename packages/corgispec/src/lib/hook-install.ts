import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  HOOK_EVENTS,
  buildClaudeConfig,
  buildCodexToml,
  buildNodeWrapper,
  buildOpenCodeDeepPlugin,
} from "../commands/hooks/generate.js";

export { buildClaudeConfig, buildCodexToml, buildNodeWrapper, buildOpenCodeDeepPlugin };

export const HOOK_PLATFORMS = ["claude", "opencode", "codex"] as const;
export type HookPlatform = (typeof HOOK_PLATFORMS)[number];
export type HookAssetStatus =
  | "current"
  | "missing"
  | "outdated"
  | "locally-modified"
  | "obsolete"
  | "ambiguous";
export type HookInstallationState =
  | "configured"
  | "current"
  | "stale"
  | "conflict"
  | "hookless";

export interface HookMigrationAction {
  platform: HookPlatform;
  kind: "write" | "remove";
  status: HookAssetStatus;
  path: string;
  reason: string;
  /** Exact preflight snapshot. null means the path did not exist. */
  before: string | null;
  /** Present for writes and omitted for removals. */
  content?: string;
}

export interface HookMigrationConflict {
  platform: HookPlatform;
  status: "locally-modified" | "ambiguous";
  path: string;
  reason: string;
}

export interface HookPlatformInspection {
  platform: HookPlatform;
  enabled: boolean;
  state: HookInstallationState;
  /** Paths containing Corgi-owned hook entries after a successful apply. */
  ownedPaths: string[];
  /** Paths that this plan will write or remove. */
  touchedPaths: string[];
  actions: HookMigrationAction[];
  conflicts: HookMigrationConflict[];
}

export interface HookMigrationPlanOptions {
  root: string;
  platforms?: readonly HookPlatform[];
  binaryPath?: string;
  cliEntry?: string;
}

export interface HookMigrationPlan {
  root: string;
  platforms: Record<HookPlatform, HookPlatformInspection>;
  actions: HookMigrationAction[];
  conflicts: HookMigrationConflict[];
  ownedPaths: string[];
  touchedPaths: string[];
}

export interface HookInspectionResult {
  root: string;
  platforms: Record<HookPlatform, HookPlatformInspection>;
  conflicts: HookMigrationConflict[];
  ownedPaths: string[];
  touchedPaths: string[];
}

export interface HookMigrationApplyResult {
  written: string[];
  removed: string[];
}

interface ReadResult {
  content: string | null;
  error?: string;
}

interface MutableInspection {
  platform: HookPlatform;
  enabled: boolean;
  ownedPaths: Set<string>;
  actions: HookMigrationAction[];
  conflicts: HookMigrationConflict[];
}

const OPENCODE_PLUGIN_NAMES = [
  "corgispec-deep.ts",
  "corgispec.ts",
  "corgispec-hooks.ts",
] as const;
const CANONICAL_OPENCODE_PLUGIN = OPENCODE_PLUGIN_NAMES[0];
const ALL_CODEX_SUBCOMMANDS = [
  "session-start",
  "pre-write",
  "pre-bash",
  "post-write",
  "stop-check",
  "loop-check",
  "post-compact",
] as const;

export function buildCodexFiles(cliEntry: string): Record<string, string> {
  return Object.fromEntries(HOOK_EVENTS.map((hook) => {
    const scriptName = `corgispec_${hook.subcommand.replaceAll("-", "_")}.cjs`;
    return [`hooks/${scriptName}`, buildNodeWrapper(hook.subcommand, cliEntry)];
  }));
}

export function planHookMigration(options: HookMigrationPlanOptions): HookMigrationPlan {
  const root = resolve(options.root);
  const selected = new Set(options.platforms ?? HOOK_PLATFORMS);
  const binaryPath = options.binaryPath ?? "npx corgispec";
  const cliEntry = options.cliEntry ?? "corgispec";
  const mutable: Record<HookPlatform, MutableInspection> = {
    claude: createMutableInspection("claude"),
    opencode: createMutableInspection("opencode"),
    codex: createMutableInspection("codex"),
  };

  if (selected.has("claude")) planClaude(root, binaryPath, mutable.claude);
  if (selected.has("opencode")) planOpenCode(root, cliEntry, mutable.opencode);
  if (selected.has("codex")) planCodex(root, cliEntry, mutable.codex);

  const platforms = Object.fromEntries(HOOK_PLATFORMS.map((platform) => {
    const value = mutable[platform];
    const touchedPaths = value.actions.map((action) => action.path);
    const state: HookInstallationState = value.conflicts.length > 0
      ? "conflict"
      : !value.enabled
        ? "hookless"
        : value.actions.length > 0
          ? "stale"
          : "current";
    return [platform, {
      platform,
      enabled: value.enabled,
      state,
      ownedPaths: [...value.ownedPaths].sort(),
      touchedPaths: [...new Set(touchedPaths)].sort(),
      actions: value.actions,
      conflicts: value.conflicts,
    } satisfies HookPlatformInspection];
  })) as Record<HookPlatform, HookPlatformInspection>;
  const actions = HOOK_PLATFORMS.flatMap((platform) => platforms[platform].actions);
  const conflicts = HOOK_PLATFORMS.flatMap((platform) => platforms[platform].conflicts);

  return {
    root,
    platforms,
    actions,
    conflicts,
    ownedPaths: [...new Set(HOOK_PLATFORMS.flatMap((platform) => platforms[platform].ownedPaths))].sort(),
    touchedPaths: [...new Set(actions.map((action) => action.path))].sort(),
  };
}

/** Read-only inspection for doctor/reporting. It performs no filesystem writes. */
export function inspectHookInstallations(options: HookMigrationPlanOptions): HookInspectionResult {
  const plan = planHookMigration(options);
  return {
    root: plan.root,
    platforms: plan.platforms,
    conflicts: plan.conflicts,
    ownedPaths: plan.ownedPaths,
    touchedPaths: plan.touchedPaths,
  };
}

/**
 * Apply an already-preflighted hook plan. Every path is checked against its
 * exact snapshot before the first write, and hook changes are rolled back if a
 * later write fails. A caller may still include these actions in a wider
 * bootstrap transaction instead of calling this helper directly.
 */
export function applyHookMigrationPlan(plan: HookMigrationPlan): HookMigrationApplyResult {
  if (plan.conflicts.length > 0) {
    throw new Error(`Cannot apply hook migration with ${plan.conflicts.length} conflict(s)`);
  }
  for (const action of plan.actions) {
    const actual = readPath(action.path);
    if (actual.error || actual.content !== action.before) {
      throw new Error(`Hook path changed after preflight: ${action.path}`);
    }
  }

  const applied: HookMigrationAction[] = [];
  try {
    for (const action of plan.actions) {
      if (action.kind === "write") {
        mkdirSync(dirname(action.path), { recursive: true });
        writeFileSync(action.path, action.content ?? "", "utf8");
      } else {
        rmSync(action.path, { force: true });
      }
      applied.push(action);
    }
  } catch (error) {
    for (const action of applied.reverse()) {
      if (action.before === null) {
        rmSync(action.path, { force: true });
      } else {
        mkdirSync(dirname(action.path), { recursive: true });
        writeFileSync(action.path, action.before, "utf8");
      }
    }
    throw error;
  }
  return {
    written: plan.actions.filter((action) => action.kind === "write").map((action) => action.path),
    removed: plan.actions.filter((action) => action.kind === "remove").map((action) => action.path),
  };
}

function createMutableInspection(platform: HookPlatform): MutableInspection {
  return {
    platform,
    enabled: false,
    ownedPaths: new Set<string>(),
    actions: [],
    conflicts: [],
  };
}

function readPath(path: string): ReadResult {
  try {
    return { content: readFileSync(path, "utf8") };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { content: null };
    return { content: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function addConflict(
  inspection: MutableInspection,
  path: string,
  reason: string,
  status: HookMigrationConflict["status"] = "ambiguous",
): void {
  inspection.conflicts.push({ platform: inspection.platform, path, reason, status });
}

function addWrite(
  inspection: MutableInspection,
  path: string,
  before: string | null,
  content: string,
  status: "missing" | "outdated",
  reason: string,
): void {
  if (before === content) return;
  inspection.actions.push({
    platform: inspection.platform,
    kind: "write",
    status,
    path,
    before,
    content,
    reason,
  });
}

function addRemove(
  inspection: MutableInspection,
  path: string,
  before: string,
  reason: string,
): void {
  inspection.actions.push({
    platform: inspection.platform,
    kind: "remove",
    status: "obsolete",
    path,
    before,
    reason,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCorgiCommand(command: unknown): boolean {
  return typeof command === "string"
    && /(?:^|[\\/'"\s])corgispec(?:\.(?:cmd|exe|bat))?["']?\s+hook\s+[a-z][a-z-]*/iu.test(command);
}

function containsCorgiCommand(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCorgiCommand);
  if (!isRecord(value)) return false;
  if (isCorgiCommand(value.command)) return true;
  return Object.values(value).some(containsCorgiCommand);
}

function planClaude(root: string, binaryPath: string, inspection: MutableInspection): void {
  const path = resolve(root, ".claude/settings.json");
  const source = readPath(path);
  if (source.error) {
    addConflict(inspection, path, `Cannot read Claude settings: ${source.error}`);
    return;
  }
  if (source.content === null) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(source.content);
  } catch (error) {
    addConflict(inspection, path, `Malformed Claude settings JSON: ${String(error)}`);
    return;
  }
  if (!isRecord(parsed)) {
    addConflict(inspection, path, "Claude settings must be a JSON object");
    return;
  }
  if (!containsCorgiCommand(parsed.hooks)) return;
  inspection.enabled = true;
  inspection.ownedPaths.add(path);

  const stripped = stripCorgiCommands(parsed.hooks);
  if (!stripped.found || !isRecord(stripped.value)) {
    addConflict(inspection, path, "Corgi Claude hooks use an unsupported structure");
    return;
  }
  const canonical = buildClaudeConfig(binaryPath).hooks;
  if (!isRecord(canonical)) {
    addConflict(inspection, path, "Canonical Claude hook builder returned invalid hooks");
    return;
  }
  const mergedHooks: Record<string, unknown> = { ...stripped.value };
  for (const [event, entries] of Object.entries(canonical)) {
    const preserved = Array.isArray(mergedHooks[event]) ? mergedHooks[event] : [];
    mergedHooks[event] = [...preserved, ...(entries as unknown[])];
  }
  const migrated = { ...parsed, hooks: mergedHooks };
  const content = `${JSON.stringify(migrated, null, 2)}\n`;
  addWrite(inspection, path, source.content, content, "outdated", "Replace only Corgi Claude hook commands");
}

function stripCorgiCommands(value: unknown): { value: unknown; found: boolean } {
  if (Array.isArray(value)) {
    let found = false;
    const result: unknown[] = [];
    for (const item of value) {
      if (isRecord(item) && isCorgiCommand(item.command)) {
        found = true;
        continue;
      }
      const stripped = stripCorgiCommands(item);
      found ||= stripped.found;
      if (
        stripped.found
        && isRecord(stripped.value)
        && Array.isArray(stripped.value.hooks)
        && stripped.value.hooks.length === 0
        && Object.keys(stripped.value).every((key) => key === "matcher" || key === "hooks")
      ) {
        continue;
      }
      result.push(stripped.value);
    }
    return { value: result, found };
  }
  if (!isRecord(value)) return { value, found: false };
  let found = false;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const stripped = stripCorgiCommands(child);
    found ||= stripped.found;
    result[key] = stripped.value;
  }
  return { value: result, found };
}

function planOpenCode(root: string, cliEntry: string, inspection: MutableInspection): void {
  const pluginDir = resolve(root, ".opencode/plugins");
  const candidates = OPENCODE_PLUGIN_NAMES.map((name) => ({
    name,
    path: resolve(pluginDir, name),
    source: readPath(resolve(pluginDir, name)),
  }));
  for (const candidate of candidates) {
    if (candidate.source.error) {
      addConflict(inspection, candidate.path, `Cannot read OpenCode plugin: ${candidate.source.error}`);
    }
  }
  if (inspection.conflicts.length > 0) return;
  const existing = candidates.filter((candidate) => candidate.source.content !== null);
  if (existing.length === 0) return;
  const generated = existing.filter((candidate) => isGeneratedOpenCodePlugin(candidate.source.content ?? ""));
  if (generated.length === 0) {
    for (const candidate of existing) {
      addConflict(
        inspection,
        candidate.path,
        "Known Corgi OpenCode plugin filename lacks generated Corgi signatures",
        "locally-modified",
      );
    }
    return;
  }

  inspection.enabled = true;
  const canonicalPath = resolve(pluginDir, CANONICAL_OPENCODE_PLUGIN);
  const canonicalCandidate = candidates[0];
  if (
    canonicalCandidate.source.content !== null
    && !isGeneratedOpenCodePlugin(canonicalCandidate.source.content)
  ) {
    addConflict(
      inspection,
      canonicalPath,
      "Canonical OpenCode plugin path contains non-generated content",
      "locally-modified",
    );
    return;
  }
  for (const candidate of existing) {
    if (!isGeneratedOpenCodePlugin(candidate.source.content ?? "")) {
      addConflict(
        inspection,
        candidate.path,
        "Legacy OpenCode plugin path contains non-generated content",
        "locally-modified",
      );
    }
  }
  if (inspection.conflicts.length > 0) return;

  const canonical = buildOpenCodeDeepPlugin(cliEntry);
  inspection.ownedPaths.add(canonicalPath);
  addWrite(
    inspection,
    canonicalPath,
    canonicalCandidate.source.content,
    canonical,
    canonicalCandidate.source.content === null ? "missing" : "outdated",
    "Canonicalize the generated OpenCode Corgi plugin",
  );
  for (const candidate of generated) {
    if (candidate.path === canonicalPath) continue;
    addRemove(inspection, candidate.path, candidate.source.content ?? "", "Remove generated duplicate OpenCode plugin");
  }
}

function isGeneratedOpenCodePlugin(content: string): boolean {
  const hasExport = /export\s+const\s+CorgiSpec(?:Deep)?\b/u.test(content);
  const hasPluginApi = content.includes("@opencode-ai/plugin");
  const hasRunner = content.includes("spawnSync") || content.includes("execSync");
  const hasHookCall = content.includes('"hook", subcommand')
    || content.includes(" hook session-start")
    || /corgispec\s+hook\s+/iu.test(content);
  return hasExport && hasPluginApi && hasRunner && hasHookCall;
}

function planCodex(root: string, cliEntry: string, inspection: MutableInspection): void {
  const codexDir = resolve(root, ".codex");
  const configPath = resolve(codexDir, "config.toml");
  const legacyPath = resolve(codexDir, "hooks.json");
  const config = readPath(configPath);
  const legacy = readPath(legacyPath);
  if (config.error) addConflict(inspection, configPath, `Cannot read Codex config: ${config.error}`);
  if (legacy.error) addConflict(inspection, legacyPath, `Cannot read legacy Codex hooks: ${legacy.error}`);

  const wrappers = collectCodexWrappers(codexDir);
  for (const wrapper of wrappers) {
    if (wrapper.source.error) addConflict(inspection, wrapper.path, `Cannot read Codex wrapper: ${wrapper.source.error}`);
  }
  if (inspection.conflicts.length > 0) return;

  const toml = inspectCodexToml(config.content ?? "");
  if (toml.conflict) {
    addConflict(inspection, configPath, toml.conflict);
    return;
  }
  const legacyResult = inspectLegacyHooksJson(legacy.content);
  if (legacyResult.conflict) {
    addConflict(inspection, legacyPath, legacyResult.conflict);
    return;
  }
  const generatedWrappers = wrappers.filter((wrapper) =>
    wrapper.source.content !== null && isGeneratedCodexWrapper(wrapper.source.content)
  );
  const suspiciousWrappers = wrappers.filter((wrapper) =>
    wrapper.source.content !== null
    && wrapper.name.startsWith("corgispec_")
    && !isGeneratedCodexWrapper(wrapper.source.content)
  );
  const enabled = toml.found || legacyResult.found || generatedWrappers.length > 0;
  if (!enabled) {
    for (const wrapper of suspiciousWrappers) {
      addConflict(
        inspection,
        wrapper.path,
        "Corgi-named Codex wrapper lacks generated Corgi signatures",
        "locally-modified",
      );
    }
    return;
  }
  inspection.enabled = true;
  for (const wrapper of suspiciousWrappers) {
    addConflict(
      inspection,
      wrapper.path,
      "Corgi-named Codex wrapper contains non-generated content",
      "locally-modified",
    );
  }
  if (inspection.conflicts.length > 0) return;

  const canonicalFiles = buildCodexFiles(cliEntry);
  const canonicalHookPaths = new Set(Object.keys(canonicalFiles).map((relative) => resolve(codexDir, relative)));
  inspection.ownedPaths.add(configPath);
  for (const path of canonicalHookPaths) inspection.ownedPaths.add(path);

  const baseToml = config.content === null ? "" : toml.cleaned;
  const withFeatures = ensureCodexHooksFeature(baseToml);
  if (withFeatures.conflict) {
    addConflict(inspection, configPath, withFeatures.conflict);
    return;
  }
  const canonicalHookSection = buildCodexToml().slice(buildCodexToml().indexOf("# CorgiSpec:"));
  const migratedToml = `${withFeatures.content.trimEnd()}\n\n${canonicalHookSection}`;
  addWrite(
    inspection,
    configPath,
    config.content,
    migratedToml,
    config.content === null ? "missing" : "outdated",
    "Replace only Corgi Codex TOML hook blocks",
  );

  if (legacy.content !== null && legacyResult.found) {
    if (legacyResult.remove) {
      addRemove(inspection, legacyPath, legacy.content, "Remove empty legacy Codex hooks.json");
    } else {
      addWrite(
        inspection,
        legacyPath,
        legacy.content,
        legacyResult.content,
        "outdated",
        "Remove only migrated Corgi entries from legacy Codex hooks.json",
      );
    }
  }

  for (const [relative, content] of Object.entries(canonicalFiles)) {
    const path = resolve(codexDir, relative);
    const existing = wrappers.find((wrapper) => wrapper.path === path)?.source ?? readPath(path);
    if (existing.content !== null && !isGeneratedCodexWrapper(existing.content)) {
      addConflict(inspection, path, "Canonical Codex wrapper path contains non-generated content", "locally-modified");
      continue;
    }
    addWrite(
      inspection,
      path,
      existing.content,
      content,
      existing.content === null ? "missing" : "outdated",
      "Install canonical Codex Corgi wrapper",
    );
  }
  if (inspection.conflicts.length > 0) return;

  for (const wrapper of generatedWrappers) {
    if (canonicalHookPaths.has(wrapper.path)) continue;
    addRemove(inspection, wrapper.path, wrapper.source.content ?? "", "Remove obsolete generated Codex wrapper");
  }
}

interface CodexWrapperCandidate {
  name: string;
  path: string;
  source: ReadResult;
}

function collectCodexWrappers(codexDir: string): CodexWrapperCandidate[] {
  const names = new Set<string>();
  for (const subcommand of ALL_CODEX_SUBCOMMANDS) {
    const stem = subcommand.replaceAll("-", "_");
    for (const extension of ["cjs", "py"] as const) {
      names.add(`corgispec_${stem}.${extension}`);
      names.add(`${stem}.${extension}`);
    }
  }
  return [...names].map((name) => {
    const path = resolve(codexDir, "hooks", name);
    return { name, path, source: readPath(path) };
  });
}

function isGeneratedCodexWrapper(content: string): boolean {
  const hasHook = /["']hook["']\s*,\s*["'][a-z][a-z-]*["']/u.test(content)
    || /CorgiSpec hook:\s*[a-z][a-z-]*/u.test(content);
  const hasRunner = content.includes("spawnSync") || content.includes("subprocess.run");
  return hasHook && hasRunner;
}

function inspectLegacyHooksJson(content: string | null): {
  found: boolean;
  remove: boolean;
  content: string;
  conflict?: string;
} {
  if (content === null) return { found: false, remove: false, content: "" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return { found: false, remove: false, content, conflict: `Malformed legacy hooks JSON: ${String(error)}` };
  }
  if (!isRecord(parsed)) {
    return { found: false, remove: false, content, conflict: "Legacy hooks.json must be a JSON object" };
  }
  const container = isRecord(parsed.hooks) ? parsed.hooks : parsed;
  if (!containsCorgiCommand(container)) return { found: false, remove: false, content };
  const stripped = stripCorgiCommands(container);
  const migrated = { ...parsed };
  if (isRecord(parsed.hooks)) migrated.hooks = stripped.value;
  else Object.assign(migrated, stripped.value);
  const remove = !containsMeaningfulHookValue(isRecord(parsed.hooks) ? migrated.hooks : migrated);
  return { found: true, remove, content: `${JSON.stringify(migrated, null, 2)}\n` };
}

function containsMeaningfulHookValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsMeaningfulHookValue);
  if (!isRecord(value)) return value !== null && value !== undefined && value !== "";
  return Object.values(value).some(containsMeaningfulHookValue);
}

function inspectCodexToml(content: string): { found: boolean; cleaned: string; conflict?: string } {
  if (!content) return { found: false, cleaned: content };
  if (/\[\[hooks\.[^\]\r\n]*(?:\](?!\])|$)/u.test(content)) {
    return { found: false, cleaned: content, conflict: "Malformed Codex hooks TOML table header" };
  }
  const lines = content.match(/[^\n]*(?:\n|$)/gu) ?? [];
  const starts: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*\[\[hooks\.[A-Za-z0-9_-]+\]\]\s*(?:#.*)?(?:\r?\n)?$/u.test(lines[index] ?? "")) {
      starts.push(index);
    }
  }
  const spans: Array<{ start: number; end: number }> = [];
  for (const start of starts) {
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (
        /^[ \t]*#[ \t]*CorgiSpec:/u.test(line)
        && /^[ \t]*\[\[hooks\.[A-Za-z0-9_-]+\]\]/u.test(lines[index + 1] ?? "")
      ) {
        end = index;
        break;
      }
      if (/^\s*\[{1,2}[^\]]+\]{1,2}\s*(?:#.*)?(?:\r?\n)?$/u.test(line)
        && !/^\s*\[\[hooks\.[A-Za-z0-9_-]+\.hooks\]\]/u.test(line)) {
        end = index;
        break;
      }
    }
    const marker = start > 0 && /^\s*#\s*CorgiSpec:/u.test(lines[start - 1] ?? "") ? start - 1 : start;
    const chunk = lines.slice(marker, end).join("");
    if (/^\s*#\s*CorgiSpec:/mu.test(chunk)
      || /corgispec_[a-z_]+\.(?:cjs|py)/iu.test(chunk)
      || /corgispec(?:\.(?:cmd|exe|bat))?["']?\s+hook\s+/iu.test(chunk)) {
      spans.push({ start: marker, end });
    }
  }
  const hasCorgiToken = /#\s*CorgiSpec:|corgispec_[a-z_]+\.(?:cjs|py)|corgispec\s+hook\s+/iu.test(content);
  if (hasCorgiToken && spans.length === 0) {
    return { found: false, cleaned: content, conflict: "Corgi Codex hook content is outside a supported TOML hook block" };
  }
  const removed = new Set<number>();
  for (const span of spans) {
    for (let index = span.start; index < span.end; index += 1) removed.add(index);
  }
  return {
    found: spans.length > 0,
    cleaned: lines.filter((_line, index) => !removed.has(index)).join(""),
  };
}

function ensureCodexHooksFeature(content: string): { content: string; conflict?: string } {
  const featureHeaders = [...content.matchAll(/^[ \t]*\[features\][ \t]*(?:#.*)?$/gmu)];
  if (featureHeaders.length > 1) {
    return { content, conflict: "Codex config contains duplicate [features] tables" };
  }
  if (featureHeaders.length === 0) {
    return { content: `[features]\nhooks = true\n\n${content}` };
  }
  const start = featureHeaders[0]?.index ?? 0;
  const headerEnd = content.indexOf("\n", start);
  const sectionStart = headerEnd < 0 ? content.length : headerEnd + 1;
  const nextHeader = content.slice(sectionStart).search(/^[ \t]*\[/mu);
  const sectionEnd = nextHeader < 0 ? content.length : sectionStart + nextHeader;
  const section = content.slice(sectionStart, sectionEnd);
  const hooksLines = [...section.matchAll(/^[ \t]*hooks[ \t]*=.*$/gmu)];
  if (hooksLines.length > 1) {
    return { content, conflict: "Codex [features] contains duplicate hooks keys" };
  }
  if (hooksLines.length === 0) {
    return {
      content: `${content.slice(0, sectionStart)}hooks = true\n${content.slice(sectionStart)}`,
    };
  }
  const match = hooksLines[0];
  const matchStart = sectionStart + (match?.index ?? 0);
  const matchText = match?.[0] ?? "";
  const indentation = matchText.match(/^[ \t]*/u)?.[0] ?? "";
  return {
    content: `${content.slice(0, matchStart)}${indentation}hooks = true${content.slice(matchStart + matchText.length)}`,
  };
}
