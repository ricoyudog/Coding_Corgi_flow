import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import {
  loadChangeContract,
  type LoadedChangeContract,
} from "./change-contract.js";
import { createOpenSpecAdapter } from "./openspec-adapter.js";
import {
  archiveRfcSliceCas,
  loadRfc,
  loadRfcDelivery,
} from "./rfc.js";
import type { ArtifactHashV3, RunStateV3 } from "./run-contract-v3.js";

export interface LocalArchiveCloseoutV3 {
  archivedRoot: string;
  evidenceManifestHash: ArtifactHashV3;
  deliveryPage: string;
  deliveryRevision: number | null;
  closeoutCommit: string;
}

export interface ArchiveCloseoutV3Dependencies {
  archiveChange?: (
    projectRoot: string,
    changeName: string,
    store?: string,
  ) => Promise<{ path: string }>;
  git?: (projectRoot: string, args: string[], allowFailure?: boolean) => string;
}

export class ArchiveCloseoutV3Error extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "ArchiveCloseoutV3Error";
  }
}

interface ArchiveCloseoutJournalV3 {
  schemaVersion: 3;
  intentId: string;
  finalRevision: string;
  activeChangeDigest: string;
  stage: "pending" | "archived";
  archivedRoot?: string;
  archivedDigest?: string;
  specsDigest?: string;
}

export interface SealedArchiveCheckpointV3 {
  archivedRoot: string;
  archivedDigest: string;
  specsDigest: string;
}

/**
 * Re-validate the durable boundary created immediately after OpenSpec moves a
 * Change.  Tracker closeout and run finalization both call this so a later
 * commit cannot replace archived planning/spec bytes after local closeout.
 */
export function verifySealedArchiveCheckpointV3(
  projectRoot: string,
  state: RunStateV3,
): SealedArchiveCheckpointV3 {
  const root = resolve(projectRoot);
  if (state.phase !== "archiving" || !state.archive) {
    throw new ArchiveCloseoutV3Error("Archive intent is not active", "ARCHIVE_NOT_STARTED");
  }
  const path = archiveJournalPath(root, state);
  if (!existsSync(path)) {
    throw new ArchiveCloseoutV3Error(
      "Archived Change exists without its durable Archive digest intent",
      "ARCHIVE_JOURNAL_MISSING",
    );
  }
  const journal = loadArchiveJournal(path, state);
  if (
    journal.stage !== "archived"
    || !journal.archivedRoot
    || !journal.archivedDigest
    || !journal.specsDigest
  ) {
    throw new ArchiveCloseoutV3Error(
      "Archive digest checkpoint has not been sealed",
      "ARCHIVE_JOURNAL_PENDING",
    );
  }
  const archivedRoot = resolve(journal.archivedRoot);
  if (!existsSync(archivedRoot)) {
    throw new ArchiveCloseoutV3Error("OpenSpec archive target is missing", "ARCHIVE_TARGET_MISSING");
  }
  const activeSource = resolve(root, state.contract.sourcePath);
  const activeChangeRoot = dirname(dirname(activeSource));
  const archivedDigest = directoryDigest(archivedRoot);
  const specsDigest = directoryDigest(resolve(dirname(dirname(activeChangeRoot)), "specs"));
  if (journal.archivedDigest !== archivedDigest || journal.specsDigest !== specsDigest) {
    throw new ArchiveCloseoutV3Error(
      "Archived Change or canonical specs drifted after the durable Archive checkpoint",
      "ARCHIVE_DIGEST_CHANGED",
    );
  }
  const archived = loadChangeContract(archivedRoot, { required: true })!;
  assertContractBinding(archived, state);
  if (state.archive.evidenceManifestHash) {
    assertChangeEvidence(archivedRoot, state, state.archive.evidenceManifestHash);
  }
  return { archivedRoot, archivedDigest, specsDigest };
}

export async function performLocalArchiveCloseoutV3(input: {
  projectRoot: string;
  changeName: string;
  state: RunStateV3;
  evidenceManifestHash: ArtifactHashV3;
  store?: string;
}, dependencies: ArchiveCloseoutV3Dependencies = {}): Promise<LocalArchiveCloseoutV3> {
  const root = resolve(input.projectRoot);
  if (input.state.phase !== "archiving" || !input.state.archive) {
    throw new ArchiveCloseoutV3Error("Archive intent is not active", "ARCHIVE_NOT_STARTED");
  }
  const runGit = dependencies.git ?? git;
  const head = runGit(root, ["rev-parse", "HEAD"]);
  const closeoutMessage = `chore(corgi): archive ${input.state.contract.deliveryRef}`;
  const recoveredCloseout = head !== input.state.finalRevision
    && runGit(root, ["rev-parse", `${head}^`], true) === input.state.finalRevision
    && runGit(root, ["log", "-1", "--format=%s", head], true) === closeoutMessage;
  if (head !== input.state.finalRevision && !recoveredCloseout) {
    throw new ArchiveCloseoutV3Error(
      "Local Archive must start directly from the verified final revision",
      "ARCHIVE_FINAL_REVISION_CHANGED",
    );
  }
  const activeSource = resolve(root, input.state.contract.sourcePath);
  const activeChangeRoot = dirname(dirname(activeSource));
  let archivedRoot = findArchivedRoot(root, activeChangeRoot, input.changeName, input.state);
  if (!archivedRoot) {
    if (!existsSync(activeSource)) {
      throw new ArchiveCloseoutV3Error(
        "Neither the active Change nor a unique matching archived Change exists",
        "ARCHIVE_CHANGE_NOT_FOUND",
      );
    }
    const active = loadChangeContract(activeChangeRoot, { required: true })!;
    assertContractBinding(active, input.state);
    assertChangeEvidence(activeChangeRoot, input.state, input.evidenceManifestHash);
    beginArchiveJournal(root, input.state, activeChangeRoot);
    const archiveChange = dependencies.archiveChange ?? (async (projectRoot, changeName, store) => {
      const response = await createOpenSpecAdapter(projectRoot).archiveChange(changeName, { store });
      return { path: response.archive.path };
    });
    const result = await archiveChange(root, input.changeName, input.store);
    archivedRoot = resolve(result.path);
  }

  if (!existsSync(archivedRoot)) {
    throw new ArchiveCloseoutV3Error("OpenSpec reported a missing archive target", "ARCHIVE_TARGET_MISSING");
  }
  const archived = loadChangeContract(archivedRoot, { required: true })!;
  assertContractBinding(archived, input.state);
  assertChangeEvidence(archivedRoot, input.state, input.evidenceManifestHash);
  const duplicate = findArchivedCandidates(activeChangeRoot, input.changeName, input.state);
  if (duplicate.length !== 1 || resolve(duplicate[0]!) !== archivedRoot) {
    throw new ArchiveCloseoutV3Error(
      `Archive target is not unique for '${input.changeName}'`,
      "ARCHIVE_TARGET_AMBIGUOUS",
    );
  }
  sealAndVerifyArchiveJournal(root, input.state, activeChangeRoot, archivedRoot);

  const deliveryRevision = closeRfcDelivery(
    root,
    archived,
    input.state,
    input.evidenceManifestHash,
  );
  const deliveryPage = writeDeliveryKnowledge(root, archivedRoot, archived, input.state, input.evidenceManifestHash);
  updateSessionBridge(root, input.state, deliveryPage, archived);
  const closeoutCommit = commitArchiveCloseout({
    projectRoot: root,
    activeChangeRoot,
    archivedRoot,
    contract: archived,
    state: input.state,
    deliveryPage,
    git: runGit,
  });
  return {
    archivedRoot,
    evidenceManifestHash: input.evidenceManifestHash,
    deliveryPage,
    deliveryRevision,
    closeoutCommit,
  };
}

function beginArchiveJournal(
  projectRoot: string,
  state: RunStateV3,
  activeChangeRoot: string,
): void {
  const path = archiveJournalPath(projectRoot, state);
  const activeChangeDigest = directoryDigest(activeChangeRoot);
  if (existsSync(path)) {
    const journal = loadArchiveJournal(path, state);
    if (journal.activeChangeDigest !== activeChangeDigest) {
      throw new ArchiveCloseoutV3Error(
        "Active Change differs from the durable Archive intent",
        "ARCHIVE_DIGEST_CHANGED",
      );
    }
    return;
  }
  writeArchiveJournal(path, {
    schemaVersion: 3,
    intentId: state.archive!.intentId,
    finalRevision: state.finalRevision!,
    activeChangeDigest,
    stage: "pending",
  });
}

function sealAndVerifyArchiveJournal(
  projectRoot: string,
  state: RunStateV3,
  activeChangeRoot: string,
  archivedRoot: string,
): void {
  const path = archiveJournalPath(projectRoot, state);
  if (!existsSync(path)) {
    throw new ArchiveCloseoutV3Error(
      "Archived Change exists without its durable Archive digest intent",
      "ARCHIVE_JOURNAL_MISSING",
    );
  }
  const journal = loadArchiveJournal(path, state);
  const archivedDigest = directoryDigest(archivedRoot);
  const specsDigest = directoryDigest(resolve(dirname(dirname(activeChangeRoot)), "specs"));
  if (journal.stage === "pending") {
    if (journal.activeChangeDigest !== archivedDigest) {
      throw new ArchiveCloseoutV3Error(
        "OpenSpec archive target differs from the verified active Change",
        "ARCHIVE_DIGEST_CHANGED",
      );
    }
    writeArchiveJournal(path, {
      ...journal,
      stage: "archived",
      archivedRoot,
      archivedDigest,
      specsDigest,
    });
    return;
  }
  if (
    resolve(journal.archivedRoot ?? "") !== resolve(archivedRoot)
    || journal.archivedDigest !== archivedDigest
    || journal.specsDigest !== specsDigest
  ) {
    throw new ArchiveCloseoutV3Error(
      "Archived Change or canonical specs drifted after the durable Archive checkpoint",
      "ARCHIVE_DIGEST_CHANGED",
    );
  }
  verifySealedArchiveCheckpointV3(projectRoot, state);
}

function archiveJournalPath(projectRoot: string, state: RunStateV3): string {
  const key = createHash("sha256").update(state.archive!.intentId, "utf8").digest("hex");
  return resolve(
    projectRoot,
    ".corgi",
    "loop",
    state.changeName,
    "archive-closeout",
    `${key}.json`,
  );
}

function loadArchiveJournal(path: string, state: RunStateV3): ArchiveCloseoutJournalV3 {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ArchiveCloseoutV3Error(
      `Archive digest journal is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      "ARCHIVE_JOURNAL_INVALID",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ArchiveCloseoutV3Error("Archive digest journal is invalid", "ARCHIVE_JOURNAL_INVALID");
  }
  const journal = value as ArchiveCloseoutJournalV3;
  if (
    journal.schemaVersion !== 3
    || journal.intentId !== state.archive!.intentId
    || journal.finalRevision !== state.finalRevision
    || !["pending", "archived"].includes(journal.stage)
    || !/^sha256:[a-f0-9]{64}$/u.test(journal.activeChangeDigest)
  ) {
    throw new ArchiveCloseoutV3Error("Archive digest journal binding is invalid", "ARCHIVE_JOURNAL_INVALID");
  }
  return journal;
}

function writeArchiveJournal(path: string, journal: ArchiveCloseoutJournalV3): void {
  mkdirSync(dirname(path), { recursive: true });
  atomicWrite(path, `${JSON.stringify(journal, null, 2)}\n`);
}

function directoryDigest(root: string): string {
  const hash = createHash("sha256");
  hash.update("corgispec-archive-tree-v1\0");
  if (!existsSync(root)) {
    hash.update("absent\0");
    return `sha256:${hash.digest("hex")}`;
  }
  const visit = (directory: string, prefix: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        throw new ArchiveCloseoutV3Error(
          `Archive digest refuses symbolic link '${relativePath}'`,
          "ARCHIVE_DIGEST_UNSAFE",
        );
      }
      if (stat.isDirectory()) {
        hash.update(`D\0${relativePath}\0`);
        visit(path, relativePath);
      } else if (stat.isFile()) {
        const content = readFileSync(path);
        hash.update(`F\0${relativePath}\0${String(content.byteLength)}\0`);
        hash.update(content);
      } else {
        throw new ArchiveCloseoutV3Error(
          `Archive digest refuses non-regular entry '${relativePath}'`,
          "ARCHIVE_DIGEST_UNSAFE",
        );
      }
    }
  };
  visit(root, "");
  return `sha256:${hash.digest("hex")}`;
}

function findArchivedRoot(
  projectRoot: string,
  activeChangeRoot: string,
  changeName: string,
  state: RunStateV3,
): string | null {
  const candidates = findArchivedCandidates(activeChangeRoot, changeName, state);
  if (candidates.length > 1) {
    throw new ArchiveCloseoutV3Error(
      `Multiple archived Changes match '${changeName}' and the Run Contract digests`,
      "ARCHIVE_TARGET_AMBIGUOUS",
    );
  }
  if (candidates.length === 0) return null;
  const candidate = resolve(candidates[0]!);
  const rel = relative(projectRoot, candidate);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    // External OpenSpec stores are supported; containment is established by
    // the exact source/traceability digests rather than the repository path.
    return candidate;
  }
  return candidate;
}

function findArchivedCandidates(
  activeChangeRoot: string,
  changeName: string,
  state: RunStateV3,
): string[] {
  const archiveRoot = resolve(dirname(activeChangeRoot), "archive");
  if (!existsSync(archiveRoot)) return [];
  return readdirSync(archiveRoot, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || (entry.name !== changeName && !entry.name.endsWith(`-${changeName}`))) return [];
    const candidate = resolve(archiveRoot, entry.name);
    try {
      const contract = loadChangeContract(candidate, { required: true })!;
      assertContractBinding(contract, state);
      return [candidate];
    } catch {
      return [];
    }
  });
}

function assertContractBinding(contract: LoadedChangeContract, state: RunStateV3): void {
  if (
    contract.source.deliveryRef !== state.contract.deliveryRef
    || contract.sourceDigest !== state.contract.sourceDigest
    || contract.traceabilityDigest !== state.contract.traceabilityDigest
  ) {
    throw new ArchiveCloseoutV3Error(
      "Archived Change contract does not match the Run Contract",
      "ARCHIVE_CONTRACT_CHANGED",
    );
  }
}

function assertChangeEvidence(
  changeRoot: string,
  state: RunStateV3,
  evidenceManifestHash: ArtifactHashV3,
): void {
  const path = resolve(changeRoot, "evidence", "manifest.json");
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    throw new ArchiveCloseoutV3Error(
      `Canonical Change evidence is missing or invalid: ${error instanceof Error ? error.message : String(error)}`,
      "ARCHIVE_EVIDENCE_MISSING",
    );
  }
  if (
    manifest.manifestHash !== evidenceManifestHash
    || manifest.changeName !== state.changeName
    || manifest.runId !== state.runId
    || manifest.finalRevision !== state.finalRevision
    || manifest.planningRevision !== state.planningRevision
    || manifest.sourceDigest !== state.contract.sourceDigest
    || manifest.traceabilityDigest !== state.contract.traceabilityDigest
  ) {
    throw new ArchiveCloseoutV3Error(
      "Canonical Change evidence does not match the Run Contract",
      "ARCHIVE_EVIDENCE_CHANGED",
    );
  }
}

function closeRfcDelivery(
  projectRoot: string,
  contract: LoadedChangeContract,
  state: RunStateV3,
  evidenceManifestHash: ArtifactHashV3,
): number | null {
  if (contract.source.kind === "maintenance") return null;
  const delivery = loadRfcDelivery(projectRoot, contract.source.rfc.id);
  const slice = delivery.slices[contract.source.slice.id];
  if (
    !slice?.binding
    || slice.binding.change !== state.changeName
    || slice.binding.sourceDigest !== state.contract.sourceDigest
  ) {
    throw new ArchiveCloseoutV3Error(
      "RFC delivery binding no longer matches the archived Change",
      "ARCHIVE_DELIVERY_CHANGED",
    );
  }
  const result = archiveRfcSliceCas({
    projectDir: projectRoot,
    rfcId: contract.source.rfc.id,
    sliceId: contract.source.slice.id,
    expectedRevision: delivery.revision,
    evidence: {
      archivedAt: state.archive!.startedAt,
      commit: state.finalRevision!,
      evidenceManifest: evidenceManifestHash,
    },
  });
  return result.delivery.revision;
}

function writeDeliveryKnowledge(
  projectRoot: string,
  archivedRoot: string,
  contract: LoadedChangeContract,
  state: RunStateV3,
  evidenceManifestHash: ArtifactHashV3,
): string {
  const date = state.archive!.startedAt.slice(0, 10);
  const rfc = contract.source.kind === "rfc-slice"
    ? loadRfc(projectRoot, contract.source.rfc.id)
    : null;
  const filename = contract.source.kind === "rfc-slice"
    ? `${contract.source.rfc.id}-${contract.source.slice.id}.md`
    : `maintenance-${state.changeName}.md`;
  const deliveryPage = resolve(projectRoot, "wiki", "deliveries", filename);
  const verify = new Map(state.verify!.acceptance.map((entry) => [entry.id, entry]));
  const qa = new Map((state.qa!.acceptance ?? []).map((entry) => [entry.id, entry]));
  const acceptanceRows = contract.source.acceptance.map((criterion) => {
    const automated = verify.get(criterion.id);
    const human = qa.get(criterion.id);
    const refs = [...new Set([...(automated?.evidenceRefs ?? []), ...(human?.evidenceRefs ?? [])])];
    const result = automated?.automated === "fail" || human?.human === "fail" ? "FAIL" : "PASS";
    return `| ${criterion.id} | ${criterion.evidence} | ${refs.join("; ") || "canonical evidence manifest"} | ${result} |`;
  });
  const commits = Object.values(state.groups)
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((group) => `- Task Group ${group.id}: \`${group.commitRevision}\``);
  const goal = rfc ? markdownSection(rfc.document, "Goal") : contract.source.kind === "maintenance"
    ? contract.source.maintenance.description
    : state.changeName;
  const boundary = rfc ? markdownSection(rfc.document, "Boundary") : contract.source.kind === "maintenance"
    ? contract.source.maintenance.boundary
    : "See archived Change.";
  const page = [
    "---",
    "type: delivery",
    `updated: ${date}`,
    ...(contract.source.kind === "rfc-slice" ? [
      `rfc: ${contract.source.rfc.id}`,
      `slice: ${contract.source.slice.id}`,
    ] : ["rfc: maintenance", "slice: maintenance"]),
    `change: ${state.changeName}`,
    "status: archived",
    `archived: ${date}`,
    `evidence_manifest: ${evidenceManifestHash}`,
    `source_digest: ${state.contract.sourceDigest}`,
    "---",
    "",
    `# ${contract.source.deliveryRef}`,
    "",
    "## Outcome",
    goal,
    "",
    "## Boundary Delivered",
    boundary,
    "",
    "## Acceptance Evidence",
    "| AC | Requirement | Evidence | Result |",
    "|---|---|---|---|",
    ...acceptanceRows,
    "",
    "## Implementation",
    ...commits,
    `- Final HEAD: \`${state.finalRevision}\``,
    "",
    "## Review and QA",
    `- Human Review: ${state.review!.decision} by ${state.review!.reviewer}`,
    `- Human QA: ${state.qa!.verdict} by ${state.qa!.reviewer}${state.qa!.reason ? ` — ${state.qa!.reason}` : ""}`,
    "",
    "## Knowledge Promoted",
    "- Registered this verified delivery as provenance in Architecture, Patterns, and permanent Memory indexes.",
    "- No architectural claim, reusable pattern, or pitfall was inferred without explicit evidence.",
    "",
    "## Sources",
    ...(rfc ? [`- \`${relative(projectRoot, rfc.directory).replace(/\\/gu, "/")}\``] : []),
    `- \`${relative(projectRoot, archivedRoot).replace(/\\/gu, "/")}\``,
    `- \`${relative(projectRoot, resolve(archivedRoot, "evidence", "manifest.json")).replace(/\\/gu, "/")}\``,
    ...(contract.source.tracker.issue ? [`- ${contract.source.tracker.issue.url}`] : []),
    "",
  ].join("\n");
  writeImmutable(deliveryPage, page, "ARCHIVE_DELIVERY_PAGE_CONFLICT");

  const link = `- [[wiki/deliveries/${filename.replace(/\.md$/u, "")}|${contract.source.deliveryRef}]]`;
  updateManagedList(resolve(projectRoot, "wiki", "deliveries", "_index.md"), "deliveries", (items) =>
    [...new Set([...items.filter((item) => item !== "- none"), link])].sort()
  );
  updateManagedList(resolve(projectRoot, "wiki", "hot.md"), "active-deliveries", (items) => {
    const remaining = items.filter((item) => item !== "- none" && !item.includes(contract.source.deliveryRef));
    return remaining.length > 0 ? remaining : ["- none"];
  });
  updateManagedList(resolve(projectRoot, "wiki", "hot.md"), "recently-shipped", (items) =>
    [...new Set([...items.filter((item) => item !== "- none"), link])]
  );
  updateManagedList(resolve(projectRoot, "wiki", "architecture", "_index.md"), "architecture-deliveries", (items) =>
    [...new Set([...items.filter((item) => item !== "- none"), link])].sort()
  );
  updateManagedList(resolve(projectRoot, "wiki", "patterns", "_index.md"), "pattern-deliveries", (items) =>
    [...new Set([...items.filter((item) => item !== "- none"), link])].sort()
  );
  updateManagedList(resolve(projectRoot, "memory", "MEMORY.md"), "verified-deliveries", (items) =>
    [...new Set([...items.filter((item) => item !== "- none"), `${link} — verified by ${evidenceManifestHash}`])].sort()
  );
  return deliveryPage;
}

function updateSessionBridge(
  projectRoot: string,
  state: RunStateV3,
  deliveryPage: string,
  contract: LoadedChangeContract,
): void {
  const path = resolve(projectRoot, "memory", "session-bridge.md");
  let content = readFileSync(path, "utf8");
  const issue = contract.source.tracker.issue;
  const replacements: Record<string, string> = {
    RFC: contract.source.kind === "rfc-slice" ? contract.source.rfc.id : "maintenance",
    "RFC Revision": contract.source.kind === "rfc-slice" ? contract.source.rfc.acceptedCommit : "rfc-exempt",
    Slice: contract.source.kind === "rfc-slice" ? contract.source.slice.id : "maintenance",
    Issue: issue ? `${issue.id} ${issue.url}` : "none",
    Change: state.changeName,
    Worktree: projectRoot,
    "Phase at Checkpoint": "archiving",
    "Task Group at Checkpoint": "none",
    "Observed Run Revision": String(state.stateRevision + 1),
    "Last Verified HEAD": state.finalRevision!,
  };
  for (const [field, value] of Object.entries(replacements)) {
    const pattern = new RegExp(`^- \\*\\*${escapeRegExp(field)}\\*\\*:.*$`, "mu");
    if (!pattern.test(content)) {
      throw new ArchiveCloseoutV3Error(`Session Bridge is missing '${field}'`, "ARCHIVE_BRIDGE_INVALID");
    }
    content = content.replace(pattern, `- **${field}**: ${value}`);
  }
  const page = relative(projectRoot, deliveryPage).replace(/\\/gu, "/");
  content = content.replace(
    /^(## Next Action\s*\n)(?:- .*\n)?/mu,
    `$1- Consult Run Contract v3: resume tracker closeout for \`${state.changeName}\` only if pending; otherwise select the next accepted Slice. Local delivery: \`${page}\`.\n`,
  );
  atomicWrite(path, content);
}

function commitArchiveCloseout(input: {
  projectRoot: string;
  activeChangeRoot: string;
  archivedRoot: string;
  contract: LoadedChangeContract;
  state: RunStateV3;
  deliveryPage: string;
  git?: ArchiveCloseoutV3Dependencies["git"];
}): string {
  const runGit = input.git ?? git;
  const openSpecRoot = dirname(dirname(input.activeChangeRoot));
  const allowed = [
    input.activeChangeRoot,
    input.archivedRoot,
    resolve(openSpecRoot, "specs"),
    input.deliveryPage,
    resolve(input.projectRoot, "wiki", "deliveries", "_index.md"),
    resolve(input.projectRoot, "wiki", "hot.md"),
    resolve(input.projectRoot, "wiki", "architecture", "_index.md"),
    resolve(input.projectRoot, "wiki", "patterns", "_index.md"),
    resolve(input.projectRoot, "memory", "MEMORY.md"),
    resolve(input.projectRoot, "memory", "session-bridge.md"),
    ...(input.contract.source.kind === "rfc-slice"
      ? [resolve(input.projectRoot, input.contract.source.rfc.path, "delivery.yaml")]
      : []),
  ];
  const allowedRelative = allowed.flatMap((path) => {
    const rel = relative(input.projectRoot, path).replace(/\\/gu, "/");
    return rel && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel) ? [rel] : [];
  });
  const dirty = gitDirtyPaths(input.projectRoot, runGit);
  const rejected = dirty.filter((path) => !allowedRelative.some((allowedPath) =>
    path === allowedPath || path.startsWith(`${allowedPath}/`)
  ));
  if (rejected.length > 0) {
    throw new ArchiveCloseoutV3Error(
      `Archive closeout found unrelated dirty paths: ${rejected.join(", ")}`,
      "ARCHIVE_CLOSEOUT_MIXED_DIRTY",
    );
  }

  const message = `chore(corgi): archive ${input.state.contract.deliveryRef}`;
  if (dirty.length > 0) {
    runGit(input.projectRoot, ["add", "-A", "--", ...dirty]);
    runGit(input.projectRoot, ["commit", "-m", message]);
  }
  const commit = runGit(input.projectRoot, ["log", "-n", "1", "--format=%H", "--grep", `^${message}$`]);
  if (!commit) {
    throw new ArchiveCloseoutV3Error("Archive closeout commit was not created", "ARCHIVE_CLOSEOUT_COMMIT_MISSING");
  }
  const head = runGit(input.projectRoot, ["rev-parse", "HEAD"]);
  if (head !== commit || gitDirtyPaths(input.projectRoot, runGit).length > 0) {
    throw new ArchiveCloseoutV3Error(
      "Archive closeout must be the clean worktree HEAD",
      "ARCHIVE_CLOSEOUT_COMMIT_CHANGED",
    );
  }
  const parents = runGit(input.projectRoot, ["rev-list", "--parents", "-n", "1", commit])
    .trim().split(/\s+/u).slice(1);
  if (parents.length !== 1 || parents[0] !== input.state.finalRevision) {
    throw new ArchiveCloseoutV3Error(
      "Archive closeout commit is not a direct child of the verified final revision",
      "ARCHIVE_CLOSEOUT_PARENT_CHANGED",
    );
  }
  const committedPaths = runGit(input.projectRoot, [
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    "-z",
    commit,
  ]).split("\0").filter(Boolean);
  const committedRejected = committedPaths.filter((path) => !allowedRelative.some((allowedPath) =>
    path === allowedPath || path.startsWith(`${allowedPath}/`)
  ));
  if (committedRejected.length > 0) {
    throw new ArchiveCloseoutV3Error(
      `Archive closeout commit contains unrelated paths: ${committedRejected.join(", ")}`,
      "ARCHIVE_CLOSEOUT_MIXED_COMMIT",
    );
  }
  return commit;
}

function gitDirtyPaths(
  projectRoot: string,
  runGit: NonNullable<ArchiveCloseoutV3Dependencies["git"]>,
): string[] {
  const outputs = [
    runGit(projectRoot, ["diff", "--name-only", "-z"]),
    runGit(projectRoot, ["diff", "--cached", "--name-only", "-z"]),
    runGit(projectRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ];
  return [...new Set(outputs.flatMap((output) => output.split("\0").filter(Boolean)))]
    .filter((path) => path !== ".corgi" && !path.startsWith(".corgi/"))
    .sort();
}

function updateManagedList(
  path: string,
  region: string,
  update: (items: string[]) => string[],
): void {
  const content = readFileSync(path, "utf8");
  const start = `<!-- corgi:managed:start ${region} -->`;
  const end = `<!-- corgi:managed:end ${region} -->`;
  const starts = indexesOf(content, start);
  const ends = indexesOf(content, end);
  if (starts.length !== 1 || ends.length !== 1 || starts[0]! >= ends[0]!) {
    throw new ArchiveCloseoutV3Error(
      `Managed Wiki region '${region}' is missing or ambiguous in '${path}'`,
      "ARCHIVE_WIKI_REGION_INVALID",
    );
  }
  const bodyStart = starts[0]! + start.length;
  const current = content.slice(bodyStart, ends[0]!).trim().split("\n").filter(Boolean);
  const next = update(current);
  atomicWrite(path, `${content.slice(0, bodyStart)}\n${next.join("\n")}\n${content.slice(ends[0]!)}`);
}

function markdownSection(markdown: string, name: string): string {
  const escaped = escapeRegExp(name);
  const match = markdown.match(new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "imu"));
  return match?.[1]?.trim() || `See accepted RFC section '${name}'.`;
}

function writeImmutable(path: string, content: string, code: string): void {
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") === content) return;
    throw new ArchiveCloseoutV3Error(`Immutable archive output conflicts at '${path}'`, code);
  }
  atomicWrite(path, content);
}

function atomicWrite(path: string, content: string): void {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function indexesOf(content: string, needle: string): number[] {
  const result: number[] = [];
  let offset = content.indexOf(needle);
  while (offset >= 0) {
    result.push(offset);
    offset = content.indexOf(needle, offset + needle.length);
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function git(projectRoot: string, args: string[], allowFailure = false): string {
  const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8" });
  if (result.status !== 0) {
    if (allowFailure) return "";
    throw new ArchiveCloseoutV3Error(
      result.stderr.trim() || `git ${args[0] ?? "command"} failed`,
      "ARCHIVE_GIT_FAILED",
    );
  }
  return result.stdout.trimEnd();
}
