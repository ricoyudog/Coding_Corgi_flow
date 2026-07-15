import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLoopV2Command,
  executeLoopV2,
  type LoopPlanningSnapshotV2,
  type LoopSubmissionBundleV2,
  type LoopV2Dependencies,
} from "../src/commands/loop-v2.js";
import {
  createEvidenceBundleV2,
  createFindingTriageV2,
  createReviewFindingV2,
  hashArtifactBytesV2,
  hashCanonicalArtifactV2,
  type EvidenceEntryV2,
} from "../src/lib/evidence-v2.js";
import { createGitWorkspaceV2 } from "../src/lib/git-workspace-v2.js";
import { createRunInitializedEventV2 } from "../src/lib/loop-reducer-v2.js";
import { createSuccessorRunV2 } from "../src/lib/loop-successor-v2.js";
import type { ArtifactHashV2, LoopStateV2 } from "../src/lib/run-contract-v2.js";
import { LoopStoreV2 } from "../src/lib/loop-store-v2.js";

const cleanup: string[] = [];

afterEach(() => {
  for (const root of cleanup.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("loop v2 command functions with real Git and store", () => {
  it("runs init -> submit PASS -> commit acknowledgement -> finalize", async () => {
    const root = repo("golden");
    const planning = planningSnapshot();
    const dependencies = deps(planning);
    const initialized = await executeLoopV2({
      operation: "init",
      projectRoot: root,
      changeName: "example",
      sessionId: "session-1",
      ownerId: "agent-1",
      mode: "hook-driven",
      runId: "run-golden",
    }, dependencies);
    expect(initialized.exitCode).toBe(0);
    expect(initialized.output.state?.phase).toBe("awaiting_group_result");
    expect(initialized.output.action).toEqual({ type: "dispatch_group", groupId: "1", attempt: 1 });

    writeFileSync(resolve(root, "README.md"), "implemented\n");
    const state0 = initialized.output.state!;
    const submission = await submissionFor(root, state0, "PASS", "bundle-pass");
    const submitted = await executeLoopV2({
      operation: "submit",
      projectRoot: root,
      changeName: "example",
      ...token(state0),
      bundle: submission,
    }, dependencies);
    expect(submitted.exitCode).toBe(0);
    expect(submitted.output.state?.phase).toBe("awaiting_group_commit");
    expect(submitted.output.action).toEqual({ type: "commit_group", groupId: "1", attempt: 1 });
    expect(submitted.output.state?.stateRevision).toBe(2);
    const attemptMarker = JSON.parse(readFileSync(resolve(
      root,
      ".corgi/loop/example/runs/run-golden/attempts/1/1/bundle.json",
    ), "utf8"));
    expect(attemptMarker.artifactManifest).toEqual({
      "artifacts/result.json": hashArtifactBytesV2(
        Buffer.from(`${JSON.stringify({ verdict: "PASS" }, null, 2)}\n`),
      ),
    });
    expect(attemptMarker.artifactHash).toBe(
      hashCanonicalArtifactV2(attemptMarker.artifactManifest),
    );

    const repeated = await executeLoopV2({
      operation: "submit",
      projectRoot: root,
      changeName: "example",
      ...token(submitted.output.state!),
      bundle: submission,
    }, dependencies);
    expect(repeated.exitCode).toBe(0);
    expect(repeated.output.idempotent).toBe(true);
    expect(repeated.output.state?.stateRevision).toBe(2);

    const tampered = structuredClone(submission);
    tampered.artifacts["result.json"] = { verdict: "PASS", tampered: true };
    const conflict = await executeLoopV2({
      operation: "submit",
      projectRoot: root,
      changeName: "example",
      ...token(state0),
      bundle: tampered,
    }, dependencies);
    expect(conflict.exitCode).toBe(2);
    expect(conflict.output.error?.code).toBe("stale_state_token");
    const reviewTampered = structuredClone(submission);
    reviewTampered.review.findings = [createReviewFindingV2({
      severity: "suggestion",
      check: "tamper-check",
      description: "This finding was not in the submitted bundle",
    })];
    const reviewConflict = await executeLoopV2({
      operation: "submit",
      projectRoot: root,
      changeName: "example",
      ...token(state0),
      bundle: reviewTampered,
    }, dependencies);
    expect(reviewConflict.exitCode).toBe(2);
    expect(reviewConflict.output.error?.code).toBe("stale_state_token");

    git(root, "add", "README.md");
    git(root, "commit", "-m", "implement task group");
    const state2 = submitted.output.state!;
    const acknowledged = await executeLoopV2({
      operation: "ack-commit",
      projectRoot: root,
      changeName: "example",
      ...token(state2),
    }, dependencies);
    expect(acknowledged.exitCode).toBe(0);
    expect(acknowledged.output.state?.phase).toBe("awaiting_finalize");
    expect(acknowledged.output.action).toEqual({ type: "finalize" });
    expect(acknowledged.output.state?.groups["1"]?.commit.status).toBe("acknowledged");
    const repeatedAck = await executeLoopV2({
      operation: "ack-commit",
      projectRoot: root,
      changeName: "example",
      ...token(state2),
    }, dependencies);
    expect(repeatedAck.exitCode).toBe(0);
    expect(repeatedAck.output.idempotent).toBe(true);

    const state3 = acknowledged.output.state!;
    const finalized = await executeLoopV2({
      operation: "finalize",
      projectRoot: root,
      changeName: "example",
      ...token(state3),
    }, dependencies);
    expect(finalized.exitCode).toBe(0);
    expect(finalized.output.state?.phase).toBe("done");
    expect(finalized.output.action).toMatchObject({ type: "terminal", phase: "done" });
    expect(finalized.output.state?.git.finalRevision).toBe(git(root, "rev-parse", "HEAD"));
    expect(JSON.parse(JSON.stringify(finalized.output))).toEqual(finalized.output);
  });

  it("moves self-driven failure to fixing and accepts a fresh retry attempt", async () => {
    const root = repo("retry");
    const planning = planningSnapshot();
    const dependencies = deps(planning);
    const initialized = await executeLoopV2({
      operation: "init",
      projectRoot: root,
      changeName: "example",
      sessionId: "session-1",
      ownerId: "agent-1",
      mode: "self-driven",
      runId: "run-retry",
      maxAttemptsPerGroup: 2,
    }, dependencies);
    writeFileSync(resolve(root, "README.md"), "first attempt\n");
    const first = initialized.output.state!;
    const failed = await executeLoopV2({
      operation: "submit",
      projectRoot: root,
      changeName: "example",
      ...token(first),
      bundle: await submissionFor(root, first, "FAIL", "bundle-fail"),
    }, dependencies);
    expect(failed.exitCode).toBe(0);
    expect(failed.output.state).toMatchObject({ phase: "fixing", currentAttempt: 2 });
    expect(failed.output.action).toMatchObject({ type: "fix_group", groupId: "1", attempt: 2 });

    writeFileSync(resolve(root, "README.md"), "fixed attempt\n");
    const fixing = failed.output.state!;
    const passed = await executeLoopV2({
      operation: "submit",
      projectRoot: root,
      changeName: "example",
      ...token(fixing),
      bundle: await submissionFor(root, fixing, "PASS", "bundle-fixed"),
    }, dependencies);
    expect(passed.exitCode).toBe(0);
    expect(passed.output.state?.phase).toBe("awaiting_group_commit");
    expect(passed.output.state?.groups["1"]?.attempt).toBe(2);
  });

  it("hard-blocks init before creating canonical state when ready fails", async () => {
    const root = repo("not-ready");
    const planning = planningSnapshot();
    planning.ready = false;
    planning.blockers = ["TASK_GROUP_STRUCTURE: duplicate id"];

    const result = await executeLoopV2({
      operation: "init",
      projectRoot: root,
      changeName: "example",
      sessionId: "session-1",
      ownerId: "agent-1",
    }, deps(planning));

    expect(result.exitCode).toBe(1);
    expect(result.output.status).toBe("blocked");
    expect(result.output.action).toMatchObject({ type: "blocked", reason: { code: "planning_not_ready" } });
    expect(result.output.error?.code).toBe("planning_not_ready");
    expect(existsSync(resolve(root, ".corgi/loop/example"))).toBe(false);
  });

  it("rejects stale CAS and session tokens without changing state or events", async () => {
    const root = repo("cas");
    const planning = planningSnapshot();
    const dependencies = deps(planning);
    const initialized = await executeLoopV2({
      operation: "init",
      projectRoot: root,
      changeName: "example",
      sessionId: "session-1",
      ownerId: "agent-1",
      runId: "run-cas",
    }, dependencies);
    const state = initialized.output.state!;
    const statePath = resolve(root, ".corgi/loop/example/runs/run-cas/state.json");
    const eventsPath = resolve(root, ".corgi/loop/example/runs/run-cas/events.jsonl");
    const beforeState = readFileSync(statePath);
    const beforeEvents = readFileSync(eventsPath);

    const stale = await executeLoopV2({
      operation: "invalidate",
      projectRoot: root,
      changeName: "example",
      ...token(state),
      stateRevision: state.stateRevision + 1,
      reason: "stale caller",
    }, dependencies);
    expect(stale.exitCode).toBe(2);
    expect(stale.output.error?.code).toBe("stale_state_token");
    expect(readFileSync(statePath)).toEqual(beforeState);
    expect(readFileSync(eventsPath)).toEqual(beforeEvents);

    const conflict = await executeLoopV2({
      operation: "invalidate",
      projectRoot: root,
      changeName: "example",
      ...token(state),
      sessionId: "other-session",
      reason: "wrong session",
    }, dependencies);
    expect(conflict.exitCode).toBe(2);
    expect(conflict.output.error?.code).toBe("session_conflict");
    expect(readFileSync(statePath)).toEqual(beforeState);
    expect(readFileSync(eventsPath)).toEqual(beforeEvents);
  });

  it("never repairs a stale current pointer for a wrong-session or stale-token mutation", async () => {
    const root = repo("stale-pointer-no-write");
    const planning = planningSnapshot();
    const dependencies = deps(planning);
    const initialized = await executeLoopV2({
      operation: "init", projectRoot: root, changeName: "example",
      sessionId: "session-1", ownerId: "agent-1", runId: "run-stale-pointer",
    }, dependencies);
    const state = initialized.output.state!;
    const runRoot = resolve(root, ".corgi/loop/example/runs/run-stale-pointer");
    const statePath = resolve(runRoot, "state.json");
    const eventsPath = resolve(runRoot, "events.jsonl");
    const currentPath = resolve(root, ".corgi/loop/example/current.json");
    const stalePointer = JSON.parse(readFileSync(currentPath, "utf8"));
    stalePointer.stateRevision += 10;
    stalePointer.nonce = "stale-pointer-nonce";
    writeFileSync(currentPath, `${JSON.stringify(stalePointer, null, 2)}\n`);
    const before = [readFileSync(statePath), readFileSync(eventsPath), readFileSync(currentPath)];

    for (const request of [
      { ...token(state), sessionId: "wrong-session" },
      { ...token(state), stateRevision: state.stateRevision + 1 },
    ]) {
      const result = await executeLoopV2({
        operation: "invalidate", projectRoot: root, changeName: "example",
        ...request, reason: "must remain read-only",
      }, dependencies);
      expect(result.exitCode).toBe(2);
      expect(result.output.error?.code).toBe("LOOP_RECOVERY_REQUIRED");
      expect(result.output.error?.message).toContain("corgispec loop inspect");
      expect([readFileSync(statePath), readFileSync(eventsPath), readFileSync(currentPath)]).toEqual(before);
    }
  });

  it("inspects and explicitly invalidates a canonical run", async () => {
    const root = repo("inspect-invalidate");
    const planning = planningSnapshot();
    const dependencies = deps(planning);
    const initialized = await executeLoopV2({
      operation: "init",
      projectRoot: root,
      changeName: "example",
      sessionId: "session-1",
      ownerId: "agent-1",
      runId: "run-inspect",
    }, dependencies);
    const inspected = await executeLoopV2({
      operation: "inspect",
      projectRoot: root,
      changeName: "example",
    }, dependencies);
    expect(inspected.output).toMatchObject({
      status: "ok",
      recovered: false,
      state: { runId: "run-inspect" },
    });

    const invalidated = await executeLoopV2({
      operation: "invalidate",
      projectRoot: root,
      changeName: "example",
      ...token(initialized.output.state!),
      reason: "planning superseded",
      reasonCode: "planning_invalidated",
    }, dependencies);
    expect(invalidated.exitCode).toBe(0);
    expect(invalidated.output.state).toMatchObject({
      phase: "invalidated",
      blockedReason: { code: "planning_invalidated" },
    });
  });

  it("rejects malformed full bundles before creating attempt artifacts", async () => {
    const root = repo("bundle-invalid");
    const planning = planningSnapshot();
    const dependencies = deps(planning);
    const initialized = await executeLoopV2({
      operation: "init",
      projectRoot: root,
      changeName: "example",
      sessionId: "session-1",
      ownerId: "agent-1",
      runId: "run-invalid-bundle",
    }, dependencies);
    const state = initialized.output.state!;

    const invalid = await executeLoopV2({
      operation: "submit",
      projectRoot: root,
      changeName: "example",
      ...token(state),
      bundle: { schemaVersion: 2 } as LoopSubmissionBundleV2,
    }, dependencies);

    expect(invalid.exitCode).toBe(2);
    expect(existsSync(resolve(
      root,
      ".corgi/loop/example/runs/run-invalid-bundle/attempts",
    ))).toBe(false);
  });

  it("persists planning invalidation before writing any attempt bundle", async () => {
    const root = repo("planning-invalidated");
    const planning = planningSnapshot();
    const dependencies = deps(planning);
    const initialized = await executeLoopV2({
      operation: "init",
      projectRoot: root,
      changeName: "example",
      sessionId: "session-1",
      ownerId: "agent-1",
      runId: "run-planning-invalidated",
    }, dependencies);
    planning.planningRevision = hashCanonicalArtifactV2({ planning: "changed" });

    const result = await executeLoopV2({
      operation: "submit",
      projectRoot: root,
      changeName: "example",
      ...token(initialized.output.state!),
      bundle: { schemaVersion: 2 } as LoopSubmissionBundleV2,
    }, dependencies);

    expect(result.exitCode).toBe(1);
    expect(result.output.state).toMatchObject({
      phase: "invalidated",
      blockedReason: { code: "planning_invalidated" },
    });
    expect(existsSync(resolve(
      root,
      ".corgi/loop/example/runs/run-planning-invalidated/attempts",
    ))).toBe(false);
  });

  it("persists worktree_missing when Git disappears after a trusted CAS", async () => {
    const root = repo("worktree-missing");
    const planning = planningSnapshot();
    const dependencies = deps(planning);
    const initialized = await executeLoopV2({
      operation: "init",
      projectRoot: root,
      changeName: "example",
      sessionId: "session-1",
      ownerId: "agent-1",
      runId: "run-worktree-missing",
    }, dependencies);
    const state = initialized.output.state!;
    writeFileSync(resolve(root, "README.md"), "implementation\n");
    const bundle = await submissionFor(root, state, "PASS", "bundle-before-missing");
    rmSync(resolve(root, ".git"), { recursive: true, force: true });

    const result = await executeLoopV2({
      operation: "submit",
      projectRoot: root,
      changeName: "example",
      ...token(state),
      bundle,
    }, dependencies);

    expect(result.exitCode).toBe(1);
    expect(result.output.state).toMatchObject({
      phase: "worktree_missing",
      blockedReason: {
        code: "worktree_missing",
        details: { previousPhase: "awaiting_group_result", operation: "submit" },
      },
    });
  });

  it("persists circuit_breaker before an operation would exceed maxEvents", async () => {
    const root = repo("event-limit");
    const planning = planningSnapshot();
    const dependencies = deps(planning);
    const initialized = await executeLoopV2({
      operation: "init",
      projectRoot: root,
      changeName: "example",
      sessionId: "session-1",
      ownerId: "agent-1",
      runId: "run-event-limit",
      maxEvents: 1,
    }, dependencies);
    const state = initialized.output.state!;
    writeFileSync(resolve(root, "README.md"), "implementation\n");

    const result = await executeLoopV2({
      operation: "submit",
      projectRoot: root,
      changeName: "example",
      ...token(state),
      bundle: await submissionFor(root, state, "PASS", "bundle-over-limit"),
    }, dependencies);

    expect(result.exitCode).toBe(1);
    expect(result.output.state).toMatchObject({
      phase: "circuit_breaker",
      stateRevision: 1,
      blockedReason: { code: "circuit_breaker" },
    });
  });

  it("reserves the final event slot instead of leaving an active run unable to finalize", async () => {
    const root = repo("event-limit-final-slot");
    const planning = planningSnapshot();
    const dependencies = deps(planning);
    const initialized = await executeLoopV2({
      operation: "init",
      projectRoot: root,
      changeName: "example",
      sessionId: "session-1",
      ownerId: "agent-1",
      runId: "run-event-limit-final-slot",
      maxEvents: 3,
    }, dependencies);
    const initial = initialized.output.state!;
    writeFileSync(resolve(root, "README.md"), "implementation\n");
    const submitted = await executeLoopV2({
      operation: "submit",
      projectRoot: root,
      changeName: "example",
      ...token(initial),
      bundle: await submissionFor(root, initial, "PASS", "bundle-final-slot"),
    }, dependencies);
    expect(submitted.output.state).toMatchObject({
      phase: "awaiting_group_commit",
      lastEventSeq: 2,
    });
    git(root, "add", "README.md");
    git(root, "commit", "-m", "implementation");

    const acknowledged = await executeLoopV2({
      operation: "ack-commit",
      projectRoot: root,
      changeName: "example",
      ...token(submitted.output.state!),
    }, dependencies);

    expect(acknowledged.exitCode).toBe(1);
    expect(acknowledged.output.state).toMatchObject({
      phase: "circuit_breaker",
      lastEventSeq: 3,
      groups: { "1": { commit: { status: "pending" } } },
      blockedReason: {
        code: "circuit_breaker",
        details: { maxEvents: 3, eventCost: 1 },
      },
    });
    const events = readFileSync(resolve(
      root,
      ".corgi/loop/example/runs/run-event-limit-final-slot/events.jsonl",
    ), "utf8").trim().split("\n").map((line) => JSON.parse(line).event.type);
    expect(events).toEqual([
      "run_initialized",
      "bundle_submitted",
      "evaluation_completed",
      "run_blocked",
    ]);
  });

  it("accepts only human triage for a real review fingerprint and persists it via the store", async () => {
    const root = repo("triage");
    const planning = planningSnapshot();
    const dependencies = deps(planning);
    const initialized = await executeLoopV2({
      operation: "init",
      projectRoot: root,
      changeName: "example",
      sessionId: "session-1",
      ownerId: "human-1",
      ownerKind: "human",
      runId: "run-triage",
    }, dependencies);
    const state = initialized.output.state!;
    writeFileSync(resolve(root, "README.md"), "implementation\n");
    const bundle = await submissionFor(root, state, "PASS", "bundle-triage");
    const finding = createReviewFindingV2({
      severity: "suggestion",
      check: "maintainability",
      description: "Consider a follow-up refactor",
    });
    bundle.review.findings = [finding];
    bundle.triage = [createFindingTriageV2({
      findingFingerprint: finding.fingerprint,
      disposition: "accepted-risk",
      actor: { kind: "human", id: "human-1" },
      reason: "Accepted for this release candidate",
      occurredAt: "2026-07-15T00:00:00.000Z",
    })];

    const result = await executeLoopV2({
      operation: "submit",
      projectRoot: root,
      changeName: "example",
      ...token(state),
      bundle,
    }, dependencies);

    expect(result.exitCode).toBe(0);
    expect(result.output.state?.phase).toBe("awaiting_group_commit");
    expect(result.output.normalizedReviewTriage).toEqual(bundle.triage);
    const triageLog = readFileSync(
      resolve(root, ".corgi/loop/example/runs/run-triage/review-triage.jsonl"),
      "utf8",
    );
    expect(triageLog).toContain(finding.fingerprint);
    expect(triageLog).toContain("accepted-risk");
    const [triageRecord] = triageLog.trim().split("\n").map((line) => JSON.parse(line));
    expect(triageRecord).toMatchObject({
      runId: "run-triage",
      groupId: "1",
      attempt: 1,
      bundleId: "bundle-triage",
    });
    const review = JSON.parse(readFileSync(resolve(
      root,
      ".corgi/loop/example/runs/run-triage/attempts/1/1/review.json",
    ), "utf8"));
    expect(review).toEqual({ findings: [finding], triage: bundle.triage });
  });

  it("marks a FAIL review clean when every finding was triaged for that exact attempt", async () => {
    const root = repo("fail-with-triage");
    const planning = planningSnapshot();
    const dependencies = deps(planning);
    const initialized = await executeLoopV2({
      operation: "init", projectRoot: root, changeName: "example",
      sessionId: "session-1", ownerId: "human-1", ownerKind: "human",
      runId: "run-fail-with-triage",
    }, dependencies);
    const state = initialized.output.state!;
    writeFileSync(resolve(root, "README.md"), "failing implementation\n");
    const bundle = await submissionFor(root, state, "FAIL", "bundle-fail-with-triage");
    const finding = createReviewFindingV2({
      severity: "suggestion",
      check: "maintainability",
      description: "Defer a cleanup",
    });
    bundle.review.findings = [finding];
    bundle.triage = [createFindingTriageV2({
      findingFingerprint: finding.fingerprint,
      disposition: "accepted-risk",
      actor: { kind: "human", id: "human-1" },
      reason: "Not the verification failure under test",
      occurredAt: "2026-07-15T00:00:00.000Z",
    })];

    const result = await executeLoopV2({
      operation: "submit", projectRoot: root, changeName: "example",
      ...token(state), bundle,
    }, dependencies);
    expect(result.output.state?.phase).toBe("verification_failed");
    const records = readFileSync(resolve(
      root,
      ".corgi/loop/example/runs/run-fail-with-triage/events.jsonl",
    ), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(records.at(-1)?.event).toMatchObject({
      type: "evaluation_completed",
      result: "verification_failed",
      reviewClean: true,
    });
  });

  it("auto-migrates exactly one legacy v1 run during inspect and reports stale artifacts", async () => {
    const root = repo("migration");
    const legacyRoot = resolve(root, ".claude/corgi-loop/example");
    mkdirSync(resolve(legacyRoot, "groups/1"), { recursive: true });
    writeFileSync(resolve(legacyRoot, "state.json"), JSON.stringify({
      schemaVersion: 1,
      active: true,
      changeName: "example",
      sessionId: "legacy-session",
      currentGroup: 1,
      totalGroups: 1,
      completedGroups: [],
      groupStatuses: { "1": "in_progress" },
      pushStatus: {},
      retryCount: 0,
      maxRetries: 2,
      selfDriven: false,
      startedAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:01:00.000Z",
    }));
    writeFileSync(resolve(legacyRoot, "groups/1/verify.json"), "{}\n");
    writeFileSync(resolve(legacyRoot, "groups/1/review.json"), "{}\n");

    const result = await executeLoopV2({
      operation: "inspect",
      projectRoot: root,
      changeName: "example",
    }, deps(planningSnapshot()));

    expect(result.exitCode).toBe(0);
    expect(result.output.migrated).toBe(true);
    expect(result.output.state).toMatchObject({
      schemaVersion: 2,
      sessionId: "legacy-session",
      currentGroupId: "1",
    });
    expect(result.output.staleArtifacts).toEqual(expect.arrayContaining([
      "legacy/claude/current-group/verify.json",
      "legacy/claude/current-group/review.json",
    ]));
  });

  it("requires every Task Group to create a commit after the previous group revision", async () => {
    const root = repo("per-group-commit");
    const planning = planningSnapshot();
    planning.groups.push({ id: "2", fingerprint: hashCanonicalArtifactV2({ group: 2 }) });
    const dependencies = deps(planning);
    const initialized = await executeLoopV2({
      operation: "init",
      projectRoot: root,
      changeName: "example",
      sessionId: "session-1",
      ownerId: "agent-1",
      runId: "run-two-groups",
    }, dependencies);
    writeFileSync(resolve(root, "README.md"), "group one\n");
    const groupOne = initialized.output.state!;
    const submittedOne = await executeLoopV2({
      operation: "submit", projectRoot: root, changeName: "example",
      ...token(groupOne), bundle: await submissionFor(root, groupOne, "PASS", "bundle-one"),
    }, dependencies);
    git(root, "add", "README.md");
    git(root, "commit", "-m", "group one");
    const ackOne = await executeLoopV2({
      operation: "ack-commit", projectRoot: root, changeName: "example",
      ...token(submittedOne.output.state!),
    }, dependencies);
    expect(ackOne.output.state).toMatchObject({ phase: "awaiting_group_result", currentGroupId: "2" });

    // Submit group two against the unchanged clean tree, then attempt to reuse
    // the group-one commit. The second acknowledgement must fail.
    const groupTwo = ackOne.output.state!;
    const submittedTwo = await executeLoopV2({
      operation: "submit", projectRoot: root, changeName: "example",
      ...token(groupTwo), bundle: await submissionFor(root, groupTwo, "PASS", "bundle-two"),
    }, dependencies);
    const ackTwo = await executeLoopV2({
      operation: "ack-commit", projectRoot: root, changeName: "example",
      ...token(submittedTwo.output.state!),
    }, dependencies);
    expect(ackTwo.exitCode).toBe(2);
    expect(ackTwo.output.error?.code).toBe("git_commit_unchanged");
  });

  it("blocks finalize when HEAD moved beyond the last acknowledged group commit", async () => {
    const root = repo("final-head");
    const planning = planningSnapshot();
    const dependencies = deps(planning);
    const initialized = await executeLoopV2({
      operation: "init", projectRoot: root, changeName: "example",
      sessionId: "session-1", ownerId: "agent-1", runId: "run-final-head",
    }, dependencies);
    writeFileSync(resolve(root, "README.md"), "implemented\n");
    const initial = initialized.output.state!;
    const submitted = await executeLoopV2({
      operation: "submit", projectRoot: root, changeName: "example",
      ...token(initial), bundle: await submissionFor(root, initial, "PASS", "bundle-final-head"),
    }, dependencies);
    git(root, "add", "README.md");
    git(root, "commit", "-m", "group commit");
    const acknowledged = await executeLoopV2({
      operation: "ack-commit", projectRoot: root, changeName: "example",
      ...token(submitted.output.state!),
    }, dependencies);
    git(root, "commit", "--allow-empty", "-m", "unexpected empty commit");

    const finalized = await executeLoopV2({
      operation: "finalize", projectRoot: root, changeName: "example",
      ...token(acknowledged.output.state!),
    }, dependencies);
    expect(finalized.exitCode).toBe(2);
    expect(finalized.output.error?.code).toBe("git_revision_changed");
  });

  it("fails finalization without a canonical event when attempt evidence is deleted or tampered", async () => {
    for (const scenario of [
      { name: "deleted", expectedCode: "canonical_attempt_missing" },
      { name: "tampered", expectedCode: "canonical_hash_mismatch" },
    ]) {
      const root = repo(`finalize-attempt-${scenario.name}`);
      const planning = planningSnapshot();
      const dependencies = deps(planning);
      const initialized = await executeLoopV2({
        operation: "init", projectRoot: root, changeName: "example",
        sessionId: "session-1", ownerId: "agent-1",
        runId: `run-finalize-attempt-${scenario.name}`,
      }, dependencies);
      const initial = initialized.output.state!;
      writeFileSync(resolve(root, "README.md"), `implemented ${scenario.name}\n`);
      const submitted = await executeLoopV2({
        operation: "submit", projectRoot: root, changeName: "example",
        ...token(initial),
        bundle: await submissionFor(root, initial, "PASS", `bundle-${scenario.name}`),
      }, dependencies);
      git(root, "add", "README.md");
      git(root, "commit", "-m", `implementation ${scenario.name}`);
      const acknowledged = await executeLoopV2({
        operation: "ack-commit", projectRoot: root, changeName: "example",
        ...token(submitted.output.state!),
      }, dependencies);
      const state = acknowledged.output.state!;
      expect(state.phase).toBe("awaiting_finalize");
      const runRoot = resolve(
        root,
        `.corgi/loop/example/runs/run-finalize-attempt-${scenario.name}`,
      );
      const statePath = resolve(runRoot, "state.json");
      const eventsPath = resolve(runRoot, "events.jsonl");
      const before = [readFileSync(statePath), readFileSync(eventsPath)];
      if (scenario.name === "deleted") {
        rmSync(resolve(runRoot, "attempts/1/1/evidence.json"));
      } else {
        writeFileSync(
          resolve(runRoot, "attempts/1/1/artifacts/result.json"),
          `${JSON.stringify({ tampered: true }, null, 2)}\n`,
        );
      }

      const finalized = await executeLoopV2({
        operation: "finalize", projectRoot: root, changeName: "example",
        ...token(state),
      }, dependencies);
      expect(finalized.exitCode).toBe(2);
      expect(finalized.output.error?.code).toBe(scenario.expectedCode);
      expect([readFileSync(statePath), readFileSync(eventsPath)]).toEqual(before);
      expect((await new LoopStoreV2({ projectRoot: root }).peek("example")).state?.phase)
        .toBe("awaiting_finalize");
    }
  });

  it("normalizes malformed bundle files and missing CAS flags to pure JSON exit 2", async () => {
    const root = repo("cli-input");
    const malformed = resolve(root, "malformed.json");
    writeFileSync(malformed, "{bad-json");
    const writes: string[] = [];
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as typeof process.stderr.write);
    const originalExitCode = process.exitCode;
    try {
      await createLoopV2Command().parseAsync([
        "node", "test", "submit", "example", "--path", root,
        "--bundle", malformed, "--json",
      ]);
      expect(process.exitCode).toBe(2);
      expect(writes).toHaveLength(1);
      expect(JSON.parse(writes[0]!)).toMatchObject({
        operation: "submit",
        status: "error",
        error: { code: "input_invalid" },
      });
      expect(stderr).not.toHaveBeenCalled();

      writes.length = 0;
      writeFileSync(malformed, "{}\n");
      await createLoopV2Command().parseAsync([
        "node", "test", "submit", "example", "--path", root,
        "--bundle", malformed, "--json",
      ]);
      expect(JSON.parse(writes[0]!)).toMatchObject({
        status: "error",
        error: { code: "input_invalid", message: expect.stringContaining("runId") },
      });
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      process.exitCode = originalExitCode;
    }
  });

  it("normalizes malformed submit stdin to pure JSON exit 2", async () => {
    const root = repo("cli-stdin");
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin")!;
    const writes: string[] = [];
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as typeof process.stderr.write);
    const originalExitCode = process.exitCode;
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: Readable.from(["{malformed"]),
    });
    try {
      await createLoopV2Command().parseAsync([
        "node", "test", "submit", "example", "--path", root, "--json",
      ]);
      expect(process.exitCode).toBe(2);
      expect(JSON.parse(writes[0]!)).toMatchObject({
        operation: "submit",
        status: "error",
        error: { code: "input_invalid" },
      });
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "stdin", stdinDescriptor);
      stdout.mockRestore();
      stderr.mockRestore();
      process.exitCode = originalExitCode;
    }
  });

  it("rejects a non-active resume target at the CLI boundary without a store write", async () => {
    const root = repo("cli-resume-target");
    const dependencies = deps(planningSnapshot());
    const initialized = await executeLoopV2({
      operation: "init", projectRoot: root, changeName: "example",
      sessionId: "session-1", ownerId: "agent-1", runId: "run-cli-resume-target",
    }, dependencies);
    const state = initialized.output.state!;
    const runRoot = resolve(root, ".corgi/loop/example/runs/run-cli-resume-target");
    const statePath = resolve(runRoot, "state.json");
    const eventsPath = resolve(runRoot, "events.jsonl");
    const before = [readFileSync(statePath), readFileSync(eventsPath)];
    const writes: string[] = [];
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as typeof process.stderr.write);
    const originalExitCode = process.exitCode;
    try {
      await createLoopV2Command(dependencies).parseAsync([
        "node", "test", "resume", "example", "--path", root,
        "--run-id", state.runId, "--session", state.sessionId,
        "--state-revision", String(state.stateRevision), "--nonce", state.nonce,
        "--target-phase", "done", "--json",
      ]);
      expect(process.exitCode).toBe(2);
      expect(JSON.parse(writes[0]!)).toMatchObject({
        operation: "resume",
        status: "error",
        error: { code: "input_invalid" },
      });
      expect(stderr).not.toHaveBeenCalled();
      expect([readFileSync(statePath), readFileSync(eventsPath)]).toEqual(before);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      process.exitCode = originalExitCode;
    }
  });

  it("recovers an exact submit retry after a crash between submission and evaluation", async () => {
    const root = repo("partial-submit");
    const planning = planningSnapshot();
    let activeStore = new LoopStoreV2({ projectRoot: root });
    const dependencies: LoopV2Dependencies = {
      ...deps(planning),
      createStore: () => activeStore,
    };
    const initialized = await executeLoopV2({
      operation: "init", projectRoot: root, changeName: "example",
      sessionId: "session-1", ownerId: "agent-1", runId: "run-partial",
    }, dependencies);
    const initial = initialized.output.state!;
    writeFileSync(resolve(root, "README.md"), "implementation\n");
    const bundle = await submissionFor(root, initial, "PASS", "bundle-partial");
    let stateRenames = 0;
    activeStore = new LoopStoreV2({
      projectRoot: root,
      faults: (point) => {
        if (point === "after_state_rename" && ++stateRenames === 1) {
          throw new Error("synthetic crash after first post-state");
        }
      },
    });
    const crashed = await executeLoopV2({
      operation: "submit", projectRoot: root, changeName: "example",
      ...token(initial), bundle,
    }, dependencies);
    expect(crashed.exitCode).toBe(2);

    activeStore = new LoopStoreV2({ projectRoot: root });
    const partial = await activeStore.inspect("example");
    expect(partial.state?.phase).toBe("awaiting_evaluation");
    expect(partial.events.map((record) => record.event.type)).toEqual([
      "run_initialized",
      "bundle_submitted",
    ]);

    const recovered = await executeLoopV2({
      operation: "submit", projectRoot: root, changeName: "example",
      ...token(initial), bundle,
    }, dependencies);
    expect(recovered.exitCode).toBe(0);
    expect(recovered.output.state?.phase).toBe("awaiting_group_commit");
    expect((await activeStore.inspect("example")).events.map((record) => record.event.type)).toEqual([
      "run_initialized",
      "bundle_submitted",
      "evaluation_completed",
    ]);
  });

  it("rejects duplicate triage fingerprints before any canonical or attempt write", async () => {
    const root = repo("duplicate-triage");
    const planning = planningSnapshot();
    const dependencies = deps(planning);
    const initialized = await executeLoopV2({
      operation: "init", projectRoot: root, changeName: "example",
      sessionId: "session-1", ownerId: "human-1", ownerKind: "human",
      runId: "run-duplicate-triage",
    }, dependencies);
    const state = initialized.output.state!;
    writeFileSync(resolve(root, "README.md"), "implementation\n");
    const bundle = await submissionFor(root, state, "PASS", "bundle-duplicate-triage");
    const finding = createReviewFindingV2({
      severity: "suggestion",
      check: "quality",
      description: "One finding",
    });
    const triage = createFindingTriageV2({
      findingFingerprint: finding.fingerprint,
      disposition: "dismissed",
      actor: { kind: "human", id: "human-1" },
      reason: "Duplicate test",
      occurredAt: "2026-07-15T00:00:00.000Z",
    });
    bundle.review.findings = [finding];
    bundle.triage = [triage, structuredClone(triage)];
    const statePath = resolve(root, ".corgi/loop/example/runs/run-duplicate-triage/state.json");
    const eventsPath = resolve(root, ".corgi/loop/example/runs/run-duplicate-triage/events.jsonl");
    const triagePath = resolve(root, ".corgi/loop/example/runs/run-duplicate-triage/review-triage.jsonl");
    const before = [readFileSync(statePath), readFileSync(eventsPath), readFileSync(triagePath)];

    const result = await executeLoopV2({
      operation: "submit", projectRoot: root, changeName: "example",
      ...token(state), bundle,
    }, dependencies);
    expect(result.exitCode).toBe(2);
    expect(result.output.error?.code).toBe("triage_invalid");
    expect([readFileSync(statePath), readFileSync(eventsPath), readFileSync(triagePath)]).toEqual(before);
    expect(existsSync(resolve(
      root,
      ".corgi/loop/example/runs/run-duplicate-triage/attempts",
    ))).toBe(false);
  });

  it("generates and returns stable review fingerprints when submit input omits them", async () => {
    const root = repo("finding-normalization");
    const planning = planningSnapshot();
    const dependencies = deps(planning);
    const initialized = await executeLoopV2({
      operation: "init", projectRoot: root, changeName: "example",
      sessionId: "session-1", ownerId: "agent-1", runId: "run-finding-normalization",
    }, dependencies);
    const state = initialized.output.state!;
    writeFileSync(resolve(root, "README.md"), "implementation\n");
    const bundle = await submissionFor(root, state, "PASS", "bundle-finding-normalization");
    bundle.review.findings = [{
      severity: "important",
      check: "spec coverage",
      description: "A required scenario is not covered",
    }];

    const result = await executeLoopV2({
      operation: "submit", projectRoot: root, changeName: "example",
      ...token(state), bundle,
    }, dependencies);

    expect(result.exitCode).toBe(1);
    expect(result.output.state?.phase).toBe("review_failed");
    expect(result.output.normalizedReviewFindings).toHaveLength(1);
    expect(result.output.normalizedReviewFindings?.[0]?.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    const review = JSON.parse(readFileSync(resolve(
      root,
      ".corgi/loop/example/runs/run-finding-normalization/attempts/1/1/review.json",
    ), "utf8"));
    expect(review.findings[0].fingerprint).toBe(
      result.output.normalizedReviewFindings?.[0]?.fingerprint,
    );
  });

  it("normalizes a safe PASS draft and deterministically replays the exact original draft", async () => {
    const root = repo("draft-submit");
    const planning = planningSnapshot();
    const dependencies = deps(planning);
    const initialized = await executeLoopV2({
      operation: "init", projectRoot: root, changeName: "example",
      sessionId: "session-1", ownerId: "agent-1", runId: "run-draft",
    }, dependencies);
    const state = initialized.output.state!;
    writeFileSync(resolve(root, "README.md"), "draft implementation\n");
    const draft: LoopSubmissionBundleV2 = {
      schemaVersion: 2,
      evidence: {
        verdict: "PASS",
        evidence: [{
          id: "tests",
          kind: "test",
          status: "pass",
          provenance: "cli",
          command: "npm test",
          cwd: root,
          exitCode: 0,
        }],
      },
      review: {
        findings: [],
      },
      artifacts: { "test-result.json": { passed: true } },
    };

    const submitted = await executeLoopV2({
      operation: "submit", projectRoot: root, changeName: "example",
      ...token(state), bundle: draft,
    }, dependencies);
    expect(submitted.exitCode).toBe(0);
    expect(submitted.output.normalizedEvidence).toMatchObject({
      schemaVersion: 2,
      verdict: "PASS",
      binding: {
        runId: "run-draft",
        groupId: "1",
        attempt: 1,
        planningRevision: state.planningRevision,
      },
    });
    expect(submitted.output.submissionContext?.bundleId).toMatch(/^bundle-[a-f0-9]{32}$/);

    const replayed = await executeLoopV2({
      operation: "submit", projectRoot: root, changeName: "example",
      ...token(state), bundle: structuredClone(draft),
    }, dependencies);
    expect(replayed.exitCode).toBe(0);
    expect(replayed.output.idempotent).toBe(true);
    expect(replayed.output.normalizedEvidence).toEqual(submitted.output.normalizedEvidence);
    expect(replayed.output.submissionContext).toEqual(submitted.output.submissionContext);
  });

  it("rejects forged partial evidence binding/hash claims without any write", async () => {
    const root = repo("forged-draft");
    const planning = planningSnapshot();
    const dependencies = deps(planning);
    const initialized = await executeLoopV2({
      operation: "init", projectRoot: root, changeName: "example",
      sessionId: "session-1", ownerId: "agent-1", runId: "run-forged-draft",
    }, dependencies);
    const state = initialized.output.state!;
    writeFileSync(resolve(root, "README.md"), "implementation\n");
    const statePath = resolve(root, ".corgi/loop/example/runs/run-forged-draft/state.json");
    const eventsPath = resolve(root, ".corgi/loop/example/runs/run-forged-draft/events.jsonl");
    const before = [readFileSync(statePath), readFileSync(eventsPath)];
    const forged: LoopSubmissionBundleV2 = {
      schemaVersion: 2,
      evidence: {
        verdict: "PASS",
        binding: { runId: "forged-run" },
        evidence: [{
          id: "tests",
          kind: "test",
          status: "pass",
          provenance: "cli",
          command: "npm test",
          cwd: root,
          exitCode: 0,
        }],
      },
      review: { findings: [] },
      artifacts: { "result.json": { passed: true } },
    };

    const result = await executeLoopV2({
      operation: "submit", projectRoot: root, changeName: "example",
      ...token(state), bundle: forged,
    }, dependencies);
    expect(result.exitCode).toBe(2);
    expect(result.output.error?.code).toBe("evidence_claim_invalid");
    expect([readFileSync(statePath), readFileSync(eventsPath)]).toEqual(before);
    expect(existsSync(resolve(
      root,
      ".corgi/loop/example/runs/run-forged-draft/attempts",
    ))).toBe(false);
  });

  it("rejects portable artifact path collisions before any attempt write", async () => {
    const root = repo("artifact-collision");
    const planning = planningSnapshot();
    const dependencies = deps(planning);
    const initialized = await executeLoopV2({
      operation: "init", projectRoot: root, changeName: "example",
      sessionId: "session-1", ownerId: "agent-1", runId: "run-artifact-collision",
    }, dependencies);
    const state = initialized.output.state!;
    writeFileSync(resolve(root, "README.md"), "implementation\n");
    const bundle = await submissionFor(root, state, "PASS", "bundle-artifact-collision");
    bundle.artifacts = {
      "nested/result.json": { source: "slash" },
      "nested\\result.json": { source: "backslash" },
    };
    const statePath = resolve(root, ".corgi/loop/example/runs/run-artifact-collision/state.json");
    const eventsPath = resolve(root, ".corgi/loop/example/runs/run-artifact-collision/events.jsonl");
    const before = [readFileSync(statePath), readFileSync(eventsPath)];

    const result = await executeLoopV2({
      operation: "submit", projectRoot: root, changeName: "example",
      ...token(state), bundle,
    }, dependencies);
    expect(result.exitCode).toBe(2);
    expect(result.output.error?.code).toBe("artifacts_invalid");
    expect([readFileSync(statePath), readFileSync(eventsPath)]).toEqual(before);
    expect(existsSync(resolve(
      root,
      ".corgi/loop/example/runs/run-artifact-collision/attempts",
    ))).toBe(false);
  });

  it("infers commit and finalize resume targets from the durable pre-block phase", async () => {
    const planning = planningSnapshot();

    const ackRoot = repo("resume-missing-ack");
    const ackDependencies = deps(planning);
    const ackInitialized = await executeLoopV2({
      operation: "init", projectRoot: ackRoot, changeName: "example",
      sessionId: "session-1", ownerId: "agent-1", runId: "run-resume-ack",
    }, ackDependencies);
    const ackInitialState = ackInitialized.output.state!;
    writeFileSync(resolve(ackRoot, "README.md"), "implementation\n");
    const ackSubmitted = await executeLoopV2({
      operation: "submit", projectRoot: ackRoot, changeName: "example",
      ...token(ackInitialState),
      bundle: await submissionFor(ackRoot, ackInitialState, "PASS", "bundle-resume-ack"),
    }, ackDependencies);
    rmSync(resolve(ackRoot, ".git"), { recursive: true, force: true });
    const ackBlocked = await executeLoopV2({
      operation: "ack-commit", projectRoot: ackRoot, changeName: "example",
      ...token(ackSubmitted.output.state!),
    }, ackDependencies);
    expect(ackBlocked.output.state).toMatchObject({
      phase: "worktree_missing",
      blockedReason: {
        details: { previousPhase: "awaiting_group_commit", operation: "ack-commit" },
      },
    });
    const ackResumed = await executeLoopV2({
      operation: "resume", projectRoot: ackRoot, changeName: "example",
      ...token(ackBlocked.output.state!),
    }, ackDependencies);
    expect(ackResumed.output.state?.phase).toBe("awaiting_group_commit");

    const finalizeRoot = repo("resume-missing-finalize");
    const finalizeDependencies = deps(planning);
    const finalizeInitialized = await executeLoopV2({
      operation: "init", projectRoot: finalizeRoot, changeName: "example",
      sessionId: "session-1", ownerId: "agent-1", runId: "run-resume-finalize",
    }, finalizeDependencies);
    const finalizeInitialState = finalizeInitialized.output.state!;
    writeFileSync(resolve(finalizeRoot, "README.md"), "implementation\n");
    const finalizeSubmitted = await executeLoopV2({
      operation: "submit", projectRoot: finalizeRoot, changeName: "example",
      ...token(finalizeInitialState),
      bundle: await submissionFor(
        finalizeRoot,
        finalizeInitialState,
        "PASS",
        "bundle-resume-finalize",
      ),
    }, finalizeDependencies);
    git(finalizeRoot, "add", "README.md");
    git(finalizeRoot, "commit", "-m", "implementation");
    const acknowledged = await executeLoopV2({
      operation: "ack-commit", projectRoot: finalizeRoot, changeName: "example",
      ...token(finalizeSubmitted.output.state!),
    }, finalizeDependencies);
    expect(acknowledged.output.state?.phase).toBe("awaiting_finalize");
    rmSync(resolve(finalizeRoot, ".git"), { recursive: true, force: true });
    const finalizeBlocked = await executeLoopV2({
      operation: "finalize", projectRoot: finalizeRoot, changeName: "example",
      ...token(acknowledged.output.state!),
    }, finalizeDependencies);
    expect(finalizeBlocked.output.state).toMatchObject({
      phase: "worktree_missing",
      blockedReason: {
        details: { previousPhase: "awaiting_finalize", operation: "finalize" },
      },
    });
    const finalizeResumed = await executeLoopV2({
      operation: "resume", projectRoot: finalizeRoot, changeName: "example",
      ...token(finalizeBlocked.output.state!),
    }, finalizeDependencies);
    expect(finalizeResumed.output.state?.phase).toBe("awaiting_finalize");
  });

  it("requires the first new successor group commit to advance beyond its newer baseline", async () => {
    const root = repo("successor-baseline");
    const initialPlanning = planningSnapshot();
    const initialDependencies = deps(initialPlanning);
    const initialized = await executeLoopV2({
      operation: "init", projectRoot: root, changeName: "example",
      sessionId: "session-1", ownerId: "agent-1", runId: "run-old-baseline",
    }, initialDependencies);
    const state0 = initialized.output.state!;
    writeFileSync(resolve(root, "README.md"), "old group implementation\n");
    const submitted = await executeLoopV2({
      operation: "submit", projectRoot: root, changeName: "example",
      ...token(state0),
      bundle: await submissionFor(root, state0, "PASS", "bundle-old-group"),
    }, initialDependencies);
    git(root, "add", "README.md");
    git(root, "commit", "-m", "old group commit");
    const acknowledged = await executeLoopV2({
      operation: "ack-commit", projectRoot: root, changeName: "example",
      ...token(submitted.output.state!),
    }, initialDependencies);
    const finalized = await executeLoopV2({
      operation: "finalize", projectRoot: root, changeName: "example",
      ...token(acknowledged.output.state!),
    }, initialDependencies);
    const oldDone = finalized.output.state!;
    const oldGroupCommit = oldDone.groups["1"]!.commit.revision;

    writeFileSync(resolve(root, "EXTRA.md"), "newer baseline commit\n");
    git(root, "add", "EXTRA.md");
    git(root, "commit", "-m", "newer successor baseline");
    expect(git(root, "rev-parse", "HEAD")).not.toBe(oldGroupCommit);
    const baseline = await createGitWorkspaceV2(root).snapshot();
    const successorPlanning: LoopPlanningSnapshotV2 = {
      ready: true,
      planningRevision: hashCanonicalArtifactV2({ planning: "successor" }),
      groups: [
        { id: "1", fingerprint: oldDone.groups["1"]!.taskGroupFingerprint },
        { id: "2", fingerprint: hashCanonicalArtifactV2({ group: 2 }) },
      ],
      blockers: [],
    };
    const successor = createSuccessorRunV2({
      previousState: oldDone,
      runId: "run-new-baseline",
      sessionId: oldDone.sessionId,
      owner: oldDone.owner,
      nonce: "nonce-new-baseline",
      startedAt: "2020-01-01T00:00:00.000Z",
      planningRevision: successorPlanning.planningRevision,
      baselineGitRevision: baseline.headRevision,
      workspaceFingerprint: baseline.workspaceFingerprint as ArtifactHashV2,
      groups: successorPlanning.groups.map((group) => ({
        id: group.id,
        taskGroupFingerprint: group.fingerprint,
      })),
    });
    const store = new LoopStoreV2({ projectRoot: root });
    await store.initialize({
      state: successor.state,
      event: createRunInitializedEventV2(successor.state),
    });
    expect(successor.reusableEvidenceGroups).toEqual(["1"]);
    expect(successor.state.currentGroupId).toBe("2");

    const successorDependencies = deps(successorPlanning);
    const passed = await executeLoopV2({
      operation: "submit", projectRoot: root, changeName: "example",
      ...token(successor.state),
      bundle: {
        schemaVersion: 2,
        evidence: {
          verdict: "PASS",
          evidence: [{
            id: "tests", kind: "test", status: "pass", provenance: "cli",
            command: "npm test", cwd: root, exitCode: 0,
          }],
        },
        review: { findings: [] },
        artifacts: { "result.json": { passed: true } },
      },
    }, successorDependencies);
    expect(passed.exitCode, JSON.stringify(passed.output)).toBe(0);
    expect(passed.output.state?.phase).toBe("awaiting_group_commit");
    const beforeAck = await store.peek("example");
    const rejectedAck = await executeLoopV2({
      operation: "ack-commit", projectRoot: root, changeName: "example",
      ...token(passed.output.state!),
    }, successorDependencies);
    expect(rejectedAck.exitCode).toBe(2);
    expect(rejectedAck.output.error?.code).toBe("git_commit_unchanged");
    expect((await store.peek("example")).state).toEqual(beforeAck.state);

    git(root, "commit", "--allow-empty", "-m", "new successor group commit");
    const acceptedAck = await executeLoopV2({
      operation: "ack-commit", projectRoot: root, changeName: "example",
      ...token(passed.output.state!),
    }, successorDependencies);
    expect(acceptedAck.output.state?.phase).toBe("awaiting_finalize");
    const successorStatePath = resolve(
      root,
      ".corgi/loop/example/runs/run-new-baseline/state.json",
    );
    const successorEventsPath = resolve(
      root,
      ".corgi/loop/example/runs/run-new-baseline/events.jsonl",
    );
    const beforeFinalize = [
      readFileSync(successorStatePath),
      readFileSync(successorEventsPath),
    ];
    writeFileSync(resolve(
      root,
      ".corgi/loop/example/runs/run-old-baseline/attempts/1/1/artifacts/result.json",
    ), `${JSON.stringify({ tamperedSource: true }, null, 2)}\n`);
    const sourceTampered = await executeLoopV2({
      operation: "finalize", projectRoot: root, changeName: "example",
      ...token(acceptedAck.output.state!),
    }, successorDependencies);
    expect(sourceTampered.exitCode).toBe(2);
    expect(sourceTampered.output.error?.code).toBe("canonical_hash_mismatch");
    expect([readFileSync(successorStatePath), readFileSync(successorEventsPath)])
      .toEqual(beforeFinalize);
  });

  it("resumes a failed hook-driven run with monotonic token and explicit session handoff", async () => {
    const root = repo("resume");
    const planning = planningSnapshot();
    const nonces = ["nonce-init", "nonce-submitted", "nonce-evaluated", "nonce-resumed"];
    const dependencies = deps(planning, () => nonces.shift() ?? "nonce-extra");
    const initialized = await executeLoopV2({
      operation: "init",
      projectRoot: root,
      changeName: "example",
      sessionId: "session-old",
      ownerId: "human-1",
      ownerKind: "human",
      runId: "run-resume",
    }, dependencies);
    const state0 = initialized.output.state!;
    writeFileSync(resolve(root, "README.md"), "failing implementation\n");
    const failed = await executeLoopV2({
      operation: "submit",
      projectRoot: root,
      changeName: "example",
      ...token(state0),
      bundle: await submissionFor(root, state0, "FAIL", "bundle-failed"),
    }, dependencies);
    expect(failed.output.state?.phase).toBe("verification_failed");

    const resumeRequest = {
      operation: "resume",
      projectRoot: root,
      changeName: "example",
      ...token(failed.output.state!),
      newSessionId: "session-new",
      maxAttemptsPerGroup: 3,
    } as const;
    const resume = await executeLoopV2(resumeRequest, dependencies);
    expect(resume.exitCode).toBe(0);
    expect(resume.output.state).toMatchObject({
      phase: "fixing",
      sessionId: "session-new",
      stateRevision: 3,
      nonce: "nonce-resumed",
    });

    const runRoot = resolve(root, ".corgi/loop/example/runs/run-resume");
    const canonicalPaths = [
      resolve(root, ".corgi/loop/example/current.json"),
      resolve(runRoot, "events.jsonl"),
      resolve(runRoot, "state.json"),
    ];
    const afterResume = canonicalPaths.map((path) => readFileSync(path));
    const replayed = await executeLoopV2(resumeRequest, dependencies);
    expect(replayed).toMatchObject({
      exitCode: 0,
      output: {
        idempotent: true,
        state: {
          phase: "fixing",
          sessionId: "session-new",
          stateRevision: 3,
          nonce: "nonce-resumed",
        },
      },
    });
    expect(canonicalPaths.map((path) => readFileSync(path))).toEqual(afterResume);

    const conflicts = [
      { newSessionId: "session-other" },
      { targetPhase: "awaiting_group_result" as const },
      { maxAttemptsPerGroup: 4 },
    ];
    for (const conflict of conflicts) {
      const rejected = await executeLoopV2({ ...resumeRequest, ...conflict }, dependencies);
      expect(rejected).toMatchObject({
        exitCode: 2,
        output: { error: { code: "session_conflict" } },
      });
      expect(canonicalPaths.map((path) => readFileSync(path))).toEqual(afterResume);
    }
  });
});

function repo(label: string): string {
  const root = resolve(
    tmpdir(),
    `corgispec-loop-cli-v2-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  cleanup.push(root);
  mkdirSync(root, { recursive: true });
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "corgi@example.test");
  git(root, "config", "user.name", "Corgi Test");
  writeFileSync(resolve(root, "README.md"), "baseline\n");
  git(root, "add", "README.md");
  git(root, "commit", "-m", "baseline");
  return root;
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function planningSnapshot(): LoopPlanningSnapshotV2 {
  return {
    ready: true,
    planningRevision: hashCanonicalArtifactV2({ planning: "v1" }),
    groups: [{ id: "1", fingerprint: hashCanonicalArtifactV2({ group: 1 }) }],
    blockers: [],
  };
}

function deps(
  planning: LoopPlanningSnapshotV2,
  newNonce: () => string = (() => randomNonce()),
): LoopV2Dependencies {
  return {
    inspectPlanning: async () => structuredClone(planning),
    newNonce,
    newRunId: () => "run-test",
  };
}

function token(state: LoopStateV2) {
  return {
    runId: state.runId,
    sessionId: state.sessionId,
    stateRevision: state.stateRevision,
    nonce: state.nonce,
  };
}

async function submissionFor(
  root: string,
  state: LoopStateV2,
  verdict: "PASS" | "FAIL",
  bundleId: string,
): Promise<LoopSubmissionBundleV2> {
  const group = state.groups[state.currentGroupId!]!;
  const gitSnapshot = await createGitWorkspaceV2(root).snapshot();
  const binding = {
    runId: state.runId,
    groupId: group.id,
    attempt: state.currentAttempt,
    bundleId,
    planningRevision: state.planningRevision,
    taskGroupFingerprint: group.taskGroupFingerprint,
    baselineGitRevision: state.git.baselineRevision,
    observedGitRevision: gitSnapshot.headRevision,
    workspaceFingerprint: gitSnapshot.workspaceFingerprint as ArtifactHashV2,
  };
  const evidence: EvidenceEntryV2[] = verdict === "PASS"
    ? [{
        id: "tests",
        kind: "test",
        status: "pass",
        provenance: "cli",
        command: "npm test",
        cwd: root,
        exitCode: 0,
        binding,
      }]
    : [{
        id: "tests",
        kind: "test",
        status: "fail",
        provenance: "cli",
        command: "npm test",
        cwd: root,
        exitCode: 1,
        binding,
      }];
  return {
    schemaVersion: 2,
    evidence: createEvidenceBundleV2({ binding, verdict, evidence }),
    review: { findings: [] },
    artifacts: { "result.json": { verdict } },
  };
}

let nonceCounter = 0;
function randomNonce(): string {
  nonceCounter += 1;
  return `nonce-${nonceCounter}-${Date.now()}`;
}
