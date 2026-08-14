import {
  DEFAULT_OPENSPEC_TIMEOUT_MS,
  NodeCommandRunner,
  OpenSpecRuntimeError,
  type CommandResult,
  type CommandRunner,
  type OpenSpecRuntime,
  inspectOpenSpecRuntime,
} from "./openspec-runtime.js";

export interface OpenSpecPlanningHome {
  kind: "repo";
  root: string;
  changesDir: string;
  defaultSchema: string;
  [key: string]: unknown;
}

export interface OpenSpecRoot {
  path: string;
  source: string;
  store_id?: string;
  [key: string]: unknown;
}

export interface OpenSpecArtifactPath {
  outputPath: string;
  resolvedOutputPath: string;
  existingOutputPaths: string[];
  [key: string]: unknown;
}

export interface OpenSpecActionContext {
  mode: string;
  sourceOfTruth: string;
  planningArtifacts: string[];
  linkedContext: Array<Record<string, unknown>>;
  allowedEditRoots: string[];
  requiresAffectedAreaSelection: boolean;
  constraints: string[];
  [key: string]: unknown;
}

export interface OpenSpecArtifactStatus {
  id: string;
  outputPath: string;
  status: "done" | "ready" | "blocked";
  missingDeps?: string[];
  [key: string]: unknown;
}

export interface OpenSpecStatusResponse {
  changeName: string;
  schemaName: string;
  planningHome: OpenSpecPlanningHome;
  changeRoot: string;
  artifactPaths: Record<string, OpenSpecArtifactPath>;
  nextSteps: string[];
  actionContext: OpenSpecActionContext;
  isComplete: boolean;
  applyRequires: string[];
  artifacts: OpenSpecArtifactStatus[];
  root?: OpenSpecRoot;
  [key: string]: unknown;
}

export interface OpenSpecArtifactInstructionsResponse {
  changeName: string;
  artifactId: string;
  schemaName: string;
  changeDir: string;
  planningHome?: OpenSpecPlanningHome;
  outputPath: string;
  resolvedOutputPath: string;
  existingOutputPaths: string[];
  description: string;
  instruction?: string;
  context?: string;
  rules?: string[];
  template: string;
  dependencies: Array<Record<string, unknown>>;
  unlocks: string[];
  root?: OpenSpecRoot;
  [key: string]: unknown;
}

export interface OpenSpecApplyInstructionsResponse {
  changeName: string;
  changeDir: string;
  schemaName: string;
  contextFiles: Record<string, string[]>;
  progress: { total: number; complete: number; remaining: number };
  tasks: Array<{ id: string; description: string; done: boolean }>;
  state: "blocked" | "all_done" | "ready";
  missingArtifacts?: string[];
  instruction: string;
  root?: OpenSpecRoot;
  [key: string]: unknown;
}

export interface OpenSpecListChange {
  name: string;
  completedTasks: number;
  totalTasks: number;
  lastModified: string;
  status: string;
  [key: string]: unknown;
}

export interface OpenSpecListResponse {
  changes: OpenSpecListChange[];
  root?: OpenSpecRoot;
  message?: string;
  [key: string]: unknown;
}

export interface OpenSpecCreateChangeResponse {
  change: {
    id: string;
    path: string;
    metadataPath: string;
    schema: string;
    [key: string]: unknown;
  };
  root?: OpenSpecRoot;
  [key: string]: unknown;
}

export interface OpenSpecArchiveResponse {
  archive: {
    change: string;
    archivedAs: string;
    path: string;
    specsUpdated: boolean;
    totals?: {
      added: number;
      modified: number;
      removed: number;
      renamed: number;
    };
  };
  root?: OpenSpecRoot;
}

export interface OpenSpecValidationItem extends Record<string, unknown> {
  id: string;
  type: "change" | "spec";
  valid: boolean;
  issues: unknown[];
  durationMs: number;
}

export interface OpenSpecValidationResponse extends Record<string, unknown> {
  items: OpenSpecValidationItem[];
  summary: Record<string, unknown>;
  version: string;
  root?: OpenSpecRoot;
}

export type OpenSpecAdapterErrorCode =
  | "command_spawn_failed"
  | "command_timeout"
  | "command_failed"
  | "invalid_json"
  | "invalid_response";

export class OpenSpecAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: OpenSpecAdapterErrorCode,
    public readonly details: {
      args?: readonly string[];
      exitCode?: number | null;
      stderr?: string;
      stdout?: string;
      payload?: unknown;
    } = {},
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "OpenSpecAdapterError";
  }
}

export interface OpenSpecAdapterOptions {
  executable?: string;
  timeoutMs?: number;
  store?: string;
  /** Tests and callers with a separately verified runtime may disable the probe. */
  verifyRuntime?: boolean;
}

export interface OpenSpecCommandOptions {
  store?: string;
  schema?: string;
}

export interface ValidateChangeOptions extends OpenSpecCommandOptions {
  strict?: boolean;
}

export interface CreateChangeOptions extends OpenSpecCommandOptions {
  description?: string;
  goal?: string;
}

type ResponseGuard<T> = (value: unknown) => value is T;

export class OpenSpecAdapter {
  private readonly runner: CommandRunner;
  private readonly executable: string;
  private readonly timeoutMs: number;
  private readonly defaultStore?: string;
  private readonly verifyRuntime: boolean;
  private runtimePromise?: Promise<OpenSpecRuntime>;

  constructor(
    public readonly cwd: string,
    runner: CommandRunner = new NodeCommandRunner(),
    options: OpenSpecAdapterOptions = {}
  ) {
    this.runner = runner;
    this.executable = options.executable ?? "openspec";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_OPENSPEC_TIMEOUT_MS;
    this.defaultStore = options.store;
    this.verifyRuntime = options.verifyRuntime ?? true;
  }

  async getRuntime(): Promise<OpenSpecRuntime> {
    if (!this.runtimePromise) {
      this.runtimePromise = inspectOpenSpecRuntime({
        cwd: this.cwd,
        runner: this.runner,
        executable: this.executable,
        timeoutMs: this.timeoutMs,
      }).catch((error: unknown) => {
        this.runtimePromise = undefined;
        throw error;
      });
    }
    return await this.runtimePromise;
  }

  async listChanges(options: Pick<OpenSpecCommandOptions, "store"> = {}): Promise<OpenSpecListResponse> {
    const value = await this.runJson(["list", "--json", ...this.selectorArgs(options)]);
    return requireResponse(value, isListResponse, "OpenSpec list response");
  }

  async getStatus(
    changeName: string,
    options: OpenSpecCommandOptions = {}
  ): Promise<OpenSpecStatusResponse> {
    const value = await this.runJson([
      "status",
      "--change",
      requireNonEmpty(changeName, "change name"),
      "--json",
      ...this.selectorArgs(options),
    ]);
    return requireResponse(value, isStatusResponse, "OpenSpec status response");
  }

  async getArtifactInstructions(
    changeName: string,
    artifactId: string,
    options: OpenSpecCommandOptions = {}
  ): Promise<OpenSpecArtifactInstructionsResponse> {
    const value = await this.runJson([
      "instructions",
      requireNonEmpty(artifactId, "artifact id"),
      "--change",
      requireNonEmpty(changeName, "change name"),
      "--json",
      ...this.selectorArgs(options),
    ]);
    return requireResponse(
      value,
      isArtifactInstructionsResponse,
      "OpenSpec artifact instructions response"
    );
  }

  async getApplyInstructions(
    changeName: string,
    options: OpenSpecCommandOptions = {}
  ): Promise<OpenSpecApplyInstructionsResponse> {
    const value = await this.runJson([
      "instructions",
      "apply",
      "--change",
      requireNonEmpty(changeName, "change name"),
      "--json",
      ...this.selectorArgs(options),
    ]);
    return requireResponse(
      value,
      isApplyInstructionsResponse,
      "OpenSpec apply instructions response"
    );
  }

  async validateChange(
    changeName: string,
    options: ValidateChangeOptions = {}
  ): Promise<OpenSpecValidationResponse> {
    const args = [
      "validate",
      requireNonEmpty(changeName, "change name"),
      "--type",
      "change",
      ...(options.strict === false ? [] : ["--strict"]),
      "--json",
      ...this.selectorArgs(options),
    ];
    // OpenSpec deliberately exits 1 for a well-formed invalid report. That is
    // a planning-domain result (ready blocker), not a CLI/runtime failure.
    const value = await this.runJson(
      args,
      (payload, exitCode) => exitCode === 1 && isValidationResponse(payload)
    );
    return requireResponse(value, isValidationResponse, "OpenSpec validation response");
  }

  async createChange(
    changeName: string,
    options: CreateChangeOptions = {}
  ): Promise<OpenSpecCreateChangeResponse> {
    const args = ["new", "change", requireNonEmpty(changeName, "change name")];
    if (options.description !== undefined) {
      args.push("--description", options.description);
    }
    if (options.goal !== undefined) {
      args.push("--goal", options.goal);
    }
    args.push("--json", ...this.selectorArgs(options));

    const value = await this.runJson(args);
    return requireResponse(value, isCreateChangeResponse, "OpenSpec create-change response");
  }

  async archiveChange(
    changeName: string,
    options: Pick<OpenSpecCommandOptions, "store"> = {}
  ): Promise<OpenSpecArchiveResponse> {
    const value = await this.runJson([
      "archive",
      requireNonEmpty(changeName, "change name"),
      "--json",
      "--yes",
      ...this.selectorArgs(options),
    ]);
    return requireResponse(value, isArchiveResponse, "OpenSpec archive response");
  }

  private selectorArgs(options: OpenSpecCommandOptions): string[] {
    const args: string[] = [];
    const store = options.store ?? this.defaultStore;
    if (store !== undefined) {
      args.push("--store", requireNonEmpty(store, "store id"));
    }
    if (options.schema !== undefined) {
      args.push("--schema", requireNonEmpty(options.schema, "schema name"));
    }
    return args;
  }

  private async runJson(
    args: readonly string[],
    acceptNonZero?: (payload: unknown, exitCode: number | null) => boolean
  ): Promise<unknown> {
    if (this.verifyRuntime) {
      await this.getRuntime();
    }

    let result: CommandResult;
    try {
      result = await this.runner.run({
        command: this.executable,
        args,
        cwd: this.cwd,
        timeoutMs: this.timeoutMs,
        env: { OPENSPEC_TELEMETRY: "0" },
      });
    } catch (error) {
      if (error instanceof OpenSpecRuntimeError) throw error;
      throw new OpenSpecAdapterError(
        `Failed to run OpenSpec: ${error instanceof Error ? error.message : String(error)}`,
        "command_spawn_failed",
        { args },
        error
      );
    }

    if (result.timedOut) {
      throw new OpenSpecAdapterError(
        `OpenSpec command timed out after ${this.timeoutMs}ms`,
        "command_timeout",
        { args, exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout }
      );
    }

    const payload = parseJsonOutput(result.stdout, args, result);
    if (result.exitCode !== 0 && !acceptNonZero?.(payload, result.exitCode)) {
      const diagnostic = firstDiagnostic(payload);
      throw new OpenSpecAdapterError(
        diagnostic?.message ?? `OpenSpec command exited with code ${String(result.exitCode)}`,
        "command_failed",
        {
          args,
          exitCode: result.exitCode,
          stderr: result.stderr,
          stdout: result.stdout,
          payload,
        }
      );
    }

    return payload;
  }
}

export function createOpenSpecAdapter(
  cwd: string,
  runner?: CommandRunner,
  options?: OpenSpecAdapterOptions
): OpenSpecAdapter {
  return new OpenSpecAdapter(cwd, runner, {
    ...options,
    executable:
      options?.executable ?? process.env["CORGISPEC_OPENSPEC_BIN"] ?? "openspec",
  });
}

function parseJsonOutput(
  stdout: string,
  args: readonly string[],
  result: CommandResult
): unknown {
  const text = stdout.trim();
  if (!text) {
    throw new OpenSpecAdapterError("OpenSpec returned empty JSON output", "invalid_json", {
      args,
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new OpenSpecAdapterError(
      `OpenSpec returned malformed JSON: ${error instanceof Error ? error.message : String(error)}`,
      "invalid_json",
      { args, exitCode: result.exitCode, stderr: result.stderr, stdout },
      error
    );
  }
}

function requireResponse<T>(
  value: unknown,
  guard: ResponseGuard<T>,
  label: string
): T {
  if (!guard(value)) {
    throw new OpenSpecAdapterError(`${label} does not match the OpenSpec 1.6 contract`, "invalid_response", {
      payload: value,
    });
  }
  return value;
}

function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OpenSpecAdapterError(`${label} must be a non-empty string`, "invalid_response");
  }
  return value;
}

function firstDiagnostic(value: unknown): { message?: string } | null {
  if (!isRecord(value) || !Array.isArray(value.status)) return null;
  const first = value.status.find(isRecord);
  return first && typeof first.message === "string" ? { message: first.message } : null;
}

function isStatusResponse(value: unknown): value is OpenSpecStatusResponse {
  if (!isRecord(value)) return false;
  if (
    typeof value.changeName !== "string" ||
    typeof value.schemaName !== "string" ||
    typeof value.changeRoot !== "string" ||
    typeof value.isComplete !== "boolean" ||
    !isPlanningHome(value.planningHome) ||
    !isArtifactPaths(value.artifactPaths) ||
    !isActionContext(value.actionContext) ||
    !isStringArray(value.nextSteps) ||
    !isStringArray(value.applyRequires) ||
    !Array.isArray(value.artifacts)
  ) {
    return false;
  }
  return value.artifacts.every(isArtifactStatus);
}

function isPlanningHome(value: unknown): value is OpenSpecPlanningHome {
  return (
    isRecord(value) &&
    value.kind === "repo" &&
    typeof value.root === "string" &&
    typeof value.changesDir === "string" &&
    typeof value.defaultSchema === "string"
  );
}

function isArtifactPaths(value: unknown): value is Record<string, OpenSpecArtifactPath> {
  return isRecord(value) && Object.values(value).every(isArtifactPath);
}

function isArtifactPath(value: unknown): value is OpenSpecArtifactPath {
  return (
    isRecord(value) &&
    typeof value.outputPath === "string" &&
    typeof value.resolvedOutputPath === "string" &&
    isStringArray(value.existingOutputPaths)
  );
}

function isActionContext(value: unknown): value is OpenSpecActionContext {
  return (
    isRecord(value) &&
    typeof value.mode === "string" &&
    typeof value.sourceOfTruth === "string" &&
    isStringArray(value.planningArtifacts) &&
    Array.isArray(value.linkedContext) &&
    value.linkedContext.every(isRecord) &&
    isStringArray(value.allowedEditRoots) &&
    typeof value.requiresAffectedAreaSelection === "boolean" &&
    isStringArray(value.constraints)
  );
}

function isArtifactStatus(value: unknown): value is OpenSpecArtifactStatus {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.outputPath === "string" &&
    (value.status === "done" || value.status === "ready" || value.status === "blocked") &&
    (value.missingDeps === undefined || isStringArray(value.missingDeps))
  );
}

function isListResponse(value: unknown): value is OpenSpecListResponse {
  return isRecord(value) && Array.isArray(value.changes) && value.changes.every(isListChange);
}

function isListChange(value: unknown): value is OpenSpecListChange {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.completedTasks === "number" &&
    typeof value.totalTasks === "number" &&
    typeof value.lastModified === "string" &&
    typeof value.status === "string"
  );
}

function isArtifactInstructionsResponse(
  value: unknown
): value is OpenSpecArtifactInstructionsResponse {
  return (
    isRecord(value) &&
    typeof value.changeName === "string" &&
    typeof value.artifactId === "string" &&
    typeof value.schemaName === "string" &&
    typeof value.changeDir === "string" &&
    typeof value.outputPath === "string" &&
    typeof value.resolvedOutputPath === "string" &&
    isStringArray(value.existingOutputPaths) &&
    typeof value.description === "string" &&
    typeof value.template === "string" &&
    Array.isArray(value.dependencies) &&
    value.dependencies.every(isRecord) &&
    isStringArray(value.unlocks)
  );
}

function isApplyInstructionsResponse(value: unknown): value is OpenSpecApplyInstructionsResponse {
  if (
    !isRecord(value) ||
    typeof value.changeName !== "string" ||
    typeof value.changeDir !== "string" ||
    typeof value.schemaName !== "string" ||
    !isStringArrayRecord(value.contextFiles) ||
    !isRecord(value.progress) ||
    typeof value.progress.total !== "number" ||
    typeof value.progress.complete !== "number" ||
    typeof value.progress.remaining !== "number" ||
    !Array.isArray(value.tasks) ||
    typeof value.instruction !== "string" ||
    (value.state !== "blocked" && value.state !== "all_done" && value.state !== "ready")
  ) {
    return false;
  }
  return value.tasks.every(
    (task) =>
      isRecord(task) &&
      typeof task.id === "string" &&
      typeof task.description === "string" &&
      typeof task.done === "boolean"
  );
}

function isCreateChangeResponse(value: unknown): value is OpenSpecCreateChangeResponse {
  if (!isRecord(value) || !isRecord(value.change)) return false;
  return (
    typeof value.change.id === "string" &&
    typeof value.change.path === "string" &&
    typeof value.change.metadataPath === "string" &&
    typeof value.change.schema === "string"
  );
}

function isArchiveResponse(value: unknown): value is OpenSpecArchiveResponse {
  if (!isRecord(value) || !isRecord(value.archive)) return false;
  const archive = value.archive;
  if (
    typeof archive.change !== "string"
    || typeof archive.archivedAs !== "string"
    || typeof archive.path !== "string"
    || typeof archive.specsUpdated !== "boolean"
  ) {
    return false;
  }
  if (archive.totals === undefined) return true;
  if (!isRecord(archive.totals)) return false;
  return typeof archive.totals.added === "number"
    && typeof archive.totals.modified === "number"
    && typeof archive.totals.removed === "number"
    && typeof archive.totals.renamed === "number";
}

function isValidationResponse(value: unknown): value is OpenSpecValidationResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isValidationItem) &&
    isRecord(value.summary) &&
    typeof value.version === "string"
  );
}

function isValidationItem(value: unknown): value is OpenSpecValidationItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.type === "change" || value.type === "spec") &&
    typeof value.valid === "boolean" &&
    Array.isArray(value.issues) &&
    typeof value.durationMs === "number"
  );
}

function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
  return isRecord(value) && Object.values(value).every(isStringArray);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
