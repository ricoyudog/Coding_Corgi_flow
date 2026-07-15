import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  type OpenSpecActionContext,
  type OpenSpecAdapter,
  type OpenSpecArtifactPath,
  type OpenSpecCommandOptions,
  type OpenSpecPlanningHome,
  type OpenSpecStatusResponse,
} from "./openspec-adapter.js";
import {
  computePlanningRevision,
  isPathInside,
  type PlanningRevisionFileReader,
} from "./planning-revision.js";

export interface ArtifactStatusProvider {
  getStatus(
    changeName: string,
    options?: OpenSpecCommandOptions
  ): Promise<OpenSpecStatusResponse>;
}

export interface ResolvedChangeArtifacts {
  changeName: string;
  schemaName: string;
  planningHome: OpenSpecPlanningHome;
  changeRoot: string;
  artifactPaths: Record<string, OpenSpecArtifactPath>;
  actionContext: OpenSpecActionContext;
  planningRevision: string;
  planningComplete: boolean;
  status: OpenSpecStatusResponse;
}

export type ArtifactResolverErrorCode =
  | "path_not_absolute"
  | "path_outside_planning_home"
  | "path_outside_change"
  | "symlink_escape"
  | "path_not_file"
  | "path_unavailable";

export class ArtifactResolverError extends Error {
  constructor(
    message: string,
    public readonly code: ArtifactResolverErrorCode,
    public readonly targetPath: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "ArtifactResolverError";
  }
}

export interface ArtifactResolverOptions {
  fileReader?: PlanningRevisionFileReader;
}

export class ArtifactResolver {
  private readonly fileReader?: PlanningRevisionFileReader;

  constructor(
    private readonly adapter: ArtifactStatusProvider,
    options: ArtifactResolverOptions = {}
  ) {
    this.fileReader = options.fileReader;
  }

  async resolve(
    changeName: string,
    options: OpenSpecCommandOptions = {}
  ): Promise<ResolvedChangeArtifacts> {
    const status = await this.adapter.getStatus(changeName, options);
    assertAbsolute(status.planningHome.root, "planningHome.root");
    assertAbsolute(status.planningHome.changesDir, "planningHome.changesDir");
    assertAbsolute(status.changeRoot, "changeRoot");

    if (!isPathInside(status.planningHome.root, status.planningHome.changesDir)) {
      throw new ArtifactResolverError(
        `OpenSpec changes directory is outside planningHome.root: ${status.planningHome.changesDir}`,
        "path_outside_planning_home",
        status.planningHome.changesDir
      );
    }
    if (!isPathInside(status.planningHome.changesDir, status.changeRoot)) {
      throw new ArtifactResolverError(
        `OpenSpec change root is outside planningHome.changesDir: ${status.changeRoot}`,
        "path_outside_planning_home",
        status.changeRoot
      );
    }

    // The Store root is authoritative and may itself be anywhere on disk. Once
    // selected, however, both descendants must remain inside that root after
    // symlinks are resolved. Checking each edge separately also catches a
    // changeRoot symlink that escapes an otherwise valid changesDir.
    const canonicalPlanningRoot = await canonicalExisting(status.planningHome.root);
    const canonicalChangesDir = await canonicalExisting(status.planningHome.changesDir);
    const canonicalChangeRoot = await canonicalExisting(status.changeRoot);
    if (!isPathInside(canonicalPlanningRoot, canonicalChangesDir)) {
      throw new ArtifactResolverError(
        `OpenSpec changes directory resolves outside planningHome.root through a symlink: ${status.planningHome.changesDir}`,
        "symlink_escape",
        status.planningHome.changesDir
      );
    }
    if (!isPathInside(canonicalChangesDir, canonicalChangeRoot)) {
      throw new ArtifactResolverError(
        `OpenSpec change root resolves outside planningHome.changesDir through a symlink: ${status.changeRoot}`,
        "symlink_escape",
        status.changeRoot
      );
    }
    const artifactPaths: Record<string, OpenSpecArtifactPath> = {};

    for (const artifactId of Object.keys(status.artifactPaths).sort()) {
      const artifact = status.artifactPaths[artifactId]!;
      const concretePaths: string[] = [];
      for (const existingPath of artifact.existingOutputPaths) {
        assertAbsolute(existingPath, `artifactPaths.${artifactId}.existingOutputPaths`);
        if (!isPathInside(status.changeRoot, existingPath)) {
          throw new ArtifactResolverError(
            `Artifact '${artifactId}' escapes change root: ${existingPath}`,
            "path_outside_change",
            existingPath
          );
        }

        const canonicalPath = await canonicalExisting(existingPath);
        if (!isPathInside(canonicalChangeRoot, canonicalPath)) {
          throw new ArtifactResolverError(
            `Artifact '${artifactId}' resolves outside change root through a symlink: ${existingPath}`,
            "symlink_escape",
            existingPath
          );
        }

        let fileStat;
        try {
          fileStat = await stat(canonicalPath);
        } catch (error) {
          throw new ArtifactResolverError(
            `Artifact '${artifactId}' is unavailable: ${existingPath}`,
            "path_unavailable",
            existingPath,
            error
          );
        }
        if (!fileStat.isFile()) {
          throw new ArtifactResolverError(
            `Artifact '${artifactId}' is not a file: ${existingPath}`,
            "path_not_file",
            existingPath
          );
        }
        // Preserve the authoritative path emitted by OpenSpec. Canonical paths
        // are used only for the containment decision; callers may need the
        // Store/symlink spelling chosen by OpenSpec for subsequent commands.
        concretePaths.push(existingPath);
      }

      artifactPaths[artifactId] = {
        ...artifact,
        existingOutputPaths: [...new Set(concretePaths)].sort(),
      };
    }

    const planningRevision = await computePlanningRevision(
      {
        changeRoot: status.changeRoot,
        schemaName: status.schemaName,
        artifactPaths,
      },
      this.fileReader
    );

    return {
      changeName: status.changeName,
      schemaName: status.schemaName,
      planningHome: status.planningHome,
      changeRoot: status.changeRoot,
      artifactPaths,
      actionContext: status.actionContext,
      planningRevision,
      planningComplete: status.isComplete,
      status,
    };
  }
}

export function createArtifactResolver(
  adapter: OpenSpecAdapter | ArtifactStatusProvider,
  options?: ArtifactResolverOptions
): ArtifactResolver {
  return new ArtifactResolver(adapter, options);
}

/**
 * Validate a path before a Corgi writer touches it. New files are supported:
 * the nearest existing parent is canonicalized to catch symlink escapes.
 */
export async function assertWritableArtifactPath(
  resolved: Pick<ResolvedChangeArtifacts, "changeRoot">,
  candidate: string
): Promise<string> {
  const absoluteCandidate = isAbsoluteOnCurrentOrWindows(candidate)
    ? candidate
    : path.resolve(resolved.changeRoot, candidate);
  if (!isPathInside(resolved.changeRoot, absoluteCandidate)) {
    throw new ArtifactResolverError(
      `Write target is outside change root: ${candidate}`,
      "path_outside_change",
      candidate
    );
  }

  const canonicalRoot = await canonicalExisting(resolved.changeRoot);
  let existingAncestor = absoluteCandidate;
  while (true) {
    try {
      const canonicalAncestor = await realpath(existingAncestor);
      if (!isPathInside(canonicalRoot, canonicalAncestor)) {
        throw new ArtifactResolverError(
          `Write target resolves outside change root through a symlink: ${candidate}`,
          "symlink_escape",
          candidate
        );
      }
      return absoluteCandidate;
    } catch (error) {
      if (error instanceof ArtifactResolverError) throw error;
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) {
        throw new ArtifactResolverError(
          `No existing parent could be resolved for write target: ${candidate}`,
          "path_unavailable",
          candidate,
          error
        );
      }
      existingAncestor = parent;
    }
  }
}

/**
 * Validate the output target emitted by OpenSpec instructions. Glob outputs
 * describe a set of files, so only their static ancestor is canonicalized;
 * they are never treated as a concrete file write. The complete pattern is
 * still checked lexically so traversal after the first glob token cannot
 * escape the change root.
 */
export async function assertArtifactOutputPath(
  resolved: Pick<ResolvedChangeArtifacts, "changeRoot">,
  candidate: string,
  glob: boolean
): Promise<string> {
  const absoluteCandidate = isAbsoluteOnCurrentOrWindows(candidate)
    ? candidate
    : path.resolve(resolved.changeRoot, candidate);
  if (!isPathInside(resolved.changeRoot, absoluteCandidate)) {
    throw new ArtifactResolverError(
      `Artifact output is outside change root: ${candidate}`,
      "path_outside_change",
      candidate
    );
  }

  if (!glob) {
    return await assertWritableArtifactPath(resolved, candidate);
  }

  const staticAncestor = globStaticAncestor(absoluteCandidate);
  await assertWritableArtifactPath(resolved, staticAncestor);
  return absoluteCandidate;
}

function assertAbsolute(value: string, label: string): void {
  if (!isAbsoluteOnCurrentOrWindows(value)) {
    throw new ArtifactResolverError(
      `${label} must be an absolute path, got: ${value}`,
      "path_not_absolute",
      value
    );
  }
}

function isAbsoluteOnCurrentOrWindows(value: string): boolean {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]/.test(value);
}

function globStaticAncestor(pattern: string): string {
  // The caller has already identified this as a glob. Appending a sentinel
  // turns both `dir/**/*.md` and `dir/prefix-*.md` into a path whose dirname
  // is the last fully static ancestor, without probing the glob as a file.
  const firstMagic = pattern.search(/[*?[\]{}]/u);
  return path.dirname(`${pattern.slice(0, firstMagic)}.__corgi_glob__`);
}

async function canonicalExisting(value: string): Promise<string> {
  try {
    return await realpath(value);
  } catch (error) {
    throw new ArtifactResolverError(
      `OpenSpec path is unavailable: ${value}`,
      "path_unavailable",
      value,
      error
    );
  }
}
