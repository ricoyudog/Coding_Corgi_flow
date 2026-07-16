import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtifactResolver, ResolvedChangeArtifacts } from "../../src/lib/artifact-resolver.js";
import type { OpenSpecConfig } from "../../src/lib/config.js";
import type { TaskGroupSummary } from "../../src/lib/lifecycle.js";
import {
  HookPlanningError,
  checkDangerousCommand,
  checkTaskGroupPostconditions,
  detectHookConfig,
  findProjectRoot,
  formatContextMarkdown,
  formatHookOutput,
  gatherSessionContext,
  isHooksDisabled,
  resolveHookChanges,
  resolveWrittenChange,
  scanActiveChanges,
  validateWriteTarget,
  type HookPlanningDependencies,
  type SessionContext,
} from "../../src/lib/hooks.js";
import type {
  OpenSpecListResponse,
  OpenSpecStatusResponse,
} from "../../src/lib/openspec-adapter.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(label: string): string {
  const root = resolve(
    tmpdir(),
    `corgispec-hooks-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  roots.push(root);
  mkdirSync(resolve(root, "openspec"), { recursive: true });
  writeFileSync(resolve(root, "openspec/config.yaml"), "schema: custom\n");
  return root;
}

function tempBareRoot(label: string): string {
  const root = resolve(
    tmpdir(),
    `corgispec-hooks-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  roots.push(root);
  mkdirSync(root, { recursive: true });
  return root;
}

function list(root: string, names: string[]): OpenSpecListResponse {
  return {
    changes: names.map((name) => ({
      name,
      completedTasks: 0,
      totalTasks: 1,
      lastModified: "2026-07-15T00:00:00.000Z",
      status: "in-progress",
    })),
    root: { path: resolve(root, "openspec"), source: "test" },
  };
}

function unusedStatus(): Promise<OpenSpecStatusResponse> {
  throw new Error("status must not be queried");
}

describe("authoritative hook planning context", () => {
  it("uses one Store query and a configured custom task artifact", async () => {
    const root = tempRoot("store-custom-task");
    const resolved = resolvedFixture(root, "change-a", {
      taskArtifactId: "work-items",
      taskContent: [
        "## 1. Prepare",
        "- [x] 1.1 prepared",
        "## 2. Deliver",
        "- [ ] 2.1 deliver",
      ].join("\n"),
    });
    const calls: Array<{ operation: string; options: unknown }> = [];
    const dependencies: HookPlanningDependencies = {
      listWorktrees: () => {
        throw new Error("Store mode must not enumerate worktrees");
      },
      createAdapter: () => ({
        listChanges: async (options) => {
          calls.push({ operation: "list", options });
          return list(root, ["change-a"]);
        },
        getStatus: unusedStatus,
      }),
      createResolver: () => ({
        resolve: async (_name, options) => {
          calls.push({ operation: "resolve", options });
          return resolved;
        },
      }) as ArtifactResolver,
    };

    const changes = await resolveHookChanges(
      root,
      {
        schema: "custom",
        corgi: { taskArtifactId: "work-items" },
        isolation: { mode: "worktree" },
      },
      { store: "shared-planning" },
      dependencies,
    );

    expect(changes).toMatchObject([
      {
        name: "change-a",
        commandRoot: root,
        worktreePath: ".",
        taskSummary: {
          taskArtifactId: "work-items",
          completedTasks: 1,
          totalTasks: 2,
          currentGroup: { number: 2 },
        },
      },
    ]);
    expect(calls).toEqual([
      { operation: "list", options: { store: "shared-planning" } },
      { operation: "resolve", options: { store: "shared-planning" } },
    ]);
  });

  it("deduplicates the same authoritative planning root across registered worktrees", async () => {
    const primary = tempRoot("shared-root-primary");
    const secondary = tempRoot("shared-root-secondary");
    const authoritativeRoot = resolve(tempBareRoot("shared-authority"), "openspec");
    mkdirSync(authoritativeRoot, { recursive: true });
    const resolved = resolvedFixture(primary, "shared-change");
    let resolveCalls = 0;
    const dependencies: HookPlanningDependencies = {
      listWorktrees: () => [primary, secondary, primary],
      createAdapter: (cwd) => ({
        listChanges: async () => ({
          ...list(cwd, ["shared-change"]),
          root: { path: authoritativeRoot, source: "store" },
        }),
        getStatus: unusedStatus,
      }),
      createResolver: () => ({
        resolve: async () => {
          resolveCalls += 1;
          return resolved;
        },
      }) as ArtifactResolver,
    };

    const changes = await resolveHookChanges(
      primary,
      { schema: "custom", isolation: { mode: "worktree" } },
      {},
      dependencies,
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ name: "shared-change", commandRoot: primary });
    expect(resolveCalls).toBe(1);
  });

  it("fails closed when worktree discovery yields no trusted roots", async () => {
    const root = tempRoot("no-worktrees");
    await expect(resolveHookChanges(
      root,
      { schema: "custom", isolation: { mode: "worktree" } },
      {},
      { listWorktrees: () => [] },
    )).rejects.toMatchObject({ code: "worktree_discovery_failed" });
  });

  it("fails closed before status resolution when a change is duplicated across worktrees", async () => {
    const primary = tempRoot("primary");
    const secondary = tempRoot("secondary");
    let statusCalls = 0;
    const dependencies: HookPlanningDependencies = {
      listWorktrees: () => [primary, secondary],
      createAdapter: (cwd) => ({
        listChanges: async () => list(cwd, ["duplicate"]),
        getStatus: async () => {
          statusCalls += 1;
          return await unusedStatus();
        },
      }),
    };
    const config: OpenSpecConfig = {
      schema: "custom",
      isolation: { mode: "worktree" },
    };

    await expect(resolveHookChanges(primary, config, {}, dependencies)).rejects.toMatchObject({
      name: "HookPlanningError",
      code: "ambiguous_change",
    });
    expect(statusCalls).toBe(0);
  });

  it("rejects duplicate rows in one OpenSpec list response", async () => {
    const root = tempRoot("duplicate-list");
    const dependencies: HookPlanningDependencies = {
      createAdapter: () => ({
        listChanges: async () => list(root, ["duplicate", "duplicate"]),
        getStatus: unusedStatus,
      }),
    };

    await expect(
      resolveHookChanges(root, { schema: "custom" }, {}, dependencies),
    ).rejects.toBeInstanceOf(HookPlanningError);
  });

  it("ignores guessed legacy directories that OpenSpec list does not return", async () => {
    const root = tempRoot("no-path-guessing");
    mkdirSync(resolve(root, "openspec/changes/ghost"), { recursive: true });
    writeFileSync(
      resolve(root, "openspec/changes/ghost/tasks.md"),
      "## 1. Ghost\n\n- [ ] 1.1 Must not be discovered\n",
    );
    const dependencies: HookPlanningDependencies = {
      createAdapter: () => ({
        listChanges: async () => list(root, []),
        getStatus: unusedStatus,
      }),
    };

    await expect(
      scanActiveChanges(root, { schema: "custom" }, {}, dependencies),
    ).resolves.toEqual([]);
  });

  it("fails when configured taskArtifactId is absent from the resolved artifact set", async () => {
    const root = tempRoot("missing-task-id");
    const resolved = resolvedFixture(root, "change-a");
    const dependencies: HookPlanningDependencies = {
      createAdapter: () => ({
        listChanges: async () => list(root, ["change-a"]),
        getStatus: unusedStatus,
      }),
      createResolver: () => ({
        resolve: async () => resolved,
      }) as ArtifactResolver,
    };

    await expect(resolveHookChanges(root, {
      schema: "custom",
      corgi: { taskArtifactId: "work-items" },
    }, {}, dependencies)).rejects.toMatchObject({
      code: "task_artifact_missing",
    });
  });

  it("rejects a status response for a different requested change", async () => {
    const root = tempRoot("status-mismatch");
    const dependencies: HookPlanningDependencies = {
      createAdapter: () => ({
        listChanges: async () => list(root, ["requested"]),
        getStatus: unusedStatus,
      }),
      createResolver: () => ({
        resolve: async () => resolvedFixture(root, "different"),
      }) as ArtifactResolver,
    };

    await expect(
      resolveHookChanges(root, { schema: "custom" }, {}, dependencies),
    ).rejects.toMatchObject({ code: "openspec_contract_mismatch" });
  });
});

describe("session context and authoritative write matching", () => {
  it("returns null without a project config and gathers Store-backed custom task context", async () => {
    const bare = tempBareRoot("gather-missing");
    await expect(gatherSessionContext(bare)).resolves.toBeNull();

    const root = tempRoot("gather-success");
    writeFileSync(
      resolve(root, "openspec/config.yaml"),
      [
        "schema: custom-delivery",
        "corgi:",
        "  taskArtifactId: work-items",
      ].join("\n"),
    );
    const resolved = resolvedFixture(root, "z-change", {
      taskArtifactId: "work-items",
      taskContent: "## 1. Ship\n- [ ] 1.1 implement\n",
    });
    let listOptions: unknown;
    const dependencies: HookPlanningDependencies = {
      currentBranch: () => "feature/context",
      createAdapter: () => ({
        listChanges: async (options) => {
          listOptions = options;
          return list(root, ["z-change"]);
        },
        getStatus: unusedStatus,
      }),
      createResolver: () => ({ resolve: async () => resolved }) as ArtifactResolver,
    };

    await expect(
      gatherSessionContext(root, { store: "shared" }, dependencies),
    ).resolves.toMatchObject({
      schema: "custom-delivery",
      isolationMode: "none",
      currentBranch: "feature/context",
      worktreePath: "N/A",
      activeChanges: [
        { name: "z-change", worktreePath: null, currentGroup: "Group 1 in-progress" },
      ],
    });
    expect(listOptions).toEqual({ store: "shared" });
  });

  it("returns null outside a change and accepts a guarded relative path inside it", async () => {
    const root = tempRoot("written-path");
    const resolved = resolvedFixture(root, "change-a");
    const dependencies = dependenciesFor(root, { "change-a": resolved });

    await expect(resolveWrittenChange(
      "README.md",
      root,
      { schema: "custom" },
      {},
      dependencies,
    )).resolves.toBeNull();
    await expect(resolveWrittenChange(
      "openspec/changes/change-a/new-artifact.md",
      root,
      { schema: "custom" },
      {},
      dependencies,
    )).resolves.toMatchObject({ name: "change-a", resolved: { changeRoot: resolved.changeRoot } });
    await expect(resolveWrittenChange(
      "C:\\outside\\artifact.md",
      root,
      { schema: "custom" },
      {},
      dependencies,
    )).resolves.toBeNull();
  });

  it("rejects overlapping authoritative change roots as ambiguous", async () => {
    const root = tempRoot("written-ambiguous");
    const outer = resolvedFixture(root, "outer");
    const nestedRoot = resolve(outer.changeRoot, "nested");
    mkdirSync(nestedRoot, { recursive: true });
    const nestedBase = resolvedFixture(root, "nested");
    const nested: ResolvedChangeArtifacts = {
      ...nestedBase,
      changeRoot: nestedRoot,
      planningHome: outer.planningHome,
      status: { ...nestedBase.status, changeRoot: nestedRoot, planningHome: outer.planningHome },
    };

    await expect(resolveWrittenChange(
      resolve(nestedRoot, "artifact.md"),
      root,
      { schema: "custom" },
      {},
      dependenciesFor(root, { outer, nested }),
    )).rejects.toMatchObject({ code: "ambiguous_change" });
  });

  it("rejects a lexical in-root write through an escaping symlink", async () => {
    const root = tempRoot("written-symlink");
    const resolved = resolvedFixture(root, "change-a");
    const outside = tempBareRoot("written-symlink-outside");
    symlinkSync(outside, resolve(resolved.changeRoot, "linked"), "dir");

    await expect(resolveWrittenChange(
      resolve(resolved.changeRoot, "linked/new.md"),
      root,
      { schema: "custom" },
      {},
      dependenciesFor(root, { "change-a": resolved }),
    )).rejects.toMatchObject({ code: "symlink_escape" });
  });
});

function dependenciesFor(
  root: string,
  changes: Record<string, ResolvedChangeArtifacts>,
): HookPlanningDependencies {
  return {
    createAdapter: () => ({
      listChanges: async () => list(root, Object.keys(changes)),
      getStatus: unusedStatus,
    }),
    createResolver: () => ({
      resolve: async (name: string) => changes[name]!,
    }) as ArtifactResolver,
  };
}

describe("hook utility contracts", () => {
  it("finds a project root by walking upward and returns null at an unconfigured root", () => {
    const root = tempRoot("find-root");
    const nested = resolve(root, "src/deep/module");
    mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(root);

    const bare = tempBareRoot("find-root-missing");
    expect(findProjectRoot(bare)).toBeNull();
  });

  it("formats active and empty contexts and wraps hook-specific JSON", () => {
    const active: SessionContext = {
      schema: "custom",
      isolationMode: "worktree",
      activeChanges: [
        { name: "change-a", worktreePath: ".worktrees/change-a", currentGroup: "Group 2 in-progress" },
        { name: "planning-only", worktreePath: null, currentGroup: null },
      ],
      currentBranch: "feature/change-a",
      worktreePath: ".",
    };
    const markdown = formatContextMarkdown(active);
    expect(markdown).toContain("change-a → .worktrees/change-a (Group 2 in-progress)");
    expect(markdown).toContain("planning-only → no worktree (planning)");
    expect(JSON.parse(formatHookOutput("SessionStart", active))).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: markdown,
      },
    });

    expect(formatContextMarkdown({ ...active, activeChanges: [] })).toContain(
      "**Active changes**: (none)",
    );
  });

  it("honors the hooks-disable environment switch", () => {
    const previous = process.env["CORGISPEC_HOOKS_DISABLE"];
    try {
      delete process.env["CORGISPEC_HOOKS_DISABLE"];
      expect(isHooksDisabled()).toBe(false);
      process.env["CORGISPEC_HOOKS_DISABLE"] = "1";
      expect(isHooksDisabled()).toBe(true);
      process.env["CORGISPEC_HOOKS_DISABLE"] = "true";
      expect(isHooksDisabled()).toBe(false);
    } finally {
      if (previous === undefined) delete process.env["CORGISPEC_HOOKS_DISABLE"];
      else process.env["CORGISPEC_HOOKS_DISABLE"] = previous;
    }
  });

  it("enforces worktree write roots while preserving none and portable separators", () => {
    const root = tempBareRoot("write-target");
    expect(validateWriteTarget("src/index.ts", root, { schema: "custom" })).toBeNull();
    expect(validateWriteTarget("src/index.ts", root, {
      schema: "custom",
      isolation: { mode: "none" },
    })).toBeNull();
    const config: OpenSpecConfig = {
      schema: "custom",
      isolation: { mode: "worktree", root: ".worktrees" },
    };
    expect(validateWriteTarget(".worktrees/change-a/src.ts", root, config)).toBeNull();
    expect(validateWriteTarget(".worktrees\\change-a\\src.ts", root, config)).toBeNull();
    expect(validateWriteTarget("src/index.ts", root, config)).toContain("outside the worktree root");
    expect(validateWriteTarget("src/index.ts", root, {
      schema: "custom",
      isolation: { mode: "worktree" },
    })).toContain('root ".worktrees"');
  });

  it.each([
    ["rm -rf /", "destructive command"],
    ["git push --force origin main", "Force push to main"],
    ["git push -f origin main", "Force push to main"],
  ])("blocks dangerous command %s", (command, message) => {
    expect(checkDangerousCommand(command)).toContain(message);
  });

  it("allows safe commands and force pushes that do not target main", () => {
    expect(checkDangerousCommand("npm test && git push origin feature/change-a")).toBeNull();
    expect(checkDangerousCommand("git push --force origin feature/change-a")).toBeNull();
  });

  it("reports only incomplete current-group tasks as postcondition failures", () => {
    const incomplete = {
      currentGroup: {
        name: "Ship",
        tasks: [
          { id: "2.1", description: "done", done: true },
          { id: "2.2", description: "remaining", done: false },
        ],
      },
    } as unknown as TaskGroupSummary;
    expect(checkTaskGroupPostconditions(incomplete)).toEqual([
      'Incomplete tasks in "Ship":',
      "  - 2.2 remaining",
    ]);
    expect(checkTaskGroupPostconditions({
      ...incomplete,
      currentGroup: { ...incomplete.currentGroup!, tasks: incomplete.currentGroup!.tasks.map((task) => ({ ...task, done: true })) },
    })).toBeNull();
    expect(checkTaskGroupPostconditions({
      ...incomplete,
      currentGroup: {
        ...incomplete.currentGroup!,
        completedTasks: 0,
        tasks: incomplete.currentGroup!.tasks.map((task) => ({ ...task, done: false })),
      },
    })).toBeNull();
    expect(checkTaskGroupPostconditions(null)).toBeNull();
  });

  it("detects Claude hook configuration with priority", () => {
    const root = tempBareRoot("detect-claude");
    mkdirSync(resolve(root, ".claude"), { recursive: true });
    writeFileSync(resolve(root, ".claude/settings.json"), JSON.stringify({
      hooks: { SessionStart: [], Stop: [] },
    }));
    expect(detectHookConfig(root)).toMatchObject({
      configured: true,
      platform: "claude",
      events: ["SessionStart", "Stop"],
    });
  });

  it("falls through malformed Claude settings to an OpenCode deep plugin", () => {
    const root = tempBareRoot("detect-opencode");
    mkdirSync(resolve(root, ".claude"), { recursive: true });
    mkdirSync(resolve(root, ".opencode/plugins"), { recursive: true });
    writeFileSync(resolve(root, ".claude/settings.json"), "{not-json");
    writeFileSync(resolve(root, ".opencode/plugins/corgispec-deep.ts"), "export const CorgiSpecDeep = {};");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(detectHookConfig(root)).toMatchObject({ configured: true, platform: "opencode" });
      expect(error).toHaveBeenCalledOnce();
    } finally {
      error.mockRestore();
    }
  });

  it("deduplicates detected Codex events and reports an unconfigured project", () => {
    const root = tempBareRoot("detect-codex");
    mkdirSync(resolve(root, ".codex"), { recursive: true });
    writeFileSync(
      resolve(root, ".codex/config.toml"),
      "hooks = true\n[[hooks.SessionStart]]\n[[hooks.SessionStart]]\n[[hooks.Stop]]\n",
    );
    expect(detectHookConfig(root)).toMatchObject({
      configured: true,
      platform: "codex",
      events: ["SessionStart", "Stop"],
    });
    expect(detectHookConfig(tempBareRoot("detect-none"))).toEqual({
      configured: false,
      platform: null,
      events: [],
      configFile: null,
    });
  });
});

function resolvedFixture(
  root: string,
  changeName: string,
  options: { taskArtifactId?: string; taskContent?: string } = {},
): ResolvedChangeArtifacts {
  const planningRoot = resolve(root, "openspec");
  const changeRoot = resolve(planningRoot, "changes", changeName);
  mkdirSync(changeRoot, { recursive: true });
  const artifactPaths: OpenSpecStatusResponse["artifactPaths"] = {};
  if (options.taskArtifactId) {
    const taskPath = resolve(changeRoot, `${options.taskArtifactId}.md`);
    writeFileSync(taskPath, options.taskContent ?? "## 1. Work\n- [ ] 1.1 implement\n");
    artifactPaths[options.taskArtifactId] = {
      outputPath: `${options.taskArtifactId}.md`,
      resolvedOutputPath: taskPath,
      existingOutputPaths: [taskPath],
    };
  }
  const status = {
    changeName,
    schemaName: "custom",
    planningHome: {
      kind: "repo" as const,
      root: planningRoot,
      changesDir: resolve(planningRoot, "changes"),
      defaultSchema: "custom",
    },
    changeRoot,
    artifactPaths,
    nextSteps: [],
    actionContext: {
      mode: "planning",
      sourceOfTruth: "openspec",
      planningArtifacts: [],
      linkedContext: [],
      allowedEditRoots: [changeRoot],
      requiresAffectedAreaSelection: false,
      constraints: [],
    },
    isComplete: false,
    applyRequires: [],
    artifacts: Object.entries(artifactPaths).map(([id, artifact]) => ({
      id,
      outputPath: artifact.outputPath,
      status: "done" as const,
    })),
  } satisfies OpenSpecStatusResponse;
  return {
    changeName,
    schemaName: "custom",
    planningHome: status.planningHome,
    changeRoot,
    artifactPaths,
    actionContext: status.actionContext,
    planningRevision: "sha256:test",
    planningComplete: false,
    status,
  };
}
