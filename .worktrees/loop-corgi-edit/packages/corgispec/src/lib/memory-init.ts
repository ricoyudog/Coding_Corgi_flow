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
  const hasProtocol =
    agentsContent?.includes(SESSION_MEMORY_PROTOCOL_HEADING) ||
    claudeContent?.includes(SESSION_MEMORY_PROTOCOL_HEADING);

  let injectedSessionMemoryProtocol = false;
  if (!hasProtocol) {
    const protocol = renderTemplate(
      readFileSync(resolve(templateRoot, "session-memory-protocol.md"), "utf-8"),
      replacements
    );
    const protocolTarget = existsSync(agentsPath) || !existsSync(claudePath) ? agentsPath : claudePath;
    appendSessionMemoryProtocol(protocolTarget, protocol);
    injectedSessionMemoryProtocol = true;
  }

  return {
    createdFiles,
    skippedFiles,
    injectedSessionMemoryProtocol,
  };
}
