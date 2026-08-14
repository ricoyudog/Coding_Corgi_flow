import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  createArtifactResolver,
  type ArtifactResolver,
  type ResolvedChangeArtifacts,
} from "../lib/artifact-resolver.js";
import {
  computeDeliveryBindingDigest,
  createInitialTraceability,
  digestValue,
  SOURCE_RELATIVE_PATH,
  summarizeChangeContract,
  TRACEABILITY_RELATIVE_PATH,
  writeChangeSource,
  writeChangeTraceability,
  type ChangeSource,
  type TrackerBinding,
} from "../lib/change-contract.js";
import { loadConfigFromDir, resolveTrackingProvider } from "../lib/config.js";
import { validateMaintenanceContractReferences } from "../lib/contract-provenance.js";
import { resolveArtifactInstruction } from "../lib/instructions.js";
import { lifecycleError } from "../lib/lifecycle.js";
import { buildLifecycleReadyReport } from "../lib/lifecycle.js";
import { classifyMaintenance } from "../lib/maintenance.js";
import { mergeIssueDashboard, renderIssueDashboard } from "../lib/issue-dashboard.js";
import {
  createOpenSpecAdapter,
  type OpenSpecAdapter,
  type OpenSpecArtifactPath,
} from "../lib/openspec-adapter.js";
import {
  assertFoundationAccepted,
  bindRfcSliceCas,
  loadRfcDelivery,
  resolveAcceptedRfcSlice,
  type RfcDeliveryBinding,
} from "../lib/rfc.js";
import {
  createOrRecoverIssue,
  createTrackerClient,
  featureIssueMarker,
  maintenanceIssueMarker,
  repositoryIdentity,
  type TrackerClient,
  type TrackerIssue,
} from "../lib/tracker.js";
import {
  advanceProposeIntent,
  acquireWorkflowLock,
  loadProposeIntent,
  releaseWorkflowLock,
  writeProposeIntent,
  type ProposeIntent,
  type WorkflowLock,
} from "../lib/workflow-intent.js";

export interface ProposeCommandDependencies {
  createAdapter?: (cwd: string) => OpenSpecAdapter;
  createResolver?: (adapter: OpenSpecAdapter) => ArtifactResolver;
  createTracker?: (provider: "github" | "gitlab", cwd: string) => TrackerClient;
  now?: () => Date;
}

interface ProposeOptions {
  description?: string;
  goal?: string;
  store?: string;
  from?: string;
  maintenance?: boolean;
  contractRef?: string[];
  finalize?: boolean;
  json?: boolean;
  path: string;
}

interface PreparedSource {
  source: ChangeSource;
  key: string;
  marker: string;
  title: string;
  body: string;
  rfcBinding?: {
    rfcId: string;
    sliceId: string;
    expectedRevision: number;
    existingBinding?: RfcDeliveryBinding;
  };
}

interface ExistingChange {
  resolved: ResolvedChangeArtifacts | null;
  changeRoot: string;
  artifactPaths: Record<string, OpenSpecArtifactPath>;
}

export function createProposeCommand(
  dependencies: ProposeCommandDependencies = {},
): Command {
  const cmd = new Command("propose");
  const adapterFactory = dependencies.createAdapter ?? ((cwd) => createOpenSpecAdapter(cwd));
  const resolverFactory = dependencies.createResolver ?? ((adapter) => createArtifactResolver(adapter));
  const trackerFactory = dependencies.createTracker ?? ((provider, cwd) => {
    const tracker = createTrackerClient(provider, cwd);
    if (!tracker) throw new Error(`Could not create ${provider} tracker adapter`);
    return tracker;
  });
  const now = dependencies.now ?? (() => new Date());

  cmd
    .description("Create an RFC-bound OpenSpec change and its single Feature Issue")
    .argument("<name>", "Name of the change to propose")
    .option("--description <text>", "Change description")
    .option("--goal <text>", "Change goal")
    .option("--from <RFC/Slice>", "Accepted RFC Slice delivery reference")
    .option("--maintenance", "Use the closed maintenance exemption classifier")
    .option("--contract-ref <ref...>", "Existing RFC AC or canonical spec references")
    .option("--finalize", "Require strict readiness and synchronize the single Issue dashboard")
    .option("--store <id>", "OpenSpec Store id")
    .option("--json", "Output as JSON")
    .option("--path <dir>", "Working directory", ".")
    .action(async (name: string, opts: ProposeOptions) => {
      const cwd = resolve(opts.path);
      let tracker: TrackerClient | null = null;
      let issue: TrackerIssue | undefined;
      let workflowLock: WorkflowLock | null = null;
      try {
        const config = loadConfigFromDir(cwd);
        if (config.corgi?.contract !== "rfc-v1") {
          throw contractError(
            "PROJECT_REQUIRES_V4_MIGRATION",
            "This project is not on the RFC-first contract. Run 'corgispec bootstrap --migrate-v4'.",
          );
        }
        if (Boolean(opts.from) === Boolean(opts.maintenance)) {
          throw contractError(
            "PROPOSE_SOURCE_REQUIRED",
            "Choose exactly one source: --from <RFC/Slice> or --maintenance. Feature prose without an accepted RFC is not allowed.",
          );
        }

        const tracking = resolveTrackingProvider(config).provider;
        const repository = repositoryIdentity(cwd);
        const prepared = prepareSource({ cwd, name, opts, tracking, repository });
        const proposeHead = currentGitHead(cwd);
        workflowLock = acquireWorkflowLock(cwd, `propose:${prepared.key}`);
        const existingIntent = loadProposeIntent(cwd, prepared.key);
        preflightIntentAndDelivery(cwd, name, prepared, existingIntent, proposeHead);
        const adapter = adapterFactory(cwd);
        const resolver = resolverFactory(adapter);
        const existingChange = await resolveExisting(adapter, resolver, name, opts.store);
        if (existingChange && !existingIntent) {
          throw contractError(
            "PROPOSE_CHANGE_EXISTS",
            `Change '${name}' already exists and is not owned by this delivery intent.`,
          );
        }
        assertProposeWorktreePreflight(cwd, prepared, existingIntent, existingChange);
        let intent: ProposeIntent = existingIntent ?? {
          schemaVersion: 1,
          operation: "propose",
          key: prepared.key,
          deliveryRef: prepared.source.deliveryRef,
          changeName: name,
          headRevision: proposeHead,
          stage: "prepared",
          updatedAt: now().toISOString(),
        };
        if (!existingIntent) writeProposeIntent(cwd, intent);

        if (tracking !== "none") {
          tracker = trackerFactory(tracking, cwd);
          const boundIssue = prepared.rfcBinding?.existingBinding?.issue;
          if (boundIssue?.id && boundIssue.url) {
            issue = await tracker.getIssue({
              id: boundIssue.id,
              url: boundIssue.url,
              title: prepared.title,
              body: prepared.body,
            });
            if (!issue.body.includes(prepared.marker)) {
              throw contractError(
                "TRACKER_MARKER_DRIFT",
                `Bound Issue '${issue.id}' does not contain the exact RFC Slice marker.`,
              );
            }
          } else {
            const recovered = await createOrRecoverIssue(tracker, {
              title: prepared.title,
              body: prepared.body,
              marker: prepared.marker,
            });
            issue = recovered.issue;
          }
          if (existingIntent?.issue && (
            existingIntent.issue.id !== issue.id || existingIntent.issue.url !== issue.url
          )) {
            throw contractError(
              "PROPOSE_ISSUE_CONFLICT",
              `Delivery '${prepared.source.deliveryRef}' is already associated with Issue '${existingIntent.issue.id}'.`,
            );
          }
          prepared.source.tracker.issue = { id: issue.id, url: issue.url };
          intent = checkpointIntent(cwd, intent, {
            stage: "issue_created",
            issue: { id: issue.id, url: issue.url },
          });
        }
        if (prepared.source.kind === "rfc-slice") {
          prepared.source.deliveryBindingDigest = computeDeliveryBindingDigest({
            rfcId: prepared.source.rfc.id,
            sliceId: prepared.source.slice.id,
            change: name,
            issue: {
              provider: tracking,
              ...(issue ? { id: issue.id, url: issue.url } : {}),
            },
          });
        }

        let resolved = existingChange?.resolved ?? null;
        let changeRoot = existingChange?.changeRoot ?? null;
        let created: Record<string, unknown> | null = null;
        if (!changeRoot) {
          const response = await adapter.createChange(name, {
            schema: config.schema,
            store: opts.store,
            description: opts.description,
            goal: opts.goal,
          });
          created = response.change;
          resolved = await resolver.resolve(name, { store: opts.store });
          changeRoot = resolved.changeRoot;
        }
        intent = checkpointIntent(cwd, intent, {
          stage: "change_created",
          changeRoot,
        });

        let sourceDigest: string;
        if (resolved?.contract) {
          if (
            resolved.contract.source.deliveryRef !== prepared.source.deliveryRef
            || resolved.contract.source.tracker.idempotencyKey !== prepared.key
            || digestValue(resolved.contract.source) !== digestValue(prepared.source)
          ) {
            throw contractError(
              "PROPOSE_SOURCE_CONFLICT",
              `Existing Change '${name}' is bound to a different source contract.`,
            );
          }
          sourceDigest = resolved.contract.sourceDigest;
        } else {
          sourceDigest = writeChangeSource(changeRoot, prepared.source);
          const traceability = createInitialTraceability(prepared.source, sourceDigest);
          writeChangeTraceability(changeRoot, traceability);
        }
        intent = checkpointIntent(cwd, intent, {
          stage: "source_written",
          sourceDigest,
        });
        updatePlanningBridgePointer(cwd, prepared.source, name, proposeHead);
        assertProposeHead(cwd, intent.headRevision);

        resolved = await resolver.resolve(name, { store: opts.store });
        let readiness: Record<string, unknown> | null = null;
        if (opts.finalize) {
          const ready = await buildLifecycleReadyReport(
            adapter,
            resolved,
            config,
            true,
            { store: opts.store },
            cwd,
            { allowUnboundDelivery: prepared.rfcBinding !== undefined },
          );
          if (ready.report.status !== "ready") {
            throw contractError(
              "PROPOSE_NOT_READY",
              ready.report.checks
                .filter((check) => check.status !== "pass")
                .map((check) => `${check.code}: ${check.message}`)
                .join("; "),
            );
          }
          readiness = ready.report as unknown as Record<string, unknown>;
          intent = checkpointIntent(cwd, intent, { stage: "tracker_sync_pending" });
          if (tracker && issue) {
            await tracker.updateBody(
              issue,
              mergeIssueDashboard(issue.body, renderIssueDashboard(ready.report.taskGroups)),
            );
            await tracker.setState(issue, "todo");
          }
          assertProposeHead(cwd, intent.headRevision);
          if (prepared.rfcBinding) {
            const binding = prepared.rfcBinding.existingBinding ?? {
              change: name,
              issue: {
                provider: tracking,
                ...(issue ? { id: issue.id, url: issue.url } : {}),
              },
              sourceDigest,
              plannedAt: now().toISOString(),
            };
            if (binding.sourceDigest !== sourceDigest) {
              throw contractError(
                "RFC_DELIVERY_SOURCE_DRIFT",
                "delivery.yaml source digest differs from the Change source overlay.",
              );
            }
            bindRfcSliceCas({
              projectDir: cwd,
              rfcId: prepared.rfcBinding.rfcId,
              sliceId: prepared.rfcBinding.sliceId,
              expectedRevision: prepared.rfcBinding.expectedRevision,
              binding,
            });
          }
          intent = checkpointIntent(cwd, intent, { stage: "complete" });
        }
        assertProposeHead(cwd, intent.headRevision);
        const baseOutput = await buildProposeOutput(
          cwd,
          name,
          resolved,
          adapter,
          resolver,
          opts.store,
          created,
          issue,
        );
        const output = { ...baseOutput, readiness };
        if (opts.json) console.log(JSON.stringify(output, null, 2));
        else {
          console.log(`Created RFC-first change: ${name}`);
          console.log(`Source: ${prepared.source.deliveryRef}`);
          if (issue) console.log(`Issue: ${issue.url}`);
          console.log(`Root: ${resolved.changeRoot}`);
          console.log("Next: complete the OpenSpec planning artifacts and corgi/traceability.yaml.");
          if ("instruction" in output && typeof output.instruction === "string") {
            console.log(`\n${output.instruction}`);
          }
        }
      } catch (error) {
        if (tracker && issue) {
          try {
            await tracker.comment(issue, `## Planning blocked\n\n${error instanceof Error ? error.message : String(error)}\n\nRetry the same CorgiSpec Propose command after resolving the blocker.`);
          } catch {
            // Preserve the original planning failure; the durable intent keeps
            // tracker reconciliation retryable.
          }
        }
        const failure = lifecycleError(error);
        if (opts.json) {
          console.log(JSON.stringify({
            schemaVersion: 2,
            changeName: name,
            status: "contract_error",
            contract: null,
            error: failure,
          }, null, 2));
        }
        else console.error(`Error: ${failure.message}`);
        process.exitCode = 1;
      } finally {
        if (workflowLock) releaseWorkflowLock(workflowLock);
      }
    });

  return cmd;
}

function prepareSource(input: {
  cwd: string;
  name: string;
  opts: ProposeOptions;
  tracking: "github" | "gitlab" | "none";
  repository: string;
}): PreparedSource {
  if (input.opts.from) {
    const match = input.opts.from.match(/^(RFC-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*)\/(S-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*)$/);
    if (!match) throw contractError("DELIVERY_REF_INVALID", "--from must be RFC-0001-slug/S-01-slug");
    const resolved = resolveAcceptedRfcSlice({
      projectDir: input.cwd,
      rfcId: match[1]!,
      sliceId: match[2]!,
    });
    const delivery = loadRfcDelivery(input.cwd, resolved.rfc.metadata.id);
    const deliveryRef = `${resolved.rfc.metadata.id}/${resolved.slice.id}`;
    const marker = featureIssueMarker({
      repository: input.repository,
      deliveryRef,
      rfcDigest: resolved.rfc.digest,
    });
    const tracker: TrackerBinding = {
      provider: input.tracking,
      idempotencyKey: marker.key,
    };
    const source: ChangeSource = {
      schemaVersion: 1,
      kind: "rfc-slice",
      deliveryRef,
      rfc: {
        id: resolved.rfc.metadata.id,
        path: relative(input.cwd, resolved.rfc.directory).replace(/\\/g, "/"),
        acceptedCommit: resolved.acceptedCommit,
        digest: `sha256:${resolved.rfc.digest}`,
      },
      slice: {
        id: resolved.slice.id,
        digest: digestValue(resolved.slice),
      },
      acceptance: resolved.slice.acceptanceCriteria.map((criterion) => ({
        id: criterion.id,
        evidence: criterion.evidence,
      })),
      deliveryBindingDigest: computeDeliveryBindingDigest({
        rfcId: resolved.rfc.metadata.id,
        sliceId: resolved.slice.id,
        change: input.name,
        issue: { provider: input.tracking },
      }),
      tracker,
    };
    const ac = resolved.slice.acceptanceCriteria
      .map((criterion) => `- ${criterion.id} [${criterion.evidence}]: ${criterion.statement}`)
      .join("\n");
    return {
      source,
      key: marker.key,
      marker: marker.marker,
      title: `[${deliveryRef}] ${resolved.slice.title}`,
      body: `${marker.marker}\n\n## RFC Slice\n\n${deliveryRef}\n\n## Acceptance Criteria\n\n${ac}\n`,
      rfcBinding: {
        rfcId: resolved.rfc.metadata.id,
        sliceId: resolved.slice.id,
        expectedRevision: delivery.revision,
      },
    };
  }

  assertFoundationAccepted(input.cwd);
  const description = input.opts.description?.trim() ?? "";
  const classification = classifyMaintenance(description, input.opts.contractRef ?? []);
  const referenceFailures = validateMaintenanceContractReferences(input.cwd, input.opts.contractRef ?? []);
  if (referenceFailures.length > 0) {
    throw contractError(referenceFailures[0]!.code, referenceFailures.map((failure) => failure.message).join("; "));
  }
  const deliveryRef = `maintenance/${input.name}`;
  const marker = maintenanceIssueMarker({
    repository: input.repository,
    changeName: input.name,
    description,
  });
  const source: ChangeSource = {
    schemaVersion: 1,
    kind: "maintenance",
    deliveryRef,
    maintenance: {
      category: classification.category,
      description,
      reason: classification.reason,
      boundary: classification.boundary,
      contractRefs: input.opts.contractRef ?? [],
    },
    acceptance: classification.acceptance,
    tracker: { provider: input.tracking, idempotencyKey: marker.key },
  };
  return {
    source,
    key: marker.key,
    marker: marker.marker,
    title: `[maintenance] ${input.name}`,
    body: `${marker.marker}\n\n## Maintenance\n\nCategory: ${classification.category}\n\n${description}\n`,
  };
}

function preflightIntentAndDelivery(
  cwd: string,
  changeName: string,
  prepared: PreparedSource,
  existingIntent: ProposeIntent | null,
  currentHead: string,
): void {
  if (existingIntent && (
    existingIntent.changeName !== changeName
    || existingIntent.deliveryRef !== prepared.source.deliveryRef
  )) {
    throw contractError(
      "PROPOSE_CHANGE_CONFLICT",
      `Delivery '${prepared.source.deliveryRef}' is already associated with Change '${existingIntent.changeName}'.`,
    );
  }
  if (existingIntent && existingIntent.headRevision !== currentHead) {
    throw contractError(
      "PROPOSE_HEAD_CHANGED",
      `Propose must leave HEAD unchanged; expected '${existingIntent.headRevision}', found '${currentHead}'.`,
    );
  }
  if (!prepared.rfcBinding) return;

  const delivery = loadRfcDelivery(cwd, prepared.rfcBinding.rfcId);
  prepared.rfcBinding.expectedRevision = delivery.revision;
  const selected = delivery.slices[prepared.rfcBinding.sliceId] ?? { status: "unbound" as const };
  if (selected.status === "unbound") return;
  if (
    selected.status !== "planned"
    || !selected.binding
    || !existingIntent
    || !["tracker_sync_pending", "complete"].includes(existingIntent.stage)
    || selected.binding.change !== changeName
    || selected.binding.sourceDigest !== existingIntent.sourceDigest
    || selected.binding.issue?.provider !== prepared.source.tracker.provider
    || !sameIssue(selected.binding.issue, existingIntent.issue)
  ) {
    throw contractError(
      "RFC_SLICE_BOUND",
      `RFC Slice '${prepared.rfcBinding.sliceId}' is already ${selected.status}.`,
    );
  }
  prepared.rfcBinding.existingBinding = selected.binding;
}

function currentGitHead(cwd: string): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw contractError(
      "PROPOSE_GIT_HEAD_REQUIRED",
      result.stderr.trim() || "Propose requires a committed Git HEAD",
    );
  }
  return result.stdout.trim();
}

function assertProposeHead(cwd: string, expected: string): void {
  const actual = currentGitHead(cwd);
  if (actual !== expected) {
    throw contractError(
      "PROPOSE_HEAD_CHANGED",
      `Propose must leave HEAD unchanged; expected '${expected}', found '${actual}'.`,
    );
  }
}

function sameIssue(
  binding: RfcDeliveryBinding["issue"],
  intent: ProposeIntent["issue"],
): boolean {
  if (binding?.provider === "none") return intent === undefined && binding.id === undefined && binding.url === undefined;
  return Boolean(
    binding?.id
    && binding.url
    && intent
    && binding.id === intent.id
    && binding.url === intent.url,
  );
}

const INTENT_STAGE_ORDER: ProposeIntent["stage"][] = [
  "prepared",
  "issue_created",
  "change_created",
  "source_written",
  "tracker_sync_pending",
  "complete",
];

function checkpointIntent(
  cwd: string,
  current: ProposeIntent,
  patch: Partial<Omit<ProposeIntent, "schemaVersion" | "operation" | "key" | "deliveryRef" | "changeName">>
    & { stage: ProposeIntent["stage"] },
): ProposeIntent {
  const currentIndex = INTENT_STAGE_ORDER.indexOf(current.stage);
  const requestedIndex = INTENT_STAGE_ORDER.indexOf(patch.stage);
  return advanceProposeIntent(cwd, current, {
    ...patch,
    stage: requestedIndex > currentIndex ? patch.stage : current.stage,
  });
}

async function resolveExisting(
  adapter: OpenSpecAdapter,
  resolver: ArtifactResolver,
  name: string,
  store?: string,
): Promise<ExistingChange | null> {
  try {
    const resolved = await resolver.resolve(name, { store });
    return { resolved, changeRoot: resolved.changeRoot, artifactPaths: resolved.artifactPaths };
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "CHANGE_CONTRACT_INCOMPLETE"
    ) {
      const status = await adapter.getStatus(name, { store });
      return { resolved: null, changeRoot: status.changeRoot, artifactPaths: status.artifactPaths };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|does not exist|unknown change/i.test(message)) return null;
    throw error;
  }
}

function assertProposeWorktreePreflight(
  cwd: string,
  prepared: PreparedSource,
  existingIntent: ProposeIntent | null,
  existingChange: ExistingChange | null,
): void {
  const dirtyPaths = new Set<string>([
    ...readGitPaths(cwd, ["diff", "--name-only", "-z", "--"]),
    ...readGitPaths(cwd, ["diff", "--cached", "--name-only", "-z", "--"]),
    ...readGitPaths(cwd, ["ls-files", "--others", "--exclude-standard", "-z", "--"]),
  ]);
  if (dirtyPaths.size === 0) return;

  const allowed = existingIntent && existingChange
    ? retryPlanningPaths(cwd, prepared, existingChange)
    : new Set<string>();
  const blocked = [...dirtyPaths].filter((path) => !allowed.has(path)).sort();
  if (blocked.length === 0) return;
  throw contractError(
    "PROPOSE_WORKTREE_DIRTY",
    `Propose requires a clean worktree before remote Issue mutation; unrelated paths: ${blocked.join(", ")}`,
  );
}

function retryPlanningPaths(
  cwd: string,
  prepared: PreparedSource,
  existingChange: ExistingChange,
): Set<string> {
  const paths = new Set<string>();
  const add = (path: string): void => {
    const portable = relative(cwd, resolve(path)).replace(/\\/g, "/");
    if (portable && portable !== ".." && !portable.startsWith("../")) paths.add(portable);
  };
  for (const artifact of Object.values(existingChange.artifactPaths)) {
    add(artifact.resolvedOutputPath);
    for (const path of artifact.existingOutputPaths) add(path);
  }
  add(resolve(existingChange.changeRoot, ".openspec.yaml"));
  add(resolve(existingChange.changeRoot, ".openspec.json"));
  add(resolve(existingChange.changeRoot, SOURCE_RELATIVE_PATH));
  add(resolve(existingChange.changeRoot, TRACEABILITY_RELATIVE_PATH));
  add(resolve(cwd, "memory/session-bridge.md"));
  if (prepared.source.kind === "rfc-slice") {
    add(resolve(cwd, prepared.source.rfc.path, "delivery.yaml"));
  }
  return paths;
}

function readGitPaths(cwd: string, args: string[]): string[] {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw contractError(
      "PROPOSE_GIT_STATUS_FAILED",
      result.error?.message || result.stderr.trim() || "Could not inspect the Git worktree",
    );
  }
  return result.stdout.split("\0").filter(Boolean).map((path) => path.replace(/\\/g, "/"));
}

async function buildProposeOutput(
  cwd: string,
  name: string,
  resolved: ResolvedChangeArtifacts,
  adapter: OpenSpecAdapter,
  resolver: ArtifactResolver,
  store: string | undefined,
  created: Record<string, unknown> | null,
  issue: TrackerIssue | undefined,
): Promise<Record<string, unknown>> {
  const nextArtifact = resolved.status.artifacts.find((artifact) => artifact.status === "ready");
  const base = {
    schemaVersion: 2,
    changeName: name,
    status: resolved.planningComplete ? "complete" : nextArtifact ? "ready" : "blocked",
    created,
    issue: issue ?? null,
    planningComplete: resolved.planningComplete,
    implementationComplete: false,
    isComplete: false,
    changeRoot: resolved.changeRoot,
    artifactPaths: resolved.artifactPaths,
    planningRevision: resolved.planningRevision,
    contract: resolved.contract ? summarizeChangeContract(resolved.contract, cwd) : null,
  };
  if (!nextArtifact) return base;
  const instruction = await resolveArtifactInstruction(
    cwd,
    name,
    nextArtifact.id,
    { store },
    { adapter, resolver },
  );
  return { ...instruction, ...base };
}

function contractError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function updatePlanningBridgePointer(
  cwd: string,
  source: ChangeSource,
  changeName: string,
  headRevision: string,
): void {
  const path = resolve(cwd, "memory", "session-bridge.md");
  if (!existsSync(path)) {
    throw contractError("BRIDGE_CHECKPOINT_MISSING", "RFC-first Propose requires memory/session-bridge.md");
  }
  let content = readFileSync(path, "utf8");
  const issue = source.tracker.issue;
  const fields: Record<string, string> = source.kind === "rfc-slice"
    ? {
        RFC: source.rfc.id,
        "RFC Revision": source.rfc.acceptedCommit,
        Slice: source.slice.id,
        Issue: issue ? `${issue.id} ${issue.url}` : "none",
        Change: changeName,
        Worktree: resolve(cwd),
        "Phase at Checkpoint": "planning_ready",
        "Task Group at Checkpoint": "none",
        "Observed Run Revision": "none",
        "Last Verified HEAD": headRevision,
      }
    : {
        RFC: "maintenance",
        "RFC Revision": "rfc-exempt",
        Slice: "maintenance",
        Issue: issue ? `${issue.id} ${issue.url}` : "none",
        Change: changeName,
        Worktree: resolve(cwd),
        "Phase at Checkpoint": "planning_ready",
        "Task Group at Checkpoint": "none",
        "Observed Run Revision": "none",
        "Last Verified HEAD": headRevision,
      };
  for (const [field, value] of Object.entries(fields)) {
    const expression = new RegExp(`^- \\*\\*${escapeRegExp(field)}\\*\\*:.*$`, "mu");
    if (!expression.test(content)) {
      throw contractError("BRIDGE_CHECKPOINT_INVALID", `Session Bridge is missing '${field}'`);
    }
    content = content.replace(expression, `- **${field}**: ${value}`);
  }
  content = content.replace(
    /^(## Next Action\s*\n)(?:- .*\n)?/mu,
    `$1- Complete strict planning and traceability for \`${changeName}\`, then start Apply.\n`,
  );
  writeFileSync(path, content);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
