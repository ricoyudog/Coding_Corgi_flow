import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type ProposeIntentStage =
  | "prepared"
  | "issue_created"
  | "change_created"
  | "source_written"
  | "tracker_sync_pending"
  | "complete";

export interface ProposeIntent {
  schemaVersion: 1;
  operation: "propose";
  key: string;
  deliveryRef: string;
  changeName: string;
  headRevision: string;
  stage: ProposeIntentStage;
  issue?: { id: string; url: string };
  changeRoot?: string;
  sourceDigest?: string;
  updatedAt: string;
}

export class WorkflowIntentError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "WorkflowIntentError";
  }
}

export interface WorkflowLock {
  path: string;
  resource: string;
  token: string;
}

/**
 * Filesystem lock shared by independent CLI processes. `mkdir` is the atomic
 * primitive; the owner token prevents a late finally block from deleting a
 * replacement lock.
 */
export function acquireWorkflowLock(projectDir: string, resource: string): WorkflowLock {
  const normalized = resource.trim();
  if (!normalized) {
    throw new WorkflowIntentError("Workflow lock resource must not be empty", "WORKFLOW_LOCK_INVALID");
  }
  const key = createHash("sha256").update(normalized, "utf8").digest("hex");
  const root = workflowLockRoot(projectDir);
  const path = resolve(root, `${key}.lock`);
  const token = randomUUID();
  mkdirSync(root, { recursive: true });
  try {
    mkdirSync(path);
  } catch (error) {
    if (isFileSystemCode(error, "EEXIST")) {
      throw new WorkflowIntentError(
        `Workflow resource '${normalized}' is already locked by another process`,
        "WORKFLOW_LOCKED",
      );
    }
    throw error;
  }
  try {
    writeFileSync(
      resolve(path, "owner.json"),
      `${JSON.stringify({ schemaVersion: 1, resource: normalized, token, pid: process.pid })}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  } catch (error) {
    rmSync(path, { recursive: true, force: true });
    throw error;
  }
  return { path, resource: normalized, token };
}

function workflowLockRoot(projectDir: string): string {
  const commonDir = spawnSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 5_000,
  });
  if (!commonDir.error && commonDir.status === 0 && commonDir.stdout.trim()) {
    return resolve(projectDir, commonDir.stdout.trim(), "corgispec-locks");
  }
  return resolve(projectDir, ".corgi/locks");
}

export function releaseWorkflowLock(lock: WorkflowLock): void {
  try {
    const owner = JSON.parse(readFileSync(resolve(lock.path, "owner.json"), "utf8")) as {
      token?: unknown;
    };
    if (owner.token === lock.token) rmSync(lock.path, { recursive: true, force: true });
  } catch {
    // Fail closed: an unverifiable lock must never be deleted by this process.
  }
}

export function proposeIntentPath(projectDir: string, key: string): string {
  if (!/^[a-f0-9]{64}$/.test(key)) {
    throw new WorkflowIntentError("Propose intent key must be a sha256 hex digest", "INTENT_INVALID_KEY");
  }
  return resolve(projectDir, ".corgi/transactions/propose", `${key}.json`);
}

export function loadProposeIntent(projectDir: string, key: string): ProposeIntent | null {
  const path = proposeIntentPath(projectDir, key);
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    validateIntent(value);
    return value;
  } catch (error) {
    if (isFileSystemCode(error, "ENOENT")) return null;
    if (error instanceof WorkflowIntentError) throw error;
    throw new WorkflowIntentError(
      `Could not read propose intent '${path}': ${error instanceof Error ? error.message : String(error)}`,
      "INTENT_CORRUPT",
    );
  }
}

export function writeProposeIntent(projectDir: string, intent: ProposeIntent): void {
  validateIntent(intent);
  const path = proposeIntentPath(projectDir, intent.key);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(intent, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function advanceProposeIntent(
  projectDir: string,
  current: ProposeIntent,
  patch: Partial<Omit<ProposeIntent, "schemaVersion" | "operation" | "key" | "deliveryRef" | "changeName">>,
): ProposeIntent {
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  writeProposeIntent(projectDir, next);
  return next;
}

function validateIntent(value: unknown): asserts value is ProposeIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("must be an object");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || record.operation !== "propose") throw invalid("has unsupported schema");
  for (const field of ["key", "deliveryRef", "changeName", "headRevision", "stage", "updatedAt"] as const) {
    if (typeof record[field] !== "string" || !record[field]) throw invalid(`missing ${field}`);
  }
  if (!(["prepared", "issue_created", "change_created", "source_written", "tracker_sync_pending", "complete"] as unknown[])
    .includes(record.stage)) throw invalid("has invalid stage");
}

function invalid(message: string): WorkflowIntentError {
  return new WorkflowIntentError(`Propose intent ${message}`, "INTENT_CORRUPT");
}

function isFileSystemCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
