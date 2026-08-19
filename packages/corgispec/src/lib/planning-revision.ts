import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { OpenSpecArtifactPath } from "./openspec-adapter.js";

const REVISION_FORMAT = "corgispec-planning-revision-v1";

export interface PlanningRevisionInput {
  changeRoot: string;
  schemaName: string;
  artifactPaths: Record<string, OpenSpecArtifactPath>;
  /** Provider-neutral Corgi contract files that participate in plan freshness. */
  contractPaths?: string[];
}

export interface PlanningRevisionFileReader {
  read(filePath: string): Promise<Uint8Array>;
}

export type PlanningRevisionErrorCode = "path_outside_change" | "file_read_failed";

export class PlanningRevisionError extends Error {
  constructor(
    message: string,
    public readonly code: PlanningRevisionErrorCode,
    public readonly filePath: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "PlanningRevisionError";
  }
}

const defaultReader: PlanningRevisionFileReader = {
  async read(filePath: string): Promise<Uint8Array> {
    return await readFile(filePath);
  },
};

/**
 * Hash the upstream artifact manifest and every concrete artifact file. Paths
 * are relative to changeRoot and normalized to `/`, so the same planning
 * state has the same revision on Windows, macOS, and Linux.
 */
export async function computePlanningRevision(
  input: PlanningRevisionInput,
  reader: PlanningRevisionFileReader = defaultReader
): Promise<string> {
  const hash = createHash("sha256");
  appendField(hash, REVISION_FORMAT);
  appendField(hash, input.schemaName);

  for (const artifactId of Object.keys(input.artifactPaths).sort(compareCodeUnits)) {
    const artifact = input.artifactPaths[artifactId]!;
    appendField(hash, "artifact");
    appendField(hash, artifactId);
    appendField(hash, normalizePortablePath(artifact.outputPath));

    const concretePaths = [...new Set(artifact.existingOutputPaths)].sort((left, right) =>
      compareCodeUnits(normalizePortablePath(left), normalizePortablePath(right))
    );
    appendField(hash, String(concretePaths.length));

    for (const filePath of concretePaths) {
      if (!isPathInside(input.changeRoot, filePath)) {
        throw new PlanningRevisionError(
          `Artifact path is outside change root: ${filePath}`,
          "path_outside_change",
          filePath
        );
      }

      const relativePath = relativePortablePath(input.changeRoot, filePath);
      let content: Uint8Array;
      try {
        content = await reader.read(filePath);
      } catch (error) {
        throw new PlanningRevisionError(
          `Failed to read planning artifact '${filePath}': ${
            error instanceof Error ? error.message : String(error)
          }`,
          "file_read_failed",
          filePath,
          error
        );
      }

      appendField(hash, artifactId);
      appendField(hash, relativePath);
      appendBytes(hash, content);
    }
  }

  const contractPaths = [...new Set(input.contractPaths ?? [])].sort((left, right) =>
    compareCodeUnits(normalizePortablePath(left), normalizePortablePath(right))
  );
  appendField(hash, "contract-files");
  appendField(hash, String(contractPaths.length));
  for (const filePath of contractPaths) {
    if (!isPathInside(input.changeRoot, filePath)) {
      throw new PlanningRevisionError(
        `Contract path is outside change root: ${filePath}`,
        "path_outside_change",
        filePath
      );
    }
    let content: Uint8Array;
    try {
      content = await reader.read(filePath);
    } catch (error) {
      throw new PlanningRevisionError(
        `Failed to read change contract '${filePath}': ${
          error instanceof Error ? error.message : String(error)
        }`,
        "file_read_failed",
        filePath,
        error
      );
    }
    appendField(hash, relativePortablePath(input.changeRoot, filePath));
    appendBytes(hash, content);
  }

  return `sha256:${hash.digest("hex")}`;
}

/** Locale-independent ordering keeps revisions identical across ICU builds. */
function compareCodeUnits(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export function normalizePortablePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function relativePortablePath(root: string, candidate: string): string {
  const implementation = pathImplementation(root, candidate);
  const relative = implementation.relative(implementation.resolve(root), implementation.resolve(candidate));
  return normalizePortablePath(relative || ".");
}

export function isPathInside(root: string, candidate: string): boolean {
  const implementation = pathImplementation(root, candidate);
  const resolvedRoot = implementation.resolve(root);
  const resolvedCandidate = implementation.resolve(candidate);
  const relative = implementation.relative(resolvedRoot, resolvedCandidate);

  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${implementation.sep}`) &&
      !implementation.isAbsolute(relative))
  );
}

function pathImplementation(root: string, candidate: string): path.PlatformPath {
  if (looksLikeWindowsAbsolutePath(root) || looksLikeWindowsAbsolutePath(candidate)) {
    return path.win32;
  }
  return path;
}

function looksLikeWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]/.test(value);
}

function appendField(hash: ReturnType<typeof createHash>, value: string): void {
  const bytes = Buffer.from(value, "utf8");
  hash.update(String(bytes.length));
  hash.update(":");
  hash.update(bytes);
  hash.update(";");
}

function appendBytes(hash: ReturnType<typeof createHash>, value: Uint8Array): void {
  hash.update(String(value.byteLength));
  hash.update(":");
  hash.update(value);
  hash.update(";");
}
