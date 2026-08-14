import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_MEMORY_PROTOCOL_HEADING = "## Session Memory Protocol";

export interface ProjectMemoryContext {
  projectName: string;
  projectPurpose: string;
  techStack: string;
  hardConstraints: string;
  preferences: string;
  stableComponents: string;
  evolvingComponents: string;
  legacyComponents: string;
}

export interface MemoryInitInput {
  targetDir: string;
  assetsRoot?: string;
  date?: Date;
}

export interface MemoryInitResult {
  createdFiles: string[];
  skippedFiles: string[];
  upgradedFiles: string[];
  injectedSessionMemoryProtocol: boolean;
}

interface PackageJson {
  name?: string;
  description?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function readOptionalFile(filePath: string): string | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  return readFileSync(filePath, "utf-8");
}

function readPackageJson(targetDir: string): PackageJson | undefined {
  const packageJsonPath = resolve(targetDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }

  return JSON.parse(readFileSync(packageJsonPath, "utf-8")) as PackageJson;
}

function titleizePackageName(name: string): string {
  return name
    .split(/[-_./]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function firstMarkdownHeading(markdown: string | undefined): string | undefined {
  if (!markdown) {
    return undefined;
  }

  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

function firstParagraph(markdown: string | undefined): string | undefined {
  if (!markdown) {
    return undefined;
  }

  const lines = markdown.split(/\r?\n/);
  let collecting = false;
  const paragraph: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!collecting) {
      if (!line || line.startsWith("#") || line.startsWith("[")) {
        continue;
      }
      collecting = true;
    }

    if (!line) {
      break;
    }

    if (
      line.startsWith("#") ||
      line.startsWith("```") ||
      line.startsWith("|") ||
      line.startsWith("-") ||
      /^\d+\./.test(line)
    ) {
      if (paragraph.length > 0) {
        break;
      }
      continue;
    }

    paragraph.push(line);
  }

  return paragraph.length > 0 ? paragraph.join(" ") : undefined;
}

function extractSectionParagraph(markdown: string | undefined, heading: string): string | undefined {
  if (!markdown) {
    return undefined;
  }

  const lines = markdown.split(/\r?\n/);
  const normalizedHeading = heading.toLowerCase();
  let inSection = false;
  const collected: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (/^##\s+/.test(line)) {
      if (line.toLowerCase() === `## ${normalizedHeading}`) {
        inSection = true;
        continue;
      }
      if (inSection) {
        break;
      }
    }

    if (!inSection || !line) {
      continue;
    }

    if (line.startsWith("#") || line.startsWith("-") || /^\d+\./.test(line)) {
      if (collected.length > 0) {
        break;
      }
      continue;
    }

    collected.push(line);
  }

  return collected.length > 0 ? collected.join(" ") : undefined;
}

function detectTechStack(
  packageJson: PackageJson | undefined,
  readme: string | undefined,
  agents: string | undefined,
  claude: string | undefined
): string {
  const packageNames = new Set<string>([
    ...Object.keys(packageJson?.dependencies ?? {}),
    ...Object.keys(packageJson?.devDependencies ?? {}),
  ]);

  const stack = new Set<string>();
  const combinedText = [readme, agents, claude].filter(Boolean).join("\n").toLowerCase();
  const detectionRules: Array<[string, string]> = [
    ["typescript", "TypeScript"],
    ["javascript", "JavaScript"],
    ["node", "Node.js"],
    ["react", "React"],
    ["next", "Next.js"],
    ["vitest", "Vitest"],
    ["jest", "Jest"],
    ["python", "Python"],
    ["openai", "OpenAI"],
  ];

  for (const [needle, label] of detectionRules) {
    if (packageNames.has(needle) || combinedText.includes(needle)) {
      stack.add(label);
    }
  }

  return stack.size > 0
    ? Array.from(stack).join(", ")
    : "Tech stack to be documented.";
}

function fallbackProjectName(targetDir: string, packageJson: PackageJson | undefined): string {
  if (packageJson?.name) {
    return titleizePackageName(packageJson.name);
  }

  return titleizePackageName(basename(targetDir));
}

function listTemplateFiles(rootDir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = resolve(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTemplateFiles(fullPath));
      continue;
    }

    if (entry.isFile() || statSync(fullPath).isFile()) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function getTemplateRoot(assetsRoot?: string): string {
  const candidates = [
    assetsRoot ? resolve(assetsRoot, "memory-init/templates") : undefined,
    resolve(__dirname, "../assets/memory-init/templates"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Memory init templates not found. Run 'node scripts/bundle-assets.js' or provide assetsRoot."
  );
}

function renderTemplate(content: string, replacements: Record<string, string>): string {
  return content.replace(/\{\{([A-Z_]+)\}\}/g, (_match, key: string) => {
    return replacements[key] ?? `TODO: ${key}`;
  });
}

function buildTemplateReplacements(
  context: ProjectMemoryContext,
  date: Date
): Record<string, string> {
  const formattedDate = date.toISOString().slice(0, 10);

  return {
    DATE: formattedDate,
    PROJECT_NAME: context.projectName,
    PROJECT_PURPOSE: context.projectPurpose,
    TECH_STACK: context.techStack,
    HARD_CONSTRAINTS: context.hardConstraints,
    PREFERENCES: context.preferences,
    STABLE_COMPONENTS: context.stableComponents,
    EVOLVING_COMPONENTS: context.evolvingComponents,
    LEGACY_COMPONENTS: context.legacyComponents,
  };
}

function appendSessionMemoryProtocol(targetFilePath: string, protocol: string): void {
  const existing = readOptionalFile(targetFilePath)?.trimEnd();
  const nextContent = existing ? `${existing}\n\n${protocol}\n` : `${protocol}\n`;
  writeFileSync(targetFilePath, nextContent);
}

function replaceSessionMemoryProtocol(content: string, protocol: string): string {
  const heading = /^## Session Memory Protocol\s*$/mu;
  const match = heading.exec(content);
  if (!match) return content;
  const following = /^## (?!Session Memory Protocol\s*$).+$/gmu;
  following.lastIndex = match.index + match[0].length;
  const next = following.exec(content);
  const before = content.slice(0, match.index).trimEnd();
  const after = next ? content.slice(next.index).trim() : "";
  return [before, protocol.trim(), after].filter(Boolean).join("\n\n") + "\n";
}

function sectionBounds(content: string, heading: string): { start: number; bodyStart: number; end: number } | null {
  const pattern = new RegExp(`^## ${escapeRegExp(heading)}\\s*$`, "mu");
  const match = pattern.exec(content);
  if (!match) return null;
  const bodyStart = match.index + match[0].length;
  const following = /^## .+$/gmu;
  following.lastIndex = bodyStart;
  const next = following.exec(content);
  return { start: match.index, bodyStart, end: next?.index ?? content.length };
}

function sectionField(content: string, heading: string, label: string): string | null {
  const bounds = sectionBounds(content, heading);
  if (!bounds) return null;
  const body = content.slice(bounds.bodyStart, bounds.end);
  const match = body.match(new RegExp(`^- \\*\\*${escapeRegExp(label)}\\*\\*: (.+)$`, "mu"));
  return match?.[1]?.trim() ?? null;
}

function ensureSectionFields(
  content: string,
  heading: string,
  fields: Array<[string, string]>,
): string {
  let next = content;
  if (!sectionBounds(next, heading)) next = `${next.trimEnd()}\n\n## ${heading}\n`;
  for (const [label, value] of fields) {
    const bounds = sectionBounds(next, heading)!;
    const body = next.slice(bounds.bodyStart, bounds.end);
    if (new RegExp(`^- \\*\\*${escapeRegExp(label)}\\*\\*:`, "mu").test(body)) continue;
    const insertion = `${body.trimEnd()}\n- **${label}**: ${value}\n\n`;
    next = `${next.slice(0, bounds.bodyStart)}${insertion}${next.slice(bounds.end).trimStart()}`;
  }
  return next;
}

function ensureSection(content: string, heading: string, body: string): string {
  if (sectionBounds(content, heading)) return content;
  return `${content.trimEnd()}\n\n## ${heading}\n${body.trim()}\n`;
}

function upgradeSessionBridge(content: string): string {
  let next = content;
  if (!sectionBounds(next, "Delivery Pointer") && sectionBounds(next, "Active opsx Change")) {
    next = next.replace(/^## Active opsx Change\s*$/mu, "## Delivery Pointer");
  }
  if (sectionBounds(next, "Delivery Pointer")) {
    next = next.replace(/^- \*\*Phase\*\*: (.+)$/mu, "- **Phase at Checkpoint**: $1");
  }
  const legacyPhase = sectionField(next, "Delivery Pointer", "Phase at Checkpoint") ?? "none";
  next = ensureSectionFields(next, "Delivery Pointer", [
    ["RFC", "none"],
    ["RFC Revision", "none"],
    ["Slice", "none"],
    ["Issue", "none"],
    ["Change", "none"],
    ["Worktree", "none"],
    ["Phase at Checkpoint", legacyPhase],
    ["Task Group at Checkpoint", "none"],
    ["Observed Run Revision", "none"],
    ["Last Verified HEAD", "none"],
  ]);
  next = next.replace(/^## Waiting \(next steps \/ blockers\)\s*$/mu, "## Blockers");
  next = next.replace(/^## New Discoveries\s*$/mu, "## Discoveries");
  next = next.replace(/^## New Pitfalls\s*$/mu, "## Promotion Queue");
  next = ensureSection(
    next,
    "Next Action",
    "- Review and accept `RFC-0001-project-foundation` before proposing delivery work.",
  );
  next = ensureSection(next, "Blockers", "- Foundation RFC is not yet accepted and merged.");
  next = ensureSection(next, "Uncommitted Work", "- none");
  next = ensureSection(next, "Discoveries", "- none");
  next = ensureSection(
    next,
    "Promotion Queue",
    "- Review legacy discoveries before promoting them to permanent Memory or Architecture.",
  );
  return next.endsWith("\n") ? next : `${next}\n`;
}

function ensureManagedSection(
  content: string,
  heading: string,
  region: string,
  defaultBody: string,
): string {
  const start = `<!-- corgi:managed:start ${region} -->`;
  const end = `<!-- corgi:managed:end ${region} -->`;
  const startCount = content.split(start).length - 1;
  const endCount = content.split(end).length - 1;
  if (startCount === 1 && endCount === 1 && content.indexOf(start) < content.indexOf(end)) return content;
  if (startCount !== 0 || endCount !== 0) {
    throw new Error(`Managed Wiki region '${region}' is incomplete or ambiguous`);
  }
  const bounds = sectionBounds(content, heading);
  if (!bounds) {
    return `${content.trimEnd()}\n\n## ${heading}\n${start}\n${defaultBody}\n${end}\n`;
  }
  const existing = content.slice(bounds.bodyStart, bounds.end).trim();
  const knownPlaceholder = /^- \((?:No .+|none yet).+\)$/iu.test(existing)
    || existing === "- (none yet)"
    || existing === "(No deliveries yet.)";
  const body = !existing || knownPlaceholder ? defaultBody : existing;
  const replacement = `\n${start}\n${body}\n${end}\n\n`;
  return `${content.slice(0, bounds.bodyStart)}${replacement}${content.slice(bounds.end).trimStart()}`;
}

function upgradeHot(content: string): string {
  let next = ensureManagedSection(
    content,
    "Active RFCs",
    "active-rfcs",
    "- `RFC-0001-project-foundation` — draft; human review required",
  );
  next = ensureManagedSection(next, "Active Deliveries", "active-deliveries", "- none");
  next = ensureManagedSection(next, "Recently Shipped", "recently-shipped", "- none");
  return next.endsWith("\n") ? next : `${next}\n`;
}

function upgradeWikiIndex(content: string, renderedTemplate: string): string {
  const links = renderedTemplate.split(/\r?\n/u).filter((line) => /^- \[\[.+\]\]$/u.test(line));
  const missing = links.filter((line) => !content.includes(line));
  if (missing.length === 0) return content;
  return `${content.trimEnd()}\n\n## RFC-first v4 Domains\n${missing.join("\n")}\n`;
}

function upgradeKnowledgeIndexes(path: string, content: string): string {
  if (path === "wiki/architecture/_index.md") {
    return ensureManagedSection(content, "Verified Delivery Sources", "architecture-deliveries", "- none");
  }
  if (path === "wiki/patterns/_index.md") {
    return ensureManagedSection(content, "Verified Delivery Sources", "pattern-deliveries", "- none");
  }
  if (path === "memory/MEMORY.md") {
    return ensureManagedSection(content, "Verified Deliveries", "verified-deliveries", "- none");
  }
  return content;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractProjectMemoryContext(targetDir: string): ProjectMemoryContext {
  const readme = readOptionalFile(resolve(targetDir, "README.md"));
  const agents = readOptionalFile(resolve(targetDir, "AGENTS.md"));
  const claude = readOptionalFile(resolve(targetDir, "CLAUDE.md"));
  const packageJson = readPackageJson(targetDir);

  const projectName = firstMarkdownHeading(readme) ?? fallbackProjectName(targetDir, packageJson);
  const projectPurpose =
    firstParagraph(readme) ??
    extractSectionParagraph(agents, "What this repo is") ??
    extractSectionParagraph(claude, "What this repo is") ??
    packageJson?.description ??
    "Project purpose to be documented.";

  return {
    projectName,
    projectPurpose,
    techStack: detectTechStack(packageJson, readme, agents, claude),
    hardConstraints:
      firstParagraph(agents) ??
      firstParagraph(claude) ??
      "Add enduring project constraints here.",
    preferences:
      extractSectionParagraph(agents, "Conventions") ??
      extractSectionParagraph(claude, "Conventions") ??
      "Add working preferences here.",
    stableComponents: "Core docs and established workflows.",
    evolvingComponents: "Project areas currently being shaped or expanded.",
    legacyComponents: agents?.toLowerCase().includes("legacy") || claude?.toLowerCase().includes("legacy")
      ? "Legacy tooling or workflows are still documented in-repo."
      : "No known legacy components yet.",
  };
}

export function initializeMemoryStructure(input: MemoryInitInput): MemoryInitResult {
  const templateRoot = getTemplateRoot(input.assetsRoot);
  const replacements = buildTemplateReplacements(
    extractProjectMemoryContext(input.targetDir),
    input.date ?? new Date()
  );
  const createdFiles: string[] = [];
  const skippedFiles: string[] = [];
  const upgradedFiles: string[] = [];

  const bridgePath = resolve(input.targetDir, "memory/session-bridge.md");
  if (existsSync(bridgePath)) {
    const before = readFileSync(bridgePath, "utf8");
    const after = upgradeSessionBridge(before);
    if (after !== before) {
      writeFileSync(bridgePath, after);
      upgradedFiles.push("memory/session-bridge.md");
    }
  }
  const hotPath = resolve(input.targetDir, "wiki/hot.md");
  if (existsSync(hotPath)) {
    const before = readFileSync(hotPath, "utf8");
    const after = upgradeHot(before);
    if (after !== before) {
      writeFileSync(hotPath, after);
      upgradedFiles.push("wiki/hot.md");
    }
  }
  const indexPath = resolve(input.targetDir, "wiki/index.md");
  if (existsSync(indexPath)) {
    const before = readFileSync(indexPath, "utf8");
    const template = renderTemplate(
      readFileSync(resolve(templateRoot, "wiki/index.md"), "utf8"),
      replacements,
    );
    const after = upgradeWikiIndex(before, template);
    if (after !== before) {
      writeFileSync(indexPath, after);
      upgradedFiles.push("wiki/index.md");
    }
  }

  for (const relativePath of [
    "wiki/architecture/_index.md",
    "wiki/patterns/_index.md",
    "memory/MEMORY.md",
  ]) {
    const path = resolve(input.targetDir, relativePath);
    if (!existsSync(path)) continue;
    const before = readFileSync(path, "utf8");
    const after = upgradeKnowledgeIndexes(relativePath, before);
    if (after !== before) {
      writeFileSync(path, after);
      upgradedFiles.push(relativePath);
    }
  }

  for (const templateFile of listTemplateFiles(templateRoot)) {
    const relativePath = normalizeRelativePath(relative(templateRoot, templateFile));
    if (relativePath === "session-memory-protocol.md") {
      continue;
    }

    const targetFile = resolve(input.targetDir, relativePath);
    if (existsSync(targetFile)) {
      skippedFiles.push(relativePath);
      continue;
    }

    mkdirSync(dirname(targetFile), { recursive: true });
    const rendered = renderTemplate(readFileSync(templateFile, "utf-8"), replacements);
    writeFileSync(targetFile, rendered);
    createdFiles.push(relativePath);
  }

  const agentsPath = resolve(input.targetDir, "AGENTS.md");
  const claudePath = resolve(input.targetDir, "CLAUDE.md");
  const agentsContent = readOptionalFile(agentsPath);
  const claudeContent = readOptionalFile(claudePath);
  const protocol = renderTemplate(
    readFileSync(resolve(templateRoot, "session-memory-protocol.md"), "utf-8"),
    replacements
  );
  let hasProtocol = false;
  for (const [path, content] of [[agentsPath, agentsContent], [claudePath, claudeContent]] as const) {
    if (!content?.includes(SESSION_MEMORY_PROTOCOL_HEADING)) continue;
    hasProtocol = true;
    const upgraded = replaceSessionMemoryProtocol(content, protocol);
    if (upgraded !== content) {
      writeFileSync(path, upgraded);
      upgradedFiles.push(normalizeRelativePath(relative(input.targetDir, path)));
    }
  }

  let injectedSessionMemoryProtocol = false;
  if (!hasProtocol) {
    const protocolTarget = existsSync(agentsPath) || !existsSync(claudePath) ? agentsPath : claudePath;
    appendSessionMemoryProtocol(protocolTarget, protocol);
    injectedSessionMemoryProtocol = true;
  }

  return {
    createdFiles,
    skippedFiles,
    upgradedFiles,
    injectedSessionMemoryProtocol,
  };
}
