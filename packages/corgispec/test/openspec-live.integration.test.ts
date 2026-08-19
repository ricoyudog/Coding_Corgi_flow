import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArtifactResolver } from "../src/lib/artifact-resolver.js";
import { loadConfigFromDir } from "../src/lib/config.js";
import { buildLifecycleReadyReport } from "../src/lib/lifecycle.js";
import { createOpenSpecAdapter } from "../src/lib/openspec-adapter.js";

const live = process.env["CORGISPEC_E2E_OPENSPEC"] === "1";

describe.skipIf(!live)("OpenSpec 1.6 live contract", () => {
  let root: string;
  const originalHome = process.env["HOME"];
  const originalUserProfile = process.env["USERPROFILE"];
  const originalXdg = process.env["XDG_CONFIG_HOME"];

  beforeAll(() => {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-openspec-live-"));
    const isolatedHome = resolve(root, "home");
    mkdirSync(isolatedHome, { recursive: true });
    process.env["HOME"] = isolatedHome;
    process.env["USERPROFILE"] = isolatedHome;
    process.env["XDG_CONFIG_HOME"] = resolve(isolatedHome, ".config");
    mkdirSync(resolve(root, "openspec"), { recursive: true });
    writeFileSync(
      resolve(root, "openspec/config.yaml"),
      [
        "schema: spec-driven",
        "corgi:",
        "  tracking:",
        "    provider: none",
        "  taskArtifactId: tasks",
        "",
      ].join("\n"),
    );
  });

  afterAll(() => {
    if (originalHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = originalHome;
    if (originalUserProfile === undefined) delete process.env["USERPROFILE"];
    else process.env["USERPROFILE"] = originalUserProfile;
    if (originalXdg === undefined) delete process.env["XDG_CONFIG_HOME"];
    else process.env["XDG_CONFIG_HOME"] = originalXdg;
    rmSync(root, { recursive: true, force: true });
  });

  it("creates, resolves, validates and readies a real nested/glob change", async () => {
    const adapter = createOpenSpecAdapter(root);
    const created = await adapter.createChange("live-contract", { schema: "spec-driven" });
    expect(created.change.schema).toBe("spec-driven");

    const changeRoot = created.change.path;
    mkdirSync(resolve(changeRoot, "specs/live-capability"), { recursive: true });
    writeFileSync(
      resolve(changeRoot, "proposal.md"),
      [
        "## Why",
        "Exercise the published OpenSpec JSON contract.",
        "",
        "## What Changes",
        "- Add a live capability.",
        "",
        "## Capabilities",
        "### New Capabilities",
        "- `live-capability`: Live adapter behavior.",
        "",
        "### Modified Capabilities",
        "None",
        "",
        "## Impact",
        "Test-only temporary project.",
        "",
      ].join("\n"),
    );
    writeFileSync(
      resolve(changeRoot, "specs/live-capability/spec.md"),
      [
        "## ADDED Requirements",
        "",
        "### Requirement: Live adapter contract",
        "The adapter SHALL consume concrete OpenSpec paths.",
        "",
        "#### Scenario: Resolve a completed change",
        "- **WHEN** all planning artifacts exist",
        "- **THEN** status reports the change complete",
        "",
      ].join("\n"),
    );
    writeFileSync(
      resolve(changeRoot, "design.md"),
      "## Context\nLive contract fixture.\n\n## Decisions\nUse upstream JSON paths.\n",
    );
    writeFileSync(
      resolve(changeRoot, "tasks.md"),
      "## 1. Live integration\n- [ ] 1.1 Verify the adapter contract\n",
    );

    const listed = await adapter.listChanges();
    expect(listed.changes.map((change) => change.name)).toContain("live-contract");

    const status = await adapter.getStatus("live-contract");
    expect(status.isComplete).toBe(true);
    expect(status.artifactPaths.specs?.existingOutputPaths).toEqual([
      resolve(changeRoot, "specs/live-capability/spec.md"),
    ]);

    const instructions = await adapter.getApplyInstructions("live-contract");
    expect(instructions.contextFiles.tasks).toEqual([resolve(changeRoot, "tasks.md")]);

    const resolved = await createArtifactResolver(adapter).resolve("live-contract");
    expect(resolved.planningRevision).toMatch(/^sha256:[a-f0-9]{64}$/);

    const ready = await buildLifecycleReadyReport(
      adapter,
      resolved,
      loadConfigFromDir(root),
      true,
      {},
      root,
    );
    expect(ready.report.status).toBe("ready");
  }, 30_000);
});
