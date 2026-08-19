import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, posix, relative, resolve, sep } from "node:path";
import * as yaml from "js-yaml";

import { loadConfigFromDir } from "./config.js";
import {
  ACTIVE_PHASES_V3,
  assertRunStateV3,
  type RunStateV3,
} from "./run-contract-v3.js";

export const MEMORY_LINT_CHECK_COUNT = 14 as const;

const DOMAINS = [
  "architecture",
  "research",
  "patterns",
  "decisions",
  "guides",
  "questions",
  "deliveries",
  "meta",
] as const;

const MANDATORY_PATHS = [
  "memory/MEMORY.md",
  "memory/session-bridge.md",
  "memory/pitfalls.md",
  "wiki/hot.md",
  "wiki/index.md",
  "wiki/schema.md",
  ...DOMAINS.map((domain) => `wiki/${domain}/_index.md`),
] as const;

const BRIDGE_FIELDS = [
  "RFC",
  "RFC Revision",
  "Slice",
  "Issue",
  "Change",
  "Worktree",
  "Phase at Checkpoint",
  "Task Group at Checkpoint",
  "Observed Run Revision",
  "Last Verified HEAD",
] as const;

const BRIDGE_SECTIONS = [
  "Delivery Pointer",
  "Next Action",
  "Blockers",
  "Uncommitted Work",
  "Discoveries",
  "Promotion Queue",
] as const;

const HOT_REGIONS = ["active-rfcs", "active-deliveries", "recently-shipped"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const HASH_RE = /^(?:sha256:)?[a-f0-9]{64}$/iu;

export type MemoryLintSeverity = "warning" | "error";
export type MemoryLintCheckStatus = "pass" | "not_applicable" | MemoryLintSeverity;
export type MemoryLintOutcome = "PASS" | "WARN" | "FAIL";

export interface MemoryLintFinding {
  severity: MemoryLintSeverity;
  path: string;
  line?: number;
  message: string;
  evidence: string;
  remediation: string;
}

export interface MemoryLintCheck {
  id: number;
  name: string;
  status: MemoryLintCheckStatus;
  summary: string;
  findings: MemoryLintFinding[];
}

export interface MemoryLintCounts {
  pass: number;
  notApplicable: number;
  warning: number;
  error: number;
}

export interface MemoryLintResult {
  schemaVersion: 1;
  contract: "memory-wiki-v4";
  projectRoot: string;
  date: string;
  outcome: MemoryLintOutcome;
  counts: MemoryLintCounts;
  checks: MemoryLintCheck[];
}

export interface LintMemoryWikiV4Input {
  projectRoot: string;
  now?: Date;
}

interface FrontmatterResult {
  data: Record<string, unknown>;
  body: string;
  error: string | null;
}

interface WikiLink {
  source: string;
  line: number;
  rawTarget: string;
  target: string;
}

interface CheckEvaluation {
  summary: string;
  findings?: MemoryLintFinding[];
  notApplicable?: boolean;
}

interface ArchivedSlice {
  rfc: string;
  slice: string;
  change: string;
  commit: string;
  evidenceManifest: string;
  path: string;
}

interface LegacyHashRecord {
  path: string;
  hashes: Record<string, string>;
}

export function lintMemoryWikiV4(input: LintMemoryWikiV4Input): MemoryLintResult {
  const root = resolve(input.projectRoot);
  const now = input.now ?? new Date();
  const date = isoDate(now);
  const markdownPaths = [
    ...walkMarkdown(resolve(root, "memory"), root),
    ...walkMarkdown(resolve(root, "wiki"), root),
  ].sort();
  const links = collectWikiLinks(root, markdownPaths);
  const evaluations: Array<[number, string, MemoryLintSeverity, () => CheckEvaluation]> = [
    [1, "Mandatory structure", "error", () => checkMandatoryStructure(root)],
    [2, "Startup protocol", "error", () => checkStartupProtocol(root)],
    [3, "Session Bridge contract", "error", () => checkBridgeContract(root)],
    [4, "Session Bridge drift", "warning", () => checkBridgeDrift(root)],
    [5, "Hot-page health", "warning", () => checkHotHealth(root, now)],
    [6, "Root Wiki index", "warning", () => checkRootIndex(root)],
    [7, "Wikilink integrity", "error", () => checkWikilinks(root, markdownPaths, links)],
    [8, "Domain index coverage and orphans", "warning", () => checkIndexCoverage(root, markdownPaths, links)],
    [9, "Frontmatter schema", "warning", () => checkFrontmatter(root, markdownPaths)],
    [10, "Architecture verification", "error", () => checkArchitectureVerification(root)],
    [11, "Pitfall health", "warning", () => checkPitfalls(root)],
    [12, "Archived delivery completeness", "error", () => checkDeliveryCompleteness(root)],
    [13, "Managed-region integrity", "error", () => checkManagedRegions(root)],
    [14, "Legacy preservation", "error", () => checkLegacyPreservation(root)],
  ];

  const checks = evaluations.map(([id, name, severity, evaluate]) => {
    let evaluation: CheckEvaluation;
    try {
      evaluation = evaluate();
    } catch (error) {
      evaluation = {
        summary: "The check could not read or parse authoritative project data.",
        findings: [finding(
          severity,
          ".",
          `Check failed: ${error instanceof Error ? error.message : String(error)}`,
          "The checker encountered unreadable or malformed input.",
          "Repair the reported project data and run lint again.",
        )],
      };
    }
    const findings = (evaluation.findings ?? [])
      .map((entry) => ({ ...entry, severity }))
      .sort(compareFindings);
    const status: MemoryLintCheckStatus = evaluation.notApplicable
      ? "not_applicable"
      : findings.length > 0
        ? severity
        : "pass";
    return { id, name, status, summary: evaluation.summary, findings };
  });

  const counts: MemoryLintCounts = {
    pass: checks.filter((check) => check.status === "pass").length,
    notApplicable: checks.filter((check) => check.status === "not_applicable").length,
    warning: checks.filter((check) => check.status === "warning").length,
    error: checks.filter((check) => check.status === "error").length,
  };
  const outcome: MemoryLintOutcome = counts.error > 0 ? "FAIL" : counts.warning > 0 ? "WARN" : "PASS";
  return {
    schemaVersion: 1,
    contract: "memory-wiki-v4",
    projectRoot: root,
    date,
    outcome,
    counts,
    checks,
  };
}

export function renderMemoryLintReport(result: MemoryLintResult): string {
  const lines = [
    "---",
    "type: meta",
    `updated: ${result.date}`,
    "kind: lint-report",
    "unlisted: true",
    "---",
    "",
    `# CorgiSpec Memory/Wiki Lint — ${result.date}`,
    "",
    `**Outcome:** ${result.outcome}`,
    `**Total checks:** ${result.checks.length}`,
    `**Checks:** ${result.counts.pass} pass, ${result.counts.notApplicable} N/A, ${result.counts.warning} warning, ${result.counts.error} error`,
    "",
    "## Checks",
    "",
  ];
  for (const check of result.checks) {
    lines.push(`### ${check.id}. ${check.name} — ${displayStatus(check.status)}`, "", check.summary, "");
    for (const entry of check.findings) {
      const location = `${entry.path}${entry.line === undefined ? "" : `:${entry.line}`}`;
      lines.push(
        `- **${entry.severity.toUpperCase()}** \`${location}\`: ${entry.message}`,
        `  - Evidence: ${entry.evidence}`,
        `  - Remediation: ${entry.remediation}`,
      );
    }
    if (check.findings.length > 0) lines.push("");
  }
  const remediation = result.checks
    .flatMap((check) => check.findings.map((entry) => ({ check: check.id, ...entry })))
    .sort((left, right) => {
      const severity = left.severity === right.severity ? 0 : left.severity === "error" ? -1 : 1;
      return severity || left.check - right.check || compareFindings(left, right);
    });
  lines.push("## Prioritized Remediation", "");
  if (remediation.length === 0) {
    lines.push("- None.", "");
  } else {
    remediation.forEach((entry, index) => {
      lines.push(`${index + 1}. [Check ${entry.check}] ${entry.remediation} (\`${entry.path}\`)`);
    });
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function writeMemoryLintReport(result: MemoryLintResult): string {
  const path = resolve(result.projectRoot, "wiki", "meta", `lint-report-${result.date}.md`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderMemoryLintReport(result), "utf8");
  return path;
}

export function memoryLintExitCode(outcome: MemoryLintOutcome): number {
  return outcome === "PASS" ? 0 : outcome === "WARN" ? 1 : 2;
}

function checkMandatoryStructure(root: string): CheckEvaluation {
  const findings = MANDATORY_PATHS.flatMap((path) => existsRegularFile(resolve(root, path)) ? [] : [
    finding("error", path, "Mandatory v4 Memory/Wiki file is missing.", `Expected a regular file at ${path}.`, "Run `corgispec bootstrap` to restore the v4 structure."),
  ]);
  return { summary: findings.length === 0 ? "All mandatory Memory/Wiki files and domain indexes exist." : `${findings.length} mandatory path(s) are missing.`, findings };
}

function checkStartupProtocol(root: string): CheckEvaluation {
  const candidates = ["AGENTS.md", "CLAUDE.md"].filter((path) => existsRegularFile(resolve(root, path)));
  const occurrences: Array<{ path: string; content: string; start: number }> = [];
  for (const path of candidates) {
    const content = readFileSync(resolve(root, path), "utf8");
    for (const match of content.matchAll(/^## Session Memory Protocol\s*$/gmu)) {
      occurrences.push({ path, content, start: match.index ?? 0 });
    }
  }
  if (occurrences.length !== 1) {
    return {
      summary: "The startup protocol must have exactly one authoritative copy.",
      findings: [finding("error", candidates.join(", ") || "AGENTS.md", "Expected exactly one `## Session Memory Protocol` section.", `Found ${occurrences.length} sections across AGENTS.md and CLAUDE.md.`, "Keep one protocol section in AGENTS.md or CLAUDE.md and remove duplicates.")],
    };
  }
  const occurrence = occurrences[0]!;
  const tail = occurrence.content.slice(occurrence.start);
  const next = tail.slice(1).search(/^##\s+/mu);
  const section = next < 0 ? tail : tail.slice(0, next + 1);
  const ordered = ["memory/session-bridge.md", "memory/MEMORY.md", "wiki/hot.md"];
  const positions = ordered.map((path) => section.indexOf(path));
  const findings: MemoryLintFinding[] = [];
  if (positions.some((position) => position < 0) || !(positions[0]! < positions[1]! && positions[1]! < positions[2]!)) {
    findings.push(finding("error", occurrence.path, "Startup files are absent or out of order.", "Required order: session-bridge.md → MEMORY.md → hot.md.", "Restore the three startup reads in their required order."));
  }
  if (!section.includes("wiki/index.md") || !/(?:only\s+)?on[ -]?demand|按需/iu.test(section)) {
    findings.push(finding("error", occurrence.path, "The protocol does not make wiki/index.md an on-demand read.", "The protocol must explicitly say that wiki/index.md is read only on demand.", "Add the explicit on-demand index rule to the protocol section."));
  }
  return { summary: findings.length === 0 ? "One startup protocol has the required read order and on-demand index rule." : "The startup protocol violates the v4 retrieval contract.", findings };
}

function checkBridgeContract(root: string): CheckEvaluation {
  const path = "memory/session-bridge.md";
  if (!existsRegularFile(resolve(root, path))) {
    return { summary: "Session Bridge is unavailable.", findings: [finding("error", path, "Session Bridge is missing.", "The bridge is required for cross-session continuity.", "Restore the v4 Session Bridge template.")] };
  }
  const content = readFileSync(resolve(root, path), "utf8");
  const lineCount = content.trimEnd().split(/\r?\n/u).length;
  const findings: MemoryLintFinding[] = [];
  for (const section of BRIDGE_SECTIONS) {
    if (!new RegExp(`^## ${escapeRegExp(section)}\\s*$`, "mu").test(content)) {
      findings.push(finding("error", path, `Bridge section '${section}' is missing.`, `Expected heading: ## ${section}.`, "Restore the missing Session Bridge section."));
    }
  }
  for (const field of BRIDGE_FIELDS) {
    if (!new RegExp(`^- \\*\\*${escapeRegExp(field)}\\*\\*:\\s*\\S.*$`, "mu").test(content)) {
      findings.push(finding("error", path, `Delivery Pointer field '${field}' is missing or empty.`, `Expected a non-empty '- **${field}**:' field.`, "Restore the field and record an explicit value such as `none`."));
    }
  }
  if (lineCount > 50) {
    findings.push(finding("error", path, "Session Bridge exceeds its hard cap.", `Found ${lineCount} lines; maximum is 50.`, "Compress completed history and retain only the durable current checkpoint."));
  }
  return { summary: findings.length === 0 ? `Session Bridge has all required sections and fields (${lineCount}/50 lines).` : "Session Bridge is incomplete or over its hard cap.", findings };
}

function checkBridgeDrift(root: string): CheckEvaluation {
  const runs = readActiveRunStates(root);
  if (runs.length === 0) {
    return { summary: "N/A — no authoritative active Run Contract v3 state exists.", notApplicable: true };
  }
  const bridgePath = resolve(root, "memory/session-bridge.md");
  if (!existsRegularFile(bridgePath)) {
    return { summary: "An active run exists but the Session Bridge is unavailable.", findings: [finding("warning", "memory/session-bridge.md", "Cannot compare the active run to the missing bridge.", `${runs.length} active Run Contract(s) exist.`, "Restore the bridge from the current authoritative run checkpoint.")] };
  }
  const fields = bridgeFieldMap(readFileSync(bridgePath, "utf8"));
  const findings: MemoryLintFinding[] = [];
  if (runs.length > 1) {
    findings.push(finding("warning", ".corgi/loop", "Multiple active Run Contracts make the bridge binding ambiguous.", `Active changes: ${runs.map((run) => run.changeName).join(", ")}.`, "Checkpoint or finish all but the delivery referenced by the bridge."));
  }
  const named = fields.get("Change");
  const run = runs.find((candidate) => candidate.changeName === named) ?? runs[0]!;
  const bridgeRevision = integerOrNull(fields.get("Observed Run Revision"));
  const runHead = authoritativeRunHead(run);
  if (named && named !== "none" && named !== run.changeName) {
    findings.push(finding("warning", "memory/session-bridge.md", "Bridge Change contradicts the active Run Contract.", `Bridge=${named}; run=${run.changeName}.`, "Regenerate the bridge checkpoint from the active Run Contract."));
  } else if (bridgeRevision === null) {
    findings.push(finding("warning", "memory/session-bridge.md", "Bridge has no observed Run revision for an active run.", `Run ${run.runId} is at revision ${run.stateRevision}.`, "Checkpoint the active run into the bridge."));
  } else if (bridgeRevision < run.stateRevision) {
    findings.push(finding("warning", "memory/session-bridge.md", "Bridge trails expected live Run advancement.", `Bridge revision=${bridgeRevision}; run revision=${run.stateRevision}.`, "Use SessionStart/PostCompact synthesis for live state; update the durable bridge at the next checkpoint."));
  } else if (bridgeRevision > run.stateRevision) {
    findings.push(finding("warning", "memory/session-bridge.md", "Bridge revision is ahead of authoritative Run state.", `Bridge revision=${bridgeRevision}; run revision=${run.stateRevision}.`, "Repair the contradictory bridge binding from Run Contract v3."));
  } else {
    const comparisons: Array<[string, string | null]> = [
      ["Phase at Checkpoint", run.phase],
      ["Task Group at Checkpoint", run.currentGroupId ?? "none"],
      ["Last Verified HEAD", runHead],
    ];
    for (const [field, expected] of comparisons) {
      const actual = fields.get(field) ?? null;
      if (expected !== null && actual !== expected) {
        findings.push(finding("warning", "memory/session-bridge.md", `Bridge field '${field}' contradicts Run revision ${run.stateRevision}.`, `Bridge=${actual ?? "missing"}; run=${expected}.`, "Regenerate the durable checkpoint from the matching Run revision."));
      }
    }
  }
  return { summary: findings.length === 0 ? "Session Bridge matches the authoritative active Run Contract." : "Session Bridge drift was detected against Run Contract v3.", findings };
}

function checkHotHealth(root: string, now: Date): CheckEvaluation {
  const path = "wiki/hot.md";
  if (!existsRegularFile(resolve(root, path))) {
    return { summary: "Hot page is unavailable.", findings: [finding("warning", path, "Hot page is missing.", "The current project pulse cannot be checked.", "Restore wiki/hot.md with the v4 template.")] };
  }
  const content = readFileSync(resolve(root, path), "utf8");
  const frontmatter = parseFrontmatter(content);
  const findings: MemoryLintFinding[] = [];
  for (const region of HOT_REGIONS) {
    if (!content.includes(`<!-- corgi:managed:start ${region} -->`) || !content.includes(`<!-- corgi:managed:end ${region} -->`)) {
      findings.push(finding("warning", path, `Hot page lacks managed region '${region}'.`, `Expected start/end markers for ${region}.`, "Restore the canonical managed region markers."));
    }
  }
  const updated = dateValue(frontmatter.data.updated);
  if (!updated || !DATE_RE.test(updated)) {
    findings.push(finding("warning", path, "Hot-page freshness cannot be established.", `updated=${String(frontmatter.data.updated ?? "missing")}.`, "Set `updated` to the date of the last verified project-pulse refresh."));
  } else {
    const age = Math.floor((utcDay(now).getTime() - utcDay(new Date(`${updated}T00:00:00Z`)).getTime()) / 86_400_000);
    if (age > 14) findings.push(finding("warning", path, "Hot page is stale.", `updated=${updated}, age=${age} days.`, "Refresh the project pulse from verified current state."));
  }
  const words = wordCount(frontmatter.body);
  if (words > 600) findings.push(finding("warning", path, "Hot page exceeds its hard word cap.", `Found ${words} words; maximum is 600.`, "Trim the oldest or least-current entries."));
  return { summary: findings.length === 0 ? `Hot page is current and bounded (${words}/600 words).` : "Hot-page freshness, size, or managed sections need attention.", findings };
}

function checkRootIndex(root: string): CheckEvaluation {
  const path = "wiki/index.md";
  if (!existsRegularFile(resolve(root, path))) {
    return { summary: "Root Wiki index is unavailable.", findings: [finding("warning", path, "Root Wiki index is missing.", "Domain navigation cannot be checked.", "Restore wiki/index.md from the v4 template.")] };
  }
  const content = readFileSync(resolve(root, path), "utf8");
  const findings: MemoryLintFinding[] = [];
  for (const domain of DOMAINS) {
    const target = `wiki/${domain}/_index`;
    if (!wikiTargetSet(content).has(target)) findings.push(finding("warning", path, `Root index does not link the ${domain} domain index.`, `Missing [[${target}]].`, "Add the mandatory domain index link."));
  }
  const lines = content.trimEnd().split(/\r?\n/u).length;
  if (lines > 80) findings.push(finding("warning", path, "Root Wiki index exceeds its hard line cap.", `Found ${lines} lines; maximum is 80.`, "Move detail into domain indexes and retain only navigation."));
  return { summary: findings.length === 0 ? `Root index links all domains (${lines}/80 lines).` : "Root Wiki navigation is incomplete or oversized.", findings };
}

function checkWikilinks(root: string, markdownPaths: string[], links: WikiLink[]): CheckEvaluation {
  const lookup = buildMarkdownLookup(markdownPaths);
  const findings: MemoryLintFinding[] = [];
  for (const link of links) {
    const resolved = resolveWikiLink(link, lookup);
    if (resolved.length === 0) {
      findings.push(finding("error", link.source, `Wikilink target '${link.rawTarget}' does not resolve.`, "No Memory/Wiki markdown file matches the target.", "Fix the target or create and index the referenced page.", link.line));
    } else if (resolved.length > 1) {
      findings.push(finding("error", link.source, `Wikilink target '${link.rawTarget}' is ambiguous.`, `Matches: ${resolved.join(", ")}.`, "Use a vault-relative path that resolves to exactly one page.", link.line));
    }
  }
  return { summary: findings.length === 0 ? `All ${links.length} Memory/Wiki wikilinks resolve uniquely.` : `${findings.length} broken or ambiguous wikilink(s) found.`, findings };
}

function checkIndexCoverage(root: string, markdownPaths: string[], links: WikiLink[]): CheckEvaluation {
  const findings: MemoryLintFinding[] = [];
  const incoming = new Map<string, Set<string>>();
  const lookup = buildMarkdownLookup(markdownPaths);
  for (const link of links) {
    const targets = resolveWikiLink(link, lookup);
    if (targets.length === 1 && targets[0] !== link.source) {
      const sources = incoming.get(targets[0]!) ?? new Set<string>();
      sources.add(link.source);
      incoming.set(targets[0]!, sources);
    }
  }
  const domainPages = markdownPaths.filter((path) => {
    if (!path.startsWith("wiki/") || basename(path) === "_index.md") return false;
    return DOMAINS.some((domain) => path.startsWith(`wiki/${domain}/`));
  });
  for (const page of domainPages) {
    const frontmatter = parseFrontmatter(readFileSync(resolve(root, page), "utf8"));
    if (frontmatter.data.unlisted === true) continue;
    const domain = page.split("/")[1]!;
    const indexPath = `wiki/${domain}/_index.md`;
    const indexed = existsRegularFile(resolve(root, indexPath))
      && wikiTargetSet(readFileSync(resolve(root, indexPath), "utf8")).has(stripMd(page));
    if (!indexed) findings.push(finding("warning", page, "Page is absent from its domain index.", `Expected a link from ${indexPath}.`, "Add the page to its domain index or set `unlisted: true` deliberately."));
    if ((incoming.get(page)?.size ?? 0) === 0) findings.push(finding("warning", page, "Page has no incoming Memory/Wiki link.", "No other page links to this page.", "Link the page from its domain index or another relevant knowledge page."));
  }
  return { summary: findings.length === 0 ? `All ${domainPages.length} listed domain pages are indexed and reachable.` : "Domain index coverage or reachability gaps were found.", findings };
}

function checkFrontmatter(root: string, markdownPaths: string[]): CheckEvaluation {
  const findings: MemoryLintFinding[] = [];
  for (const path of markdownPaths.filter((candidate) => candidate.startsWith("wiki/"))) {
    const parsed = parseFrontmatter(readFileSync(resolve(root, path), "utf8"));
    if (parsed.error) {
      findings.push(finding("warning", path, "Frontmatter is missing or invalid.", parsed.error, "Add valid YAML frontmatter conforming to wiki/schema.md."));
      continue;
    }
    const required = ["type", "updated"];
    const domain = path.split("/")[1];
    const isIndex = basename(path) === "_index.md" || path === "wiki/index.md";
    if (domain === "deliveries" && !isIndex) required.push("rfc", "slice", "change", "status", "archived");
    if (domain === "decisions" && !isIndex) required.push("rfc", "ac");
    if (domain === "meta" && !isIndex) required.push("kind");
    for (const field of required) {
      if (parsed.data[field] === undefined || parsed.data[field] === "") findings.push(finding("warning", path, `Required frontmatter field '${field}' is missing.`, `wiki/schema.md requires ${required.join(", ")}.`, "Add the missing field with a valid value."));
    }
    const updated = dateValue(parsed.data.updated);
    if (parsed.data.updated !== undefined && (!updated || !DATE_RE.test(updated))) findings.push(finding("warning", path, "Frontmatter `updated` is not YYYY-MM-DD.", `Found ${String(parsed.data.updated)}.`, "Use an ISO calendar date."));
    const expectedType = !isIndex && domain === "deliveries" ? "delivery"
      : !isIndex && domain === "decisions" ? "decision"
        : !isIndex && domain === "questions" ? "question"
          : !isIndex && domain === "meta" ? "meta"
            : null;
    if (expectedType && parsed.data.type !== expectedType) findings.push(finding("warning", path, `Frontmatter type must be '${expectedType}'.`, `Found ${String(parsed.data.type)}.`, `Set \`type: ${expectedType}\` for this domain page.`));
    if (domain === "deliveries" && !isIndex && parsed.data.status !== "archived") findings.push(finding("warning", path, "Delivery status must be `archived`.", `Found ${String(parsed.data.status)}.`, "Correct the immutable delivery frontmatter."));
    if (domain === "deliveries" && !isIndex) {
      const archived = dateValue(parsed.data.archived);
      if (!archived || !DATE_RE.test(archived)) findings.push(finding("warning", path, "Delivery `archived` date is invalid.", `Found ${String(parsed.data.archived)}.`, "Use the ISO date of archive closeout."));
    }
    if (domain === "questions" && !isIndex && !["pending", "answered", "needs-deep-session"].includes(String(parsed.data.status))) findings.push(finding("warning", path, "Question status is invalid.", `Found ${String(parsed.data.status)}.`, "Use pending, answered, or needs-deep-session."));
    if (parsed.data.unlisted !== undefined && typeof parsed.data.unlisted !== "boolean") findings.push(finding("warning", path, "Frontmatter `unlisted` must be boolean.", `Found ${String(parsed.data.unlisted)}.`, "Use true or false."));
  }
  return { summary: findings.length === 0 ? "Wiki frontmatter conforms to wiki/schema.md." : "Wiki frontmatter schema violations were found.", findings };
}

function checkArchitectureVerification(root: string): CheckEvaluation {
  const directory = resolve(root, "wiki", "architecture");
  const pages = walkMarkdown(directory, root).filter((path) => basename(path) !== "_index.md");
  const findings: MemoryLintFinding[] = [];
  for (const path of pages) {
    const content = parseFrontmatter(readFileSync(resolve(root, path), "utf8")).body;
    for (const entry of markdownEntries(content, ["No verified implicit contracts yet."])) {
      const hasSource = citedProjectPaths(root, entry.text).length > 0;
      const hasEvidence = hasVerifiedArchitectureEvidence(root, entry.text);
      if (!hasSource || !hasEvidence) {
        findings.push(finding("error", path, "Architecture entry lacks source and accepted/archived evidence.", `Entry: ${entry.text.trim()}`, "Cite a concrete source path plus an accepted RFC, archived delivery, or equivalent verified evidence.", entry.line));
      }
    }
  }
  return { summary: findings.length === 0 ? "Current architecture entries are tied to source and verified delivery evidence." : "Unverified current-architecture claims were found.", findings };
}

function checkPitfalls(root: string): CheckEvaluation {
  const path = "memory/pitfalls.md";
  if (!existsRegularFile(resolve(root, path))) {
    return { summary: "Pitfall registry is unavailable.", findings: [finding("warning", path, "Pitfall registry is missing.", "Active pitfall health cannot be checked.", "Restore memory/pitfalls.md.")] };
  }
  const content = readFileSync(resolve(root, path), "utf8");
  const active = markdownSection(content, "Active");
  const entries = markdownEntries(active, ["No verified pitfalls yet."]);
  const findings: MemoryLintFinding[] = [];
  if (entries.length > 20) findings.push(finding("warning", path, "Active pitfall count exceeds the hard cap.", `Found ${entries.length}; maximum is 20.`, "Rotate the oldest verified pitfalls into the Archive section."));
  for (const entry of entries) {
    const hasEvidence = /\bevidence\b|\bsource\b|\bRFC-\d{4}\b|wiki\/deliveries\/|openspec\/changes\/|`[^`]+`/iu.test(entry.text);
    const hasRemediation = /\bremediation\b|\bmitigation\b|\bfix\b|\bavoid\b|\bresolve\b|解决|修复|规避/iu.test(entry.text);
    if (!hasEvidence || !hasRemediation) findings.push(finding("warning", path, "Active pitfall lacks evidence or remediation.", `Entry: ${entry.text.trim()}`, "Add verified evidence and a concrete remediation to the pitfall entry.", entry.line));
  }
  return { summary: findings.length === 0 ? `${entries.length} active pitfall(s) have evidence and remediation.` : "Pitfall evidence, remediation, or rotation needs attention.", findings };
}

function checkDeliveryCompleteness(root: string): CheckEvaluation {
  const scan = readArchivedSlices(root);
  const archived = scan.slices;
  if (archived.length === 0) return {
    summary: scan.findings.length === 0 ? "No archived RFC Slice bindings require delivery pages." : "RFC delivery sidecars could not establish complete archived bindings.",
    findings: scan.findings,
  };
  const pages = walkMarkdown(resolve(root, "wiki", "deliveries"), root).filter((path) => basename(path) !== "_index.md");
  const findings: MemoryLintFinding[] = [...scan.findings];
  for (const slice of archived) {
    const matching = pages.filter((path) => {
      const data = parseFrontmatter(readFileSync(resolve(root, path), "utf8")).data;
      return data.rfc === slice.rfc && data.slice === slice.slice;
    });
    if (matching.length !== 1) {
      findings.push(finding("error", slice.path, "Archived RFC Slice must map to exactly one delivery page.", `Found ${matching.length} pages for ${slice.rfc}/${slice.slice}.`, "Create or deduplicate the immutable delivery closeout page."));
      continue;
    }
    const pagePath = matching[0]!;
    const content = readFileSync(resolve(root, pagePath), "utf8");
    const data = parseFrontmatter(content).data;
    if (data.change !== slice.change) findings.push(finding("error", pagePath, "Delivery page Change does not match delivery.yaml.", `Page=${String(data.change)}; binding=${slice.change}.`, "Restore the archived Change binding."));
    if (String(data.evidence_manifest) !== slice.evidenceManifest) findings.push(finding("error", pagePath, "Delivery evidence manifest digest does not match delivery.yaml.", `Page=${String(data.evidence_manifest)}; binding=${slice.evidenceManifest}.`, "Restore the canonical archive evidence digest."));
    const heads = Array.from(content.matchAll(/Final HEAD:\s*`([^`]+)`/gu)).map((match) => match[1]!);
    if (heads.length !== 1 || heads[0] !== slice.commit) findings.push(finding("error", pagePath, "Delivery final HEAD does not match delivery.yaml.", `Page=${heads.join(", ") || "missing"}; binding=${slice.commit}.`, "Restore the final archived commit evidence."));
    const manifests = findEvidenceManifests(root, slice.change, slice.evidenceManifest);
    if (manifests.length !== 1) {
      findings.push(finding("error", pagePath, "Archived delivery must resolve one canonical evidence manifest.", `Found ${manifests.length} matching manifest(s).`, "Restore or deduplicate the archived Change evidence manifest."));
      continue;
    }
    const manifest = manifests[0]!;
    if (manifest.finalRevision !== slice.commit) findings.push(finding("error", manifest.path, "Evidence manifest final revision does not match delivery binding.", `Manifest=${String(manifest.finalRevision)}; binding=${slice.commit}.`, "Restore canonical evidence from the archived run."));
    const acIds = archivedAcceptanceIds(root, manifest.directory);
    if (acIds.length === 0) findings.push(finding("error", manifest.path, "Canonical archived evidence contains no RFC acceptance criteria.", `${slice.rfc}/${slice.slice} must carry AC evidence into closeout.`, "Restore the Verify/QA acceptance evidence materialized by archive closeout."));
    for (const ac of acIds) {
      const count = Array.from(content.matchAll(new RegExp(`\\b${escapeRegExp(ac)}\\b`, "gu"))).length;
      if (count !== 1) findings.push(finding("error", pagePath, "Delivery AC evidence is missing or duplicated.", `${ac} occurs ${count} time(s); expected exactly once.`, "Restore one acceptance-evidence row per archived AC."));
    }
  }
  return { summary: findings.length === 0 ? `All ${archived.length} archived RFC Slice binding(s) have complete delivery evidence.` : "Archived delivery traceability is incomplete or contradictory.", findings };
}

function checkManagedRegions(root: string): CheckEvaluation {
  const targets: Array<{ path: string; regions: readonly string[]; headings: Record<string, string> }> = [
    { path: "wiki/hot.md", regions: HOT_REGIONS, headings: { "active-rfcs": "Active RFCs", "active-deliveries": "Active Deliveries", "recently-shipped": "Recently Shipped" } },
    { path: "wiki/deliveries/_index.md", regions: ["deliveries"], headings: { deliveries: "Deliveries" } },
  ];
  const findings: MemoryLintFinding[] = [];
  for (const target of targets) {
    if (!existsRegularFile(resolve(root, target.path))) {
      findings.push(finding("error", target.path, "Managed-region owner file is missing.", "Canonical managed markers cannot be verified.", "Restore the v4 owner file and its managed marker pairs."));
      continue;
    }
    const content = readFileSync(resolve(root, target.path), "utf8");
    const starts = Array.from(content.matchAll(/<!-- corgi:managed:start ([a-z0-9-]+) -->/gu));
    const ends = Array.from(content.matchAll(/<!-- corgi:managed:end ([a-z0-9-]+) -->/gu));
    const stack: string[] = [];
    for (const marker of Array.from(content.matchAll(/<!-- corgi:managed:(start|end) ([a-z0-9-]+) -->/gu))) {
      if (marker[1] === "start") stack.push(marker[2]!);
      else if (stack.pop() !== marker[2]) {
        findings.push(finding("error", target.path, "Managed markers are crossed or out of order.", `Unexpected end marker for ${marker[2]}.`, "Restore properly nested, non-overlapping marker pairs."));
        break;
      }
    }
    if (stack.length > 0) findings.push(finding("error", target.path, "Managed markers are not fully closed.", `Open regions: ${stack.join(", ")}.`, "Add the matching end marker(s) in canonical order."));
    for (const region of target.regions) {
      const regionStarts = starts.filter((match) => match[1] === region);
      const regionEnds = ends.filter((match) => match[1] === region);
      if (regionStarts.length !== 1 || regionEnds.length !== 1 || (regionStarts[0]?.index ?? Infinity) >= (regionEnds[0]?.index ?? -1)) {
        findings.push(finding("error", target.path, `Managed region '${region}' is not balanced and unique.`, `starts=${regionStarts.length}, ends=${regionEnds.length}.`, "Restore exactly one ordered start/end marker pair."));
        continue;
      }
      const section = markdownSection(content, target.headings[region]!);
      const outside = section
        .replace(`<!-- corgi:managed:start ${region} -->`, "")
        .replace(new RegExp(`[\\s\\S]*<!-- corgi:managed:end ${escapeRegExp(region)} -->`, "u"), "")
        .trim();
      const beforeStart = section.split(`<!-- corgi:managed:start ${region} -->`, 1)[0]!.trim();
      const afterEnd = section.split(`<!-- corgi:managed:end ${region} -->`)[1]?.trim() ?? "";
      if (beforeStart || afterEnd || outside) {
        findings.push(finding("error", target.path, `Tool-owned '${region}' section has content outside its managed markers.`, "The canonical managed section contains non-whitespace before or after its marker pair.", "Move tool-owned entries inside the markers; preserve unrelated human sections elsewhere."));
      }
    }
    const expected = new Set(target.regions);
    for (const marker of [...starts, ...ends]) {
      if (!expected.has(marker[1] as never)) findings.push(finding("error", target.path, `Unexpected managed region '${marker[1]}'.`, "Only canonical v4 regions are allowed in this tool-owned file.", "Remove or relocate the unknown tool-managed region."));
    }
  }
  return { summary: findings.length === 0 ? "Managed regions are balanced, unique, and contain all tool-owned index content." : "Managed-region ownership boundaries are invalid.", findings };
}

function checkLegacyPreservation(root: string): CheckEvaluation {
  const sessionsPath = resolve(root, "wiki", "sessions");
  const logPath = resolve(root, "wiki", "log.md");
  const hasLegacyPath = existsSync(sessionsPath) || existsSync(logPath);
  const legacyFiles = [
    ...walkFiles(sessionsPath, root),
    ...(existsSync(logPath) ? ["wiki/log.md"] : []),
  ].sort();
  if (!hasLegacyPath) return { summary: "Fresh v4 layout contains no legacy sessions/log output." };
  const record = readLegacyHashRecord(root);
  if (!record) {
    return { summary: "N/A — legacy content exists but no authoritative migration hash record is available.", notApplicable: true };
  }
  const findings: MemoryLintFinding[] = [];
  const expectedPaths = Object.keys(record.hashes).filter((path) => path === "wiki/log.md" || path.startsWith("wiki/sessions/")).sort();
  const all = new Set([...legacyFiles, ...expectedPaths]);
  for (const path of [...all].sort()) {
    const expected = record.hashes[path];
    if (!expected) {
      findings.push(finding("error", path, "Legacy file is absent from the migration hash record.", `Record: ${record.path}.`, "Restore the authoritative preserved-file hash entry."));
      continue;
    }
    if (!existsRegularFile(resolve(root, path))) {
      findings.push(finding("error", path, "A migration-record legacy file is missing.", `Expected hash ${expected}.`, "Restore the byte-for-byte preserved legacy file."));
      continue;
    }
    const actual = createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex");
    if (normalizeHash(expected) !== actual) findings.push(finding("error", path, "Legacy file hash changed after migration.", `Expected ${normalizeHash(expected)}; found ${actual}.`, "Restore the preserved bytes from the migration backup."));
  }
  const currentOutputs = walkMarkdown(resolve(root, "wiki", "deliveries"), root);
  for (const output of currentOutputs) {
    const content = readFileSync(resolve(root, output), "utf8");
    const outputSections = ["Knowledge Promoted", "Outputs", "Artifacts"]
      .map((heading) => markdownSection(content, heading))
      .join("\n");
    for (const legacy of legacyFiles) {
      if (outputSections.includes(legacy)) findings.push(finding("error", output, "Current delivery output references a legacy read-only location as output.", `References ${legacy}.`, "Write current delivery knowledge to v4 deliveries/architecture/research locations instead."));
    }
  }
  return { summary: findings.length === 0 ? `${legacyFiles.length} legacy file(s) match migration-record hashes and remain read-only.` : "Legacy migration preservation violations were found.", findings };
}

function finding(
  severity: MemoryLintSeverity,
  path: string,
  message: string,
  evidence: string,
  remediation: string,
  line?: number,
): MemoryLintFinding {
  return { severity, path: path.replace(/\\/gu, "/"), ...(line === undefined ? {} : { line }), message, evidence, remediation };
}

function compareFindings(left: Pick<MemoryLintFinding, "path" | "line" | "message">, right: Pick<MemoryLintFinding, "path" | "line" | "message">): number {
  return left.path.localeCompare(right.path) || (left.line ?? 0) - (right.line ?? 0) || left.message.localeCompare(right.message);
}

function displayStatus(status: MemoryLintCheckStatus): string {
  return status === "not_applicable" ? "N/A" : status.toUpperCase();
}

function existsRegularFile(path: string): boolean {
  try {
    return existsSync(path) && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function walkFiles(directory: string, root: string): string[] {
  if (!existsSync(directory)) return [];
  if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) return [];
  const output: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) output.push(...walkFiles(absolute, root));
    else if (entry.isFile()) output.push(relative(root, absolute).replace(/\\/gu, "/"));
  }
  return output;
}

function walkMarkdown(directory: string, root: string): string[] {
  return walkFiles(directory, root).filter((path) => extname(path).toLowerCase() === ".md");
}

function parseFrontmatter(content: string): FrontmatterResult {
  const normalized = content.replace(/\r\n/gu, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/u);
  if (!match) return { data: {}, body: normalized, error: "Missing leading YAML frontmatter block." };
  try {
    const loaded = yaml.load(match[1]!) as unknown;
    if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) throw new Error("frontmatter is not a mapping");
    return { data: loaded as Record<string, unknown>, body: normalized.slice(match[0].length), error: null };
  } catch (error) {
    return { data: {}, body: normalized.slice(match[0].length), error: `Invalid YAML: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return typeof value === "string" ? value : null;
}

function isoDate(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new Error("now must be a valid Date");
  return date.toISOString().slice(0, 10);
}

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function wordCount(content: string): number {
  return content
    .replace(/<!--[^]*?-->/gu, " ")
    .replace(/[`#>*_\[\]()|-]/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean).length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function stripMd(path: string): string {
  return path.replace(/\.md$/iu, "");
}

function wikiTargetSet(content: string): Set<string> {
  const output = new Set<string>();
  for (const match of content.matchAll(/\[\[([^\]]+)\]\]/gu)) {
    const target = match[1]!.split("|", 1)[0]!.split("#", 1)[0]!.trim().replace(/\\/gu, "/");
    output.add(stripMd(target));
  }
  return output;
}

function collectWikiLinks(root: string, paths: string[]): WikiLink[] {
  const links: WikiLink[] = [];
  for (const path of paths) {
    const lines = readFileSync(resolve(root, path), "utf8").split(/\r?\n/u);
    let fenced = false;
    lines.forEach((line, index) => {
      if (/^\s*```/u.test(line)) {
        fenced = !fenced;
        return;
      }
      if (fenced) return;
      for (const match of line.matchAll(/\[\[([^\]]+)\]\]/gu)) {
        const rawTarget = match[1]!.split("|", 1)[0]!.trim();
        const target = rawTarget.split("#", 1)[0]!.trim();
        if (target) links.push({ source: path, line: index + 1, rawTarget, target });
      }
    });
  }
  return links;
}

function buildMarkdownLookup(paths: string[]): { paths: Set<string>; basenames: Map<string, string[]> } {
  const normalized = paths.map((path) => stripMd(path.replace(/\\/gu, "/")));
  const basenames = new Map<string, string[]>();
  for (const path of normalized) {
    const key = basename(path);
    basenames.set(key, [...(basenames.get(key) ?? []), `${path}.md`]);
  }
  return { paths: new Set(normalized), basenames };
}

function resolveWikiLink(link: WikiLink, lookup: ReturnType<typeof buildMarkdownLookup>): string[] {
  const target = stripMd(link.target.replace(/\\/gu, "/")).replace(/^\//u, "");
  if (target.includes("/") || target.startsWith(".")) {
    const candidate = target.startsWith(".")
      ? posix.normalize(posix.join(posix.dirname(link.source), target))
      : target;
    return lookup.paths.has(candidate) ? [`${candidate}.md`] : [];
  }
  return [...(lookup.basenames.get(target) ?? [])].sort();
}

function markdownSection(content: string, heading: string): string {
  const match = new RegExp(`^## ${escapeRegExp(heading)}\\s*$`, "mu").exec(content);
  if (!match) return "";
  const tail = content.slice((match.index ?? 0) + match[0].length);
  const next = /^##\s+/mu.exec(tail);
  return next ? tail.slice(0, next.index) : tail;
}

function markdownEntries(content: string, placeholders: string[]): Array<{ line: number; text: string }> {
  const lines = content.split(/\r?\n/u);
  const output: Array<{ line: number; text: string }> = [];
  let current: { line: number; text: string } | null = null;
  lines.forEach((line, index) => {
    if (/^-\s+\S/u.test(line)) {
      if (current) output.push(current);
      current = { line: index + 1, text: line.replace(/^-\s+/u, "") };
    } else if (current && line.trim() && !/^#/u.test(line)) {
      current.text += ` ${line.trim()}`;
    }
  });
  if (current) output.push(current);
  return output.filter((entry) => !placeholders.some((placeholder) => entry.text.includes(placeholder)) && entry.text !== "none");
}

function bridgeFieldMap(content: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const match of content.matchAll(/^- \*\*([^*]+)\*\*:\s*(.*?)\s*$/gmu)) fields.set(match[1]!, match[2]!);
  return fields;
}

function integerOrNull(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function readActiveRunStates(root: string): RunStateV3[] {
  const loopRoot = resolve(root, ".corgi", "loop");
  if (!existsSync(loopRoot) || !lstatSync(loopRoot).isDirectory()) return [];
  const runs: RunStateV3[] = [];
  for (const entry of readdirSync(loopRoot, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const pointerPath = resolve(loopRoot, entry.name, "current.json");
    if (!existsRegularFile(pointerPath)) continue;
    try {
      const pointer = JSON.parse(readFileSync(pointerPath, "utf8")) as { schemaVersion?: unknown; runId?: unknown };
      if (pointer.schemaVersion !== 3 || typeof pointer.runId !== "string") continue;
      const statePath = resolve(loopRoot, entry.name, "runs", pointer.runId, "state.json");
      if (!existsRegularFile(statePath)) continue;
      const state = JSON.parse(readFileSync(statePath, "utf8")) as unknown;
      assertRunStateV3(state);
      if ((ACTIVE_PHASES_V3 as readonly string[]).includes(state.phase)) runs.push(state);
    } catch {
      continue;
    }
  }
  return runs.sort((left, right) => left.changeName.localeCompare(right.changeName));
}

function authoritativeRunHead(run: RunStateV3): string | null {
  if (run.finalRevision) return run.finalRevision;
  const completed = Object.values(run.groups)
    .filter((group) => group.status === "completed" && group.commitRevision)
    .sort((left, right) => right.ordinal - left.ordinal)[0];
  return completed?.commitRevision ?? run.baselineRevision;
}

function readArchivedSlices(root: string): { slices: ArchivedSlice[]; findings: MemoryLintFinding[] } {
  let rfcRoot = "rfcs";
  try {
    rfcRoot = loadConfigFromDir(root).corgi?.rfcRoot ?? rfcRoot;
  } catch {
    // Structure lint remains useful before configuration exists.
  }
  const directory = resolve(root, rfcRoot);
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) return { slices: [], findings: [] };
  const output: ArchivedSlice[] = [];
  const findings: MemoryLintFinding[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const path = resolve(directory, entry.name, "delivery.yaml");
    if (!existsRegularFile(path)) continue;
    const displayPath = relative(root, path).replace(/\\/gu, "/");
    let loaded: { rfcId?: unknown; slices?: unknown };
    try {
      loaded = yaml.load(readFileSync(path, "utf8")) as { rfcId?: unknown; slices?: unknown };
    } catch (error) {
      findings.push(finding("error", displayPath, "RFC delivery sidecar is invalid YAML.", error instanceof Error ? error.message : String(error), "Repair delivery.yaml from its authoritative CAS history."));
      continue;
    }
    if (!loaded || typeof loaded !== "object" || typeof loaded.rfcId !== "string" || !loaded.slices || typeof loaded.slices !== "object" || Array.isArray(loaded.slices)) {
      findings.push(finding("error", displayPath, "RFC delivery sidecar has an invalid shape.", "Expected rfcId and a Slice mapping.", "Repair delivery.yaml from its authoritative CAS history."));
      continue;
    }
    for (const [slice, value] of Object.entries(loaded.slices as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))) {
      if (!value || typeof value !== "object") continue;
      const item = value as { status?: unknown; binding?: unknown; archive?: unknown };
      if (item.status !== "archived") continue;
      if (!item.binding || typeof item.binding !== "object" || !item.archive || typeof item.archive !== "object") {
        findings.push(finding("error", displayPath, `Archived Slice '${slice}' lacks binding or archive evidence.`, "status=archived requires both mappings.", "Restore the archived Slice CAS record."));
        continue;
      }
      const binding = item.binding as Record<string, unknown>;
      const archive = item.archive as Record<string, unknown>;
      if (typeof binding.change === "string" && typeof archive.commit === "string" && typeof archive.evidenceManifest === "string") {
        output.push({ rfc: loaded.rfcId, slice, change: binding.change, commit: archive.commit, evidenceManifest: archive.evidenceManifest, path: displayPath });
      } else {
        findings.push(finding("error", displayPath, `Archived Slice '${slice}' has incomplete closeout fields.`, "Expected binding.change, archive.commit, and archive.evidenceManifest.", "Restore the archived Slice CAS record."));
      }
    }
  }
  return { slices: output, findings };
}

function findEvidenceManifests(root: string, change: string, digest: string): Array<Record<string, unknown> & { path: string; directory: string }> {
  const archiveRoot = resolve(root, "openspec", "changes", "archive");
  if (!existsSync(archiveRoot) || !lstatSync(archiveRoot).isDirectory()) return [];
  const output: Array<Record<string, unknown> & { path: string; directory: string }> = [];
  for (const entry of readdirSync(archiveRoot, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || (entry.name !== change && !entry.name.endsWith(`-${change}`))) continue;
    const path = resolve(archiveRoot, entry.name, "evidence", "manifest.json");
    if (!existsRegularFile(path)) continue;
    try {
      const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      if (value.changeName === change && value.manifestHash === digest) output.push({ ...value, path: relative(root, path).replace(/\\/gu, "/"), directory: dirname(path) });
    } catch {
      // A malformed candidate cannot establish canonical evidence.
    }
  }
  return output;
}

function archivedAcceptanceIds(root: string, evidenceDirectory: string): string[] {
  const ids = new Set<string>();
  for (const file of walkFiles(evidenceDirectory, root)) {
    if (!file.endsWith(".json")) continue;
    try {
      const content = readFileSync(resolve(root, file), "utf8");
      for (const match of content.matchAll(/"id"\s*:\s*"(AC-\d{3})"/gu)) ids.add(match[1]!);
    } catch {
      // Delivery manifest existence is checked separately.
    }
  }
  return [...ids].sort();
}

function readLegacyHashRecord(root: string): LegacyHashRecord | null {
  const candidates = [
    "wiki/meta/migration-record.json",
    "wiki/meta/migration-record.yaml",
    "wiki/meta/migration-record.yml",
    "openspec/.corgi-migration-record.json",
    "openspec/.corgi-migration-record.yaml",
    "openspec/.corgi-migration-record.yml",
  ];
  for (const path of candidates) {
    if (!existsRegularFile(resolve(root, path))) continue;
    try {
      const raw = path.endsWith(".json")
        ? JSON.parse(readFileSync(resolve(root, path), "utf8")) as unknown
        : yaml.load(readFileSync(resolve(root, path), "utf8"));
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const record = raw as Record<string, unknown>;
      const value = record.legacyHashes ?? record.preservedHashes;
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const hashes: Record<string, string> = {};
      for (const [file, hash] of Object.entries(value as Record<string, unknown>)) {
        if (typeof hash === "string" && HASH_RE.test(hash)) hashes[file.replace(/\\/gu, "/")] = hash;
      }
      return { path, hashes };
    } catch {
      continue;
    }
  }
  return null;
}

function normalizeHash(hash: string): string {
  return hash.replace(/^sha256:/iu, "").toLowerCase();
}

function citedProjectPaths(root: string, text: string): string[] {
  const paths = new Set<string>();
  for (const match of text.matchAll(/`([^`]+)`/gu)) {
    const candidate = match[1]!.trim().replace(/:\d+(?::\d+)?$/u, "").replace(/^\.\//u, "");
    if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$|^[A-Za-z0-9_.-]+\.[A-Za-z0-9]+$/u.test(candidate)) continue;
    if (candidate.startsWith("wiki/deliveries/") || candidate.startsWith("rfcs/") || candidate.startsWith("openspec/changes/archive/")) continue;
    const absolute = resolve(root, candidate);
    const rel = relative(root, absolute);
    if (rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && existsSync(absolute)) paths.add(candidate);
  }
  return [...paths].sort();
}

function hasVerifiedArchitectureEvidence(root: string, text: string): boolean {
  let rfcRoot = "rfcs";
  try {
    rfcRoot = loadConfigFromDir(root).corgi?.rfcRoot ?? rfcRoot;
  } catch {
    // The default RFC root remains authoritative for an otherwise partial project.
  }
  const rfcDirectory = resolve(root, rfcRoot);
  for (const match of text.matchAll(/\b(RFC-\d{4}(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?)/giu)) {
    const reference = match[1]!;
    if (!existsSync(rfcDirectory) || !lstatSync(rfcDirectory).isDirectory()) continue;
    const candidates = readdirSync(rfcDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && (entry.name === reference || entry.name.startsWith(`${reference}-`)))
      .map((entry) => resolve(rfcDirectory, entry.name, "rfc.yaml"));
    for (const path of candidates) {
      if (!existsRegularFile(path)) continue;
      try {
        const metadata = yaml.load(readFileSync(path, "utf8")) as { status?: unknown };
        if (metadata?.status === "accepted") return true;
      } catch {
        // Malformed RFC metadata cannot verify an architecture claim.
      }
    }
  }
  for (const match of text.matchAll(/wiki\/deliveries\/([A-Za-z0-9._-]+)/gu)) {
    const path = resolve(root, "wiki", "deliveries", `${match[1]!.replace(/\.md$/u, "")}.md`);
    if (existsRegularFile(path) && parseFrontmatter(readFileSync(path, "utf8")).data.status === "archived") return true;
  }
  for (const match of text.matchAll(/`((?:openspec\/changes\/archive|[^`\s]*evidence\/manifest\.json)[^`]*)`/gu)) {
    const candidate = match[1]!.replace(/:\d+(?::\d+)?$/u, "");
    if (existsSync(resolve(root, candidate))) return true;
  }
  return false;
}
